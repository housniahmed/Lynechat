#!/usr/bin/env bash
# Installation / mise à jour de Lynechat (version web) sur un serveur Ubuntu 22.04 ou 24.04
# (testé pour Oracle Cloud « Always Free », fonctionne aussi sur Lightsail, Hetzner, OVH…).
#
#   sudo bash install.sh mail.mondomaine.com
#
# Relancer la même commande avec une nouvelle version met à jour l'application
# sans toucher aux données ni au mot de passe.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/lynechat
DATA_DIR=/var/lib/lynechat
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR="${NODE_MAJOR:-24}"
PORT=3000

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Lancez ce script avec sudo : sudo bash $0 mail.mondomaine.com"
[[ -n "$DOMAIN" ]] || die "Indiquez le sous-domaine : sudo bash $0 mail.mondomaine.com"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]] || die "Nom de domaine invalide : $DOMAIN"
[[ -f "$SRC_DIR/server/server.js" ]] || die "Lancez ce script depuis le dossier lynechat décompressé (deploy/install.sh)."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || warn "Système non testé (${PRETTY_NAME:-inconnu}). Ubuntu 22.04 ou 24.04 recommandé."

export DEBIAN_FRONTEND=noninteractive

# ---------- 1. Mémoire d'appoint (instances 1 Go) ----------
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if (( MEM_MB < 2000 )) && ! swapon --show | grep -q .; then
  say "Création d'un fichier d'échange de 2 Go (mémoire du serveur : ${MEM_MB} Mo)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 2. Paquets système ----------
say "Mise à jour du système et installation des outils"
apt-get update -y
apt-get install -y ca-certificates curl gnupg sqlite3 unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https dnsutils

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NODE_MAJOR ]]; then
  say "Installation de Node.js $NODE_MAJOR"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
node -e "require('node:sqlite')" 2>/dev/null || die "La version de Node.js installée ne fournit pas node:sqlite ($(node -v))."

if ! command -v caddy >/dev/null; then
  say "Installation de Caddy (HTTPS automatique)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---------- 3. Compte système et fichiers ----------
say "Installation de l'application dans $APP_DIR"
id lynechat >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin lynechat
install -d -m 0700 -o lynechat -g lynechat "$DATA_DIR" "$DATA_DIR/backups"
rm -rf "$APP_DIR.new"
install -d -m 0755 "$APP_DIR.new"
cp -r "$SRC_DIR"/{server,core,aws,app,package.json,package-lock.json} "$APP_DIR.new"/
cd "$APP_DIR.new"
npm ci --omit=dev --no-audit --no-fund --ignore-scripts
chown -R root:root "$APP_DIR.new"
rm -rf "$APP_DIR.old"
[[ -d "$APP_DIR" ]] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"

# ---------- 4. Mot de passe (première installation uniquement) ----------
if [[ ! -f "$DATA_DIR/secrets.json" ]] || ! grep -q passwordHash "$DATA_DIR/secrets.json"; then
  say "Choisissez le mot de passe de connexion à Lynechat (12 caractères minimum)"
  while true; do
    read -r -s -p "Mot de passe : " PW1; echo
    read -r -s -p "Confirmez : " PW2; echo
    if [[ "$PW1" != "$PW2" ]]; then warn "Les deux saisies diffèrent."; continue; fi
    if (( ${#PW1} < 12 )); then warn "12 caractères minimum."; continue; fi
    break
  done
  printf '%s\n' "$PW1" | sudo -u lynechat env LYNECHAT_DATA_DIR="$DATA_DIR" node "$APP_DIR/server/server.js" --set-password
  unset PW1 PW2
fi
chmod 600 "$DATA_DIR/secrets.json"

# ---------- 5. Service systemd ----------
say "Création du service lynechat"
cat > /etc/systemd/system/lynechat.service <<EOF
[Unit]
Description=Lynechat (e-mailing)
After=network-online.target
Wants=network-online.target

[Service]
User=lynechat
Group=lynechat
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=LYNECHAT_DATA_DIR=$DATA_DIR
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=NODE_NO_WARNINGS=1
ExecStart=$(command -v node) $APP_DIR/server/server.js
Restart=always
RestartSec=5
# Durcissement
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable lynechat >/dev/null
systemctl restart lynechat

# ---------- 6. Caddy : HTTPS + proxy ----------
say "Configuration HTTPS pour $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- 7. Pare-feu du serveur (Oracle Cloud bloque 80/443 par défaut) ----------
say "Ouverture des ports 80 et 443 sur le pare-feu du serveur"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
if command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null && continue
    # La règle doit passer AVANT la règle REJECT finale des images Ubuntu d'Oracle.
    n=$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT" {print $1; exit}')
    if [[ -n "$n" ]]; then iptables -I INPUT "$n" -p tcp --dport $p -m state --state NEW -j ACCEPT
    else iptables -A INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT; fi
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true
  else apt-get install -y iptables-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

# ---------- 8. Sauvegarde quotidienne de la base (14 jours) ----------
cat > /etc/cron.daily/lynechat-backup <<EOF
#!/bin/sh
f="$DATA_DIR/backups/lynechat-\$(date +%F).sqlite"
sqlite3 "$DATA_DIR/lynechat.sqlite" ".backup '\$f'" && chown lynechat:lynechat "\$f" && chmod 600 "\$f"
find "$DATA_DIR/backups" -name 'lynechat-*.sqlite' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/lynechat-backup

# Mises à jour de sécurité automatiques
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# ---------- 9. Vérifications ----------
sleep 2
systemctl is-active --quiet lynechat || { journalctl -u lynechat -n 30 --no-pager; die "Le service lynechat ne démarre pas (journal ci-dessus)."; }
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" || die "Lynechat ne répond pas sur le port $PORT."

PUBLIC_IP=$(curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || true)
DNS_IP=$(dig +short A "$DOMAIN" | tail -n1 || true)
say "Installation terminée"
echo "  Adresse      : https://$DOMAIN"
echo "  IP du serveur: ${PUBLIC_IP:-inconnue}"
if [[ -z "$DNS_IP" ]]; then
  warn "Le DNS de $DOMAIN ne pointe encore nulle part. Créez un enregistrement A : $DOMAIN -> ${PUBLIC_IP:-IP du serveur}"
elif [[ -n "$PUBLIC_IP" && "$DNS_IP" != "$PUBLIC_IP" ]]; then
  warn "Le DNS de $DOMAIN pointe vers $DNS_IP au lieu de $PUBLIC_IP. Corrigez l'enregistrement A."
else
  echo "  DNS          : OK ($DNS_IP). Le certificat HTTPS est obtenu automatiquement (1 à 2 minutes)."
fi
echo "  Journal      : sudo journalctl -u lynechat -f"
echo "  Sauvegardes  : $DATA_DIR/backups (quotidiennes, 14 jours)"
echo "  Mot de passe : printf '%s\n' 'NOUVEAU-MOT-DE-PASSE' | sudo -u lynechat env LYNECHAT_DATA_DIR=$DATA_DIR node $APP_DIR/server/server.js --set-password && sudo systemctl restart lynechat"
warn "Oracle Cloud : ouvrez aussi les ports 80 et 443 dans la « Security List » du réseau (voir le guide)."
