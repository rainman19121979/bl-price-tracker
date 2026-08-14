#!/usr/bin/env bash
# BrickLink Price Tracker — Ein-Befehl-Installer für Ubuntu/Debian.
#
# Nutzung:
#   curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh | sudo bash
# Oder sicher-inspect-then-run:
#   curl -fsSL https://raw.githubusercontent.com/rainman19121979/bl-price-tracker/main/scripts/install.sh -o install.sh
#   less install.sh
#   sudo bash install.sh
#
# Was der Installer NICHT anfasst:
#   - SSH-Config
#   - UFW / iptables
#   - Existierende Services (bricht ab bei Konflikt)
#   - BrickSync-Dateien (nur lesend, mit deiner Zustimmung)
#   - Systemweite Pakete außer Docker

set -euo pipefail

# ─── curl-|-bash sicher machen ───────────────────────────────────────────────
# Der komplette Installer läuft in main() unten. Grund: bei `curl … | bash`
# liest bash die Skript-Zeilen vom STDIN-Pipe. Würde der Skript-Code direkt
# `exec < /dev/tty` machen (nötig für interaktive Prompts), wäre der Pipe zu
# und bash würde den Rest des Skripts nicht mehr lesen. In einer Funktion
# gewrappt wird alles zuerst geparst und erst nach dem letzten `main "$@"`
# ausgeführt — dann sind wir sicher.

main() {

# ─── Konstanten ──────────────────────────────────────────────────────────────
REPO_URL="https://github.com/rainman19121979/bl-price-tracker.git"
INSTALL_DIR="/opt/bl-price-tracker"
MIN_RAM_MB=1800     # 2 GB VPS haben nach OS-Overhead meist ~1.8 GB
MIN_DISK_MB=5120
SUPPORTED_OS=("ubuntu 22.04" "ubuntu 24.04" "debian 12")

# ─── Farb-Helfer ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; NC=''
fi
info()  { printf "${BLUE}➜${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
step()  { printf "\n${BLUE}▸ %s${NC}\n" "$*"; }
ask()   { printf "${YELLOW}?${NC} %s " "$*"; }

# ─── Rollback ────────────────────────────────────────────────────────────────
CREATED_DIR=0
STARTED_STACK=0

rollback() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo ""
    warn "Installation abgebrochen. Aufräumen:"
    if [ "$STARTED_STACK" = "1" ]; then
      warn "  Stack wird gestoppt: cd $INSTALL_DIR && docker compose down -v"
    fi
    if [ "$CREATED_DIR" = "1" ]; then
      warn "  Verzeichnis wurde vom Installer angelegt und bleibt für Fehler-Analyse."
      warn "  Wenn nicht mehr gebraucht: sudo rm -rf $INSTALL_DIR"
    fi
  fi
}
trap rollback EXIT

# ─── Preflight ───────────────────────────────────────────────────────────────

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "Bitte mit sudo/root ausführen: sudo bash $0"
  fi
}

check_os() {
  step "OS-Check"
  if [ ! -f /etc/os-release ]; then
    fail "/etc/os-release nicht gefunden — nur Ubuntu/Debian unterstützt"
  fi
  . /etc/os-release
  local os_id="${ID,,} ${VERSION_ID}"
  local supported=0
  for s in "${SUPPORTED_OS[@]}"; do
    if [ "$os_id" = "$s" ]; then supported=1; break; fi
  done
  if [ "$supported" -eq 0 ]; then
    warn "Getestet auf: ${SUPPORTED_OS[*]}"
    warn "Deins: $os_id — kann klappen, aber ohne Gewähr."
    ask "Trotzdem fortfahren? [j/N]"
    read -r answer
    [[ "$answer" =~ ^[jJyY]$ ]] || exit 1
  else
    ok "OS erkannt: $os_id"
  fi
}

check_ram() {
  step "RAM-Check"
  local total_mb
  total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$total_mb" -lt "$MIN_RAM_MB" ]; then
    warn "Nur ${total_mb} MB RAM verfügbar (empfohlen: 2048+ MB)."
    warn "Kann funktionieren, aber Crawler + Datenbank + Web können ins Swap gehen."
    ask "Trotzdem fortfahren? [j/N]"
    read -r answer
    [[ "$answer" =~ ^[jJyY]$ ]] || exit 1
  else
    ok "RAM: ${total_mb} MB"
  fi
}

check_disk() {
  step "Speicherplatz-Check"
  local free_mb
  free_mb=$(df -m / | awk 'NR==2 {print $4}')
  if [ "$free_mb" -lt "$MIN_DISK_MB" ]; then
    fail "Nur ${free_mb} MB frei auf / — mindestens ${MIN_DISK_MB} MB benötigt"
  fi
  ok "Platte: ${free_mb} MB frei"
}

check_ports() {
  step "Port-Check"
  local conflict=0
  # 3000 wird immer geprüft (Web), egal welcher Modus
  if ss -tlnH "sport = :3000" 2>/dev/null | grep -q .; then
    warn "Port 3000 ist bereits belegt (wird für die Web-UI benötigt)"
    ss -tlnp "sport = :3000" 2>/dev/null | head -5 >&2
    conflict=1
  fi
  if [ "$MODE" = "caddy" ]; then
    for port in 80 443; do
      if ss -tlnH "sport = :${port}" 2>/dev/null | grep -q .; then
        warn "Port ${port} ist bereits belegt (wird für HTTPS/Caddy benötigt)"
        ss -tlnp "sport = :${port}" 2>/dev/null | head -5 >&2
        conflict=1
      fi
    done
  fi
  if [ "$conflict" -eq 1 ]; then
    fail "Port-Konflikt — beende die andere Anwendung erst oder wähle einen anderen Modus"
  fi
  ok "Alle benötigten Ports frei"
}

check_existing() {
  step "Bestehende Installation prüfen"
  if [ -d "$INSTALL_DIR" ]; then
    warn "$INSTALL_DIR existiert bereits."
    ask "Update statt Neuinstallation? [j/N]"
    read -r answer
    if [[ "$answer" =~ ^[jJyY]$ ]]; then
      UPDATE_MODE=1
      ok "Update-Modus aktiv."
      return
    else
      fail "Abgebrochen. Wenn du wirklich neu installieren willst: sudo rm -rf $INSTALL_DIR"
    fi
  fi
  ok "Keine bestehende Installation."
}

# ─── Basis-Tools installieren ────────────────────────────────────────────────
install_base_tools() {
  step "Basis-Tools prüfen"
  local missing=()
  for cmd in curl git ca-certificates ss; do
    # ss steckt in iproute2; ca-certificates ist ein Paket ohne CLI
    case "$cmd" in
      ca-certificates)
        dpkg -s ca-certificates >/dev/null 2>&1 || missing+=("ca-certificates")
        ;;
      *)
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
        ;;
    esac
  done
  # iproute2 wenn ss fehlt
  if ! command -v ss >/dev/null 2>&1; then
    missing=("${missing[@]/ss/iproute2}")
  fi
  if [ ${#missing[@]} -eq 0 ]; then
    ok "curl, git, ca-certificates, iproute2 sind da."
    return
  fi
  info "Fehlt: ${missing[*]} — installiere via apt..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
  ok "Basis-Tools installiert."
}

# ─── Docker Install ──────────────────────────────────────────────────────────
install_docker() {
  step "Docker prüfen/installieren"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker ($(docker --version | cut -d' ' -f3 | tr -d ,)) + Compose vorhanden."
    return
  fi
  info "Docker fehlt — installiere via offiziellem get.docker.com Script..."
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  systemctl enable --now docker
  ok "Docker installiert."
}

# ─── BrickSync-Erkennung ─────────────────────────────────────────────────────
detect_bricksync() {
  step "BrickSync-Installation suchen"
  local found=""
  for dir in /home/*/bricksync-linux64/data/orders /root/bricksync-linux64/data/orders /opt/bricksync-linux64/data/orders; do
    if [ -d "$dir" ]; then
      found="$dir"
      break
    fi
  done
  if [ -n "$found" ]; then
    ok "BrickSync-Orders gefunden: $found"
    ask "Als BSX-Quelle einrichten (nur lesend)? [J/n]"
    read -r answer
    if [[ ! "$answer" =~ ^[nN]$ ]]; then
      BSX_HOST_PATH="$found"
      ok "BSX-Pfad wird eingebunden."
    fi
  else
    info "Kein BrickSync gefunden — kannst du später in der UI konfigurieren."
  fi
}

# ─── Modus wählen ────────────────────────────────────────────────────────────
choose_mode() {
  step "Zugriffsmodus wählen"
  echo ""
  echo "  [1] Nur lokal (127.0.0.1:3000) — für Zugriff via Tailscale/SSH-Tunnel (empfohlen)"
  echo "  [2] Öffentlich mit HTTPS via Caddy — brauchst Domain + Email"
  echo ""
  ask "Auswahl [1/2]:"
  read -r choice
  case "$choice" in
    2)
      MODE="caddy"
      ask "Domain (z.B. tracker.deine-domain.de):"
      read -r DOMAIN
      [ -z "$DOMAIN" ] && fail "Domain darf nicht leer sein"
      ask "Email für Let's-Encrypt:"
      read -r EMAIL
      [ -z "$EMAIL" ] && fail "Email darf nicht leer sein"
      ok "Modus: HTTPS via Caddy für ${DOMAIN}"
      ;;
    *)
      MODE="local"
      ok "Modus: nur lokal — Zugriff via Tailscale oder SSH-Tunnel"
      ;;
  esac
}

# ─── Repo klonen / updaten ───────────────────────────────────────────────────
setup_repo() {
  step "Repo einrichten"
  if [ "${UPDATE_MODE:-0}" = "1" ]; then
    info "Update: git pull in $INSTALL_DIR"
    (cd "$INSTALL_DIR" && git pull --ff-only)
  else
    info "Klone $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    CREATED_DIR=1
  fi
  cd "$INSTALL_DIR"

  # Ownership auf den aufrufenden User (SUDO_USER) übertragen — sonst muss
  # er später jeden `git`-Befehl und jedes `docker compose` mit sudo aufrufen
  # und läuft in git-safe.directory-Warnungen.
  # SUDO_USER ist gesetzt wenn das Skript per `sudo bash …` läuft.
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    chown -R "$SUDO_USER":"$SUDO_USER" "$INSTALL_DIR"
    # Und den User in die docker-Gruppe packen, damit er `docker compose`
    # ohne sudo laufen lassen kann (nach Re-Login)
    if getent group docker >/dev/null 2>&1; then
      usermod -aG docker "$SUDO_USER" 2>/dev/null || true
    fi
    ok "Ownership auf $SUDO_USER + docker-Gruppen-Mitgliedschaft (nach Re-Login aktiv)."
  fi

  ok "Repo bereit."
}

# ─── Env + Compose konfigurieren ─────────────────────────────────────────────
setup_env() {
  step ".env konfigurieren"
  if [ -f .env ]; then
    if grep -q "^DB_PASSWORD=change-me" .env 2>/dev/null; then
      info ".env hat noch Platzhalter — fülle Secrets nach"
      bash scripts/init-env.sh
    else
      ok ".env existiert bereits mit echten Werten — nicht überschrieben"
    fi
  else
    bash scripts/init-env.sh
  fi

  # Mode-spezifische Einstellungen anhängen
  if [ "$MODE" = "caddy" ]; then
    sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=https://${DOMAIN}|" .env
    grep -q "^DOMAIN=" .env || echo "DOMAIN=${DOMAIN}" >> .env
    grep -q "^EMAIL=" .env || echo "EMAIL=${EMAIL}" >> .env
    # Web-Port nicht extern binden — Caddy übernimmt
    grep -q "^WEB_PORT=" .env || echo "WEB_PORT=127.0.0.1:3000" >> .env
    ok "NEXTAUTH_URL=https://${DOMAIN}, DOMAIN, EMAIL gesetzt"
  else
    # Lokal-Modus: an 0.0.0.0:3000 binden, damit Tailscale-Interface + SSH-Tunnel
    # + Docker-Host-Netz die App erreichen. Öffentliche Erreichbarkeit muss der
    # Nutzer via Firewall (UFW/Router/VPS-Provider) blockieren — Standard-VPS-
    # Setups haben Port 3000 eh nicht offen. Für strikte Loopback-Only:
    # WEB_PORT=127.0.0.1:3000 in .env setzen.
    grep -q "^WEB_PORT=" .env || echo "WEB_PORT=3000" >> .env
    # NEXTAUTH_URL bleibt http://localhost:3000 (Default)
    ok "Web bindet an 0.0.0.0:3000 (via Tailscale, SSH-Tunnel oder LAN erreichbar)"
  fi

  # BSX-Pfad falls von detect_bricksync gesetzt
  if [ -n "${BSX_HOST_PATH:-}" ]; then
    grep -q "^BSX_HOST_PATH=" .env && \
      sed -i "s|^BSX_HOST_PATH=.*|BSX_HOST_PATH=${BSX_HOST_PATH}|" .env || \
      echo "BSX_HOST_PATH=${BSX_HOST_PATH}" >> .env
    ok "BSX_HOST_PATH=${BSX_HOST_PATH}"
  fi
}

# ─── Stack starten ───────────────────────────────────────────────────────────
start_stack() {
  step "Docker-Stack starten (dauert 2-3 Min beim ersten Mal)"
  local compose_files=("-f" "docker-compose.yml")
  if [ "$MODE" = "caddy" ]; then
    compose_files+=("-f" "docker-compose.caddy.yml")
  fi
  # `--pull always` holt das aktuellste GHCR-Image; wenn das Image nicht
  # verfügbar ist (Fork, GHCR down), fallback auf lokalen Build.
  if ! docker compose "${compose_files[@]}" pull 2>/dev/null; then
    warn "GHCR-Image nicht verfügbar oder nicht erreichbar — baue lokal (dauert 5-10 Min)"
    docker compose "${compose_files[@]}" up -d --build
  else
    docker compose "${compose_files[@]}" up -d
  fi
  STARTED_STACK=1
  ok "Stack läuft."

  # Warten bis der web-Service healthy ist (via HTTP-Check)
  info "Warte auf Web-Service..."
  local attempts=0
  local max_attempts=30
  while [ $attempts -lt $max_attempts ]; do
    if curl -fsS -o /dev/null "http://127.0.0.1:3000/api/setup/status" 2>/dev/null; then
      ok "Web-Service antwortet."
      return
    fi
    sleep 3
    attempts=$((attempts + 1))
    printf "."
  done
  warn "Web-Service antwortet noch nicht nach 90s — Logs prüfen: docker compose -f $INSTALL_DIR/docker-compose.yml logs web"
}

# ─── Abschluss ───────────────────────────────────────────────────────────────
show_next_steps() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"
  ok "Installation fertig."
  echo "═══════════════════════════════════════════════════════════════════"
  echo ""
  if [ "$MODE" = "caddy" ]; then
    echo "  URL:  https://${DOMAIN}"
    echo ""
    echo "  Wichtig: DNS-A-Record für ${DOMAIN} muss auf die IP dieses Servers zeigen,"
    echo "  bevor Let's-Encrypt das Zertifikat ausstellen kann. Prüfe mit:"
    echo "    dig +short ${DOMAIN}"
    echo ""
  else
    local vps_ip
    vps_ip=$(curl -fsS -m 3 https://api.ipify.org 2>/dev/null || echo "DEIN-VPS-IP")
    echo "  Die App läuft lokal auf dem Server (127.0.0.1:3000)."
    echo "  Sie ist bewusst NICHT von außen erreichbar."
    echo ""
    echo "  ── Zugriff via Tailscale (empfohlen) ─────────────────────────────"
    echo "    1) Auf diesem Server:"
    echo "         curl -fsSL https://tailscale.com/install.sh | sh"
    echo "         sudo tailscale up"
    echo "         (Link öffnen, mit Google/GitHub/Microsoft einloggen)"
    echo "    2) Auf deinem Laptop/Handy Tailscale installieren, gleiches Konto."
    echo "    3) Server-Tailscale-IP anzeigen: tailscale ip -4"
    echo "    4) Im Browser (überall): http://<Tailscale-IP>:3000"
    echo ""
    echo "  ── Alternativ: SSH-Tunnel ────────────────────────────────────────"
    echo "    Vom eigenen Rechner:  ssh -L 3000:localhost:3000 root@${vps_ip}"
    echo "    Dann im Browser:      http://localhost:3000"
    echo ""
  fi
  echo "  ── Erster Login ──────────────────────────────────────────────────"
  echo "    Der erste Account wird automatisch Admin. Danach unter"
  echo "    Einstellungen → Registrierung ausschalten."
  echo ""
  echo "  ── Wartung ───────────────────────────────────────────────────────"
  echo "    cd $INSTALL_DIR"
  echo "    docker compose logs -f web       # Logs live"
  echo "    docker compose ps                # Status"
  echo "    git pull && docker compose pull && docker compose up -d   # Update"
  echo ""
  echo "═══════════════════════════════════════════════════════════════════"
}

# ─── Main ────────────────────────────────────────────────────────────────────
MODE=""
DOMAIN=""
EMAIL=""
BSX_HOST_PATH=""
UPDATE_MODE=0

echo ""
echo "  BrickLink Price Tracker — Installer"
echo "  ==================================="
echo ""

# Interaktivität: bei curl|bash umleiten von /dev/tty (bash hat schon alles geparst,
# weil wir in main() sind — jetzt darf STDIN gefahrlos wechseln).
if [ ! -t 0 ] && [ -r /dev/tty ]; then
  exec < /dev/tty
fi

require_root
check_os
install_base_tools     # muss vor check_ports (braucht ss) und install_docker (braucht curl) laufen
check_ram
check_disk
check_existing
choose_mode
check_ports
install_docker
setup_repo
detect_bricksync
setup_env
start_stack
show_next_steps

# Erfolg — Rollback-Trap deaktivieren
trap - EXIT

}  # ← main() Ende

main "$@"
