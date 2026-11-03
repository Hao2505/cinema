# 🎬 VibeCinema — rạp chiếu phim 2D xem YouTube cùng nhau

**Xem trực tiếp: https://cinema.vibe-coder.fun** · Mã nguồn: https://github.com/Hao2505/cinema

Phía trên là màn hình lớn — trình phát YouTube chính thức đặt khít vào khung màn hình trên tường cuối rạp. Phía dưới là
khán phòng vẽ phối cảnh 3D (sàn hẹp dần về màn hình, tường chụm vào, hàng ghế nhung): **mỗi người xem điều khiển một nhân
vật**, đi lại, ngồi ghế, nhảy, vỗ tay, thả tim, chat bong bóng trên đầu. Ai cũng dán được link YouTube vào hàng chờ; **cả
rạp xem cùng một chỗ trong video — không ai tua / dừng riêng được**. Vào rạp chỉ cần đặt tên + chọn nhân vật (nam / nữ,
da, tóc, áo, quần, phụ kiện, râu), không cần đăng nhập. Rạp phủ cả màn hình, video to hết cỡ; nút bấm là các cụm nổi nhỏ ở
góc và dock dưới đáy, không bao giờ che video.

![Rạp VibeCinema](public/og-image.jpg)

## Chơi thế nào

| Làm gì | Máy tính | Điện thoại |
|---|---|---|
| Đi lại | `W A S D` hoặc phím mũi tên · bấm sàn để đi tới | kéo cần điều khiển góc trái · chạm sàn |
| Ngồi ghế | đi tới sát ghế rồi dừng (tự ngồi) · bấm vào ghế | chạm vào ghế |
| Âm lượng / toàn màn hình | 🔊 + thanh trượt, ⛶ dưới màn hình (riêng video) · ⛶ góc trên phải (cả rạp) | như máy tính |
| Video to nhất | 📺 góc trên phải (mặc định chia cân video + khán phòng; bật 📺 = video to nhất) | — |
| Động tác | `E` mở vòng chọn · phím `1`–`8` · 🎭 trên dock | 🎭 trên dock |
| Chat | `Enter` · ô nhắn trên dock | ô nhắn trên dock |
| Thả cảm xúc | 😀 trên dock | như máy tính |
| Chiếu video | 📋 trên dock → dán link YouTube vào **Hàng chờ** | 📋 |
| Xem lại chat | 💬 trên dock (ngăn kéo bên phải); tin mới hiện góc dưới trái | 💬 |

8 động tác: 👋 Vẫy tay chào · 👏 Vỗ tay · 🕺 Nhảy hip hop · 🤘 Lắc đầu quẩy · 🎶 Nhún nhảy · 🍿 Ngồi xem · ❤️ Thả tim · 🤣 Cười lăn.

## Luật rạp (mặc định, đổi trong `.env`)

- Chỉ nhận video **công khai, cho phép nhúng, không giới hạn tuổi, xem được ở Việt Nam**, dài tối đa **15 phút**
  (server hỏi YouTube Data API trước khi cho vào hàng chờ). Chủ kênh tắt nhúng giữa chừng → rạp tự chuyển bài.
- Mỗi người chờ tối đa **2 video**. Bỏ qua khi **≥ 50 %** người trong phòng bỏ phiếu (ít nhất 2 phiếu); người thêm bài
  bỏ qua bài của mình ngay.
- **Xem chung**: thanh tua / dừng của YouTube bị ẩn; lỡ dừng là tự chạy lại đúng giờ chung. Chỉ admin dừng được cả phòng.
- **60 người / phòng** — rạp rộng 130 ghế (5 hàng) + sàn nhảy lớn, đầy phòng vẫn thoáng; đầy thì tự mở Phòng 2 (tối đa 3
  phòng), mỗi phòng màn hình + hàng chờ riêng.
- Chat: không link, từ bậy bị che `***`, gửi dồn dập bị tắt tiếng 2 phút.
- Nút **🚩 Báo cáo** dưới màn hình: admin được báo ngay; **3 người** báo cáo cùng video thì rạp tự gỡ + chặn video đó.

## Chạy trên máy

Cần Node ≥ 20.

```bash
npm install
cp .env.example .env      # rồi điền ADMIN_TOKEN, YT_API_KEY (xem dưới)
npm run dev               # http://localhost:3300
```

Chưa có YouTube API key mà muốn xem thử ngay: chạy bản QA dùng YouTube **giả** + người xem giả:

```bash
npx tsx scripts/qa-server.ts                                           # http://localhost:3399
npx tsx scripts/bots.ts --url ws://localhost:3399/ws --n 10 --video aqz-KE-bpKQ   # 10 người xem giả
```

(Bản QA nhận mọi link và tính dài 3:20 — chỉ để thử giao diện. Mã admin của bản QA: `#admin=qa-local-admin`.)

## Tạo YouTube API key (5 phút, miễn phí)

1. Vào https://console.cloud.google.com/ → đăng nhập Gmail → **Select a project → New project** → đặt tên `vibe-cinema` → **Create**.
2. Menu ☰ → **APIs & Services → Library** → tìm **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → + Create credentials → API key** → copy key.
4. Bấm vào key vừa tạo → **API restrictions → Restrict key → chọn YouTube Data API v3 → Save**.
   (Muốn chặt hơn: **Application restrictions → IP addresses** → điền IP của VPS. Khi đó key chỉ chạy trên VPS; máy nhà
   cần một key thứ hai không giới hạn IP.)
5. Dán key vào `.env` (máy nhà) và `deploy/.env.production` (VPS): `YT_API_KEY=...`. **Không gửi key qua chat, không commit.**

Quota miễn phí 10.000 lượt / ngày; mỗi link mới tốn 1 lượt (kết quả được nhớ 6 giờ) — dư sức cho rạp.

## Admin

- Mở trang **một lần** kèm mã: `https://cinema.vibe-coder.fun/#admin=<ADMIN_TOKEN>` → trình duyệt nhớ (cookie HttpOnly, 1 năm),
  mã bị gỡ khỏi thanh địa chỉ. Mã nằm trong `deploy/.env.production` (production) / `.env` (máy nhà).
- Có nút 🛠: bỏ qua / tạm dừng / chiếu tiếp (cả phòng), **gỡ hẳn video** (khiếu nại bản quyền), đưa bài lên đầu, xoá bài,
  khoá hàng chờ, xoá chat, xem báo cáo, bỏ cấm, bỏ chặn video. Bấm vào một nhân vật: tắt tiếng 10 phút / 1 giờ, mời ra (2 phút không vào lại), cấm 1 ngày / vĩnh viễn.
- Người thường không thấy gì về hệ thống (file admin không được tải nếu không phải admin).

## Deploy (VPS dùng chung với VibeCorp)

```bash
npm test                              # xanh hết mới deploy
bash deploy/deploy.sh --setup         # lần đầu: kiểm cổng 3300, tạo /opt/vibecinema, nginx site riêng
bash deploy/deploy.sh                 # các lần sau
bash deploy/logs.sh                   # xem log
```

App chạy bằng pm2 tên `vibecinema`, cổng `3300`, thư mục `/opt/vibecinema`, site nginx `cinema.vibe-coder.fun`,
vùng giới hạn nhịp riêng `vcin_api` (`/etc/nginx/conf.d/vibecinema-limit.conf`) — không đụng `vibecorp` (3200) hay
`tokivietnam.com` (3000). Chi tiết + DNS Cloudflare: [docs/05-van-hanh-deploy.md](docs/05-van-hanh-deploy.md).

## Kiểm thử

```bash
npm test          # typecheck + test đơn vị + smoke toàn hệ thống (không ra Internet, ~15 giây)
npm run qa -- --out /tmp/vc-shots     # Chrome headless: chụp máy tính + điện thoại, bắt lỗi console, đo độ mượt
```

## Tài liệu

[docs/README.md](docs/README.md) — tổng quan, giao thức, frontend & độ mượt, YouTube & pháp lý, vận hành & deploy, kiểm thử.
Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md). Chính sách hiển thị cho người xem: [/chinh-sach](public/chinh-sach.html).

Video do YouTube phát và thuộc về chủ sở hữu; rạp không tải, không lưu, không phát lại video.
