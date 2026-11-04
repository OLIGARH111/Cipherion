#!/bin/sh
# Sets up the Cipherion mirror on a fresh Ubuntu 22.04+/Debian 12 server in Russia.
# Usage:  sudo sh install.sh                    (address like 1-2-3-4.sslip.io, no domain needed)
#         sudo sh install.sh chat.example.ru    (own domain, its A record must point to this server)
set -e
DOMAIN="$1"
UPSTREAM="${UPSTREAM_HOST:-cipherion-messenger.onrender.com}"
if [ -z "$DOMAIN" ]; then
  IP=$(curl -fsS4 https://ifconfig.me 2>/dev/null || curl -fsS4 https://api.ipify.org)
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
fi
apt-get update -q
apt-get install -y -q caddy curl
sed "s/MIRROR_DOMAIN/$DOMAIN/; s/UPSTREAM_HOST/$UPSTREAM/" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl restart caddy
echo
echo "Готово. Адрес зеркала: https://$DOMAIN"
echo "Теперь на Render добавьте переменную MIRROR_ORIGINS=https://$DOMAIN и перезапустите сервис."
