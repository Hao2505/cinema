# Lịch sử thay đổi

## 0.4.0 — 2026-11-03 · 4 rạp + kênh mặc định + làm tối khi chiếu + tùy chọn

**4 rạp, mỗi rạp một khung cảnh** — 🎭 Rạp Nhung Đỏ (trong nhà), 🌳 Rạp Công Viên (ngoài trời: bãi cỏ, gối lười), 🚗 Rạp
Đỗ Xe (kiểu Mỹ: xe mui trần, màn hình khổng lồ), 🏖️ Rạp Bãi Biển (ghế xếp trên cát, hàng dừa). Chung sơ đồ đi lại / ghế,
khác cách vẽ (`public/js/render/venues/`, nạp khi cần — file một rạp lỗi thì rạp đó tạm vẽ như Rạp Nhung Đỏ). Mỗi rạp một
phòng cố định, màn hình + hàng chờ riêng; rạp đầy thì tự mở bản sao "<rạp> 2", "<rạp> 3" (`MAX_ROOMS` mỗi rạp), bỏ trống
lâu thì đóng. Chọn rạp ở màn vào rạp (xem trước ngay phía sau) hoặc bấm ô tên rạp góc trên. Link thẳng: `/?phong=bien`.

**Góc xem 3 chế độ** (📺): Cân (khán phòng rộng) · Màn lớn (mặc định) · Màn rộng (video to nhất, ~1020×574 trên
1440×900). Mỗi người tự chọn, máy nhớ.

**Kênh mặc định** — phòng trống video + hàng chờ trống quá `DEFAULT_IDLE_SECONDS` (30 s) thì tự phát `DEFAULT_VIDEO`
(kênh trực tiếp 24/7 chủ rạp chọn), phát liên tục; có người dán link là nhường ngay; không bỏ phiếu bỏ qua được (admin bỏ
qua → phòng đó nghỉ 10 phút; trình phát lỗi → tắt 30 phút). Server kiểm qua oEmbed (không cần key) + đủ luật khi có
`YT_API_KEY`. Màn hình trống ghi rõ "trống quá 30 giây rạp tự phát kênh trực tiếp".

**Vào lại không cần đặt tên** — máy nhớ tên + nhân vật + rạp đã vào. Lần sau mở trang thấy ngay thẻ "Chào mừng quay
lại" (hình nhân vật, 4 rạp kèm số người + đang chiếu gì, rạp lần trước lên đầu): bấm một rạp là vào luôn. Mở bằng link
thẳng tới một rạp (`/?phong=bien`) hoặc vừa chuyển rạp thì vào thẳng. Tên đã nhớ bị trùng / không hợp lệ thì tự về màn đặt
tên, báo rõ lý do. Có nút "✏️ Đổi tên / nhân vật".

**Xem phim dễ chịu hơn**
- Đang chiếu thì mọi thứ quanh video tối lại (chuyển dần), tên + bong bóng chat vẫn rõ.
- Đang xem mà không động chuột / chạm 4 giây → các nút mờ đi, động là hiện lại.
- **⚙️ Tùy chọn** (chỉ trên máy mình): mức tối (tắt / nhẹ / vừa / đậm), tự làm mờ nút, chat của mọi người, bong bóng,
  khung chat nổi, hiện người khác, tên trên đầu (tất cả / tự động / chỉ mình), động tác người khác, emoji cảm xúc, emoji
  theo động tác, đèn & hiệu ứng, chất lượng hình (tự động / cao / nhẹ máy), danh sách người đang ẩn + khôi phục mặc định.
- Bấm vào một nhân vật: **ẩn tin nhắn / ẩn động tác & emoji / ẩn hẳn người đó** (chỉ trên máy mình, nhớ theo tên).

**Vận hành** — đã lên mạng: https://cinema.vibe-coder.fun (HTTPS Let's Encrypt; Cloudflare thực tế ở chế độ SSL Full, không
phải Flexible như ghi chú cũ — `deploy.sh --setup` tự lấy chứng chỉ). Mã nguồn: https://github.com/Hao2505/cinema.
Tài liệu viết lại chi tiết cho người mới + AI agent: `AGENTS.md`, `docs/00` (bản đồ mã nguồn) … `docs/08` (cách mở rộng).

## 0.3.0 — 2026-11-03 · Nhân vật nam / nữ + rạp tràn màn hình + rạp lớn

**Rạp lớn gấp đôi** — trước 22 × 12 ô, 64 ghế: đủ 60 người là chật. Giờ 32 × 16 ô, **130 ghế** (5 hàng × 26, 3 dãy
8 + 10 + 8), sàn nhảy 26 × 4,3 ô (gấp đôi), 2 biển LỐI RA mỗi bên, vào rạp xuất hiện ở lối đi cuối rạp. Đầy phòng (60) vẫn
còn hơn nửa ghế trống. Máy tính thấy trọn cả rạp (kể cả khi mở ngăn kéo); điện thoại camera lia theo mình, chụm hai ngón
thu nhỏ tới 0,6× để thấy cả rạp. Rạp đông (> 24 người): người đứng / ngồi yên vẽ từ ảnh cache → 56 người vẫn 60 khung / s
trên máy tính. Máy yếu ở khâu tô điểm ảnh giờ cũng được phát hiện (đo nhịp khung thật) để tự giảm chi tiết, nhanh lại
thì trả độ nét. Ảnh chia sẻ link (`og-image.jpg`) chụp lại rạp mới.

**Chia cân màn hình** — mặc định video 744×418 (1440×900; bản 0.2: 631×355) + khán phòng cao ~320 px cho rạp đông vẫn
thoáng; bấm 📺 = video to nhất (~866×487, khán phòng gọn lại).

**Nhân vật nam / nữ** — dòng "Dáng người: 👨 Nam / 👩 Nữ" đầu bảng ngoại hình (màn vào rạp + nút 🎨). Nam: vai rộng,
vai vuông, mày đậm gần thẳng, không má hồng, thêm lựa chọn **râu** (ria mép / râu quai nón). Nữ: vai tròn, lông mi, má
hồng, môi hồng. Đổi dáng thì kiểu tóc quá "đặc trưng" của dáng kia tự đổi theo (vẫn chọn lại được). Nhân vật ngẫu nhiên
(🎲, bot) ra cả nam lẫn nữ; ngoại hình đã lưu từ trước tự đoán dáng theo kiểu tóc.

**Rạp tràn màn hình, nút thu gọn** — bỏ thanh trên, thanh dưới và cột phải cố định; rạp phủ cả cửa sổ:
- Video to hơn hẳn (xem "Chia cân màn hình" ở trên). Nút ⛶ góc trên = toàn màn hình cả rạp (ẩn thanh trình duyệt).
- Nút thành cụm nổi nhỏ: góc trên trái 🎬 + phòng; góc trên phải 📺 ⛶ 🎨 ? 🛠; dock giữa đáy 😀 (bảng cảm xúc bật lên) ·
  🎭 động tác · ô chat · 📋 hàng chờ · 💬 trò chuyện (có số chưa đọc).
- Hàng chờ + chat thành **ngăn kéo**: máy tính = thẻ nổi bên phải, mở ra thì video tự dời sang trái (không bị che); điện
  thoại = tấm trượt dưới màn hình, ô chat luôn ở ngay dưới. Máy tính nhớ ngăn kéo đang mở / đóng. Khi đóng, tin chat mới
  hiện nổi góc dưới trái rồi mờ dần (không chặn bấm vào rạp). Rạp chưa chiếu gì → nút "📋 Dán link YouTube để chiếu"
  ngay dưới màn hình.
- **Không gì đè lên video**: rạp đo các cụm nút rồi tự chừa chỗ (cụm góc chỉ đè lên diềm màn nhung); `npm run qa` tự
  kiểm tra chồng lấn ở mọi ảnh chụp (máy tính, ngăn kéo, tấm admin, laptop nhỏ, điện thoại dọc / ngang).
- Điện thoại xoay ngang: video giữ đúng 16:9 (356×200) thay vì khung vuông viền đen, dock nổi đè lên lối đi cuối rạp để
  khán phòng rộng hơn, ngăn kéo thành thẻ bên phải.

## 0.2.1 — 2026-11-03 · Cột phải gọn + khoá video êm hơn (chưa deploy)

- Cột phải không còn chồng chéo: khung Hàng chờ luôn hiện đủ ô dán link (danh sách tự cuộn, cao tối đa 40 %), khung Trò
  chuyện lấp phần còn lại và tự cuộn riêng; không khung nào tràn sang khung khác. Màn laptop thấp tự thu gọn khoảng cách.
- Chat mượt: tin mới trượt nhẹ vào, đang ở cuối thì tự bám tin mới (kể cả khi khung đổi cỡ), đang kéo lên đọc thì không
  bị giật xuống mà hiện nút "↓ N tin mới". Thông báo "Đã thêm…" tự ẩn. Nút admin gom thành một cụm biểu tượng gọn.
- Lỡ bấm vào video: chạy lại ngay (~0,3 s), lặng lẽ, không còn thông báo; bàn phím tự trả về điều khiển nhân vật. Cố ý
  không chặn bấm vào khung YouTube vì chính sách YouTube cấm chặn link / nút quảng cáo của trình phát.

## 0.2.0 — 2026-11-03 · Rạp 3D + xem chung (chưa deploy)

**Hình ảnh có chiều sâu** — vẽ lại khán phòng theo phối cảnh một điểm tụ (nhìn từ cuối rạp lên màn hình): sàn thảm hẹp dần
về màn hình, tường hai bên chụm vào (ốp gỗ, đèn tường, LED chân tường, biển LỐI RA), sân khấu khối 3D + đèn chân, 4 hàng
ghế nhung khối 3D nhìn từ sau (64 chỗ), loa cột, quầy bar BẮP NƯỚC cạnh sàn nhảy, đốm đèn quét trên sàn nhảy. Nhân vật càng
gần màn hình càng nhỏ, tên hiện trên đầu. Màn chiếu song song mặt nhìn nên video YouTube vẫn không méo, không bị che.
Điện thoại: camera lia theo nhân vật, chụm hai ngón để phóng. Bấm vào ghế để ngồi.

**Xem chung** — ẩn thanh tua / dừng của YouTube (`controls=0`, `disablekb=1`); lỡ dừng là tự chạy lại đúng giờ chung;
lệch > 1 s là tua (trước 1,5 s); lần chạy đầu tua bù thời gian tải (lệch còn ~0,2 s). Âm lượng + toàn màn hình thành nút
riêng dưới màn hình. Chỉ admin dừng được cả phòng.

**Sửa lỗi sau khi rà độc lập**
- Nối lại khi server còn giữ socket cũ (đổi wifi ↔ 4G) không còn báo "tên đã có người dùng"; F5 rồi vào lại không còn bị
  đứng hình trong mắt người khác.
- Id người không còn trùng sau khi server khởi động lại; người thêm video nhận lại quyền theo máy.
- Tự gỡ video (3 báo cáo) và chuyển bài khi lỗi trình phát giờ đếm theo IP khác nhau — một người nhiều tab không đủ.
- Giới hạn báo cáo (3 / phút, bỏ trùng), giới hạn link mới / IP (chống đốt quota YouTube), dọn bảng hết hạn.
- IP không giả được qua header khi gọi thẳng VPS (nginx realip chỉ tin dải IP Cloudflare).
- Admin có nút "🚫 Gỡ hẳn" (chặn video ở mọi phòng); admin xoá bài trong hàng chờ cả khi chưa vào rạp.
- Màn vào rạp / toast không còn nằm đè lên video đang chạy; tải YouTube API lỗi thì thử lại sau 20 s thay vì liên tục.
- Tên không có chữ Latin (李明, Иван…) không còn trùng nhau oan; "аdmin" (chữ Kirin) bị chặn.
- `npm test`: 20 test đơn vị + 30 bước smoke.

## 0.1.0 — 2026-11-03 · Bản đầu (chưa deploy)

**Rạp**
- Màn hình lớn phía trên: trình phát YouTube chính thức đặt khít vào khung màn hình vẽ bằng canvas (màn nhung, diềm tua
  vàng, sân khấu gỗ, đèn chân). Khán phòng 2D phía dưới: thảm, sàn nhảy LED, 3 hàng ghế nhung (72 chỗ), lối đi có đèn,
  loa, quầy bắp nước, cửa "LỐI RA", chùm máy chiếu. Không dùng ảnh — vẽ hết bằng code.
- Vào rạp chỉ cần đặt tên + chọn ngoại hình (da, 8 kiểu tóc, màu tóc, áo, quần, 6 phụ kiện), có nhân vật xem trước.
- Đi lại WASD / mũi tên / bấm sàn; điện thoại có cần điều khiển ảo + chạm sàn + chụm phóng to. Dừng sát ghế là tự ngồi.
- 8 động tác (phím 1–8, vòng chọn phím E / nút 🎭): vẫy tay, vỗ tay, nhảy hip hop, lắc đầu quẩy, nhún nhảy, ngồi xem
  (bắp rang), thả tim, cười lăn. Sàn nhảy nháy màu dưới chân người đang nhảy.
- Chat bong bóng trên đầu + khung chat; 8 emoji thả nhanh bay lên.

**Video**
- Hàng chờ do người xem dán link; server kiểm tra bằng YouTube Data API v3 (công khai, cho nhúng, không giới hạn tuổi,
  xem được ở VN, ≤ 15 phút; live ≤ 30 phút / lượt), báo rõ lý do khi từ chối.
- "Đồng hồ phòng": mọi máy xem cùng một chỗ, lệch > 1,5 s tự tua, xem quảng cáo xong tự về đúng chỗ, live theo đầu live.
- Bỏ phiếu bỏ qua (≥ 50 %, ≥ 2 phiếu), người thêm bài bỏ qua bài mình ngay, lỗi 101/150 tự chuyển bài.
- Báo cáo video / người xem; 3 người báo cáo cùng video → tự gỡ + chặn. Trang `/chinh-sach`.

**Admin** (`#admin=<mã>` một lần → cookie HttpOnly): bỏ qua, tạm dừng / chiếu tiếp, đưa lên đầu, xoá bài, khoá hàng
chờ, tắt tiếng, mời ra, cấm, bỏ cấm, bỏ chặn video, xoá chat, xem báo cáo.

**Kỹ thuật**
- Node + TypeScript (tsx, không build), `ws`, `dotenv`; client ES module + Canvas 2D. Chép từ VibeCorp: nhân vật, hàm vẽ,
  bong bóng chat, phục vụ file tĩnh + phiên bản tài nguyên + Open Graph, mẫu deploy.
- Mượt: nhân vật mình đi ngay trên máy (dự đoán, server sửa nhẹ); người khác nội suy theo **giờ máy người đi** qua bộ đệm
  thích ứng 90–450 ms (khử so le cả hai chặng mạng qua Cloudflare); server 15 Hz chỉ gửi người vừa đổi; động tác là sự
  kiện. Máy yếu tự giảm chi tiết.
- Nhiều phòng: 60 người / phòng, đầy tự mở phòng kế (tối đa 3), mỗi phòng hàng chờ riêng. Rớt mạng 15 s nối lại đúng
  nhân vật. Tắt / bật server không mất hàng chờ.
- Chống phá: lọc tên / chat bậy (có dấu, không nhầm từ thường), chặn link, giới hạn tốc độ mọi thao tác, CSP, chặn
  WebSocket từ trang khác, chỉ lưu IP đã băm; tắt tiếng / mời ra theo máy (không vạ lây người chung IP).
- `npm test` (typecheck + 20 test đơn vị + 28 bước smoke, không ra Internet); `npm run qa` (Chrome headless: ảnh máy tính +
  điện thoại, lỗi console, độ mượt); bot người xem giả; script ảnh chia sẻ + icon.
- Deploy: `deploy/deploy.sh` (pm2 `vibecinema`, cổng 3300, `/opt/vibecinema`, nginx site + vùng `vcin_api` riêng).
