# AGENTS.md — hướng dẫn cho AI coding agent

**VibeCinema** (https://cinema.vibe-coder.fun, repo https://github.com/Hao2505/cinema): rạp chiếu phim 2D xem YouTube
cùng nhau. Trình phát YouTube **chính thức** đặt khít vào màn hình vẽ trên canvas; khán phòng phối cảnh phía dưới; mỗi
người xem điều khiển một nhân vật (tên + ngoại hình, không đăng nhập), đi lại, 8 động tác, chat bong bóng, emoji; hàng
chờ do người xem dán link (server kiểm bằng YouTube Data API); cả phòng xem cùng một "đồng hồ phòng"; 4 rạp (cùng sơ đồ,
khác hình), mỗi rạp nhiều phòng; admin bằng mã bí mật → cookie HttpOnly.

Yêu cầu gốc của chủ dự án: `CLAUDE.md` (đọc trước). Tài liệu chi tiết: `docs/README.md`.

## Luật vàng (không được phá)

1. **Bí mật**: không đọc, in, commit hay chép vào tài liệu / log / tin nhắn nội dung `.env`, `deploy/vps.env`,
   `deploy/.env.production`; không ghi IP / cổng / user / mật khẩu VPS, `ADMIN_TOKEN`, `YT_API_KEY` ở bất cứ đâu — chỉ
   nhắc tên biến.
2. **Luật YouTube**: không gì (DOM hay canvas) được nằm trên khung video `#screen-slot`; không chặn bấm / phủ lên iframe;
   không đụng quảng cáo; trình phát ≥ 200×200; chỉ dùng tham số / hàm IFrame API có tài liệu; chỉ nhận video công khai,
   cho nhúng, không 18+, xem được ở VN; video không bao giờ đi qua server. Xem `docs/04-youtube-va-phap-ly.md`.
3. **VPS dùng chung** với app khác (`vibecorp`, `tokivietnam.com`): không đụng tiến trình / site nginx / cấu hình của
   chúng; mọi thứ của rạp có tên riêng (`/opt/vibecinema`, pm2 `vibecinema`, cổng 3300, zone `vcin_api`); luôn
   `nginx -t` trước khi reload.
4. **Chỉ deploy, commit, push khi chủ dự án bảo.** Không `git add -A` mù — thêm đúng file. Commit tiếng Anh
   `<area>: <description>`, cuối thân commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. Chuỗi từ người dùng / server chỉ vào DOM qua `textContent` (`public/js/util.js el()`, `setText`) — không `innerHTML`.
6. Mọi chữ người xem thấy là **tiếng Việt có dấu**; tên file / hàm / biến tiếng Anh. Không dùng chữ "ke" trên giao diện.
7. `npm test` xanh (và QA hình nếu đổi giao diện) trước khi báo xong. Test không bao giờ ra Internet.
8. Ít dependency (chỉ `ws`, `dotenv`), không bước build, không framework, không ảnh trong giao diện (vẽ bằng code).

## Lệnh

```bash
npm install
npm test                                   # typecheck + 24 test đơn vị + 35 bước smoke (~15 s, không Internet)
npm run dev                                # server thật :3300 (cần .env: ADMIN_TOKEN, YT_API_KEY)
npx tsx scripts/qa-server.ts               # server QA :3399, YouTube giả, admin: http://localhost:3399/#admin=qa-local-admin
npx tsx scripts/bots.ts --url ws://localhost:3399/ws --n 10 --video aqz-KE-bpKQ [--room bien]   # người xem giả
npm run qa -- --out /tmp/vc-shots [--only desktop|mobile|smooth] [--room bien] [--bunch]   # Chrome headless: ảnh, chồng lấn video, độ mượt
npx tsx scripts/qa-characters.ts --url http://localhost:3399 --out /tmp/vc-chars                 # soi nhân vật / động tác
npm run share-images -- --url http://localhost:3399 --room congvien   # vẽ lại ảnh chia sẻ + icon (cần server QA + bot)
npm run seo-check -- --url https://cinema.vibe-coder.fun          # kiểm SEO / xem trước chia sẻ (docs/06 §8)
bash deploy/deploy.sh [--setup]            # CHỈ khi chủ dự án bảo — xem docs/05
```

Sửa file trong `public/` xong phải **khởi động lại server** (JS / CSS phục vụ dưới `/v/<băm lúc khởi động>/`, cache
`immutable`).

## Ở đâu

- Bản đồ đầy đủ + bảng "muốn sửa X thì vào đâu": `docs/00-ban-do-ma-nguon.md`.
- `src/` — server TypeScript (`tsx`): `server.ts` (điểm vào) → `app.ts` (HTTP, CSP, cookie admin, `/ws`) → `hub.ts`
  (Hub / Room: toàn bộ nghiệp vụ) + `protocol.ts` (kiểm thông điệp) + `types.ts` (giao thức) + `config.ts` (biến môi
  trường) + `moderation.ts` (lọc, giới hạn, cấm) + `youtube.ts` (luật video).
- `public/js/shared/hall.js` — **dùng chung server + trình duyệt** (sơ đồ rạp, va chạm, ghế, `ACTIONS`, `REACTIONS`,
  ngoại hình, `VENUES`); kiểu ở `hall.d.ts` **viết tay — sửa cùng lúc**.
- `public/js/` — client: `main.js` (nối mọi thứ), `net.js`, `store.js` (trạng thái + nội suy), `me.js` (dự đoán),
  `player.js` (YouTube), `input.js`, `prefs.js` (⚙️), `render/` (`stage.js` bố cục + vòng vẽ, `persp.js`, `venues/`
  chủ đề rạp, `character.js`, `anims.js`), `ui/` (join, queue, chat, wheel, usercard, sheet, toasts, admin).
- `scripts/` — test, smoke, YouTube giả, QA headless, bot. `deploy/` — script + mẫu nginx.

## Quy trình đề xuất cho một thay đổi

1. Đọc `CLAUDE.md`, rồi `docs/00` §8 để tìm file; đọc `docs/08` §10 (bất biến & bẫy).
2. Sửa code theo hướng dẫn trong `docs/08` (thêm rạp, động tác, ngoại hình, lệnh admin, thông điệp, biến cấu hình…).
3. Thêm / sửa test: hàm thuần → `scripts/test-unit.ts`; qua mạng → `scripts/smoke.ts` (đăng ký `wait` trước khi gửi).
4. `npm test`; đổi giao diện → `npm run qa` và **mở xem ảnh** (máy tính + điện thoại dọc / ngang).
5. Cập nhật `docs/`, `README.md`, `CHANGELOG.md` cùng lúc.
6. Báo kết quả ngắn gọn, tiếng Việt (chủ dự án nói kiểu bạn bè, xưng tao / mày, thích kết quả trước, để ý chi phí).

## Bẫy hay gặp

- `c` trong `move` / `act` / `f` là `performance.now()` của **người gửi**, không phải giờ server; video dùng giờ server
  (`at`, `ends`) qua `store.serverNow()`.
- Client (`me.js`) và server (`hub.ts onMove`) dùng chung `moveWithCollision` / `SPEED` / `HALL` — đổi là đổi cả hai.
- Thêm phần tử nổi trên rạp → báo chỗ chiếm qua `stage.setInsets` (`main.js syncInsets`) và thêm id vào `checkOverlap`
  trong `scripts/qa.ts`.
- Thêm trường ngoại hình → nhớ khoá sprite cache `lookKey` trong `render/stage.js`.
- Id phòng: `ROOM_ID_RE` (`<rạp>` hoặc `<rạp>-2…9`, tối đa 12 ký tự); `protocol.ts` nhận `room` tới 16 ký tự rồi kiểm
  bằng `ROOM_ID_RE` — đổi dạng id thì sửa cả hai (có test đơn vị cho `congvien-2`).
- Smoke tắt video mặc định (`defaultVideo: ''`); dữ liệu chạy thật (`data/`) không commit.
