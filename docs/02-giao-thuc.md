# 02 · Giao thức HTTP + WebSocket

**Nguồn sự thật**: `src/types.ts` (kiểu `ServerMsg`, `ClientMsg`, `AdminOp`), `src/protocol.ts` (kiểm từng thông điệp
client), `src/hub.ts` (luật nghiệp vụ), `public/js/store.js` (`handleMessage` — client đọc phòng thủ: trường lạ / thiếu
thì bỏ qua). Sửa giao thức = sửa cả bốn chỗ (hướng dẫn: [08](08-mo-rong.md) §5).

Mọi thông điệp WebSocket là **một object JSON dạng text** có trường `t` (loại). Client gửi tối đa **4096 byte / tin**;
tin binary, rỗng, quá cỡ hoặc sai dạng bị **bỏ im lặng** (không trả lỗi).

## 1. HTTP

| Đường dẫn | Việc |
|---|---|
| `GET /` · `GET /chinh-sach` | trang (no-cache). JS / CSS được viết lại thành `/v/<phiên bản>/…`; `%SITE_URL%`, `%OG_VERSION%`, `%CONTACT_EMAIL%` được điền |
| `GET /v/<phiên bản>/<file>` | file tĩnh, `immutable` 1 năm (phiên bản = băm mọi file `public/` lúc khởi động) |
| `GET /api/health` | `{ ok: true, rooms, priv, viewers, players, playing, yt }` — số phòng chung, số phòng riêng đang mở, socket, nhân vật, phòng đang chiếu (mọi phòng), có `YT_API_KEY` không |
| `POST /api/admin/login` | `Content-Type: application/json`, body `{ "token": "<ADMIN_TOKEN>" }` → `204` + cookie `vc_admin` (HttpOnly, SameSite=Strict, 1 năm, giá trị = băm của mã). Sai → `403`; > 10 lần / 10 phút / IP → `429`; admin tắt → `404` |
| `POST /api/admin/logout` | `204`, xoá cookie |

Client không gọi login trực tiếp từ form: mở trang kèm `#admin=<mã>` (hoặc `?admin=`) **một lần** → `net.js
adminLoginFromUrl()` gỡ mã khỏi thanh địa chỉ rồi POST. Phần `#…` không bao giờ được trình duyệt gửi lên server / log.

Chi tiết header bảo mật, CSP, file tĩnh: [07](07-server.md) §2.

## 2. Kết nối WebSocket

```
wss://<host>/ws[?room=<id phòng>]        ← trang /?phong=<id> thì net.js gắn ?room=<id>
```

- `?room=` nhận id phòng chung lẫn phòng riêng (`ANY_ROOM_ID_RE`). **Phòng riêng**: người thường **không bao giờ đứng xem**
  được — socket đứng xem phòng chính của rạp mặc định (`hello` của phòng chung) rồi nhận ngay `proom_need {room, exists}`
  (client hiện ô nhập mật khẩu); admin thì đứng xem thẳng phòng riêng và cả phòng được báo (§13).

- `Origin` phải cùng trang (hoặc trùng `SITE_URL`); không có `Origin` (bot, test) được nhận. Sai → HTTP 403.
- Quyền admin quyết định **lúc mở socket** từ cookie `vc_admin` → `hello.admin`.
- Mỗi IP tối đa `MAX_CONN_PER_IP` socket (mặc định 12), cả server 1500 → đóng mã `1013`.
- Server ping WebSocket mỗi **10 s**; không pong → ngắt (socket chết im lặng bị phát hiện trong 10–20 s → nhân vật chuyển
  "mất mạng", 15 s sau mới bị bỏ). Đóng tab → client gửi `leave` (trên `pagehide`) → nhân vật bị bỏ **ngay**. Client tự nối lại với backoff `min(12 s, 0,7 s × 1,7^lần) × (0,8–1,2)`, nối
  ngay khi tab hiện lại / có mạng lại — trừ khi bị đóng mã `4001` / `4002` (§9).
- Mở socket = **đứng xem** phòng (nhận mọi thứ của phòng, chưa có nhân vật). Gửi `join` mới có nhân vật.

## 3. Id phòng & rạp

| Khái niệm | Giá trị |
|---|---|
| Rạp (`VENUES` trong `shared/hall.js`) | `nhung` (Rạp Nhung Đỏ, mặc định), `congvien` (Rạp Công Viên), `doxe` (Rạp Đỗ Xe), `bien` (Rạp Bãi Biển) |
| Phòng chính | id = id rạp, luôn mở |
| Bản sao khi rạp đầy | `<rạp>-2 … <rạp>-MAX_ROOMS` (tối đa 9), bỏ trống 10 phút thì đóng |
| Định dạng | `ROOM_ID_RE = /^[a-z]{3,10}(?:-[2-9])?$/`; `parseRoomId("bien-2") → { venue, n: 2 }` |
| Tên hiển thị | `roomName(id)`: "Rạp Bãi Biển", "Rạp Bãi Biển 2" |
| **Phòng riêng** | id `p-` + 10 ký tự `[a-z0-9]` ngẫu nhiên (`crypto.randomInt`, không đoán được): `PRIVATE_ROOM_RE = /^p-[a-z0-9]{10}$/`, `isPrivateRoomId(id)`. Không có trong danh sách `rooms`. Rạp (khung cảnh) + tên ("Phòng của <tên>") do chủ phòng tạo → lấy từ snapshot (`snap.venue`, `snap.name`, `snap.priv`), **không** suy ra từ id |
| Id bất kỳ | `ANY_ROOM_ID_RE` = phòng chung hoặc riêng — dùng khi kiểm id từ URL / thông điệp. `ROOM_ID_RE` / `parseRoomId` / `roomName` cố ý **chỉ** nhận phòng chung (`parseRoomId('p-…') = null`) |

Mọi rạp dùng chung sơ đồ đi lại `HALL`; chỉ cách vẽ khác. Mỗi phòng có màn hình, hàng chờ, chat riêng.

> `protocol.ts` nhận trường `room` của `spec` / `switch` / `join` tới 16 ký tự rồi kiểm bằng `ANY_ROOM_ID_RE` (id dài nhất
> hiện có: `p-xxxxxxxxxx` = 12, `congvien-2…9` = 10 ký tự; test đơn vị giữ các trường hợp này). Bản 0.4.0 đầu từng cắt ở 8 ký tự khiến bấm "Rạp Công Viên
> 2" trên thẻ "Chào mừng quay lại" vào nhầm phòng — đã sửa.

## 4. Trường thời gian — đọc kỹ

| Trường | Đồng hồ | Ở đâu |
|---|---|---|
| `c` trong `move`, `f`, `act` (cả hai chiều) | **giờ máy người gửi**: `performance.now()` ms (số nguyên) của trình duyệt người đi — *không phải* giờ server | server giữ nguyên và phát lại để máy khác nội suy theo nhịp của người đi ([03](03-frontend.md) §11) |
| `c` trong `ping` / `pong` | `performance.now()` của chính client (ms, 3 số lẻ) | server trả nguyên |
| `s` trong `hello`, `pong`, `now` | giờ server `Date.now()` (ms epoch) | client ước lượng `offset` → `store.serverNow()` |
| `at`, `ends` trong `NowInfo` | giờ server (ms epoch) | `at` = giờ server ứng với **giây 0** của video; `ends` = dự kiến hết bài |
| `pos` trong `NowInfo` | giây | vị trí đang dừng khi `paused` |
| `ae` trong `PlayerInfo` | ms | động tác đã chạy bao lâu lúc server tạo bản tin |
| `at` trong `ChatInfo`, `joinedAt`, `until` | giờ server (ms epoch) | |

Vị trí luôn tính **bằng ô** (tile), là **điểm chân**: `x` ngang (0 → `HALL.W` = 34), `y` = độ sâu (0 ở mép sân khấu →
`HALL.H` = 16 ở tường cuối). Hướng `d`: `0` xuống · `1` lên (quay về màn hình) · `2` trái · `3` phải.

## 5. Client → server (`ClientMsg`)

| `t` | Trường (kiểm ở `protocol.ts`) | Server làm gì (`hub.ts`) |
|---|---|---|
| `ping` | `c` số (thiếu → 0) | trả `pong {c, s}` |
| `spec` | `room` khớp `ANY_ROOM_ID_RE` (≤ 16 ký tự) | chỉ khi chưa có nhân vật: đổi phòng đang xem → `hello` mới. Phòng riêng: chỉ admin; người thường nhận `proom_need` (không bao giờ nghe lén được phòng riêng) |
| `switch` | `room` khớp `ANY_ROOM_ID_RE` (≤ 16 ký tự); `rt` tuỳ chọn (vé phòng riêng, `^[A-Za-z0-9_-]{16,64}$`, sai dạng thì bỏ) | đã có nhân vật: chuyển sang phòng / rạp khác **không tải lại trang** — giữ id, tên, ngoại hình, token; xuất hiện ở lối đi cuối rạp mới → `welcome` mới. Rạp đầy / trùng tên / đổi quá nhanh (`JOINS_PER_MINUTE`) → `notice` warn, ở yên. Phòng riêng: qua cổng `privEntry` (§13) — chưa có quyền → `proom_need`; bị mời ra / đầy / trùng tên → `proom_res` `kicked` / `full` / `name` |
| `leave` | — | đóng tab / rời trang (`pagehide`, không phải bộ nhớ đệm): bỏ nhân vật ngay (`pl` cho cả phòng); socket vẫn mở như người đứng xem |
| `away` | — | **điện thoại** trang ẩn (chuyển app, về màn hình chính, tắt màn hình — `visibilitychange`): người khác nhận `pl` ngay, nhân vật giữ chỗ nhưng không có trong danh sách / số người / số phiếu; đang ẩn mà socket đóng → bỏ hẳn (không "mất mạng") |
| `back` | — | trang hiện lại: `pj` cho người khác, hiện đúng chỗ cũ (thao tác bất kỳ khi đang ẩn cũng tính là quay lại; vào lại bằng token lúc đang ẩn cũng vậy) |
| `join` | `name` chuỗi ≤ 80; `look` bất kỳ; `room` khớp `ANY_ROOM_ID_RE` (sai → `''`); `token` 32 hex (sai → `''`); `ck` 16–64 hex (sai → `''`); `rt` tuỳ chọn (vé phòng riêng, sai dạng thì bỏ) | vào rạp / nối lại → `welcome` hoặc `join_err` ([07](07-server.md) §5). Phòng riêng: chủ phòng (khoá máy `ck`) hoặc vé `rt` của đúng máy này, kiểm **đồng bộ** (vé không bao giờ bị băm / tính lượt thử) |
| `move` | `x, y` hữu hạn, \|·\| ≤ 1000 (client gửi 3 chữ số lẻ); `d` nguyên 0–3; `c` 0–1e12 (làm tròn); `m` = `1`/`true` → 1, còn lại 0 | kiểm ngân sách + va chạm, có thể trả `corr`; vào frame `f` (x, y 3 chữ số lẻ) |
| `act` | `a` ∈ `ACTION_IDS` hoặc `''` (thôi); `c` (sai → 0) | phát `act` cho cả phòng |
| `chat` | `text` ≤ 1000 ký tự thô | lọc (`cleanText` ≤ 140, link, bậy, lặp, tốc độ) → `chat` |
| `emo` | `e` ∈ `REACTIONS` (`❤️ 😂 👏 🔥 😮 😢 🎉 👍`) | phát `emo` |
| `look` | `look` là object | `normalizeLook` → `pu` |
| `q_add` | `url` ≤ 500 | kiểm + hỏi YouTube → `q_res`, `queue` / `now` |
| `q_del` | `qid` nguyên 1–1e9 | xoá bài **của mình** (theo id hoặc khoá máy) |
| `vote` | `on` boolean | bỏ phiếu bỏ qua / rút phiếu; người thêm bài → bỏ ngay |
| `report` | `kind` `'video'` \| `'user'`; `target` ≤ 40 (video: id video; user: id người dạng chuỗi); `reason` ≤ 40 bắt buộc (`copyright`, `inappropriate`, `spam`, `harass`, `other` — lạ → `other`); `note` ≤ 600 (server cắt 300) | ghi báo cáo, báo admin, có thể tự gỡ |
| `vid_err` | `v` id 11 ký tự; `code` nguyên 0–10000 | đếm máy báo lỗi 2/100/101/150 → chuyển bài |
| `vid_dur` | `v` id 11 ký tự; `d` số 0–1e8 (giây); `live` true/1 | độ dài thật của video `unk` đang chiếu (rạp kiểm cơ bản, không key) → người thêm báo là nhận, người khác cần đủ số mạng; cập nhật `dur` / `ends` / `live` rồi phát `now` |
| `proom_new` | `pass` chuỗi ≤ 200 (thô — hub chuẩn hoá NFC + bỏ khoảng trắng hai đầu rồi mới kiểm 4–40 ký tự); `cap` số nguyên; `venue` ≤ 12; `name` ≤ 40 (thiếu → `''`); `ck` như `join` | tạo phòng riêng (đã vào rạp hay chưa đều được) → `proom_ok {created: true}`; đã có nhân vật thì chuyển vào phòng luôn (`welcome`), chưa có thì client gửi `join {room, rt}`. Lỗi → `proom_res` (`invalid`, `owned` + `room`, `limit`, `rate`, `busy`). Chi tiết: §13 |
| `proom_auth` | `room` khớp `PRIVATE_ROOM_RE`; `pass` ≤ 200; `ck` như `join` | nhập mật khẩu → `proom_ok` (vé `rt` mới cho máy này; đã có nhân vật thì chuyển vào luôn). Phòng không còn → `proom_need {exists: false}`; lỗi → `proom_res` (`bad_pass`, `rate`, `busy`, `kicked`, `invalid`) |
| `proom_op` | `op` ∈ `pause`, `resume`, `skip`, `remove` (+ `qid` nguyên 1–1e9), `kick` (+ `pid` nguyên 1–1e9), `pass` (+ `pass` ≤ 200), `cap` (+ `cap` nguyên), `close` — thiếu tham số bắt buộc → bỏ | chỉ trong phòng riêng **người gửi đang đứng**. `pause` / `resume`: mọi thành viên (cả phòng được báo ai bấm); còn lại: chủ phòng hoặc admin, người khác → `proom_res denied`. `pass`: tối đa 5 lần / 10 phút / phòng (`proom_res rate`) |
| `adm` | `op` + tham số (§6) | chỉ socket admin; người thường → bỏ im lặng |

Mọi lệnh trừ `ping`, `spec`, `join`, `adm`, `proom_new`, `proom_auth` cần đã có nhân vật **và** socket này đang giữ nhân vật đó.

## 6. Lệnh admin (`{ t: 'adm', op, … }`)

| `op` | Tham số (kiểm ở `parseAdmin`) |
|---|---|
| `skip`, `pause`, `resume`, `clear_chat`, `state` | — |
| `remove`, `top` | `qid` nguyên 1–1e9 |
| `lock` | `on` boolean |
| `mute` | `pid` nguyên ≥ 1, `minutes` 0–43200 (0 = vô hạn) |
| `unmute`, `kick` | `pid` |
| `ban` | `pid`, `hours` 0–8760 (0 = vĩnh viễn) |
| `unban` | `id` hex 4–40 ký tự |
| `block` | `v` id 11 ký tự hoặc rỗng / thiếu (= video đang chiếu) |
| `unblock` | `v` id 11 ký tự |
| `close_room` | `room` khớp `PRIVATE_ROOM_RE` — đóng một phòng riêng (mọi người về phòng chung) |

`adm {op: 'state'}` trả thêm `privRooms: [{id, name, venue, count, cap, now /* tên video */, v, createdAt, lastInput}]`
(mới thao tác trước) — admin vào xem (mở `/?phong=<id>`) hoặc đóng được khi xử lý báo cáo / vi phạm. Ý nghĩa từng lệnh:
[07](07-server.md) §12.

## 7. Server → client (`ServerMsg`)

| `t` | Trường | Khi nào |
|---|---|---|
| `hello` | `v` (= `PROTOCOL`, hiện 1), `s`, `rooms: RoomInfo[]`, `room` (id), `snap: RoomSnapshot`, `admin`, `cfg: PublicSettings` | ngay khi nối; sau `spec`; khi bản sao bị đóng và mình bị dời về phòng chính; khi bị đưa ra khỏi phòng riêng mà không sang được phòng chung nào (thành người đứng xem — sau `proom_res out`) |
| `welcome` | `you` (id nhân vật), `token` (giữ trong `sessionStorage` để nối lại), `room`, `snap` | vào rạp / nối lại thành công |
| `join_err` | `code`, `text` | §9 |
| `f` | `p: FrameEntry[]` — mỗi dòng `[id, x, y, d, c, m]` | nhịp `TICK_HZ` (30 Hz), **chỉ người vừa đổi**; `c` = giờ máy người đi |
| `pj` | `p: PlayerInfo` | người vào (người khác) |
| `pl` | `id` | người rời hẳn (hết 15 s chờ, bị mời ra / cấm) |
| `pu` | `p: PlayerInfo` | đổi tên / ngoại hình / mất mạng (`ghost`) / nối lại |
| `act` | `id`, `a` (`''` = thôi), `c` | "người `id` bắt đầu điệu `a` lúc `c` (giờ máy họ)" — mọi máy tự chạy hoạt ảnh |
| `chat` | `m: ChatInfo` | |
| `chat_clear` | — | admin xoá chat |
| `emo` | `id`, `e` | thả cảm xúc |
| `queue` | `q: QueueItemInfo[]`, `locked` | hàng chờ đổi |
| `now` | `n: NowInfo \| null`, `s` | đổi bài, dừng / chạy, video mặc định |
| `votes` | `n`, `need`, `mine` | phiếu đổi (riêng từng người vì `mine`) |
| `q_res` | `ok`, `text` (tiếng Việt) | trả lời `q_add` |
| `pong` | `c`, `s` | trả `ping` |
| `corr` | `x`, `y` | server sửa vị trí của mình |
| `notice` | `text`, `kind` (`info` \| `ok` \| `warn` \| `err`) | thông báo (client: toast; `info` còn ghi vào khung chat) |
| `rooms` | `rooms: RoomInfo[]` | số người / phòng hoặc video đang chiếu đổi (gom 800 ms, gửi mọi socket) |
| `kicked` | `text` | bị mời ra / cấm — socket đóng mã 4001 ngay sau |
| `proom_need` | `room`, `exists` | phòng riêng cần mật khẩu: sau `hello` khi mở `?room=p-…`; sau `spec` / `switch` / `join_err priv_*` vào phòng riêng chưa có quyền. `exists: false` = phòng không còn (đã đóng) |
| `proom_ok` | `room`, `rt`, `venue`, `name`, `created?` | vừa tạo phòng (`created: true`) / nhập đúng mật khẩu. `rt` = vé vào lại của **máy này** (client giữ `localStorage vc.rt`, server chỉ giữ băm) — tới **trước** `welcome` khi server chuyển người đang có nhân vật vào phòng |
| `proom_res` | `ok`, `text` (tiếng Việt), `code?`, `room?` | kết quả thao tác phòng riêng. `code`: `invalid`, `owned` (máy này đang có phòng còn thành viên — `room` = id phòng đó), `limit`, `rate`, `busy`, `bad_pass`, `kicked`, `full`, `name` (phòng muốn vào đã có người trùng tên — `room` = phòng đó), `denied`, `ok`, `out` (bị đưa ra khỏi phòng — mời ra / phòng đóng / thu hồi: tới **trước** `welcome` của phòng chung hoặc `hello` đứng xem; `room` = phòng riêng vừa rời) |
| `priv` | `priv: PrivInfo` | thông tin phòng riêng đổi (vào / ra / ẩn / mất mạng / đổi số người tối đa / quản trị viên tới đứng xem hoặc rời đi) — cả phòng |
| `proom_rt` | `room`, `rt` | vé mới (thay vé cũ của máy này): chủ phòng vừa đổi mật khẩu → người **đang có mặt** trong phòng (thành viên đang ẩn / mất mạng giữ vé cũ — vẫn dùng được; vé của người đã rời hết hiệu lực); hoặc thành viên vừa nối lại mà không còn vé hợp lệ |
| `adm` | `kind: 'state'` (+ dữ liệu, [07](07-server.md) §12) \| `kind: 'note'`, `text` | chỉ socket admin |

## 8. Kiểu dữ liệu (`src/types.ts`)

```ts
PlayerInfo   { id, name, look: Look, x, y, d, a: ActionId | '', ae, ghost }
FrameEntry   [id, x, y, d, ct, m: 0 | 1]
QueueItemInfo{ qid, v, title, ch, dur /* giây, 0 = live hoặc chưa rõ */, live, by, byId, unk?: true /* chưa rõ độ dài — kiểm cơ bản, xem docs/04 §3.1 */, adm?: true /* admin thêm: người thường không bỏ phiếu bỏ qua */ }
NowInfo      = QueueItemInfo & { at, paused, pos, ends, filler?: true /* video mặc định */ }
ChatInfo     { mid, pid, name, text, at }
RoomInfo     { id, name, venue, now /* tên video đang chiếu, '' = màn hình trống */, count /* gồm người đang nối lại */, cap }
RoomSnapshot { id, name, venue, players, queue, locked, now, votes: { n, need }, chat /* 30 tin */,
               priv? /* chỉ phòng riêng */ }
PrivInfo     { name, cap, ownerId /* id nhân vật chủ phòng đang trong phòng, 0 = vắng */, members: PrivMember[],
               admins? /* số kết nối quản trị viên đang ĐỨNG XEM (không có nhân vật); vắng = 0 */ }
PrivMember   { id, name, away /* đang ẩn trang */, ghost /* mất mạng */,
               adm? /* quản trị viên rạp vào hẳn — KHÔNG chiếm chỗ (trừ khi chính là chủ phòng), chủ phòng
                       không mời ra được */ }
             ← mọi nhân vật trong phòng, kể cả đang ẩn (vẫn giữ chỗ). Số người / số chỗ = members không có adm (adm
             mà id = ownerId — chủ rạp dùng phòng riêng của mình — vẫn tính).
             Có quản trị viên (admins > 0 hoặc một member adm) → giao diện hiện dấu 🛡 suốt lúc đó
PublicSettings { maxVideoMin, maxPerUser, capacity, liveMaxMin, allowLive, skipRatio, noCookie, ytReady,
                 defaultIdleSec /* 0 = tắt video mặc định */,
                 privMax /* số người tối đa chủ phòng chọn */, privMaxMin /* phút / video */, privPerUser,
                 privEmptyMin /* trống bấy nhiêu phút thì đóng */ }
Look         { body: 'nam'|'nu', skin, hair, hairStyle, shirt, pants, accessory, facial: 'none'|'ria'|'rau' }
```

`Look` chỉ nhận giá trị trong bảng của `shared/hall.js` (`normalizeLook` — giá trị lạ thành mặc định). Video mặc định
có `qid: 0`, `byId: 0`, `by: 'Rạp'`, `live: true`, `dur: 0`, `ends` = `Number.MAX_SAFE_INTEGER`.

## 9. Mã lỗi vào rạp & mã đóng socket

| `join_err.code` | Nghĩa | Client |
|---|---|---|
| `name` | tên không hợp lệ (độ dài, ký tự, link, bậy, tên dành riêng) | quay lại màn vào rạp, hiện lý do |
| `name_taken` | trùng tên trong phòng (không phân biệt dấu / hoa thường) | như trên |
| `banned` | bị cấm (theo khoá máy; theo IP chỉ 24 giờ đầu) | như trên |
| `kicked` | vừa bị mời ra (2 phút) | như trên |
| `full` | mọi phòng đều đầy; phòng riêng: "Phòng đã đủ {n}/{n} người — nhờ chủ phòng tăng số người nhé." | như trên |
| `rate` | vào ra quá nhanh (`JOINS_PER_MINUTE` / IP) | như trên |
| `priv_need` | phòng riêng: chưa có quyền (vé sai / hết hạn / mật khẩu đã đổi) — kèm `proom_need {exists: true}` | ô nhập mật khẩu |
| `priv_gone` | phòng riêng đã đóng — kèm `proom_need {exists: false}` | về thẻ vào rạp chung |
| `priv_kicked` | chủ phòng đã mời máy này ra (theo khoá máy) | như trên |

| Mã đóng | Nghĩa | Client tự nối lại? |
|---|---|---|
| `1001` | server tắt (deploy) | có — `main.js` tự gửi lại `join` (kèm `token`); server vừa khởi động không còn nhân vật cũ nên tạo nhân vật mới cùng tên + ngoại hình (hàng chờ, video đang chiếu được khôi phục) |
| `1008` | gửi quá nhiều tin (thùng 80 / 45 mỗi giây, vượt > 200 lần) | có |
| `1013` | quá nhiều kết nối (IP / cả server) | có |
| `4001` | bị mời ra / cấm | **không** (tải lại trang) |
| `4002` | nhân vật vừa được nối lại ở tab / máy khác | **không** — hiện "Bạn đang xem rạp ở tab khác" |

## 10. Giới hạn tốc độ & kiểm tra (server)

| Việc | Giới hạn | Vượt thì |
|---|---|---|
| Mọi tin trên một socket | thùng dồn 80, hồi 45 / s | bỏ tin; > 200 lần bỏ → đóng `1008` |
| `move` | dồn 30, hồi 24 / s; ngân sách quãng đường `SPEED × 1,3` ô/s (tích ≤ `SPEED × 1,2` ô) | bỏ / cắt + `corr` |
| `act` | dồn 4, hồi 2 / s | bỏ im lặng |
| `chat` | dồn 3, hồi 1 / 2 s; cách nhau ≥ 0,6 s; không lặp trong 20 s; ≤ 140 ký tự | `notice`; 5 lần / 30 s → tắt tiếng 2 phút |
| `emo` | dồn 6, hồi 2,5 / s | bỏ im lặng |
| `look` | dồn 3, hồi 1 / 5 s | `notice` |
| `q_add` (người thường) | dồn 2, hồi 1 / `QUEUE_ADD_SECONDS` (8 s); link mới ≤ `LOOKUPS_PER_IP_MINUTE` (6) / IP / phút; cả server ≤ 120 lần hỏi YouTube / phút; ≤ `MAX_QUEUE_PER_USER` bài chờ | `q_res` lỗi kèm lý do |
| `report` | dồn 3, hồi 3 / phút; cùng người + cùng đối tượng tính 1 lần / 10 phút | `notice` |
| `join` | `JOINS_PER_MINUTE` (20) / IP / phút | `join_err rate` |
| Băm mật khẩu phòng riêng (`proom_new`, `proom_auth`, `proom_op pass`) | mỗi kết nối 1 phép băm cùng lúc, cả server 2 | `proom_res busy` (không tính lượt) |
| `proom_auth` | **mọi** lần thử tính trước khi băm, đúng cũng không hoàn: 10 / 10 phút / **mạng** (IPv4 /32, IPv6 /64 — mọi phòng), 20 / 10 phút / phòng (chạm thì báo chủ phòng; chủ phòng đổi mật khẩu → lượt của phòng về 0). Vé `rt` không bị tính / khoá | `proom_res rate` |
| `proom_new` | 4 lần / giờ / mạng (`PRIVATE_CREATE_PER_HOUR`); mạng ≤ 3 phòng đang mở (`PRIVATE_PER_NET`), **dải mạng** (IPv4 /24, IPv6 /48) ≤ 6 (`PRIVATE_PER_SUBNET`); cả server ≤ 400 (`PRIVATE_ROOMS_MAX` — đủ thì thu hồi phòng hết thành viên lâu nhất, không có thì chia đều: người từ dải mạng chưa có phòng lấy phòng lâu không thao tác nhất của dải mạng giữ nhiều phòng nhất, ≥ 2); máy đang có phòng còn thành viên → `owned` | `proom_res rate` / `limit` / `owned` |
| `proom_op` | dồn 3, hồi 1 / 2 s mỗi người; `pass` thêm 5 lần / 10 phút / phòng (tính trước khi băm) | `notice` / `proom_res rate` |
| Đăng nhập admin | 10 / 10 phút / IP | HTTP 429 |
| nginx `/api/` (production) | 2 yêu cầu / s / IP, dồn 10 | HTTP 429 |

## 11. Trình tự điển hình

**Mở trang → vào rạp**

```
client                                   server
  │── WS /ws?room=bien ──────────────────►│ connect → spectators
  │◄──────────────── hello {snap, cfg} ───│
  │── ping {c} ──────────────────────────►│
  │◄────────────────────── pong {c, s} ───│   (đo offset giờ server; lặp 3 s × 8, sau đó 15 s)
  │── join {name, look, room, token, ck} ►│ onJoin
  │◄─────────── welcome {you, token, …} ──│──► pj {p} cho người khác
```

**Đi lại**

```
A: tickMe (60 fps, tự đi) ── move {x,y,d,c,m} ≤ 15/s ──► onMove (kiểm) ──► (sai) corr {x,y} ──► A
                                                         └─ Room.tick 30 Hz ── f [[idA,x,y,d,c,m],…] ──► B, C…
B: store.onFrame → pushSample(theo c của A) → stage vẽ tại now − buffer (nội suy)
```

**Phòng riêng: tạo (chưa vào rạp) → gửi link → bạn nhập mật khẩu**

```
A (chưa vào)  ── proom_new {pass, cap, venue, name, ck} ──►│ kiểm + băm scrypt (bất đồng bộ)
              ◄──────────── proom_ok {room, rt, created} ──│
              ── join {name, look, room: p-…, rt, ck} ────►│ privEntry: chủ phòng (ck) → welcome {snap.priv}
B mở /?phong=p-… ── WS /ws?room=p-… ──────────────────────►│
              ◄──── hello (phòng chung mặc định) + proom_need {room, exists: true}
              ── proom_auth {room, pass, ck} ─────────────►│ tính lượt → băm → so khớp
              ◄──────────────────── proom_ok {room, rt} ───│
              ── join {…, room: p-…, rt} ─────────────────►│ privEntry: vé của đúng máy B → welcome; A nhận pj + priv
```

**Phòng riêng: bị mời ra / phòng đóng**

```
chủ phòng ── proom_op {op: 'kick', pid} ──► băm khoá máy B vào kickedCkH + huỷ vé của B
B ◄── proom_res {ok: false, code: 'out', room} ◄── rồi welcome (phòng chung cùng rạp) — hoặc hello (đứng xem) nếu B đang ẩn
chủ phòng ◄── proom_res {ok: true, code: 'ok', text: "Đã mời … ra. Họ vẫn biết mật khẩu — …"}
```

**Thêm video → chiếu**

```
q_add {url} ─► onQueueAdd ─► (cache | YouTube videos.list) ─► checkMeta ─► q_res {ok} ─► next()
           ◄── now {n: {v, at = giờ chọn + 2 s, ends, …}, s} + queue {q} cho cả phòng
player.js: chưa tới at → cue, đúng giờ mới play; lệch > 1 s → seekTo (xem [04](04-youtube-va-phap-ly.md) §6)
```

## 12. Đổi giao thức

`PROTOCOL` (trong `shared/hall.js`, gửi ở `hello.v`) hiện là `1`; client chưa kiểm số này. Đổi theo kiểu **không phá**:
thêm trường mới là tuỳ chọn, client cũ bỏ qua trường lạ, server cũ bỏ qua `t` lạ. Thay đổi phá tương thích → tăng
`PROTOCOL` và cho client so `hello.v`. Nhờ phiên bản tài nguyên (`/v/<băm>/`), sau mỗi deploy trình duyệt tải lại đúng
JS mới, nên client và server thường cùng phiên bản.

## 13. Phòng riêng — tóm tắt luật (chi tiết: [07](07-server.md) §20)

- Miễn phí, mật khẩu chỉ khoá **phòng**, không bao giờ khoá một video. Mọi luật video giữ nguyên (công khai, cho nhúng,
  không 18+, xem được ở VN; admin gỡ video / chặn / `embedFail` áp dụng cả phòng riêng) — chỉ nới luật công bằng của rạp
  chung: video tới `PRIVATE_MAX_VIDEO_MINUTES` (720 phút — **chỉ video Data API đã kiểm đủ**; video chỉ qua kiểm cơ bản
  bằng oEmbed khi chưa có / hỏng / hết lượt `YT_API_KEY` giữ giới hạn rạp chung: `MAX_VIDEO_MINUTES` (admin
  `ADMIN_MAX_VIDEO_MINUTES`), live `LIVE_MAX_MINUTES`), mỗi người chờ `PRIVATE_PER_USER` (10) video, không video mặc định.
- **Cổng duy nhất** `privEntry(c, room, ck, rt?)` (mọi đường vào: `?room=`, `spec`, `join`, nối lại, `switch`):
  phòng không còn → `gone`; admin → vào được (không chiếm chỗ, không bị chặn); máy bị mời ra → `kicked`; có quyền = chủ
  phòng (khoá máy) hoặc vé `rt` còn hạn (30 ngày) của **đúng máy đó**; chưa có → `need`; đủ chỗ (tính cả người đang ẩn /
  mất mạng / đang vào dở, **không** tính quản trị viên) mà không phải chủ phòng → `full`.
- **Quản trị viên trong phòng riêng là trạng thái**, không bao giờ lặng lẽ: đứng xem → `priv.admins`; vào hẳn → thành viên
  `adm` (không chiếm chỗ, không giữ phòng khỏi tự đóng). Trong phòng do chính admin đó tạo thì là thành viên bình
  thường: không `adm`, không 🛡, không câu báo. Mỗi lần một kết nối admin
  thật sự vào phòng (rời đi / mất kết nối rồi vào lại là lần mới; đứng xem → vào hẳn trên cùng kết nối thì không) → cả
  phòng nhận `notice` "🛡 Quản trị viên rạp đang xem phòng này."; ai vào phòng (vào mới / nối lại / chuyển vào) lúc đang
  có quản trị viên cũng nhận đúng câu đó ngay sau `welcome`; admin tới / rời → cả phòng nhận `priv` mới.
- Người thường không bao giờ **đứng xem** phòng riêng (chỉ vào hẳn — có trong `priv.members`). `leave` khỏi phòng riêng →
  socket về đứng xem phòng chung (`hello`).
- Nối lại (`join` có `token` / `ck` khớp nhân vật cũ): so **id phòng** (không so rạp) — `room` khác phòng đang đứng mà vào
  được → chuyển luôn; không vào được (chưa có quyền / bị mời ra / đầy / trùng tên) → nối lại tại chỗ (`welcome`) rồi
  **sau đó** mới báo lý do (`proom_need` / `proom_res kicked | full | name`, kèm `room`).
- Đổi mật khẩu: vé của người không còn trong phòng hết hiệu lực; thành viên (kể cả đang ẩn / mất mạng) giữ vé; ai đang có
  mặt nhận vé mới (`proom_rt`); lượt dò mật khẩu của phòng về 0.
- Thứ tự tin: `proom_ok` trước `welcome` (tạo phòng / nhập đúng khi đang có nhân vật); `proom_res out` trước `welcome` /
  `hello` (bị đưa ra); `join_err priv_need` / `priv_gone` trước `proom_need`; `welcome` / `hello` trước `notice` 🛡 và
  trước lý do từ chối khi nối lại.
