# CLAUDE.md — VibeCinema (bàn giao từ dự án VibeCorp, 2026-11-03)

> Claude Code đọc file này tự động khi mở thư mục. Đây là bản chốt yêu cầu từ cuộc trò chuyện với chủ dự án ở dự án anh em
> **VibeCorp** (`../agent_office`, site https://corp.vibe-coder.fun, repo github.com/Hao2505/office-ai). Bản đầu đã có code
> (2026-11-03) — xem **§8 Trạng thái** ở cuối file và `docs/README.md`.

## 1. Sản phẩm

**VibeCinema** — https://cinema.vibe-coder.fun — "rạp chiếu phim 2D" xem YouTube chung, kiểu đi chùa / quẩy bar online:

- Phía **trên**: một màn hình lớn = trình phát YouTube chính thức (IFrame Player) đặt khớp vào khung màn hình trong phòng.
- Phía **dưới**: khán phòng 2D (Canvas, giống VibeCorp). **Mỗi người xem điều khiển 1 nhân vật** (không có nhân vật AI).
- Vào chơi **chỉ cần đặt tên** (không đăng nhập) + chọn ngoại hình (tóc, áo, màu da…).
- Đi lại: WASD / phím mũi tên; điện thoại: cần điều khiển ảo + chạm.
- Bấm **E** mở vòng chọn động tác (hoặc phím số 1–8): vẫy tay chào, vỗ tay, nhảy hip hop, lắc đầu quẩy (chủ dự án gọi là "ke đầu" — **trên giao diện ghi tên trung tính**, không dùng chữ "ke"), nhún nhảy, ngồi xem, thả tim, cười lăn. Đang gõ chat thì phím E không bị bắt.
- Chat bong bóng trên đầu + thả emoji phản ứng.
- **Hàng chờ video: người xem tự dán link YouTube**; **admin kiểm soát được** (bỏ qua bài, xoá bài, khoá hàng chờ, tắt tiếng / đuổi / cấm người phá). Người xem có bỏ phiếu bỏ qua.
- Admin vào bằng mã bí mật (giống `DEV_TOKEN` của VibeCorp: `?admin=<token>` lần đầu → cookie HttpOnly), người thường không thấy gì về hệ thống.
- Mỗi phòng ~50–100 người; đầy thì mở phòng 2 (bản đầu có thể 1 phòng nhưng thiết kế sẵn cho nhiều phòng).

## 2. Video YouTube — luật bắt buộc (tránh pháp lý)

- **Chỉ nhúng video cho phép nhúng.** Khi thêm vào hàng chờ, server hỏi YouTube Data API v3 `videos.list` (`part=status,contentDetails,snippet`): phải `embeddable = true`, `privacyStatus = public`, không giới hạn tuổi (`contentRating.ytRating`), xem được ở VN (`regionRestriction`), giới hạn độ dài (đề xuất mặc định, chủ dự án duyệt). Không đạt → từ chối, báo rõ lý do. Lúc phát, trình phát báo lỗi 101/150 (chủ kênh tắt nhúng giữa chừng) → tự sang bài kế.
- Cần `YT_API_KEY` (chủ dự án tạo trên Google Cloud Console — hướng dẫn họ; quota miễn phí 10.000 đơn vị/ngày, `videos.list` = 1). Key chỉ ở `.env`, **không bao giờ commit / in ra / ghi vào docs**.
- Dùng đúng trình phát chính thức: **không chỉnh, không che** (nhân vật / UI không đè lên video), **không chặn quảng cáo**, không tải video về server, trình phát ≥ 200×200 px. Có trang chính sách quyền riêng tư nói rõ dùng dịch vụ YouTube. Có nút "báo cáo"; có khiếu nại thì gỡ ngay. Không gắn affiliate / quảng cáo sát trình phát (chưa có trong kế hoạch).
- **Không bao giờ** tải luồng của người khác về rồi tự phát lại (vi phạm bản quyền). Video phát trên YouTube, server chỉ đồng bộ trạng thái.
- Đồng bộ: server giữ "đồng hồ phòng" (videoId, lúc bắt đầu, đang dừng / chạy); máy lệch > 1–2 s thì tự tua; xem quảng cáo xong thì tua về đúng chỗ. Live: theo đầu live, không cần tua.

## 3. Mượt, không giật (yêu cầu chính của chủ dự án)

- Nhân vật của chính mình đi **ngay trên máy** (dự đoán phía client), server sửa nhẹ khi lệch; người khác **đệm ~100–150 ms rồi nội suy**. Bài học từ VibeCorp: giật trên production là do jitter WebSocket qua Cloudflare, không phải CPU — sửa bằng dấu thời gian trong gói + bộ đệm phát phía client (xem `../agent_office/public/js/store.js`, `../agent_office/docs/07-frontend-ve-canvas.md` mục bộ đệm, `docs/02` §10).
- Server tick 15–20 Hz, chỉ gửi người đang di chuyển / thay đổi; động tác nhảy là **sự kiện** ("A bắt đầu điệu X lúc T") → mọi máy tự chạy hoạt ảnh 60 fps.
- Canvas 2D: vẽ người gần kỹ, máy yếu tự giảm chi tiết; giới hạn số người / phòng.
- Video **không bao giờ đi qua VPS** (băng thông) — YouTube lo.

## 4. Kỹ thuật (giữ giống VibeCorp)

- Node ≥ 20, TypeScript strict ESM chạy bằng `tsx` (không build), `ws`, `dotenv`; frontend vanilla ES module + Canvas 2D, không framework, không ảnh (vẽ bằng code). Hạn chế thêm dependency.
- **Dùng lại code VibeCorp** (repo cùng chủ, public): vẽ nhân vật đủ bộ phận `../agent_office/public/js/render/character.js`, tiện ích vẽ `draw.js` (`drawEmoji` — Chrome bỏ emoji cỡ < 0,4 ô), camera / chạm / chụm trong `office.js`, phục vụ file tĩnh + phiên bản tài nguyên + Open Graph trong `../agent_office/src/server.ts`, mẫu deploy `../agent_office/deploy/`. Chép sang rồi chỉnh, **không sửa gì trong `../agent_office`**.
- Mọi chữ người xem thấy là tiếng Việt có dấu; tên file / hàm / biến tiếng Anh. Chuỗi từ người dùng (tên, chat) chỉ vào DOM qua `textContent`; lọc tên / chat bậy, giới hạn độ dài và tốc độ chat, chống spam link.
- Có `npm test` (typecheck + smoke tự động, không ra Internet) và QA hình desktop + mobile (Chrome headless qua CDP như VibeCorp `docs/11` §10) trước khi báo xong.

## 5. Deploy (VPS dùng chung — cẩn thận)

- Cùng VPS với VibeCorp. Thông tin đăng nhập: chép `../agent_office/deploy/vps.env` sang `deploy/vps.env` của dự án này (đổi `DOMAIN=cinema.vibe-coder.fun`), file này phải nằm trong `.gitignore`. **Không bao giờ in, commit, ghi vào docs / memory** mật khẩu, key, token, địa chỉ VPS.
- Trên VPS có app khác: tiến trình pm2 `tokivietnam.com` (cổng 3000) và `vibecorp` (cổng 3200). **Không đụng** tiến trình, site nginx hay file cấu hình của chúng. App này: thư mục `/opt/vibecinema`, pm2 tên `vibecinema`, cổng đề xuất **3300** (kiểm tra còn trống bằng `ss -ltnp` trước), site nginx riêng `cinema.vibe-coder.fun`, file `conf.d` riêng với **tên zone `limit_req` riêng** (VibeCorp đã dùng `/etc/nginx/conf.d/vpa-limit.conf` — trùng tên zone là nginx lỗi cả máy). Luôn `nginx -t` trước khi reload.
- DNS: chủ dự án tự thêm bản ghi trên Cloudflare (hướng dẫn họ từng bước: bản ghi A `cinema` → IP VPS, bật proxy). Cloudflare thực tế đang ở chế độ SSL **Full** (đo 2026-11-03; ghi chú "Flexible" cũ sai) → site nghe cả 80 lẫn 443 với
  chứng chỉ Let's Encrypt riêng (`deploy.sh --setup` tự lấy bằng webroot), **không** redirect HTTPS ở origin.
- Chỉ deploy khi chủ dự án bảo.

## 6. Repo & quy ước làm việc

- Repo GitHub **public**: `git@github.com:Hao2505/cinema.git` (https://github.com/Hao2505/cinema). Có README tiếng Việt kèm link site.
- Commit **bằng tiếng Anh** dạng `<area>: <description>`, cuối thân commit có dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không `git add -A` mù; không commit / push / deploy nếu chủ dự án chưa bảo.
- Chủ dự án: nói tiếng Việt kiểu bạn bè (xưng tao / mày), vibe coder, để ý chi phí, yêu cầu giao diện đẹp, rõ, cẩn thận; nhân vật đủ bộ phận. Trả lời ngắn, dễ hiểu, kết quả trước.
- Ghi tài liệu cùng lúc với code (README + `docs/` gọn, CHANGELOG), học theo cách VibeCorp làm nhưng nhẹ hơn.

## 7. Còn phải chốt với chủ dự án (đề xuất mặc định rồi hỏi)

- Giới hạn độ dài video, số bài mỗi người được thêm, ngưỡng bỏ phiếu bỏ qua.
- 1 phòng hay nhiều phòng ngay bản đầu; các phòng chung hàng chờ hay riêng.
- Danh sách động tác cuối cùng và kiểu điều khiển trên điện thoại.

## 8. Trạng thái (cập nhật 2026-11-03)

- **Đã làm** (bản 0.4.0): đủ §1–§4 — xem `README.md`, `CHANGELOG.md`, `docs/`. Khán phòng vẽ
  phối cảnh 3D một điểm tụ (chủ dự án yêu cầu "có chiều sâu"); xem chung — không ai tua / dừng riêng (chủ dự án yêu cầu);
  nhân vật chọn Nam / Nữ (+ râu cho nam); rạp phủ cả màn hình, video to hết cỡ, nút là cụm nổi nhỏ + dock dưới, hàng chờ /
  chat là ngăn kéo (chủ dự án yêu cầu "thu gọn, thả nổi, phóng to màn hình chính").
  Thêm theo yêu cầu: 4 rạp (Nhung Đỏ / Công Viên / Đỗ Xe / Bãi Biển, `render/venues/`), góc xem 3 chế độ (mặc định Màn
  lớn), kênh mặc định `DEFAULT_VIDEO` khi trống 30 s, làm tối xung quanh khi chiếu, ⚙️ Tùy chọn + ẩn riêng từng người
  (`public/js/prefs.js`, chỉ trên máy người xem). Tài liệu cho người mới + AI agent: `AGENTS.md`, `docs/00`–`docs/08`.
  `npm test` xanh (typecheck + test đơn vị + smoke). QA hình: `npm run qa -- --out <thư mục>`.
- **Xem thử trên máy** (YouTube giả, không cần key): `npx tsx scripts/qa-server.ts` + `npx tsx scripts/bots.ts --n 10 --video aqz-KE-bpKQ`
  → http://localhost:3399 (admin QA: `#admin=qa-local-admin`).
- **Mặc định đã chọn cho §7 (chờ chủ dự án duyệt, đổi trong `.env`)**: video ≤ 15 phút (admin 240), live ≤ 30 phút / lượt;
  mỗi người chờ 2 video; bỏ qua khi ≥ 50 % người có mặt và ≥ 2 phiếu (người thêm tự bỏ qua bài mình ngay); 60 người / phòng
  (rạp 130 ghế + sàn nhảy lớn — chủ dự án chê rạp 64 ghế chật),
  đầy tự mở phòng kế (tối đa 3), **mỗi phòng hàng chờ riêng**; 3 báo cáo → tự gỡ; 8 động tác như §1; điện thoại = cần điều
  khiển ảo + chạm sàn + nút 🎭 + chụm phóng to.
- **Đã deploy** 2026-11-03: https://cinema.vibe-coder.fun (pm2 `vibecinema`, cổng 3300, HTTPS Let's Encrypt). Repo
  `Hao2505/cinema` (chủ dự án cho push). Cập nhật: `bash deploy/deploy.sh` (chỉ khi chủ dự án bảo).
- **Chờ chủ dự án**: tạo `YT_API_KEY` (README) → điền `.env` + `deploy/.env.production` rồi deploy lại — chưa có key thì
  chưa ai thêm được video.
- `ADMIN_TOKEN` đã sinh ngẫu nhiên trong `.env` (máy nhà) và `deploy/.env.production` (production) — mở file để xem, không in ra.
- `deploy/vps.env` đã chép từ VibeCorp (DOMAIN đã đổi), nằm trong `.gitignore`.
