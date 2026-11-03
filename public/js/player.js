// Trình phát YouTube CHÍNH THỨC (IFrame Player API) đặt khít vào màn hình rạp. Không che, không chặn quảng cáo:
// mình chỉ ra lệnh tải / phát / dừng / tua theo "đồng hồ phòng" của server (videoId + giờ server ứng với giây 0).
// Khung <iframe> do mình dựng (buildFrame) rồi giao cho API — YouTube chỉ biết gốc trang, không bao giờ biết đường dẫn /
// id phòng riêng (API tự dựng khung thì gắn cả location.href + document.referrer vào src).
// XEM CHUNG: hiện thanh điều khiển của YouTube (controls=1 — âm lượng, nút CC để mỗi người tự bật / tắt phụ đề, chất
// lượng) nhưng tắt phím tắt (disablekb=1). YouTube không cho ẩn riêng thanh tua / nút dừng, nên luật xem chung giữ bằng
// cách đưa về giờ chung: kéo thanh tua → về đúng giờ của cả rạp trong ~0,5 s; đổi tốc độ → về 1×; nhắc nhẹ (thưa).
// Bấm dừng: phòng chung → chạy lại ngay, về giờ chung (luật xem chung của rạp — chữ nhắc giải thích, muốn xem riêng thì
// bấm logo YouTube); PHÒNG RIÊNG → dừng riêng trên máy mình được giữ nguyên (phòng riêng có nút ⏸ dừng cho cả phòng DƯỚI
// màn hình nên không ép phát lại — can thiệp vào trình phát ít nhất có thể), bấm ▶ là xem tiếp đúng giờ chung. Lỡ bấm
// video gợi ý → KHÔNG tự quay lại (chính sách YouTube cấm chặn link video liên quan): hiện nút "↩ Về video của rạp" dưới
// màn hình. Lệch > 1 s (kể cả xem quảng cáo xong) cũng tự tua về. Phòng chung: chỉ admin dừng được cả phòng. Live thì
// theo đầu live. Lỗi 100/101/150 → báo server.
import { send } from './net.js';
import { store } from './store.js';

const DRIFT_MAX = 1.0; // giây
const SEEK_GAP_MS = 2500; // không tua dồn dập (đang quảng cáo thì lệnh tua bị bỏ qua — thử lại sau, giãn dần)
const HINT_GAP_MS = 45_000; // nhắc "rạp xem chung" tối đa 1 lần / 45 s
const SHARED_HINT = 'Rạp đang xem chung — tua, dừng hay đổi tốc độ sẽ tự về giờ chung (luật của rạp). Muốn xem riêng thì bấm logo YouTube.';
const PRIVATE_HINT = 'Phòng riêng xem chung — tua / đổi tốc độ sẽ về giờ chung. Bấm ⏸ để dừng cho cả phòng.';
const LOCAL_PAUSE_HINT = 'Bạn đang dừng riêng — bấm ⏸ dưới màn hình để dừng cho cả phòng, ▶ trên video để xem tiếp đúng giờ chung.';
const API_RETRY_MS = 20_000; // tải IFrame API lỗi (chặn quảng cáo / mất mạng) → thử lại sau
const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

let apiPromise = null;
let apiFailedAt = 0;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  if (apiFailedAt && performance.now() - apiFailedAt < API_RETRY_MS) return Promise.reject(new Error('đang chờ thử lại'));
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { prev?.(); } catch { /* bỏ qua */ }
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; apiFailedAt = performance.now(); s.remove(); reject(new Error('Không tải được YouTube IFrame API')); };
    document.head.append(s);
  });
  return apiPromise;
}

export function createPlayer(slotEl, hostEl, hooks = {}) {
  let player = null;
  let ready = false;
  let creating = false;
  let curV = '';
  let curQid = 0;
  let lastSeek = 0;
  let seekFails = 0;
  let userPaused = false;
  let weCommanded = 0; // mốc lệnh pause/play do mình gửi (để phân biệt người xem tự bấm dừng)
  let needsTap = false;
  let muted = false;
  let errorFor = '';
  let startTimer = 0;
  let playAskedAt = 0;
  let timer = 0;
  let lastState = YT_STATE.UNSTARTED;
  let enabled = false;
  let apiWarned = false;
  // trình duyệt tự tắt tiếng lúc tự phát: null = chưa biết, true = mời "🔊 Bật tiếng", false = thôi (đã bật / tự chọn tắt sau)
  let autoMuted = null;
  let firstPlay = false; // vừa tải bài: lần PLAYING đầu tiên tua lại cho thật khớp (bù thời gian tải ~0,5–1,5 s)
  let loadedLive = false; // bài đang nạp theo kiểu live (không tua)
  let durProbe = null; // đo độ dài video "chưa rõ thời lượng": { qid, d, cur, at }
  let durSentQid = -1;
  const hintAt = new Map(); // chữ nhắc → lần nhắc gần nhất
  let lastPos = null; // { cur, at } lần đo trước — nhận ra người xem tự kéo thanh tua
  // người xem bấm video gợi ý của YouTube: khung đang phát video KHÁC video của rạp → không điều khiển trình phát nữa (không
  // tự quay lại, kể cả khi rạp sang bài mới), chỉ hiện nút "↩ Về video của rạp" (main.js) tới khi họ bấm / tự quay về
  let offVideo = false;
  let visFsAt = -Infinity; // lúc vừa đổi toàn màn hình / ẩn hiện trang (trình duyệt có thể tự dừng video lúc đó)
  let roomWasPaused = false; // lần sync trước cả phòng đang dừng

  /** nhắc nhẹ (mỗi câu tối đa 1 lần / `gap` ms) */
  function hint(text, gap = HINT_GAP_MS) {
    const t = performance.now();
    if (t - (hintAt.get(text) ?? -Infinity) < gap) return;
    hintAt.set(text, t);
    hooks.onHint?.(text);
  }
  /** nhắc luật xem chung khi tua / đổi tốc độ (phòng riêng: chỉ cách dừng cho cả phòng) */
  const hintShared = () => hint(store.inPrivate() ? PRIVATE_HINT : SHARED_HINT);

  const status = () => ({ ready, enabled, needsTap, askUnmute: autoMuted === true, userPaused, offVideo, error: errorFor && errorFor === curV, state: lastState });
  const changed = () => hooks.onStatus?.(status());

  function targetSec() {
    const n = store.now;
    if (!n) return 0;
    if (n.paused) return Math.max(0, Number(n.pos) || 0);
    return (store.serverNow() - n.at) / 1000;
  }

  /**
   * Khung <iframe> của trình phát do MÌNH dựng (cách "tự viết thẻ iframe" có trong tài liệu IFrame Player API: src
   * /embed/?enablejsapi=1&origin=…, rồi new YT.Player(iframe, { events })). Khi API tự dựng khung (truyền thẻ div), nó gắn
   * thêm forigin = location.href và gporigin = document.referrer vào src → YouTube biết cả địa chỉ trang (vd id phòng
   * riêng). Tự dựng thì src giữ đúng như dưới: chỉ gốc trang (origin, widget_referrer), không gì khác của trang.
   * Tham số trình phát giữ như cũ: hiện thanh điều khiển YouTube (nút CC phụ đề, chất lượng), tắt phím tắt trong khung,
   * ẩn nút toàn màn hình của YouTube (rạp có nút riêng), không gợi ý video kênh khác. Tua / dừng / tốc độ riêng tự về giờ
   * chung (onState, sync, onPlaybackRateChange).
   */
  function buildFrame(host) {
    const q = new URLSearchParams({
      autoplay: '1', controls: '1', disablekb: '1', playsinline: '1', rel: '0', fs: '0', enablejsapi: '1',
      origin: location.origin, widget_referrer: `${location.origin}/`,
    });
    const f = document.createElement('iframe');
    f.id = hostEl.id || 'yt-host';
    f.title = 'Trình phát YouTube';
    f.width = '100%';
    f.height = '100%';
    f.setAttribute('frameborder', '0');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    // YouTube cần Referer (thiếu là lỗi 153) — chỉ gửi gốc trang, không bao giờ cả đường dẫn
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.src = `${host}/embed/?${q}`;
    return f;
  }

  async function ensurePlayer() {
    if (player || creating) return;
    creating = true;
    let frame = null;
    try {
      const YT = await loadApi();
      const host = store.cfg.noCookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com';
      frame = buildFrame(host);
      const loaded = new Promise((res) => { frame.addEventListener('load', res, { once: true }); setTimeout(res, 10_000); });
      hostEl.replaceWith(frame);
      // giao khung cho API khi trang nhúng của YouTube đã tải (API nhắn vào khung ngay — khung còn trống thì trình duyệt báo
      // lỗi "target origin không khớp"); mạng chậm quá 10 s thì vẫn giao (API tự nhắn lại tới khi khung trả lời)
      await loaded;
      player = new YT.Player(frame, {
        events: {
          onReady: () => { ready = true; cmd(() => player.unMute()); changed(); sync(true); },
          onStateChange: (e) => onState(e.data),
          onError: (e) => onError(e.data),
          // đổi tốc độ trong nút ⚙ của YouTube → về 1× (xem chung)
          onPlaybackRateChange: (e) => {
            const n = store.now;
            if (n && !n.live && e.data !== 1 && !offVideo) { cmd(() => player.setPlaybackRate(1)); hintShared(); }
          },
          onAutoplayBlocked: () => { needsTap = true; changed(); },
        },
      });
    } catch (e) {
      // dựng trình phát hỏng: trả lại chỗ trống ban đầu (lần thử sau dựng khung mới)
      if (frame && !player) { frame.replaceWith(hostEl); }
      if (!apiWarned) {
        apiWarned = true;
        console.warn('[rạp] YouTube API lỗi', e);
        hooks.onNotice?.('Không tải được trình phát YouTube (mạng / trình chặn quảng cáo?) — rạp sẽ tự thử lại.');
      }
    } finally {
      creating = false;
    }
  }

  function onState(s) {
    lastState = s;
    if (s === YT_STATE.PLAYING) {
      needsTap = false;
      const n = store.now;
      if (userPaused) {
        // vừa chạy lại sau khi người xem tự dừng: về đúng giờ chung ngay (phòng riêng xem live: nạp lại theo đầu live)
        userPaused = false;
        lastSeek = 0;
        if (n && n.live && store.inPrivate() && !offVideo) { load(n); changed(); } else sync(true);
      }
      readMuted();
      if (firstPlay && n && !n.live && !n.paused) {
        firstPlay = false;
        try {
          const drift = player.getCurrentTime() - targetSec();
          if (Math.abs(drift) > 0.6) { lastSeek = performance.now(); cmd(() => player.seekTo(Math.max(0, targetSec() + 0.35), true)); }
        } catch { /* bỏ qua */ }
      }
    } else if (s === YT_STATE.PAUSED) {
      const n = store.now;
      // phòng đang chiếu mà máy này bị dừng, không phải lệnh của mình (người xem bấm dừng / lỡ bấm vào video).
      // (Không chặn bấm vào khung YouTube: chính sách YouTube cấm chặn chức năng / link / quảng cáo của trình phát.)
      const now = performance.now();
      if (n && !n.paused && !offVideo && !document.hidden && now - weCommanded > 400) {
        if (!store.inPrivate()) {
          // phòng chung: chạy lại NGAY, lặng lẽ, tua về đúng giờ chung (luật xem chung của rạp)
          userPaused = true;
          cmd(() => player.playVideo());
          hint(SHARED_HINT);
        } else if (now - visFsAt > 1000) {
          // phòng riêng: dừng riêng được GIỮ (sync() không tự phát lại) — bấm ▶ trên video là xem tiếp đúng giờ chung.
          // Dừng ngay sau khi đổi toàn màn hình / ẩn hiện trang là trình duyệt tự dừng → để sync() phát lại như thường.
          userPaused = true;
          hint(LOCAL_PAUSE_HINT, 15_000);
        }
      }
    }
    changed();
  }

  /** đọc trạng thái tắt tiếng của trình phát (người xem chỉnh bằng thanh điều khiển YouTube) */
  function readMuted() {
    let m = muted;
    try { m = !!player.isMuted(); } catch { return; }
    if (m === muted && autoMuted !== null) return;
    muted = m;
    if (autoMuted === null) autoMuted = m; // lần phát đầu mà đã bị tắt tiếng = trình duyệt tự tắt
    else if (!m) autoMuted = false;
    changed();
  }

  function onError(code) {
    if (!curV || offVideo) return; // lỗi của video gợi ý người xem tự bấm — không phải video của rạp
    errorFor = curV;
    console.warn('[rạp] trình phát lỗi', code);
    // 153 = trang nhúng thiếu Referer (lỗi cấu hình của mình, không phải của video) → không báo server
    if ([2, 100, 101, 150].includes(code)) send({ t: 'vid_err', v: curV, code });
    else if (code === 153) hooks.onNotice?.('Trình phát YouTube báo lỗi cấu hình (mã 153) — tải lại trang thử nhé.');
    changed();
  }

  /**
   * Đo độ dài video `unk` bằng hàm có tài liệu của IFrame API (getDuration / getCurrentTime): 2 lần cách ≥ 4 s, chỉ khi
   * nội dung thật sự đang chạy (giờ video tăng ≥ 2 s — không phải quảng cáo / đứng hình). Độ dài tăng dần = phát trực
   * tiếp (với live, getDuration trả thời gian đã phát từ lúc bắt đầu luồng). Báo server một lần mỗi bài.
   */
  function probeDuration(n, cur, now) {
    if (durSentQid === n.qid) return;
    let d = 0;
    try { d = player.getDuration() || 0; } catch { return; }
    if (!(d > 0) || !(cur > 1)) return;
    const m = durProbe;
    if (!m || m.qid !== n.qid) { durProbe = { qid: n.qid, d, cur, at: now }; return; }
    if (now - m.at < 4000) return;
    durProbe = { qid: n.qid, d, cur, at: now };
    if (cur - m.cur < 2) return;
    const live = d - m.d > 1.5;
    if (!live && Math.abs(d - m.d) > 1) return;
    durSentQid = n.qid;
    send({ t: 'vid_dur', v: n.v, d: Math.round(d), live });
  }

  function cmd(fn) {
    weCommanded = performance.now();
    try { fn(); } catch { /* trình phát chưa sẵn sàng */ }
  }

  function load(n) {
    curV = n.v;
    curQid = n.qid;
    userPaused = false;
    offVideo = false;
    roomWasPaused = false;
    errorFor = '';
    seekFails = 0;
    lastSeek = performance.now();
    firstPlay = !n.live;
    loadedLive = !!n.live;
    durProbe = null;
    clearTimeout(startTimer);
    const t = targetSec();
    if (document.hidden) {
      // tab đang ẩn: chỉ nạp sẵn, KHÔNG tự phát (chính sách YouTube: chỉ tự phát khi trình phát đang hiện);
      // quay lại tab → sync() thấy CUED → tua đúng giờ chung rồi phát
      cmd(() => player.cueVideoById({ videoId: n.v, startSeconds: Math.max(0, t) }));
    } else if (n.live) {
      cmd(() => player.loadVideoById({ videoId: n.v }));
    } else if (t < -0.3) {
      // bài mới, chưa tới giây 0: tải sẵn, đúng giờ mới phát (mọi máy bắt đầu cùng lúc)
      cmd(() => player.cueVideoById({ videoId: n.v, startSeconds: 0 }));
      startTimer = setTimeout(() => {
        if (curQid === n.qid && store.now && !store.now.paused && !document.hidden) { playAskedAt = performance.now(); cmd(() => player.playVideo()); }
      }, -t * 1000);
    } else {
      cmd(() => player.loadVideoById({ videoId: n.v, startSeconds: Math.max(0, t) }));
      playAskedAt = performance.now();
    }
  }

  /** id video đang nằm trong khung (theo URL của trình phát) */
  function playingId() {
    let url = '';
    try { url = player.getVideoUrl() || ''; } catch { return null; }
    return /[?&]v=([A-Za-z0-9_-]{11})/.exec(url)?.[1] || '';
  }

  /** chạy mỗi 500 ms + khi đổi bài */
  function sync(force = false) {
    const n = store.now;
    // người xem đang xem video gợi ý của YouTube (tự bấm trong khung): KHÔNG đụng tới trình phát — không nạp bài mới của rạp,
    // không dừng / tua / ẩn khung (chính sách YouTube: không chặn link video liên quan). Chờ họ bấm "↩ Về video của rạp"
    // (backToRoom) hoặc tự quay về đúng video của rạp
    if (offVideo && enabled && player && ready) {
      slotEl.hidden = false;
      const id = playingId();
      if (id === null || id !== curV) return;
      offVideo = false;
      lastSeek = 0;
      changed();
    }
    slotEl.hidden = !enabled || !n;
    if (!enabled) return;
    if (!n) {
      if (curV && player && ready) cmd(() => player.stopVideo());
      curV = ''; curQid = 0;
      changed();
      return;
    }
    if (!player) { ensurePlayer(); return; }
    if (!ready) return;
    if (n.qid !== curQid || n.v !== curV) { load(n); changed(); return; }
    if (errorFor === curV) return;
    let state = YT_STATE.UNSTARTED, cur = 0;
    try { state = player.getPlayerState(); cur = player.getCurrentTime() || 0; } catch { return; }
    const target = targetSec();
    const now = performance.now();
    // bấm video gợi ý ("More videos" / màn hình cuối) → khung đang phát video khác. KHÔNG tự quay lại (chính sách YouTube:
    // không chặn link video liên quan) — từ giờ để yên trình phát (đầu hàm), main.js hiện "↩ Về video của rạp" ngoài khung
    // video. (Chỉ xét khi đã phát ổn định > 3 s sau lần nạp / tua gần nhất — ngay sau loadVideoById URL có thể chưa đổi.)
    const id = playingId();
    if (id && id !== curV && state === YT_STATE.PLAYING && now - lastSeek > 3000) {
      offVideo = true;
      userPaused = false;
      changed();
      return;
    }
    // phòng riêng: người xem tự dừng trên thanh YouTube → giữ nguyên (không tự phát lại, không tua) tới khi họ bấm ▶
    if (userPaused && !n.paused && state === YT_STATE.PAUSED && store.inPrivate()) return;
    if (n.paused) {
      userPaused = false; // cả phòng đang dừng: dừng riêng gộp vào — phòng phát tiếp thì máy này phát theo
      roomWasPaused = true;
      if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) cmd(() => player.pauseVideo());
      if (Math.abs(cur - target) > DRIFT_MAX) cmd(() => player.seekTo(target, true));
      return;
    }
    // phòng vừa phát tiếp (phòng riêng ai cũng dừng / phát tiếp được, có khi chỉ sau vài giây): xin phát NGAY, không chờ
    // nhịp 2,5 s — và không tưởng nhầm là trình duyệt chặn tự phát
    if (roomWasPaused) { roomWasPaused = false; playAskedAt = 0; }
    if (target < -0.3) return; // đang chờ tới giây 0
    if (state === YT_STATE.CUED || state === YT_STATE.UNSTARTED || state === YT_STATE.PAUSED) {
      if (document.hidden) return; // chỉ bắt đầu phát khi trình phát đang hiện trên màn hình
      if (now - playAskedAt > 2500) {
        playAskedAt = now;
        if (!n.live && Math.abs(cur - target) > DRIFT_MAX) cmd(() => player.seekTo(Math.max(0, target), true));
        cmd(() => player.playVideo());
      } else if (now - playAskedAt > 2000 && state !== YT_STATE.PLAYING) {
        needsTap = true; // trình duyệt chặn tự phát (thường gặp trên iPhone): nhờ người xem chạm
        changed();
      }
      return;
    }
    if (state === YT_STATE.ENDED) {
      if (!n.live && target < n.dur - 2) cmd(() => { player.seekTo(target, true); player.playVideo(); });
      return;
    }
    // video "chưa rõ thời lượng" (rạp kiểm cơ bản, không có API key): đo độ dài thật bằng trình phát rồi báo server
    if (n.unk && state === YT_STATE.PLAYING) probeDuration(n, cur, now);
    if (n.live) {
      // server vừa xác định bài này là phát trực tiếp (máy người xem báo) → nạp lại để theo đầu live, thôi tua
      if (!loadedLive) { load(n); changed(); }
      return; // live: YouTube tự giữ đầu live
    }
    if (state === YT_STATE.PLAYING) {
      readMuted(); // người xem bật / tắt tiếng bằng thanh của YouTube
      // người xem tự kéo thanh tua: giờ video nhảy tới nhanh hơn thời gian thật > 3 s, hoặc lùi > 3 s, so với lần đo trước
      // (không phải lệnh tua của mình). Quảng cáo / mạng tải chậm chỉ làm video chạy CHẬM hơn thời gian thật → không nhầm.
      // → về giờ chung ngay + nhắc
      const prev = lastPos;
      lastPos = { cur, at: now, qid: n.qid };
      if (prev && prev.qid === n.qid && now - lastSeek > 1500 && Math.abs(cur - target) > DRIFT_MAX) {
        const moved = cur - prev.cur;
        if (moved > (now - prev.at) / 1000 + 3 || moved < -3) {
          hintShared();
          force = true;
          seekFails = 0;
        }
      }
      const drift = cur - target;
      const gap = SEEK_GAP_MS * Math.min(4, 1 + seekFails);
      if (Math.abs(drift) > DRIFT_MAX && (force || now - lastSeek > gap)) {
        // lần tua trước không ăn (đang quảng cáo?) → giãn nhịp tua để không phá quảng cáo
        if (now - lastSeek < gap * 2) seekFails++; else seekFails = 0;
        lastSeek = now;
        cmd(() => player.seekTo(Math.max(0, Math.min(target, n.dur ? n.dur - 0.5 : target)), true));
      } else if (Math.abs(drift) <= DRIFT_MAX) seekFails = 0;
    }
  }

  let visHooked = false;
  // trình duyệt hay tự dừng video lúc đổi toàn màn hình / ẩn hiện trang — không coi là người xem bấm dừng
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'visibilitychange']) {
    document.addEventListener(ev, () => { visFsAt = performance.now(); });
  }

  return {
    /** bật trình phát (sau khi người xem bấm "Vào rạp" — có thao tác người dùng thì trình duyệt cho phát có tiếng) */
    enable() {
      if (enabled) return;
      enabled = true;
      ensurePlayer();
      sync(true);
      clearInterval(timer);
      timer = setInterval(() => sync(false), 500);
      if (!visHooked) {
        visHooked = true; // chỉ gắn một lần (vào lại rạp nhiều lần không nhân bộ nghe)
        document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled) { playAskedAt = 0; sync(true); } });
      }
    },
    sync: () => sync(true),
    /** tắt hẳn trình phát (bị mời ra / phải vào lại): dừng phát + ẩn khung, không để video chạy dưới lớp phủ */
    disable() {
      if (!enabled) return;
      enabled = false;
      clearInterval(timer);
      clearTimeout(startTimer);
      if (player && ready) cmd(() => player.stopVideo());
      curV = ''; curQid = 0;
      offVideo = false;
      userPaused = false;
      slotEl.hidden = true;
      changed();
    },
    /** toàn màn hình cho khung video (nút toàn màn hình của YouTube đã ẩn: fs=0) */
    fullscreen() {
      const el = slotEl;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        try { const pr = req.call(el); pr?.catch?.(() => { /* bị từ chối */ }); } catch { /* bỏ qua */ }
      } else {
        const f = el.querySelector('iframe');
        f?.webkitEnterFullscreen?.();
      }
    },
    /** người xem bấm nút "▶ Xem cùng mọi người" / "🔊 Bật tiếng" (nằm NGOÀI khung video) */
    userPlay() {
      if (!player || !ready) return;
      if (offVideo) { cmd(() => player.unMute()); autoMuted = false; muted = false; changed(); return; } // đang ở video gợi ý: chỉ bật tiếng
      needsTap = false;
      userPaused = false;
      lastSeek = 0;
      cmd(() => player.unMute());
      autoMuted = false;
      const n = store.now;
      if (n && !n.paused) {
        const t = targetSec();
        if (!n.live && t > 0) cmd(() => player.seekTo(t, true));
        cmd(() => player.playVideo());
      }
      muted = false;
      changed();
    },
    /** nút "↩ Về video của rạp" (ngoài khung video): người xem đang ở video gợi ý → nạp video rạp đúng giờ chung */
    backToRoom() {
      if (!player || !ready) return;
      offVideo = false;
      if (store.now) { load(store.now); changed(); return; }
      cmd(() => player.stopVideo()); // rạp đang không chiếu gì: về màn hình trống của rạp
      curV = ''; curQid = 0;
      sync(true);
    },
    status,
    get enabled() { return enabled; },
    /** cho QA headless: vị trí hiện tại so với đồng hồ phòng */
    debug() {
      try {
        return { v: curV, state: player?.getPlayerState?.(), cur: player?.getCurrentTime?.(), target: targetSec(), muted: player?.isMuted?.() };
      } catch { return { v: curV }; }
    },
  };
}
