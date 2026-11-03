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
| `GET /api/health` | `{ ok, rooms, viewers, players, playing, yt }` (`hub.stats()` + `youtube.configured`) |
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
- Cookie admin `vc_admin` = `sha256("<ADMIN_TOKEN>:vibecinema-admin-v1")` (64 hex, không chứa mã thật), `Path=/;
  HttpOnly; SameSite=Strict` (+ `Secure` khi request là https), `Max-Age` 1 năm. Đổi `ADMIN_TOKEN` = mọi cookie cũ hết
  hiệu lực.
- `POST /api/admin/login`: admin tắt → 404; `Content-Type` phải là JSON (415); 10 lần / 10 phút / IP băm (429); body ≤ 2 KB;
  so mã bằng `safeEqual` (băm rồi `timingSafeEqual`); sai → 403 + log "sai mã" (không ghi mã).
- `isAdminReq(req)` đọc cookie khi **mở WebSocket** → quyền admin gắn vào `Conn` suốt phiên.

### 2.6 WebSocket

- Upgrade chỉ ở `/ws` và `originOk`: không có `Origin` (bot, test) → nhận; có → phải trùng `SITE_URL` hoặc trùng `Host`
  (chặn trang khác mượn cookie admin). Sai → `403` rồi đóng.
- `WebSocketServer({ noServer, maxPayload: 8192, perMessageDeflate: false })`. `?room=<id>` (khớp `ROOM_ID_RE`) → phòng
  đứng xem ban đầu.
- Mỗi tin: `rawToString` (bỏ binary, rỗng, > 4096 byte) → `parseClientMsg` (sai dạng → bỏ im lặng) → `hub.message(conn,
  msg)` (bọc try/catch).
- Nhịp tim **10 s**: `ping`; lượt sau chưa thấy `pong` → `terminate()` (socket chết im lặng bị phát hiện trong 10–20 s).
  `close` → `hub.disconnect(conn)`.

## 3. `hub.ts` — mô hình dữ liệu

```
Hub
 ├─ rooms: Map<roomId, Room>        mỗi rạp luôn có phòng chính "<rạp>"; đầy thì thêm bản sao "<rạp>-N"
 ├─ conns: Set<Conn>                mọi socket (người đứng xem + người đã vào)
 ├─ bans: BanList                   data/bans.json
 ├─ mutes, kicks: Map<"ck:<khoá máy>", hết hạn ms>      chỉ trong bộ nhớ (mất khi khởi động lại)
 ├─ blocked: Map<videoId, {v,title,at,reason}>          lưu trong rooms.json
 ├─ embedFail: Map<videoId, hết hạn>                    video lỗi 101/150: cấm thêm lại 24 h
 ├─ cache: VideoCache (6 h, 2000 video) · inflight: Map<videoId, Promise>  (gộp yêu cầu trùng)
 ├─ apiWindow (120 lần hỏi YouTube / phút cả server) · apiIpWindow (LOOKUPS_PER_IP_MINUTE) · joinWindow (JOINS_PER_MINUTE)
 ├─ reportSeen: Map<"ck|kind|target", hết hạn> · recentReports (100 báo cáo gần nhất, cho admin)
 └─ defaultMeta, defaultOffUntil    video mặc định (§13)

Room
 ├─ id, venue, n (1 = phòng chính), name (roomName)
 ├─ players: Map<pid, Player>       gồm cả người "mất mạng" (ghost) đang chờ nối lại
 ├─ spectators: Set<Conn>           mọi socket đang xem phòng này (người đã vào cũng nằm ở đây)
 ├─ queue: QueueItem[] · now: NowPlaying | null · locked
 ├─ votes: Set<pid> · reports, errReports: Set<"ck:…" | "ip:…">   (xoá khi đổi bài)
 ├─ chat: ChatInfo[] (giữ 50, gửi 30 trong snapshot)
 └─ emptySince, idleSince, fillerOffUntil

Conn   { cid, sock, ipHash, admin, room, player, bucket: Bucket(80, 45/s), strikes, closed }
Player { id, name, key (nameKey), look, x, y, d, m, ct (giờ máy người đi), lastMoveAt, budget, dirty, action,
         conn | null, ghostSince, token, ck (khoá máy), ipHash, joinedAt, lastCorrAt,
         chat/emo/act/look/add/move/reportBucket, lastChat, chatStrikes }
QueueItem  { qid, v, title, ch, dur (giây, 0 = live), live, by, byId, byCk, addedAt }
NowPlaying = QueueItem + { at, paused, pos, ends, filler? }
```

`Room.broadcast(msg, except?)` gửi cho người đã vào (có `conn`) + người đứng xem **chưa** có nhân vật (không gửi trùng).
`Hub.sendRaw` bỏ qua socket đã đóng hoặc đang nghẽn (`bufferedAmount > 1 MB`) — máy quá chậm thì mất tin chứ không làm
nghẽn server.

## 4. Phòng & rạp

- `VENUES` (4 rạp: `nhung`, `congvien`, `doxe`, `bien` — [03](03-frontend.md) §7) lấy từ `shared/hall.js`. Constructor
  `Hub` nạp `rooms.json` rồi đảm bảo mỗi rạp có phòng chính (id = id rạp, `n = 1`, **không bao giờ đóng**).
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
connect(sock, {ipHash, admin, room?})
  ├─ IP đã có ≥ MAX_CONN_PER_IP socket, hoặc cả server ≥ 1500 → null (app đóng 1013)
  ├─ phòng = ?room (bản sao đã đóng → phòng chính của rạp) || pickRoom() || phòng chính rạp mặc định
  └─ room.spectators.add(c) → hello { v: PROTOCOL, s, rooms, room, snap, admin, cfg }
spec {room}     (chỉ khi chưa có nhân vật) → chuyển sang xem phòng khác → hello mới
join {...}      → onJoin (dưới)
disconnect(c)   → bỏ khỏi spectators; nhân vật thành "ma" (conn = null, ghostSince) → pu (ghost: true), bỏ phiếu của
                  người đó, tính lại số phiếu cần; Room.tick xoá hẳn sau GHOST_MS (15 s) → pl
```

`onJoin` theo thứ tự:

1. **Nối lại**: `token` + `ck` khớp một Player ở bất kỳ phòng nào → gắn socket mới (socket cũ còn treo — đổi wifi ↔ 4G,
   tab nhân bản — nhận `notice` rồi bị đóng mã **4002**). Đặt lại `ct = 0`, `budget = 0` (trang vừa F5 có
   `performance.now()` về gần 0). Gửi `welcome` cho mình, `pu` cho người khác.
2. Lệnh cấm (`BanList.find(ipHash, ck)`) → `join_err banned`; vừa bị mời ra (`kicks["ck:…"]`) → `kicked`;
   `joinWindow` (JOINS_PER_MINUTE / IP) → `rate`; `checkName` → `name`.
3. `pickRoom(msg.room || phòng đang xem)` → `full` nếu null; trùng `nameKey` trong phòng → `name_taken`.
4. Tạo Player: id tăng dần (`pid` lưu trong `rooms.json` nên không trùng sau khởi động lại), `normalizeLook`,
   `spawnPoint()` (lối đi cuối rạp), hướng lên, `token` 32 hex ngẫu nhiên, `ck` = khoá máy client gửi (thiếu thì tự sinh).
5. `room.addPlayer` (phát `pj`), `adoptItems` (video người này thêm trước đó — cùng `byCk` — nhận lại quyền theo id mới),
   gửi `welcome { you, token, room, snap }`.

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
  cập nhật ngoại hình, nếu `join.room` là rạp khác → `moveTo` sang luôn; **khác tên** (cố ý đổi tên) → `dropPlayer` bỏ
  nhân vật cũ rồi vào mới. Nhờ vậy cùng máy không bao giờ bị "tên đã có người dùng" vì nhân vật của chính mình.
- `onSwitch` → `moveTo(c, p, from, roomId, now, limit)`: `pickRoom(roomId)` (đầy → bản sao cùng rạp), khác rạp mong muốn
  / trùng tên → `notice` warn; được thì `removePlayer` ở phòng cũ, chỗ xuất hiện mới (`spawnPoint`), `addPlayer`, gửi
  `welcome` với ảnh chụp phòng mới.
- `onLeave`: bỏ nhân vật ngay (client gửi khi đóng tab).
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
  paused: false, pos: 0, ends: at + thời lượng + END_GRACE_MS (1,5 s) }` — live: thời lượng = `LIVE_MAX_MINUTES`. Hết
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
 ├─ người thường: ≥ MAX_QUEUE_PER_USER bài (đếm theo byId hoặc byCk) → lỗi
 ├─ hàng chờ ≥ MAX_QUEUE                 → lỗi
 ├─ người thường: addBucket (dồn 2, 1 / QUEUE_ADD_SECONDS) → "thử lại sau N giây"
 ├─ link chưa có trong cache: người thường ≤ LOOKUPS_PER_IP_MINUTE / IP / phút; cả server ≤ 120 / phút
 ├─ có key: lookup(id): cache 6 h → inflight (gộp) → youtube.fetchVideo
 │    ├─ được → checkMeta(meta, {region, maxSeconds: (admin ? ADMIN_MAX : MAX)_VIDEO_MINUTES × 60, allowLive}) → lỗi thì q_res
 │    └─ không được (no_key / quota / bad_key / api / network) → kiểm cơ bản ↓
 ├─ không key / API hỏng: lookupOEmbed(id) (nhớ 30 phút) → 401/403, 404, mạng → q_res lỗi; được → item unk + cap (docs/04 §3.1)
 ├─ kiểm lại sau khi chờ mạng (người đã rời? video vừa được thêm? hết chỗ?)
 └─ push QueueItem (title / channel qua cleanText) → q_res ok → chưa có bài: next() ngay; có: phát queue
    + notice "X vừa thêm …" cho người khác
```

`q_del {qid}`: chỉ người thêm (theo `byId` hoặc `byCk`) hoặc admin. Admin dùng `adm remove` (chạy được cả khi chưa vào rạp).

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
  nối thêm một dòng `data/reports.jsonl` (không chặn), log, `adm {kind: 'note'}` tới mọi admin đang mở.
  - Video: phải đúng video đang chiếu; đếm theo **IP khác nhau** (`room.reports` có cả `ck:` và `ip:`) — đủ
    `REPORT_AUTOSKIP` → `blockVideo` (gỡ khỏi mọi hàng chờ, dừng ở mọi phòng đang chiếu, lưu ngay) + `next`.
  - Người: `target` = id người trong cùng phòng, không tự báo cáo mình.
- `onVideoDuration` (`vid_dur {v, d, live}`, chỉ video `unk` đang chiếu): người thêm báo là nhận; người khác vào
  `room.durReports` theo IP, đủ `need` như `vid_err` thì lấy trung vị (đa số báo live → live). Cập nhật `dur`, `live`,
  `ends = at + playMs` (`playMs`: live → `LIVE_MAX_MINUTES`; `unk` → `cap`; còn lại `min(dur, cap)`), `sendNow`.
- `onVideoError` (`vid_err {v, code}` với code 2/100/101/150, đúng video đang chiếu, gửi sau lúc bài được chọn —
  `now ≥ at − PRELOAD_MS`): cần đủ **mạng (IP)
  khác nhau** cùng báo — `need = max(1, min(số IP có mặt, max(2, ⌈30 % × số IP⌉)))` → 101/150 thì ghi `embedFail` 24 h;
  là video mặc định thì tạm tắt video mặc định 30 phút (`defaultOffUntil`); xoá cache; `notice` + `next`.

## 12. Admin — `onAdmin`

Người không phải admin gửi `adm` → bỏ qua im lặng ("như không tồn tại"). Lệnh tác động lên **phòng admin đang xem**
(`c.room`), lệnh theo người tìm cả phòng khác (`findPlayer`).

| `op` | Tác dụng |
|---|---|
| `state` | gửi `adm {kind: 'state', room, locked, players[{id, name, joinedAt, ghost, muted, me}], bans[{id, name, until, at}], blocked (50), reports (40, mới trước), ytReady}` |
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

`PublicSettings.defaultIdleSec` = 0 khi tắt (client dùng để viết câu gợi ý trên màn hình trống).

## 14. Lưu trữ (`DATA_DIR`, mặc định `data/`, chỉ khi `PERSIST=true`)

| File | Nội dung | Ghi khi |
|---|---|---|
| `rooms.json` | `{ savedAt, qid, pid, rooms: [{id, queue, now (null nếu là video mặc định), locked}], blocked: [...] }` | mỗi 30 s nếu `dirty`, khi gỡ / bỏ chặn video, khi tắt server |
| `bans.json` | danh sách `Ban {id, ipHash, ck, name, until, reason, at}` | mỗi lần thêm / xoá / hết hạn |
| `reports.jsonl` | mỗi dòng một báo cáo `{at, room, kind, what, reason, note, by}` | mỗi báo cáo (append, không chặn) |
| `ip-salt.txt` | muối băm IP (48 hex) — giữ để lệnh cấm theo IP còn hiệu lực qua khởi động lại | lần đầu (nếu không đặt `IP_SALT`) |

Ghi nguyên tử (`writeJsonAtomic`: file tạm `.tmp-<pid>` rồi `rename`), quyền 600. Nạp `rooms.json`: bỏ mục sai dạng,
bỏ video đã bị gỡ, bỏ phòng có `n > MAX_ROOMS`; id cũ `"1"` (bản trước khi có rạp) → phòng chính rạp mặc định, id số
khác bị bỏ; `now` chỉ khôi phục nếu đang dừng hoặc chưa hết giờ (`at` là giờ tuyệt đối nên video chạy tiếp đúng chỗ).
Tắt tiếng, mời ra, báo lỗi trình phát, bộ đệm YouTube **không** lưu.

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
