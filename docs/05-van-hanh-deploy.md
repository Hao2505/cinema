# 05 · Vận hành & deploy

> Tài liệu này **không** chứa IP, cổng SSH, user, mật khẩu, `ADMIN_TOKEN`, `YT_API_KEY`. Giá trị thật nằm trong
> `deploy/vps.env` và `deploy/.env.production` — cả hai trong `.gitignore`, rsync cũng loại trừ. Không in / commit / chép
> chúng vào tài liệu, log, tin nhắn hay bộ nhớ của AI.
>
> **Chỉ deploy khi chủ dự án bảo.**

## 1. Production chạy ở đâu

| Thành phần | Giá trị |
|---|---|
| Tên miền | `cinema.vibe-coder.fun` (biến `DOMAIN` trong `deploy/vps.env`) |
| Máy chủ | VPS Ubuntu **dùng chung** với VibeCorp (pm2 `vibecorp`, cổng 3200) và `tokivietnam.com` (pm2, cổng 3000) |
| Thư mục | `/opt/vibecinema` (chủ: user `deploy`); dữ liệu sống ở `/opt/vibecinema/data/` |
| Tiến trình | pm2 tên **`vibecinema`**, lệnh `npm start` = `tsx src/server.ts` (không build), chạy dưới user `deploy` |
| Cổng app | **3300** (`PORT` trong `.env.production` = `APP_PORT` trong script), chỉ nghe `127.0.0.1` |
| nginx | site riêng `/etc/nginx/sites-available/cinema.vibe-coder.fun` (+ symlink `sites-enabled`) và `/etc/nginx/conf.d/vibecinema-limit.conf` (vùng `limit_req` tên **`vcin_api`**) |
| HTTPS / DNS | bản ghi `cinema` **DNS only (đám mây xám)** từ 2026-11-03 — trình duyệt nối **thẳng VPS**; nginx nghe 80 + 443 với chứng chỉ **Let's Encrypt** riêng cho `cinema.vibe-coder.fun`; app tự chuyển http → https và tự nén br / gzip. (`corp` của VibeCorp vẫn qua Cloudflare; zone đang SSL **Full (strict)**.) Vì sao bỏ Cloudflare: §3.1 |
| Mã nguồn | https://github.com/Hao2505/cinema (VPS không có `.git` — chỉ nhận file qua rsync) |

## 2. Quy tắc VPS dùng chung (không được phá)

1. **Không đụng** tiến trình pm2, site nginx, file cấu hình, chứng chỉ của `vibecorp` và `tokivietnam.com`.
2. Mọi thứ của rạp có tên riêng: thư mục `/opt/vibecinema`, pm2 `vibecinema`, cổng 3300, site `cinema.vibe-coder.fun`,
   file `conf.d/vibecinema-limit.conf`, zone `vcin_api`. **Trùng tên zone `limit_req` là nginx lỗi cả máy** (VibeCorp đã
   dùng `vpa_api` trong `/etc/nginx/conf.d/vpa-limit.conf`).
3. Luôn `nginx -t` trước khi `systemctl reload nginx` (`deploy.sh` làm sẵn); lỗi thì gỡ đúng phần của rạp, không reload.
4. Trước khi chiếm cổng mới: `ss -ltnp` kiểm còn trống (`deploy.sh --setup` làm sẵn).
5. Chuyển http → https do **app** làm (`httpsRedirectUrl` trong `src/app.ts`), không phải nginx: có header `CF-Visitor`
   (đi qua Cloudflare) thì theo giao thức của người xem trong đó — bật lại proxy ở chế độ nào (kể cả Flexible) cũng không
   thành vòng lặp; không có thì theo `X-Forwarded-Proto` của nginx. `/api/` và `/ws` không chuyển.

## 3. Đường đi của một request

```
Trình duyệt ──https / wss (DNS only: nối THẲNG VPS, không qua Cloudflare)──┐
                                                                         ▼
                       nginx site cinema.vibe-coder.fun
                         ├─ realip: CHỈ tin CF-Connecting-IP khi kết nối đến từ dải IP Cloudflare
                         ├─ /.well-known/acme-challenge/ → /var/www/html (certbot)
                         ├─ = /ws   → 127.0.0.1:3300 (Upgrade, đọc / ghi 3600 s, không buffer, không access log)
                         ├─ /api/   → 127.0.0.1:3300 + limit_req zone=vcin_api (2 r/s / IP, burst 10, 429)
                         └─ /       → 127.0.0.1:3300 (?admin=… thì tắt access log)
                         mọi location ghi X-Real-IP = IP thật, XOÁ CF-Connecting-IP client tự gửi, X-Forwarded-Proto
                               ▼
                       Node (pm2 "vibecinema") — app.ts tin X-Real-IP trước (TRUST_PROXY=true)
Video: trình duyệt ◄── YouTube trực tiếp (không qua VPS)
```

Nhờ realip chỉ tin dải IP Cloudflare, ai gọi thẳng IP VPS kèm header giả vẫn bị tính đúng IP của họ (giờ đi thẳng nên
`X-Real-IP` = IP thật luôn; giữ cấu hình realip để lỡ bật lại proxy vẫn đúng). Dải IP lấy từ
https://www.cloudflare.com/ips/ — Cloudflare đổi thì sửa `deploy/nginx.site.conf` rồi chạy lại `--setup`.

### 3.1. Vì sao `cinema` không đi qua Cloudflare (đo 2026-11-03 từ mạng nhà chủ dự án ở VN)

| Đường | RTT WebSocket (ping/pong 20 lần/s, 60 s) | Khựng > 200 ms | Mở trang (TTFB) |
|---|---|---|---|
| Qua Cloudflare (proxy cam) | min 439 · p50 443 · max 843 ms | 6 lần / phút, tới 400 ms (chiều lên) | 0,5–1,9 s |
| Thẳng VPS (DNS only) | min 6 · p50 8 · max 79 ms | 0 | 0,03 s |

Cloudflare gói miễn phí đưa khách VN sang PoP **xa** (đo được `colo=NRT` Tokyo, có lần `WAW` Warsaw) rồi mới vòng về VPS
ở VN → mỗi gói vị trí đi 2 lần ra nước ngoài. Đánh đổi khi tắt proxy: IP VPS lộ ra (mọi app trên máy này gọi thẳng được),
mất lớp chống DDoS của Cloudflare cho `cinema`. Bị tấn công thì bật lại đám mây cam (1 cú bấm; app vẫn chạy đúng — realip,
chuyển https không vòng lặp, WebSocket qua Cloudflare chỉ chậm hơn). Script đo: chạy ping/pong `{t:'ping',c}` qua
`wss://…/ws` và tách trễ chiều lên / xuống bằng giờ server `s` trong `pong` (xem docs/02).

## 4. DNS trên Cloudflare (chủ dự án tự làm — đã làm cho production)

1. https://dash.cloudflare.com → tên miền **vibe-coder.fun** → **DNS → Records → Add record**.
2. **Type** `A` · **Name** `cinema` · **IPv4** = IP của VPS (giống bản ghi `corp` của VibeCorp; hoặc `VPS_HOST` trong
   `deploy/vps.env`) · **Proxy status** **tắt** (đám mây **xám**, "DNS only" — §3.1) · **TTL** Auto → **Save**.
   Lần đầu dựng (`--setup` lấy chứng chỉ qua cổng 80) cam hay xám đều được.
3. **SSL/TLS → Overview**: zone đang **Full (strict)** (chủ dự án đổi 2026-11-03) — chỉ ảnh hưởng bản ghi cam (`corp`).
   Đừng đổi về **Flexible** khi `corp` còn cam (VibeCorp không chuyển https ở origin nên không vòng lặp, nhưng mất mã hoá
   đoạn Cloudflare → VPS).
4. http → https: app tự chuyển (§2 mục 5); "Always Use HTTPS" của Cloudflare chỉ có tác dụng khi bật lại proxy.
5. Đợi 1–5 phút, mở `https://cinema.vibe-coder.fun/api/health` → thấy `{"ok":true,…}`.

## 5. Chuẩn bị trên máy dev

- Công cụ: `bash`, `ssh`, `sshpass`, `rsync`, `curl`.
- `deploy/vps.env` (chép từ `../agent_office/deploy/vps.env`, đổi `DOMAIN=cinema.vibe-coder.fun`): biến `VPS_HOST`,
  `VPS_PORT`, `VPS_USER`, `VPS_PASS`, `DOMAIN`, tuỳ chọn `APP_PORT`.
- `deploy/.env.production` (chép `.env.example`): bắt buộc `PORT=3300`; nên có `ADMIN_TOKEN` (≥ 12 ký tự, `openssl rand
  -hex 16`), `YT_API_KEY`, `PERSIST=true`, `SITE_URL=https://cinema.vibe-coder.fun`. Các biến khác: bảng ở
  [07](07-server.md) §16.
- `npm test` xanh.

## 6. `deploy/deploy.sh`

```bash
bash deploy/deploy.sh --setup   # lần đầu, hoặc khi đổi nginx.site.conf / nginx.limit.conf / cần lấy lại chứng chỉ
bash deploy/deploy.sh           # cập nhật code (các lần sau)
bash deploy/logs.sh [số dòng]   # 50 dòng log pm2 cuối (mặc định)
```

| Bước | Chỉ `--setup` | Việc |
|---|---|---|
| 1 | | kiểm có `vps.env`, `.env.production`; `PORT` đúng `APP_PORT` (3300) — sai thì dừng; cảnh báo nếu thiếu `ADMIN_TOKEN` / `YT_API_KEY`; SSH thử (in hostname, phiên bản OS, node) |
| 2 | ✓ | `ss -ltnp` kiểm cổng 3300: đang bị app **khác** dùng → dừng; tạo `/opt/vibecinema/data`, chown `deploy` |
| 3 | | `rsync -az --delete` mã nguồn, loại: `node_modules`, `.git`, `data/*`, `.env`, `deploy/vps.env`, `deploy/.env.production`, `docs/preview`, `.claude`, `*.log`, `*.tmp-*`, `.DS_Store` |
| 4 | | `scp deploy/.env.production` → `/opt/vibecinema/.env` (chmod 600) |
| 5 | | dưới user `deploy`: `npm install --include=dev` (cần `tsx`, `typescript` là devDependency), `pm2 restart vibecinema --update-env` hoặc lần đầu `pm2 start npm --name vibecinema -- start`, `pm2 save`, in `pm2 ls` |
| 6 | ✓ | ghi `conf.d/vibecinema-limit.conf`; chưa có chứng chỉ → dựng site **chỉ HTTP** (bỏ các dòng `# __SSL__`), `nginx -t && reload`, rồi `certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --keep-until-expiring`; có chứng chỉ → dựng site **có 443** (`nginx -t` lỗi → quay về bản chỉ HTTP). Mọi lần `nginx -t` lỗi mà không quay về được → gỡ `sites-enabled/$DOMAIN` + `conf.d/vibecinema-limit.conf`, **không reload**, thoát |
| 7 | ✓ | `pm2 startup systemd -u deploy` (tự chạy lại khi VPS khởi động lại) |
| 8 | | `curl` `/api/health` trong VPS (127.0.0.1:3300) và qua `https://$DOMAIN` |

- `data/` trên VPS (hàng chờ, video bị gỡ, lệnh cấm, báo cáo, muối IP) **không bao giờ bị ghi đè** (rsync loại trừ).
- Tắt server khi deploy (pm2 gửi `SIGINT`) → `rooms.json` được lưu rồi khôi phục: người xem thấy "Mất kết nối — đang nối
  lại…" vài giây rồi tự vào lại (nhân vật mới cùng tên + ngoại hình, video đang chiếu tiếp đúng chỗ).
- Phiên bản tài nguyên đổi theo file → trình duyệt tự tải JS / CSS mới (không có cache Cloudflare nào cần xoá).
- App tự nén br (mức 7) / gzip cho JS, CSS, HTML, JSON… (public/ 592 KB → 190 KB), giữ bản nén trong bộ nhớ theo mtime.
- Site nginx chỉ được ghi khi `--setup`; deploy thường không đụng nginx.

## 7. nginx

- `deploy/nginx.site.conf` là mẫu: `__DOMAIN__`, `__PORT__` được `sed` thay; dòng có `# __SSL__` (listen 443,
  `ssl_certificate`, `include /etc/letsencrypt/options-ssl-nginx.conf`, `ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem`)
  bị bỏ khi chưa có chứng chỉ. Hai file `options-ssl-nginx.conf` / `ssl-dhparams.pem` phải có sẵn trên VPS (thường do
  certbot tạo; thiếu thì `nginx -t` lỗi và script quay về bản chỉ HTTP).
- `deploy/nginx.limit.conf` → `/etc/nginx/conf.d/vibecinema-limit.conf`:
  `limit_req_zone $binary_remote_addr zone=vcin_api:10m rate=2r/s;` (phải nằm trong khối `http{}` nên để ở `conf.d`).
- `X-Forwarded-Proto $scheme` cho app biết request là https (cookie admin thêm `Secure`).

## 8. Chứng chỉ HTTPS & gia hạn

- `--setup` tự lấy chứng chỉ bằng **webroot** (`/var/www/html`, qua cổng 80) cho riêng `cinema.vibe-coder.fun` — không
  đụng chứng chỉ của site khác.
- Gia hạn tự động bằng timer certbot trên VPS (`snap.certbot.renew.timer` — theo ghi chú vận hành, kiểm bằng
  `systemctl list-timers | grep certbot`). Vì dùng webroot, sau khi gia hạn nginx phải **reload** mới dùng chứng chỉ mới:
  kiểm có deploy hook (`/etc/letsencrypt/renewal-hooks/deploy/`) reload nginx; chưa có thì thêm, hoặc reload tay sau
  mỗi lần gia hạn (~60 ngày). Thử: `certbot renew --dry-run`.
- Chứng chỉ Let's Encrypt giờ là chứng chỉ người xem thấy trực tiếp (DNS only) → hỏng / hết hạn là **trang lỗi ngay**.
  certbot tự gia hạn (timer + `--deploy-hook 'systemctl reload nginx'`); kiểm: `certbot certificates` trên VPS.

## 9. Biến môi trường production

`deploy/.env.production` → `/opt/vibecinema/.env`, `dotenv` đọc khi khởi động (biến môi trường có sẵn thắng `.env`).
Đổi biến → sửa file này rồi `bash deploy/deploy.sh` (pm2 restart). Bảng đầy đủ: [07](07-server.md) §16. Quan trọng:

| Biến | Production |
|---|---|
| `PORT` | 3300 (bắt buộc) |
| `HOST` | `127.0.0.1` (mặc định — chỉ nginx gọi được) |
| `SITE_URL` | `https://cinema.vibe-coder.fun` |
| `ADMIN_TOKEN`, `YT_API_KEY` | bí mật — chỉ ở file này |
| `TRUST_PROXY` | `true` (đứng sau nginx; tin `X-Real-IP` / `X-Forwarded-Proto` nginx ghi) |
| `PERSIST`, `DATA_DIR` | `true`, `data` |
| `DEFAULT_VIDEO`, `DEFAULT_IDLE_SECONDS` | kênh trực tiếp mặc định, 30 |

Đổi `ADMIN_TOKEN` = mọi cookie admin cũ hết hiệu lực. Đổi `IP_SALT` (hoặc xoá `data/ip-salt.txt`) = lệnh cấm theo IP cũ
mất tác dụng (lệnh cấm theo khoá máy vẫn còn).

## 10. Dữ liệu sống — `/opt/vibecinema/data/`

`rooms.json` (hàng chờ + video đang chiếu + video bị gỡ + bộ đếm id), `bans.json`, `reports.jsonl` (mỗi dòng một báo cáo
— chứa tên tự đặt + ghi chú người báo cáo), `ip-salt.txt`. Quyền 600, chủ `deploy`. Sao lưu: chép cả thư mục. Xem
báo cáo cũ: `tail -n 50 /opt/vibecinema/data/reports.jsonl` trên VPS (tab Báo cáo của admin chỉ giữ 100 báo cáo gần
nhất trong bộ nhớ). Chi tiết định dạng: [07](07-server.md) §14.

## 11. Log & theo dõi

- `bash deploy/logs.sh [n]` = `pm2 logs vibecinema --lines n --nostream` (không in thông tin đăng nhập).
- Log có: banner khởi động (luật video, số phòng, nơi lưu, admin bật / tắt — không in mã), video mặc định (đã kiểm / bị
  tắt), báo cáo (`🚩 …`), admin gỡ video, video lỗi trình phát, lỗi YouTube API (lý do, không có key), lỗi ghi dữ liệu,
  đăng nhập admin sai mã (không ghi mã), lỗi không bắt được.
- `GET /api/health` → `{ ok, rooms, viewers, players, playing, yt }` — `yt: false` = thiếu `YT_API_KEY`.

## 12. Admin trên production

Mở **một lần** `https://cinema.vibe-coder.fun/#admin=<ADMIN_TOKEN>` (phần `#…` không bao giờ gửi lên máy chủ / log;
dạng cũ `?admin=` vẫn chạy và nginx tắt access log cho nó). Trình duyệt nhớ 1 năm bằng cookie HttpOnly chứa bản băm.
"🚪 Thoát admin trên máy này" trong bảng 🛠. Cách dùng bảng admin: [01](01-tong-quan.md) §2.

## 13. Sự cố thường gặp

| Triệu chứng | Kiểm tra |
|---|---|
| 502 Bad Gateway | `bash deploy/logs.sh`; pm2 `errored`?; `PORT` trong `.env.production` ≠ 3300 |
| https chuyển sang site khác (tokivietnam.com) | site chưa nghe 443 (chưa có chứng chỉ) → `bash deploy/deploy.sh --setup` |
| "Rạp chưa cấu hình kiểm tra video" | thiếu `YT_API_KEY` trong `.env.production` → thêm rồi deploy |
| "Rạp đang lỗi cấu hình kiểm tra video" | key sai / giới hạn IP khác IP VPS / chưa Enable YouTube Data API v3 (log ghi lý do) |
| "hết lượt kiểm tra video" | quota 10.000 / ngày đã hết (reset 0 giờ giờ Thái Bình Dương) |
| Kênh mặc định không phát | log "Video mặc định … không phát được / không đạt luật" → đổi `DEFAULT_VIDEO`; hoặc bị admin gỡ (bỏ chặn trong 🛠) |
| Video không chạy trên iPhone | bình thường lần đầu: bấm "▶ Bấm để xem" dưới màn hình |
| Nhân vật giật | trên trình duyệt: `window.__vc.view().net` — `buffer` ~90–200 ms là bình thường |
| Nhiều người cùng mạng bị "Vào ra nhanh quá" / không nối được | nới `JOINS_PER_MINUTE` / `MAX_CONN_PER_IP` |
| Sửa CSS / JS mà trình duyệt vẫn bản cũ (máy dev) | khởi động lại server (phiên bản tài nguyên tính lúc khởi động) |
| `nginx -t` lỗi sau `--setup` | script đã gỡ phần của rạp và không reload; đọc lỗi, sửa `deploy/nginx.*.conf`, chạy lại |

## 14. Rollback

VPS không có `.git`. Trên máy dev: `git checkout <commit / tag cũ>` → `bash deploy/deploy.sh` → `git checkout main`.
`rsync --delete` thay toàn bộ mã nhưng **giữ `data/`**. Bản cũ đọc `rooms.json` của bản mới: mục không hiểu bị bỏ qua
(nạp phòng thủ). Đổi nginx thì rollback cả `deploy/nginx.*.conf` rồi `--setup`.
