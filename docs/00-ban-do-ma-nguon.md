# 00 · Bản đồ mã nguồn

Dành cho người mới và AI agent: **mỗi file làm gì, xuất (export) gì, ai gọi**, luồng dữ liệu chính, và bảng "muốn sửa X
thì vào đâu". Chi tiết từng phần: server [07](07-server.md), client [03](03-frontend.md), giao thức [02](02-giao-thuc.md).

## 1. Cây thư mục

```
vibe-cinema/
├── src/                     server: Node ≥ 20 + TypeScript strict ESM, chạy thẳng bằng tsx (không build)
│   ├── server.ts            điểm vào (npm start / npm run dev)
│   ├── app.ts               HTTP tĩnh + /api + WebSocket /ws
│   ├── hub.ts               lõi rạp: Hub (mọi phòng) + Room (người, hàng chờ, đồng hồ video, chat, phiếu)
│   ├── protocol.ts          kiểm từng thông điệp client gửi lên
│   ├── types.ts             kiểu thông điệp server ↔ client (nguồn sự thật của giao thức)
│   ├── config.ts            biến môi trường → Config
│   ├── moderation.ts        lọc tên / chat, giới hạn tốc độ, băm IP, danh sách cấm, ghi JSON nguyên tử
│   └── youtube.ts           tách link, YouTube Data API + oEmbed, luật nhận video, bộ đệm
├── public/                  client: ES module thuần, Canvas 2D, không framework / bundler
│   ├── index.html           trang rạp (canvas + DOM nổi + màn vào rạp + tấm)
│   ├── chinh-sach.html      /chinh-sach — chính sách & quyền riêng tư
│   ├── style.css            toàn bộ CSS (biến --aud-top, --sheet-top, --right-inset, --dock-h, --side-w)
│   ├── og-image.jpg, icon-192.png, icon-512.png, apple-touch-icon.png   (sinh bằng scripts/share-images.ts)
│   ├── site.webmanifest, robots.txt
│   └── js/
│       ├── main.js  net.js  store.js  me.js  player.js  input.js  prefs.js  util.js  policy.js
│       ├── shared/hall.js + hall.d.ts     ◄── DÙNG CHUNG server + trình duyệt
│       ├── render/  stage.js persp.js hall.js character.js anims.js bubbles.js draw.js
│       │   └── venues/  index.js nhung.js congvien(-band,-floor,-art).js doxe(-band,-floor,-car,-props).js bien(-art).js
│       └── ui/      join.js queue.js chat.js wheel.js usercard.js sheet.js toasts.js admin.js
├── scripts/                 test-unit, smoke, fake-youtube, qa, qa-server, cdp, bots, qa-characters, share-images
├── deploy/                  deploy.sh, logs.sh, nginx.site.conf, nginx.limit.conf (+ vps.env, .env.production: BÍ MẬT)
├── docs/                    tài liệu (README.md = mục lục)
├── data/                    dữ liệu chạy thật (không commit; chỉ có .gitkeep trong repo)
├── package.json  tsconfig.json  .env.example  .gitignore
└── README.md  CHANGELOG.md  CLAUDE.md (yêu cầu gốc của chủ dự án)  AGENTS.md (hướng dẫn AI agent)
```

## 2. Server — `src/`

| File | Vai trò | Export chính | Ai dùng |
|---|---|---|---|
| `server.ts` | điểm vào: `dotenv`, `loadConfig`, `setExtraBadWords(BLOCK_WORDS)`, `createYouTubeClient`, `createApp`, `listen`, tắt êm (SIGINT / SIGTERM → lưu), bắt lỗi lẻ | — | `npm start` (`tsx src/server.ts`), `npm run dev` (`tsx watch`) |
| `app.ts` | HTTP: trang + file tĩnh có phiên bản `/v/<băm>/`, CSP, `/api/health`, đăng nhập admin (cookie), nâng cấp `/ws` (kiểm Origin), IP người xem, nhịp tim | `createApp(cfg, deps) → App { server, hub, listen, close }`, `AppDeps`, `App` | `server.ts`, `scripts/smoke.ts`, `qa.ts`, `qa-server.ts` |
| `hub.ts` | toàn bộ nghiệp vụ rạp: phòng / rạp / bản sao, kết nối, vào rạp, nối lại, di chuyển, động tác, chat, emoji, hàng chờ, đồng hồ video, phiếu, báo cáo, lỗi trình phát, admin, video mặc định, lưu / nạp | `Hub`, `Room`, `Conn`, `Player`, `Sock`, `HubDeps` | `app.ts` |
| `protocol.ts` | kiểm dạng + giới hạn từng `ClientMsg` (không tin client) | `parseClientMsg`, `rawToString`, `MAX_MSG_BYTES` (4096) | `app.ts`, `test-unit.ts` |
| `types.ts` | kiểu `ServerMsg`, `ClientMsg`, `AdminOp`, `PlayerInfo`, `FrameEntry`, `QueueItemInfo`, `NowInfo`, `ChatInfo`, `RoomInfo`, `RoomSnapshot`, `PublicSettings` | chỉ kiểu | `hub.ts`, `protocol.ts` |
| `config.ts` | đọc / kẹp biến môi trường | `loadConfig(overrides)`, `Config` | `server.ts`, `app.ts`, `hub.ts`, scripts |
| `moderation.ts` | `cleanText`, lọc bậy (`maskProfanity`), link (`hasLink`), tên (`checkName`, `nameKey`), chat (`checkChat`), `Bucket`, `WindowCounter`, `hashIp`, `loadOrCreateSalt`, `BanList`, `writeJsonAtomic`, `readJson` | (như trái) + `fold`, `codeLength`, `setExtraBadWords`, `isYouTubeLink`, `hasProfanity` | `hub.ts`, `app.ts`, `server.ts`, `test-unit.ts` |
| `youtube.ts` | `parseVideoId`, `parseIsoDuration`, `metaFromItem`, `checkMeta` (luật bắt buộc), `createYouTubeClient` (`fetchVideo`, `fetchOEmbed`), `VideoCache`, `fmtDuration` | + kiểu `VideoMeta`, `FetchResult`, `OEmbedResult`, `YouTubeClient` | `hub.ts`, `server.ts`, `fake-youtube.ts`, `test-unit.ts` |

## 3. Dùng chung — `public/js/shared/`

| File | Vai trò | Ai dùng |
|---|---|---|
| `hall.js` | **thuần JS, không DOM / Node**: `PROTOCOL`; sơ đồ `HALL` (34 × 16 ô, sân khấu, sàn nhảy, 5 hàng ghế × 3 dãy, loa, quầy, biển lối ra), `HOME`; `isWalkable`, `clampToWalkable`, `moveWithCollision`, `SPEED` (3,4 ô/s); `SEATS` (130), `nearestSeat`, `seatAt`, `spawnPoint`; `VENUES`, `DEFAULT_VENUE`, `ROOM_ID_RE`, `venueById`, `parseRoomId`, `roomName`; `DIRS`, `dirIndex`; `ACTIONS` (8), `ACTION_IDS`, `actionById`; `REACTIONS` (8 emoji); bảng ngoại hình `SKINS`, `HAIR_COLORS`, `HAIR_STYLES`, `SHIRTS`, `PANTS`, `ACCESSORIES`, `BODIES`, `FACIALS`, `normalizeLook`, `randomLook`; `LIMITS` (tên 2–20, chat 140, gửi 30 Hz) | server (`hub.ts`, `protocol.ts`, `app.ts`, `server.ts`), client (`main`, `store`, `me`, `input`, `render/*`, `ui/*`), scripts |
| `hall.d.ts` | kiểu TypeScript cho `hall.js` — **viết tay, phải sửa cùng lúc** với `hall.js` (server không phục vụ `.d.ts`) | `tsc` |

## 4. Client — `public/js/`

### 4.1 Lõi

| File | Vai trò | Export chính | Ai dùng |
|---|---|---|---|
| `main.js` | điểm vào: khoá máy `ck`, đăng nhập admin, dựng stage + trình phát + mọi UI, `syncInsets` (chừa chỗ cho DOM nổi), ngăn kéo, dock, 📺 góc xem, ⛶, ⚙️ tùy chọn, tự mờ nút, hướng dẫn, 🎨, chọn rạp, luồng vào rạp (form / vào nhanh cho người quay lại) / bị mời ra / nối lại, `window.__vc` | — (module gốc) | `index.html` |
| `net.js` | WebSocket `/ws?room=` (từ `/?phong=`), nối lại backoff, ping đo giờ, mã đóng 4001 / 4002; `#admin=` → `POST /api/admin/login` | `connect`, `send`, `isOpen`, `adminLoginFromUrl`, `adminLogout` | `main`, `me`, `player`, `ui/*` |
| `store.js` | trạng thái client, `handleMessage` (mọi `ServerMsg`), bus sự kiện, đồng hồ server (`onPong`, `serverNow`), **nội suy người khác** (`pushSample`, `actorPos`, bộ đệm thích ứng), bong bóng, emoji bay | `store`, `handleMessage`, `onPong`, `setConn`, `actorPos`, `setAction`, `spawnFx`, `bubbleDuration` | `net`, `main`, `me`, `player`, `render/stage`, `ui/*` |
| `me.js` | nhân vật của mình: dự đoán + va chạm chung, gửi `move` ≤ 30 Hz kèm giờ máy, sửa mượt khi `corr`, tự ngồi ghế, đi tới điểm chạm, động tác, emoji | `me`, `tickMe`, `placeMe`, `myRenderPos`, `applyCorrection`, `walkTo`, `doAction`, `react`, `mySeat`, `setKey`, `clearKeys`, `setJoy` | `main`, `input`, `stage`, `ui/wheel`, `ui/chat`, `ui/usercard` |
| `player.js` | trình phát YouTube chính thức + đồng bộ đồng hồ phòng, âm lượng, toàn màn hình video, báo lỗi `vid_err` | `createPlayer(slot, host, hooks)` → `{ enable, disable, sync, setVolume, toggleMute, fullscreen, userPlay, status, debug, … }` | `main` |
| `input.js` | phím WASD / mũi tên / E / 1–8 / Enter / Esc, nhả phím khi mất focus, trả focus khỏi iframe, cần điều khiển ảo | `initInput(hooks)` | `main` |
| `prefs.js` | tùy chọn người xem (⚙️) trong `localStorage vc.prefs` + ẩn riêng từng người theo tên | `prefs`, `DEFAULT_PREFS`, `DIM_LEVELS`, `setPref`, `onPrefs`, `resetPrefs`, `personFlags`, `setPersonFlag`, `unhidePerson`, `hiddenList`, `showPerson`, `showChatFrom`, `showActsFrom`, `showEmojiFrom` | `main`, `store`, `render/stage`, `ui/chat`, `ui/usercard` |
| `util.js` | `el()` / `setKids` / `setText` (**chỉ textContent**), `safeColor`, `lsGet/lsSet`, `ssGet/ssSet`, `randomHex`, `clamp`, `lerp`, ease, `fmtTime`, `hash2`, `initial`, `isTouch`, `reducedMotion`, `warnOnce` | (như trái) | gần như mọi module client |
| `policy.js` | trang `/chinh-sach`: gắn link email nếu server điền `CONTACT_EMAIL` | — | `chinh-sach.html` |

### 4.2 `render/` — vẽ canvas

| File | Vai trò | Export chính | Ai dùng |
|---|---|---|---|
| `stage.js` | bộ máy canvas: `computeLayout` (video ↔ khán phòng, góc xem, insets), camera (lia trên điện thoại, chụm phóng), cache (dải trên, phòng, hàng ghế, sprite người), sắp lớp theo độ sâu, clip dưới mép video, làm tối khi chiếu, bảng tên / bong bóng / emoji, chạm / bấm, đo + tự giảm chi tiết | `createStage(canvas, slot, hooks)` → `{ setView, setVenue, setInsets, screenPosOf, layout, view, venue, refresh, stop }` | `main`, `ui/wheel`, `ui/usercard` |
| `persp.js` | phép chiếu phối cảnh một điểm tụ, khối hộp 3D, trải sàn "mode 7" | `projection`, `box`, `poly`, `drawFloor` | `stage`, `hall`, chủ đề rạp |
| `venues/index.js` | sổ đăng ký chủ đề rạp + nạp động (`import()`), lỗi → Rạp Nhung Đỏ; mô tả giao diện một chủ đề | `defaultTheme`, `loadTheme(id)`, `themeOf(id)` | `stage` |
| `venues/nhung.js` | Rạp Nhung Đỏ = bọc bộ vẽ `render/hall.js` | `default` (chủ đề) | `venues/index.js` |
| `venues/congvien.js` (+ `congvien-band.js` trời + màn hình bơm hơi, `congvien-floor.js` texture cỏ + `drawRoom`, `congvien-art.js` bảng màu, cây, cột đèn, sprite quầng sáng) | chủ đề Rạp Công Viên (nạp động) | `default` | `venues/index.js` (`LOADERS`) |
| `venues/doxe.js` (+ `doxe-band.js` trời + tháp màn hình + biển neon, `doxe-floor.js` nhựa đường + hàng rào + đèn bãi, `doxe-car.js` xe mui trần 2 lớp, `doxe-props.js` loa, quầy SNACK BAR, đèn sàn nhảy, thiêu thân) | chủ đề Rạp Đỗ Xe (nạp động) | `default` | `venues/index.js` (`LOADERS`) |
| `venues/bien.js` (+ `bien-art.js` dừa, đuốc + lửa, tre, dây thừng, ván lướt sóng, lâu đài cát, phao) | chủ đề Rạp Bãi Biển (nạp động) | `default` | `venues/index.js` (`LOADERS`) |
| `hall.js` | bộ vẽ trong nhà: texture thảm, tường ốp gỗ + đèn + LỐI RA, sân khấu, hàng ghế nhung, loa, quầy BẮP NƯỚC, màn nhung + diềm, đèn sàn nhảy, chùm máy chiếu; `drawIdleScreen` (chữ trên màn hình trống) và `STAGE_H` dùng chung mọi rạp | `C`, `ZW`, `STAGE_H`, `floorTexture`, `drawRoom`, `renderRow`, `drawSpeaker`, `drawCounter`, `renderScreenBand`, `drawDanceLights`, `drawBeam`, `drawHallLight`, `drawIdleScreen` | `venues/nhung.js`, `stage` |
| `character.js` | nhân vật chibi đủ bộ phận từ `look` (chép VibeCorp + nam / nữ, râu, ngồi bệt, khung `anim`, bắp rang, tim) | `drawCharacter`, `U`, `headTop`, `headCenter`, `HEAD_RADIUS`, `moodOf`, `portrait` (chân dung cho thẻ chào lại) | `stage`, `ui/join`, `qa-characters.ts` |
| `anims.js` | 8 động tác = hàm thuần của thời gian; emoji bay theo động tác | `actionPose`, `ACTION_FX` | `stage`, `ui/join` |
| `bubbles.js` | bong bóng chat (tự chọn chỗ không chồng), bảng tên, đẩy tên chồng nhau (chép VibeCorp) | `drawBubbles`, `drawNamePill`, `measureNamePill`, `spreadPills`, `clearTextCache` (+ `drawEmote`, `drawSign` chưa dùng) | `stage` |
| `draw.js` | màu (`shade`, `luma`, `parseColor`…), hình (`rrPath`, `fillRR`, `circle`, `ellipse`…), gradient, `FONT`, `drawEmoji` (luôn font 16 px rồi scale — Chrome bỏ emoji cỡ < ~0,4), `makeCanvas` | (như trái) | `render/*`, `ui/chat` |

### 4.3 `ui/` — giao diện DOM

| File | Vai trò | Export chính | Ai dùng |
|---|---|---|---|
| `join.js` | màn vào rạp: lần đầu = chọn rạp (`spec`), tên, `lookEditor` (dùng lại cho 🎨), nhân vật xem trước, 🎲; người quay lại = thẻ "Chào mừng quay lại" (danh sách phòng, bấm là vào); lưu tên / ngoại hình / phòng lần trước | `initJoin(onSubmit, onQuick)` → `{ hide, show, showQuick, isQuick, setQuickBusy, quickError, look }`, `lookEditor`, `startPreview`, `savedLook`, `saveLook`, `savedName`, `saveName`, `rememberJoin`, `isReturning`, `lastRoom`, `showJoinError`, `setJoinBusy` | `main` |
| `queue.js` | thẻ Đang chiếu (tiến độ, bỏ phiếu, 🚩), ô dán link + `q_res`, danh sách chờ, báo cáo video, nút dưới màn hình ⏭ 🚩 | `initQueue`, `registerAdminHooks` | `main`, `ui/admin` |
| `chat.js` | khung chat (bám cuối, "↓ N tin mới"), ô nhập dock, bảng emoji, khung chat nổi, lọc theo ⚙️ | `initChat`, `systemLine` | `main` |
| `wheel.js` | vòng 8 động tác quanh nhân vật mình | `initWheel(stage)` | `main` |
| `usercard.js` | thẻ khi bấm vào nhân vật: vẫy chào, báo cáo, ẩn riêng (⚙️), công cụ admin | `initUserCard(stage)`, `registerUserAdmin` | `main`, `ui/admin` |
| `sheet.js` | "tấm" dùng chung (thẻ phải / trượt từ dưới) | `initSheet`, `openSheet`, `closeSheet`, `sheetOpen`, `onSheetChange` | `main`, `ui/*` |
| `toasts.js` | thông báo nhỏ dưới màn hình | `initToasts`, `toast` | `main`, `ui/*` |
| `admin.js` | bảng 🛠 + nút admin gắn vào Đang chiếu / hàng chờ / thẻ người — **chỉ `import()` khi `hello.admin`** | `initAdmin` | `main` (import động) |

## 5. Scripts — `scripts/` (chạy bằng `tsx`)

| File | Vai trò | Lệnh |
|---|---|---|
| `test-unit.ts` | 22 test hàm thuần (YouTube, kiểm duyệt, giao thức, sơ đồ rạp, ngoại hình, rạp, động tác) | `npm run test:unit` |
| `smoke.ts` | 32 bước toàn hệ thống: app thật + WebSocket + YouTube giả + thư mục tạm | `npm run smoke` |
| `fake-youtube.ts` | `createFakeYouTube()` + `FIXTURES` — YouTube giả, không ra Internet | dùng bởi smoke, qa, qa-server |
| `qa-server.ts` | server QA cổng 3399, YouTube giả, không ghi đĩa, admin `qa-local-admin` | `npx tsx scripts/qa-server.ts` |
| `bots.ts` | người xem giả (`startBots`) — đi, ngồi, nhảy, chat, emoji, thêm video | `npm run bots -- --url … --n 20` |
| `qa.ts` | QA hình: Chrome headless, ảnh máy tính + điện thoại, `checkOverlap` (không gì đè video), đo mượt, bắt lỗi console | `npm run qa -- --out <dir>` |
| `cdp.ts` | điều khiển Chrome qua DevTools Protocol chỉ bằng `ws` (`launch`, `Page`) | dùng bởi qa, qa-characters, share-images |
| `qa-characters.ts` | bảng 8 động tác × 4 hướng + bảng dáng nam / nữ | `npx tsx scripts/qa-characters.ts --url … --out …` |
| `share-images.ts` | vẽ `og-image.jpg` + icon | `npm run share-images -- --url …` |

Chi tiết: [06](06-kiem-thu-qa.md).

## 6. Deploy — `deploy/`

| File | Vai trò |
|---|---|
| `deploy.sh` | `--setup` (lần đầu: kiểm cổng 3300, tạo `/opt/vibecinema`, nginx site + zone `vcin_api`, chứng chỉ Let's Encrypt, pm2 startup) / thường (rsync, `.env`, npm install, pm2 restart, health) |
| `logs.sh` | `pm2 logs vibecinema --lines N` |
| `nginx.site.conf` | mẫu site (`__DOMAIN__`, `__PORT__`, dòng `# __SSL__`): realip chỉ tin Cloudflare, `/ws`, `/api/` (limit), `/` |
| `nginx.limit.conf` | `limit_req_zone … zone=vcin_api:10m rate=2r/s` → `/etc/nginx/conf.d/vibecinema-limit.conf` |
| `vps.env`, `.env.production` | **BÍ MẬT** — không đọc ra, không commit, không chép vào tài liệu |

Chi tiết: [05](05-van-hanh-deploy.md).

## 7. Luồng dữ liệu

### 7.1 Khởi động server

```
server.ts ─► dotenv ─► loadConfig ─► setExtraBadWords ─► createYouTubeClient(key)
          └► createApp(cfg, {youtube, dataDir})
               ├─ loadOrCreateSalt (data/ip-salt.txt)        ├─ ASSET_VERSION = băm public/
               └─ new Hub(cfg) ─► BanList(bans.json) ─► load(rooms.json) ─► phòng chính cho mỗi rạp
                    hub.start(): tick 30 Hz · refreshDefault() ngay + 6 giờ · lưu rooms.json 30 s
          └► listen(PORT, HOST)
```

### 7.2 Mở trang → đứng xem → vào rạp

```
GET / ─► app.sendHtml (viết lại /v/<ver>/, điền %SITE_URL%) ─► main.js
main.js: ck ─► adminLoginFromUrl ─► createStage + createPlayer + UI ─► initJoin ─► net.connect()
WS /ws?room ─► app (Origin, IP băm, cookie admin) ─► hub.connect ─► hello ─► store.onHello ─► emit hello/rooms/players/queue/now…
                                                                    ├─► stage.setVenue(venue) ─► loadTheme
                                                                    └─► join.js thẻ rạp, dòng "Đang chiếu…"
Bấm "Vào rạp" (form) hoặc một phòng trên thẻ "Chào mừng quay lại" (quickJoin: tên + nhân vật đã nhớ)
  ─► main.sendJoin ─► join {name, look, room, token, ck} ─► hub.onJoin ─► welcome (mình) + pj (người khác)
store.onWelcome ─► main: lưu token, rememberJoin(phòng), ẩn màn vào rạp, placeMe, me.active, player.enable()
```

### 7.3 Đi lại (dự đoán + nội suy)

```
input.js / joystick / chạm sàn ─► me.tickMe (moveWithCollision, 60 fps) ─► net.send(move {x,y,d,c,m}) ≤ 15/s
hub.onMove: ngân sách + va chạm + kẹp giờ ─► (lệch) corr ─► me.applyCorrection (kéo mượt 180 ms)
            p.dirty ─► Room.tick (30 Hz) ─► f [[id,x,y,d,c,m],…] ─► store.onFrame ─► pushSample (trục giờ người đi)
stage.prepareActors ─► actorPos(a, now − buffer − off) ─► vẽ
```

### 7.4 Động tác (sự kiện)

```
phím 1–8 / vòng E ─► me.doAction ─► me.act (vẽ ngay) + act {a, c}
hub.onAct ─► act {id, a, c} cả phòng ─► store: a.act.start = localTimeOf(c) ─► stage.figureOf ─► anims.actionPose(t)
```

### 7.5 Thêm video → chiếu

```
ui/queue.js submit ─► q_add {url} ─► hub.onQueueAdd: parseVideoId · chặn / trùng / giới hạn ─► lookup (cache 6 h │ inflight │
  youtube.fetchVideo) ─► checkMeta ─► queue.push ─► q_res (người thêm) + notice (người khác) + Room.next() hoặc queue
Room.next ─► now {v, at = giờ + 2 s, ends} ─► now {n, s} cả phòng ─► store.now ─► player.sync() (mỗi 500 ms + khi đổi)
player: target = (serverNow − at)/1000 ─► cue / load / play / seekTo khi lệch > 1 s
```

### 7.6 Video mặc định

```
Hub.refreshDefault (oEmbed + videos.list nếu có key) ─► defaultMeta
Room.tick: trống video + hàng chờ trống > DEFAULT_IDLE_SECONDS ─► playDefault ─► now {filler: true, live, ends ∞}
có bài mới ─► Room.tick ─► next() (nhường ngay) · vote ─► notice · admin skip ─► nghỉ 10 phút · lỗi ─► tắt 30 phút
```

### 7.7 Báo cáo / lỗi trình phát / admin

```
🚩 ─► report ─► hub.onReport ─► reports.jsonl + adm note ─► (đủ IP) blockVideo + next
player.onError 2/100/101/150 ─► vid_err ─► hub.onVideoError ─► (đủ IP) embedFail + next
🛠 (ui/admin.js) ─► adm {op} ─► hub.onAdmin (chỉ conn.admin) ─► notice + adm state
```

## 8. Muốn sửa X thì vào đâu

| Muốn… | Sửa | Ghi chú |
|---|---|---|
| Đổi luật nhận video (độ dài, live, vùng) | `.env` (`MAX_VIDEO_MINUTES`, `ALLOW_LIVE`, `YT_REGION`…); logic `src/youtube.ts checkMeta` | thêm test trong `test-unit.ts` |
| Đổi giới hạn hàng chờ / bỏ phiếu / báo cáo | `.env`; logic `hub.ts onQueueAdd`, `votesNeeded`, `onReport` | [07](07-server.md) |
| Thêm / đổi lý do từ chối, câu thông báo | `youtube.ts`, `hub.ts` (chuỗi tiếng Việt tại chỗ) | |
| Thêm rạp / khung cảnh | `shared/hall.js VENUES` (kiểu trong `hall.d.ts` không đổi) + `render/venues/<id>.js` + `LOADERS` trong `venues/index.js` | [08](08-mo-rong.md) §1 |
| Sửa hình một rạp | `render/venues/<id>.js` (Nhung Đỏ: `render/hall.js`) | không đụng `HALL` |
| Đổi sơ đồ đi lại (kích thước, ghế, vật cản) | `shared/hall.js HALL` (+ `hall.d.ts` nếu đổi kiểu) | ảnh hưởng **mọi** rạp + server; chạy `npm test` + QA |
| Thêm động tác | `shared/hall.js ACTIONS` + `hall.d.ts ActionId` + `render/anims.js` (+ `ACTION_FX`) + chữ hướng dẫn `main.js` | [08](08-mo-rong.md) §2 |
| Thêm lựa chọn ngoại hình | `shared/hall.js` (bảng + `normalizeLook`) + `render/character.js` + `ui/join.js lookEditor` | [08](08-mo-rong.md) §3 |
| Thêm emoji thả nhanh | `shared/hall.js REACTIONS` (server kiểm theo danh sách này) | |
| Đổi tốc độ đi | `shared/hall.js SPEED` (server dùng cho ngân sách) | |
| Lọc chat / tên | `src/moderation.ts` (`BAD_EXACT`, `BAD_FOLDED`, `RESERVED_*`) hoặc `.env BLOCK_WORDS` | |
| Giới hạn tốc độ người dùng | `hub.ts onJoin` (các `Bucket`), `app.ts` (đăng nhập), `.env` | |
| Thêm lệnh admin | `types.ts AdminOp` + `protocol.ts parseAdmin` + `hub.ts onAdmin` + `ui/admin.js` | [08](08-mo-rong.md) §4 |
| Thêm thông điệp WebSocket | `types.ts` + `protocol.ts` + `hub.ts` + `store.js handleMessage` + docs/02 | [08](08-mo-rong.md) §5 |
| Thêm biến cấu hình | `config.ts` + `.env.example` (+ `PublicSettings` nếu client cần) + docs/07 §16 | [08](08-mo-rong.md) §6 |
| Bố cục video ↔ khán phòng, góc xem | `render/stage.js computeLayout`, `main.js VIEWS` | kiểm `npm run qa` (chồng lấn) |
| Thêm nút / DOM nổi | `index.html` + `style.css` + `main.js`; nếu chiếm chỗ: `syncInsets` / `setInsets`; thêm id vào `qa.ts checkOverlap` | không bao giờ đè video |
| Đồng bộ video, tua, quảng cáo | `public/js/player.js` | đọc [04](04-youtube-va-phap-ly.md) trước |
| Độ mượt người khác | `store.js` (bộ đệm `NET_*`, `pushSample`, `actorPos`) | đo bằng `npm run qa` |
| Dự đoán nhân vật mình | `me.js` | giữ khớp `hub.ts onMove` |
| Máy yếu / chất lượng | `stage.js measure`, ⚙️ `prefs.js quality` | |
| Thêm tùy chọn ⚙️ | `prefs.js DEFAULT_PREFS` (+ `ENUMS`) + `main.js prefsContent` + nơi dùng | chỉ trên máy người xem |
| Bảng tên, bong bóng | `stage.js drawOverlays`, `render/bubbles.js` | |
| Nhân vật (bộ phận, dáng) | `render/character.js` | soi bằng `qa-characters.ts` |
| Màn vào rạp | `ui/join.js`, `index.html #join` | |
| Hàng chờ / Đang chiếu (giao diện) | `ui/queue.js` | |
| Khung chat | `ui/chat.js` | chữ chỉ qua `textContent` |
| Trang chính sách | `public/chinh-sach.html` | đổi dữ liệu thu thập → cập nhật trang này |
| HTTP, CSP, cookie admin, IP | `src/app.ts` | thêm miền ngoài → sửa CSP |
| Lưu trữ | `hub.ts save / load`, `moderation.ts BanList` | nạp phải phòng thủ (dữ liệu cũ) |
| nginx, deploy | `deploy/nginx.*.conf`, `deploy/deploy.sh` | VPS dùng chung — [05](05-van-hanh-deploy.md) |
| Test | `scripts/test-unit.ts`, `scripts/smoke.ts`, `scripts/fake-youtube.ts` | không ra Internet |
| Ảnh chia sẻ / icon | `scripts/share-images.ts` → `public/og-image.jpg`, `icon-*.png` | |
