# 04 · YouTube & pháp lý

Luật gốc: `CLAUDE.md` §2 (yêu cầu của chủ dự án). Tài liệu này chỉ ra **code nào giữ luật nào** — sửa bất cứ gì đụng
tới video, trình phát, bố cục quanh màn hình thì đọc lại cả trang và chạy `npm run qa` (kiểm chồng lấn).

## 1. Bảng luật → code

| Luật | Giữ ở đâu |
|---|---|
| Chỉ nhúng video công khai, cho nhúng, không giới hạn tuổi, xem được ở VN, giới hạn độ dài | `src/youtube.ts` `checkMeta` + `metaFromItem`; gọi từ `hub.ts onQueueAdd` (§3) |
| Không đạt → từ chối, báo rõ lý do | lý do tiếng Việt trong `checkMeta` → `q_res.text` |
| Chủ kênh tắt nhúng giữa chừng (101/150) → tự sang bài kế | `player.js onError` → `vid_err` → `hub.ts onVideoError` (§7) |
| Đúng trình phát chính thức, không chỉnh / che | `player.js` (IFrame Player API, tham số chính thức); `stage.js` cắt mọi lớp vẽ dưới mép video; `main.js syncInsets` + `stage.computeLayout` chừa chỗ cho mọi nút; `scripts/qa.ts checkOverlap` |
| Không chặn quảng cáo | `player.js` không đụng quảng cáo; **cố ý không chặn bấm** vào khung video (§5) |
| Trình phát ≥ 200×200 px | `stage.js computeLayout` (ép tối thiểu, chạm mức thì giữ 356×200 đúng 16:9) |
| Không tải / phát lại video, video không qua VPS | server chỉ gọi `videos.list` / oEmbed lấy siêu dữ liệu; trình duyệt tải video thẳng từ YouTube |
| Trang chính sách nói rõ dùng dịch vụ YouTube | `public/chinh-sach.html` (`/chinh-sach`), link ở màn vào rạp + bảng Hướng dẫn |
| Nút báo cáo, có khiếu nại thì gỡ ngay | 🚩 dưới màn hình / thẻ Đang chiếu → `report`; admin "🚫 Gỡ hẳn" (`adm block`) (§8) |
| Không affiliate / quảng cáo sát trình phát | không có trong code — giữ nguyên như vậy |
| `YT_API_KEY` chỉ ở `.env`, không in / commit | `server.ts` không in key; `youtube.ts` chỉ đặt key trong URL gọi API, lỗi chỉ ghi lý do |

## 2. Tách link — `parseVideoId`

Nhận id 11 ký tự (`[A-Za-z0-9_-]`) hoặc link: `youtube.com/watch?v=`, `youtu.be/<id>`, `/shorts/`, `/live/`, `/embed/`,
`/v/`, `/e/`, tiền tố `www.` / `m.` / `music.`, `youtube-nocookie.com`, có hoặc không có `https://`, có tham số thừa
(`&t=42s`, `?si=…`, `&list=…`). Host khác (kể cả `evil.com/watch?v=<id>`) → `null` → "Đây không phải link video YouTube".

## 3. Kiểm tra video — `videos.list` + `checkMeta`

Server gọi `GET https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails,snippet&id=<id>&key=…`
(1 đơn vị quota, timeout 6 s). `metaFromItem` đọc **phòng thủ**: trường thiếu = giá trị an toàn nhất (bị từ chối) —
`embeddable` phải đúng `true`, `privacyStatus` thiếu = `unknown`, `uploadStatus` thiếu coi như đã xử lý.

| Điều kiện (theo thứ tự) | Lý do khi không đạt |
|---|---|
| tìm thấy video | "Không tìm thấy video — có thể đã bị xoá hoặc để riêng tư." |
| `privacyStatus === 'public'` | "Video đang để "không công khai" — chỉ chiếu video công khai." / "Video không công khai." |
| `status.embeddable === true` | "Chủ kênh không cho phép phát video này trên trang khác." |
| `uploadStatus === 'processed'` | "Video chưa xử lý xong trên YouTube." |
| `contentRating.ytRating !== 'ytAgeRestricted'` | "Video bị giới hạn độ tuổi trên YouTube." |
| `regionRestriction`: có `allowed` thì phải chứa `YT_REGION`; `blocked` không chứa | "Video không xem được ở Việt Nam." |
| không phải buổi live sắp phát (`liveBroadcastContent: upcoming`) | "Buổi phát trực tiếp này chưa bắt đầu." |
| live (`liveBroadcastContent: live`): `ALLOW_LIVE` | "Rạp đang không nhận video phát trực tiếp." |
| không live: đọc được độ dài > 0 | "Không đọc được độ dài video." |
| độ dài ≤ `MAX_VIDEO_MINUTES` (admin: `ADMIN_MAX_VIDEO_MINUTES`) | "Video dài … — rạp chỉ nhận video tối đa …" |

Không gọi được Data API (bảng dưới) → **không chặn người xem nữa** (0.4.6): chuyển sang kiểm cơ bản §3.1. Log server
ghi một lần `⚠️ YouTube Data API không dùng được (<code>) — tạm kiểm video cơ bản bằng oEmbed`.

| Trường hợp | `code` |
|---|---|
| chưa có `YT_API_KEY` (không gọi API) | `no_key` |
| 403 quota / rateLimit | `quota` |
| 400, 403 key / accessNotConfigured / ipRefererBlocked (log ghi lý do, không ghi key) | `bad_key` |
| HTTP lỗi khác | `api` |
| mạng / timeout | `network` |

### 3.1. Kiểm cơ bản — không có / không dùng được `YT_API_KEY` (chủ dự án quyết 2026-11-03)

oEmbed công khai `https://www.youtube.com/oembed?url=…` (miễn phí, không key, không quota; `hub.lookupOEmbed` nhớ 30 phút):

| oEmbed | Người xem thấy |
|---|---|
| 200 (tên + kênh) | nhận, item `unk: true` (chưa rõ độ dài), `cap` = `MAX_VIDEO_MINUTES` (admin `ADMIN_MAX_VIDEO_MINUTES`) × 60 |
| 401 / 403 (chặn nhúng / riêng tư) | "Video riêng tư hoặc chủ kênh không cho phát trên trang khác." |
| 400 / 404 | "Không tìm thấy video — có thể đã bị xoá hoặc để riêng tư." |
| mạng / lỗi khác | "Không kiểm tra được video lúc này, thử lại sau nhé." |

Phần oEmbed không biết thì giữ luật theo cách khác:
- **18+ / chặn ở VN**: chính trình phát nhúng của YouTube từ chối phát trên trang khác → lỗi 101/150/100 → `vid_err`
  → tự chuyển bài (§7) — rạp không bao giờ chiếu được, chỉ mất vài giây lượt đó.
- **Độ dài**: lượt chiếu đặt hết giờ = `cap` (`Room.playMs`). Khi phát, mỗi máy đo bằng hàm có tài liệu `getDuration()` /
  `getCurrentTime()` — 2 lần cách ≥ 4 s, chỉ khi nội dung đang chạy (giờ video tăng ≥ 2 s, không phải quảng cáo) — rồi
  gửi `vid_dur {v, d, live}` một lần mỗi bài (`player.js probeDuration`). Server (`onVideoDuration`): người thêm video báo
  là nhận (họ vốn tự bỏ qua được bài mình); người khác cần đủ số mạng như `vid_err`, lấy trung vị. Nhận xong: `unk` bỏ,
  `dur` = độ dài thật, `ends` = `at + min(dur, cap)`; dài hơn `cap` thì báo "chiếu tối đa … rồi chuyển bài".
- **Live**: độ dài tăng dần giữa 2 lần đo (live: `getDuration` = thời gian đã phát của luồng) → `live: true` → chiếu
  tối đa `LIVE_MAX_MINUTES`, máy người xem nạp lại theo đầu live (`loadedLive`); `ALLOW_LIVE=false` thì chuyển bài.
- Còn hở: video **không công khai** (unlisted) vẫn vào được (oEmbed trả 200 như video công khai) — vẫn hợp lệ với YouTube
  (cho nhúng), chỉ chặt hơn được khi có key. Hàng chờ hiện "chưa rõ thời lượng" tới khi đo xong.
Thử trên máy: `NO_KEY=1 npx tsx scripts/qa-server.ts` (YouTube giả không key, trình phát thật đo độ dài).

## 4. Bộ đệm & quota

- Quota miễn phí 10.000 đơn vị / ngày; `videos.list` = 1 đơn vị / link mới. Hướng dẫn tạo key: `README.md`.
- `VideoCache`: nhớ kết quả 6 giờ (tối đa 2000 video); cùng một id đang hỏi thì các yêu cầu dùng chung một Promise
  (`inflight`). Lỗi không được cache.
- Chống đốt quota: link **chưa có trong cache** → mỗi IP ≤ `LOOKUPS_PER_IP_MINUTE` (6) / phút, cả server ≤ 120 / phút
  (admin bỏ qua giới hạn theo IP).
- Video mặc định kiểm bằng oEmbed (không tốn quota) + 1 lượt `videos.list` mỗi 6 giờ khi có key.

## 5. Trình phát chính thức — `public/js/player.js`

- Tải `https://www.youtube.com/iframe_api` (lỗi → thử lại sau 20 s, báo một lần "Không tải được trình phát YouTube
  (mạng / trình chặn quảng cáo?)"). Host `https://www.youtube-nocookie.com` khi `YT_NOCOOKIE=true` (`cfg.noCookie`).
- `playerVars`: `autoplay: 1, controls: 1, disablekb: 1, playsinline: 1, rel: 0, fs: 0, enablejsapi: 1, origin,
  widget_referrer`. Thanh điều khiển YouTube **hiện** (0.4.8 — chủ dự án muốn mỗi người tự bật / tắt phụ đề bằng nút CC;
  YouTube chỉ có tham số ÉP BẬT phụ đề `cc_load_policy=1`, không có cách chính thức ép tắt). YouTube không cho ẩn riêng
  thanh tua / nút dừng, nên **xem chung** giữ bằng cách đưa về giờ chung (chỉ hàm / sự kiện có tài liệu):
  - bấm dừng → `onState(PAUSED)` không do mình ra lệnh → `playVideo()` ngay;
  - kéo thanh tua → `sync()` thấy giờ video nhảy tới nhanh hơn thời gian thật > 3 s hoặc lùi > 3 s so với lần đo trước
    (quảng cáo / mạng chậm chỉ làm video chạy chậm hơn nên không nhầm) → tua về giờ chung ngay (đo thật: ~1,7 s);
  - đổi tốc độ (⚙ của YouTube) → `onPlaybackRateChange` → `setPlaybackRate(1)`;
  - bấm video gợi ý ("More videos", màn hình cuối) → `getVideoUrl()` khác video của rạp (đã phát ổn định > 3 s) → nạp lại
    video của rạp;
  - mỗi lần như vậy nhắc nhẹ (tối đa 1 lần / 45 s): "Rạp đang xem chung — không tua, dừng hay đổi tốc độ riêng được…".
  `disablekb: 1` tắt phím tắt trong khung; `fs: 0` ẩn nút toàn màn hình của YouTube (rạp có nút riêng). Một trang chỉ có
  một trình phát.
- Trình phát chỉ được bật (`player.enable()`) **sau khi** người xem bấm "Vào rạp" (có thao tác người dùng → trình duyệt
  cho phát có tiếng). Bị mời ra / phải vào lại → `player.disable()` dừng + ẩn khung **trước** khi hiện màn vào rạp (lớp
  phủ không bao giờ nằm trên video đang chạy).
- Lỡ bấm vào video (trình phát tự dừng): `onStateChange(PAUSED)` mà phòng đang chạy, tab đang hiện, không phải lệnh của
  mình trong 400 ms → chạy lại **ngay**, lặng lẽ, rồi tua về giờ chung. Bàn phím được trả về trang (`input.js` blur →
  focus canvas) để WASD / E vẫn điều khiển nhân vật; nếu vẫn kẹt thì hiện "Bấm vào khán phòng để điều khiển nhân vật".
- **Cố ý KHÔNG chặn bấm vào khung video** (`pointer-events: none`, lớp phủ trong suốt…): Điều khoản YouTube API cấm
  "modify, build upon, or block any portion or functionality of a YouTube player" (III.I.6), "remove, obscure, alter,
  or disable any links that appear in YouTube players" (III.I.4), "interfere with … or block advertisements" (III.I.5) —
  chặn bấm sẽ chặn nút "Bỏ qua quảng cáo", link quảng cáo, logo / tiêu đề YouTube. Tự chạy lại cho kết quả như nhau mà
  không vi phạm.
- Nút **dưới** màn hình (`#screen-tools`, không đè video): 🔊 + thanh âm lượng (nhớ `vc.vol`, `vc.muted`), ⛶ toàn màn hình
  khung video (`requestFullscreen` lên `#screen-slot`; iPhone dùng `webkitEnterFullscreen` của iframe), "▶ Bấm để xem"
  khi trình duyệt chặn tự phát (iPhone), "🔊 Bật tiếng" khi trình duyệt tự tắt tiếng.
- Không che: `#screen-slot` (iframe) nằm trên canvas, đặt khít ô màn hình (`stage.placeSlot`). Canvas cắt (clip) mọi thứ
  của khán phòng dưới mép video; tường / hiệu ứng trời vẽ với clip `evenodd` chừa khung video; mọi DOM nổi (cụm nút góc,
  dock, ngăn kéo, tấm, toast, vòng động tác, thẻ người, khung chat nổi) được đặt ngoài khung — `npm run qa` kiểm từng
  ảnh chụp ([06](06-kiem-thu-qa.md) §6).
- Chỉ tự phát khi trình phát đang hiện: tab ẩn thì bài mới chỉ được nạp sẵn (`cueVideoById`), quay lại tab mới phát đúng
  giờ chung.
- Đối chiếu: [YouTube Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
  — chỉ đổi trình phát bằng tham số / hàm API có tài liệu (`controls`, `disablekb`, `fs`, play / pause / seek / volume),
  không đặt lớp phủ trước trình phát, khung ≥ 200×200 px, chỉ tự phát khi đang hiện, không quá một trình phát tự phát.

## 6. Đồng bộ "đồng hồ phòng"

Server (`Room.now`) giữ `{ v, at, paused, pos, ends, live, dur, filler? }` — `at` = giờ server ứng với giây 0 (bài mới:
lúc chọn + 2 s cho mọi máy kịp tải); hết `ends` (+1,5 s) → bài kế. Chỉ admin dừng được, và dừng là **cả phòng** dừng
cùng vị trí.

Client:

- Giờ server = `performance.now() + offset` (`store.serverNow()`): `hello.s` cho ước lượng đầu; `ping / pong` kiểu NTP
  (`store.onPong`) giữ mẫu có RTT thấp nhất, mẫu tệ chỉ nhích nhẹ.
- Vị trí đích `target = (serverNow − at) / 1000` (đang dừng: `pos`).
- `player.load(n)` khi đổi bài: tab ẩn → `cueVideoById` (không tự phát); live → `loadVideoById` (theo đầu live); chưa
  tới giây 0 → cue ở 0 rồi `setTimeout` đúng giờ mới `playVideo` (mọi máy bắt đầu cùng lúc); đã qua → `loadVideoById`
  tại `target`.
- Lần `PLAYING` đầu sau khi tải: lệch > 0,6 s → tua tới `target + 0,35 s` (bù thời gian tải).
- `sync()` mỗi 500 ms: phòng dừng → `pauseVideo` + tua nếu lệch > 1 s; đang chờ giây 0 → đợi; `CUED / UNSTARTED / PAUSED`
  → xin `playVideo` (2,5 s một lần, tua nếu lệch), quá 2 s vẫn không chạy → hiện "▶ Bấm để xem"; `ENDED` sớm → tua +
  phát; live → để YouTube giữ đầu live; `PLAYING` lệch > 1 s → `seekTo`, tối đa 1 lần / 2,5 s — lần tua trước "không ăn"
  (thường do đang quảng cáo) thì giãn nhịp tới 4× → **xem quảng cáo xong tự tua về đúng chỗ** mà không phá quảng cáo.
- Bỏ phiếu, tiến độ (thẻ Đang chiếu) cũng tính theo `serverNow()`.

## 7. Lỗi giữa chừng

`onError`: mã 2 / 100 / 101 / 150 → `vid_err {v, code}`. Server cần đủ **mạng (IP) khác nhau** cùng báo cho đúng video
đang chiếu — `max(2, 30 %)` số IP có mặt, ít người thì tất cả — một người mở nhiều tab không đủ. Đủ → chuyển bài; 101 /
150 ghi `embedFail` 24 giờ (không cho thêm lại), xoá cache; nếu là video mặc định → tắt video mặc định 30 phút. Mã 153
(trang nhúng thiếu Referer) là lỗi cấu hình của mình → chỉ báo trên máy đó, không chuyển bài (giữ
`Referrer-Policy: strict-origin-when-cross-origin`).

## 8. Báo cáo & gỡ

- 🚩 dưới màn hình (hoặc nút "🚩 Báo cáo" ở thẻ Đang chiếu) → chọn lý do (bản quyền, không phù hợp, spam / lừa đảo, khác)
  + ghi chú → `report {kind: 'video'}`. Bấm vào nhân vật → báo cáo người (quấy rối, spam, tên / hành vi không phù hợp, khác).
- Server ghi `data/reports.jsonl` + log, báo ngay mọi admin đang mở trang (toast + tab "🚩 Báo cáo" trong 🛠).
- `REPORT_AUTOSKIP` (3) **IP khác nhau** báo cùng video đang chiếu → gỡ ngay + chặn video (admin bỏ chặn được).
- Admin: "⏭" (chỉ bỏ qua) và **"🚫 Gỡ hẳn"** (`adm block`: xoá khỏi mọi hàng chờ, dừng ở mọi phòng đang chiếu, không ai
  thêm lại được, lưu `rooms.json`) — dùng khi có khiếu nại bản quyền. Tab "🚫 Video bị gỡ" để bỏ chặn.
- Khiếu nại bản quyền: trang `/chinh-sach` hướng dẫn dùng nút báo cáo (ghi cách liên hệ trong ghi chú) hoặc email
  `CONTACT_EMAIL` nếu có; video vẫn nằm trên YouTube nên chủ sở hữu cũng gửi được yêu cầu gỡ cho YouTube.

## 9. Video mặc định (kênh trực tiếp khi phòng trống)

- `DEFAULT_VIDEO` (mặc định `rFZHOHl-L8A`, một kênh phát trực tiếp 24/7; rỗng / sai dạng = tắt). Phòng không có video +
  hàng chờ trống quá `DEFAULT_IDLE_SECONDS` (30 s) → rạp tự phát, `now.filler = true`, badge "KÊNH MẶC ĐỊNH".
- Vẫn chịu đủ luật: oEmbed 401/403 (chặn nhúng) hoặc 404 → tắt; có `YT_API_KEY` thì `checkMeta` (công khai, không 18+, xem
  được ở VN, cho nhúng — bỏ giới hạn độ dài). Kiểm lại mỗi 6 giờ. Bị báo cáo / admin gỡ hẳn → không phát nữa (danh sách
  `blocked`).
- Có người thêm video → nhường **ngay** ở nhịp kế; không bỏ phiếu được (server trả `notice` hướng dẫn); admin ⏭ → phòng
  đó tạm không phát lại 10 phút; lỗi trình phát → tắt 30 phút.
- Không lưu vào `rooms.json`. Chi tiết server: [07](07-server.md) §13.

## 10. Trang chính sách (`public/chinh-sach.html` → `/chinh-sach`)

Nói rõ: dùng dịch vụ YouTube API (link Điều khoản YouTube, Chính sách quyền riêng tư Google, trang quản lý quyền truy cập
Google); trình phát chính thức, không tải / chỉnh / che / chặn quảng cáo; rạp lưu gì (tên, ngoại hình, vị trí, chat ~50
tin trong bộ nhớ, IP băm một chiều, khoá ngẫu nhiên của trình duyệt, báo cáo, dữ liệu localStorage) và không làm gì
(không tài khoản, không bán dữ liệu, không quảng cáo cạnh trình phát); cookie chỉ dành cho admin; cách báo cáo / khiếu
nại bản quyền (`CONTACT_EMAIL` được `policy.js` gắn thành link nếu có). Đổi cách thu thập dữ liệu → **cập nhật trang này**
(và ngày cập nhật ở đầu trang).

## 11. Checklist khi sửa vùng video

1. Không thêm phần tử nào (DOM hay vẽ canvas) có thể nằm trên khung `#screen-slot`; DOM mới nổi trên rạp phải được thêm
   vào danh sách `checkOverlap` trong `scripts/qa.ts`, và nếu chiếm chỗ thì báo qua `stage.setInsets`.
2. Không thêm `pointer-events: none` / lớp phủ lên iframe; không đụng quảng cáo; không tự tua khi đang quảng cáo dồn dập.
3. Trình phát ≥ 200×200 ở mọi cỡ màn (thử 390×844, 844×390, 1280×680, 1440×900).
4. Chỉ dùng tham số / hàm IFrame API có tài liệu.
5. `npm test` + `npm run qa` không có lỗi console thật, không có dòng "… đè video".
