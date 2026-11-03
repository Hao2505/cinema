// Rạp Đỗ Xe (4) — vật cản + hiệu ứng sàn: chồng loa ngoài trời (thùng bass + loa kèn) ở hai góc bục, quầy SNACK BAR
// kiểu thập niên 50 sát rào phải (mái sọc đỏ trắng, máy bắp rang, biển neon), đèn ô bàn cờ dưới chân người nhảy + đốm đèn
// quét. Loa / quầy vẽ mỗi khung → vẽ sẵn vào sprite theo camera rồi chỉ dán (máy yếu vẫn nhẹ).
import { hash2 } from '../../util.js';
import { FONT, makeCanvas, fillRR, rrPath, vGrad } from '../draw.js';
import { box, poly } from '../persp.js';
import { PAD, LAMPS, LAMP_H } from './doxe-floor.js';

const cache = new Map();
/** sprite px CSS của một vật theo camera hiện tại; bounds = [x0, x1, z0, z1, cao] (ô) */
function cached(id, ctx, P, bounds, draw) {
  const dpr = ctx.getTransform().a || 1;
  const key = `${P.xcam}|${P.s0}|${P.k}|${P.Yf}|${P.Xc}|${dpr}`;
  let e = cache.get(id);
  if (!e || e.key !== key) {
    const [x0, x1, z0, z1, ht] = bounds;
    const pts = [];
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const h of [0, ht]) pts.push(P.pt(x, z, h));
    const bx0 = Math.floor(Math.min(...pts.map((q) => q.x))) - 12, bx1 = Math.ceil(Math.max(...pts.map((q) => q.x))) + 12;
    const by0 = Math.floor(Math.min(...pts.map((q) => q.y))) - 12, by1 = Math.ceil(Math.max(...pts.map((q) => q.y))) + 8;
    const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
    const cv = makeCanvas(w * dpr, h * dpr);
    const c2 = cv.getContext('2d');
    c2.setTransform(dpr, 0, 0, dpr, -bx0 * dpr, -by0 * dpr);
    c2.lineJoin = 'round';
    draw(c2);
    e = { key, cv, x0: bx0, y0: by0, w, h };
    cache.set(id, e);
  }
  ctx.drawImage(e.cv, e.x0, e.y0, e.w, e.h);
  return e;
}

// ---------------------------------------------------------------- chồng loa ngoài trời
export function drawSpeaker(ctx, P, sp) {
  const x0 = sp.x, x1 = sp.x + sp.w, z0 = sp.y, z1 = sp.y + sp.h;
  cached(`sp${sp.x}`, ctx, P, [x0, x1, z0, z1, 1.55], (c) => {
    // xe đẩy + bánh
    box(c, P, x0 + 0.02, x1 - 0.02, z0 + 0.15, z1, 0.14, { top: '#2a2c33', front: '#16171b', left: '#0e0f12', right: '#0e0f12' }, 0.04);
    for (const wx of [x0 + 0.15, x1 - 0.15]) {
      const q = P.pt(wx, z1 - 0.06, 0.05);
      c.fillStyle = '#08080a';
      c.beginPath(); c.ellipse(q.x, q.y, q.s * 0.07, q.s * 0.05, 0, 0, Math.PI * 2); c.fill();
    }
    // thùng bass
    const bb = box(c, P, x0 + 0.06, x1 - 0.06, z0 + 0.2, z1 - 0.05, 0.98, { top: '#2b2d35', front: '#17181d', left: '#0f1014', right: '#0f1014', edge: 'rgba(255,255,255,0.1)' }, 0.14);
    const f = bb.front, fw = f.B.x - f.A.x, fh = f.A.y - f.D.y;
    const wx = (f.A.x + f.B.x) / 2, wy = f.D.y + fh * 0.47, r = Math.min(fw, fh) * 0.36;
    c.fillStyle = '#2c2e36';
    c.beginPath(); c.arc(wx, wy, r * 1.08, 0, Math.PI * 2); c.fill();
    const cg = c.createRadialGradient(wx, wy - r * 0.2, r * 0.1, wx, wy, r);
    cg.addColorStop(0, '#2a2b31');
    cg.addColorStop(1, '#060607');
    c.fillStyle = cg;
    c.beginPath(); c.arc(wx, wy, r * 0.94, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#33353e';
    c.beginPath(); c.arc(wx, wy, r * 0.32, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.beginPath(); c.arc(wx - r * 0.1, wy - r * 0.12, r * 0.1, 0, Math.PI * 2); c.fill();
    fillRR(c, wx - fw * 0.3, f.D.y + fh * 0.86, fw * 0.6, Math.max(2, fh * 0.06), 2, '#050506');
    // ốp góc crôm
    c.fillStyle = 'rgba(205,212,225,0.75)';
    const k = Math.max(2, fw * 0.07);
    for (const [px, py, sx, sy] of [[f.D.x, f.D.y, 1, 1], [f.C.x, f.C.y, -1, 1], [f.A.x, f.A.y, 1, -1], [f.B.x, f.B.y, -1, -1]]) {
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + sx * k, py); c.lineTo(px, py + sy * k); c.closePath(); c.fill();
    }
    // loa kèn trên nóc: miệng loe vuông thu về khe họng
    const hb = box(c, P, x0 + 0.14, x1 - 0.14, z0 + 0.38, z1 - 0.14, 1.5, { top: '#2b2d35', front: '#1c1d23', left: '#111216', right: '#111216', edge: 'rgba(255,255,255,0.1)' }, 0.98);
    const g = hb.front, gw = g.B.x - g.A.x, gh = g.A.y - g.D.y;
    const ix = (g.A.x + g.B.x) / 2, iy = g.D.y + gh * 0.5;
    c.fillStyle = vGrad(c, g.D.y, g.A.y, [[0, '#0b0b0e'], [0.5, '#1e1f25'], [1, '#0b0b0e']]);
    c.fillRect(g.D.x + gw * 0.07, g.D.y + gh * 0.12, gw * 0.86, gh * 0.76);
    c.strokeStyle = 'rgba(150,160,180,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    for (const [px, py] of [[g.D.x + gw * 0.07, g.D.y + gh * 0.12], [g.C.x - gw * 0.07, g.D.y + gh * 0.12], [g.C.x - gw * 0.07, g.A.y - gh * 0.12], [g.D.x + gw * 0.07, g.A.y - gh * 0.12]]) {
      c.moveTo(px, py); c.lineTo(ix + Math.sign(px - ix) * gw * 0.16, iy + Math.sign(py - iy) * gh * 0.04);
    }
    c.stroke();
    fillRR(c, ix - gw * 0.17, iy - gh * 0.05, gw * 0.34, Math.max(1.5, gh * 0.1), 1, '#020203');
    c.fillStyle = '#fbbf24';
    c.beginPath(); c.arc(g.C.x - gw * 0.1, g.C.y + gh * 0.08, Math.max(1, gw * 0.025), 0, Math.PI * 2); c.fill();
  });
}

// ---------------------------------------------------------------- quầy SNACK BAR
export function drawCounter(ctx, P, c, now) {
  const x0 = c.x, x1 = c.x + c.w, z0 = c.y, z1 = c.y + c.h;
  const zs = z1 - 0.45; // mặt biển hiệu
  const e = cached('counter', ctx, P, [x0 - 1.0, x1 + 0.2, z0 - 0.15, z1 + 0.15, 2.8], (g) => drawBooth(g, P, x0, x1, z0, z1, zs));
  // neon nhịp thở + chập chờn hiếm
  const n = P.pt(x0 - 0.35, zs, 2.47);
  const t = now % 7000;
  const flick = t < 300 && Math.floor(t / 60) % 2 === 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = flick ? 0.05 : 0.18 + 0.1 * Math.sin(now / 700);
  const r = n.s * 1.2;
  const gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
  gl.addColorStop(0, 'rgba(255,80,130,1)');
  gl.addColorStop(1, 'rgba(255,80,130,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
  ctx.restore();
  return { x0: e.x0, x1: e.x0 + e.w, y0: e.y0, y1: e.y0 + e.h };
}

function drawBooth(g, P, x0, x1, z0, z1, zs) {
  // bóng quầy trên nền
  const sh = P.pt((x0 + x1) / 2 - 0.2, (z0 + z1) / 2, 0);
  g.save();
  g.translate(sh.x, sh.y);
  g.scale(1, P.k / sh.s);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(0, 0, sh.s * 1.0, sh.s * 1.6, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  // vách trong quầy sáng đèn vàng (thấy qua ô bán hàng)
  box(g, P, x1 - 0.08, x1, z0, z1, 1.88, { left: '#ffcf86', front: '#e9b56a' }, 0.95);
  const inner = P.pt(x1 - 0.1, (z0 + z1) / 2, 1.4);
  const ig = g.createRadialGradient(inner.x, inner.y, 0, inner.x, inner.y, inner.s * 1.5);
  ig.addColorStop(0, 'rgba(255,230,170,0.5)');
  ig.addColorStop(1, 'rgba(255,230,170,0)');
  g.fillStyle = ig;
  g.fillRect(inner.x - inner.s * 1.5, inner.y - inner.s * 1.5, inner.s * 3, inner.s * 3);
  // máy bắp rang (hộp kính, nóc đỏ) + ly nước
  const m = box(g, P, x0 + 0.3, x1 - 0.12, z0 + 0.45, z0 + 1.15, 1.62, { top: '#c81e3a', front: 'rgba(255,244,205,0.32)', left: 'rgba(255,238,195,0.26)', right: '#8f1426' }, 1.0);
  const mf = m.front;
  for (let i = 0; i < 16; i++) {
    const px = mf.A.x + (mf.B.x - mf.A.x) * (0.08 + hash2(i, 3, 1) * 0.84);
    const py = mf.A.y - (mf.A.y - mf.D.y) * (0.05 + hash2(i, 5, 2) * 0.45);
    g.fillStyle = '#fff1bd';
    g.beginPath(); g.arc(px, py, Math.max(0.8, (mf.B.x - mf.A.x) * 0.05), 0, Math.PI * 2); g.fill();
  }
  for (let k = 0; k < 3; k++) {
    const p = P.pt(x0 + 0.35, z0 + 1.55 + k * 0.3, 1.0);
    fillRR(g, p.x - p.s * 0.08, p.y - p.s * 0.27, p.s * 0.16, p.s * 0.27, 1, '#f8fafc');
    g.fillStyle = '#e11d48';
    g.fillRect(p.x - p.s * 0.08, p.y - p.s * 0.19, p.s * 0.16, p.s * 0.06);
  }
  // quầy dưới: kem + sọc đỏ + chân crôm, mặt quầy inox nhô ra
  box(g, P, x0, x1, z0, z1, 0.95, { top: '#a9b0bc', front: '#e6dbc0', left: '#d8ccaf', right: '#b9ad91' });
  for (const [h0, h1, col] of [[0.0, 0.12, '#9aa3b4'], [0.55, 0.66, '#c62f45']]) {
    poly(g, [P.pt(x0, z0, h0), P.pt(x0, z1, h0), P.pt(x0, z1, h1), P.pt(x0, z0, h1)], col);
    poly(g, [P.pt(x0, z1, h0), P.pt(x1, z1, h0), P.pt(x1, z1, h1), P.pt(x0, z1, h1)], col);
  }
  box(g, P, x0 - 0.08, x1, z0 - 0.04, z1 + 0.06, 1.0, { top: '#7c8596', front: '#a7afbd', left: '#a7afbd', edge: 'rgba(255,255,255,0.7)' }, 0.95);
  // cột crôm bốn góc
  for (const [px, pz] of [[x0, z0], [x0, z1], [x1, z1]]) {
    const b = P.pt(px, pz, 1.0), t = P.pt(px, pz, 1.86);
    g.strokeStyle = '#c3cad6';
    g.lineWidth = Math.max(1, b.s * 0.045);
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
  }
  // mái + diềm sọc đỏ trắng phía quầy
  box(g, P, x0 - 0.12, x1 + 0.04, z0 - 0.1, z1 + 0.1, 2.0, { top: '#3b3f4b', front: '#d9d2c0', left: '#d9d2c0', right: '#a39b88' }, 1.86);
  const n = 9, za = z0 - 0.1, zb = z1 + 0.1;
  for (let i = 0; i < n; i++) {
    const a = za + ((zb - za) * i) / n, b = za + ((zb - za) * (i + 1)) / n;
    poly(g, [P.pt(x0 - 0.12, a, 1.88), P.pt(x0 - 0.12, b, 1.88), P.pt(x0 - 0.52, b, 1.64), P.pt(x0 - 0.52, a, 1.64)], i % 2 ? '#f1ece2' : '#d0283e');
  }
  for (let i = 0; i < n; i++) {
    const a = za + ((zb - za) * i) / n, b = za + ((zb - za) * (i + 1)) / n;
    const p0 = P.pt(x0 - 0.52, a, 1.64), p1 = P.pt(x0 - 0.52, b, 1.64), pm = P.pt(x0 - 0.52, (a + b) / 2, 1.56);
    g.fillStyle = i % 2 ? '#e4ddd0' : '#b51f33';
    g.beginPath(); g.moveTo(p0.x, p0.y); g.quadraticCurveTo(pm.x, pm.y + (pm.y - p0.y) * 0.5, p1.x, p1.y); g.closePath(); g.fill();
  }
  // biển SNACK BAR (mặt quay về người xem) + BẮP NƯỚC
  const a = P.pt(x0 - 0.95, zs, 2.02), b = P.pt(x1 + 0.15, zs, 2.74);
  const w = b.x - a.x, h = a.y - b.y;
  for (const px of [x0 - 0.6, x1 - 0.2]) {
    const q0 = P.pt(px, zs, 2.0), q1 = P.pt(px, zs, 2.1);
    g.fillStyle = '#2d3240';
    g.fillRect(q0.x - 1, q1.y, 2, q0.y - q1.y + 2);
  }
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 6;
  fillRR(g, a.x, b.y, w, h, Math.max(2, h * 0.16), '#0d2430');
  g.restore();
  g.strokeStyle = '#c9d0dc';
  g.lineWidth = Math.max(1, h * 0.05);
  rrPath(g, a.x + 1, b.y + 1, w - 2, h - 2, Math.max(2, h * 0.14));
  g.stroke();
  for (let i = 0; i < 9; i++) {
    g.fillStyle = '#ffd98a';
    g.beginPath(); g.arc(a.x + w * (0.08 + (0.84 * i) / 8), b.y + h * 0.1, Math.max(0.8, h * 0.035), 0, Math.PI * 2); g.fill();
  }
  const cx = a.x + w / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fs = h * 0.42;
  g.font = `900 ${fs}px ${FONT}`;
  const tw = g.measureText('SNACK BAR').width;
  if (tw > w * 0.86) { fs *= (w * 0.86) / tw; g.font = `900 ${fs}px ${FONT}`; }
  g.save();
  g.shadowColor = 'rgba(255,70,130,0.95)';
  g.shadowBlur = fs * 0.5;
  g.fillStyle = '#ff5c93';
  g.fillText('SNACK BAR', cx, b.y + h * 0.43);
  g.restore();
  const tg = g.createLinearGradient(0, b.y + h * 0.43 - fs * 0.5, 0, b.y + h * 0.43 + fs * 0.5);
  tg.addColorStop(0, '#ff5c93');
  tg.addColorStop(0.5, '#ffe3ee');
  tg.addColorStop(1, '#ff5c93');
  g.fillStyle = tg;
  g.fillText('SNACK BAR', cx, b.y + h * 0.43);
  g.save();
  g.shadowColor = 'rgba(255,200,80,0.9)';
  g.shadowBlur = fs * 0.3;
  g.fillStyle = '#ffd24a';
  g.font = `800 ${fs * 0.55}px ${FONT}`;
  g.fillText('BẮP NƯỚC', cx, b.y + h * 0.78);
  g.restore();
}

// ---------------------------------------------------------------- sàn nhảy
/** ô bàn cờ quanh chân người nhảy đổi màu theo nhịp + đốm đèn quét (tròn trên nền → elip phối cảnh) */
export function drawDanceLights(ctx, P, dancers, now) {
  if (!dancers.length) return;
  const d = PAD;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let n = 0; n < dancers.length && n < 14; n++) {
    const a = dancers[n];
    const ci = Math.floor((a.x - d.x) / d.cw), cj = Math.floor((a.y - d.y) / d.ch);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= d.nx || j >= d.nz) continue;
        const x0 = d.x + i * d.cw, z0 = d.y + j * d.ch;
        const beat = (Math.floor(now / 300) + i * 3 + j * 5) % 4;
        const hue = [322, 178, 46, 275][beat];
        const dist = Math.hypot(x0 + d.cw / 2 - a.x, z0 + d.ch / 2 - a.y);
        const k = Math.max(0, 1 - dist / 1.9) * (0.55 + 0.45 * Math.sin(now / 140 + i + j));
        if (k <= 0.02) continue;
        poly(ctx, [P.pt(x0 + 0.05, z0 + 0.05), P.pt(x0 + d.cw - 0.05, z0 + 0.05), P.pt(x0 + d.cw - 0.05, z0 + d.ch - 0.05), P.pt(x0 + 0.05, z0 + d.ch - 0.05)], `hsla(${hue},95%,60%,${0.4 * k})`);
      }
    }
  }
  const n = Math.min(3, dancers.length);
  for (let i = 0; i < n; i++) {
    const t = now / (2600 + i * 700) + i * 2.1;
    const p = P.pt(d.x + d.w * (0.5 + 0.42 * Math.sin(t)), d.y + d.h * (0.5 + 0.35 * Math.cos(t * 1.3)));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, P.k / p.s);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.s * 1.4);
    const hue = [322, 178, 46][i];
    g.addColorStop(0, `hsla(${hue},95%,65%,0.34)`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-p.s * 1.4, -p.s * 1.4, p.s * 2.8, p.s * 2.8);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- mỗi khung trên bãi xe
/** vài con thiêu thân chập chờn quanh chao đèn cột (rẻ: vài ô vuông 1–2 px) */
export function fx(ctx, P, L, now) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,238,205,0.85)';
  for (let li = 0; li < LAMPS.length; li++) {
    const l = LAMPS[li];
    const e = P.pt(l.x + l.dir * 0.85, l.z, LAMP_H - 0.12);
    if (e.x < -30 || e.x > L.w + 30 || e.y < L.vb + 4 || e.y > L.h) continue;
    for (let i = 0; i < 4; i++) {
      const t = now / (430 + i * 110) + i * 1.7 + li * 2.3;
      const x = e.x + Math.sin(t) * e.s * (0.22 + 0.08 * i) + Math.sin(t * 3.7) * e.s * 0.05;
      const y = e.y + e.s * (0.2 + 0.08 * i) + Math.cos(t * 1.3) * e.s * 0.14;
      const r = Math.max(1, e.s * 0.035);
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }
  ctx.restore();
}
