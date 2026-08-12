# Deployment Guide — Netcup VPS (Production)

Komplette Anleitung für ein sicheres, DSGVO-konformes Deployment auf einem Netcup VPS.

## Voraussetzungen

- Netcup VPS (z.B. RS 1000, Debian 12 oder Ubuntu 22.04)
- Domain mit DNS A-Record auf VPS-IP
- SSH-Zugang als root

## Checkliste

```
[ ] 1. VPS bestellen, DNS A-Record setzen
[ ] 2. SSH als root, deploy-User anlegen
[ ] 3. SSH härten (Key-only, kein Root-Login)
[ ] 4. Firewall (UFW): nur 22, 80, 443
[ ] 5. fail2ban installieren
[ ] 6. Automatische Sicherheitsupdates
[ ] 7. PostgreSQL installieren + konfigurieren
[ ] 8. Redis installieren + Passwort setzen
[ ] 9. Node.js 20 installieren
[ ] 10. nginx + certbot installieren
[ ] 11. SSL-Zertifikat holen
[ ] 12. Secrets generieren + .env erstellen
[ ] 13. App klonen, Dependencies, Prisma, Build
[ ] 14. systemd Services einrichten (Web + Crawler + Scheduler)
[ ] 15. Backup-Cron einrichten
[ ] 16. Health-Check-Cron einrichten
[ ] 17. Externen Uptime-Monitor einrichten
[ ] 18. Ersten User registrieren + testen
```

---

## 1. Server-Härtung

### Deploy-User anlegen

```bash
adduser --disabled-password --gecos "BL Price Tracker" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

### SSH härten

```bash
cat > /etc/ssh/sshd_config.d/hardening.conf << 'EOF'
PasswordAuthentication no
PermitRootLogin no
AllowUsers deploy
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
EOF
sshd -t && systemctl restart sshd
```

**WICHTIG**: Vorher in einem zweiten Terminal testen ob SSH als `deploy` funktioniert!

### Firewall

```bash
apt install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

### fail2ban

```bash
apt install -y fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 3600

[nginx-limit-req]
enabled = true
logpath = /var/log/nginx/error.log
maxretry = 10
bantime = 600
EOF
systemctl enable fail2ban && systemctl restart fail2ban
```

### Automatische Updates

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 2. PostgreSQL

```bash
apt install -y postgresql-15
sudo -u postgres psql << 'EOF'
CREATE USER pricetracker WITH PASSWORD 'STARKES_PASSWORT_HIER';
CREATE DATABASE pricetracker OWNER pricetracker;
ALTER USER pricetracker NOSUPERUSER NOCREATEDB CONNECTION LIMIT 20;
EOF
```

In `/etc/postgresql/15/main/postgresql.conf`:
```
listen_addresses = 'localhost'
max_connections = 50
```

---

## 3. Redis

```bash
apt install -y redis-server
```

In `/etc/redis/redis.conf`:
```
bind 127.0.0.1 ::1
requirepass STARKES_REDIS_PASSWORT
maxmemory 256mb
maxmemory-policy allkeys-lru
```

---

## 4. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

---

## 5. Secrets generieren

```bash
echo "DB_PASSWORD:"; openssl rand -base64 32
echo "REDIS_PASSWORD:"; openssl rand -base64 32
echo "NEXTAUTH_SECRET:"; node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
echo "ENCRYPTION_KEY:"; node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### .env erstellen

```bash
cat > /home/deploy/app/.env << 'EOF'
DATABASE_URL=postgresql://pricetracker:DB_PASSWORT@localhost:5432/pricetracker
REDIS_URL=redis://:REDIS_PASSWORT@localhost:6379
NEXTAUTH_SECRET=DEIN_64BYTE_HEX
NEXTAUTH_URL=https://deine-domain.de
ENCRYPTION_KEY=DEIN_64CHAR_HEX
NODE_ENV=production
EOF
chmod 600 /home/deploy/app/.env
```

---

## 6. App deployen

```bash
su - deploy
git clone git@github.com:DEIN_USER/bl-price-tracker.git /home/deploy/app
cd /home/deploy/app
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
npm run build
```

---

## 7. nginx + SSL

```bash
apt install -y nginx certbot python3-certbot-nginx
certbot --nginx -d deine-domain.de --agree-tos -m deine@email.de
```

nginx-Config: siehe `/etc/nginx/sites-available/pricetracker` mit:
- HTTPS-Redirect
- Security Headers (HSTS, X-Frame-Options, CSP)
- Rate Limiting (Auth: 3/min, API: 5/s)
- Gzip Kompression
- Reverse Proxy auf localhost:3000

---

## 8. systemd Services

3 Service-Dateien in `/etc/systemd/system/`:
- `pricetracker-web.service` — Next.js auf Port 3000
- `pricetracker-crawler.service` — Crawler Worker
- `pricetracker-scheduler.service` — Scheduler Worker

```bash
systemctl daemon-reload
systemctl enable pricetracker-web pricetracker-crawler pricetracker-scheduler
systemctl start pricetracker-web pricetracker-crawler pricetracker-scheduler
```

---

## 9. Backups

Täglicher DB-Backup mit Verschlüsselung:
```bash
# Cron: 0 3 * * *
pg_dump pricetracker | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass file:~/.backup-key > backup.sql.gz.enc
```

30 Tage Aufbewahrung, automatische Bereinigung.

---

## 10. Monitoring

- Health-Check alle 5 Minuten (prüft Web, Crawler, Scheduler, DB, Redis, Disk)
- Automatischer Neustart bei Ausfall (systemd Restart=always)
- Externer Uptime-Monitor (z.B. UptimeRobot)

---

## Update deployen

```bash
ssh deploy@deine-domain.de
cd /home/deploy/app
git pull origin main
npm ci --omit=dev
npx prisma generate && npx prisma migrate deploy
npm run build
sudo systemctl restart pricetracker-web pricetracker-crawler pricetracker-scheduler
```
