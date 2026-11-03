# 03 · Frontend: canvas, bố cục, nhân vật, độ mượt, giao diện

Client là **ES module thuần** (không framework, không bước build, không ảnh trong giao diện — mọi thứ vẽ bằng Canvas 2D
hoặc DOM). Trang `public/index.html` nạp `style.css` + `js/main.js`; server viết lại đường dẫn thành `/v/<phiên bản>/…`
(cache vĩnh viễn — sửa file client xong phải **khởi động lại server**, [07](07-server.md) §2.2).

Nguyên tắc chung:

- **Không gì đè lên khung video** (luật YouTube): canvas cắt mọi lớp khán phòng dưới mép video; DOM nổi được đo và chừa
  chỗ (§3). `npm run qa` kiểm từng ảnh.
- Chuỗi từ người dùng / server (tên, chat, tên video) chỉ vào DOM qua `textContent` — dùng `util.js el()` / `setText()`
  (không bao giờ `innerHTML`); trên canvas qua `fillText`. Màu từ dữ liệu đi qua `safeColor`.
- Mọi chữ người xem thấy là **tiếng Việt có dấu**; tên file / hàm / biến tiếng Anh.

## 1. Module

```
main.js ── điểm vào: nối mọi thứ (đọc §2)
 ├─ net.js        WebSocket (nối lại, ping), đăng nhập admin từ #admin=
 ├─ store.js      trạng thái + handleMessage(ServerMsg) + sự kiện + nội suy người khác + đồng hồ server
 ├─ me.js         nhân vật của mình: dự đoán, va chạm, gửi move, tự ngồi ghế, động tác, emoji
 ├─ player.js     trình phát YouTube + đồng bộ đồng hồ phòng ([04](04-youtube-va-phap-ly.md))
 ├─ input.js      phím (WASD, E, 1–8, Enter, Esc), cần điều khiển ảo, trả focus khỏi iframe
 ├─ prefs.js      tùy chọn của người xem (⚙️), chỉ trên máy này (§13)
 ├─ util.js       el() an toàn, setText, localStorage / sessionStorage, clamp / lerp / ease, fmtTime, randomHex…
 ├─ shared/hall.js  dùng chung với server: HALL, ghế, va chạm, ACTIONS, REACTIONS, ngoại hình, VENUES, roomName
 ├─ render/
 │   ├─ stage.js      bộ máy canvas: bố cục, camera, cache, sắp lớp theo độ sâu, chữ / bong bóng / emoji, chạm / chụm
 │   ├─ persp.js      phép chiếu phối cảnh một điểm tụ, khối hộp 3D, trải sàn "mode 7"
 │   ├─ venues/       chủ đề vẽ từng rạp (index.js = sổ đăng ký + nạp động; nhung.js, congvien.js, doxe.js, bien.js)
 │   ├─ hall.js       bộ vẽ Rạp Nhung Đỏ + drawIdleScreen, STAGE_H (dùng chung)
 │   ├─ character.js  nhân vật chibi đủ bộ phận (chép VibeCorp + dáng nam / nữ, râu, tư thế ngồi bệt, khung anim)
 │   ├─ anims.js      công thức 8 động tác (hàm thuần của thời gian) + emoji bay theo động tác
 │   ├─ bubbles.js    bong bóng chat, bảng tên (chép VibeCorp)
 │   └─ draw.js       màu, hình cơ bản, gradient, FONT, drawEmoji, makeCanvas
 └─ ui/
     ├─ join.js      màn vào rạp: chọn rạp, tên, bộ chọn ngoại hình + nhân vật xem trước
     ├─ queue.js     thẻ Đang chiếu, ô dán link, hàng chờ, bỏ phiếu, báo cáo video
     ├─ chat.js      khung chat (ngăn kéo), ô nhập trên dock, bảng emoji, khung chat nổi
     ├─ wheel.js     vòng chọn 8 động tác
     ├─ usercard.js  thẻ người xem khi bấm vào nhân vật (vẫy, báo cáo, ẩn riêng, công cụ admin)
     ├─ sheet.js     "tấm" dùng chung (ngoại hình, tùy chọn, hướng dẫn, chọn rạp, báo cáo, quản trị)
     ├─ toasts.js    thông báo nhỏ dưới màn hình
     └─ admin.js     công cụ admin — chỉ import động khi hello.admin = true
```

## 2. Khởi động (`main.js`)

1. Khoá máy `ck` (16 byte hex ngẫu nhiên, `localStorage vc.ck`) — dùng để chống spam / cấm / nhận lại quyền video, không
   chứa thông tin cá nhân.
2. `await adminLoginFromUrl()` — `#admin=<mã>` (hoặc `?admin=`) → gỡ khỏi URL → `POST /api/admin/login`.
3. `createStage(canvas, #screen-slot, hooks)` (hooks: `beforeFrame` = `tickMe`, `onLayout` = đặt `#screen-tools` + biến
   CSS, `screenInfo` = chữ trên màn hình trống, `onPick` = thẻ người xem, `onFloorTap` = `walkTo`, `watching` = đang xem
   chung để làm tối) và `createPlayer(...)`.
4. UI: vòng động tác, thẻ người, hàng chờ, chat, ngăn kéo, dock, bảng cảm xúc, góc xem (📺), toàn màn hình (⛶), ⚙️, ?, 🎨,
   chọn rạp; `initInput`; `syncInsets()`.
5. `initJoin(onSubmit, onQuick)` — màn vào rạp (form đầy đủ, hoặc thẻ "Chào mừng quay lại" khi `isReturning()`);
   `connect()`.
6. Sự kiện store: `hello` (nạp `ui/admin.js` nếu admin; tự `join` lại nếu đang muốn vào — nối lại sau rớt mạng),
   `welcome` (lưu `token` vào `sessionStorage vc.token`, `rememberJoin(phòng)`, ẩn màn vào rạp, `placeMe`, bật chat, cần
   điều khiển, **bật trình phát**), `joinError` / `kicked` (tắt trình phát **trước** rồi mới hiện màn vào rạp; đang ở thẻ
   chào lại mà lỗi không phải tên / cấm thì báo ngay trên thẻ), `replaced` (tab khác đã nhận nhân vật), `venue` (đổi chủ
   đề vẽ), `conn` (băng "Mất kết nối — đang nối lại…").
7. Vào nhanh (`quickJoin(roomId)`): gửi `join` bằng tên + ngoại hình đã lưu (`vc.name`, `vc.look`) và phòng được chọn.
   Đổi rạp khi đã vào (`switchRoom(id)`): **không tải lại trang** — gửi `switch`, canvas tối dần + tải khung cảnh rạp mới
   ngay (`stage.setVenue`), server chuyển nhân vật sang và gửi `welcome` mới → rạp mới sáng dần; server từ chối (đầy,
   trùng tên → `notice` warn) hoặc quá 4 s → sáng lại rạp đang ở. Mở trang mà là người quay lại và URL có `?phong=` hợp lệ
   (hoặc cờ cũ `vc.autojoin`) → tự `quickJoin` ngay khi nhận `hello`.
   **Mở trang mượt**: `<html class="booting">` che thẻ vào rạp + cụm nút, hiện vòng chờ "Đang mở rạp…"; `main.js` bỏ
   lớp này khi đã dựng xong + nhận `hello` đầu tiên + phông chữ sẵn sàng (tối đa 2,5 s; CSS tự hiện sau 6 s nếu JS hỏng)
   → thẻ hiện đủ một lần, không còn cảnh ô đặt tên hiện trước rồi bảng nhân vật mới hiện sau. Server chèn
   `<link rel="modulepreload">` cho mọi module (`app.ts MODULE_PRELOADS`, thay `<!-- %MODULEPRELOAD% -->`) → tải song
   song thay vì lần lượt theo chuỗi import. Rảnh thì tải sẵn các rạp khác (`prefetchThemes`).
8. `window.__vc` (§15).

## 3. Bố cục: canvas tràn cửa sổ + giao diện nổi

```
┌ #hud-l: 🎬 · ô phòng ──────────────────────────────── #hud-r: 📺 ⛶ 🎨 ⚙️ ? 🛠 ┐
│              ┌──────────── diềm / dải trên (band) ────────────┐              │
│              │        #screen-slot  (iframe YouTube)          │   #side      │
│              └────────────────────────────────────────────────┘   (ngăn kéo  │
│              #screen-tools: ▶ 🔊 📋 tên ⏭ 🔊━━ ⛶ 🚩  (trên sân khấu)   máy tính) │
│        ╲  sân khấu / sàn nhảy / ghế / người (phối cảnh, cắt dưới mép video) ╱  │
│ #chat-feed      ╲                                                ╱             │
│ #joystick (đt)   └──── #dock: 😀 🎭 [ô chat] 📋 💬 ────┘                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Canvas `#hall` phủ cả `#stage`. DOM nổi: `#hud-l`, `#hud-r`, `#dock`, `#side` (ngăn kéo 2 thẻ: 📋 Hàng chờ / 💬 Trò chuyện),
  `#sheet` (tấm), `#screen-tools`, `#chat-feed`, `#joystick`, `#wheel`, `#user-card`, `#toasts`, `#conn`, `#focus-hint`.
- Breakpoint (khớp giữa `main.js` và `style.css`): `DESK` = `(min-width: 900px), (min-width: 640px) and (max-height:
  519px)` → ngăn kéo / tấm là **thẻ nổi bên phải** (video dời sang trái); ngược lại là **tấm trượt từ dưới** (mép trên
  `--sheet-top` = ngay dưới video, mép dưới sát dock), ngăn kéo có 2 thẻ (📋 / 💬). `SHORT` = `max-height: 519px` (điện
  thoại ngang): dock nổi đè lên lối đi cuối rạp, không chừa chỗ. `FEED` = `min-width 900 & min-height 520`: có khung
  chat nổi góc dưới trái khi ngăn kéo đóng. `stage.js` coi `< 720 px` là màn hẹp (camera lia, chữ to hơn); `≤ 719 px` ẩn 📺.
- `main.js syncInsets()` đo các cụm rồi gọi `stage.setInsets({ right, bottom, hudH, hudL, hudR })`: `right` = bề rộng
  ngăn kéo / tấm bên phải đang mở (`--side-w` + 20), `bottom` = chiều cao dock, `hudH / hudL / hudR` = mép dưới / bề
  ngang hai cụm góc trên. Gọi lại khi đổi cỡ (ResizeObserver), mở / đóng ngăn kéo, tấm (`onSheetChange`).
- `stage.computeLayout()`:
  - `availW = cssW − right`; mép gần khán phòng `Yn = max(62 % chiều cao, cssH − bottom)` (sàn vẫn vẽ tràn dưới dock).
  - **Góc xem** (`stage.setView`, nút 📺, nhớ `localStorage vc.view`, mặc định `lon`) quyết định khán phòng giữ tối
    thiểu bao nhiêu (`audMin`): `can` (Cân) `clamp(Yn × 0,38, 240, 340)` · `lon` (Màn lớn) `clamp(Yn × 0,3, 200, 260)` ·
    `rong` (Màn rộng) `clamp(Yn × 0,2, 150, 190)`; màn hẹp: 300+ (½ chiều cao) / 210 / 180.
  - `fit(top, maxW)` xếp video 16:9 rộng nhất có thể (3 vòng để khớp khoảng màn → mép sân khấu). **Tối thiểu 200×200**;
    chạm mức đó thì giữ 356×200 (đúng 16:9, không viền đen).
  - Thử hai cách: (A) video sát mép trên, hẹp vừa đủ để hai cụm nút góc nằm hai bên; (B) video lùi xuống dưới cụm nút —
    chọn cách cho video to hơn. Cụm góc chỉ đè lên diềm / dải trên, **không bao giờ đè video**.
  - Từ bề rộng video suy ra cỡ ô ở tường cuối (`sw`), `s0` (px / ô ở mép sân khấu), `s1 = 1,45 · s0` (cuối rạp), `Yf`
    (mép sân khấu trên màn), `audTop`. Máy tính: tường cuối rộng hơn video chút để thấy hai tường chụm vào nhưng hàng ghế
    cuối vẫn lọt khung; màn hẹp: tường cuối rộng hơn khung nhìn (nhân vật đủ to), camera lia theo mình.
- `onLayout` → `main.layoutOverlays(L)`: đặt `#screen-tools` ngay dưới video (giữa video và mép sân khấu), biến CSS
  `--aud-top` (toast, băng kết nối đặt từ đây xuống) và `--sheet-top`.

## 4. Phối cảnh (`render/persp.js`)

Nhìn từ cuối rạp, trên cao, về phía màn hình. Toạ độ thế giới: `x` ngang (ô), `z` = độ sâu (= `y` của mô phỏng: 0 ở mép
sân khấu, `H` = 16 ở cuối rạp), `h` = độ cao (ô).

- `projection({ Xc, Yf, Yn, s0, s1, H, xcam })`: `s(z)` (px / ô) và `sy(z)` (px mặt sàn) **tuyến tính** theo `z` — vẫn
  là phép chiếu phối cảnh hợp lệ (đường dọc theo `z` chụm về điểm tụ, đường ngang giữ ngang, đường đứng giữ đứng), chỉ
  "giãn" trục sâu cho các hàng ghế cách đều trên màn. Hàm: `pt(x, z, h)` → px, `inv(px, py)` → `(x, z)` trên sàn (chạm để
  đi), `sx`, `sy`, `vp()` (điểm tụ).
- `box(ctx, P, x0, x1, z0, z1, ht, colors, hb)`: khối hộp 3D (mặt bên chỉ vẽ khi camera thấy, rồi mặt trên, mặt trước),
  trả khung bao + 4 góc mặt trước.
- `drawFloor(ctx, P, tex, dpr, yTop, yBottom, step)`: trải texture sàn nhìn từ trên xuống — mỗi dải ngang màn hình ứng
  một độ sâu, cắt đúng một hàng texture kéo giãn theo `s(z)` (kỹ thuật "mode 7").
- Màn chiếu nằm trên tường cuối, **song song mặt nhìn → không méo**: khung YouTube là hình chữ nhật đặt khít.

## 5. Vòng vẽ (`render/stage.js`)

`requestAnimationFrame` → `frame()` → `draw(now)` (mọi thời gian dùng `performance.now()`, cùng đồng hồ với store):

1. `resize()` (đổi cỡ / DPR → `relayout`), `beforeFrame` (= `tickMe`: mô phỏng nhân vật mình), `updateCamera`.
2. `ensureCaches()`: texture sàn (`V.floorTexture(48)`, một lần mỗi chủ đề); **dải trên** (`V.renderBand`, khoá theo cỡ
   + DPR + góc xem + chủ đề); **phòng** (`V.drawRoom` vào canvas phụ, khoá thêm theo camera `xcam` lượng tử 0,02 ô + zoom);
   **hàng ghế** (`V.renderRow` mỗi hàng → sprite, vẽ ở `xcam` giữa rồi dịch ngang khi camera lia).
3. Tô nền `V.void`, dán dải trên + phòng. `V.skyFx` (nếu có, cắt bỏ khung video). Chưa có video / chưa vào rạp →
   `drawIdleScreen` vẽ chữ lên ô màn hình (khung iframe đang ẩn).
4. **Clip dưới mép video** (`L.vb`), rồi: `prepareActors` (vị trí, alpha hiện / mờ dần, ngồi ghế suy từ `seatAt`, lọc
   người bị ẩn theo ⚙️) → `V.drawDanceLights` (người đang nhảy hip hop / lắc đầu / nhún) → **sắp theo độ sâu** (key tăng
   dần = xa → gần): sprite hàng ghế (`key = z + 0,32` — người ngồi ở `z` vẽ **trước** lưng ghế hàng mình nên lưng ghế che
   thân dưới, chỉ thấy đầu + vai), loa, quầy, vật trang trí `props()`, nhân vật (`key = y`) → `V.fx`, `V.drawBeam` (chỉ khi
   đang chiếu), `V.drawHallLight`.
5. **Làm tối khi đang chiếu** (⚙️ "Làm tối xung quanh": tắt / nhẹ 0,22 / vừa 0,38 / đậm 0,55, chuyển dần ~0,5 s): phủ
   một lớp tối lên canvas khi `watching()` (đã vào rạp + đang chiếu + không dừng). Canvas nằm **dưới** iframe nên video
   không bị phủ.
6. Lớp chữ (clip lại dưới mép video, vẽ sau lớp tối nên vẫn rõ): bảng tên (mình viền vàng + mũi tên; chồng nhau đẩy lên
   — `spreadPills`), bong bóng chat neo trên tên (`drawBubbles`), emoji bay (neo theo thế giới lúc sinh, bay lên theo px).

Nhân vật: cỡ = `s(z) × cs` (`cs` 0,85 máy tính / 0,95 màn hẹp) → càng gần màn hình càng nhỏ. Rạp đông (> 24 người) hoặc
máy yếu: người đứng / ngồi yên, không nói, không làm động tác → vẽ từ **sprite cache** theo (ngoại hình, tư thế, hướng,
cỡ, DPR) — một `drawImage` thay cho cả trăm nét vẽ (cache ≤ 300 mục).

Tên trên đầu: ⚙️ "Tên trên đầu" — `all` · `auto` (mặc định: > 24 người thì chỉ hiện mình, người đang rê chuột, người mới
vào < 6 s, người đang nói) · `off` (chỉ tên mình).

Chạm / bấm (`pointerup` < 600 ms, không kéo > 9 px, nằm dưới mép video): trúng người (ưu tiên người gần camera) →
`onPick` (thẻ người xem); trúng ghế (`pickSeat` dò theo hình chiếu lưng ghế) → đi tới ngồi; trúng sàn → `P.inv` →
`walkTo`. Hai ngón → chụm phóng `zoom` 0,6–1,6 (chỉ áp trên màn hẹp). Chuột rê: con trỏ tay trên người, chữ thập trên sàn.

Camera: máy tính đứng giữa (`xcam = W/2`), thấy cả hộp rạp. Màn hẹp: lia ngang theo nhân vật mình (vùng chết 1,5 ô,
`lerp 0,12`), kẹp trong biên tường; dải trên đứng yên.

## 6. Chủ đề rạp (`render/venues/`)

Bốn rạp trong `VENUES` (`shared/hall.js`): `nhung` 🎭 Rạp Nhung Đỏ (mặc định), `congvien` 🌳 Rạp Công Viên, `doxe` 🚗
Rạp Đỗ Xe, `bien` 🏖️ Rạp Bãi Biển. **Mọi rạp dùng chung sơ đồ `HALL`** (đi lại, ghế, va chạm, sàn nhảy, loa, quầy giống
hệt — server không biết gì về hình); chủ đề chỉ đổi **cách vẽ**.

- `venues/index.js`: `THEMES` (Map, Rạp Nhung Đỏ nạp sẵn), `LOADERS` (`id → () => import('./<id>.js')` — rạp khác
  **nạp động** khi cần, trang nhẹ hơn), `defaultTheme` (= nhung), `themeOf(id)` (chủ đề đã nạp hoặc `null`),
  `loadTheme(id)` (Promise luôn thành công: id lạ hoặc file lỗi → Rạp Nhung Đỏ, các rạp khác vẫn chạy).
- `stage.setVenue(id)` (gọi khi `store` phát `venue`): `loadTheme(id)` → nếu vẫn là rạp muốn xem thì đổi `V`, gọi
  `V.props()`, xoá mọi cache (sàn, dải trên, phòng, hàng ghế, sprite người).
- `nhung.js` bọc bộ vẽ `render/hall.js` (`renderRow` trả mảng một sprite, `props: () => []`).

**Giao diện một chủ đề** (object `export default`, stage gọi):

| Thành phần | Chữ ký → trả về | Ghi chú |
|---|---|---|
| `id`, `void` | chuỗi, màu nền canvas | `id` trùng id rạp |
| `floorTexture(scale)` | `{ canvas, x0, x1, z0, z1, scale }` | sàn nhìn từ trên (px texture / ô = `scale`), vẽ một lần, `drawFloor` trải theo phối cảnh |
| `renderBand(L, dpr)` | `{ canvas, h }` | dải phía trên (trời / tường cuối + khung màn hình), px CSS, cache theo bố cục. Ô `L.screen` phải để trống / tô đen (iframe nằm đè lên) |
| `drawRoom(ctx, P, tex, L, dpr, step)` | — | sàn + hai bên + bục trước màn hình (cache theo camera). Thứ cao vẽ đè lên dải trên phải **cắt bỏ khung video** (xem `hall.js drawRoom`: `clip('evenodd')`) |
| `renderRow(P, i, dpr)` | `[sprite…]` | hàng ghế `i`: `{ kind: 'row', key, z, canvas, x0, y0, w, h, xcam, s }`; `key = z + 0,32` (trước mặt người ngồi) hoặc `z − 0,3` (lớp phía sau người ngồi) |
| `props()` | `[{ key, x, z, draw(ctx, P, now) }]` | vật trang trí sắp theo độ sâu cùng người (cây, cột đèn…); stage bỏ những cái ngoài khung |
| `drawSpeaker(ctx, P, sp, now)`, `drawCounter(ctx, P, c, now)` | — | hai loại vật cản có sẵn trong `HALL` (loa, quầy) — vẽ thành gì tuỳ rạp nhưng **giữ đúng chỗ va chạm** |
| `drawDanceLights(ctx, P, dancers, now)`, `drawBeam(ctx, L, now, motes)`, `drawHallLight(ctx, P, L, playing)` | — | hiệu ứng; `drawBeam` chỉ gọi khi đang chiếu; tắt khi máy yếu (mức 2) hoặc ⚙️ "Đèn & hiệu ứng" tắt (trừ `drawHallLight`) |
| `skyFx?(ctx, L, now)` | — | tuỳ chọn: hiệu ứng mỗi khung trên dải trên (stage đã cắt bỏ khung video) |
| `fx?(ctx, P, L, now)` | — | tuỳ chọn: hiệu ứng mỗi khung trên khán phòng |

`drawIdleScreen` và `STAGE_H` (cao sân khấu, dùng tính `audTop`) lấy chung từ `render/hall.js`. Thêm rạp mới: [08](08-mo-rong.md) §1.

### 6.1 Từng rạp trông thế nào

| Rạp | File | Dải trên (trời / màn hình) | Sàn + hai bên | Ghế (hàng) | Loa · quầy | Mỗi khung |
|---|---|---|---|---|---|---|
| 🎭 Rạp Nhung Đỏ | `nhung.js` → `render/hall.js` | tường cuối tiêu âm, màn nhung + dây vén, diềm tua vàng | thảm có bậc theo hàng ghế, lối đi đèn LED, tường ốp gỗ + đèn tường + biển LỐI RA, sân khấu gỗ đèn chân | ghế nhung đỏ khối 3D (1 lớp) | loa cột · quầy "BẮP NƯỚC" | sàn nhảy LED nháy theo người nhảy, đốm đèn quét |
| 🌳 Rạp Công Viên | `congvien.js` + `-band`, `-floor`, `-art` | trời đêm có dải Ngân Hà mờ, trăng (trái màn hình), phố xa có cửa sổ sáng, hàng cây; màn hình **bơm hơi** (ống viền + 2 trụ + dây néo; điện thoại dọc bỏ dây néo) | cỏ đêm có vệt cắt, lối sỏi theo lối đi, thảm picnic ca rô dưới từng dãy ghế, sàn gỗ có đèn dây; cây tròn + cột đèn công viên + dây đèn + hàng rào cây (vẽ trong `drawRoom`) | **gối lười** pastel, 2 lớp (thân sau lưng người ngồi `z−0,3` + lưng gối trước `z+0,32`), cao theo độ dốc camera | loa chân máy · xe bắp rang mái sọc "BẮP NƯỚC" | 18 đom đóm, sao lấp lánh, sao băng; vũng màu theo nhịp dưới người nhảy |
| 🚗 Rạp Đỗ Xe | `doxe.js` + `-band`, `-floor`, `-car`, `-props` | trời sao, đồi + phố nhỏ, cột ăng-ten; **tháp màn hình** khung thép; biển neon "DRIVE / IN" bóng đèn chạy (máy tính + điện thoại ngang; dọc không đủ chỗ thì bỏ) | nhựa đường có vân, vết nứt, vết dầu; vạch đỗ xe mỗi 2 ghế, mũi tên lối đi, sàn nhảy ca rô viền neon hồng / xanh; hàng rào lưới + đèn bãi xe có quầng sáng (trong `drawRoom`) | **xe mui trần** pastel, 1 xe / 2 ghế, 2 lớp (đầu xe + thân sau lưng người ngồi, lưng ghế + đuôi xe + đèn hậu trước mặt) | loa thùng + loa kèn · quầy "SNACK BAR / BẮP NƯỚC" (cache theo camera) | bóng đèn biển neon chạy, "IN" chập chờn, đèn ăng-ten, sao băng, thiêu thân quanh đèn; ô ca rô sáng dưới người nhảy |
| 🏖️ Rạp Bãi Biển | `bien.js` + `bien-art.js` | trời sao, trăng tròn (phải màn hình), biển lấp lánh ánh trăng, đảo có hải đăng, đèn thuyền câu mực, thúng chai; màn hình treo trên **giàn tre** có dây đèn | cát đêm gợn gió, dấu chân, vỏ sò, sao biển; sàn gỗ ván dọc + dây đèn; dừa, đuốc tiki, ván lướt sóng, lâu đài cát, hàng rào dây + phao (trong `drawRoom`) | **ghế xếp** khung gỗ vải sọc (8 cặp màu cố định theo ghế, ~10 % có khăn), 1 lớp, lưng cao theo độ dốc camera | loa khung tre mái lá · quầy tiki mái lá "NƯỚC DỪA" | lửa đuốc bập bùng + tàn lửa, sóng vỗ, ánh trăng chạy trên biển, hải đăng nháy, sao băng; vũng sáng ấm + đốm màu khi nhảy |

### 6.2 Kinh nghiệm khi vẽ một rạp (từ lúc làm 3 rạp ngoài trời)

- **Đồ trang trí ngoài hàng rào (x < 1 hoặc x > 33) vẽ trong `drawRoom`, không dùng `props()`.** `props` được vẽ trong
  vùng cắt bắt đầu từ mép dưới video (`L.vb`) nên ngọn cây / đèn cao bị cắt bằng ở góc "Màn rộng" và điện thoại ngang;
  còn trong phép chiếu này vật xa hơn ra hai bên không bao giờ che người đi trong rạp, nên để ở lớp phòng (cache) vẫn
  đúng thứ tự trước sau. Cả 3 rạp ngoài trời đều trả `props: () => []`.
- **Hàng ghế 2 lớp tốn kém trên điện thoại**: mỗi lớp là một ảnh rộng bằng cả rạp (~3 ms / khung ở DPR 2,5). Chỉ thêm
  lớp sau lưng người ngồi khi thật cần (xe mui trần, gối lười); giữ khung ảnh sát nội dung.
- **Chiều cao lưng ghế nên theo độ dốc camera** (`P.k / P.s`): điện thoại dọc nhìn gần từ trên xuống, lưng ghế cố định
  sẽ hở cả thân người ngồi.
- **Vẽ lại hàng ghế khi chụm phóng** (điện thoại) tốn 8–15 ms mỗi bước; đứng yên thì không vẽ lại.
- Loa / quầy vẽ mỗi khung → cache thành ảnh nhỏ theo cỡ (Đỗ Xe đọc DPR từ `ctx.getTransform().a`).
- `skyFx` được gọi **sau** lớp phòng: hiệu ứng trên trời có thể vẽ đè lên cây cao bên cạnh màn hình → giới hạn vùng sao
  phía trên đường cây / phố (Công Viên làm vậy). Bãi Biển cần phép chiếu `P` trong `skyFx` để vẽ lửa đuốc nhô lên trên
  `L.vb` nên lưu lại `P` từ `drawRoom`; lửa đuốc dưới thấp chạy trong `drawDanceLights` (hook duy nhất gọi mỗi khung
  trước khi vẽ người — tắt "Đèn & hiệu ứng" thì đuốc hai bên đứng yên).

**Hướng cải thiện giao diện chủ đề** (chưa làm, gom từ các người vẽ rạp): truyền `P` cho `skyFx` và gọi nó giữa dải
trên và lớp phòng; thêm hook "dưới người" mỗi khung (thay cho việc mượn `drawDanceLights`); truyền `L` (hoặc `L.cs`) cho
`renderRow` để tính đúng chiều cao lưng ghế; truyền `dpr` cho `drawSpeaker` / `drawCounter`; đưa cỡ cụm nút góc trên
vào `L` để dải trên tránh chính xác; cho `props` một cờ "chỉ cắt khung video" thay vì cắt từ `L.vb`; giảm vẽ lại hàng
ghế khi chụm phóng; xem lại giá của chùm máy chiếu (`drawBeam`) trên điện thoại.

## 7. Nhân vật & động tác (`render/character.js`, `render/anims.js`)

- `drawCharacter(ctx, look, o)`: chibi vẽ thủ tục từ `look`, cao ~1,95 ô, đầu ≈ 45 %; toạ độ cục bộ `(0,0)` = điểm
  chân, 1 đơn vị = 1/`U` ô (`U = 24`), y hướng xuống. Nhận ra từ sau lưng nhờ tóc + áo + phụ kiện. `o`: `dir` (down / up /
  left / right — phải = lật gương của trái), `pose` (`stand` / `sit` ghế / `floor` ngồi bệt), `moving`, `phase` (nhịp
  bước), `t`, `seed`, `mood` (`moodOf(emoji)`: happy / shock / sad / neutral), `talking`, `blink`, `hold` (vd `popcorn`),
  `anim` (§ dưới). `headTop(pose)`, `headCenter(pose)`, `HEAD_RADIUS` để neo tên / bong bóng / emoji.
- Dáng **nam** (`look.body = 'nam'`): vai rộng (15,8 so với 13,6), mày đậm gần thẳng (màu theo tóc), không má hồng, râu
  tuỳ chọn (`facial`: `ria` ria mép, `rau` quai nón). **Nữ**: vai thon, lông mi, má hồng, môi hồng. 8 kiểu tóc
  (`short, spiky, curly, bob, long, bun, ponytail, bald`), 10 màu tóc, 7 màu da, 14 màu áo, 7 màu quần, phụ kiện
  (`none, glasses, headphones, cap, bow, tie`). Bảng giá trị hợp lệ ở `shared/hall.js` (`normalizeLook`).
- `actionPose(id, t, view, seated, dir)` là **hàm thuần của `t`** (ms kể từ lúc bắt đầu) → `{ anim, pose?, hold?, dir? }`;
  `anim`: `bob, bx, lean, pivot, liftY, headDY, headTilt, squat, legL, legR, stride, arms {l, r, near, far: {a, len,
  hold}}, front, heart, mouth, eyes, mood`. Mọi máy tính từ cùng `t` → cùng nhịp.
- 8 động tác (`ACTIONS`, phím 1–8): 👋 Vẫy tay chào (2,4 s) · 👏 Vỗ tay (3 s) · 🕺 Nhảy hip hop (lặp, không làm khi
  ngồi) · 🤘 Lắc đầu quẩy (lặp) · 🎶 Nhún nhảy (lặp) · 🍿 Ngồi xem (lặp; có ghế thì ngồi ghế, không thì ngồi bệt + hộp
  bắp rang) · ❤️ Thả tim (2,2 s) · 🤣 Cười lăn (3,6 s, ngã ra sàn; không làm khi ngồi). Động tác không làm được khi ngồi
  → đứng dậy tại ghế. Đi là thôi động tác. Bấm lại điệu đang lặp = thôi.
- `ACTION_FX`: emoji tự bay khi bắt đầu + nhịp lặp (🎵 khi nhảy, ❤️ khi thả tim, 😂 khi cười lăn) — tắt được trong ⚙️.
- Ngồi ghế: dừng cách ghế trống ≤ 0,42 ô (hoặc bấm vào ghế) → tự trượt vào, quay lên màn hình. Tư thế suy từ vị trí
  (`seatAt`) nên không cần gửi gì thêm qua mạng.
- `portrait(look, size)` vẽ chân dung (đầu + vai) vào canvas nhỏ — dùng cho thẻ "Chào mừng quay lại". `bubbles.js
  drawEmote / drawSign`, `draw.js fitText / softShadow / topEdge` là di sản VibeCorp, hiện chưa dùng.

## 8. Nhân vật của mình & điều khiển (`me.js`, `input.js`, `ui/wheel.js`)

- `tickMe(dt, now)` mỗi khung: phím / cần ảo / điểm đích → vận tốc (`SPEED` = 3,4 ô/s; cần ảo có vùng chết 0,14, tốc độ
  40–100 %) → `moveWithCollision` (**cùng hàm** server dùng để kiểm) → hướng → tự ngồi khi dừng sát ghế → `sendIfNeeded`:
  đang đi ≤ 15 tin / s, vừa dừng gửi ngay, đổi hướng tại chỗ ≥ 60 ms một lần; `c = performance.now()` làm tròn; toạ độ 2
  số lẻ.
- `walkTo(x, y)` (chạm sàn / ghế): đi thẳng tới, kẹt vật cản 450 ms thì thôi. `doAction(id)`: 🍿 khi chưa ngồi → tìm ghế
  trống trong 0,9 ô, đi tới rồi mới ngồi. `react(e)`: gửi `emo` + hiện ngay trên máy mình.
- Server sửa (`corr`): `applyCorrection` kéo mượt 180 ms (lệch ≥ 2,5 ô thì nhảy luôn).
- `input.js`: `WASD` / mũi tên theo `e.code` (đúng cả bàn phím tiếng Việt), `E` vòng động tác, `1`–`8` làm ngay, `Enter`
  focus ô chat, `Esc` đóng lần lượt (vòng → thẻ người → tấm → bảng cảm xúc → menu góc xem → ngăn kéo). Đang gõ trong ô
  nhập / màn vào rạp / tấm đang mở → không bắt phím. Mất focus (bấm vào iframe, đổi tab) → nhả hết phím; focus kẹt trong
  iframe → trả về canvas, vẫn kẹt thì hiện "Bấm vào khán phòng để điều khiển nhân vật".
- Điện thoại: cần điều khiển ảo `#joystick` (hiện khi màn cảm ứng hoặc hẹp), chạm sàn để đi tới, chạm ghế để ngồi, nút 🎭
  trên dock, chụm hai ngón để phóng.
- Vòng động tác: 8 nút xếp tròn quanh nhân vật mình (luôn dưới mép video, trên dock), phím mũi tên chuyển nút, bám theo
  nhân vật mỗi 120 ms.

## 9. Giao diện DOM (`ui/*`)

| Phần | Module | Chi tiết |
|---|---|---|
| Màn vào rạp `#join` | `join.js` | lớp phủ toàn trang (lúc này **trình phát chưa bật** nên không đè video đang chạy). **Lần đầu** (`#join-form`): chọn rạp (4 thẻ + số người; bấm → `spec` xem trước rạp đó ngay phía sau), tên 2–20 ký tự (nhớ `vc.name`), bộ chọn ngoại hình `lookEditor` (Dáng người 👨 / 👩 · Màu da · Kiểu tóc · Màu tóc · Áo · Quần · Phụ kiện · Râu — chỉ nam; đổi dáng thì tóc / phụ kiện quá "đặc trưng" tự đổi theo), 🎲 Ngẫu nhiên, nhân vật xem trước động (`startPreview`), link chính sách. **Người quay lại** (`#join-quick`, khi `vc.returning = 1` và còn tên hợp lệ): chân dung (`portrait`), "Chào mừng quay lại 👋 <tên>", danh sách phòng (`RoomInfo`: số người / sức chứa, "Đang chiếu: …" hoặc mô tả rạp; phòng lần trước `vc.room` lên đầu với nhãn "LẦN TRƯỚC"; phòng đầy bị khoá) → bấm là `quickJoin`; "✏️ Đổi tên / nhân vật" về form |
| Cụm góc trên trái | `main.js` | 🎬 (về trang chủ) + ô phòng (emoji rạp, tên, `người/sức chứa`) → tấm "🎬 Chọn rạp" (đứng xem: `spec`; đã vào: tải lại `/?phong=`) |
| Cụm góc trên phải | `main.js` | 📺 menu góc xem (Cân / Màn lớn / Màn rộng) · ⛶ toàn màn hình cả rạp (ẩn nếu trình duyệt không hỗ trợ) · 🎨 đổi ngoại hình (sau khi vào) · ⚙️ tùy chọn · ? hướng dẫn · 🛠 quản trị (admin) |
| Dưới màn hình `#screen-tools` | `main.js`, `queue.js` | "▶ Bấm để xem", "🔊 Bật tiếng", "📋 Dán link YouTube để chiếu" (khi trống / đang phát kênh mặc định), tên video, ⏭ Bỏ qua `n/need` (ẩn với kênh mặc định), 🔊 + thanh âm lượng, ⛶ video, 🚩 |
| Dock `#dock` | `main.js`, `chat.js` | 😀 bảng 8 emoji (mở rồi bấm liên tục được) · 🎭 vòng động tác · ô chat (≤ 140, tắt khi chưa vào) · 📋 hàng chờ (badge số bài) · 💬 trò chuyện (badge chưa đọc) |
| Ngăn kéo `#side` | `queue.js`, `chat.js` | máy tính: thẻ nổi bên phải chứa cả Đang chiếu + Hàng chờ + Trò chuyện, nhớ mở / đóng (`vc.side`); điện thoại dọc: tấm trượt 2 thẻ |
| Đang chiếu | `queue.js` | badge (ĐANG CHIẾU / TRỰC TIẾP / TẠM DỪNG / KÊNH MẶC ĐỊNH / MÀN HÌNH TRỐNG), tên, kênh + người thêm, thanh tiến độ theo đồng hồ phòng, nút bỏ phiếu (người thêm: "Bỏ qua video của mình"), 🚩, nút admin |
| Hàng chờ | `queue.js` | ô dán link (khoá → chỉ admin), kết quả `q_res` tự ẩn, danh sách (✕ xoá bài của mình / admin, ⬆ admin đưa lên đầu), bài mới trượt vào |
| Trò chuyện | `chat.js` | đang ở cuối thì bám tin mới; đang kéo lên đọc thì hiện "↓ N tin mới"; tin `notice` loại `info` thành dòng hệ thống; giữ 120 dòng. Khung chat nổi `#chat-feed` (máy tính, ngăn kéo đóng): 4 tin mới nhất, mờ sau 12 s, không chặn bấm |
| Thẻ người xem `#user-card` | `usercard.js` | tên, trạng thái; 👋 Vẫy chào, 🚩 Báo cáo; "Chỉ trên máy bạn": 🔇 Ẩn tin nhắn / 🙈 Ẩn động tác / 👻 Ẩn người này; admin: 🔇 10 phút / 1 giờ, 🔊, 👢 Mời ra, ⛔ Cấm 1 ngày / hẳn |
| Tấm `#sheet` | `sheet.js` | `openSheet(id, title, content, onClose)`; máy tính: thẻ bên phải (video dời trái), điện thoại: trượt lên từ `--sheet-top` |
| Toast | `toasts.js` | tối đa 3, không lặp cùng chữ trong 2,5 s, đặt từ `--aud-top` + 48 px (không bao giờ trên video) |
| Quản trị 🛠 | `admin.js` | chỉ import khi `hello.admin`. Bỏ qua / dừng / chiếu tiếp / khoá / xoá chat; tab 👥 Người xem, 🚩 Báo cáo, ⛔ Bị cấm, 🚫 Video bị gỡ; "🚪 Thoát admin trên máy này". Gắn thêm nút vào thẻ Đang chiếu / hàng chờ / thẻ người qua `registerAdminHooks`, `registerUserAdmin` |

Tự làm mờ nút (⚙️ "Tự làm mờ các nút", mặc định bật): đang xem chung mà không động chuột / chạm / phím 4 s (và không mở
bảng nào, không gõ) → `body.ui-quiet` làm mờ cụm góc, dock, `#screen-tools` (vẫn bấm được); động là hiện lại. `body.watching`
được bật khi đang xem chung.

## 10. Trạng thái client (`store.js`)

`store` giữ: `ready`, `conn`, `joined`, `myId`, `token`, `admin`, `cfg` (`PublicSettings`), `rooms`, `roomId`,
`roomName`, `venue`, `players` (Map id → actor), `queue`, `locked`, `now`, `votes`, `chat`, `bubbles`, `fx`, `clock`,
`net`. `handleMessage(msg)` là điểm vào duy nhất cho mọi `ServerMsg` (đọc phòng thủ, chuỗi bị cắt độ dài).

Sự kiện (`store.on(type, fn)` → hàm huỷ): `hello`, `welcome`, `joinError`, `players`, `queue`, `now`, `votes`, `chat`,
`chatReset`, `queueResult`, `correct`, `notice`, `rooms`, `venue`, `kicked`, `admin`, `conn`, `replaced`.

Actor (người trong phòng): `{ id, name, look, ghost, x, y, dir, kf[] (mốc nội suy), off, lastCt, moving, moveAmt, phase,
seed, act {id, def, start}, bornAt, goneAt, isMe, emo, emoAt, alpha, seated }`. Người rời (`pl`) mờ dần 450 ms rồi xoá.

## 11. Mượt: netcode phía client

Bài học từ VibeCorp: giật trên production là do **so le WebSocket qua Cloudflare**, không phải CPU → dấu thời gian trong
gói + bộ đệm phát.

- **Mình**: đi ngay trên máy (dự đoán), server chỉ sửa khi lệch (§8).
- **Người khác — phát lại đều theo đồng hồ người gửi** (`store.pushSample` / `actorPos`, bản 0.4.3). Mỗi gói vị trí mang
  `c` = giờ máy người gửi. Máy mình xếp gói theo `c` (hàng `a.q`) rồi **phát lại đúng đường, đúng tốc độ người kia đã
  đi** (cần analog đẩy nhẹ → đi chậm cũng đúng chậm), trễ sau họ một khoảng **đệm** `a.buf`; mốc đang phát `a.pc` tính
  bằng giờ người gửi, vị trí = nội suy thẳng giữa 2 gói kẹp `a.pc`.
  - Gói tới dồn cục / lệch nhịp không ảnh hưởng (vị trí đặt theo `c`, không theo lúc tới).
  - Mạng khựng ngắn hơn đệm → không ai thấy. Dài hơn → hình **đứng chờ** ở điểm cuối đã biết rồi đi tiếp **đúng tốc độ**
    — không bao giờ nhảy, không chạy nhanh đuổi theo (`store.net.dry` đếm số lần, `holdMs` tổng thời gian chờ).
  - Đệm tự chỉnh từng người: `a.gap` = khoảng trống dài nhất giữa 2 lần nhận gói lúc người kia đang đi (co dần
    `e^(−0,04·t)`, ~17 s co một nửa; trống > 4 s là ẩn tab / rớt mạng, không tính); `a.buf = clamp(gap + 40, 110, 1600)` ms.
    Mạng êm (trỏ thẳng VPS) ~110 ms.
  - Đổi đệm chỉ khi nhân vật **đứng yên** (dời mốc phát lúc đứng yên không ai thấy) hoặc đi nhanh / chậm **tối đa 4 %**
    (`RATE_MAX`, mắt không phân biệt được); tụt quá xa (> đệm + 1,5 s, hiếm) mới đuổi 1,2×.
  - Người kia vừa bắt đầu đi sau lúc đứng: chèn một gói "đứng" ngay trước gói đầu (`c − quãng/SPEED`) để bước đầu không
    bị kéo dài ra cả quãng đứng. Chỉ **dịch chuyển tức thời** khi điểm mới xa hơn mức đi bộ được (> 5 ô và
    > `SPEED·1,4·Δc + 0,5`).
  - Hướng mặt: đoạn đang đi lấy hướng gửi kèm gói cuối đoạn; đứng yên giữ hướng gói đầu đoạn. Gói cũ / trùng bỏ theo `c`.
  - Động tác của người khác bắt đầu đúng lúc mốc phát chạm `c` của động tác (`localTimeOf = now + (c − a.pc)`) — đi tới
    nơi rồi mới nhảy.
  - Lịch sử: 0.4.1 "bộ đệm thời gian cố định" → khựng là đứng rồi nhảy; 0.4.2 "đi theo vệt" điều tốc 0,55–2,2× → lúc nhanh
    lúc chậm, người đi chậm (cần analog) bị đi-đứng-đi. Đo cùng bot / cùng mạng giả lập (`npm run qa -- --only smooth`):
    đổi tốc giữa 2 khung p95 14 % → 1 % (mạng sạch), 37 % → 5 % (trễ 150 ms), 26 % → 0,4 % (dồn cục + khựng).
- Vị trí gửi / phát **3 chữ số lẻ** (`me.js round3`, `hub.ts r3`): 2 chữ số làm mỗi bước 33 ms (~0,11 ô) lệch tới ±9 %
  → tốc độ rung nhẹ.
- Nhịp: client gửi `move` tới **30 lần / giây** (`LIMITS.sendHz`), server gom **30 Hz** (`TICK_HZ`); server cho "dồn"
  tối đa 2 s đi bộ (`BUDGET_CAP`) để loạt gói ùa tới sau khi mạng khựng không bị cắt (người đi không bị kéo giật lùi).
- Đo bằng `npm run qa -- --bunch` (người xem giả gửi gói dồn cục 40–140 ms, 4 % lần khựng 0,4–1,2 s — đúng kiểu đo được
  trên production): **0 lần nhảy cóc** (bản cũ 6), bước lớn nhất ~2,4× bước thường (cũ 64×), khựng 1,1 % (cũ 9,1 %).
- **Hướng mặt của mình** (`me.js dirOf`): theo hướng **nhìn thấy trên màn hình** (trục sâu nhân `me.yScale = P.k / P.s`
  ở chỗ mình đứng — phối cảnh nén chiều sâu); gần đường chéo giữ hướng cũ cho khỏi nháy, nhưng **chỉ khi hướng cũ cùng
  phía chuyển động** (lệch ≤ 54°) — không bao giờ quay mặt ra mà đi lùi.
- Động tác của người khác bắt đầu đúng lúc trên trục đã đệm (`localTimeOf(c)`) → không nhảy trước khi dừng chân; người
  vào sau thấy động tác đang dở nhờ `ae`.
- Đồng hồ server (cho video): `offset` từ `hello.s`, chỉnh bằng `ping / pong` (3 s một lần × 8 lúc đầu, sau đó 15 s), giữ
  mẫu RTT thấp nhất ([04](04-youtube-va-phap-ly.md) §6).

## 12. Máy yếu: tự giảm chi tiết (`stage.js measure`)

- Chậm = thời gian JS vẽ trung bình > 11 ms **hoặc** nhịp khung thật > 21 ms (< ~48 khung / s — máy yếu ở khâu tô điểm
  ảnh, JS không thấy được); bỏ qua 6 s đầu và 2,5 s sau mỗi lần đổi bố cục.
- Chậm suốt 150 khung → mức 1 (sprite cho người đứng yên, tắt bụi bay trong chùm máy chiếu); vẫn chậm → mức 2 (DPR tối
  đa 1,25, tắt chùm máy chiếu, đèn sàn nhảy, hiệu ứng chủ đề, emoji lặp theo động tác). Nhanh lại 900 khung → hạ mức, trả
  DPR (tối đa 2 lần, tránh nhấp nháy nét / mờ).
- ⚙️ "Chất lượng hình": `auto` (như trên) · `high` (mức 0, DPR ≤ 2,5, không tự đổi) · `low` (mức 2, DPR ≤ 1,25).
- Cache: dải trên, phòng, hàng ghế, sprite người, texture sàn — máy tính vẽ ~1 ms / khung lúc yên.

## 13. Tùy chọn của người xem (`prefs.js`, nút ⚙️)

Chỉ trên máy này (`localStorage vc.prefs`), không gửi server, không ảnh hưởng người khác. `prefs` (object sống),
`setPref(key, v)`, `onPrefs(fn)` (key, `'hidden'`, `'*'` khi khôi phục), `resetPrefs()`.

| Khoá | Mặc định | Tác dụng |
|---|---|---|
| `dim` | `vua` | làm tối xung quanh khi đang chiếu: `tat` 0 · `nhe` 0,22 · `vua` 0,38 · `dam` 0,55 (`DIM_LEVELS`) |
| `autoHide` | bật | tự làm mờ nút sau 4 s không động khi đang xem |
| `chat` | bật | chat của người khác (khung chat, bong bóng, khung nổi) — tin của mình luôn hiện |
| `bubbles` | bật | bong bóng chat trên đầu |
| `feed` | bật | khung chat nổi góc dưới trái |
| `people` | bật | thấy người khác (tắt = chỉ thấy mình) |
| `names` | `auto` | tên trên đầu: `all` / `auto` / `off` |
| `othersActs` | bật | hoạt ảnh động tác của người khác |
| `emoji` | bật | emoji cảm xúc người khác thả |
| `actFx` | bật | emoji bay theo động tác |
| `lights` | bật | đèn sàn nhảy, chùm máy chiếu, hiệu ứng trời / khán phòng của chủ đề |
| `quality` | `auto` | `auto` / `high` / `low` (§12) |

Ẩn riêng từng người (thẻ người xem): `prefs.hidden[personKey(tên)] = { name, chat, acts, all }` — khoá theo **tên** (id đổi
mỗi lần vào lại), tối đa 300 người. Hỏi nhanh: `showPerson`, `showChatFrom`, `showActsFrom`, `showEmojiFrom` (mình luôn
hiện). Người bị ẩn vẫn được cập nhật vị trí, chỉ không vẽ / không bấm trúng. Danh sách + "Bỏ ẩn" trong tấm ⚙️.

## 14. Lưu trên trình duyệt

| Khoá | Nơi | Nội dung |
|---|---|---|
| `vc.ck` | localStorage | khoá máy ngẫu nhiên |
| `vc.name`, `vc.look` | localStorage | tên, ngoại hình đã chọn |
| `vc.returning`, `vc.room` | localStorage | đã từng vào rạp (`'1'` → thẻ "Chào mừng quay lại"), phòng vào lần trước |
| `vc.view` | localStorage | góc xem (`can` / `lon` / `rong`) |
| `vc.side` | localStorage | ngăn kéo máy tính đang mở |
| `vc.vol`, `vc.muted` | localStorage | âm lượng |
| `vc.prefs` | localStorage | tùy chọn ⚙️ + danh sách người đang ẩn |
| `vc.token` | sessionStorage | token nối lại nhân vật (theo tab) |
| `vc.autojoin` | sessionStorage | cờ cũ (bản tải lại trang khi đổi rạp) — vẫn đọc để tương thích |

Không có cookie nào cho người xem thường (chỉ `vc_admin` HttpOnly cho admin). Đổi những gì lưu → cập nhật trang
`/chinh-sach` ([04](04-youtube-va-phap-ly.md) §10).

## 15. Móc debug / QA

- `window.__vc` (không liệt kê, chỉ-đọc, chỉ dữ liệu đã có trên máy): `{ store, me, view(), player(), isOpen }`.
- `view()` (= `canvas.__view()`): `s0, s1, xcam, zoom, dpr, quality, drawMs, frameMs, crowd, follow, view, venue,
  layout {screen, audTop, Yf, Yn, availW, narrow}, insets, actors, net {buffer, late, frames…}`.
- `player()`: `{ v, state, cur, target, muted }` — so vị trí trình phát với đồng hồ phòng.
- Giật? Xem `__vc.view().net.buffer` (90–200 ms là bình thường) và `npm run qa` (đo `stallRatio`, `hitches`).
