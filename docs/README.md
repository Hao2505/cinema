# Tài liệu VibeCinema

VibeCinema — https://cinema.vibe-coder.fun · mã nguồn https://github.com/Hao2505/cinema — rạp chiếu phim 2D xem
YouTube cùng nhau: trình phát YouTube chính thức ở trên, khán phòng phối cảnh ở dưới, mỗi người xem điều khiển một nhân
vật. Yêu cầu gốc của chủ dự án: [`../CLAUDE.md`](../CLAUDE.md). Hướng dẫn ngắn cho AI agent: [`../AGENTS.md`](../AGENTS.md).

## Mục lục

| Tài liệu | Nội dung | Đọc khi |
|---|---|---|
| [00-ban-do-ma-nguon.md](00-ban-do-ma-nguon.md) | mỗi file làm gì / export gì / ai gọi, luồng dữ liệu, bảng "muốn sửa X thì vào đâu" | tìm chỗ sửa; mới vào dự án |
| [01-tong-quan.md](01-tong-quan.md) | ý tưởng, **toàn bộ chức năng hiện có**, luồng người dùng, kiến trúc, công nghệ, quyết định & lý do, mặc định | mới vào dự án |
| [02-giao-thuc.md](02-giao-thuc.md) | HTTP + WebSocket: mọi thông điệp hai chiều, trường, kiểm tra, giới hạn tốc độ, id phòng / rạp, trường thời gian, mã lỗi | sửa / thêm thông điệp, viết bot, debug mạng |
| [03-frontend.md](03-frontend.md) | module client, bố cục video ↔ khán phòng, phối cảnh, vòng vẽ & cache, **giao diện chủ đề rạp**, nhân vật & động tác, điều khiển, giao diện DOM, netcode, máy yếu, tùy chọn ⚙️, móc debug | sửa bất cứ gì trên trình duyệt |
| [04-youtube-va-phap-ly.md](04-youtube-va-phap-ly.md) | luật YouTube → code giữ luật, kiểm tra video, trình phát, đồng bộ đồng hồ phòng, lỗi giữa chừng, báo cáo / gỡ, video mặc định, trang chính sách | **bất cứ gì đụng tới video** hoặc vùng quanh màn hình |
| [05-van-hanh-deploy.md](05-van-hanh-deploy.md) | production, VPS dùng chung, DNS Cloudflare (proxy tắt — vì sao) + nginx + Let's Encrypt, `deploy.sh`, biến môi trường, dữ liệu, log, sự cố, rollback | deploy (khi chủ dự án bảo), vận hành |
| [06-kiem-thu-qa.md](06-kiem-thu-qa.md) | `npm test` (typecheck + unit + smoke), YouTube giả, chạy thử trên máy, QA hình bằng Chrome headless, bot, đo độ mượt, ảnh chia sẻ + `seo-check`, checklist | viết / chạy test, trước khi báo xong |
| [07-server.md](07-server.md) | bên trong `src/`: app.ts, Hub / Room, vào rạp, di chuyển, hàng chờ, phiếu, báo cáo, admin, video mặc định, lưu trữ, hằng số, **mọi biến môi trường** | sửa server |
| [08-mo-rong.md](08-mo-rong.md) | cách thêm rạp, động tác, ngoại hình, lệnh admin, thông điệp, biến cấu hình, tùy chọn, nút nổi; quy ước; **bất biến & bẫy** | trước khi thêm tính năng |

## Thứ tự đọc

**Người mới (lập trình viên)**: `../README.md` (chơi thế nào, chạy trên máy) → [01](01-tong-quan.md) → [00](00-ban-do-ma-nguon.md)
→ chạy thử `npx tsx scripts/qa-server.ts` + `npx tsx scripts/bots.ts --n 10 --video aqz-KE-bpKQ` (không cần API key, mở
http://localhost:3399) → [03](03-frontend.md) hoặc [07](07-server.md) tuỳ phần sẽ sửa → [04](04-youtube-va-phap-ly.md)
(bắt buộc nếu đụng video) → [06](06-kiem-thu-qa.md).

**AI agent**: [`../AGENTS.md`](../AGENTS.md) (luật vàng, lệnh) → [00](00-ban-do-ma-nguon.md) §8 (sửa X ở đâu) → [08](08-mo-rong.md)
§10 (bất biến & bẫy) → tài liệu chuyên đề của phần đang sửa ([02](02-giao-thuc.md) / [03](03-frontend.md) /
[04](04-youtube-va-phap-ly.md) / [07](07-server.md)) → [06](06-kiem-thu-qa.md) §10 (checklist trước khi báo xong).

**Vận hành**: [05](05-van-hanh-deploy.md) → [07](07-server.md) §14, §16.

## Quy ước tài liệu

- Viết tiếng Việt có dấu; tên file / hàm / biến giữ nguyên tiếng Anh trong `backtick`. Nguồn sự thật luôn là code — tài
  liệu ghi tên hàm / file để tra, tránh số dòng.
- Ghi tài liệu **cùng lúc** với code; đổi hành vi người xem thấy → cập nhật `../README.md` + `../CHANGELOG.md`.
- **Không bao giờ** ghi vào tài liệu: IP / cổng SSH / user / mật khẩu VPS, `ADMIN_TOKEN`, `YT_API_KEY` — chỉ ghi tên biến.
- Commit tiếng Anh dạng `<area>: <description>`.
