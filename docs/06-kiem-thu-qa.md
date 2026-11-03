# 06 · Kiểm thử & QA

Hai tầng: **`npm test`** (tự động, không ra Internet, bắt buộc xanh trước khi báo xong / commit / deploy) và **QA hình**
(Chrome headless chụp ảnh máy tính + điện thoại, kiểm chồng lấn video, đo độ mượt — bắt buộc khi đổi giao diện).

## 1. `npm test`

```bash
npm test     # = npm run typecheck && npm run test:unit && npm run smoke   (~35 giây)
```

| Bước | Lệnh | Kiểm |
|---|---|---|
| typecheck | `tsc --noEmit` | strict, `noUnusedLocals`, gồm `src/` + `scripts/` (`tsconfig.json`). Client JS **không** được typecheck; `shared/hall.js` chỉ được nhìn qua `hall.d.ts` viết tay (lệch giữa hai file không bị phát hiện) |
| test đơn vị | `tsx scripts/test-unit.ts` | 29 mục, hàm thuần (§2) |
| smoke | `tsx scripts/smoke.ts` | 64 bước, app thật + WebSocket thật + YouTube giả + thư mục dữ liệu tạm (§3) |

**Luật**: test không bao giờ ra Internet (YouTube giả `scripts/fake-youtube.ts`; smoke đặt `defaultVideo: ''` cho app
chính để không phụ thuộc video mặc định — bước video mặc định dựng app riêng). Không dùng mã admin thật (smoke dùng
`smoke-admin-token-123`, QA dùng `qa-local-admin`).

## 2. `scripts/test-unit.ts` — hàm thuần

| Nhóm | Mục |
|---|---|
| YouTube | `parseVideoId` 13 dạng link hợp lệ + link lạ (vimeo, evil.com, `javascript:`, id ngắn, kênh `@`…); `parseIsoDuration`; `checkMeta` nhận / từ chối đúng lý do từng trường hợp (chặn nhúng, riêng tư, không công khai, 18+, chặn VN, chỉ US, quá dài, sắp live, không có, live khi tắt live); `metaFromItem` thiếu trường → bị từ chối; `VideoCache` hết hạn + giới hạn cỡ |
| Kiểm duyệt | `checkName` hợp lệ / từ chối (tên dành riêng, link, bậy, ký tự lạ, emoji, "аdmin" Kirin) — "Các bạn", "Buổi tối" không bị nhầm; `nameKey` (dấu, hoa thường, tên không Latin); `checkChat` (link, che bậy, cụm "mẹ mày", "đmmmm"); `cleanText` (ký tự vô hình, lặp, cắt theo code point); `Bucket` + `WindowCounter` |
| Giao thức | `parseClientMsg` nhận đúng dạng, bỏ rác (kiểu sai, `d` ngoài 0–3, động tác lạ, emoji lạ, `ban` thiếu `hours`, không phải JSON) |
| Phòng riêng | id: `parseRoomId('p-abcdefghij') = null`, `ANY_ROOM_ID_RE` nhận, `PRIVATE_ROOM_RE` từ chối 8 ký tự; `spec` / `switch` / `join` kèm `rt` (sai dạng thì bỏ trường); `proom_new` / `proom_auth` / `proom_op` + admin `close_room` nhận / bỏ đúng; `networkOf` (IPv4 /32, IPv6 /64, `::ffff:a.b.c.d` = IPv4); `subnetOf` (IPv4 /24, IPv6 /48, `::ffff:a.b.c.d` = /24 của IPv4 đó) |
| Sơ đồ rạp | `isWalkable` (sân khấu, tường, loa, quầy), `moveWithCollision` (trượt tường, không xuyên), `clampToWalkable` + `spawnPoint` luôn đứng được, ghế (đủ 130, `nearestSeat`, `seatAt`), `normalizeLook` / `randomLook` (chỉ giá trị trong bảng, đoán dáng theo tóc, nữ không râu, ngẫu nhiên ra cả nam lẫn nữ), rạp (4 rạp, `parseRoomId`, `roomName`, id sai), 8 động tác phím 1–8 + **không có chữ "ke"** trong tên |

## 3. `scripts/smoke.ts` — toàn hệ thống

Dựng `createApp` thật (YouTube giả, `roomCapacity: 8`, `maxRooms: 2`, `tickHz: 20`, thư mục dữ liệu tạm), nối nhiều
client `ws` như trình duyệt, **mỗi client một IP giả** qua header `X-Real-IP`. Các bước (theo thứ tự trong file):

1. HTTP: phiên bản tài nguyên `/v/<12 hex>/`, `immutable`, CSP, `Referrer-Policy`, `/chinh-sach`, chặn `.d.ts`, `..`,
   `.env`, `/api/health`.
2. Admin: sai mã 403, đúng mã → cookie HttpOnly SameSite=Strict không chứa mã thật.
3. WebSocket từ Origin lạ bị từ chối.
4. `hello` cho người đứng xem (phòng, cài đặt, không admin).
5. Vào rạp: tên sai bị từ chối, tên đúng → `welcome`, người khác thấy `pj`.
6–7. Di chuyển hợp lệ → frame giữ giờ máy người đi; đi quá nhanh / vào tường → `corr`.
8. Động tác là sự kiện; đi thì server tự bỏ động tác.
9–10. Chat: phát cả phòng, che bậy, chặn link, chặn lặp; dồn dập → tắt tiếng 2 phút.
11. Emoji hợp lệ / lạ.
12–13. Hàng chờ: mọi lý do từ chối; thêm được → chiếu ngay + giới hạn / người + chống trùng.
14. Bỏ phiếu đủ → bài kế; người thêm tự bỏ qua bài mình.
15. Thêm clip 2 giây (để kiểm hết bài ở bước admin).
16–19. Admin: cookie → `hello.admin`, người thường gửi lệnh admin bị lờ; bỏ qua → clip tự hết → bài kế; khoá hàng chờ;
    tắt / bật tiếng.
20. 3 người báo cáo video → tự gỡ + chặn thêm lại.
21. Lỗi trình phát 150 trên các máy → chuyển bài + không cho thêm lại.
22–24. Mời ra (đóng kết nối, 2 phút không vào lại, người chung mạng không vạ lây); cấm / bỏ cấm (`bans.json`); gỡ hẳn video.
25. `adm state`.
26. Rạp: socket `?room=bien` → xem Rạp Bãi Biển; `spec` sang rạp khác; `join` vào đúng rạp đã chọn; `?room=bien-7`
    (bản sao không có) → về phòng chính `bien`.
27–29. Vào lại ở tab mới (mất token, cùng khoá máy) → đúng nhân vật; chuyển rạp tại chỗ (`switch`); đóng tab (`leave`) →
    đi ngay, khách mới không chọn rạp → vào rạp đông nhất.
30. Rạp đầy (8, tính cả người đang nối lại) → mở bản sao `nhung-2`.
31–32. Nối lại khi server còn giữ socket cũ → đóng socket cũ `4002`; rớt mạng → người khác thấy "mất mạng", nối lại
    bằng token đúng nhân vật.
33. Ngập tin → bị đóng kết nối.
34. Tắt server → `rooms.json`; bật lại → khôi phục video đang chiếu + hàng chờ, id người mới không trùng `byId` cũ, chủ
    video (cùng khoá máy) nhận lại quyền.
35. Video mặc định (app riêng, `defaultIdleSeconds: 0.4`): phòng trống → tự phát; không bỏ phiếu được; có video mới →
    nhường ngay.
36. Không có `YT_API_KEY` (app riêng) → kiểm cơ bản oEmbed, đo độ dài (người thêm báo là nhận, người khác một mình không
    đủ), nhận ra live; API hết quota cũng tự kiểm cơ bản.
37. Video admin thêm không bỏ phiếu được; điện thoại ẩn trang → người khác thấy rời đi ngay, hiện lại đúng chỗ.
38–55. **Phòng riêng** (docs/07 §20; giới hạn / vòng đời / lưu-khôi phục dựng app riêng với số nhỏ): tạo (kiểm dữ liệu,
    vào thẳng, bấm đúp → "bận", không có trong danh sách rạp); link `?room=p-…` → `hello` phòng chung + `proom_need`, người
    thường không đứng xem được; sai / đúng mật khẩu (NFD + khoảng trắng vẫn đúng), vé gắn với máy; 30 lần nhập dồn dập →
    1 phép băm, khoá 10 lần / mạng (đúng cũng tính), 20 lần / phòng (+ báo chủ phòng); đủ người (tính cả người đang ẩn);
    video dài vẫn nhận (có key), không video mặc định; dừng / phát tiếp cho cả phòng; lệnh chủ phòng (xoá, bỏ qua, số
    người, mời ra → "out" rồi về phòng chung, không vào lại được; đổi mật khẩu → `proom_rt`, vé cũ hết hiệu lực; đóng
    phòng), không đụng người phòng chung; lỗi trình phát / báo cáo chỉ tác động trong phòng; admin gỡ video tới cả phòng
    riêng; admin thấy danh sách, đứng xem (cả phòng được báo 🛡), vào hẳn (thành viên thấy `adm`, chủ phòng không mời ra
    được), đóng phòng; giới hạn (`owned`, mỗi mạng, mỗi giờ, cả rạp — thu hồi phòng trống lâu nhất); tự đóng khi trống /
    lâu không ai thao tác; `rooms.json` khoá `priv` chỉ có mã băm (mật khẩu, vé, khoá máy), bật lại vào bằng vé.
56. `rooms.json` bản trước có khoá máy thật của người thêm video (`byCk`) → nạp thành băm (`byCkH`), người thêm vẫn nhận
    lại video; lưu lại không còn khoá thật.
57. Quản trị viên có mặt là **trạng thái**: người vào sau vẫn biết (`welcome` có `priv.admins` + dòng báo 🛡); admin rời →
    `priv` hết `admins`; vào lại trên cùng kết nối → báo lại; đứng xem rồi vào hẳn → chỉ một lần báo.
58. Quản trị viên **không chiếm chỗ**: phòng 3 chỗ có 2 người + admin → bạn thứ ba vẫn vào; chủ phòng hạ số người theo
    thành viên thật; thành viên rời rồi vào lại bằng vé không bị "đầy"; còn mỗi admin → phòng vẫn tự đóng; chủ rạp (cookie
    admin) tự tạo phòng của mình → vẫn là thành viên (ghi rõ `adm`), ngồi chờ một mình phòng không tự đóng.
59. Video chỉ qua kiểm cơ bản (không key) giữ giới hạn rạp chung trong phòng riêng: "không công khai" tối đa 15 phút, báo
    dài 2 tiếng vẫn 15 phút, live tối đa `LIVE_MAX_MINUTES`.
60. Nhật ký server không bao giờ có video / người trong phòng riêng (tên, mã video, độ dài, báo cáo, lỗi trình phát, admin
    gỡ video từ trong phòng) — chỉ mã + tên phòng lúc tạo / đổi mật khẩu / đóng; phòng chung vẫn ghi như cũ.
61. Chống chiếm hết phòng: mỗi dải mạng (IPv4 /24, IPv6 /48) ≤ `PRIVATE_PER_SUBNET`; rạp đủ `PRIVATE_ROOMS_MAX` mà không
    còn phòng trống → người từ dải chưa có phòng lấy phòng lâu không thao tác nhất của dải giữ nhiều phòng nhất.
62. Đổi mật khẩu: thành viên đang mất mạng / đang ẩn giữ vé, người đã rời mất vé; lượt dò của phòng được xoá (người có
    mật khẩu mới vào được ngay); tối đa 5 lần / 10 phút / phòng.
63. Lệnh admin (chiếu tiếp, bỏ qua…) tính là thao tác: video tự dừng vì lâu không ai thao tác, admin cho chiếu tiếp → không
    bị dừng lại ở nhịp sau.
64. Tab mới cùng máy (nhân vật cũ ở phòng chung) vào phòng riêng mà trùng tên người trong đó → nối lại tại chỗ (`welcome`)
    rồi mới báo lý do (`proom_res` mã `name` kèm id phòng — báo được trên thẻ vào rạp).

`Client.wait(pred)` / `waitT(t)`: **đăng ký chờ TRƯỚC khi gửi lệnh** để không lỡ thông điệp tới nhanh.

## 4. YouTube giả — `scripts/fake-youtube.ts`

`createFakeYouTube({ delayMs?, fail?, noKey? })` cài đúng interface `YouTubeClient` (`fetchVideo`, `fetchOEmbed`,
`configured` = `!noKey`, thêm `calls[]` / `oembedCalls[]` để đếm; `noKey` = như rạp chưa có `YT_API_KEY` → kiểm cơ bản
bằng oEmbed). Bảng `FIXTURES`:

| id | Trường hợp |
|---|---|
| `aqz-KE-bpKQ`, `YE7VzlLtp-4`, `eRsGyueVLvQ` | phim Blender hợp lệ (10:35, 9:57, 14:48) |
| `jNQXAC9IVRw` | "Me at the zoo" 19 s |
| `noEmbed0001`, `private0001`, `unlisted001`, `ageLimit001`, `noVietnam01`, `onlyUS00001`, `tooLong0001`, `upcoming001`, `missing0001` | từng lý do từ chối |
| `liveNow0001` | đang live |
| `rFZHOHl-L8A` | bản giả của video mặc định (live) |
| `shortClip01` | clip 2 giây (kiểm hết bài) |
| id lạ đúng dạng | video công khai 200 s ("Video thử nghiệm …") |

## 5. Chạy thử trên máy (không cần API key)

```bash
npx tsx scripts/qa-server.ts            # http://localhost:3399 — YouTube giả, không ghi đĩa, admin: #admin=qa-local-admin
npx tsx scripts/bots.ts --url ws://localhost:3399/ws --n 20 --video aqz-KE-bpKQ [--room bien] [--seconds 60]
```

- `qa-server.ts`: biến `PORT` (3399), `CAPACITY` (người / phòng); `maxConnPerIp 500`, `joinsPerMinute 10000` để chạy
  nhiều bot. Nhận mọi link (id lạ = 200 s). Video mặc định bật (fixture giả), nhưng khung YouTube vẫn tải video **thật**
  từ YouTube (cần Internet để xem hình).
- `bots.ts` (`startBots` cũng được `qa.ts` dùng): mỗi bot vào rạp (tên Việt, ngoại hình ngẫu nhiên), 30 Hz đi tới ghế /
  sàn nhảy / lối đi, ngẫu nhiên làm động tác, thả emoji, chat; bot 0 thêm `--video`. `--seconds 0` = chạy mãi, rớt thì
  tự vào lại sau 3 s.
- Chạy bản thật với key: `cp .env.example .env`, điền `ADMIN_TOKEN`, `YT_API_KEY`, rồi `npm run dev` (port 3300).
- Thử chế độ không key (kiểm cơ bản, trình phát thật đo độ dài): `NO_KEY=1 npx tsx scripts/qa-server.ts`.
  **Sửa file client xong phải khởi động lại server** (phiên bản tài nguyên).
- Thử trên điện thoại cùng wifi: `HOST=0.0.0.0` rồi mở `http://<IP máy dev>:3300`.

## 6. QA hình — `npm run qa`

```bash
npm run qa -- --out /tmp/vc-shots [--bots 14] [--video aqz-KE-bpKQ] [--only desktop|mobile|private] [--room bien]
```

`scripts/qa.ts` tự dựng app (YouTube giả, không ghi đĩa) + bot, mở Chrome headless (`scripts/cdp.ts` — DevTools
Protocol chỉ bằng `ws`, không thêm dependency; tìm Chrome ở đường dẫn quen thuộc hoặc `CHROME_PATH`), vào rạp như người
thật:

- **Máy tính 1440×900** (kèm `#admin=qa-local-admin`): màn vào rạp, rạp, đi + nhảy, vòng động tác, chat, bảng cảm xúc,
  ngăn kéo, bảng admin, bảng tùy chọn, các góc xem (📺), laptop nhỏ 1280×680, rồi mở lại trang → phải hiện thẻ "Chào
  mừng quay lại" (không hiện là lỗi) và bấm một phòng để vào nhanh.
- **Điện thoại 390×844 @3x** (cảm ứng, UA iPhone): màn vào rạp, rạp, vòng động tác, tấm hàng chờ, thẻ chat, tùy chọn,
  xoay ngang 844×390.
- **Phòng riêng** (`privateFlow`, chạy cả khi `--only private`): mỗi "máy" (chủ phòng máy tính, khách điện thoại, admin)
  là **một hồ sơ Chrome riêng** (localStorage / cookie / `vc.ck` / `vc.rt` riêng như máy thật). Kịch bản:
  - chủ phòng (tên 20 ký tự → tên phòng 30 ký tự) tạo phòng từ thẻ chào lại (tấm ghi đúng luật; mật khẩu ngắn báo lỗi
    trong tấm) → thẻ mời: link `/#phong=<id>` (không có `?phong=`), ghi rõ quản trị viên rạp vào được; thanh địa chỉ
    `/#phong=<id>`; thêm video → `checkIframe`; dừng riêng trên thanh YouTube được giữ, bấm phát lại về giờ chung;
  - khách mở link → form chế độ phòng riêng → sai mật khẩu (báo trên thẻ) → đúng → trong phòng (ô 🔒, cụm ⏸, 2/4,
    `checkHud`, `checkIframe`, thanh địa chỉ `/#phong=<id>`; `checkStrip`: ở 390 px mọi nút dưới video cùng hiện — 🔊, ↩,
    "⏭ Bỏ qua ngay", ⏸, 🚩, ⛶ — xuống hàng chứ không tràn, không đè video); bảng phòng của khách (không có công cụ chủ
    phòng) / chủ phòng; ⏸ / ▶ cho cả phòng; rời phòng → rạp chung, thanh địa chỉ hết `phong`; tấm tạo phòng trên điện
    thoại; mở lại link `#phong=` ngay trong tab → tự tải lại, vào bằng vé; bấm 🎬 trong phòng riêng → trang chủ:
    `document.referrer` không chứa `phong`, vào rạp chung → `checkIframe`;
  - chủ phòng đổi mật khẩu → thẻ mời mới; **admin** mở link **kiểu cũ** `?phong=<id>` → tự đổi sang `/#phong=<id>`, đứng
    xem thẳng (không hỏi mật khẩu) → chủ phòng được báo 🛡 và thấy dấu 🛡; vé cũ của khách → "Mật khẩu phòng đã đổi…" →
    nhập mật khẩu mới → vào (người vào sau vẫn thấy dấu 🛡 + được báo); ô "Mật khẩu mới" của chủ phòng giữ con trỏ qua các
    lần bảng phòng cập nhật; admin vào hẳn → `checkIframe`, ô phòng của khách vẫn 2/4 (admin không chiếm chỗ), dấu 🛡
    còn; bảng 🛠 có tab 🔒 Phòng riêng liệt kê phòng;
  - đóng phòng (xác nhận trong tấm) → mọi người về rạp chung; link phòng đã đóng → "đã đóng", thanh địa chỉ hết `phong`.
  Ảnh `desktop-private-*.png`, `mobile-private-*.png`.
- **`checkIframe`** (cả luồng máy tính, điện thoại và phòng riêng): `src` khung YouTube có `enablejsapi=1` + `origin`,
  **không** có `phong` / `forigin` / `gporigin` (iframe tự dựng — [04](04-youtube-va-phap-ly.md) §5).
- Ảnh `*.png` ghi vào `--out` (danh sách chính xác: các lệnh `shot(...)` trong `qa.ts`).
- **`checkOverlap`**: ở mỗi ảnh quan trọng, đo khung `#screen-slot` so với mọi DOM nổi (`hud-l`, `hud-r`, `dock`,
  `side`, `sheet`, `toasts`, `react-pop`, `joystick`, `user-card`, `chat-feed`, `screen-tools`, `conn`, `focus-hint` và
  con trực tiếp của chúng) — chồng > 0,5 px → lỗi "… đè video" (luật YouTube). Thêm phần tử nổi mới → thêm id vào danh
  sách này.
- **Độ mượt** (`smoothness`, 5–6 s): `fps`, `stallRatio` (tỉ lệ khung người khác đang đi mà đứng hình), `stepCV` (độ đều
  bước), `hitches` (khung > 50 ms), `buffer` / `late` của bộ đệm mạng, `view()` (bố cục, mức chi tiết, thời gian vẽ).
  Tham khảo trên máy dev: 60 fps, khựng < 1 %, vẽ ~1 ms / khung.
- In mọi lỗi console / exception / log lỗi; bỏ qua lỗi của chính YouTube / Google (`youtube|ytimg|googlevideo|
  doubleclick|google.com|gstatic|ERR_BLOCKED_BY_CLIENT`). Còn lỗi thật → mã thoát 1.
- Trang nhúng trình phát YouTube thật → **cần Internet**; vì vậy QA không nằm trong `npm test`.

## 7. `scripts/qa-characters.ts` — soi nhân vật

```bash
npx tsx scripts/qa-server.ts &   # cần một server đang chạy để nạp module vẽ
npx tsx scripts/qa-characters.ts --url http://localhost:3399 --out /tmp/vc-chars
```

Nạp thẳng `/js/render/character.js`, `anims.js`, `shared/hall.js` trong Chrome headless, vẽ bảng 8 động tác × 4 hướng
(đứng / ngồi ghế / ngồi bệt) ở vài thời điểm + bảng dáng Nam / Nữ (kiểu tóc, râu, biểu cảm) × 4 hướng
(`characters-bodies.png`). Dùng khi sửa `character.js` / `anims.js`.

## 8. Chia sẻ link + SEO — `scripts/share-images.ts`, `scripts/seo-check.ts`

```bash
npx tsx scripts/qa-server.ts & npx tsx scripts/bots.ts --n 10 --room congvien &
npm run share-images -- --url http://localhost:3399 [--room congvien] [--label cinema.vibe-coder.fun] [--out public]
npm run seo-check -- --url http://localhost:3399          # hoặc --url https://cinema.vibe-coder.fun sau khi deploy
```

`share-images` vẽ bằng code qua Chrome headless (không có ảnh vẽ tay nào):
- `og-image.jpg` 1200×630 (~150 KB, < 300 KB cho WhatsApp / Zalo): cảnh **Rạp Công Viên** có người (mặc định `--room
  congvien`) + thẻ tiêu đề đặt vào khung màn chiếu, mỗi dòng chữ tự thu nhỏ cho vừa 1 dòng. **Ẩn trình phát YouTube** —
  ảnh không bao giờ chứa khung hình video (tranh / quảng cáo trong video là của chủ kênh; vd ảnh chụp kênh Lofi Girl có
  tranh bản quyền + quảng cáo tai nghe nên không dùng làm ảnh chia sẻ).
- `screenshot-wide.jpg` 1280×720 + `screenshot-narrow.jpg` 780×1688 (ảnh app trong bảng cài PWA).
- `icon-512/192.png`, `apple-touch-icon.png` 180, `icon-maskable-512.png` (hình trong vùng an toàn 80 %),
  `favicon-48/32/16.png` (bản vẽ đơn giản cho cỡ nhỏ), `favicon.ico` (16 + 32 + 48, ghép PNG).
Đổi `og-image.jpg` → `%OG_VERSION%` (băm file) đổi theo → link ảnh mới, Facebook / Zalo lấy ảnh mới.

Thẻ SEO nằm trong `<head>` của `public/index.html` (title 52 ký tự, description 150, canonical + hreflang, Open Graph đủ
bộ, Twitter `summary_large_image`, JSON-LD `WebSite` + `Organization` + `WebApplication`), `public/chinh-sach.html`,
`public/site.webmanifest` (icon, ảnh app, lối tắt 4 rạp). `/robots.txt` + `/sitemap.xml` do `src/app.ts` sinh theo
`SITE_URL`. `seo-check` kiểm tất cả: độ dài, URL tuyệt đối, không còn `%…%`, JSON-LD đọc được, ảnh đúng cỡ khai báo
(đọc byte PNG / JPEG), manifest + mọi icon, robots / sitemap, trang chính sách, giả làm bot Facebook / Zalo / Telegram /
X / WhatsApp / Discord / LinkedIn / Google, http → https (production). Thoát mã 1 khi có lỗi.

Sau khi đổi ảnh / thẻ trên production: Facebook https://developers.facebook.com/tools/debug/ → dán link → **Scrape
Again**; Zalo / Messenger / Telegram lưu bản xem trước vài giờ — muốn thấy ngay thì chia sẻ link kèm `?v=2`.

## 9. Thêm test

- Hàm thuần (lọc chữ, luật video, va chạm, ngoại hình…) → thêm `test('…', () => …)` trong `test-unit.ts`.
- Hành vi qua mạng → thêm `await step('…', async () => …)` trong `smoke.ts` ở đúng chỗ (các bước dùng chung trạng thái —
  vd người `a`, `b`, `adm` đã vào rạp, hàng chờ đang có gì); cần cấu hình riêng thì dựng app riêng như bước video mặc định.
- Video mới cho test → thêm vào `FIXTURES` (id đúng 11 ký tự `[A-Za-z0-9_-]`).
- Giao diện → thêm bước + `shot` + `checkOverlap` trong `qa.ts`.

## 10. Checklist trước khi báo xong

1. `npm test` xanh.
2. Đổi giao diện: `npm run qa -- --out <thư mục>` không có lỗi console thật, không có dòng "đè video"; **mở xem ảnh**
   máy tính + điện thoại (dọc, ngang).
3. Không phần tử nào đè khung video (kể cả khi mở ngăn kéo, tấm, vòng động tác, thẻ người, toast).
4. Chữ tiếng Việt có dấu, không tràn trên màn 320–390 px.
5. Độ mượt: khựng < 3 %, không hitch kéo dài.
6. Đổi giao thức / server: thêm bước smoke tương ứng.
7. Cập nhật tài liệu (`docs/`, `README.md`, `CHANGELOG.md`) cùng lúc với code.
