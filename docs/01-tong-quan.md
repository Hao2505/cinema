# Tổng quan

## Sản phẩm

Rạp chiếu phim 2D trên web: màn hình lớn phía trên là **trình phát YouTube chính thức** đặt khít vào khung màn hình vẽ
trên canvas; khán phòng phía dưới, mỗi người xem điều khiển một nhân vật (không có nhân vật AI). Vào rạp chỉ cần đặt tên
+ chọn ngoại hình. Hàng chờ do người xem dán link YouTube, admin kiểm soát. Yêu cầu gốc: `../CLAUDE.md`.

## Kiến trúc

```
Trình duyệt ──HTTPS/WSS──► Cloudflare (proxy, SSL Full) ──HTTPS──► nginx (VPS, Let's Encrypt) ──► Node :3300 (pm2 "vibecinema")
   │                                                                                    │
   │ IFrame Player ◄──── video đi thẳng từ YouTube (không qua VPS)                      ├─ app.ts  HTTP tĩnh + /ws
   │                                                                                    ├─ hub.ts  phòng / người / hàng chờ
   └─ canvas khán phòng ◄── WS: frame 15 Hz, sự kiện, chat ──────────────────────────── └─ youtube.ts ──► YouTube Data API v3
```

- **Server** (`src/`, TypeScript chạy thẳng bằng `tsx`, không build): `app.ts` (file tĩnh, phiên bản tài nguyên, CSP,
  đăng nhập admin, WebSocket) → `hub.ts` (nhiều `Room`; mỗi phòng: người, hàng chờ, đồng hồ video, phiếu, chat) →
  `youtube.ts` (tách link, gọi API, luật nhận video) + `moderation.ts` (lọc tên / chat, giới hạn tốc độ, lệnh cấm) +
  `protocol.ts` (kiểm từng thông điệp client) + `config.ts` (`.env`).
- **Dùng chung server ↔ trình duyệt**: `public/js/shared/hall.js` (+ `hall.d.ts` cho TypeScript) — sơ đồ rạp, va chạm,
  ghế, 8 động tác, bảng ngoại hình hợp lệ, giới hạn. Client dự đoán và server kiểm tra **cùng một hàm** `moveWithCollision`.
- **Client** (`public/`, ES module thuần, không framework, không ảnh): `main.js` nối mọi thứ; `net.js` WebSocket;
  `store.js` trạng thái + nội suy; `me.js` nhân vật của mình; `player.js` trình phát YouTube; `render/` canvas;
  `ui/` giao diện DOM.

## Bản đồ file

| File | Việc |
|---|---|
| `src/server.ts` | điểm vào: nạp `.env`, YouTube API thật, lắng nghe, tắt êm (lưu hàng chờ) |
| `src/app.ts` | HTTP + WS; chép / chỉnh từ VibeCorp `src/server.ts` |
| `src/hub.ts` | lõi rạp (xem [02](02-giao-thuc.md)) |
| `src/youtube.ts` | xem [04](04-youtube-va-phap-ly.md) |
| `public/js/render/character.js` | nhân vật chibi đủ bộ phận — chép từ VibeCorp + thêm khung `anim`, ngồi bệt, bắp rang |
| `public/js/render/anims.js` | công thức 8 động tác |
| `public/js/render/stage.js` | bộ máy canvas: bố cục, camera, sắp lớp theo độ sâu, tên, bong bóng, emoji bay |
| `public/js/render/persp.js` | phép chiếu phối cảnh một điểm tụ, khối hộp 3D, trải thảm sàn |
| `public/js/render/hall.js` | vẽ rạp 3D (màn nhung, tường, sân khấu, ghế nhung, sàn nhảy LED, loa, quầy bar…) |
| `public/js/render/bubbles.js`, `draw.js` | chép từ VibeCorp (bong bóng chat, tên; hàm vẽ, `drawEmoji`) |
| `scripts/` | test, QA headless, bot, ảnh chia sẻ |
| `deploy/` | `deploy.sh`, nginx, (bí mật: `vps.env`, `.env.production` — không commit) |

## Quyết định mặc định (đã đề xuất, chờ chủ dự án duyệt — đổi trong `.env`)

| Việc | Mặc định | Biến |
|---|---|---|
| Độ dài tối đa / video | 15 phút (admin 240 phút) | `MAX_VIDEO_MINUTES`, `ADMIN_MAX_VIDEO_MINUTES` |
| Video live | nhận, chiếu tối đa 30 phút / lượt | `ALLOW_LIVE`, `LIVE_MAX_MINUTES` |
| Số video chờ / người | 2 | `MAX_QUEUE_PER_USER` |
| Ngưỡng bỏ qua | ≥ 50 % người có mặt, ít nhất 2 phiếu; người thêm bài bỏ qua bài mình ngay | `SKIP_VOTE_RATIO`, `SKIP_VOTE_MIN` |
| Người / phòng | 60 (rạp 130 ghế: 5 hàng × 26 + sàn nhảy 26 × 4,3 ô — đầy phòng vẫn còn hơn nửa ghế trống) | `ROOM_CAPACITY` |
| Nhiều phòng | đầy thì tự mở phòng kế, tối đa 3; **mỗi phòng hàng chờ riêng** | `MAX_ROOMS` |
| Tự gỡ khi bị báo cáo | 3 người khác nhau | `REPORT_AUTOSKIP` |
| Động tác | 8 động tác trong `hall.js` `ACTIONS` | — |
| Điện thoại | cần điều khiển ảo + chạm sàn để đi + nút 🎭 + chụm để phóng | — |

## Nguyên tắc không được phá

1. Không gì đè lên video: canvas cắt (clip) mọi thứ của khán phòng ở dưới mép màn hình; DOM (nút, tấm trượt, toast,
   vòng động tác, thẻ người) luôn đặt dưới mép màn hình (`--sheet-top`, `--aud-top`). Xem [04](04-youtube-va-phap-ly.md).
   Xem chung: không ai tua / dừng riêng (chỉ admin dừng cả phòng).
2. Video không bao giờ đi qua VPS; server chỉ giữ "đồng hồ phòng".
3. Chuỗi người dùng (tên, chat, tên video) chỉ vào DOM qua `textContent` (`util.js el()`), trên canvas qua `fillText`.
4. Không in / commit / ghi tài liệu: `ADMIN_TOKEN`, `YT_API_KEY`, thông tin VPS.
