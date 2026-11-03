# 01 · Tổng quan: ý tưởng, chức năng, kiến trúc

## 1. Ý tưởng

**VibeCinema** (https://cinema.vibe-coder.fun) là một "rạp chiếu phim 2D" trên web để **xem YouTube cùng nhau** — kiểu
đi chùa / quẩy bar online. Phía trên là màn hình lớn: **trình phát YouTube chính thức** đặt khít vào khung màn hình vẽ
trên canvas. Phía dưới là khán phòng vẽ phối cảnh (sàn hẹp dần về màn hình, ghế, sàn nhảy). **Mỗi người xem điều khiển
một nhân vật** (không có nhân vật AI): đi lại, ngồi ghế, nhảy, vỗ tay, thả tim, chat bong bóng trên đầu. Ai cũng dán được
link YouTube vào hàng chờ; **cả rạp xem cùng một chỗ trong video** — không ai tua / dừng riêng.

Ba điều chủ dự án đặt nặng: **mượt** (không giật), **đúng luật YouTube** (không che, không chặn quảng cáo, chỉ video
được phép nhúng), **giao diện đẹp, rõ, tiếng Việt có dấu**. Vào chơi chỉ cần đặt tên, không đăng nhập.

Dự án anh em: VibeCorp (`../agent_office`, https://corp.vibe-coder.fun) — nhân vật, hàm vẽ, phục vụ file tĩnh, mẫu
deploy được chép sang rồi chỉnh. Yêu cầu gốc: `CLAUDE.md`.

## 2. Chức năng hiện có

**Vào rạp & nhân vật**
- Mở trang là **đứng xem ngoài cửa**: thấy rạp sống phía sau màn vào rạp (người đi lại, chat, đang chiếu gì).
- Chọn rạp (4 thẻ, xem trước ngay phía sau), đặt tên 2–20 ký tự (lọc bậy, chặn link, chặn tên dành riêng như "admin"),
  chọn ngoại hình: dáng **Nam / Nữ**, 7 màu da, 8 kiểu tóc, 10 màu tóc, 14 màu áo, 7 màu quần, 6 phụ kiện, râu (nam). 🎲
  Ngẫu nhiên; nhân vật xem trước động. Đổi ngoại hình sau khi vào: 🎨.
- **Người quay lại**: đã từng vào rạp trên máy này → mở trang thấy thẻ "Chào mừng quay lại 👋" (chân dung nhân vật, danh
  sách phòng kèm số người + đang chiếu gì, phòng lần trước lên đầu) — bấm một phòng là vào ngay bằng tên + nhân vật đã
  nhớ; "✏️ Đổi tên / nhân vật" để về màn đầy đủ. Link `/?phong=<id>` hoặc vừa đổi rạp → tự vào luôn.
- Rớt mạng (đổi wifi ↔ 4G, F5) → tự nối lại **đúng nhân vật** trong 15 s.

**4 rạp, nhiều phòng**
- 🎭 Rạp Nhung Đỏ (trong nhà, mặc định) · 🌳 Rạp Công Viên · 🚗 Rạp Đỗ Xe · 🏖️ Rạp Bãi Biển. Mỗi rạp một khung cảnh, một
  phòng cố định với **màn hình + hàng chờ + chat riêng**; chung sơ đồ đi lại (34 × 16 ô, 130 ghế trong 5 hàng, sàn nhảy
  lớn) — chỉ khác cách vẽ.
- 60 người / phòng; rạp đầy thì tự mở bản sao "Rạp … 2", "… 3" (tối đa `MAX_ROOMS` mỗi rạp), bỏ trống 10 phút thì đóng.
  Đổi rạp bằng ô tên rạp góc trên trái; link thẳng `/?phong=bien`.

**Đi lại & động tác**
- `WASD` / mũi tên, bấm sàn để đi tới, bấm ghế để ngồi; dừng sát ghế là tự ngồi (quay lên màn hình). Điện thoại: cần
  điều khiển ảo, chạm sàn / ghế, chụm hai ngón để phóng.
- 8 động tác (phím `1`–`8`, vòng chọn phím `E` / nút 🎭): 👋 Vẫy tay chào · 👏 Vỗ tay · 🕺 Nhảy hip hop · 🤘 Lắc đầu quẩy ·
  🎶 Nhún nhảy · 🍿 Ngồi xem · ❤️ Thả tim · 🤣 Cười lăn. Sàn nhảy đổi màu dưới chân người nhảy; emoji bay theo động tác.

**Chat & cảm xúc**
- Chat (`Enter` / ô trên dock): bong bóng trên đầu + khung chat (ngăn kéo; máy tính có khung chat nổi góc dưới trái).
  Không link, từ bậy bị che `***`, gửi dồn dập bị tắt tiếng 2 phút.
- 😀 thả 8 emoji cảm xúc bay lên từ đầu nhân vật; biểu cảm mặt đổi theo.

**Video**
- 📋 Hàng chờ: dán link YouTube; server kiểm qua YouTube Data API v3 — **công khai, cho nhúng, không giới hạn tuổi, xem
  được ở VN, ≤ 15 phút** (live ≤ 30 phút / lượt) — từ chối thì nói rõ lý do. Mỗi người chờ tối đa 2 video, xoá được bài
  của mình.
- **Xem chung**: "đồng hồ phòng" trên server; ẩn thanh tua / dừng của YouTube; lệch > 1 s tự tua; lỡ bấm dừng tự chạy
  lại; xem quảng cáo xong tự về đúng chỗ. Âm lượng + toàn màn hình video là nút riêng dưới màn hình.
- Bỏ phiếu bỏ qua (≥ 50 % người có mặt, ≥ 2 phiếu); người thêm bài bỏ qua bài mình ngay. Chủ kênh tắt nhúng giữa chừng →
  tự chuyển bài.
- **Kênh mặc định**: phòng trống video + hàng chờ trống quá 30 s → tự phát một kênh trực tiếp 24/7 (`DEFAULT_VIDEO`); có
  người dán link là nhường ngay; không bỏ phiếu bỏ qua được.
- 🚩 Báo cáo video (bản quyền, không phù hợp, spam…) → admin được báo ngay; 3 người (IP khác nhau) báo cáo → tự gỡ +
  chặn video.

**Giao diện**
- Rạp phủ cả cửa sổ; nút là cụm nổi nhỏ: góc trên trái 🎬 + ô phòng; góc trên phải 📺 ⛶ 🎨 ⚙️ ? 🛠; dock giữa đáy 😀 🎭
  ô chat 📋 💬. Ngăn kéo Hàng chờ + Trò chuyện: máy tính = thẻ nổi bên phải (video tự dời sang trái), điện thoại = tấm
  trượt dưới màn hình. **Không gì đè lên video** (rạp đo các cụm nút rồi tự chừa chỗ).
- 📺 Góc xem: Cân (khán phòng rộng) · **Màn lớn** (mặc định) · Màn rộng (video to nhất). ⛶ toàn màn hình cả rạp.
- Đang chiếu thì xung quanh video **tối lại** (chuyển dần); đứng yên 4 s các nút tự mờ.
- ⚙️ **Tùy chọn** (chỉ trên máy mình): mức tối, tự mờ nút, ẩn chat / bong bóng / khung chat nổi / emoji / động tác /
  tên / người khác, đèn hiệu ứng, chất lượng hình; bấm vào một nhân vật để **ẩn riêng** tin nhắn / động tác / cả người đó.
- Máy yếu tự giảm chi tiết; rạp đông vẫn ~60 khung / s trên máy tính.

**Admin** (mở trang kèm `#admin=<ADMIN_TOKEN>` một lần → cookie HttpOnly; người thường không tải file admin, không thấy
gì): ⏭ bỏ qua, ⏸ / ▶ dừng / chiếu tiếp cả phòng, 🚫 **gỡ hẳn video** (khiếu nại bản quyền), ⬆ đưa bài lên đầu, ✕ xoá
bài, 🔒 khoá hàng chờ, 🧹 xoá chat; bấm vào nhân vật: 🔇 tắt tiếng 10 phút / 1 giờ, 👢 mời ra (2 phút không vào lại),
⛔ cấm 1 ngày / vĩnh viễn; tab báo cáo, danh sách bị cấm (bỏ cấm), video bị gỡ (bỏ chặn).

**Pháp lý & riêng tư**: trang `/chinh-sach` (dùng dịch vụ YouTube, rạp lưu gì / không lưu gì, báo cáo / khiếu nại); chỉ
lưu IP đã băm; không tài khoản, không quảng cáo.

## 3. Luồng người dùng

```
Lần đầu:   Mở trang ──► đứng xem (hello) ──► chọn rạp (spec, xem trước) ──► đặt tên + ngoại hình ──► "Vào rạp 🍿" (join → welcome)
Quay lại:  Mở trang ──► thẻ "Chào mừng quay lại" ──► bấm một phòng ──► join bằng tên + nhân vật đã nhớ ──────────► welcome
           (/?phong=<id> hoặc vừa đổi rạp: tự join ngay khi nhận hello)                                          │
   ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   ▼
Trình phát bật, xem cùng giờ chung ─┬─ đi lại / ngồi ghế / động tác / emoji / chat
                                    ├─ 📋 dán link → server kiểm YouTube → vào hàng chờ / chiếu ngay
                                    ├─ ⏭ bỏ phiếu · 🚩 báo cáo · bấm nhân vật (vẫy, báo cáo, ẩn riêng)
                                    ├─ ô phòng → đổi rạp (tải lại /?phong=<id>, tự vào lại bằng tên + nhân vật cũ)
                                    └─ rớt mạng → "Mất kết nối — đang nối lại…" → tự vào lại đúng nhân vật
Bị mời ra / cấm → trình phát tắt → màn vào rạp kèm lý do (không tự nối lại)
```

Admin: mở `/#admin=<mã>` một lần → nút 🛠 hiện; công cụ admin cũng gắn vào thẻ Đang chiếu, hàng chờ, thẻ người xem.

## 4. Kiến trúc

```
Trình duyệt ──HTTPS / WSS──► Cloudflare (proxy, SSL Full) ──► nginx (VPS dùng chung, Let's Encrypt) ──► Node :3300 (pm2 "vibecinema")
   │                                                                                                   │
   │ IFrame Player ◄──── video đi thẳng từ YouTube (KHÔNG qua VPS)                                       ├─ app.ts   HTTP tĩnh + /api + /ws
   │                                                                                                   ├─ hub.ts   rạp / phòng / người / hàng chờ / đồng hồ
   └─ canvas khán phòng ◄── WS JSON: frame 30 Hz, sự kiện, chat, đồng hồ phòng ───────────────────────── ├─ youtube.ts ──► YouTube Data API v3 / oEmbed
                                                                                                       └─ data/  rooms.json · bans.json · reports.jsonl
```

- **Server** (`src/`, [07](07-server.md)): một tiến trình, trạng thái trong bộ nhớ, vài file JSON. Server là "trọng tài":
  kiểm mọi thông điệp, giữ đồng hồ phòng, hàng chờ, luật video, kiểm duyệt, quyền admin.
- **Dùng chung** `public/js/shared/hall.js` (+ `hall.d.ts`): sơ đồ rạp, va chạm, ghế, động tác, emoji, ngoại hình hợp
  lệ, danh sách rạp. Client dự đoán và server kiểm tra **cùng một hàm** `moveWithCollision`.
- **Client** (`public/`, [03](03-frontend.md)): ES module thuần + Canvas 2D; `main.js` nối `net` / `store` / `me` /
  `player` / `render` / `ui`.
- **Giao thức**: JSON qua WebSocket ([02](02-giao-thuc.md)). Bản đồ file đầy đủ: [00](00-ban-do-ma-nguon.md).

## 5. Công nghệ

| Phần | Dùng | Ghi chú |
|---|---|---|
| Runtime | Node ≥ 20, TypeScript strict ESM chạy bằng `tsx` | không bước build; `npm start` = `tsx src/server.ts` |
| Thư viện server | `ws`, `dotenv` | cố ý ít dependency; HTTP dùng `node:http` |
| Client | ES module thuần, Canvas 2D, DOM | không framework, không bundler, không ảnh trong giao diện (vẽ bằng code); font Be Vietnam Pro (Google Fonts) |
| Video | YouTube IFrame Player API (`youtube-nocookie.com`), YouTube Data API v3 `videos.list`, oEmbed | |
| Test / QA | `tsc --noEmit`, script `tsx` tự viết, Chrome headless qua DevTools Protocol (chỉ dùng `ws`) | không ra Internet trong `npm test` |
| Hạ tầng | VPS Ubuntu dùng chung, pm2, nginx, Cloudflare (DNS + proxy + SSL Full), Let's Encrypt (certbot webroot) | [05](05-van-hanh-deploy.md) |

## 6. Quyết định chính & lý do

| Quyết định | Lý do |
|---|---|
| Video phát bằng **trình phát chính thức**, server chỉ giữ đồng hồ | pháp lý (không tải / phát lại), băng thông VPS bằng 0 cho video |
| **Không chặn bấm** vào khung video; lỡ dừng thì tự chạy lại | Điều khoản YouTube cấm chặn chức năng / link / quảng cáo của trình phát |
| Ẩn thanh điều khiển (`controls=0`, `disablekb=1`) | "xem chung" — chủ dự án yêu cầu không ai tua / dừng riêng; là tham số chính thức |
| Client tự đi trước (dự đoán), server kiểm "ngân sách quãng đường" + va chạm | mượt ngay trên máy, vẫn chống đi xuyên tường / dịch chuyển |
| Frame mang **giờ máy người đi** + bộ đệm thích ứng phía người xem | bài học VibeCorp: giật do so le WebSocket qua Cloudflare, không phải CPU |
| Động tác là **sự kiện** ("A bắt đầu điệu X lúc T"), hoạt ảnh là hàm thuần của thời gian | gửi ít, mọi máy 60 fps cùng nhịp |
| Frame 30 Hz, chỉ người vừa đổi | băng thông nhỏ với 60 người / phòng |
| `shared/hall.js` thuần JS, server import thẳng (+ `.d.ts` viết tay) | một nguồn sự thật cho sơ đồ, luật, bảng giá trị; không cần build |
| Mọi rạp chung sơ đồ `HALL`, chủ đề chỉ đổi cách vẽ, nạp động | server không đổi khi thêm rạp; trang nhẹ; file một rạp lỗi không làm hỏng rạp khác |
| Phiên bản tài nguyên `/v/<băm>/` + `immutable` | deploy xong trình duyệt / Cloudflare lấy ngay bản mới, không cần xoá cache |
| Tắt tiếng / mời ra theo **khoá máy**, cấm theo IP chỉ 24 giờ đầu | ở VN nhiều người chung IP (4G, wifi quán) — tránh vạ lây |
| Tự gỡ / chuyển bài cần nhiều **IP khác nhau** | một người nhiều tab không đủ để phá |
| Admin bằng mã bí mật → cookie HttpOnly (băm), `#admin=` | không tài khoản; mã không vào log; người thường không thấy gì |
| Không DB; JSON ghi nguyên tử | đủ cho quy mô; deploy đơn giản; hàng chờ sống qua khởi động lại |
| Canvas phủ cả cửa sổ, DOM nổi báo chỗ chiếm (`setInsets`) | video to nhất có thể mà không bao giờ bị che |

## 7. Mặc định đang dùng (đổi trong `.env`, chủ dự án đã duyệt / có thể chỉnh)

| Việc | Mặc định | Biến |
|---|---|---|
| Độ dài tối đa / video | 15 phút (admin 240) | `MAX_VIDEO_MINUTES`, `ADMIN_MAX_VIDEO_MINUTES` |
| Video live | nhận, tối đa 30 phút / lượt | `ALLOW_LIVE`, `LIVE_MAX_MINUTES` |
| Video chờ / người | 2 | `MAX_QUEUE_PER_USER` |
| Ngưỡng bỏ qua | ≥ 50 % người có mặt, ≥ 2 phiếu; người thêm bỏ qua bài mình ngay | `SKIP_VOTE_RATIO`, `SKIP_VOTE_MIN` |
| Người / phòng | 60 (130 ghế) | `ROOM_CAPACITY` |
| Phòng / rạp | 3 (chính + 2 bản sao), mỗi phòng hàng chờ riêng | `MAX_ROOMS` |
| Tự gỡ khi bị báo cáo | 3 IP khác nhau | `REPORT_AUTOSKIP` |
| Kênh mặc định | `rFZHOHl-L8A` sau 30 s trống | `DEFAULT_VIDEO`, `DEFAULT_IDLE_SECONDS` |
| Động tác | 8 động tác trong `ACTIONS` | — |
| Điện thoại | cần ảo + chạm sàn + nút 🎭 + chụm phóng | — |

Bảng đầy đủ mọi biến: [07](07-server.md) §16.

## 8. Nguyên tắc không được phá

1. **Không gì đè lên video**: canvas cắt mọi lớp khán phòng dưới mép video; DOM nổi chừa chỗ qua `setInsets`; không chặn
   bấm / không phủ lên iframe; trình phát ≥ 200×200. Xem [04](04-youtube-va-phap-ly.md).
2. Video không bao giờ đi qua VPS; chỉ nhận video được phép (`checkMeta`); không chặn quảng cáo.
3. Chuỗi người dùng chỉ vào DOM qua `textContent` (`util.js el()` / `setText`), trên canvas qua `fillText`.
4. Không in / commit / ghi vào tài liệu: `ADMIN_TOKEN`, `YT_API_KEY`, thông tin VPS (`deploy/vps.env`,
   `deploy/.env.production`, `.env`).
5. VPS dùng chung: không đụng app khác; tên riêng cho mọi thứ; `nginx -t` trước khi reload. Chỉ deploy khi chủ dự án bảo.
6. Mọi chữ người xem thấy là tiếng Việt có dấu; không dùng chữ "ke" trên giao diện (động tác "Lắc đầu quẩy").
7. `npm test` xanh + QA hình trước khi báo xong.
