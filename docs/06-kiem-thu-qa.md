# Kiểm thử & QA

## `npm test` (bắt buộc xanh trước khi báo xong / deploy)

`typecheck` (`tsc --noEmit`, gồm `scripts/`) → `test:unit` → `smoke`. Không ra Internet, ~15 giây.

- `scripts/test-unit.ts` — hàm thuần: tách link YouTube (13 dạng hợp lệ + link lạ), đọc ISO 8601, `checkMeta` từng lý do,
  dữ liệu API thiếu trường, lọc tên / chat (từ bậy có dấu không nhầm "các", "buổi"), link, ký tự vô hình, giới hạn tốc
  độ, kiểm thông điệp client, va chạm / ghế / điểm xuất hiện, ngoại hình hợp lệ, 8 động tác (tên trung tính).
- `scripts/smoke.ts` — dựng app thật với YouTube **giả** (`scripts/fake-youtube.ts`) + thư mục dữ liệu tạm, nối nhiều client
  WebSocket: HTTP (phiên bản tài nguyên, CSP, chính sách, chặn file lạ), cookie admin, chặn Origin lạ, vào rạp (tên sai /
  trùng), di chuyển + server sửa (đi quá nhanh, vào tường), động tác là sự kiện, chat (che bậy, chặn link, chặn lặp, dồn
  dập → tắt tiếng), emoji, hàng chờ (mọi lý do từ chối, giới hạn / người, trùng), bỏ phiếu, người thêm tự bỏ qua, hết bài
  tự sang bài kế, admin (khoá, tắt tiếng, mời ra, cấm / bỏ cấm, state), báo cáo tự gỡ, lỗi trình phát 150, phòng đầy →
  Phòng 2, rớt mạng nối lại đúng nhân vật, ngập tin → đóng socket, tắt / bật server khôi phục hàng chờ.

Thêm test: hàm thuần → `test-unit.ts`; hành vi qua mạng → một `step(...)` trong `smoke.ts` (đăng ký `wait` TRƯỚC khi gửi
lệnh để không lỡ thông điệp).

## QA hình (Chrome headless qua CDP — như VibeCorp `docs/11 §10`)

```bash
npm run qa -- --out /tmp/vc-shots [--bots 14] [--only desktop|mobile]
```

`scripts/qa.ts` tự dựng server (YouTube giả) + bot, mở Chrome (`scripts/cdp.ts`, chỉ dùng `ws`), vào rạp như người thật:
máy tính 1440×900 (màn vào rạp, rạp, đi + nhảy, vòng động tác, chat, bảng admin) và điện thoại 390×844 @3x có cảm ứng
(vào rạp, rạp, vòng động tác, tấm hàng chờ). In số đo độ mượt (fps, tỉ lệ khựng, hitch > 50 ms, bộ đệm mạng) và mọi lỗi
console (bỏ qua cảnh báo của chính YouTube); có lỗi thật → mã thoát 1. Trang nhúng trình phát YouTube thật nên cần Internet.

- `npx tsx scripts/qa-characters.ts --url http://localhost:3399 --out …` — bảng 8 động tác × 4 hướng để soi nhân vật.
- `npx tsx scripts/qa-server.ts` + `npx tsx scripts/bots.ts --n 20 --video aqz-KE-bpKQ` — rạp chạy thử có người giả
  (mã admin QA: `#admin=qa-local-admin`, chỉ dùng trên máy dev).
- `npm run share-images -- --url http://localhost:3399` — vẽ lại `public/og-image.jpg` + icon (ảnh không chứa khung hình
  video).

## Checklist trước khi báo xong thay đổi giao diện

1. `npm test` xanh. 2. `npm run qa` không có lỗi console thật; xem ảnh máy tính + điện thoại. 3. Không phần tử nào đè lên
khung video (kể cả khi mở tấm trượt, vòng động tác, thẻ người, toast). 4. Chữ tiếng Việt có dấu, không tràn trên màn
320–390 px. 5. Độ mượt: tỉ lệ khựng < 3 %, không hitch.
