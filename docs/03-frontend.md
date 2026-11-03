# Frontend: canvas, nhân vật, độ mượt, điều khiển

## Phối cảnh 3D (`render/persp.js`)

Khán phòng vẽ theo **phối cảnh một điểm tụ**: như đứng cuối rạp, trên cao, nhìn về màn hình. Toạ độ thế giới: `x` ngang,
`z` = độ sâu (chính là `y` của mô phỏng / server: 0 ở mép sân khấu, `H` ở cuối rạp), `h` = độ cao (ô).

- `s(z)` (px / ô) và `sy(z)` (px của mặt sàn) đều **tuyến tính** theo `z` (từ `s0`/`Yf` ở mép sân khấu tới `s1 = 1,45·s0`/`Yn`
  ở cuối rạp). Vẫn là một phép chiếu phối cảnh hợp lệ: đường dọc theo `z` (lối đi, chân tường, ván sân khấu) thành đường
  thẳng chụm về điểm tụ, đường ngang giữ ngang, đường đứng giữ đứng; chỉ "giãn" trục sâu để các hàng ghế cách đều trên màn.
- `pt(x, z, h)` → px; `inv(px, py)` → `(x, z)` trên sàn (chạm để đi tới); `box()` vẽ khối hộp (mặt bên chỉ vẽ khi camera nhìn
  thấy, rồi mặt trên, mặt trước); `drawFloor()` trải thảm: vẽ sàn một lần từ trên xuống (`floorTexture`), mỗi dải ngang
  màn hình ứng với một độ sâu → cắt đúng một hàng texture kéo giãn theo `s(z)` (kỹ thuật "mode 7").
- **Màn chiếu nằm trên tường cuối, song song mặt nhìn → không méo**: khung YouTube vẫn là hình chữ nhật, đặt khít vào.

## Bố cục (`render/stage.js computeLayout`)

Canvas phủ **cả cửa sổ**. Mọi nút là cụm nổi nhỏ (`index.html`): góc trên trái `#hud-l` (🎬 + phòng), góc trên phải
`#hud-r` (📺 màn hình lớn · ⛶ toàn màn hình · 🎨 · ? · 🛠), dock giữa đáy `#dock` (😀 bảng cảm xúc · 🎭 động tác · ô chat ·
📋 hàng chờ · 💬 trò chuyện). Hàng chờ + chat là ngăn kéo `#side`: máy tính / điện thoại xoay ngang = thẻ nổi bên phải,
điện thoại dọc = tấm trượt từ mép dưới video tới sát dock. `main.js syncInsets()` đo các cụm này rồi gọi
`stage.setInsets({ right, bottom, hudH, hudL, hudR })` → canvas chừa chỗ:

- `right` (ngăn kéo / tấm bên phải đang mở): video + khán phòng căn giữa phần còn trống (`L.availW`, `L.Xc`).
- `bottom` (dock): mép gần khán phòng `Yn` nằm trên dock, sàn vẫn vẽ tràn xuống dưới. Màn thấp (< 520 px, điện thoại
  xoay ngang) thì không chừa — dock nổi đè lên lối đi cuối rạp.
- `hudH / hudL / hudR`: thử hai cách đặt màn hình — (A) sát mép trên, hẹp vừa đủ để hai cụm nút góc nằm hai bên;
  (B) lùi xuống dưới cụm nút — chọn cách cho video to hơn. Cụm nút chỉ đè lên diềm màn nhung, **không bao giờ đè video**
  (`npm run qa` tự kiểm: mọi cụm nổi so với khung video ở từng ảnh chụp).

1. **Dải màn hình** (px CSS, cache `renderScreenBand`): tường cuối, tấm tiêu âm, quầng sáng, màn nhung + dây vén, diềm tua
   vàng, khung màn hình. `#screen-slot` (iframe) đặt khít vào ô màn hình (`placeSlot`). Video 16:9, tối thiểu 200×200 px
   (chạm mức tối thiểu thì giữ 356×200 cho khỏi viền đen). Mặc định chia cân: khán phòng giữ 38 % chiều cao
   (240–340 px — rạp đông vẫn thoáng); **Màn hình lớn** (📺): khán phòng chỉ giữ 30 % (200–260 px) để video to nhất.
   Điện thoại dọc: video luôn rộng hết bề ngang, khán phòng ≥ 50 %. Tường cuối rộng hơn video chút (×1,04–1,2) nhưng bị
   giới hạn để hàng ghế cuối vẫn lọt khung nhìn (`availW·1,06·FAR/R`).
2. **Phòng** (cache theo camera, `drawRoom`): sàn phối cảnh, tường hai bên (ốp gỗ, đèn tường hắt sáng bóp theo phối cảnh,
   dải LED chân tường, biển LỐI RA), sân khấu khối 3D (mặt trên ván gỗ chụm về điểm tụ, mặt trước + đèn chân). Tường được
   vẽ đè lên màn nhung nhưng có `clip('evenodd')` chừa khung video.
3. **Vật thể sắp theo độ sâu**: hàng ghế (mỗi hàng một sprite: đệm, tay vịn, lưng ghế nhung là khối 3D nhìn từ sau, biển
   số ghế), loa cột, quầy bar BẮP NƯỚC (máy bắp rang, ly, biển neon), nhân vật (cỡ = `s(z)·0,85`, càng gần màn hình càng nhỏ).
   Người ngồi vẽ TRƯỚC lưng ghế hàng mình → lưng ghế che thân dưới, chỉ thấy đầu + vai như rạp thật.
4. **Ánh sáng**: sàn nhảy đổi màu dưới chân người nhảy + đốm đèn quét (hình tròn trên sàn → elip phối cảnh), chùm máy chiếu
   + bụi, ánh màn hình hắt xuống mấy hàng đầu, tối dần ở mép gần.
5. **Chữ**: tên trên đầu (mình viền vàng + mũi tên), bong bóng chat neo trên tên, emoji bay. Tất cả bị **clip** dưới mép
   video. Nút dưới màn hình (`.screen-tools`: tên video, ⏭ bỏ qua, 🔊, ⛶ video, 🚩, "📋 Dán link YouTube để chiếu" khi
   chưa có gì) nằm trên sân khấu; tấm trượt điện thoại có mép trên `--sheet-top`. Máy tính: khung chat nổi góc dưới trái
   (`#chat-feed`, 5 tin mới nhất, mờ sau 12 s, không chặn bấm) khi ngăn kéo đóng.

Camera: **máy tính** đứng giữa, thấy cả hộp rạp (tường hai bên chụm vào tường cuối). **Điện thoại**: tường cuối rộng hơn
khung nhìn (nhân vật đủ to), camera lia ngang theo nhân vật mình (vùng chết 1,5 ô; dải màn hình đứng yên), chụm hai ngón
để phóng 0,6×–1,6× (thu nhỏ để thấy cả rạp). Bấm trúng lưng ghế = tới ngồi ghế đó (`pickSeat` dò theo hình chiếu).

Sơ đồ rạp (`shared/hall.js`): rộng 34 ô × sâu 16 ô (rạp lớn: 60 người vẫn thoáng); sàn nhảy LED 26 × 4,3 ô trước sân
khấu; 5 hàng × 26 ghế = 130 chỗ (3 dãy 8 + 10 + 8, 2 lối đi giữa); loa cột hai góc sân khấu; quầy bar sát tường phải
cạnh sàn nhảy; vào rạp xuất hiện ở lối đi cuối rạp (`spawnPoint`, `HOME`).

## Nhân vật (`render/character.js`, `render/anims.js`)

Chép từ VibeCorp (chibi đủ bộ phận: tóc 8 kiểu, phụ kiện, mặt có biểu cảm, 4 hướng). Thêm:
- **dáng Nam / Nữ** (`look.body`): nam vai rộng (15,8 vs 13,6), vai vuông, mắt nhỏ hơn chút, mày đậm gần thẳng (màu theo
  tóc), không má hồng, tuỳ chọn râu `look.facial` (`ria` = ria mép, `rau` = quai nón ôm hàm, vẽ cả nhìn thẳng lẫn nghiêng);
  nữ vai tròn, lông mi, má hồng, môi hồng. Ngoại hình cũ chưa có `body` thì đoán theo kiểu tóc (`normalizeLook`). Chọn
  "Nam" khi đang tóc dài / búi / đuôi ngựa thì tự đổi sang tóc ngắn (và ngược lại) — vẫn chọn lại được.
  `npx tsx scripts/qa-characters.ts` chụp thêm bảng `characters-bodies.png` (8 ngoại hình × 4 hướng + cười + nói + ngồi);
- khung `anim`: `bob`, `bx` (lắc thân trên), `lean` + `pivot` (nghiêng / ngã), `headDY`, `headTilt`, `squat`,
  `legL/legR` (nhấc chân), `stride`, `arms {l, r, near, far}`, `front` (tay trước ngực, nhìn từ sau thì khuất), `heart`,
  `mouth`, `eyes`;
- tư thế `floor` (ngồi bệt, chân bắt chéo) và hộp bắp rang `popcorn`.

`actionPose(id, t, view, seated, dir)` là hàm thuần của thời gian `t` kể từ lúc bắt đầu → mọi máy thấy cùng một nhịp.
Động tác không làm được khi ngồi ghế (hip hop, cười lăn) thì đứng dậy tại ghế. Đi là thôi động tác. Emoji tự bay theo
động tác: `ACTION_FX` (bắt đầu + nhịp lặp: 🎵 khi nhảy, ❤️ khi thả tim, 😂 khi cười lăn).

Ngồi ghế: dừng cách ghế trống ≤ 0,42 ô (hoặc bấm vào ghế) thì tự trượt vào; người ngồi quay lên màn hình (`dir = 'up'`,
thấy sau lưng). Tư thế suy ra từ vị trí (`seatAt`) nên không cần gửi thêm gì qua mạng.

## Độ mượt

- **Mình**: `me.js tickMe` mỗi khung vẽ: phím / cần ảo / điểm chạm → vận tốc → `moveWithCollision` (hàm chung với
  server) → gửi `move` ≤ 15 / s kèm `c = performance.now()`. Server sửa (`corr`) thì kéo mượt 180 ms (lệch > 2,5 ô thì
  nhảy luôn).
- **Người khác** (`store.js`): mỗi người có trục thời gian riêng theo **giờ máy người đi**:
  `off = min(giờ mình lúc nhận − c)` (đường truyền nhanh nhất), vẽ tại `c* = now − buffer − off`, nội suy giữa hai mốc
  kẹp `c*`. Dùng giờ máy người đi (không phải giờ server) nên độ so le của **cả hai chặng** mạng (người đi → server →
  mình, qua Cloudflare) đều bị bộ đệm nuốt — bài học VibeCorp (`docs/02 §10`) làm triệt để hơn. Bộ đệm 90–450 ms, khởi
  đầu 140 ms: gói tới sát giờ vẽ (< 22 ms) thì nới ngay, 90 gói liền đều sớm thì siết dần. Đứng lâu rồi mới đi → chèn mốc
  "vẫn ở chỗ cũ" để không trôi chậm; nhảy xa > 3 ô = dịch chuyển tức thời.
- Động tác của người khác bắt đầu đúng lúc trên trục đã đệm (`localTimeOf`) → không nhảy trước khi dừng chân.
- Đo trên máy dev (QA headless, 15 bot): 60 fps, tỉ lệ khung "khựng" khi đang đi 0,7–0,9 %, vẽ ~1 ms / khung.

## Máy yếu (`stage.js measure`)

Chậm = thời gian JS vẽ trung bình > 11 ms, **hoặc** nhịp khung thật > 21 ms (< ~48 khung / s — máy yếu ở khâu tô điểm
ảnh, JS không thấy được) — bỏ qua 6 s đầu và 2,5 s sau mỗi lần đổi bố cục (tải YouTube, vẽ lại cache). Chậm suốt 150 khung
→ mức 1 (bớt bụi máy chiếu, bớt emoji); tiếp tục chậm → mức 2 (DPR tối đa 1,25, tắt chùm máy chiếu + đèn sàn nhảy).
Nhanh lại 900 khung → nâng mức, trả lại DPR (tối đa 2 lần, tránh nhấp nháy nét / mờ). Rạp đông (> 24 người) hoặc mức ≥ 1:
người đứng / ngồi yên vẽ từ sprite cache theo cỡ (một `drawImage` thay cho cả trăm nét vẽ) — 57 người trên điện thoại
giả lập (Chrome headless, tô bằng CPU) vẫn ~48 khung / s ở độ nét đầy đủ.
Phòng (sàn + tường + sân khấu) và hàng ghế được cache — máy tính vẽ mỗi khung ~1 ms. Đông người (> 24) thì chỉ hiện tên
mình, người đang nói, người mới vào, người đang rê chuột; tên chồng nhau được đẩy lên (`spreadPills`).

## Điều khiển (`input.js`, `ui/wheel.js`)

`WASD` / mũi tên (theo `e.code`, đúng cả bàn phím tiếng Việt), `E` vòng động tác, `1`–`8` làm ngay, `Enter` chat, `Esc`
đóng. Đang gõ trong ô nhập / đang mở màn vào rạp / tấm trượt thì không bắt phím. Bấm vào khung YouTube → trang mất focus
→ nhả hết phím + hiện "Bấm vào khán phòng để điều khiển nhân vật". Điện thoại: cần điều khiển ảo (kéo), chạm sàn để đi
tới, chạm ghế để ngồi, nút 🎭 trên dock, chụm hai ngón để phóng (0,6×–1,6×). Bảng 😀 mở rồi bấm liên tục được, bấm ra
ngoài / `Esc` để đóng. `Esc` đóng lần lượt: thẻ người xem → tấm → bảng cảm xúc → ngăn kéo.

## Móc QA

`window.__vc = { store, me, view(), player(), isOpen }` (không liệt kê, chỉ dữ liệu đã có trên máy). `canvas.__view()`
trả cỡ ô, camera, bố cục, mức chi tiết, thời gian vẽ, trạng thái bộ đệm mạng.
