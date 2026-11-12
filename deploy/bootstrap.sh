#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
if [[ $EUID -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
assets=$(cd "$(dirname "$0")" && pwd)
base=/opt/resume-bot
data=/var/lib/resume-bot
domain=hh-bot.157.228.121.153.sslip.io
node_version=v22.23.1
nginx_file=/etc/nginx/conf.d/resume-bot.conf

for path in "$base" "$data" "$nginx_file" /usr/local/sbin/resume-bot-deploy /etc/systemd/system/resume-bot.service; do
  if [[ -e "$path" ]]; then echo "Already exists: $path. Stop to avoid overwriting another installation." >&2; exit 1; fi
done
if getent passwd resumebot > /dev/null; then echo 'User resumebot already exists.' >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends certbot fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2

useradd --system --home-dir "$data" --shell /usr/sbin/nologin resumebot
install -d -m 755 "$base" "$base/releases" /var/www/resume-bot-acme
install -d -m 700 -o resumebot -g resumebot "$data" "$data/backups" "$data/playwright"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
archive="node-$node_version-linux-x64.tar.xz"
curl -fsSL "https://nodejs.org/dist/$node_version/$archive" -o "$temp/$archive"
curl -fsSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$temp/SHASUMS256.txt"
(cd "$temp"; grep "  $archive\$" SHASUMS256.txt | sha256sum -c -)
install -d -m 755 "$base/node"
tar -xJf "$temp/$archive" --strip-components=1 -C "$base/node"
git init --bare --quiet "$base/repository.git"
git --git-dir="$base/repository.git" remote add origin https://github.com/YuriyDPK/resume_bot.git
install -m 755 "$assets/receive-prod.sh" /usr/local/sbin/resume-bot-deploy
install -m 644 "$assets/resume-bot.service" /etc/systemd/system/resume-bot.service
systemctl daemon-reload
systemctl enable resume-bot.service

install -d -m 700 /root/.ssh
if [[ -e /root/.ssh/resume-bot-deploy ]]; then echo 'Deploy key already exists.' >&2; exit 1; fi
ssh-keygen -q -t ed25519 -N '' -C resume-bot-prod -f /root/.ssh/resume-bot-deploy
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
printf 'restrict,command="/usr/local/sbin/resume-bot-deploy" %s\n' "$(cat /root/.ssh/resume-bot-deploy.pub)" >> /root/.ssh/authorized_keys

python3 - <<'PY' > /root/resume-bot-access.txt
import secrets
print('bot:' + secrets.token_urlsafe(24))
PY
chmod 600 /root/resume-bot-access.txt
cut -d: -f2- /root/resume-bot-access.txt | htpasswd -i -c -B /etc/nginx/resume-bot.htpasswd bot > /dev/null
chown root:www-data /etc/nginx/resume-bot.htpasswd
chmod 640 /etc/nginx/resume-bot.htpasswd

cat > "$nginx_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root /var/www/resume-bot-acme; }
    location / { return 503; }
}
EOF
if ! nginx -t; then rm -f "$nginx_file"; exit 1; fi
systemctl reload nginx
if ! certbot certonly --webroot -w /var/www/resume-bot-acme -d "$domain" --agree-tos --register-unsafely-without-email --non-interactive; then
  rm -f "$nginx_file"
  nginx -t && systemctl reload nginx
  exit 1
fi
install -m 644 "$assets/nginx.conf" "$nginx_file"
if ! nginx -t; then rm -f "$nginx_file"; nginx -t && systemctl reload nginx; exit 1; fi
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/resume-bot-reload-nginx <<'EOF'
#!/bin/sh
nginx -t && systemctl reload nginx
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/resume-bot-reload-nginx
systemctl enable --now certbot.timer
echo 'Bootstrap complete; the application will start after the first successful deployment.'
