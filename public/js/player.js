// Trình phát YouTube CHÍNH THỨC (IFrame Player API) đặt khít vào màn hình rạp. Không che, không chặn quảng cáo:
// mình chỉ ra lệnh tải / phát / dừng / tua theo "đồng hồ phòng" của server (videoId + giờ server ứng với giây 0).
// XEM CHUNG: hiện thanh điều khiển của YouTube (controls=1 — có nút CC để mỗi người tự bật / tắt phụ đề, chọn chất
// lượng) nhưng tắt phím tắt (disablekb=1). YouTube không cho ẩn riêng thanh tua / nút dừng, nên luật xem chung giữ bằng
// cách đưa về giờ chung: bấm dừng → chạy lại ngay; kéo thanh tua → về đúng giờ của cả rạp trong ~0,5 s; đổi tốc độ → về
// 1×; lần đầu thử thì nhắc nhẹ. Lệch > 1 s (kể cả xem quảng cáo xong) cũng tự tua về. Âm lượng + toàn màn hình rạp là nút
// riêng DƯỚI màn hình. Chỉ admin dừng được cả phòng. Live thì theo đầu live. Lỗi 100/101/150 → báo server.
import { send } from './net.js';
import { store } from './store.js';
import { lsGet, lsSet } from './util.js';

const DRIFT_MAX = 1.0; // giây
const SEEK_GAP_MS = 2500; // không tua dồn dập (đang quảng cáo thì lệnh tua bị bỏ qua — thử lại sau, giãn dần)
const HINT_GAP_MS = 45_000; // nhắc "rạp xem chung" tối đa 1 lần / 45 s
const SHARED_HINT = 'Rạp đang xem chung — không tua, dừng hay đổi tốc độ riêng được: video tự về đúng giờ của cả rạp.';
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
  let loadedLive = false; // bài đang nạp theo kiểu live (không tua)
  let durProbe = null; // đo độ dài video "chưa rõ thời lượng": { qid, d, cur, at }
  let durSentQid = -1;
  let hintAt = -Infinity;
  let lastPos = null; // { cur, at } lần đo trước — nhận ra người xem tự kéo thanh tua

  /** nhắc luật xem chung (thưa thôi) */
  function hintShared() {
    const t = performance.now();
    if (t - hintAt < HINT_GAP_MS) return;
    hintAt = t;
    hooks.onHint?.(SHARED_HINT);
  }

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
          // thanh điều khiển YouTube hiện (nút CC phụ đề, chất lượng); tắt phím tắt trong khung; nút toàn màn hình của
          // YouTube ẩn (rạp có nút riêng). Tua / dừng / tốc độ riêng tự về giờ chung (onState, sync, onPlaybackRateChange)
          autoplay: 1, controls: 1, disablekb: 1, playsinline: 1, rel: 0, fs: 0, enablejsapi: 1,
          origin: location.origin, widget_referrer: location.href,
        },
        events: {
          onReady: () => { ready = true; applyVolume(); changed(); sync(true); },
          onStateChange: (e) => onState(e.data),
          onError: (e) => onError(e.data),
          // đổi tốc độ trong nút ⚙ của YouTube → về 1× (xem chung)
          onPlaybackRateChange: (e) => {
            const n = store.now;
            if (n && !n.live && e.data !== 1) { cmd(() => player.setPlaybackRate(1)); hintShared(); }
          },
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
        hintShared();
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
    let state = YT_STATE.UNSTARTED, cur = 0, url = '';
    try { state = player.getPlayerState(); cur = player.getCurrentTime() || 0; url = player.getVideoUrl() || ''; } catch { return; }
    const target = targetSec();
    const now = performance.now();
    // lỡ bấm video gợi ý ("More videos" / màn hình cuối) → khung đang phát video khác → quay về video của rạp
    // (chỉ xét khi đã phát ổn định > 3 s sau lần nạp / tua gần nhất — ngay sau loadVideoById URL có thể chưa đổi)
    const playingId = /[?&]v=([A-Za-z0-9_-]{11})/.exec(url)?.[1];
    if (playingId && playingId !== curV && state === YT_STATE.PLAYING && now - lastSeek > 3000) { hintShared(); load(n); changed(); return; }
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
    // video "chưa rõ thời lượng" (rạp kiểm cơ bản, không có API key): đo độ dài thật bằng trình phát rồi báo server
    if (n.unk && state === YT_STATE.PLAYING) probeDuration(n, cur, now);
    if (n.live) {
      // server vừa xác định bài này là phát trực tiếp (máy người xem báo) → nạp lại để theo đầu live, thôi tua
      if (!loadedLive) { load(n); changed(); }
      return; // live: YouTube tự giữ đầu live
    }
    if (state === YT_STATE.PLAYING) {
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
