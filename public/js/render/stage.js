// Bộ máy canvas của rạp — phối cảnh một điểm tụ (render/persp.js): nhìn từ cuối rạp lên màn hình. Màn chiếu nằm trên
// tường cuối song song mặt nhìn → khung YouTube là hình chữ nhật không méo, đặt khít vào màn hình vẽ trên canvas.
// Lớp: dải màn hình (cố định) → phòng (sàn + tường + sân khấu, cache theo camera) → vật thể sắp theo độ sâu (hàng ghế,
// loa, quầy bar, nhân vật — càng gần màn hình càng nhỏ) → ánh sáng → chữ / bong bóng / emoji (luôn dưới mép màn hình).
// Máy tính: camera đứng yên thấy cả rạp. Điện thoại: camera lia theo nhân vật mình, chụm hai ngón để phóng.
// Canvas phủ cả cửa sổ; giao diện nổi (cụm nút góc trên, dock dưới, ngăn kéo phải) báo chỗ chiếm qua setInsets() →
// màn hình video tự lùi xuống dưới cụm nút góc trên và căn giữa phần còn trống bên trái ngăn kéo: không gì đè lên video.
import { HALL, SEATS, seatAt } from '../shared/hall.js';
import { store, actorPos, spawnFx, tickNet } from '../store.js';
import { me, myRenderPos } from '../me.js';
import { clamp, lerp, safeColor, easeOutCubic } from '../util.js';
import { drawCharacter, U, headTop, headCenter, HEAD_RADIUS, moodOf } from './character.js';
import { actionPose, ACTION_FX } from './anims.js';
import { drawBubbles, drawNamePill, measureNamePill, spreadPills, clearTextCache } from './bubbles.js';
import { drawIdleScreen, STAGE_H } from './hall.js';
import { defaultTheme, loadTheme } from './venues/index.js';
import { DIM_LEVELS, prefs, showActsFrom, showChatFrom, showPerson } from '../prefs.js';
import { projection } from './persp.js';
import { drawEmoji, makeCanvas } from './draw.js';

const W = HALL.W, H = HALL.H, WI = W - 2;
const R = 1.45; // tỉ lệ cỡ cuối rạp / mép sân khấu (độ mạnh phối cảnh)
const FAR = 1 - (1.2 * (R - 1)) / H; // s(tường cuối) / s(mép sân khấu)

export function createStage(canvas, slot, hooks = {}) {
  const ctx = canvas.getContext('2d');
  let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  let dprCap = 2.5;
  let cssW = 1, cssH = 1;
  let L = null; // bố cục
  let view = 'lon'; // góc xem: 'can' | 'lon' | 'rong'
  let V = defaultTheme; // chủ đề vẽ của rạp đang xem (render/venues)
  let wantVenue = V.id;
  // đổi rạp mượt: tối dần → đổi chủ đề (vẽ lại cache khi đang tối) → sáng dần. Mở trang: tối tới khi biết đúng rạp.
  let fadeA = 1, fadeTarget = 1, pendingTheme = null;
  let props = V.props(); // cây, cột đèn… sắp theo độ sâu cùng người
  let tex = null;
  let band = null, bandKey = '';
  let roomCv = null, roomKey = '';
  let rows = [], rowsKey = '';
  const cam = { xcam: W / 2, zoom: 1, follow: false };
  let P = null;
  let hits = [];
  let hoverId = 0;
  let lastNow = performance.now();
  let raf = 0;
  let quality = 0;
  let drawMs = 4, slowFrames = 0, fastFrames = 0;
  let frameMs = 16.7, lastFrameAt = 0; // nhịp khung thật (bắt cả máy chậm ở khâu tô điểm ảnh, không chỉ JS)
  let calmUntil = performance.now() + 6000; // bỏ qua lúc mới mở trang / vừa đổi bố cục (tải YouTube, vẽ lại cache)
  let dprDrops = 0;
  let crowd = false; // rạp đông: người đứng / ngồi yên vẽ từ sprite cache
  let dimA = 0; // độ tối phủ quanh video khi đang chiếu (chuyển dần)
  const spriteCache = new Map();
  const pointers = new Map();
  let pinch = null;
  let tap = null;
  // chỗ giao diện nổi chiếm (px CSS): right = ngăn kéo / tấm bên phải đang mở, bottom = dock dưới,
  // hudH = mép dưới cụm nút góc trên, hudL / hudR = bề ngang cụm trái / phải (tính từ mép vùng rạp)
  const insets = { right: 0, bottom: 0, hudH: 0, hudL: 0, hudR: 0 };

  // ---------------------------------------------------------------- bố cục
  function computeLayout() {
    const narrow = cssW < 720;
    // vùng dành cho rạp: trừ ngăn kéo bên phải; mép gần của khán phòng nằm trên dock (sàn vẫn vẽ tràn xuống dưới dock)
    const availW = Math.max(240, cssW - insets.right);
    const Yn = Math.max(cssH * 0.62, cssH - insets.bottom);
    const valance = narrow ? 12 : clamp(cssH * 0.03, 14, 26);
    const frame = narrow ? 4 : 6;
    // mặc định: chia cân video và khán phòng (rạp đông vẫn thoáng); 📺 Màn hình lớn: khán phòng gọn lại cho video to nhất
    // góc xem: cân = khán phòng rộng · lớn = video to · rộng = video to nhất, khán phòng mỏng
    const audMin = view === 'rong' ? (narrow ? 180 : clamp(Yn * 0.2, 150, 190))
      : view === 'lon' ? (narrow ? 210 : clamp(Yn * 0.3, 200, 260))
        : narrow ? Math.max(300, Yn * 0.5) : clamp(Yn * 0.38, 240, 340);
    const maxW = narrow ? availW - 16 : (availW - 70) / 1.2;
    const base = narrow ? 6 : 10;

    /** xếp màn hình bắt đầu ở `top`, rộng tối đa `mw` */
    function fit(top, mw) {
      let strip = narrow ? 46 : 60; // ước lượng khoảng màn hình → mép sân khấu
      let lay = null;
      for (let pass = 0; pass < 3; pass++) {
        let vh = Yn - audMin - top - valance - 2 * frame - strip;
        let vw = Math.min(mw, (vh * 16) / 9);
        vh = (vw * 9) / 16;
        // YouTube: trình phát tối thiểu 200×200 px — chạm mức này thì giữ đúng 16:9 (356×200) cho khỏi viền đen
        if (vh < 200) { vh = 200; vw = Math.min(Math.max(vw, 356), Math.max(200, availW - 8)); }
        if (vw < 200) vw = 200;
        vw = Math.round(vw); vh = Math.round(vh);
        const screen = { x: Math.round((availW - vw) / 2), y: Math.round(top + valance + frame), w: vw, h: vh };
        const vb = screen.y + vh + frame;
        // cỡ ô ở tường cuối: máy tính = tường cuối rộng hơn video chút (thấy tường hai bên chụm vào) nhưng hàng ghế cuối
        // vẫn lọt khung nhìn; điện thoại = tường cuối rộng hơn khung nhìn (nhân vật đủ to, camera lia theo người)
        const sw = narrow ? clamp(availW / 20, 18, 30) * FAR
          : Math.max(vw * 1.04, Math.min(availW - 40, vw * 1.2, (availW * 1.06 * FAR) / R)) / WI;
        const s0 = sw / FAR, s1 = s0 * R;
        const Yf = (vb + 1.05 * sw + (1.2 * Yn) / H) / (1 + 1.2 / H);
        lay = {
          narrow, valance, frame, screen, vb, w: cssW, h: cssH, availW, Xc: availW / 2, Yf, Yn, s0, s1, sw,
          audTop: Math.round(Yf - STAGE_H * s0), cs: narrow ? 0.95 : 0.85, fits: vw <= mw + 0.5,
        };
        const realStrip = Yf - vb;
        if (Math.abs(realStrip - strip) < 2) break;
        strip = realStrip;
      }
      return lay;
    }
    // A: màn hình sát mép trên, hẹp vừa đủ để hai cụm nút góc nằm hai bên (máy ngang / màn rộng)
    // B: màn hình lùi xuống dưới cụm nút (điện thoại dọc / cửa sổ hẹp) — chọn cách cho video to hơn
    const corner = Math.max(insets.hudL, insets.hudR);
    const a = fit(base, corner ? Math.min(maxW, availW - 2 * (corner + 6)) : maxW);
    const topB = Math.max(base, insets.hudH + 4 - valance - frame);
    if (topB <= base) return a;
    const b = fit(topB, maxW);
    return a.fits && a.screen.w >= b.screen.w ? a : b;
  }

  function placeSlot() {
    if (!slot || !L) return;
    const s = L.screen;
    const st = slot.style;
    const v = (n) => `${n}px`;
    if (st.left !== v(s.x)) st.left = v(s.x);
    if (st.top !== v(s.y)) st.top = v(s.y);
    if (st.width !== v(s.w)) st.width = v(s.w);
    if (st.height !== v(s.h)) st.height = v(s.h);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const nd = Math.max(1, Math.min(dprCap, window.devicePixelRatio || 1));
    if (w === cssW && h === cssH && nd === dpr && L) return false;
    cssW = w; cssH = h; dpr = nd;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    relayout();
    return true;
  }

  function relayout() {
    calmUntil = Math.max(calmUntil, performance.now() + 2500);
    L = computeLayout();
    placeSlot();
    bandKey = '';
    roomKey = '';
    rowsKey = '';
    spriteCache.clear();
    hooks.onLayout?.(L);
  }

  /** camera: máy tính đứng giữa; điện thoại lia ngang theo nhân vật mình (vùng chết 1,5 ô) */
  function updateCamera(myPos) {
    const narrow = L.narrow;
    const zoom = narrow ? cam.zoom : 1;
    let xcam = W / 2;
    if (narrow) {
      const halfVis = L.availW / 2 / (L.s1 * zoom);
      const maxPan = Math.max(0, WI / 2 + 0.4 - halfVis);
      cam.follow = maxPan > 0.05;
      if (cam.follow && myPos) {
        let target = cam.xcam;
        if (myPos.x > cam.xcam + 1.5) target = myPos.x - 1.5;
        else if (myPos.x < cam.xcam - 1.5) target = myPos.x + 1.5;
        cam.xcam = lerp(cam.xcam, clamp(target, W / 2 - maxPan, W / 2 + maxPan), 0.12);
      }
      cam.xcam = clamp(cam.xcam, W / 2 - maxPan, W / 2 + maxPan);
      xcam = Math.round(cam.xcam * 50) / 50; // lượng tử 0,02 ô: đứng yên thì không phải vẽ lại phòng
    } else {
      cam.follow = false;
      cam.xcam = W / 2;
    }
    P = projection({ Xc: L.Xc, Yf: L.Yf, Yn: L.Yn, s0: L.s0 * zoom, s1: L.s1 * zoom, H, xcam });
  }

  function ensureCaches() {
    if (!tex) tex = V.floorTexture(48);
    const lk = `${cssW}x${cssH}|${dpr}|${view}|${V.id}`;
    if (lk !== bandKey || !band) { band = V.renderBand(L, dpr); bandKey = lk; }
    const zoom = L.narrow ? cam.zoom : 1;
    const rk = `${lk}|${P.xcam}|${zoom.toFixed(3)}`;
    if (rk !== roomKey || !roomCv) {
      if (!roomCv || roomCv.width !== canvas.width || roomCv.height !== canvas.height) roomCv = makeCanvas(canvas.width, canvas.height);
      const rc = roomCv.getContext('2d');
      rc.setTransform(1, 0, 0, 1, 0, 0);
      rc.clearRect(0, 0, roomCv.width, roomCv.height);
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      V.drawRoom(rc, P, tex, L, dpr, Math.max(2, Math.round(dpr * (L.narrow ? 1.2 : 1))));
      roomKey = rk;
    }
    const wk = `${lk}|${zoom.toFixed(3)}`;
    if (wk !== rowsKey) {
      const Pref = projection({ Xc: P.Xc, Yf: P.Yf, Yn: P.Yn, s0: P.s0, s1: P.s1, H, xcam: W / 2 });
      rows = HALL.rows.flatMap((_, i) => V.renderRow(Pref, i, dpr));
      rowsKey = wk;
    }
  }

  // ---------------------------------------------------------------- người
  function prepareActors(now) {
    tickNet(Math.min(100, Math.max(0, now - (prepareActors.at || now))));
    prepareActors.at = now;
    const out = [];
    const myPos = me.active ? myRenderPos(now) : null;
    for (const a of store.players.values()) {
      if (a.bornAt > now) a.bornAt = now;
      let alpha = clamp((now - a.bornAt) / 400, 0, 1);
      if (a.goneAt) {
        alpha = Math.min(alpha, 1 - clamp((now - a.goneAt) / 450, 0, 1));
        if (now - a.goneAt > 480) { store.players.delete(a.id); continue; }
      }
      if (!a.look) continue;
      let moving;
      if (a.isMe && myPos) {
        a.x = myPos.x; a.y = myPos.y; a.dir = me.dir;
        a.phase = me.phase;
        a.moveAmt = me.moveAmt;
        moving = me.moveAmt > 0.5 || !!me.target;
        a.act = me.act;
      } else {
        const p = actorPos(a, now);
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        a.x = p.x; a.y = p.y; a.dir = p.d;
        a.moveAmt = lerp(a.moveAmt || 0, d > 0.0008 || p.seg ? 1 : 0, 0.35);
        if (d > 0.0008) a.phase += d * 9.5;
        else if (a.moveAmt < 0.3) a.phase = lerp(a.phase, Math.round(a.phase / Math.PI) * Math.PI, 0.2);
        moving = a.moveAmt > 0.5;
        if (a.act && moving && now >= a.act.start) a.act = null;
      }
      if (a.act && a.act.def.dur && now - a.act.start > a.act.def.dur) {
        if (a.isMe) me.act = null;
        a.act = null;
      }
      const seat = !moving ? seatAt(a.x, a.y) : null;
      a.moving = moving;
      a.seated = !!seat;
      a.alpha = alpha * (a.ghost ? 0.45 : 1);
      out.push(a);
    }
    return out;
  }

  function figureOf(a, now) {
    let pose = 'stand';
    let dir = a.dir || 'down';
    if (a.seated) { pose = 'sit'; dir = 'up'; }
    let anim = null, hold = null;
    // tùy chọn "ẩn động tác" (của mọi người / riêng người này): đứng yên như không làm gì
    const act = a.act && now >= a.act.start && showActsFrom(a.name, a.isMe) ? a.act : null;
    if (act) {
      const seated = a.seated && act.def.seat;
      if (a.seated && !act.def.seat) pose = 'stand';
      const view = dir === 'left' || dir === 'right' ? 'left' : dir;
      const r = actionPose(act.id, now - act.start, view, seated, dir);
      if (r) {
        anim = r.anim;
        if (r.pose) pose = r.pose === 'sit' && !a.seated ? 'floor' : r.pose;
        if (r.hold) hold = r.hold;
        if (r.dir) dir = r.dir;
      }
    }
    return { pose, dir, anim, hold, act };
  }

  const lookKey = (look) => `${look.body}${look.facial}${look.skin}${look.hair}${look.hairStyle}${look.shirt}${look.pants}${look.accessory}`;

  function drawActor(a, now, f) {
    const p = P.pt(a.x, a.y);
    const sc = (p.s * L.cs) / U;
    const talking = store.bubbles.some((b) => b.pid === a.id && now - b.t0 < Math.min(b.dur, 1600));
    const recentEmo = a.emoAt && now - a.emoAt < 2500 ? a.emo : '';
    const opts = {
      dir: f.dir, pose: f.pose, moving: a.moving && f.pose === 'stand', phase: a.phase, t: now, seed: a.seed,
      mood: f.act ? 'happy' : moodOf(recentEmo), talking, blink: (now + a.seed * 997) % 4300 < 130, hold: f.hold, anim: f.anim,
    };
    // máy yếu: người đứng / ngồi yên không nói → vẽ sẵn vào sprite (theo cỡ) rồi chỉ dán
    if ((quality >= 1 || crowd) && !f.anim && !a.moving && !talking && !recentEmo && a.alpha >= 0.99) {
      const px = Math.max(8, Math.round(p.s * L.cs));
      const key = `${lookKey(a.look)}|${f.pose}|${f.dir}|${f.hold || ''}|${px}|${dpr}`;
      let sp = spriteCache.get(key);
      if (!sp) {
        const wT = 1.8, hT = 2.4, s = px * dpr;
        const cv = makeCanvas(wT * s, hT * s);
        const c2 = cv.getContext('2d');
        c2.setTransform(s / U, 0, 0, s / U, (wT / 2) * s, (hT - 0.25) * s);
        drawCharacter(c2, a.look, { ...opts, t: 0, blink: false, talking: false, mood: 'neutral' });
        sp = { cv, wT, hT, px };
        if (spriteCache.size > 300) spriteCache.clear();
        spriteCache.set(key, sp);
      }
      ctx.drawImage(sp.cv, p.x - (sp.wT / 2) * sp.px, p.y - (sp.hT - 0.25) * sp.px, sp.wT * sp.px, sp.hT * sp.px);
      return;
    }
    ctx.save();
    if (a.alpha < 1) ctx.globalAlpha = a.alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(sc, sc);
    drawCharacter(ctx, a.look, opts);
    ctx.restore();
  }

  /** emoji tự bay theo động tác (bắt đầu + nhịp lặp của điệu nhảy) */
  function actionFx(a, now) {
    const act = a.act;
    if (!act || now < act.start) return;
    const fx = ACTION_FX[act.id];
    if (!fx || !prefs.actFx || !showActsFrom(a.name, a.isMe)) return;
    const el = now - act.start;
    if (!act.fxStarted) {
      act.fxStarted = true;
      act.fxAt = now;
      if (el < 1200) for (const e of fx.start) spawnFx(a.id, e, now, { spread: 0.3, size: 1.1 });
      return;
    }
    if (!fx.every || (fx.until && el > fx.until) || quality >= 2) return;
    if (now - act.fxAt >= fx.every) {
      act.fxAt = now;
      const e = fx.pool[Math.floor(Math.random() * fx.pool.length)];
      spawnFx(a.id, e, now, { spread: 0.8, size: act.id === 'heart' ? 0.9 : 0.85, dur: 1800 });
    }
  }

  // ---------------------------------------------------------------- vẽ
  function frame() {
    raf = requestAnimationFrame(frame);
    // performance.now() (cùng đồng hồ với store) — mốc của rAF có thể lệch khi tab vừa thức / chạy headless
    const now = performance.now();
    const t0 = now;
    const gap = now - lastFrameAt;
    lastFrameAt = now;
    if (gap > 0 && gap < 120) frameMs = frameMs * 0.95 + gap * 0.05;
    try {
      draw(now);
    } catch (e) {
      if (!frame.warned) { console.error('[rạp] lỗi vẽ', e); frame.warned = true; }
    }
    measure(performance.now() - t0, now);
  }

  /** máy yếu tự giảm chi tiết: 1 = sprite cho người đứng yên, bớt bụi / emoji; 2 = thêm DPR ≤ 1,25, tắt chùm sáng + đèn sàn */
  function measure(ms, now) {
    drawMs = drawMs * 0.92 + ms * 0.08;
    // người xem tự chọn chất lượng (⚙️): không tự đổi nữa
    if (prefs.quality !== 'auto') {
      const q = prefs.quality === 'low' ? 2 : 0, cap = q === 2 ? 1.25 : 2.5;
      quality = q;
      if (dprCap !== cap) { dprCap = cap; resize(); }
      return;
    }
    // chậm = JS vẽ lâu, hoặc khung hình thật < ~48 / s kéo dài (máy yếu tô điểm ảnh không kịp)
    const slow = drawMs > 11 || (now > calmUntil && frameMs > 21);
    if (slow) { slowFrames++; fastFrames = 0; } else if (drawMs < 4.5 && frameMs < 18.5) { fastFrames++; slowFrames = 0; }
    if (slowFrames > 150 && quality < 2) {
      quality++;
      slowFrames = 0;
      calmUntil = now + 4000;
      if (quality >= 2 && dprCap > 1.25) { dprCap = 1.25; dprDrops++; resize(); }
    } else if (fastFrames > 900 && quality > 0) {
      quality--;
      fastFrames = 0;
      // nhanh lại thì trả độ nét (tối đa 2 lần, tránh nhấp nháy nét / mờ mãi)
      if (quality < 2 && dprCap < 2.5 && dprDrops < 2) { dprCap = 2.5; calmUntil = now + 4000; resize(); }
    }
  }

  function draw(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    fadeA += (fadeTarget - fadeA) * Math.min(1, dt * 10);
    if (Math.abs(fadeTarget - fadeA) < 0.004) fadeA = fadeTarget;
    if (pendingTheme && fadeA >= 0.97) {
      if (pendingTheme !== V) {
        V = pendingTheme;
        props = V.props();
        tex = null; bandKey = ''; roomKey = ''; rowsKey = '';
        spriteCache.clear();
      }
      pendingTheme = null;
      fadeTarget = 0;
    }
    resize();
    hooks.beforeFrame?.(dt, now);
    const myPos = me.active ? myRenderPos(now) : null;
    updateCamera(myPos);
    ensureCaches();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = V.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // ---- dải màn hình + phòng (sàn, tường, sân khấu)
    ctx.drawImage(band.canvas, 0, 0, band.canvas.width, band.canvas.height);
    ctx.drawImage(roomCv, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const si = hooks.screenInfo?.() || null;
    if (V.skyFx && quality < 2 && prefs.lights) {
      // hiệu ứng trên dải trời: cắt bỏ khung video
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssW, L.vb);
      ctx.rect(L.screen.x - L.frame, L.screen.y - L.frame, L.screen.w + L.frame * 2, L.screen.h + L.frame * 2);
      ctx.clip('evenodd');
      V.skyFx(ctx, L, now);
      ctx.restore();
    }
    if (si && si.show) drawIdleScreen(ctx, L.screen, si.title, si.sub, now);

    // ---- mọi thứ của khán phòng bị cắt dưới mép màn hình: không gì được đè lên video
    const clipTop = L.vb;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, cssW, cssH - clipTop);
    ctx.clip();
    // tùy chọn: ẩn người khác / ẩn riêng vài người (vẫn cập nhật vị trí, chỉ không vẽ, không bấm trúng)
    const acts = prepareActors(now).filter((a) => showPerson(a.name, a.isMe));
    crowd = acts.length > 24;
    const dancers = acts.filter((a) => a.act && ['hiphop', 'headbang', 'bounce'].includes(a.act.id) && now >= a.act.start);
    if (quality < 2 && prefs.lights) V.drawDanceLights(ctx, P, dancers, now);
    // ---- sắp theo độ sâu: hàng ghế, loa, quầy bar, người
    const items = [];
    for (const r of rows) items.push(r);
    for (const sp of HALL.speakers) items.push({ kind: 'speaker', key: sp.y + sp.h, sp });
    items.push({ kind: 'counter', key: HALL.counter.y + HALL.counter.h });
    for (const pr of props) {
      const px = P.sx(pr.x, pr.z);
      if (px > -260 && px < cssW + 260) items.push({ kind: 'prop', key: pr.key, pr });
    }
    hits = [];
    const figs = new Map();
    for (const a of acts) {
      const p = P.pt(a.x, a.y);
      if (p.x < -80 || p.x > L.availW + 80) continue;
      figs.set(a.id, figureOf(a, now));
      items.push({ kind: 'actor', key: a.y, a });
    }
    items.sort((p, q) => p.key - q.key);
    for (const it of items) {
      if (it.kind === 'row') {
        const dx = (it.xcam - P.xcam) * P.s(it.z + 0.2);
        ctx.drawImage(it.canvas, it.x0 + dx, it.y0, it.w, it.h);
      } else if (it.kind === 'speaker') V.drawSpeaker(ctx, P, it.sp, now);
      else if (it.kind === 'counter') V.drawCounter(ctx, P, HALL.counter, now);
      else if (it.kind === 'prop') it.pr.draw(ctx, P, now);
      else drawActor(it.a, now, figs.get(it.a.id));
    }
    // ---- ánh sáng
    const playing = !!store.now && !store.now.paused;
    if (V.fx && quality < 2 && prefs.lights) V.fx(ctx, P, L, now);
    if (quality < 2 && playing && prefs.lights) V.drawBeam(ctx, L, now, quality === 0);
    V.drawHallLight(ctx, P, L, playing);
    ctx.restore();
    // ---- đang chiếu: làm tối mọi thứ xung quanh cho video nổi bật (chuyển dần ~0,5 s); chữ / bong bóng vẽ sau nên vẫn rõ
    const dimTarget = playing && hooks.watching?.() ? DIM_LEVELS[prefs.dim] || 0 : 0;
    dimA += (dimTarget - dimA) * Math.min(1, dt * 2.5);
    if (Math.abs(dimTarget - dimA) < 0.003) dimA = dimTarget;
    if (dimA > 0.003) {
      ctx.fillStyle = `rgba(4,2,8,${dimA.toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    // ---- chữ / bong bóng / emoji (px CSS) — vẫn cắt dưới mép màn hình
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipTop, cssW, cssH - clipTop);
    ctx.clip();
    drawOverlays(acts, figs, now, clipTop);
    ctx.restore();
    // ---- màn tối khi mở trang / đổi rạp (video là iframe nằm trên canvas nên không bị che)
    if (fadeA > 0.004) {
      ctx.fillStyle = `rgba(7,5,10,${fadeA.toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  function drawOverlays(acts, figs, now, clipTop) {
    const many = store.present() > 24;
    const fs = clamp(P.s0 * 0.36, 9.5, 12);
    const pillOpts = (a) => ({
      size: fs, alpha: a.alpha * (a.isMe ? 1 : 0.92), highlight: a.isMe || a.id === hoverId,
      bg: a.isMe ? 'rgba(60,40,10,0.88)' : 'rgba(15,10,22,0.8)', dot: safeColor(a.look?.shirt, '#999'),
      tag: a.ghost ? 'mất mạng' : '',
    });
    const pills = [];
    const anchors = new Map();
    for (const a of acts) {
      const f = figs.get(a.id);
      if (!f) continue;
      actionFx(a, now);
      const p = P.pt(a.x, a.y);
      const sc = (p.s * L.cs) / U;
      const headY = p.y + headTop(f.pose) * sc;
      anchors.set(a.id, { x: p.x, headY, headC: p.y + headCenter(f.pose) * sc, hr: HEAD_RADIUS * sc, feet: p.y });
      hits.push({ id: a.id, z: a.y, x0: p.x - 0.5 * p.s * L.cs, x1: p.x + 0.5 * p.s * L.cs, y0: headY, y1: p.y + 3 });
      // tên trên đầu (⚙️): tất cả · tự động (đông người thì chỉ người mới vào / đang nói) · chỉ mình
      const nm = prefs.names;
      const show = a.isMe || a.id === hoverId || nm === 'all' || (nm === 'auto' && (!many || now - a.bornAt < 6000
        || (prefs.bubbles && store.bubbles.some((b) => b.pid === a.id && now - b.t0 < b.dur))));
      if (show && a.alpha > 0.05) {
        const m = measureNamePill(ctx, a.name, pillOpts(a));
        pills.push({ a, x: p.x, y: headY - 3 - m.h, w: m.w, h: m.h, up: true });
      }
    }
    // tên trên đầu (mình: viền vàng); chồng nhau thì đẩy lên
    pills.sort((p, q) => q.y - p.y || p.x - q.x);
    spreadPills(pills);
    const pillTop = new Map();
    for (const pl of pills) {
      if (pl.y < clipTop + 2) continue;
      drawNamePill(ctx, pl.x, pl.y, pl.a.name, pillOpts(pl.a));
      pillTop.set(pl.a.id, pl.y);
    }
    // dấu "đây là bạn"
    const mine = acts.find((a) => a.isMe);
    const ma = mine && anchors.get(mine.id);
    if (ma) {
      const y = (pillTop.get(mine.id) ?? ma.headY) - 5 + Math.sin(now / 300) * 1.5;
      if (y > clipTop + 10) {
        ctx.save();
        ctx.fillStyle = '#ffc14d';
        ctx.strokeStyle = 'rgba(40,25,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ma.x - 6, y - 8); ctx.lineTo(ma.x + 6, y - 8); ctx.lineTo(ma.x, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    // bong bóng chat (neo trên bảng tên)
    const items = [];
    for (const b of store.bubbles) {
      if (now - b.t0 > b.dur || !prefs.bubbles) continue;
      const an = anchors.get(b.pid);
      const a = store.players.get(b.pid);
      if (!an || !a || !showChatFrom(a.name, a.isMe)) continue;
      items.push({
        kind: 'speech', key: b.key, ax: an.x, ay: (pillTop.get(b.pid) ?? an.headY) - 2, hy: an.headC, hr: an.hr, fy: an.feet,
        text: b.text, name: b.name, color: safeColor(a.look?.shirt, '#ffc14d'), t0: b.t0, dur: b.dur,
      });
    }
    store.bubbles = store.bubbles.filter((b) => now - b.t0 < b.dur + 400);
    if (items.length) drawBubbles(ctx, items, L.availW, cssH, now, L.narrow, { top: clipTop + 4, bottom: insets.bottom }, clamp(P.s0 / 32, 0.82, 1));
    // emoji bay (neo theo thế giới lúc sinh, bay lên theo px)
    const fxs = store.fx;
    for (let i = fxs.length - 1; i >= 0; i--) {
      const e = fxs[i];
      const age = now - e.t0;
      if (age < 0) continue;
      if (age > e.dur) { fxs.splice(i, 1); continue; }
      if (e.x === null) {
        const a = store.players.get(e.pid);
        const f = a && figs.get(a.id);
        if (!a || !f) { fxs.splice(i, 1); continue; }
        e.x = a.x + e.dx * 0.4;
        e.y = a.y;
        e.h = (-headTop(f.pose) / U) * L.cs + 0.15;
      }
      const k = age / e.dur;
      const p = P.pt(e.x, e.y, e.h);
      const rise = easeOutCubic(k) * Math.max(60, p.s * 2.6);
      const x = p.x + Math.sin(age / 260 + e.dx * 5) * 6 + e.dx * k * 20;
      const y = p.y - rise;
      if (y < clipTop + 6) continue;
      const alpha = Math.min(1, age / 180) * (1 - clamp((k - 0.7) / 0.3, 0, 1));
      const size = clamp(p.s * 0.7, 15, 28) * e.size * (0.75 + 0.25 * Math.min(1, age / 220));
      ctx.save();
      ctx.globalAlpha = alpha;
      drawEmoji(ctx, e.e, x, y, size);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- nhập liệu (chạm / bấm / chụm)
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** người gần camera hơn (z lớn) nằm trên → ưu tiên */
  function pick(sx, sy) {
    let best = 0, bestZ = -Infinity;
    for (const h of hits) {
      if (sx < h.x0 || sx > h.x1 || sy < h.y0 || sy > h.y1) continue;
      if (h.z > bestZ) { bestZ = h.z; best = h.id; }
    }
    return best;
  }

  /** bấm trúng ghế nào (lưng ghế vẽ nhô lên khỏi mặt sàn nên phải dò theo hình chiếu) */
  function pickSeat(sx, sy) {
    let best = null;
    for (const s of SEATS) {
      const x0 = P.sx(s.x - 0.45, s.y + 0.3), x1 = P.sx(s.x + 0.45, s.y + 0.3);
      const y0 = P.pt(s.x, s.y - 0.4, 0.9).y, y1 = P.sy(s.y + 0.3);
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
      if (!best || s.y > best.y) best = s;
    }
    return best;
  }

  const inAud = (sy) => L && sy >= L.vb;

  canvas.addEventListener('pointerdown', (e) => {
    const p = localXY(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
      tap = null;
    } else if (pointers.size === 1) {
      tap = { x: p.x, y: p.y, t: performance.now(), moved: false };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.zoom = clamp(pinch.zoom * (d / Math.max(10, pinch.d)), 0.6, 1.6);
      return;
    }
    if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) > 9) tap.moved = true;
    if (e.pointerType === 'mouse' && P) {
      const id = inAud(p.y) ? pick(p.x, p.y) : 0;
      if (id !== hoverId) hoverId = id;
      canvas.style.cursor = id ? 'pointer' : inAud(p.y) && p.y > P.Yf ? 'crosshair' : '';
    }
  });
  function endPointer(e) {
    const p = localXY(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    const t = tap;
    if (pointers.size === 0) tap = null;
    if (!t || t.moved || e.type !== 'pointerup' || performance.now() - t.t > 600 || !inAud(p.y) || !P) return;
    const id = pick(p.x, p.y);
    if (id) { hooks.onPick?.(id, e.clientX, e.clientY); return; }
    const seat = pickSeat(p.x, p.y);
    if (seat) { hooks.onFloorTap?.(seat.x, seat.y); return; }
    if (p.y < P.Yf) return;
    const w = P.inv(p.x, p.y);
    hooks.onFloorTap?.(w.x, w.z);
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && hoverId) { hoverId = 0; canvas.style.cursor = ''; } });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  raf = requestAnimationFrame(frame);

  // thông tin chỉ-đọc cho script QA headless
  canvas.__view = () => ({
    s0: P?.s0, s1: P?.s1, xcam: P?.xcam, zoom: cam.zoom, dpr, quality, drawMs: Math.round(drawMs * 100) / 100, frameMs: Math.round(frameMs * 10) / 10, crowd, follow: cam.follow, view, venue: V.id,
    layout: L && { screen: { ...L.screen }, audTop: L.audTop, Yf: Math.round(L.Yf), Yn: Math.round(L.Yn), availW: L.availW, narrow: L.narrow },
    insets: { ...insets }, actors: store.players.size,
    net: { ...store.net },
  });

  return {
    setView(v) { if (v === view) return; view = v; relayout(); },
    get view() { return view; },
    /** đổi khung cảnh rạp: vẽ lại sàn, dải trời / tường, hàng ghế, vật trang trí */
    setVenue(id) {
      wantVenue = id;
      if (V.id === id) { pendingTheme = null; fadeTarget = 0; return; }
      fadeTarget = 1; // tối dần trong lúc tải / chờ
      loadTheme(id).then((t) => { if (wantVenue === id) pendingTheme = t; });
    },
    get venue() { return V.id; },
    get layout() { return L; },
    /** giao diện nổi đổi chỗ chiếm (mở / đóng ngăn kéo, dock đổi cỡ…) → tính lại bố cục nếu khác */
    setInsets(next) {
      let changed = false;
      for (const k of Object.keys(insets)) {
        if (next[k] === undefined) continue;
        const v = Math.max(0, Math.round(next[k]));
        if (v !== insets[k]) { insets[k] = v; changed = true; }
      }
      if (changed && L) relayout();
    },
    /** toạ độ px CSS (trong canvas) của một người — để đặt vòng động tác / thẻ tên */
    screenPosOf(id) {
      const a = store.players.get(id);
      if (!a || !P) return null;
      const p = P.pt(a.x, a.y);
      return { x: p.x, y: p.y, T: p.s * (L?.cs || 1) };
    },
    refresh() { clearTextCache(); roomKey = ''; bandKey = ''; rowsKey = ''; },
    stop() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
