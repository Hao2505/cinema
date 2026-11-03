# YouTube & pháp lý

Luật gốc: `../CLAUDE.md` §2. Tài liệu này chỉ ra **code nào giữ luật nào** — sửa vùng này thì kiểm lại cả bảng.

## 1. Chỉ nhận video được phép (`src/youtube.ts`)

`parseVideoId` nhận `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `m.`/`music.`,
`youtube-nocookie.com` hoặc id 11 ký tự; host khác → từ chối. Server gọi
`videos.list?part=status,contentDetails,snippet&id=…` (1 lượt quota) rồi `checkMeta`:

| Điều kiện | Không đạt → lý do hiện cho người xem |
|---|---|
| tìm thấy | "Không tìm thấy video — có thể đã bị xoá hoặc để riêng tư." |
| `privacyStatus === 'public'` | "Video không công khai." / "đang để không công khai" |
| `embeddable === true` | "Chủ kênh không cho phép phát video này trên trang khác." |
| `uploadStatus === 'processed'` | "Video chưa xử lý xong trên YouTube." |
| `contentRating.ytRating !== 'ytAgeRestricted'` | "Video bị giới hạn độ tuổi trên YouTube." |
| `regionRestriction` cho xem ở `YT_REGION` (VN) | "Video không xem được ở Việt Nam." |
| không phải buổi live sắp phát (`upcoming`) | "Buổi phát trực tiếp này chưa bắt đầu." |
| độ dài ≤ `MAX_VIDEO_MINUTES` (admin: `ADMIN_MAX_VIDEO_MINUTES`) | "Video dài … — rạp chỉ nhận video tối đa …" |
| live: `ALLOW_LIVE` | "Rạp đang không nhận video phát trực tiếp." |

Trường thiếu trong phản hồi API → coi như **không đạt** (`metaFromItem`). Kết quả nhớ 6 giờ (`VideoCache`), cùng một id
đang hỏi thì dùng chung một yêu cầu. Lỗi quota / key / mạng → báo rõ, không cho vào hàng chờ. Key chỉ nằm trong URL gọi
API, không bao giờ ghi log. Không có key → không ai thêm được video (log khởi động cảnh báo).

## 2. Dùng đúng trình phát chính thức (`public/js/player.js`)

- YouTube IFrame Player API (`https://www.youtube.com/iframe_api`), host `youtube-nocookie.com` khi `YT_NOCOOKIE=true`,
  `origin` + `widget_referrer` = trang mình, `playsinline`, `rel: 0`.
- **Xem chung**: ẩn thanh điều khiển bằng tham số chính thức `controls: 0`, `disablekb: 1`, `fs: 0` → không ai tua / dừng
  riêng. Lỡ bấm vào video (trình phát tự dừng) → `onStateChange(PAUSED)` cho chạy lại NGAY, lặng lẽ, tua về đúng giờ chung;
  bàn phím được trả về trang ngay để WASD / E tiếp tục điều khiển nhân vật. Chỉ admin dừng / chiếu tiếp được, và dừng là
  **cả phòng** dừng cùng vị trí.
- **Cố ý KHÔNG chặn bấm vào khung video** (vd `pointer-events: none` hay lớp phủ trong suốt): chính sách YouTube API cấm
  "modify, build upon, or block any portion or functionality of a YouTube player" (III.I.6), "remove, obscure, alter, or
  disable any links that appear in YouTube players" (III.I.4), "interfere with … or block advertisements" (III.I.5) — chặn
  bấm sẽ chặn luôn nút "Bỏ qua quảng cáo", link quảng cáo, logo / tiêu đề YouTube. Tự chạy lại ngay cho kết quả như nhau mà
  không vi phạm.
- Âm lượng (🔊 + thanh trượt, nhớ trong localStorage) và toàn màn hình (⛶, `requestFullscreen` lên khung video) là nút
  riêng nằm DƯỚI màn hình.
- **Không che**: khung `#screen-slot` nằm trên canvas, mọi lớp vẽ khán phòng bị cắt dưới mép màn hình, tường bên vẽ với
  clip chừa khung video, không phần tử DOM nào đặt chồng lên khung (nút, tấm trượt, toast — toast đặt từ `--aud-top` xuống
  —, vòng động tác, thẻ người). Bị mời ra / phải vào lại thì `player.disable()` dừng + ẩn video TRƯỚC khi hiện màn vào rạp.
- **Không chặn quảng cáo**: không đụng tới quảng cáo (vẫn hiện nút "Bỏ qua quảng cáo" của YouTube); chỉ ra lệnh tải / phát /
  dừng / tua theo đồng hồ phòng.
- Trình phát ≥ 200×200 px (`computeLayout` ép tối thiểu). Không tải video về server, không phát lại luồng của người khác.
- Chỉ tự phát khi trình phát đang hiện: tab đang ẩn thì bài mới chỉ được nạp sẵn (`cueVideoById`), quay lại tab mới phát
  (đúng giờ chung). Một trang chỉ có một trình phát.
- Đối chiếu: [YouTube Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
  — "không thay đổi trình phát ngoài những gì tài liệu API mô tả" (`controls`, `disablekb`, `fs`, play / pause / seek đều là
  tham số / hàm chính thức), "không đặt lớp phủ, khung hay phần tử nào trước trình phát", "khung tối thiểu 200×200 px",
  "chỉ tự phát khi trình phát đang hiện, không quá một trình phát tự phát cùng lúc".

## 3. Đồng bộ "đồng hồ phòng"

Server (`hub.ts Room`) giữ `now = { v, at, paused, pos, ends, live, dur }`: `at` = giờ server ứng với giây 0 (bài mới:
`at = lúc chọn + 2 s` để mọi máy kịp tải). Hết `ends` → bài kế. Client (`player.js sync`, mỗi 500 ms):

- giờ server = `performance.now() + offset` (ping/pong kiểu NTP, giữ mẫu RTT thấp nhất; `store.onPong`; ước lượng ngay từ
  `hello.s`);
- chưa tới giây 0 → `cueVideoById` rồi đúng giờ mới `playVideo` (mọi máy bắt đầu cùng lúc);
- lần PLAYING đầu sau khi tải: lệch > 0,6 s thì tua bù thời gian tải (đo trên máy dev: lệch còn ~0,2 s);
- lệch > 1 s → `seekTo` (tối đa 1 lần / 2,5 s; lần tua trước "không ăn" — thường do đang quảng cáo — thì giãn nhịp tới 4×,
  nên **xem quảng cáo xong tự tua về đúng chỗ** mà không phá quảng cáo);
- trình duyệt chặn tự phát (iPhone) → "▶ Bấm để xem"; bị trình duyệt tắt tiếng → "🔊 Bật tiếng" (cả hai dưới màn hình);
- live: theo đầu live, không tua.

## 4. Lỗi giữa chừng (chủ kênh tắt nhúng…)

`onError` mã 100 / 101 / 150 (và 2) → client gửi `vid_err`. Server cần đủ **mạng (IP) khác nhau** cùng báo cho đúng video
đang chiếu — ≥ 30 % và ≥ 2 (ít người thì tất cả) — một người mở nhiều tab không đủ → chuyển bài, ghi `embedFail` 24 giờ
(không cho thêm lại), xoá cache. Mã 153 (thiếu Referer) là lỗi
cấu hình của mình → chỉ báo trên máy đó, không chuyển bài.

## 5. Báo cáo & gỡ

Nút 🚩 dưới màn hình / thẻ Đang chiếu → chọn lý do (bản quyền, không phù hợp, spam, khác) + ghi chú. Server ghi
`data/reports.jsonl`, báo ngay cho mọi admin đang mở trang (toast + tab Báo cáo). `REPORT_AUTOSKIP` (3) người khác nhau
báo cùng video đang chiếu (đếm theo **IP khác nhau**) → gỡ ngay + chặn video (admin bỏ chặn được). Mỗi người tối đa 3 báo
cáo / phút, cùng một video chỉ tính một lần / 10 phút. Admin: "⏭ Admin bỏ qua" (chỉ bỏ qua) và **"🚫 Gỡ hẳn"** (chặn video
khỏi mọi hàng chờ + dừng ở mọi phòng đang chiếu — dùng khi có khiếu nại bản quyền).

## 6. Chính sách quyền riêng tư (`public/chinh-sach.html`, đường dẫn `/chinh-sach`)

Nói rõ: dùng dịch vụ YouTube API, link Điều khoản YouTube + Chính sách quyền riêng tư Google + trang quản lý quyền truy
cập Google; rạp lưu gì (tên, ngoại hình, chat trong bộ nhớ, IP băm, khoá trình duyệt, báo cáo), không lưu gì; cookie
(chỉ admin); cách báo cáo / khiếu nại bản quyền (email lấy từ `CONTACT_EMAIL` nếu có). Màn vào rạp có link tới trang này.
Không gắn quảng cáo / affiliate cạnh trình phát.
