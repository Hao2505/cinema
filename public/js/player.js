// Trình phát YouTube CHÍNH THỨC (IFrame Player API) đặt khít vào màn hình rạp. Không che, không chặn quảng cáo:
// mình chỉ ra lệnh tải / phát / dừng / tua theo "đồng hồ phòng" của server (videoId + giờ server ứng với giây 0).
// XEM CHUNG: ẩn thanh điều khiển (controls=0, disablekb=1) — không ai tua / dừng riêng được; lỡ dừng (bấm vào video)
// hay lệch > 1 s là tự chạy lại / tua về đúng giờ chung (kể cả lúc xem quảng cáo xong). Âm lượng + toàn màn hình là nút
// riêng nằm DƯỚI màn hình. Chỉ admin dừng được cả phòng. Live thì theo đầu live. Lỗi 100/101/150 → báo server.
import { send } from './net.js';
import { store } from './store.js';
import { lsGet, lsSet } from './util.js';

const DRIFT_MAX = 1.0; // giây
const SEEK_GAP_MS = 2500; // không tua dồn dập (đang quảng cáo thì lệnh tua bị bỏ qua — thử lại sau, giãn dần)
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
  let volume = Math.max(0, Math.min(100, Number(lsGet('vc.vol', '100')) || 0));
  let wantMuted = lsGet('vc.muted', '0') === '1';
  let firstPlay = false; // vừa tải bài: lần PLAYING đầu tiên tua lại cho thật khớp (bù thời gian tải ~0,5–1,5 s)

  const status = () => ({ ready, enabled, needsTap, muted, userPaused, error: errorFor && errorFor === curV, state: lastState });
  const changed = () => hooks.onStatus?.(status());

  function targetSec() {
    const n = store.now;
    if (!n) return 0;
    if (n.paused) return Math.max(0, Number(n.pos) || 0);
    return (store.serverNow() - n.at) / 1000;
  }

  async function ensurePlayer() {
    if (player || creating) return;
    creating = true;
    try {
      const YT = await loadApi();
      const host = store.cfg.noCookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com';
      player = new YT.Player(hostEl, {
        host,
        width: '100%',
        height: '100%',
        playerVars: {
          // xem chung: ẩn thanh tua / dừng của YouTube + tắt phím tắt trong khung (tham số chính thức của IFrame API)
          autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, enablejsapi: 1,
          origin: location.origin, widget_referrer: location.href,
        },
        events: {
          onReady: () => { ready = true; applyVolume(); changed(); sync(true); },
          onStateChange: (e) => onState(e.data),
          onError: (e) => onError(e.data),
          onAutoplayBlocked: () => { needsTap = true; changed(); },
        },
      });
    } catch (e) {
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
      if (userPaused) { userPaused = false; lastSeek = 0; sync(true); } // vừa chạy lại: tua về đúng chỗ ngay
      try { muted = !!player.isMuted(); } catch { /* bỏ qua */ }
      const n = store.now;
      if (firstPlay && n && !n.live && !n.paused) {
        firstPlay = false;
        try {
          const drift = player.getCurrentTime() - targetSec();
          if (Math.abs(drift) > 0.6) { lastSeek = performance.now(); cmd(() => player.seekTo(Math.max(0, targetSec() + 0.35), true)); }
        } catch { /* bỏ qua */ }
      }
    } else if (s === YT_STATE.PAUSED) {
      const n = store.now;
      // xem chung: phòng đang chiếu mà máy này bị dừng (lỡ bấm vào video) → chạy lại NGAY, lặng lẽ, tua về đúng giờ chung.
      // (Không chặn bấm vào khung YouTube: chính sách YouTube cấm chặn chức năng / link / quảng cáo của trình phát.)
      if (n && !n.paused && !document.hidden && performance.now() - weCommanded > 400) {
        userPaused = true;
        cmd(() => player.playVideo());
      }
    }
    changed();
  }

  function applyVolume() {
    if (!player || !ready) return;
    cmd(() => { player.setVolume(volume); if (wantMuted || volume === 0) player.mute(); else player.unMute(); });
    muted = wantMuted || volume === 0;
  }

  function onError(code) {
    if (!curV) return;
    errorFor = curV;
    console.warn('[rạp] trình phát lỗi', code);
    // 153 = trang nhúng thiếu Referer (lỗi cấu hình của mình, không phải của video) → không báo server
    if ([2, 100, 101, 150].includes(code)) send({ t: 'vid_err', v: curV, code });
    else if (code === 153) hooks.onNotice?.('Trình phát YouTube báo lỗi cấu hình (mã 153) — tải lại trang thử nhé.');
    changed();
  }

  function cmd(fn) {
    weCommanded = performance.now();
    try { fn(); } catch { /* trình phát chưa sẵn sàng */ }
  }

  function load(n) {
    curV = n.v;
    curQid = n.qid;
    userPaused = false;
    errorFor = '';
    seekFails = 0;
    lastSeek = performance.now();
    firstPlay = !n.live;
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

  /** chạy mỗi 500 ms + khi đổi bài */
  function sync(force = false) {
    const n = store.now;
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
    if (n.paused) {
      if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) cmd(() => player.pauseVideo());
      if (Math.abs(cur - target) > DRIFT_MAX) cmd(() => player.seekTo(target, true));
      return;
    }
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
    if (n.live) return; // live: YouTube tự giữ đầu live
    if (state === YT_STATE.PLAYING) {
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

  return {
    /** bật trình phát (sau khi người xem bấm "Vào rạp" — có thao tác người dùng thì trình duyệt cho phát có tiếng) */
    enable() {
      if (enabled) return;
      enabled = true;
      ensurePlayer();
      sync(true);
      clearInterval(timer);
      timer = setInterval(() => sync(false), 500);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && enabled) { playAskedAt = 0; sync(true); } });
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
      slotEl.hidden = true;
      changed();
    },
    /** âm lượng 0–100 (nút riêng dưới màn hình) */
    setVolume(v) {
      volume = Math.max(0, Math.min(100, Math.round(v)));
      wantMuted = volume === 0;
      lsSet('vc.vol', volume);
      lsSet('vc.muted', wantMuted ? '1' : '0');
      applyVolume();
      changed();
    },
    toggleMute() {
      wantMuted = !(wantMuted || volume === 0);
      if (!wantMuted && volume === 0) volume = 60;
      lsSet('vc.muted', wantMuted ? '1' : '0');
      lsSet('vc.vol', volume);
      applyVolume();
      changed();
    },
    get volume() { return volume; },
    get muted() { return wantMuted || volume === 0; },
    /** toàn màn hình cho khung video (không có nút của YouTube vì đã ẩn điều khiển) */
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
      needsTap = false;
      userPaused = false;
      lastSeek = 0;
      wantMuted = false;
      if (volume === 0) volume = 60;
      applyVolume();
      const n = store.now;
      if (n && !n.paused) {
        const t = targetSec();
        if (!n.live && t > 0) cmd(() => player.seekTo(t, true));
        cmd(() => player.playVideo());
      }
      muted = false;
      changed();
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
