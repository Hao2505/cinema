# 07 · Server: bên trong `src/`

Server là **một tiến trình Node** (TypeScript strict ESM, chạy thẳng bằng `tsx`, không build). Không có cơ sở dữ liệu:
trạng thái nằm trong bộ nhớ, vài thứ cần sống qua khởi động lại được ghi ra JSON trong `DATA_DIR` (§14). Video **không
bao giờ** đi qua server — server chỉ giữ "đồng hồ phòng" và hỏi YouTube siêu dữ liệu.

```
src/server.ts ──► config.ts (loadConfig) ──► app.ts (createApp) ──► hub.ts (Hub + Room)
                                               │                      ├─► moderation.ts (lọc, giới hạn, cấm, JSON)
                                               │                      └─► youtube.ts (link, API, luật, bộ đệm)
                                               └─► protocol.ts (kiểm thông điệp client)   types.ts (kiểu chung)
public/js/shared/hall.js ◄── import thẳng bởi hub.ts, protocol.ts, app.ts, server.ts (sơ đồ rạp, rạp, động tác…)
```

## 1. Khởi động & tắt — `server.ts`

1. `dotenv` nạp `.env` (biến đã có trong môi trường **thắng** `.env`).
2. `loadConfig()` → `Config` (§16). `ADMIN_TOKEN` < 12 ký tự → tự tắt admin + cảnh báo.
3. `setExtraBadWords(BLOCK_WORDS)` (từ cấm thêm), `createYouTubeClient(YT_API_KEY)`.
4. `createApp(cfg, { youtube, dataDir: PERSIST ? DATA_DIR : null })` → `app.listen(PORT, HOST)` → in banner (cổng, luật
   video, số phòng, nơi lưu; **không bao giờ in** `ADMIN_TOKEN` / `YT_API_KEY`). Cổng bận → báo `EADDRINUSE` rồi thoát.
5. `SIGINT` / `SIGTERM` → `app.close()` (dừng nhịp, **lưu `rooms.json`**, đóng socket mã 1001) → thoát; quá 2,5 s thì
   thoát cứng. `uncaughtException` / `unhandledRejection` chỉ ghi log — rạp không sập vì một lỗi lẻ.

## 2. HTTP + WebSocket — `app.ts`

`createApp(cfg, deps)` trả `{ server, hub, listen(port, host), close() }`. `deps = { youtube, dataDir (null = không ghi
đĩa, dùng cho test), log? }`. Dựng trong hàm để test chạy được nhiều bản song song (smoke dựng 2 app).

### 2.1 Đường dẫn

| Đường dẫn | Việc |
|---|---|
| `GET /`, `GET /chinh-sach` | trang HTML (`PAGES`), `Cache-Control: no-cache` + header bảo mật (§2.3) |
| `GET /v/<phiên bản>/<file>` | file tĩnh trong `public/`; đúng phiên bản hiện tại → `max-age=31536000, immutable`; phiên bản cũ → vẫn trả file nhưng `no-cache` |
| `GET /<file>` | file tĩnh `no-cache` + `Last-Modified` / `304` |
| `GET /api/health` | `{ ok, rooms, priv, viewers, players, playing, yt }` (`hub.stats()` + `youtube.configured`): `rooms` = phòng chung, `priv` = phòng riêng đang mở; `players` / `playing` tính mọi phòng |
| `POST /api/admin/login` | body JSON `{ token }` → cookie admin (§2.5) |
| `POST /api/admin/logout` | xoá cookie (204) |
| `GET /ws` (Upgrade) | WebSocket (§2.6) |
| khác | `/api/*` lạ → 404; phương thức khác GET/HEAD → 405 |

### 2.2 Phiên bản tài nguyên & HTML

- `computeAssetVersion()` băm (đường dẫn, cỡ, mtime) **mọi file trong `public/` lúc khởi động** → 12 ký tự hex. Không có
  `public/` thì `dev`.
- `sendHtml` viết lại mọi `href|src="<đường dẫn tương đối>.css|.js"` thành `/v/<phiên bản>/<đường dẫn>`, thay
  `%OG_VERSION%` (băm `og-image.jpg`) — cache theo mtime file HTML; mỗi request thay `%SITE_URL%` (`SITE_URL` hoặc suy từ
  `Host` + `X-Forwarded-Proto` / `CF-Visitor`, đã kiểm `HOST_RE`) và `%CONTACT_EMAIL%` (đã escape).
- Hệ quả: JS / CSS được cache "mãi mãi" theo URL; deploy mới → phiên bản mới → URL mới. **Sửa file client phải khởi
  động lại server** thì phiên bản mới có hiệu lực (`npm run dev` chỉ tự khởi động lại khi file server — kể cả
  `shared/hall.js` — đổi). Import động trong client (`import('./ui/admin.js')`, chủ đề rạp) dùng đường dẫn tương đối nên
  cũng nằm dưới `/v/<phiên bản>/`.

### 2.3 Header bảo mật (trang HTML)

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com;
  frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com https://*.ytimg.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' ws://<host> wss://<host>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
X-Content-Type-Options: nosniff · X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin   ← YouTube cần Referer để phát (lỗi 153) — đừng đổi sang no-referrer
```

Thêm script / khung / ảnh từ miền khác → phải sửa CSP ở đây (và chỉ khi thật cần).

### 2.4 File tĩnh an toàn (`handleStatic`)

Giải mã URL (lỗi / `\0` → 400); chặn đoạn `..` và mọi dotfile (`.env`, `.git`…) → 404; đường dẫn thật (`realpath`) phải
nằm trong `public/` (chặn symlink ra ngoài); không phục vụ `.d.ts`; thư mục → `index.html`. `Content-Type` theo bảng
`CONTENT_TYPES`, `X-Content-Type-Options: nosniff`.

### 2.5 IP người xem & admin

- `clientIp(req)`: `TRUST_PROXY=true` → `X-Real-IP` (nginx ghi, xem [05](05-van-hanh-deploy.md) §7) → `CF-Connecting-IP`
  → phần đầu `X-Forwarded-For` → IP kết nối. Chỉ dùng qua `hashIp(ip, salt)` (sha256 có muối, 20 hex) — **không lưu IP thô**.
- **Mạng** (`networkOf(ip)`, export để test): IPv4 = nguyên địa chỉ (/32), IPv6 = 64 bit đầu (/64 — nhà mạng cấp cả dải
  /64 cho một thuê bao, đổi địa chỉ trong dải không lách được), IPv4 trong IPv6 (`::ffff:1.2.3.4`) = IPv4. `net =
  hashIp(networkOf(ip), salt)` (cùng muối) → `Conn.net` — khoá cho **mọi** giới hạn phòng riêng (§20). IPv4 thì `net` trùng
  `ipHash`.
- **Dải mạng** (`subnetOf(ip)`, export để test): IPv4 /24, IPv6 /48 (IPv4 trong IPv6 → /24 của IPv4 đó). `subnet =
  hashIp(subnetOf(ip), salt)` → `Conn.subnet` — giới hạn thêm số phòng riêng đang mở (`PRIVATE_PER_SUBNET`) và chia đều
  khi rạp đủ phòng (§20.3): một thuê bao / tunnel IPv6 được cấp cả /56 hay /48 (hàng trăm dải /64) không lách được bằng cách
  đổi /64. Nhiều người chung một dải IPv4 (4G CGNAT) thì chung giới hạn dải — nên giới hạn dải (6) rộng hơn giới hạn mạng (3).
- Cookie admin `vc_admin` = `sha256("<ADMIN_TOKEN>:vibecinema-admin-v1")` (64 hex, không chứa mã thật), `Path=/;
  HttpOnly; SameSite=Strict` (+ `Secure` khi request là https), `Max-Age` 1 năm. Đổi `ADMIN_TOKEN` = mọi cookie cũ hết
  hiệu lực.
- `POST /api/admin/login`: admin tắt → 404; `Content-Type` phải là JSON (415); 10 lần / 10 phút / IP băm (429); body ≤ 2 KB;
  so mã bằng `safeEqual` (băm rồi `timingSafeEqual`); sai → 403 + log "sai mã" (không ghi mã).
- `isAdminReq(req)` đọc cookie khi **mở WebSocket** → quyền admin gắn vào `Conn` suốt phiên.

### 2.6 WebSocket

- Upgrade chỉ ở `/ws` và `originOk`: không có `Origin` (bot, test) → nhận; có → phải trùng `SITE_URL` hoặc trùng `Host`
  (chặn trang khác mượn cookie admin). Sai → `403` rồi đóng.
- `WebSocketServer({ noServer, maxPayload: 8192, perMessageDeflate: false })`. `?room=<id>` (khớp `ANY_ROOM_ID_RE`, ≤ 16
  ký tự) → phòng đứng xem ban đầu (phòng riêng: hub quyết — §20.2).
- Mỗi tin: `rawToString` (bỏ binary, rỗng, > 4096 byte) → `parseClientMsg` (sai dạng → bỏ im lặng) → `hub.message(conn,
  msg)` (bọc try/catch).
- Nhịp tim **10 s**: `ping`; lượt sau chưa thấy `pong` → `terminate()` (socket chết im lặng bị phát hiện trong 10–20 s).
  `close` → `hub.disconnect(conn)`.

## 3. `hub.ts` — mô hình dữ liệu

```
Hub
 ├─ rooms: Map<roomId, Room>        mỗi rạp luôn có phòng chính "<rạp>"; đầy thì thêm bản sao "<rạp>-N"; + phòng riêng "p-…"
 ├─ conns: Set<Conn>                mọi socket (người đứng xem + người đã vào)
 ├─ bans: BanList                   data/bans.json
 ├─ mutes, kicks: Map<"ck:<khoá máy>", hết hạn ms>      chỉ trong bộ nhớ (mất khi khởi động lại)
 ├─ blocked: Map<videoId, {v,title,at,reason}>          lưu trong rooms.json
 ├─ embedFail: Map<videoId, hết hạn>                    video lỗi 101/150: cấm thêm lại 24 h
 ├─ cache: VideoCache (6 h, 2000 video) · inflight: Map<videoId, Promise>  (gộp yêu cầu trùng)
 ├─ apiWindow (120 lần hỏi YouTube / phút cả server) · apiIpWindow (LOOKUPS_PER_IP_MINUTE) · joinWindow (JOINS_PER_MINUTE)
 ├─ reportSeen: Map<"ck|kind|target", hết hạn> · recentReports (100 báo cáo gần nhất, cho admin)
 ├─ defaultMeta, defaultOffUntil    video mặc định (§13)
 └─ privCreateWindow (lần tạo / giờ / mạng) · privNetAttempts / privRoomAttempts (thử mật khẩu / 10 phút) ·
    privPassChanges (đổi mật khẩu / 10 phút / phòng) · scryptInFlight · saveSoonTimer

Room
 ├─ id, venue, n (1 = phòng chính), name (roomName — phòng riêng: priv.name)
 ├─ priv: PrivState | null          phòng riêng (§20): tên, rạp, cap, băm mật khẩu, băm khoá máy chủ phòng, vé, bị mời ra…
 ├─ adminSeen: Set<cid>             phòng riêng: kết nối admin đã được báo "🛡" trong lần vào này (§12)
 ├─ players: Map<pid, Player>       gồm cả người "mất mạng" (ghost) đang chờ nối lại
 ├─ spectators: Set<Conn>           mọi socket đang xem phòng này (người đã vào cũng nằm ở đây)
 ├─ queue: QueueItem[] · now: NowPlaying | null · locked
 ├─ votes: Set<pid> · reports, errReports: Set<"ck:…" | "ip:…">   (xoá khi đổi bài)
 ├─ chat: ChatInfo[] (giữ 50, gửi 30 trong snapshot)
 └─ emptySince, idleSince, fillerOffUntil · members() / adminWatchers() / adminPresent() (phòng riêng — §12, §20.1)

Conn   { cid, sock, ipHash, net / subnet (mạng / dải mạng băm — §2.5), privBusy (đang băm mật khẩu), admin, room, player,
         bucket: Bucket(80, 45/s), strikes, closed }
Player { id, name, key (nameKey), look, x, y, d, m, ct (giờ máy người đi), lastMoveAt, budget, dirty, action,
         conn | null, ghostSince, token, ck (khoá máy), ckh (sha256(ck)), admin (quản trị viên — giữ khi mất mạng),
         ipHash, joinedAt, lastCorrAt, chat/emo/act/look/add/move/report/opBucket, lastChat, chatStrikes }
QueueItem  { qid, v, title, ch, dur (giây, 0 = live), live, by, byId, byCkH (sha256 khoá máy người thêm), addedAt,
             unk? (chưa rõ độ dài), basic? (chỉ qua kiểm cơ bản — giới hạn rạp chung ở mọi phòng), cap?, byAdmin? }
NowPlaying = QueueItem + { at, paused, pos, ends, filler? }
```

`Room.broadcast(msg, except?)` gửi cho người đã vào (có `conn`) + người đứng xem **chưa** có nhân vật (không gửi trùng).
`Hub.sendRaw` bỏ qua socket đã đóng hoặc đang nghẽn (`bufferedAmount > 1 MB`) — máy quá chậm thì mất tin chứ không làm
nghẽn server.

## 4. Phòng & rạp

- `VENUES` (4 rạp: `nhung`, `congvien`, `doxe`, `bien` — [03](03-frontend.md) §7) lấy từ `shared/hall.js`. Constructor
  `Hub` nạp `rooms.json` rồi đảm bảo mỗi rạp có phòng chính (id = id rạp, `n = 1`, **không bao giờ đóng**).
- **Phòng riêng** cũng nằm trong `Hub.rooms` (để `tick`, `findReturning`, `blockVideo`, `roomOf`… chạy như thường) nhưng
  bị lọc khỏi `sortedRooms` / `roomList` / `pickRoom`. Mọi id client gửi lên đi qua `publicRoom(id)` (id phòng riêng → `null`)
  hoặc cổng `privEntry` (§20.2) — không có đường nào tra thẳng `rooms.get(<id client>)` ra phòng riêng.
- `pickRoom(preferred?)`: phòng `preferred` còn chỗ → nó; đầy → phòng còn chỗ **cùng rạp**; chưa có → mở bản sao
  `<rạp>-2 … <rạp>-MAX_ROOMS`; hết cách → phòng còn chỗ bất kỳ (thứ tự rạp); đầy hết → `null` (`join_err full`).
  "Chỗ" tính `players.size` — **kể cả người đang nối lại**. Người đứng xem không chiếm chỗ.
- `tick` đóng bản sao (`n > 1`) không còn ai (`players.size === 0`) quá `ROOM_IDLE_CLOSE_MS` (10 phút): người đứng xem
  chuyển về phòng chính của rạp (gửi lại `hello`); hàng chờ của bản sao mất theo.
- `roomsChanged()` gom thay đổi 800 ms rồi phát `rooms` (`RoomInfo[]`: id, tên, rạp, tên video đang chiếu, số người,
  sức chứa) cho **mọi** socket — gọi khi có người vào / ra, mở / đóng phòng, đổi bài. `sortedRooms()` xếp theo thứ tự
  `VENUES` rồi `n`.

## 5. Kết nối, đứng xem, vào rạp

```
connect(sock, {ipHash, net, subnet, admin, room?})
  ├─ IP đã có ≥ MAX_CONN_PER_IP socket, hoặc cả server ≥ 1500 → null (app đóng 1013)
  ├─ ?room phòng riêng: admin → đứng xem thẳng (+ báo cả phòng, priv.admins — §12); người thường → phòng chính rạp mặc
  │                     định + proom_need
  ├─ phòng = ?room (bản sao đã đóng → phòng chính của rạp) || pickRoom() || phòng chính rạp mặc định
  └─ room.spectators.add(c) → hello { v: PROTOCOL, s, rooms, room, snap, admin, cfg }
spec {room}     (chỉ khi chưa có nhân vật) → chuyển sang xem phòng khác → hello mới (phòng riêng: chỉ admin, còn lại proom_need)
join {...}      → onJoin (dưới)
disconnect(c)   → bỏ khỏi spectators (leaveRoom: admin rời phòng riêng → cả phòng nhận priv, lần sau vào lại được báo
                  lại); nhân vật thành "ma" (conn = null, ghostSince) → pu (ghost: true), bỏ phiếu của người đó, tính lại
                  số phiếu cần; Room.tick xoá hẳn sau GHOST_MS (15 s) → pl
```

`onJoin` theo thứ tự:

1. **Nối lại**: `token` + `ck` khớp một Player ở bất kỳ phòng nào → gắn socket mới (socket cũ còn treo — đổi wifi ↔ 4G,
   tab nhân bản — nhận `notice` rồi bị đóng mã **4002**). Đặt lại `ct = 0`, `budget = 0` (trang vừa F5 có
   `performance.now()` về gần 0). `p.admin` = quyền admin của socket mới. Gửi `welcome` cho mình, `pu` cho người khác;
   phòng riêng: thành viên không còn vé hợp lệ (không phải chủ phòng / admin) → vé mới qua `proom_rt` (`ensureTicket`).
2. Lệnh cấm (`BanList.find(ipHash, ck)`) → `join_err banned`; vừa bị mời ra (`kicks["ck:…"]`) → `kicked`;
   `joinWindow` (JOINS_PER_MINUTE / IP) → `rate`; `checkName` → `name`.
3. Phòng muốn vào = `msg.room || phòng đang xem`. Phòng riêng → cổng `privEntry` **trước** mọi `pickRoom` (`priv_need` +
   `proom_need`, `priv_gone` + `proom_need {exists: false}`, `priv_kicked`, `full` — §20.2); phòng chung → `pickRoom` →
   `full` nếu null. Trùng `nameKey` trong phòng → `name_taken`.
4. Tạo Player: id tăng dần (`pid` lưu trong `rooms.json` nên không trùng sau khởi động lại), `normalizeLook`,
   `spawnPoint()` (lối đi cuối rạp), hướng lên, `token` 32 hex ngẫu nhiên, `ck` = khoá máy client gửi (thiếu thì tự sinh)
   + `ckh = sha256(ck)` (so với chủ phòng / vé / người bị mời ra / người thêm video — trên đĩa chỉ có băm), `admin` = quyền
   admin của socket (giữ cả khi mất mạng).
5. `room.addPlayer` (phát `pj`), `adoptItems` (video người này thêm trước đó — cùng `byCkH` — nhận lại quyền theo id mới),
   gửi `welcome { you, token, room, snap }`; phòng riêng → `announceAdmin` (§12).

## 6. Di chuyển — `onMove`

Client tự đi trước (dự đoán), server **kiểm tra rồi sửa nhẹ**:

1. `moveBucket` (dồn 30, 24 / s). Gói có `c ≤ ct` cũ → bỏ (gói cũ / trùng).
2. **Ngân sách quãng đường**: hồi `SPEED × 1,3` ô / s, tích tối đa `SPEED × 1,2` ô (gói tới dồn sau khi mạng nghẽn vẫn hợp
   lệ). Đi xa hơn ngân sách + 0,03 → cắt về đúng ngân sách (`corrected`).
3. Điểm đích không đứng được (`isWalkable`) → trượt bằng `moveWithCollision` (cùng hàm với client), vẫn sai thì
   `clampToWalkable` (`corrected`).
4. `ct` (giờ máy người đi) không được chạy nhanh hơn giờ thật quá 1 s so với gói trước (kẹp lại) — để máy khác nội suy
   đúng nhịp.
5. Cập nhật `x, y, d, m, ct`, đánh dấu `dirty`; đang đi (`m = 1`) thì bỏ động tác. Đã sửa → gửi `corr {x, y}` cho chính
   người đó (tối đa 1 lần / 150 ms).

`Room.tick` (**30 Hz**, `TICK_HZ`) gom người `dirty` thành một tin `f` — **chỉ người vừa đổi**. Giới hạn gói: `moveBucket`
dồn 60, hồi 40 / s; cả kết nối dồn 120, hồi 70 / s (đủ cho 30 gói vị trí / s + ping + chat).

**Vào lại / chuyển rạp / rời** (`hub.ts`):
- `findReturning(token, ck)`: nhân vật cũ theo **token** của tab (rớt mạng, F5) trước, rồi theo **khoá máy `ck`** (đóng
  tab mở lại, tab mới — không còn token). Tìm thấy: cùng tên → nhận lại đúng nhân vật (socket cũ còn treo thì đóng 4002),
  cập nhật ngoại hình, nếu `join.room` là **phòng khác** (so id phòng, không so rạp — phòng riêng cùng rạp với phòng chung)
  → sang luôn nếu vào được (`checkMove` → `transfer`), không thì nối lại tại chỗ (`welcome`) rồi **sau đó** mới gửi lý do
  `checkMove` trả về (`proom_need` / `proom_res kicked | full | name` kèm `room` / `notice` warn với phòng chung) — client
  đang ở màn vào rạp nhận welcome rồi chờ lý do ngay sau để báo trên thẻ; **khác tên** (cố ý đổi tên) → `dropPlayer` bỏ
  nhân vật cũ rồi vào mới. Nhờ vậy cùng máy không bao giờ bị "tên đã có người dùng" vì nhân vật của chính mình.
- `onSwitch` → `moveTo(c, p, from, roomId, now, limit, rt?)` = `checkMove` (trả `{to}` / `{err}` — chưa gửi gì) rồi gửi
  lý do hoặc `transfer`: phòng riêng → `privEntry` (vé `rt` của khoá máy nhân vật), trùng tên → `proom_res name`;
  phòng chung → `pickRoom(roomId)` (đầy → bản sao cùng rạp), khác rạp mong muốn / trùng tên → `notice` warn; được thì
  `transfer`: `removePlayer` ở phòng cũ, chỗ xuất hiện mới (`spawnPoint`), hết "ẩn", `addPlayer`, gửi `welcome` với ảnh chụp
  phòng mới.
- `onLeave`: bỏ nhân vật ngay (client gửi khi đóng tab). Rời phòng riêng → socket về đứng xem phòng chính chung (`hello`).
- `onAway` / `onBack` (chỉ điện thoại gửi — trang ẩn / hiện lại): `p.away = mốc` → `pl` cho người khác, bỏ phiếu của
  người đó; `count` / `present` / `presentIps` / `snapshot` không tính người đang ẩn. Quay lại (hoặc thao tác bất kỳ, hoặc
  vào lại bằng token) → `pj` đúng chỗ cũ. `disconnect` khi đang ẩn → `removePlayer` ngay (đóng tab từ màn đa nhiệm không
  hiện "mất mạng" 15 s).
- `pickRoom()` **không chọn rạp** → rạp **đông nhất** còn chỗ (theo `present()`), để ít người thì mọi người gặp nhau thay
  vì mỗi người một rạp.

## 7. Động tác, chat, emoji, ngoại hình

| Việc | Hàm | Luật |
|---|---|---|
| Động tác | `onAct` | `actBucket` (dồn 4, 2 / s); lưu `{a, ct, at}`; phát `act {id, a, c}` (c = giờ máy người làm). `a = ''` = thôi. Động tác có `dur` hết hạn tự rơi khi tạo `PlayerInfo` |
| Chat | `onChat` | đang bị tắt tiếng → `notice`; `checkChat` (link → từ chối kèm lý do, từ bậy → `***`); trùng tin trước trong 20 s → từ chối; `chatBucket` (dồn 3, 1 / 2 s) và cách tin trước ≥ 600 ms — vi phạm 5 lần / 30 s → **tự tắt tiếng 2 phút**. Hợp lệ → `chat {m}` cả phòng, giữ 50 tin |
| Emoji | `onEmo` | phải thuộc `REACTIONS`; bị tắt tiếng hoặc vượt `emoBucket` (dồn 6, 2,5 / s) → bỏ im lặng; phát `emo {id, e}` |
| Ngoại hình | `onLook` | `lookBucket` (dồn 3, 1 / 5 s); `normalizeLook`; phát `pu` |

Tắt tiếng / mời ra tính **theo khoá máy** (`ck:<ck>`), không theo IP — ở VN nhiều người chung IP (4G, wifi quán).

## 8. Hàng chờ & đồng hồ phòng

- `Room.next(now)`: lấy bài đầu hàng chờ; xoá phiếu / báo cáo / báo lỗi; `now = { ...item, at: now + PRELOAD_MS (2 s),
  paused: false, pos: 0, ends: at + thời lượng + END_GRACE_MS (1,5 s) }` — live: thời lượng = `LIVE_MAX_MINUTES` (phòng
  riêng: `PRIVATE_MAX_VIDEO_MINUTES` — trừ video chỉ qua kiểm cơ bản `basic`: vẫn `LIVE_MAX_MINUTES`). Hết
  hàng chờ → `now = null`. Phát `now`, `queue`, cập nhật phiếu, `dirty = true` (để lưu).
- `Room.tick(now)`: hết `ends` (không dừng) → `next`; trống mà hàng chờ có bài → `next`; đang phát video mặc định mà
  hàng chờ có bài → `next` (nhường ngay); theo dõi `idleSince` (§13); xoá người ma quá 15 s; gửi frame `f`.
- `pause` (admin; không áp cho live): `pos = (now − at) / 1000`, `paused = true`. `resume`: `at = now − pos × 1000`, tính
  lại `ends`. Cả phòng dừng / chạy cùng vị trí — không có lệnh tua riêng cho người xem.

## 9. Thêm video — `onQueueAdd`

```
q_add {url}
 ├─ bị tắt tiếng?                        → q_res lỗi
 ├─ hàng chờ khoá và không phải admin?   → lỗi
 ├─ parseVideoId(url)                    → không phải link YouTube → lỗi
 ├─ blocked / embedFail còn hạn?         → lỗi
 ├─ trùng video đang chiếu / trong hàng chờ → lỗi
 ├─ người thường: ≥ MAX_QUEUE_PER_USER bài (phòng riêng: PRIVATE_PER_USER; đếm theo byId hoặc byCkH) → lỗi
 ├─ hàng chờ ≥ MAX_QUEUE                 → lỗi
 ├─ người thường: addBucket (dồn 2, 1 / QUEUE_ADD_SECONDS) → "thử lại sau N giây"
 ├─ link chưa có trong cache: người thường ≤ LOOKUPS_PER_IP_MINUTE / IP / phút; cả server ≤ 120 / phút
 ├─ có key: lookup(id): cache 6 h → inflight (gộp) → youtube.fetchVideo
 │    ├─ được → checkMeta(meta, {region, maxSeconds: room.maxSeconds(admin), allowLive}) → lỗi thì q_res
 │    │    (phòng chung: (admin ? ADMIN_MAX : MAX)_VIDEO_MINUTES × 60; phòng riêng: max(PRIVATE_MAX, admin ? ADMIN_MAX : 0) × 60)
 │    └─ không được (no_key / quota / bad_key / api / network) → kiểm cơ bản ↓
 ├─ không key / API hỏng: lookupOEmbed(id) (nhớ 30 phút) → 401/403, 404, mạng → q_res lỗi; được → item unk + basic +
 │    cap = (admin ? ADMIN_MAX : MAX)_VIDEO_MINUTES × 60 — giới hạn rạp chung ở MỌI phòng, kể cả phòng riêng: oEmbed không
 │    biết video có công khai không ("không công khai" lọt qua), nên 12 giờ chỉ dành cho video Data API kiểm đủ (docs/04 §3.1)
 ├─ kiểm lại sau khi chờ mạng (người đã rời? video vừa được thêm? hết chỗ?)
 └─ push QueueItem (title / channel qua cleanText; byCkH = sha256 khoá máy người thêm) → q_res ok → chưa có bài: next()
    ngay; có: phát queue
    + notice "X vừa thêm …" cho người khác
```

`q_del {qid}`: chỉ người thêm (theo `byId` hoặc `byCkH` = băm khoá máy) hoặc admin. Admin dùng `adm remove` (chạy được cả khi chưa vào rạp).

## 10. Bỏ phiếu bỏ qua — `onVote`, `votesNeeded`

- `need = 1` nếu ≤ 1 người có mặt; ngược lại `min(có mặt, max(SKIP_VOTE_MIN, ⌈có mặt × SKIP_VOTE_RATIO⌉))`. "Có mặt" =
  người có kết nối (không tính ma).
- Video **admin thêm** (`byAdmin`, gửi xuống là `adm`): người thường bỏ phiếu → `notice` "Video do admin chọn — không bỏ
  phiếu bỏ qua được", không tính; admin dùng bảng 🛠. Báo cáo video admin không tự gỡ (vẫn ghi + báo admin).
- Người thêm bài bỏ phiếu cho **bài của mình** → bỏ qua ngay. Đủ phiếu → `notice` + `next`. Người rời / mất mạng → phiếu
  của họ bị xoá, `need` tính lại (có thể làm đủ phiếu ngay).
- Video mặc định (`filler`) **không bỏ phiếu được** — trả `notice` hướng dẫn dán link.

## 11. Báo cáo & lỗi trình phát

- `onReport`: trùng (`ck|kind|đối tượng`) trong 10 phút → cảm ơn, không tính; `reportBucket` (dồn 3, 3 / phút). Lý do
  ánh xạ `REPORT_REASONS` (copyright, inappropriate, spam, harass, other). Ghi `recordReport`: `recentReports` (100),
  nối thêm một dòng `data/reports.jsonl` (không chặn), log, `adm {kind: 'note'}` tới mọi admin đang mở. Báo cáo trong
  phòng riêng: dòng log chỉ có loại + lý do (không mã phòng, không video / người / ghi chú — đầy đủ chỉ ở `reports.jsonl`
  + bảng admin; §20.9).
  - Video: phải đúng video đang chiếu; đếm theo **IP khác nhau** (`room.reports` có cả `ck:` và `ip:`) — đủ
    `REPORT_AUTOSKIP` → `blockVideo` (gỡ khỏi mọi hàng chờ, dừng ở mọi phòng đang chiếu, lưu ngay) + `next`. **Phòng
    riêng**: chỉ bỏ qua trong phòng + `adm note` cho admin, **không** `blockVideo` (vài người quen nhau dễ đủ số).
  - Người: `target` = id người trong cùng phòng, không tự báo cáo mình.
- `onVideoDuration` (`vid_dur {v, d, live}`, chỉ video `unk` đang chiếu): người thêm báo là nhận; người khác vào
  `room.durReports` theo IP, đủ `need` như `vid_err` thì lấy trung vị (đa số báo live → live). Cập nhật `dur`, `live`,
  `ends = at + playMs` (`playMs`: live → `LIVE_MAX_MINUTES` (phòng riêng: `PRIVATE_MAX_VIDEO_MINUTES` nếu không `basic`);
  `unk` → `cap`; còn lại `min(dur, cap)`), `sendNow`. Chỉ bỏ `unk` — `basic` và `cap` giữ nguyên (video kiểm cơ bản báo
  dài 2 tiếng vẫn chiếu tối đa `cap`). Log "⏱️ …" chỉ cho phòng chung.
- `onVideoError` (`vid_err {v, code}` với code 2/100/101/150, đúng video đang chiếu, gửi sau lúc bài được chọn —
  `now ≥ at − PRELOAD_MS`): cần đủ **mạng (IP)
  khác nhau** cùng báo — `need = max(1, min(số IP có mặt, max(2, ⌈30 % × số IP⌉)))` → 101/150 thì ghi `embedFail` 24 h;
  là video mặc định thì tạm tắt video mặc định 30 phút (`defaultOffUntil`); xoá cache; `notice` + `next`. **Phòng riêng**
  (có khi một mình — 1 máy là đủ số): chỉ `notice` + `next` trong phòng — không `embedFail`, không tắt video mặc định, không
  xoá cache (một người không được làm hỏng video của mọi phòng), không ghi log.

## 12. Admin — `onAdmin`

Người không phải admin gửi `adm` → bỏ qua im lặng ("như không tồn tại"). Lệnh tác động lên **phòng admin đang xem**
(`c.room` — kể cả phòng riêng admin đang xem / đang ở), lệnh theo người tìm cả phòng khác (`findPlayer`). Trong phòng
riêng, mọi lệnh trừ `state` / `close_room` là thao tác thật (`priv.lastInput = now`) — không thì admin cho chiếu tiếp một
video vừa tự dừng vì "lâu không ai thao tác" sẽ bị dừng lại ngay nhịp sau.

| `op` | Tác dụng |
|---|---|
| `state` | gửi `adm {kind: 'state', room, locked, players[{id, name, joinedAt, ghost, muted, me}], bans[{id, name, until, at}], blocked (50), reports (40, mới trước), ytReady, privRooms[{id, name, venue, count /* thành viên, không tính admin */, cap, now, v, createdAt, lastInput}] (mới thao tác trước)}` |
| `skip` | bỏ bài đang chiếu (+ `notice`). Đang là video mặc định → phòng này tạm không phát lại nó 10 phút (`fillerOffUntil`) |
| `pause` / `resume` | dừng / chạy cả phòng (không áp cho live) |
| `remove {qid}` / `top {qid}` | xoá bài / đưa lên đầu hàng chờ |
| `lock {on}` | khoá / mở hàng chờ (khoá: chỉ admin thêm được) |
| `mute {pid, minutes}` | tắt tiếng theo khoá máy; `minutes = 0` = vô hạn (tới khi server khởi động lại) |
| `unmute {pid}` | bật lại |
| `kick {pid}` | mời ra + chặn vào lại 2 phút (theo khoá máy); socket nhận `kicked` rồi đóng **4001** |
| `ban {pid, hours}` | `BanList.add` (IP băm + khoá máy + tên, `hours = 0` = vĩnh viễn) + mời ra |
| `unban {id}` | xoá lệnh cấm |
| `block {v?}` | gỡ hẳn video (`v` rỗng = video đang chiếu): chặn ở mọi hàng chờ + mọi phòng, lưu ngay |
| `unblock {v}` | bỏ chặn + xoá `embedFail` |
| `clear_chat` | xoá chat phòng → `chat_clear` |
| `close_room {room}` | đóng phòng riêng (`closePrivate`, §20.6): mọi người nhận `proom_res out` "Quản trị viên đã đóng phòng riêng này." rồi về phòng chung |

**Admin trong phòng riêng là TRẠNG THÁI** — không bao giờ xem lén (mở link phòng riêng → đứng xem thẳng, hoặc vào hẳn —
không chiếm chỗ, không bị chặn):
- Đứng xem (không có nhân vật) → `priv.admins` (số kết nối admin đang đứng xem, `Room.adminWatchers()`); vào hẳn →
  nhân vật có `Player.admin` (đặt lúc vào / nối lại theo socket, **giữ** khi mất mạng) → `priv.members[].adm`. Admin
  không tính vào `members()` / `occupancy()` / số chỗ / "phòng trống" (§20.1) — người đã có vé không bao giờ bị "đầy" vì
  admin, phòng chỉ còn admin vẫn tự đóng; chủ phòng không mời admin ra được. Ngoại lệ (`Room.inspects` = admin ở phòng
  riêng của NGƯỜI KHÁC): admin **chính là chủ phòng** (chủ rạp tạo phòng riêng bằng trình duyệt có cookie admin) là
  thành viên bình thường — chiếm chỗ, ngồi chờ bạn bè một mình phòng không tự đóng, **không** gắn `adm` / 🛡 và không bật
  câu "quản trị viên đang xem" trong phòng của chính mình. Client đếm y vậy (`store.memberCount`: bỏ người có `adm`).
- `announceAdmin(room, c)` sau mỗi `hello` / `welcome` vào phòng riêng: `c` là admin → đứng xem thì cả phòng nhận `priv`
  mới; lần đầu kết nối đó vào phòng (`Room.adminSeen` theo `cid`) → cả phòng nhận `notice` "🛡 Quản trị viên rạp đang xem
  phòng này.". `leaveRoom` (sang phòng khác, mất kết nối, phòng đóng) xoá `cid` khỏi `adminSeen` + gửi `priv` (admins
  giảm) → vào lại là báo lại; đứng xem → vào hẳn trên cùng kết nối chỉ báo một lần. `c` là người thường vào (mới / nối lại /
  chuyển vào) lúc đang có admin (`adminPresent()`: đứng xem, hoặc có nhân vật kể cả ẩn / mất mạng) → chính người đó nhận
  câu 🛡 ngay **sau** `welcome` (welcome đặt lại khung chat — báo trước là mất), còn `welcome.snap.priv` đã có
  `admins` / `adm` để giao diện hiện dấu 🛡 suốt lúc admin còn đó.

Không tự mời ra / cấm chính mình (`p.conn === c` bị bỏ qua). Lệnh cấm: khớp **khoá máy** thì tới hết hạn; khớp **IP**
chỉ trong 24 giờ đầu (`BanList.find`) — tránh chặn oan người chung IP.

## 13. Video mặc định (kênh trực tiếp khi phòng trống)

```
Hub.start → refreshDefault() ngay + mỗi 6 giờ
  ├─ fetchOEmbed(DEFAULT_VIDEO)  (không cần key, không tốn quota): 401/403 → chặn nhúng → tắt; 400/404 → không có → tắt;
  │                                lỗi mạng → vẫn phát với tên cũ / "Kênh trực tiếp của rạp"
  └─ có YT_API_KEY → fetchVideo + checkMeta(maxSeconds = ∞, allowLive) — không đạt (riêng tư, 18+, chặn VN…) → tắt
Room.tick: !now && hàng chờ trống → idleSince; quá DEFAULT_IDLE_SECONDS → playDefault()
playDefault: defaultVideoFor(now) (có meta, không bị gỡ, không trong defaultOffUntil) && hết fillerOffUntil →
  now = { qid: 0, v, title, ch, live: true, dur: 0, by: 'Rạp', byId: 0, filler: true, at: now + 2 s, ends: ∞ }
Nhường: hàng chờ có bài → next() ở nhịp kế. Không bỏ phiếu được. Admin skip → phòng đó tạm tắt 10 phút.
Lỗi trình phát (đủ IP) → tắt toàn server 30 phút. Không lưu vào rooms.json (khởi động lại thì tự phát lại).
```

`PublicSettings.defaultIdleSec` = 0 khi tắt (client dùng để viết câu gợi ý trên màn hình trống). **Phòng riêng không bao
giờ** phát video mặc định (hai người đang chờ nhau mà tự dưng phát một kênh lạ có tiếng).

## 14. Lưu trữ (`DATA_DIR`, mặc định `data/`, chỉ khi `PERSIST=true`)

| File | Nội dung | Ghi khi |
|---|---|---|
| `rooms.json` | `{ savedAt, qid, pid, rooms: [{id, queue, now (null nếu là video mặc định), locked}], priv: [...] (§20.8), blocked: [...] }` — người thêm video chỉ lưu `byCkH` (sha256 khoá máy), không lưu khoá thật | mỗi 30 s nếu `dirty`, khi gỡ / bỏ chặn video, khi đóng phòng riêng, khi tắt server; đổi mật khẩu / mời ra trong phòng riêng → `saveSoon` (≤ 1 s, gộp nhiều thay đổi thành một lần ghi) |
| `bans.json` | danh sách `Ban {id, ipHash, ck, name, until, reason, at}` | mỗi lần thêm / xoá / hết hạn |
| `reports.jsonl` | mỗi dòng một báo cáo `{at, room, kind, what, reason, note, by}` | mỗi báo cáo (append, không chặn) |
| `ip-salt.txt` | muối băm IP (48 hex) — giữ để lệnh cấm theo IP còn hiệu lực qua khởi động lại | lần đầu (nếu không đặt `IP_SALT`) |

Ghi nguyên tử (`writeJsonAtomic`: file tạm `.tmp-<pid>` rồi `rename`), quyền 600. Nạp `rooms.json`: bỏ mục sai dạng,
bỏ video đã bị gỡ, bỏ phòng có `n > MAX_ROOMS`; id cũ `"1"` (bản trước khi có rạp) → phòng chính rạp mặc định, id số
khác bị bỏ; mục hàng chờ bản trước có khoá máy thật (`byCk`) → đổi thành `byCkH` ngay lúc nạp (`readItem` — lần lưu sau
file không còn khoá thật); `now` chỉ khôi phục nếu đang dừng hoặc chưa hết giờ (`at` là giờ tuyệt đối nên video chạy tiếp đúng chỗ).
Tắt tiếng, mời ra, báo lỗi trình phát, bộ đệm YouTube **không** lưu. Bản cũ (trước phòng riêng) đọc file mới thì bỏ qua
khoá `priv` — quay về bản cũ (rollback) rồi lưu là mất phòng riêng.

## 15. Hằng số trong `hub.ts`

| Hằng | Giá trị | Ý nghĩa |
|---|---|---|
| `GHOST_MS` | 15 s | giữ nhân vật chờ nối lại |
| `PRELOAD_MS` | 2 s | bài mới: giây 0 = lúc chọn + 2 s (mọi máy kịp tải) |
| `END_GRACE_MS` | 1,5 s | chờ thêm sau khi hết bài |
| `CHAT_KEEP` / `CHAT_SEND` | 50 / 30 | tin giữ trong phòng / gửi trong snapshot |
| `KICK_BLOCK_MS` | 2 phút | bị mời ra thì chưa vào lại được |
| `ROOM_IDLE_CLOSE_MS` | 10 phút | đóng bản sao bỏ trống |
| `DEFAULT_OFF_MS` / `FILLER_SKIP_MS` / `DEFAULT_REFRESH_MS` | 30 phút / 10 phút / 6 giờ | video mặc định |
| `SAVE_EVERY_MS` | 30 s | nhịp lưu `rooms.json` |
| `MAX_CONNS` | 1500 | socket tối đa cả server |
| `BUDGET_CAP` / `BUDGET_RATE` | `SPEED × 1,2` ô / `SPEED × 1,3` ô/s | ngân sách đi bộ |
| `EMBED_FAIL_MS` | 24 giờ | cấm thêm lại video lỗi nhúng |
| `YT_ERR_SKIP` | 2, 100, 101, 150 | mã lỗi trình phát làm chuyển bài |
| `PASS_MIN` / `PASS_MAX` | 4 / 40 | độ dài mật khẩu phòng riêng (sau NFC + bỏ khoảng trắng hai đầu) |
| `SCRYPT_OPTS` / `SCRYPT_MAX_INFLIGHT` | N 16384, r 8, p 1 (khoá 32 byte, muối 16 byte) / 2 | băm mật khẩu; tối đa 2 phép băm cùng lúc cả server |
| `PRIV_TOKEN_TTL_MS` | 30 ngày | hạn vé vào lại (`rt`) |
| `ATTEMPTS_PER_NET` / `ATTEMPTS_PER_ROOM` | 10 / 20 mỗi 10 phút | lần thử mật khẩu (lượt của phòng về 0 khi đổi mật khẩu) |
| `PASS_CHANGES_PER_ROOM` | 5 mỗi 10 phút | lần chủ phòng đổi mật khẩu / phòng (mỗi lần một phép băm scrypt) |
| `SAVE_SOON_MS` | 1 s | `saveSoon`: đổi mật khẩu / mời ra → lưu `rooms.json` trong ≤ 1 s, gộp một lần ghi |
| `PRIV_KICKED_MAX` / `PRIV_NAME_MAX` | 200 / 30 | khoá máy bị mời ra giữ tối đa / tên phòng riêng |

## 16. `config.ts` — mọi biến môi trường

`loadConfig(overrides)` đọc `process.env` (số ngoài khoảng bị kẹp, sai dạng → mặc định), rồi ghi đè bằng `overrides`
(test truyền thẳng, không đọc `.env`). Mẫu đầy đủ có chú thích: `.env.example`.

| Biến | Mặc định | Khoảng | Ý nghĩa |
|---|---|---|---|
| `PORT` | 3300 | 1–65535 | cổng HTTP (production phải 3300 — deploy.sh kiểm) |
| `HOST` | `127.0.0.1` | | chỉ nghe trong máy (nginx đứng trước); `0.0.0.0` để điện thoại trong mạng nhà vào thử |
| `SITE_URL` | rỗng | http(s) | gốc URL cho thẻ chia sẻ + Origin hợp lệ; rỗng = suy từ request |
| `ADMIN_TOKEN` | rỗng | ≥ 12 ký tự | mã admin; rỗng / ngắn = tắt admin |
| `YT_API_KEY` | rỗng | | YouTube Data API v3; rỗng = không ai thêm được video |
| `YT_REGION` | `VN` | 2 chữ | vùng bắt buộc xem được |
| `YT_NOCOOKIE` | `true` | bool | nhúng qua `youtube-nocookie.com` |
| `MAX_VIDEO_MINUTES` | 15 | 1–600 | độ dài tối đa / video |
| `ADMIN_MAX_VIDEO_MINUTES` | 240 | 1–1440 | độ dài tối đa khi admin thêm |
| `ALLOW_LIVE` | `true` | bool | nhận video đang phát trực tiếp |
| `LIVE_MAX_MINUTES` | 30 | 1–1440 | mỗi lượt live chiếu tối đa |
| `MAX_QUEUE_PER_USER` | 2 | 1–50 | video chờ / người |
| `MAX_QUEUE` | 50 | 1–500 | hàng chờ tối đa / phòng |
| `QUEUE_ADD_SECONDS` | 8 | 0,01–3600 | thêm video: dồn 2, rồi 1 lần / bấy nhiêu giây |
| `LOOKUPS_PER_IP_MINUTE` | 6 | ≥ 1 | link mới (chưa cache) / IP / phút |
| `SKIP_VOTE_RATIO` | 0,5 | 0,05–1 | tỉ lệ phiếu bỏ qua |
| `SKIP_VOTE_MIN` | 2 | 1–100 | số phiếu tối thiểu |
| `REPORT_AUTOSKIP` | 3 | 1–100 | số IP khác nhau báo cáo video → tự gỡ |
| `ROOM_CAPACITY` | 60 | 2–200 | người / phòng (tính cả người đang nối lại) |
| `MAX_ROOMS` | 3 | 1–9 | số phòng tối đa **mỗi rạp** (chính + bản sao) |
| `TICK_HZ` | 30 | 5–30 | nhịp gửi frame vị trí |
| `MAX_CONN_PER_IP` | 12 | ≥ 1 | socket / IP |
| `JOINS_PER_MINUTE` | 20 | ≥ 1 | lần vào rạp / IP / phút |
| `BLOCK_WORDS` | rỗng | | từ cấm thêm, phẩy ngăn cách, so nguyên từ còn dấu (đọc ở `server.ts`) |
| `TRUST_PROXY` | `true` | bool | tin `X-Real-IP` / `CF-Connecting-IP` / `X-Forwarded-For` |
| `IP_SALT` | rỗng | | muối băm IP; rỗng = tự sinh `data/ip-salt.txt` |
| `PERSIST` | `true` | bool | ghi dữ liệu ra đĩa |
| `DATA_DIR` | `data` | | thư mục dữ liệu (tương đối với thư mục chạy) |
| `CONTACT_EMAIL` | rỗng | | email khiếu nại hiện trên `/chinh-sach` |
| `DEFAULT_VIDEO` | `rFZHOHl-L8A` | id 11 ký tự | video mặc định khi phòng trống; sai dạng / rỗng = tắt |
| `DEFAULT_IDLE_SECONDS` | 30 | 1–3600 | giây trống trước khi phát video mặc định |
| `PRIVATE_ROOMS_MAX` | 400 | 1–10000 | phòng riêng tối đa cả server (đủ → thu hồi phòng hết thành viên lâu nhất; không có thì chia đều — §20.3) |
| `PRIVATE_PER_NET` | 3 | 1–1000 | phòng riêng đang mở tối đa / mạng (IPv4 /32, IPv6 /64) |
| `PRIVATE_PER_SUBNET` | 6 | 1–10000 | phòng riêng đang mở tối đa / dải mạng (IPv4 /24, IPv6 /48) |
| `PRIVATE_CREATE_PER_HOUR` | 4 | 1–10000 | lần tạo phòng riêng / giờ / mạng |
| `PRIVATE_CAP_MAX` | 20 | 2–200 | số người tối đa chủ phòng chọn được |
| `PRIVATE_MAX_VIDEO_MINUTES` | 720 | 1–1440 | độ dài tối đa / video trong phòng riêng (cũng là thời gian chiếu một lượt live) |
| `PRIVATE_PER_USER` | 10 | 1–50 | video chờ / người trong phòng riêng |
| `PRIVATE_EMPTY_SECONDS` | 600 | 10–86400 | phòng riêng không còn ai bấy nhiêu giây thì đóng |
| `PRIVATE_IDLE_PAUSE_MINUTES` | 240 | 1–10080 | không ai thao tác → tạm dừng video |
| `PRIVATE_IDLE_CLOSE_MINUTES` | 480 | 1–10080 | không ai thao tác → đóng phòng |

Bool nhận `1 / true / yes / on / bật`. Script dùng thêm: `CHROME_PATH` (`scripts/cdp.ts`), `PORT` / `CAPACITY`
(`scripts/qa-server.ts`).

## 17. `moderation.ts`

| Export | Việc |
|---|---|
| `cleanText(s, max)` | NFC, xuống dòng → khoảng trắng, bỏ ký tự điều khiển / vô hình (zero-width, bidi…), gộp khoảng trắng, chữ lặp > 6 lần rút về 6, cắt theo **code point** |
| `fold(s)` | bỏ dấu tiếng Việt, `đ → d`, chữ thường (để so khớp) |
| `maskProfanity`, `hasProfanity` | hai danh sách: `BAD_EXACT` so nguyên từ **còn dấu** (vì "lồn/lon", "cặc/các", "buồi/buổi" bỏ dấu sẽ trùng từ thường) và `BAD_FOLDED` so sau khi bỏ dấu + đổi leetspeak (`0→o`, `@→a`…) cho viết tắt (vcl, dm…); bắt cả từ kéo dài ("đmmmm"); cụm từ ("mẹ mày") che từng từ. `setExtraBadWords` thêm từ từ `BLOCK_WORDS` |
| `hasLink`, `isYouTubeLink` | bắt `http(s)://`, `www.`, `tên.miền` (cả "chấm", "(.)", "[.]"), bit.ly, t.me, zalo.me… |
| `checkName(raw, min, max)` | 2–20 code point; chỉ chữ / dấu / số / khoảng trắng / `. _ ' -`; phải có chữ hoặc số; không link, không bậy; chặn tên dành riêng (`mod, bot, rap, system, server, youtube, google, moderator, sysadmin` và mọi tên bắt đầu / kết thúc bằng `admin, quantri, qtv, hethong, vibecinema, vibecorp, chuduan, rapphim`) sau khi bỏ dấu + đổi chữ Kirin / Hy Lạp trông giống Latin (`unconfuse`) |
| `nameKey(name)` | khoá so trùng tên trong phòng (bỏ dấu, hoa thường, khoảng trắng); tên không có chữ Latin (李明) dùng chính chữ đó |
| `checkChat(raw, max)` | rỗng → bỏ im lặng; có link → từ chối (link YouTube → nhắc dùng Hàng chờ); còn lại che từ bậy |
| `Bucket(capacity, perSec)` | thùng token: `take()`, `waitMs()` |
| `WindowCounter(windowMs, max)` | đếm theo khoá trong cửa sổ trượt (tự dọn khi > 5000 khoá) |
| `hashIp`, `loadOrCreateSalt` | băm IP có muối; muối ổn định trong `data/ip-salt.txt` |
| `writeJsonAtomic`, `readJson` | ghi nguyên tử quyền 600 / đọc an toàn |
| `BanList` | `find(ipHash, ck)`, `add`, `remove(id)`, `list()`; tự dọn lệnh hết hạn; lưu `bans.json` |

## 18. `youtube.ts`

| Export | Việc |
|---|---|
| `parseVideoId(input)` | id 11 ký tự hoặc link `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `/v/`, `/e/`, host `www. / m. / music.`, `youtube-nocookie.com`; host khác → `null` |
| `parseIsoDuration` | `PT1H2M3S`, `P1DT2H`, có tuần → giây |
| `metaFromItem(item)` | phòng thủ: trường thiếu = giá trị an toàn nhất (bị từ chối): `embeddable` phải `=== true`, `privacy` mặc định `unknown`… |
| `checkMeta(meta, rules)` | luật nhận video, lý do tiếng Việt — bảng đầy đủ ở [04](04-youtube-va-phap-ly.md) §3 |
| `createYouTubeClient(key, fetch?)` | `fetchVideo(id)` gọi `videos.list?part=status,contentDetails,snippet` (timeout 6 s; phân loại `quota`, `bad_key`, `api`, `network`, `no_key`; **không bao giờ để key lọt ra log**), `fetchOEmbed(id)` (tên + kênh, 401/403 = chặn nhúng), `configured` |
| `VideoCache(ttl = 6 h, max = 2000)` | bộ đệm kết quả, LRU đơn giản |
| `fmtDuration(sec)` | "3 phút 20 giây" |

Test / QA thay client thật bằng `scripts/fake-youtube.ts` (cùng interface `YouTubeClient`).

## 19. `protocol.ts` & `types.ts`

- `types.ts`: `ServerMsg`, `ClientMsg`, `AdminOp` và các kiểu dữ liệu (`PlayerInfo`, `FrameEntry`, `QueueItemInfo`,
  `NowInfo`, `ChatInfo`, `RoomInfo`, `RoomSnapshot`, `PublicSettings`). Là **nguồn sự thật** của [02](02-giao-thuc.md).
- `protocol.ts`: `MAX_MSG_BYTES = 4096`, `rawToString`, `parseClientMsg(text)` — kiểm kiểu + độ dài + khoảng số từng
  trường, trả `ClientMsg` sạch hoặc `null`. Server không tin gì từ client: mọi kiểm tra nghiệp vụ nằm tiếp ở `hub.ts`.
  `room` của `spec` / `switch` / `join` qua `ANY_ROOM_ID_RE`; `rt` (vé phòng riêng) sai dạng thì bỏ trường (không bỏ tin);
  `proom_new` / `proom_auth` / `proom_op` / `adm close_room`: [02](02-giao-thuc.md) §5–§6.

## 20. Phòng riêng (có mật khẩu)

Phòng xem chung riêng tư (người yêu / bạn bè ở xa): **miễn phí mãi mãi**, mật khẩu chỉ khoá **phòng** (không bao giờ khoá
một video), cùng trình phát chính thức + cùng luật video lúc thêm (công khai, cho nhúng, không 18+, xem được ở VN). Chỉ
nới luật **công bằng** của rạp chung (độ dài, số video / người, không video mặc định). Gỡ video toàn rạp vẫn tới được
phòng riêng: phòng riêng nằm trong `Hub.rooms`, nên `blockVideo`, lọc `blocked` lúc thêm / nạp, `embedFail` lúc thêm,
báo cáo → admin áp dụng như thường.

### 20.1 Mô hình

- `new Room(hub, id, priv)`: `priv: PrivState` = `{ name, venue, cap, passHash, salt, passVer, ownerCkH, ownerNet,
  ownerSubnet, createdAt, tokens: {h: sha256(rt), ckh: sha256(ck), at}[], kickedCkH: string[], lastInput, closed, pending }`;
  `venue = priv.venue`, `n = 1`, `name` = `priv.name` ("Phòng của <tên>", ≤ 30 ký tự). **Khoá máy chỉ có ở dạng băm**
  (`ownerCkH`, `ckh`, `kickedCkH`; so với `Player.ckh`) — bản sao `rooms.json` lọt ra ngoài không cho ai giả làm chủ phòng /
  thành viên.
- `capacity()` = `priv ? priv.cap : ROOM_CAPACITY`; `members()` = nhân vật **không phải admin** (kể cả đang ẩn / mất mạng —
  vẫn giữ chỗ); `occupancy()` = `priv ? members() + pending : count()`. Số người hiện cho thành viên, `cap` tối thiểu khi
  chủ phòng hạ số người, `privRooms.count`, "phòng trống" (§20.7) đều theo `members()`.
- Vé `rt` (`randomBytes(18)` base64url, 24 ký tự): **mỗi máy (ck) một vé** (cấp lại thì thay), sống 30 ngày, phòng giữ tối
  đa `cap × 5` vé — quá thì bỏ vé cũ nhất của người **không** còn trong phòng trước (thành viên, kể cả đang mất mạng,
  không mất vé vì người lạ nhập đúng mật khẩu lúc phòng đầy); server chỉ giữ băm (vé thật ở `localStorage vc.rt` của máy
  đó). `kickedCkH` ≤ 200.
- `pending`: chỗ giữ cho người đang có nhân vật ở phòng khác mà đang chờ băm mật khẩu (`proom_auth`) — đúng thì được
  chuyển vào ngay, không bị người khác chen mất chỗ cuối.
- Sự kiện phòng riêng **không** gọi `roomsChanged()` (danh sách công khai không đổi); thay vào đó phát `{t: 'priv', priv}`
  cho cả phòng khi có người vào / ra / ẩn / hiện / mất mạng / nối lại, đổi số người tối đa, admin tới đứng xem / rời đi.

### 20.2 Cổng vào — `privEntry(c, room, ck, rt?)`

`'gone'` (phòng không còn / đã đóng) → admin `'ok'` (không chiếm chỗ, không bị chặn — §12) → `sha256(ck)` trong `kickedCkH`
→ `'kicked'` → có quyền = `sha256(ck) === ownerCkH` hoặc vé `rt` khớp băm + **đúng máy** (`ckh`) + còn hạn; không →
`'need'` → `occupancy() ≥ cap` (không tính admin) mà không phải chủ phòng → `'full'` → `'ok'`. Đồng bộ, không băm scrypt, không tính lượt thử. Gọi ở: `connect` (`?room=p-…`),
`onSpec`, `onJoin` (người mới — trước `pickRoom`; và nhánh nối lại khi `join.room` là phòng riêng khác phòng đang đứng),
`moveTo` (switch, sau `proom_auth`).

### 20.3 Thông điệp

- `proom_new {pass, cap, venue, name, ck}`: mật khẩu `String(pass).normalize('NFC').trim()` 4–40 ký tự (không
  `cleanText`); `cap` 2…`PRIVATE_CAP_MAX`; `venue` ∈ `VENUES`; tên = tên nhân vật đang có, chưa có thì `checkName(name)`.
  Luật (`privCreateCheck`, kiểm **đồng bộ trước khi băm**, kiểm lại **sau khi băm**): máy (`ck`) đang có phòng còn thành
  viên → `owned` (+ `room`; phòng của máy đó đã hết thành viên thì đóng nó và tạo phòng mới); mạng đã có `PRIVATE_PER_NET`
  phòng, hoặc **dải mạng** (§2.5) đã có `PRIVATE_PER_SUBNET` phòng → `limit` ("Mạng bạn đang dùng đã có nhiều phòng
  riêng…"); cả server đủ `PRIVATE_ROOMS_MAX` → thu hồi phòng hết thành viên lâu nhất (`emptySince` nhỏ nhất); không có
  phòng nào trống thì **chia đều**: người từ dải mạng chưa có phòng nào được lấy phòng lâu không ai thao tác nhất
  (`lastInput` nhỏ nhất) của dải mạng đang giữ nhiều phòng nhất (≥ 2) — người trong phòng đó nhận `out` "Rạp đang đủ số
  phòng riêng — phòng này đã đóng để nhường chỗ cho người khác." (một người muốn giữ cả rạp phải có ngần ấy dải mạng); vẫn
  không được → `limit` ("Rạp đang có nhiều phòng riêng quá…"); bận (§20.4) → `busy`; lượt tạo / giờ / mạng
  (`WindowCounter.hit` trước khi băm, không hoàn) → `rate`. Sau khi băm: socket còn mở, nhân vật
  vẫn như lúc bấm, luật vẫn đạt → id `p-` + 10 × `crypto.randomInt(36)` (trùng thì sinh lại), vé cho `ck`, `proom_ok
  {created: true}`, log "🔒 Phòng riêng mới <id> (tối đa N người) — <tên phòng>" (không bao giờ log mật khẩu / vé); đang có
  nhân vật → `moveTo` vào phòng ngay (không được thì bỏ phòng vừa tạo + báo lỗi). Bọc try/catch — luôn trả lời.
- `proom_auth {room, pass, ck}`: phòng không có / đã đóng → `proom_need {exists: false}`; máy bị mời ra → `kicked`; độ dài
  sai → `bad_pass` (khỏi băm, không tính lượt); bận → `busy`; **tính lượt trước khi băm, đúng cũng không hoàn**: 10 / 10
  phút / mạng (mọi phòng) rồi 20 / 10 phút / phòng (chạm giới hạn phòng → báo chủ phòng "Có người nhập sai mật khẩu phòng
  nhiều lần.", tối đa một lần / 10 phút) → `rate`. Băm (`timingSafeEqual`), rồi kiểm lại: cùng object phòng, chưa đóng,
  `passVer` chưa đổi, socket còn mở, chưa bị mời ra. Đúng → vé mới cho `ck` → `proom_ok`; đang có nhân vật (cùng `ck`) →
  `moveTo` (đầy → `proom_res full`).
- `join` / `switch` kèm `rt`: kiểm trong `privEntry` (switch dùng `ck` của nhân vật).
- `proom_op` (người gửi có nhân vật, phòng hiện tại là phòng riêng — chỉ `roomOf(p)`, không bao giờ `findPlayer`):
  `opBucket` (dồn 3, hồi 1 / 2 s), cập nhật `lastInput`.
  - `pause` / `resume`: mọi thành viên, không áp cho live / video mặc định → `notice` "⏸ {tên} đã dừng video cho cả phòng" /
    "▶ {tên} đã phát tiếp".
  - Còn lại chỉ chủ phòng (`p.ckh === ownerCkH`) hoặc admin (người khác → `denied`): `skip` ("⏭ Chủ phòng đã bỏ qua video."),
    `remove {qid}`, `kick {pid}` (người trong **phòng này**, không phải mình / chủ phòng / admin (`Player.admin`) → băm khoá
    máy vào `kickedCkH` + huỷ vé của máy đó + `evictPrivate`, `saveSoon`; trả chủ phòng "Đã mời {tên} ra. Họ vẫn biết mật
    khẩu — đổi mật khẩu nếu không muốn họ vào lại."), `pass {pass}` (kiểm như lúc tạo, bận → `busy`, **5 lần / 10 phút /
    phòng** tính trước khi băm → `rate` "Đổi mật khẩu nhiều quá — đợi vài phút rồi thử lại nhé.", băm, kiểm lại phòng +
    `passVer` → đổi băm / muối, `passVer++`; vé của người **không còn trong phòng** hết hiệu lực, thành viên (kể cả đang ẩn
    / mất mạng — quay lại bằng vé cũ được) giữ vé, ai đang có mặt nhận vé mới qua `proom_rt`; lượt thử mật khẩu của phòng
    (`privRoomAttempts`) về 0 — kẻ dò mật khẩu cũ không khoá lây người có mật khẩu mới; `saveSoon`), `cap {cap}` (2…max và
    ≥ số thành viên đang có — không tính admin → phát `priv`), `close` (`closePrivate`).

### 20.4 Băm mật khẩu (scrypt bất đồng bộ)

`crypto.scrypt(pass, salt 16 byte, 32, {N: 16384, r: 8, p: 1})` (~16 MiB, vài chục ms, chạy trên thread pool của libuv —
chung với DNS / đọc file của mọi thứ khác trên VPS). Vì vậy: **mỗi kết nối tối đa 1 phép băm** (`c.privBusy`), **cả server
tối đa 2** (`scryptInFlight`) — quá thì `busy` (không tính lượt). Gửi 30 `proom_auth` cùng lúc từ một socket → 1 phép băm,
29 `busy`; mọi lần **thật sự được băm** đều đã bị tính lượt trước đó, nên không ai dò được quá 10 lần / 10 phút / mạng.
Phép băm của chủ phòng cũng có hạn mức riêng (tạo phòng 4 lần / giờ / mạng, đổi mật khẩu 5 lần / 10 phút / phòng) — nhiều
chủ phòng bấm liên tục không giữ chật được máy băm của người đang nhập mật khẩu; sau khi đổi mật khẩu / mời ra, `rooms.json`
ghi trong ≤ 1 s, gộp (`saveSoon`) — không ghi cả file mỗi lần bấm.

### 20.5 `evictPrivate(room, p, text)` — đưa một người ra (luôn xong)

Kết nối (nếu còn) nhận `proom_res {ok: false, code: 'out', text, room}` **trước**. Đang có mặt → `transfer` sang phòng
chung: `pickRoom(<rạp của phòng riêng>)`, đầy / trùng tên thì phòng chung khác còn chỗ không trùng tên → `welcome`. Không
được, hoặc đang ẩn / mất mạng → `removePlayer`; kết nối (nếu còn) bỏ nhân vật, về đứng xem phòng chính chung → `hello`.
Không bao giờ để nhân vật dính vào phòng đã xoá.

### 20.6 `closePrivate(room, text, why)`

`priv.closed = true` (phép băm đang dở tự huỷ khi kiểm lại) → `evictPrivate` từng người → người còn đứng xem (admin) về phòng
chính chung + `notice` → xoá khỏi `Hub.rooms` → `dirty` + `save()` ngay (băm mật khẩu, vé, khoá máy bị mời ra mất theo
phòng) → log + `adm note` (id + tên phòng). Gọi khi: chủ phòng `close`, admin `close_room`, hết thành viên quá hạn, lâu
không ai thao tác, máy chủ phòng tạo phòng mới (phòng cũ đã hết thành viên), thu hồi khi đủ `PRIVATE_ROOMS_MAX` (phòng hết
thành viên lâu nhất, hoặc chia đều — §20.3).

### 20.7 Vòng đời (`Hub.tick` → `privLifecycle`) & cách ly

- Hết thành viên (`members() === 0` — admin ở lại một mình không giữ phòng, trừ khi chính là chủ phòng; đóng thì admin
  cũng về rạp chung) quá
  `PRIVATE_EMPTY_SECONDS` → đóng (đủ lâu để chủ phòng trên điện thoại sang Zalo gửi link rồi quay lại — socket ẩn bị cắt
  sau 10–20 s). `emptySince` = bây giờ ở mỗi nhịp còn thành viên, nên hết thành viên bằng đường nào cũng đếm đúng từ đó.
- `now − lastInput ≥ PRIVATE_IDLE_PAUSE_MINUTES` và đang chiếu video thường → tạm dừng + `notice` "⏸ Đã tạm dừng vì lâu
  không ai thao tác — bấm ▶ để xem tiếp." (live: để chạy tới hết lượt). `≥ PRIVATE_IDLE_CLOSE_MINUTES` → đóng ("Phòng riêng
  đã đóng vì lâu không ai thao tác.") — một socket treo không giữ phòng mãi được.
- `lastInput` = thao tác thật của thành viên: `move` (đang đi), `chat`, `act`, `emo`, `q_add`, `vote`, `proom_op`, `back`,
  vào / nối lại / chuyển vào; và lệnh `adm` trong phòng (trừ `state` / `close_room`). (`vid_err` / `vid_dur` / `ping` là
  máy tự gửi — không tính.)
- Cách ly với cả rạp: không video mặc định; `vid_err` chỉ chuyển bài trong phòng (không `embedFail` / `defaultOffUntil` /
  xoá cache); đủ báo cáo chỉ bỏ qua trong phòng + báo admin (không `blockVideo`); không `roomsChanged`; `stats()` đếm `priv`
  riêng.
- Hàng chờ: `room.maxSeconds(admin)` = `max(PRIVATE_MAX_VIDEO_MINUTES, admin ? ADMIN_MAX_VIDEO_MINUTES : 0) × 60` (độ dài
  tối đa video Data API kiểm đủ + thời gian chiếu một lượt live của video đó); video chỉ qua kiểm cơ bản (`basic`, oEmbed
  không biết video có công khai không) giữ giới hạn rạp chung: `cap` = `(admin ? ADMIN_MAX : MAX)_VIDEO_MINUTES × 60`, live
  `LIVE_MAX_MINUTES`; `room.perUser()` = `PRIVATE_PER_USER` (admin không giới hạn).

### 20.8 Lưu trữ (`rooms.json` khoá `priv`)

`priv: [{id, venue, name, cap, passHash, salt, passVer, ownerCkH, ownerNet, ownerSubnet, createdAt, tokens: [{h, ckh, at}],
kickedCkH, lastInput, queue (byCkH), now (video mặc định → null), locked}]` — **chỉ có băm**: mật khẩu (scrypt), vé +
khoá máy chủ phòng / người có vé / người bị mời ra / người thêm video (sha256), mạng (băm có muối) — không bao giờ có mật
khẩu, vé hay khoá máy thật (lộ file cũng không vào được phòng). `load()` kiểm từng trường (`PRIVATE_ROOM_RE`, `venueById`,
`cap` ≥ 2 (kẹp ≤ `PRIVATE_CAP_MAX`), `passHash` 64 hex, `salt` 32 hex, `ownerCkH` 64 hex, vé `h` + `ckh` 64 hex + còn hạn +
mỗi máy một vé + ≤ `cap × 5`, `kickedCkH` 64 hex ≤ 200, hàng chờ qua `readItem` + lọc `blocked`), sai là bỏ cả phòng (bản
thử trước khi băm khoá máy — `ownerCk` thật — bị bỏ); dừng ở `PRIVATE_ROOMS_MAX`; đặt `emptySince = lastInput = lúc khởi
động` (mọi người kịp vào lại bằng vé / khoá máy).

### 20.9 Nhật ký (log) của phòng riêng

Nhật ký server **chỉ** có mã + tên phòng (tên có tên người tạo) lúc tạo / đổi mật khẩu / đóng — không bao giờ có mật khẩu,
vé, khoá máy hay video đang xem: độ dài video (`vid_dur`), lỗi trình phát (`vid_err`) trong phòng riêng không ghi log;
báo cáo trong phòng riêng ghi một dòng chỉ có loại + lý do (đầy đủ ở `reports.jsonl` + bảng admin như mọi báo cáo).
Admin gỡ video khỏi cả rạp (`adm block`) khi đang ở trong phòng riêng: dòng log không có mã video (mã vẫn nằm trong danh
sách video bị gỡ — bảng quản trị / `rooms.json` — để bỏ chặn); gỡ từ phòng chung thì log mã video như thường.
