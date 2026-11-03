# 08 · Mở rộng: làm thế nào để thêm…

Mỗi mục là danh sách bước + file cần đụng. Làm xong luôn: `npm test` xanh, QA hình nếu đổi giao diện ([06](06-kiem-thu-qa.md)),
cập nhật `docs/` + `README.md` + `CHANGELOG.md` cùng lúc với code.

## 1. Thêm rạp / khung cảnh mới

Mọi rạp dùng chung sơ đồ `HALL` (đi lại, ghế, va chạm) — thêm rạp **không cần sửa server**.

1. `public/js/shared/hall.js` → thêm vào `VENUES`: `{ id, name, emoji, desc }` (Object.freeze như các mục khác).
   - `id`: chữ thường a–z, 3–10 ký tự (khớp `ROOM_ID_RE`; bản sao `<id>-N` dài tối đa 12 — `protocol.ts` nhận tới 16
     rồi kiểm bằng `ROOM_ID_RE`, xem [02](02-giao-thuc.md) §3).
   - `name` tiếng Việt có dấu ("Rạp …"), `desc` một câu ngắn (hiện ở bảng chọn rạp).
   - Thứ tự trong `VENUES` = thứ tự hiện + thứ tự server tìm phòng còn chỗ. `DEFAULT_VENUE` là rạp mặc định.
   - Server tự tạo phòng chính cho rạp mới khi khởi động (`Hub` constructor). `hall.d.ts` không cần đổi.
2. `public/js/render/venues/<id>.js` → `export default { … }` đúng giao diện chủ đề ([03](03-frontend.md) §6). Cách
   nhanh: bắt đầu từ `{ ...nhung, id: '<id>' }` (như bản tạm) rồi thay dần từng hàm.
3. `public/js/render/venues/index.js` → thêm `<id>: () => import('./<id>.js')` vào `LOADERS` (nạp động; lỗi → tự rơi về
   Rạp Nhung Đỏ).
4. Ràng buộc khi vẽ:
   - `renderBand`: ô `L.screen` để trống / tô đen — iframe YouTube nằm đè lên; không vẽ gì lên khung video.
   - Thứ gì cao trong `drawRoom` có thể lấn lên dải trên → `clip('evenodd')` chừa khung video (mẫu: `render/hall.js
     drawRoom`). `skyFx` đã được stage cắt sẵn; `fx` và vật trong `props()` nằm trong clip khán phòng.
   - Vật cản thật là `HALL.speakers`, `HALL.counter` (va chạm dùng chúng) — vẽ thành gì cũng được nhưng **đúng chỗ, đúng
     cỡ**; vật trang trí thêm (`props()`) chỉ để nhìn, người đi xuyên qua được → đặt ngoài vùng đi lại hoặc thật thấp.
   - Ghế: `renderRow` vẽ đúng chỗ `SEATS` (người ngồi suy từ toạ độ ghế); hai lớp nếu cần (`key = z − 0,3` phía sau người
     ngồi, `z + 0,32` phía trước).
   - Chỉ vẽ bằng code (không ảnh); emoji trên canvas dùng `drawEmoji` (Chrome bỏ emoji cỡ chữ nhỏ); chữ tiếng Việt có dấu.
   - Hiệu năng: `floorTexture`, `renderBand`, `drawRoom`, `renderRow` được cache — làm nặng thoải mái; hàm mỗi khung
     (`skyFx`, `fx`, `props[].draw`, `drawDanceLights`, `drawBeam`, `drawHallLight`) phải nhẹ.
5. Test: `test-unit.ts` có `assert.equal(VENUES.length, 4)` → sửa số; thêm id mới vào kiểm `roomName` nếu muốn.
6. QA: `npm run qa -- --room <id> --out /tmp/vc-<id>` (bot + trang vào đúng rạp) → xem ảnh máy tính + điện thoại dọc /
   ngang, không lỗi console, không "đè video".
7. Tài liệu: mô tả hình rạp trong [03](03-frontend.md) §6 (chỗ dành sẵn cho mô tả từng rạp), `README.md`, `CHANGELOG.md`,
   chú thích trong `.env.example` (liệt kê các rạp).

## 2. Thêm động tác

1. `shared/hall.js ACTIONS` → `{ id, key, label, emoji, dur, seat }`: `dur` ms (0 = lặp tới khi đi / chọn điệu khác),
   `seat` = làm được khi ngồi ghế. Nhãn tiếng Việt trung tính (không dùng chữ "ke" — test kiểm).
2. `shared/hall.d.ts` → thêm id vào union `ActionId`.
3. `render/anims.js actionPose` → `case '<id>'`: **hàm thuần của `t`** (ms từ lúc bắt đầu), trả `{ anim, pose?, hold?,
   dir? }` cho cả `view` `'down'`, `'up'` (nhìn từ sau), `'left'` (nghiêng; phải = lật gương); dùng `envelope()` cho động
   tác một lần. Tuỳ chọn: `ACTION_FX[id]` (emoji bay khi bắt đầu / lặp).
4. Muốn sàn nhảy sáng dưới chân: thêm id vào danh sách `dancers` trong `stage.js draw`.
5. Phím: `input.js` chỉ bắt `Digit1`–`Digit8` / `Numpad1`–`8`; vòng động tác tự xếp theo `ACTIONS.length`. Động tác thứ
   9 trở đi → sửa regex phím, chữ hướng dẫn (`main.js` bảng phím), test `ACTIONS.length === 8` / phím 1–8.
6. Server không cần đổi (`protocol.ts` dùng `ACTION_IDS`, `hub.ts` dùng `actionById` để biết `dur`).
7. Soi hình: `npx tsx scripts/qa-characters.ts --url http://localhost:3399 --out …`.

## 3. Thêm lựa chọn ngoại hình

- **Màu mới** (da, tóc, áo, quần): thêm vào mảng trong `shared/hall.js` (chữ thường, dạng `#rrggbb`) — `normalizeLook`,
  bộ chọn (`ui/join.js lookEditor`) tự nhận. Màu da có nhãn riêng `SKIN_LABEL` trong `join.js` → thêm nhãn.
- **Kiểu tóc / phụ kiện / râu mới**: thêm `{ id, label }` vào `HAIR_STYLES` / `ACCESSORIES` / `FACIALS`, rồi vẽ trong
  `render/character.js` cho **mọi hướng** (tóc: `hairCapDown`, `hairBackDown`, `hairUp`, `hairSide`, `hairSideBack`; phụ
  kiện: `accessoryFront`; râu: `facialDown`, `facialSide`). Cân nhắc `randomLook` (tỉ lệ theo dáng), `FEMININE_HAIR` (đoán
  dáng cho ngoại hình cũ), `SWAP_HAIR` trong `join.js` (đổi dáng tự đổi tóc).
- **Trường mới hoàn toàn** (vd mũ): `normalizeLook` + `randomLook` (`hall.js`), `Look` (`hall.d.ts`), bảng màu / vẽ
  (`character.js pal()` — khoá cache có liệt kê trường), **`stage.js lookKey`** (khoá sprite cache — thiếu trường là người
  đứng yên bị vẽ sai), một dòng trong `lookEditor`, test `normalizeLook` trong `test-unit.ts`.
- Server chỉ lưu những gì `normalizeLook` trả → giá trị lạ tự thành mặc định.

## 4. Thêm lệnh admin

1. `src/types.ts` → thêm nhánh vào `AdminOp`.
2. `src/protocol.ts parseAdmin` → `case` kiểm từng tham số (kiểu, khoảng, regex); sai → `null`.
3. `src/hub.ts onAdmin` → `case`: tác động lên `c.room` (phòng admin đang xem) hoặc `findPlayer`; `done('…')` (toast cho
   admin + gửi lại `state`); `room.broadcast({t: 'notice', …})` nếu cả phòng cần biết; `this.dirty = true` / `this.save()`
   nếu cần lưu.
4. `public/js/ui/admin.js` → nút trong `renderSheet` (bảng 🛠), `nowActions` (thẻ Đang chiếu), `itemTools` (từng bài) hoặc
   `userButtons` (thẻ người). Gửi bằng `adm('<op>', {…})`.
5. Test: `parseClientMsg` trong `test-unit.ts`; một `step` trong `smoke.ts` (admin = client có cookie, người thường gửi lệnh
   phải bị lờ).
6. Tài liệu: [02](02-giao-thuc.md) §6, [07](07-server.md) §12.

## 5. Thêm thông điệp giao thức

**Client → server**

1. `src/types.ts ClientMsg` → nhánh mới `{ t: '<tên>'; … }`.
2. `src/protocol.ts parseClientMsg` → `case`: kiểm **mọi** trường (kiểu, độ dài chuỗi, khoảng số, regex); trả object sạch
   (đừng chuyển tiếp object thô của client).
3. `src/hub.ts message()` → định tuyến: trước `if (!p || !room …)` nếu không cần nhân vật, sau đó nếu cần. Thêm giới hạn
   tốc độ (một `Bucket` mới trong `Player`, khởi tạo ở `onJoin`) nếu client có thể gửi dồn.
4. Client gửi bằng `send({ t: '<tên>', … })` (`net.js`).

**Server → client**

1. `src/types.ts ServerMsg` → nhánh mới.
2. `hub.ts` gửi bằng `this.send(conn, …)` / `room.broadcast(…)`.
3. `public/js/store.js handleMessage` → `case`: đọc phòng thủ (`str`, `num`, `arr`, cắt độ dài) rồi `store.emit('<sự kiện>')`.
4. UI nghe bằng `store.on('<sự kiện>', …)`.

Tương thích: hai phía đều bỏ qua `t` lạ và trường lạ → thêm trường **tuỳ chọn** là an toàn; phá tương thích thì tăng
`PROTOCOL` ([02](02-giao-thuc.md) §12). Cập nhật [02](02-giao-thuc.md) + thêm bước smoke.

## 6. Thêm biến cấu hình

1. `src/config.ts`: trường trong `Config` (kèm chú thích tiếng Việt) + đọc bằng `int / float / bool / str` với **mặc định
   và khoảng kẹp**.
2. `.env.example`: thêm dòng có chú thích tiếng Việt (giá trị mặc định).
3. Dùng `this.cfg.<x>` (hub) / `cfg.<x>` (app).
4. Client cần biết? → thêm vào `PublicSettings` (`types.ts`), `Hub.settings()`, giá trị mặc định trong `store.cfg`
   (`store.js`).
5. Test phụ thuộc giá trị → đặt rõ trong `makeCfg` của `smoke.ts` (test không đọc `.env`).
6. [07](07-server.md) §16. Giá trị production khác mặc định → chủ dự án sửa `deploy/.env.production` (không in ra).

## 7. Thêm tùy chọn ⚙️ (chỉ trên máy người xem)

1. `public/js/prefs.js DEFAULT_PREFS` (+ `ENUMS` nếu là lựa chọn nhiều giá trị) — `load()` tự lọc giá trị lạ.
2. `main.js prefsContent()` → `prefToggle(key, nhãn, mô tả)` hoặc `prefChoice(key, nhãn, [[giá trị, chữ]…])`.
3. Áp dụng ở nơi cần (`stage.js`, `ui/chat.js`, `store.js`…); cần vẽ lại ngay khi đổi → `onPrefs((key) => …)`.
4. [03](03-frontend.md) §13; trang `/chinh-sach` nhắc dữ liệu lưu trên trình duyệt.

## 8. Thêm nút / phần tử nổi trên rạp

1. `index.html` (+ `aria-label`, `title` tiếng Việt), `style.css` (nhớ các breakpoint ở [03](03-frontend.md) §3), xử lý
   trong `main.js` hoặc một module `ui/`.
2. **Không được nằm trên khung video**: đặt ở cụm góc, dock, dưới mép video (`--aud-top`, `--sheet-top`), hoặc nếu chiếm
   chỗ cạnh video thì báo qua `syncInsets()` → `stage.setInsets()`.
3. Thêm id vào danh sách `checkOverlap` trong `scripts/qa.ts`.
4. Chữ chỉ qua `textContent` (`el()`, `setText`). Nếu là bảng mở / đóng: đóng bằng `Esc` (`input.js closeAll`) và tính
   vào điều kiện "bận" của tự làm mờ nút (`main.js`).

## 9. Quy ước

- Mọi chữ người xem thấy: **tiếng Việt có dấu**. Tên file / hàm / biến: tiếng Anh. Chú thích trong code: tiếng Việt (như
  code hiện có).
- Chuỗi từ người dùng / server chỉ vào DOM qua `textContent` (`util.js el()`, `setKids`, `setText`); màu từ dữ liệu qua
  `safeColor`. Không `innerHTML` với dữ liệu.
- Ít dependency (hiện chỉ `ws`, `dotenv`); không bước build; không ảnh trong giao diện.
- Test không bao giờ ra Internet (YouTube giả).
- Commit **tiếng Anh** dạng `<area>: <description>` (vd `hub: yield default video on first queue add`), cuối thân commit
  có dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không `git add -A` mù (có file bí mật trong cây thư
  mục dù đã `.gitignore`). Không commit / push / deploy khi chủ dự án chưa bảo.
- Ghi tài liệu cùng lúc với code: `docs/`, `README.md`, `CHANGELOG.md`.

## 10. Bất biến & bẫy (đọc trước khi sửa)

1. **`public/js/shared/hall.js` chạy ở cả server lẫn trình duyệt**: chỉ JS thuần (không DOM, không `node:*`); server
   import thẳng file `.js` qua `tsx`, kiểu lấy từ **`hall.d.ts` viết tay** — đổi export / chữ ký thì sửa `.d.ts` cùng lúc
   (typecheck không tự phát hiện mọi lệch).
2. **Sửa file client xong phải khởi động lại server**: phiên bản tài nguyên (`/v/<băm>/`, cache `immutable`) chỉ tính lúc
   khởi động; `npm run dev` chỉ tự khởi động lại khi file server (và `shared/hall.js`) đổi.
3. **Không bao giờ đè lên video**, không chặn bấm vào iframe, không đụng quảng cáo, trình phát ≥ 200×200 —
   [04](04-youtube-va-phap-ly.md) §11.
4. Thời gian: `c` trong `move` / `act` / `f` là **giờ máy người gửi** (`performance.now()`), không so với `Date.now()`;
   `at` / `ends` / `s` là giờ server — client dùng `store.serverNow()`.
5. Di chuyển: `me.js` (dự đoán) và `hub.ts onMove` (kiểm) dùng chung `moveWithCollision`, `SPEED`, `HALL` — đổi một phía
   là đổi cả hai; đổi `SPEED` đổi luôn ngân sách quãng đường của server.
6. Đổi dạng id phòng (`ROOM_ID_RE`) → kiểm lại giới hạn độ dài `room` trong `protocol.ts` (đang 16) + test đơn vị.
7. Admin: server lờ `adm` của người thường ("như không tồn tại"); `ui/admin.js` chỉ được `import()` khi `hello.admin`.
   Không để lộ gì về hệ thống cho người thường.
8. Bí mật: không đọc / in / commit `.env`, `deploy/vps.env`, `deploy/.env.production`; không in `ADMIN_TOKEN` /
   `YT_API_KEY` ra log; không ghi IP / mật khẩu VPS vào tài liệu.
9. Lưu trữ: `Hub.load()` / `BanList` phải đọc **phòng thủ** (dữ liệu bản cũ — vd phòng `"1"` → rạp mặc định). Tắt tiếng /
   mời ra chỉ trong bộ nhớ.
10. `smoke.ts makeCfg` đặt `defaultVideo: ''` (app chính không tự phát video mặc định); bước video mặc định dựng app riêng.
    `qa.ts` / `qa-server.ts` để mặc định (fixture giả trong `fake-youtube.ts`).
11. Khoá sprite cache người (`stage.js lookKey`) phải gồm mọi trường của `look`.
12. Emoji trên canvas: luôn `drawEmoji` (font 16 px rồi scale).
13. Chủ đề rạp nạp bằng `import()` đường dẫn tương đối → cũng nằm dưới `/v/<phiên bản>/`; đừng dùng đường dẫn tuyệt đối.
14. Giữ `Referrer-Policy: strict-origin-when-cross-origin` (YouTube lỗi 153 nếu thiếu Referer); thêm miền ngoài → sửa CSP
    trong `app.ts`.
15. VPS dùng chung: tên riêng cho mọi thứ (pm2, cổng, site, zone `limit_req`), `nginx -t` trước khi reload, không đụng app
    khác ([05](05-van-hanh-deploy.md) §2).
16. Không dùng chữ "ke" trên giao diện (động tác tên "Lắc đầu quẩy"); test kiểm.
17. Test có con số cứng: `VENUES.length === 4`, `ACTIONS.length === 8`, phím 1–8, `SEATS.length ≥ 120` — đổi dữ liệu thì
    sửa test có chủ đích.
