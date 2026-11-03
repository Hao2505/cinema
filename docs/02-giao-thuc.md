# Giao thức (HTTP + WebSocket)

Nguồn sự thật: `src/types.ts` (kiểu), `src/protocol.ts` (kiểm thông điệp client), `public/js/store.js` (client đọc).
Mọi thông điệp là JSON một dòng; client gửi tối đa 4 KB / tin.

## HTTP

| Đường dẫn | Việc |
|---|---|
| `GET /`, `GET /chinh-sach` | trang (no-cache). Server viết lại `href/src` của `.css/.js` thành `/v/<phiên bản>/…` và điền `%SITE_URL%`, `%OG_VERSION%`, `%CONTACT_EMAIL%` |
| `GET /v/<phiên bản>/…` | file tĩnh cache 1 năm (`immutable`); phiên bản = băm tên + cỡ + mtime mọi file `public/` lúc khởi động |
| `GET /api/health` | `{ ok, rooms, viewers, players, playing, yt }` |
| `POST /api/admin/login` `{token}` | đúng mã → cookie `vc_admin` = sha256(mã + muối) HttpOnly, SameSite=Strict, 1 năm (cookie **không** chứa mã thật). Sai → 403; 10 lần / 10 phút / IP |
| `POST /api/admin/logout` | xoá cookie |

Header bảo mật: CSP (chỉ script của mình + `www.youtube.com`; khung nhúng chỉ YouTube), `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin` (YouTube cần Referer để phát — đừng đổi sang `no-referrer`).
Không phục vụ dotfile, `.d.ts`, đường dẫn `..`, symlink ra ngoài `public/`.

## WebSocket `/ws`

Upgrade chỉ nhận Origin cùng trang (chặn trang khác dùng cookie admin của mình). Quyền admin quyết định lúc kết nối
từ cookie. `?room=N` (từ `/?phong=N`) chọn phòng đứng xem. Tối đa `MAX_CONN_PER_IP` kết nối / IP. IP lấy từ `X-Real-IP`
do nginx ghi (nginx bật realip, chỉ tin `CF-Connecting-IP` khi kết nối đến từ dải IP Cloudflare → không giả được bằng
cách gọi thẳng IP VPS); không có nginx (máy dev) thì `CF-Connecting-IP` / `X-Forwarded-For` / IP kết nối. Chỉ lưu bản băm
có muối.

### Client → server

| `t` | Trường | Ghi chú |
|---|---|---|
| `ping` | `c` | trả `pong {c, s}` để đo giờ server |
| `spec` | `room` | đổi phòng đang đứng xem (chưa vào rạp) |
| `join` | `name, look, room, token, ck` | `token` + `ck` khớp = nối lại nhân vật cũ (giữ 15 s sau khi rớt; socket cũ còn treo thì bị thay, đóng 4002; mốc giờ máy được đặt lại để trang vừa F5 vẫn đi được); `ck` = khoá ngẫu nhiên của trình duyệt (chống spam / cấm; video người đó thêm trước khi server khởi động lại được nhận lại quyền theo `ck`) |
| `move` | `x, y, d, c, m` | vị trí chân (ô), hướng 0–3, `c` = giờ máy mình (ms), `m` = đang đi. Tối đa ~15 / s |
| `act` | `a, c` | bắt đầu động tác (`''` = thôi) |
| `chat` | `text` | ≤ 140 ký tự |
| `emo` | `e` | một trong `REACTIONS` |
| `look` | `look` | đổi ngoại hình |
| `q_add` / `q_del` | `url` / `qid` | thêm video / xoá video mình thêm |
| `vote` | `on` | phiếu bỏ qua |
| `report` | `kind ('video'|'user'), target, reason, note` | |
| `vid_err` | `v, code` | trình phát báo lỗi 2/100/101/150 |
| `adm` | `op` + tham số | chỉ socket admin: `skip pause resume remove top lock mute unmute kick ban unban block unblock clear_chat state` |

### Server → client

| `t` | Khi nào |
|---|---|
| `hello` | ngay khi nối: `s` giờ server, `rooms`, `room`, `snap` (người, hàng chờ, đang chiếu, phiếu, 30 tin chat), `admin`, `cfg` |
| `welcome` / `join_err` | trả lời `join` (`you`, `token`, `snap`) / lý do (`name`, `name_taken`, `banned`, `kicked`, `full`, `rate`) |
| `f` | 15 Hz, **chỉ người vừa đổi**: `[[id, x, y, d, c, m], …]` — `c` là giờ máy NGƯỜI ĐI (không phải giờ server) |
| `pj` / `pl` / `pu` | người vào / ra / đổi (tên, ngoại hình, mất mạng) |
| `act` | `{id, a, c}` — "A bắt đầu điệu X lúc c (giờ máy A)"; mọi máy tự chạy hoạt ảnh |
| `chat`, `chat_clear`, `emo` | |
| `queue` | `{q, locked}` |
| `now` | `{n, s}` — đồng hồ phòng: `n.at` = giờ server ứng với giây 0, `paused`, `pos`, `ends`, `live`, `dur` |
| `votes` | `{n, need, mine}` |
| `q_res` | kết quả thêm video (`ok`, `text` lý do bằng tiếng Việt) |
| `corr` | server sửa vị trí của mình `{x, y}` |
| `notice` | thông báo `{text, kind}` |
| `rooms` | danh sách phòng (số người) |
| `kicked` | bị mời ra / cấm (socket đóng mã 4001, client không tự nối lại). Mã 4002 = nhân vật vừa được nối lại từ tab / máy khác → tab này nhường, không tự nối lại |
| `adm` | chỉ admin: `kind: 'state' | 'note'` |

## Kiểm tra di chuyển (server)

`hub.ts onMove`: mỗi người có "ngân sách quãng đường" hồi `SPEED × 1,3` ô / giây, tích tối đa 1,2 giây đi bộ (gói tới dồn
sau khi mạng nghẽn vẫn hợp lệ). Vượt ngân sách → cắt bớt + gửi `corr`; vào chỗ cấm (tường, sân khấu, loa, quầy) → trượt
theo `moveWithCollision` + `corr`. `c` phải tăng dần và không chạy nhanh hơn giờ thật quá 1 s. Đi (`m=1`) là server tự bỏ
động tác.

## Giới hạn tốc độ (mỗi người)

| Việc | Giới hạn |
|---|---|
| mọi tin trên một socket | 80 dồn, 45 / s; vượt quá nhiều → đóng socket |
| move | 30 dồn, 24 / s |
| chat | 3 dồn, 1 / 2 s, cách nhau ≥ 0,6 s, cấm lặp lại trong 20 s; 5 lần vi phạm / 30 s → tự tắt tiếng 2 phút |
| emoji / động tác / đổi ngoại hình | 6 / 2,5 s · 4 / 2 s · 3 / 5 s |
| thêm video | 2 dồn, 1 / `QUEUE_ADD_SECONDS` (8 s); link mới (chưa có trong bộ nhớ) ≤ `LOOKUPS_PER_IP_MINUTE` (6) / IP / phút; cả rạp ≤ 120 lần hỏi YouTube / phút |
| báo cáo | 3 / phút; cùng người + cùng đối tượng chỉ tính 1 lần / 10 phút; ghi đĩa không chặn |
| vào rạp | `JOINS_PER_MINUTE` / IP |

Tắt tiếng và mời ra tính **theo máy** (`ck`), không theo IP: ở VN nhiều người chung IP (4G, wifi quán). Cấm tính theo máy
(tới hết hạn) + theo IP (chỉ 24 giờ đầu).

## Lưu trữ (`DATA_DIR`, mặc định `data/`)

`rooms.json` (hàng chờ + video đang chiếu + video bị gỡ + bộ đếm id; ghi mỗi 30 s khi có đổi và khi tắt — deploy không
mất hàng chờ, id người sau khởi động lại không trùng id cũ), `bans.json`, `reports.jsonl` (mỗi dòng một báo cáo), `ip-salt.txt` (muối băm IP). Ghi nguyên tử (file tạm rồi
rename), quyền 600.
