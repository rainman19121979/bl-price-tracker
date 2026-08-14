#!/usr/bin/env bash
# Erzeugt .env aus .env.example und füllt die drei Secrets mit frischen
# Zufallswerten. Idempotent: wenn .env schon existiert und echte (nicht mehr
# die "change-me")-Werte enthält, wird nichts überschrieben.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v openssl >/dev/null 2>&1; then
  echo "Fehler: openssl nicht gefunden. Installiere es (z.B. 'apt install openssl')." >&2
  exit 1
fi

if [ -f .env ]; then
  if grep -q "^DB_PASSWORD=change-me" .env 2>/dev/null; then
    echo ".env existiert bereits mit Platzhalter-Werten — fülle Secrets nach..."
  else
    echo ".env existiert bereits mit echten Werten — nichts zu tun."
    echo "Falls du neue Secrets willst: Lösche .env und führe das Skript erneut aus."
    echo "WARNUNG: neuer ENCRYPTION_KEY macht gespeicherte BL-API-Keys unlesbar."
    exit 0
  fi
else
  cp .env.example .env
  echo ".env aus .env.example angelegt."
fi

# DB_PASSWORD als hex — nur 0-9a-f, damit es in die DATABASE_URL
# (postgresql://user:pw@host:port/db) eingesetzt werden kann OHNE dass
# Sonderzeichen wie / oder + oder = die URL zerhacken (Prisma parst dann
# "xyz=@db:5432/..." als Pfad → "invalid port number").
DB_PASSWORD=$(openssl rand -hex 24)
# NEXTAUTH_SECRET + ENCRYPTION_KEY sind reine Signing/Encryption-Werte,
# stehen nie in URLs — base64 vs hex spielt keine Rolle
NEXTAUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Portable sed (funktioniert unter GNU sed + BSD/macOS sed)
sed_i() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

sed_i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|"       .env
sed_i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${NEXTAUTH_SECRET}|" .env
sed_i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|"    .env

echo ""
echo "Fertig. Drei Secrets in .env gesetzt:"
echo "  DB_PASSWORD, NEXTAUTH_SECRET, ENCRYPTION_KEY"
echo ""
echo "WICHTIG: Sichere den ENCRYPTION_KEY (Passwortmanager)."
echo "         Verlust macht später gespeicherte BL-API-Zugangsdaten unlesbar."
echo ""
echo "Nächster Schritt:  docker compose up -d --build"
