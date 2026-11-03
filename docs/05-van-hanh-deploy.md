# Vận hành & deploy

> Không có IP, mật khẩu, `ADMIN_TOKEN`, `YT_API_KEY` thật ở đây. Giá trị thật nằm trong `deploy/vps.env` và
> `deploy/.env.production` (cả hai trong `.gitignore`, rsync cũng loại trừ).

## 1. Production chạy ở đâu

| Thành phần | Giá trị |
|---|---|
| Tên miền | `cinema.vibe-coder.fun` (biến `DOMAIN` trong `deploy/vps.env`) |
| Máy chủ | VPS Ubuntu **dùng chung** với VibeCorp (`vibecorp`, cổng 3200) và `tokivietnam.com` (cổng 3000) — **không đụng** hai app đó |
| Thư mục | `/opt/vibecinema` (chủ: user `deploy`), dữ liệu sống ở `/opt/vibecinema/data/` |
| Tiến trình | pm2 tên **`vibecinema`**, lệnh `npm start` = `tsx src/server.ts` (không build) |
| Cổng | **3300** (`PORT` trong `.env.production` = `APP_PORT` trong script) |
| nginx | site riêng `/etc/nginx/sites-available/cinema.vibe-coder.fun` (bật `realip` CHỈ trong site này: tin `CF-Connecting-IP` khi kết nối đến từ dải IP Cloudflare, ghi `X-Real-IP` cho app, xoá `CF-Connecting-IP` client tự gửi) + `/etc/nginx/conf.d/vibecinema-limit.conf` (vùng `vcin_api` — khác tên với VibeCorp `vpa_api`: trùng tên zone là nginx lỗi cả máy). Dải IP Cloudflare lấy từ https://www.cloudflare.com/ips/ — đổi thì sửa `deploy/nginx.site.conf` rồi `--setup` lại |
| Phía trước | Cloudflare proxy, SSL **Full** (đo 2026-11-03 — ghi chú cũ "Flexible" của VibeCorp không đúng): khách vào https → Cloudflare nối cổng **443** của VPS; khách vào http → cổng 80. Site nghe cả hai; HTTPS dùng chứng chỉ Let's Encrypt riêng (`certbot certonly --webroot`, `--setup` tự lấy; `snap.certbot.renew.timer` tự gia hạn). Origin **không** redirect http → https (để Cloudflare lo). Thiếu khối 443 thì nginx rơi vào site mặc định → chuyển sang tokivietnam.com |

## 2. DNS trên Cloudflare (chủ dự án tự làm)

1. Vào https://dash.cloudflare.com → chọn tên miền **vibe-coder.fun**.
2. Menu trái **DNS → Records → Add record**.
3. **Type**: `A` · **Name**: `cinema` · **IPv4 address**: IP của VPS (giống bản ghi `corp` của VibeCorp — xem trong
   danh sách bản ghi, hoặc `deploy/vps.env` dòng `VPS_HOST`) · **Proxy status**: bật (đám mây **cam**) · **TTL**: Auto → **Save**.
4. **SSL/TLS → Overview**: để nguyên chế độ đang dùng (**Full**) — đừng đổi, VibeCorp đang chạy cùng chế độ này.
5. **SSL/TLS → Edge Certificates → Always Use HTTPS**: bật (nếu chưa) — Cloudflare ép HTTPS cho người xem.
6. Đợi 1–5 phút rồi mở `https://cinema.vibe-coder.fun/api/health` → thấy `{"ok":true,…}` là xong (sau khi đã deploy).

WebSocket qua Cloudflare chạy sẵn (mặc định bật), không cần chỉnh gì thêm.

## 3. Chuẩn bị (máy dev)

- `bash`, `ssh`, `sshpass`, `rsync`, `curl`.
- `deploy/vps.env` — chép từ VibeCorp (`../agent_office/deploy/vps.env`), đổi `DOMAIN=cinema.vibe-coder.fun`. Tên biến:
  `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_PASS`, `DOMAIN` (tuỳ chọn `APP_PORT`).
- `deploy/.env.production` — chép `.env.example`; bắt buộc: `PORT=3300`, `ADMIN_TOKEN` (≥ 12 ký tự, `openssl rand -hex 16`),
  `YT_API_KEY` (README mục "Tạo YouTube API key"), `PERSIST=true`, `SITE_URL=https://cinema.vibe-coder.fun`.
- `npm test` xanh.

## 4. `deploy/deploy.sh`

```bash
bash deploy/deploy.sh --setup   # lần đầu
bash deploy/deploy.sh           # cập nhật
bash deploy/logs.sh [số dòng]   # xem log pm2
```

| Bước | `--setup` | Việc |
|---|---|---|
| 1 | | kiểm `vps.env`, `.env.production` (`PORT` đúng 3300; cảnh báo nếu thiếu `ADMIN_TOKEN` / `YT_API_KEY`), SSH thử |
| 2 | ✓ | `ss -ltnp` kiểm cổng 3300: bị app khác dùng → **dừng**; tạo `/opt/vibecinema/data` |
| 3 | | `rsync -az --delete` mã nguồn (loại: `node_modules`, `.git`, `data/*`, `.env`, `deploy/vps.env`, `deploy/.env.production`, log) |
| 4 | | `scp .env.production` → `/opt/vibecinema/.env` (chmod 600) |
| 5 | | dưới user `deploy`: `npm install --include=dev` (cần `tsx`), `pm2 restart vibecinema` hoặc `pm2 start npm --name vibecinema -- start`, `pm2 save` |
| 6 | ✓ | ghi `conf.d/vibecinema-limit.conf` + site nginx, **`nginx -t`** — lỗi thì gỡ đúng 2 file vừa thêm, không reload; ổn thì `systemctl reload nginx`. Chưa có chứng chỉ → dựng bản chỉ HTTP, `certbot certonly --webroot -w /var/www/html -d DOMAIN`, rồi bật bản có 443 (lỗi `nginx -t` thì quay về bản chỉ HTTP) |
| 7 | ✓ | `pm2 startup` (tự chạy lại khi VPS khởi động lại) |
| 8 | | `curl` health trong VPS và qua `https://DOMAIN` |

`data/` trên VPS (hàng chờ, lệnh cấm, báo cáo, muối IP) không bao giờ bị ghi đè. Tắt server (deploy) → hàng chờ + video
đang chiếu được lưu rồi khôi phục (người xem chỉ thấy "Mất kết nối — đang nối lại…" vài giây, tự vào lại đúng nhân vật).

## 5. Admin trên production

Mở **một lần** `https://cinema.vibe-coder.fun/#admin=<ADMIN_TOKEN>` (dạng `#…` không bao giờ gửi lên máy chủ / log).
Trình duyệt nhớ 1 năm (cookie HttpOnly chứa bản băm, không chứa mã). "🚪 Thoát admin trên máy này" trong bảng 🛠.
Đổi `ADMIN_TOKEN` + deploy lại = mọi cookie admin cũ hết hiệu lực.

## 6. Sự cố thường gặp

| Triệu chứng | Kiểm tra |
|---|---|
| 502 | `bash deploy/logs.sh`; `PORT` trong `.env.production` ≠ 3300; pm2 `errored` |
| https chuyển sang tokivietnam.com | site chưa nghe cổng 443 (chưa có chứng chỉ) → `bash deploy/deploy.sh --setup` |
| "Rạp chưa cấu hình kiểm tra video" | thiếu `YT_API_KEY` trong `.env.production` → thêm rồi deploy |
| "Rạp đang lỗi cấu hình kiểm tra video" | key sai / bị giới hạn IP khác IP VPS / chưa Enable YouTube Data API v3 |
| "hết lượt kiểm tra video" | quota 10.000 / ngày đã hết (reset 0 giờ giờ Thái Bình Dương) |
| Video không chạy trên iPhone | bình thường lần đầu: bấm "▶ Bấm để xem" dưới màn hình |
| Nhân vật giật | xem `window.__vc.view().net` trên trình duyệt: `buffer` ~90–200 ms là bình thường |
| Nhiều người cùng mạng bị "Vào ra nhanh quá" | nới `JOINS_PER_MINUTE` / `MAX_CONN_PER_IP` |

Rollback: VPS không có `.git` → checkout bản cũ trên máy dev rồi `bash deploy/deploy.sh`.
