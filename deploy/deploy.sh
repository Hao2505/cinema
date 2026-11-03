#!/usr/bin/env bash
# =====================================================================
#  Deploy VibeCinema lên VPS DÙNG CHUNG với VibeCorp (Ubuntu, nginx + pm2 có sẵn).
#  Dùng:  bash deploy/deploy.sh            # cập nhật code
#         bash deploy/deploy.sh --setup    # lần đầu: kiểm cổng, tạo thư mục, site nginx + vùng giới hạn riêng
#  Cần:   deploy/vps.env (VPS_HOST, VPS_PORT, VPS_USER, VPS_PASS, DOMAIN) + deploy/.env.production — cả hai KHÔNG commit.
#  KHÔNG đụng app khác: thư mục riêng /opt/vibecinema, pm2 tên riêng "vibecinema", cổng riêng 3300, site nginx riêng,
#  file conf.d riêng (vùng limit_req tên "vcin_api"), chứng chỉ Let's Encrypt riêng cho DOMAIN. Luôn `nginx -t` trước khi
#  reload; lỗi thì quay về bản trước / gỡ đúng phần của rạp.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f deploy/vps.env ] || { echo "Thiếu deploy/vps.env"; exit 1; }
[ -f deploy/.env.production ] || { echo "Thiếu deploy/.env.production (chép .env.example, đặt PORT=3300, ADMIN_TOKEN, nên có YT_API_KEY)"; exit 1; }
set -a; . ./deploy/vps.env; set +a
export SSHPASS="$VPS_PASS"
SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -p $VPS_PORT $VPS_USER@$VPS_HOST"
APP_DIR=/opt/vibecinema
APP_NAME=vibecinema
APP_PORT="${APP_PORT:-3300}"
APP_USER=deploy
SETUP=0; [ "${1:-}" = "--setup" ] && SETUP=1

grep -q "^PORT=$APP_PORT\$" deploy/.env.production || { echo "PORT trong deploy/.env.production phải là $APP_PORT"; exit 1; }
grep -q '^ADMIN_TOKEN=.\{12,\}' deploy/.env.production || echo "⚠️  deploy/.env.production chưa có ADMIN_TOKEN (≥ 12 ký tự) — admin sẽ tắt"
grep -q '^YT_API_KEY=.\+' deploy/.env.production || echo "ℹ️  deploy/.env.production chưa có YT_API_KEY — rạp kiểm video cơ bản (oEmbed), vẫn thêm được video"

echo "▶ Kiểm tra kết nối VPS"
$SSH 'echo "  OK: $(hostname) · $(. /etc/os-release && echo $PRETTY_NAME) · node $(node -v)"'

if [ $SETUP = 1 ]; then
  echo "▶ Kiểm tra cổng $APP_PORT còn trống (ss -ltnp)"
  if $SSH "ss -ltnp | grep -q ':$APP_PORT '"; then
    if $SSH "su - $APP_USER -c 'pm2 describe $APP_NAME' >/dev/null 2>&1"; then
      echo "  cổng $APP_PORT đang do chính $APP_NAME dùng — tiếp tục"
    else
      echo "❌ Cổng $APP_PORT đang bị chương trình khác dùng — đổi APP_PORT (vps.env) + PORT (.env.production) rồi chạy lại"; exit 1
    fi
  fi
  echo "▶ Tạo thư mục $APP_DIR (chủ: $APP_USER)"
  $SSH "mkdir -p $APP_DIR/data && chown -R $APP_USER:$APP_USER $APP_DIR"
fi

echo "▶ Đồng bộ code (rsync — bỏ node_modules, dữ liệu, bí mật)"
sshpass -e rsync -az --delete \
  --exclude node_modules --exclude .git --exclude 'data/*' --exclude .env \
  --exclude deploy/vps.env --exclude deploy/.env.production --exclude docs/preview --exclude .claude \
  --exclude '*.log' --exclude '*.tmp-*' --exclude .DS_Store \
  -e "ssh -p $VPS_PORT -o StrictHostKeyChecking=accept-new" \
  ./ "$VPS_USER@$VPS_HOST:$APP_DIR/"

echo "▶ Đưa .env production lên"
sshpass -e scp -P "$VPS_PORT" -o StrictHostKeyChecking=accept-new deploy/.env.production "$VPS_USER@$VPS_HOST:$APP_DIR/.env"

echo "▶ Cài thư viện + chạy bằng pm2 (user $APP_USER, tên $APP_NAME)"
$SSH "chown -R $APP_USER:$APP_USER $APP_DIR && chmod 600 $APP_DIR/.env && su - $APP_USER -c '
  cd $APP_DIR && npm install --include=dev --no-audit --no-fund --loglevel=error &&
  (pm2 describe $APP_NAME >/dev/null 2>&1 && pm2 restart $APP_NAME --update-env || pm2 start npm --name $APP_NAME -- start) &&
  pm2 save >/dev/null && sleep 3 && pm2 ls | grep $APP_NAME'"

if [ $SETUP = 1 ]; then
  echo "▶ nginx: vùng giới hạn riêng (conf.d/vibecinema-limit.conf) + site $DOMAIN → 127.0.0.1:$APP_PORT"
  $SSH "cat > /etc/nginx/conf.d/vibecinema-limit.conf" < deploy/nginx.limit.conf
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  # $1 = 1: có HTTPS (cổng 443, cần chứng chỉ) · 0: chỉ HTTP (bỏ các dòng "# __SSL__")
  site_conf() {
    if [ "$1" = 1 ]; then sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$APP_PORT/g; s/ *# __SSL__\$//" deploy/nginx.site.conf
    else sed "/# __SSL__\$/d; s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$APP_PORT/g" deploy/nginx.site.conf; fi
  }
  apply_site() {
    site_conf "$1" | $SSH "cat > /etc/nginx/sites-available/$DOMAIN && ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN"
    $SSH "nginx -t" && $SSH "systemctl reload nginx"
  }
  # nginx -t lỗi → gỡ phần vừa thêm, KHÔNG reload (các site khác vẫn chạy cấu hình cũ)
  rollback() {
    echo "❌ nginx -t lỗi — gỡ cấu hình VibeCinema vừa thêm, không reload"
    $SSH "rm -f /etc/nginx/sites-enabled/$DOMAIN /etc/nginx/conf.d/vibecinema-limit.conf"
    exit 1
  }
  if ! $SSH "test -f $CERT"; then
    apply_site 0 || rollback
    echo "▶ Chứng chỉ HTTPS cho $DOMAIN (Let's Encrypt, webroot qua cổng 80 — Cloudflare SSL 'Full' gọi cổng 443 của VPS)"
    # --deploy-hook: gia hạn xong (mỗi ~60 ngày, snap.certbot.renew.timer) thì reload nginx để dùng chứng chỉ mới
    $SSH "certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --keep-until-expiring -q --deploy-hook 'systemctl reload nginx'" \
      || echo "⚠️  Chưa lấy được chứng chỉ — site tạm chỉ chạy HTTP (https qua Cloudflare sẽ lỗi), chạy lại --setup sau"
  fi
  if $SSH "test -f $CERT"; then
    apply_site 1 || { echo "⚠️  bản HTTPS lỗi nginx -t — quay về bản chỉ HTTP"; apply_site 0 || rollback; }
  fi
  echo "▶ pm2 tự chạy lại khi VPS khởi động lại"
  $SSH "env PATH=\$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER >/dev/null 2>&1 || true"
fi

echo "▶ Kiểm tra"
$SSH "sleep 2; curl -s -m 5 http://127.0.0.1:$APP_PORT/api/health || echo 'app chưa trả lời'"; echo
curl -s -m 10 "https://$DOMAIN/api/health" || echo "(https://$DOMAIN chưa trả lời — DNS Cloudflare đã thêm chưa?)"; echo
echo "✅ Xong. Log: bash deploy/logs.sh"
