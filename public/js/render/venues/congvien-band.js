// Rạp Công Viên — dải trên (px CSS, vẽ một lần theo bố cục): trời đêm, dải ngân hà mờ, sao, trăng, ánh phố + nhà cao tầng
// xa, hàng cây chân trời, bãi cỏ sau màn hình (đèn công viên xa, cây tầng giữa), màn hình bơm hơi: khung ống tròn bo góc,
// hai cột hơi, dây néo xuống cọc. Ô L.screen tô đen sau cùng (iframe YouTube nằm đè lên).
// skyFx: vài ngôi sao lấp lánh + thỉnh thoảng một sao băng — chỉ ở vùng trời trống (không đè cây / màn hình / trăng).
import { hash2, clamp } from '../../util.js';
import { makeCanvas, vGrad, hGrad, rrPath } from '../draw.js';
import { approxProj, drawTree, TREE_PAL, TREE_TOP, TREES, BACK_TREES, glow, blitGlow, W } from './congvien-art.js';

// ================================================================ hình học dùng chung (cache theo bố cục)
let geoKey = '', geo = null;

/** vị trí các mảng lớn của dải trên: chân trời, trăng, khung + cột màn hình, vùng trời trống cho sao lấp lánh */
export function sceneGeo(L) {
  const sc = L.screen;
  const key = `${L.w}x${L.h}|${sc.x},${sc.y},${sc.w},${sc.h}|${L.Yf}|${L.Yn}|${L.s0}|${L.frame}|${L.narrow}`;
  if (key === geoKey && geo) return geo;
  const pr = approxProj(L);
  const fb = L.frame;
  const inner = { x: sc.x - fb, y: sc.y - fb, w: sc.w + fb * 2, h: sc.h + fb * 2 };
  const t = L.narrow ? 7 : clamp(Math.round(sc.w * 0.02), 8, 17); // độ dày ống khung
  const pw = Math.round(t * 1.5); // bề ngang cột hơi
  const pL = inner.x - pw / 2 - t * 0.4, pR = inner.x + inner.w + pw / 2 + t * 0.4;
  const capY = inner.y - t - pw * 0.4;
  const ground = L.vb + 1.05 * L.sw; // chân màn hình trên mặt cỏ (z = ZW)
  const hy = Math.round(sc.y + sc.h * 0.72); // chân trời
  const u = clamp(sc.h / 30, 5, 17); // đơn vị cỡ hàng cây xa
  const sideL = pL - pw / 2 - 6, sideR = pR + pw / 2 + 6; // vùng trời trống: x < sideL hoặc x > sideR
  let moon = null;
  if (sideL > 74) {
    const r = clamp(sideL * 0.1, 11, 28);
    moon = { x: Math.round(sideL * 0.47), y: Math.round(Math.max(sc.y + sc.h * 0.2, 42 + r + 16)), r };
  }
  // đỉnh cây cao nhất (cây gần + cây tầng giữa) → sao lấp lánh chỉ ở trên đó
  let treeTop = hy - u * 2.6;
  for (const [x, z, k] of [...TREES, ...BACK_TREES]) {
    const px = pr.x(x, z);
    if (px < -60 || px > L.w + 60) continue;
    treeTop = Math.min(treeTop, pr.y(z, TREE_TOP * k));
  }
  // … và trên nóc nhà cao tầng xa (cao tới ~8u + tháp) — sao lấp lánh không được nằm trước nhà / cây
  const skyLimit = Math.max(12, Math.min(treeTop - 8, hy - u * 9.6));
  // sao lấp lánh: vị trí cố định theo bố cục
  const twinkle = [];
  const area = Math.max(0, sideL) * skyLimit + Math.max(0, L.w - sideR) * skyLimit;
  const n = clamp(Math.round(area / 9000), 0, 26);
  for (let i = 0, tries = 0; twinkle.length < n && tries < n * 8; tries++, i++) {
    const left = hash2(i, 1, 907) < sideL / Math.max(1, sideL + (L.w - sideR));
    const x = left ? hash2(i, 2, 907) * sideL : sideR + hash2(i, 3, 907) * (L.w - sideR);
    const y = 6 + Math.pow(hash2(i, 4, 907), 1.2) * (skyLimit - 12);
    if (moon && Math.hypot(x - moon.x, y - moon.y) < moon.r * 2.6) continue;
    twinkle.push({ x, y, r: 0.9 + hash2(i, 5, 907) * 1.3, ph: hash2(i, 6, 907) * 6.28, per: 380 + hash2(i, 7, 907) * 900 });
  }
  geo = { inner, t, pw, pL, pR, capY, ground, hy, u, sideL, sideR, moon, skyLimit, twinkle, pr };
  geoKey = key;
  return geo;
}

// ================================================================ dải trên
export function renderBand(L, dpr) {
  const bandH = Math.ceil(L.Yf + 2);
  const cv = makeCanvas(L.w * dpr, bandH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const G = sceneGeo(L);
  const sc = L.screen, hy = G.hy;
  // ---- trời
  ctx.fillStyle = vGrad(ctx, 0, hy, [[0, '#03061a'], [0.42, '#0a1135'], [0.78, '#191b4a'], [1, '#2c2452']]);
  ctx.fillRect(0, 0, L.w, hy + 1);
  milkyWay(ctx, L, hy);
  stars(ctx, L, hy);
  // ánh phố hắt lên chân trời
  ctx.fillStyle = vGrad(ctx, hy - sc.h * 0.3, hy, [[0, 'rgba(255,150,120,0)'], [0.7, 'rgba(255,140,120,0.06)'], [1, 'rgba(255,170,130,0.16)']]);
  ctx.fillRect(0, hy - sc.h * 0.3, L.w, sc.h * 0.3);
  if (G.moon) drawMoon(ctx, G.moon);
  skyline(ctx, L, G);
  treeLine(ctx, L, G);
  // ---- bãi cỏ phía sau (chân trời → mép bục)
  ctx.fillStyle = vGrad(ctx, hy, bandH, [[0, '#0f1a24'], [0.18, '#0e1c1d'], [1, '#11281b']]);
  ctx.fillRect(0, hy, L.w, bandH - hy);
  lawnStripes(ctx, L, G, bandH);
  ctx.fillStyle = vGrad(ctx, hy - 8, hy + 26, [[0, 'rgba(150,170,215,0)'], [0.35, 'rgba(150,170,215,0.09)'], [1, 'rgba(150,170,215,0)']]);
  ctx.fillRect(0, hy - 8, L.w, 34);
  farLamps(ctx, L, G);
  // cây tầng giữa (sau màn hình) — xa trước gần sau
  const pr = G.pr;
  for (const [x, z, k, v] of [...BACK_TREES].sort((a, b) => a[1] - b[1])) {
    const s = pr.s(z) * k, px = pr.x(x, z);
    if (px < -3 * s || px > L.w + 3 * s) continue;
    drawTree(ctx, px, pr.y(z), s, v, TREE_PAL.far, x > W / 2);
  }
  // ánh màn hình hắt ra trời / cỏ quanh khung
  const cx = sc.x + sc.w / 2, cy = sc.y + sc.h / 2;
  const sg = ctx.createRadialGradient(cx, cy, sc.h * 0.35, cx, cy, Math.max(sc.w, sc.h) * 0.9);
  sg.addColorStop(0, 'rgba(140,165,255,0.16)');
  sg.addColorStop(1, 'rgba(140,165,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, L.w, bandH);
  drawInflatable(ctx, L, G);
  ctx.fillStyle = '#000';
  ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
  return { canvas: cv, h: bandH };
}

function milkyWay(ctx, L, hy) {
  ctx.save();
  ctx.translate(L.w * 0.5, hy * 0.42);
  ctx.rotate(-0.32);
  const bw = Math.max(60, hy * 0.32);
  ctx.fillStyle = vGrad(ctx, -bw, bw, [[0, 'rgba(150,160,235,0)'], [0.5, 'rgba(160,170,240,0.07)'], [1, 'rgba(150,160,235,0)']]);
  ctx.fillRect(-L.w, -bw, L.w * 2, bw * 2);
  ctx.fillStyle = 'rgba(220,226,255,0.35)';
  const n = Math.round(L.w / 5);
  for (let i = 0; i < n; i++) {
    const x = (hash2(i, 1, 313) - 0.5) * L.w * 1.6;
    const y = (hash2(i, 2, 313) + hash2(i, 3, 313) - 1) * bw * 0.8;
    const r = 0.45 + hash2(i, 4, 313) * 0.5;
    ctx.fillRect(x, y, r, r);
  }
  ctx.restore();
}

function stars(ctx, L, hy) {
  const n = clamp(Math.round((L.w * hy) / 2400), 30, 460);
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 3, 71) * L.w;
    const y = Math.pow(hash2(i, 5, 71), 1.35) * (hy - 14);
    const b = hash2(i, 7, 71);
    const a = (0.3 + 0.7 * b) * (1 - (y / hy) * 0.55);
    const size = b > 0.94 ? 1.9 : b > 0.72 ? 1.3 : 0.9;
    ctx.fillStyle = hash2(i, 9, 71) > 0.82 ? `rgba(255,232,196,${a})` : `rgba(222,230,255,${a})`;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    if (b > 0.965) {
      ctx.fillStyle = `rgba(222,230,255,${a * 0.45})`;
      ctx.fillRect(x - size * 2.2, y - 0.4, size * 4.4, 0.8);
      ctx.fillRect(x - 0.4, y - size * 2.2, 0.8, size * 4.4);
    }
  }
}

function drawMoon(ctx, m) {
  const { x, y, r } = m;
  blitGlow(ctx, glow('235,232,200', 0.26), x, y, r * 6);
  blitGlow(ctx, glow('250,246,225', 0.38, 0.5), x, y, r * 2.1);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#f7f4e4');
  g.addColorStop(1, '#ddd8c0');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(170,165,140,0.16)';
  for (const [dx, dy, cr] of [[-0.32, -0.18, 0.22], [0.22, 0.28, 0.16], [0.38, -0.3, 0.12], [-0.12, 0.42, 0.1], [0.05, -0.02, 0.08]]) {
    ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, cr * r, 0, Math.PI * 2); ctx.fill();
  }
  // phần tối mờ phía phải (trăng gần tròn)
  ctx.fillStyle = 'rgba(40,44,90,0.16)';
  ctx.beginPath(); ctx.arc(x + r * 0.78, y + r * 0.08, r * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function skyline(ctx, L, G) {
  const hy = G.hy, u = G.u;
  const spans = [[0, G.inner.x - 10], [G.inner.x + G.inner.w + 10, L.w]];
  let id = 0;
  for (const [a, b] of spans) {
    let x = a - 4;
    while (x < b) {
      id++;
      const bw = u * (0.9 + hash2(id, 1, 77) * 1.8);
      const gap = hash2(id, 2, 77) < 0.3 ? u * (0.5 + hash2(id, 3, 77) * 2.5) : 0;
      const bh = u * (1.6 + hash2(id, 4, 77) * 3.4) * (hash2(id, 5, 77) < 0.15 ? 1.6 : 1);
      ctx.fillStyle = hash2(id, 6, 77) < 0.5 ? '#151634' : '#11132c';
      ctx.fillRect(x, hy - bh, bw, bh);
      // cửa sổ sáng lác đác
      for (let wy = hy - bh + u * 0.4; wy < hy - u * 0.6; wy += u * 0.55) {
        for (let wx = x + u * 0.25; wx < x + bw - u * 0.25; wx += u * 0.45) {
          const hh = hash2(Math.round(wx * 3), Math.round(wy * 3), id);
          if (hh > 0.86) {
            ctx.fillStyle = `rgba(255,214,150,${0.25 + (hh - 0.86) * 3.5})`;
            ctx.fillRect(wx, wy, Math.max(1, u * 0.16), Math.max(1, u * 0.2));
          }
        }
      }
      if (bh > u * 5.5) { // tháp có đèn đỏ
        ctx.fillStyle = '#151634';
        ctx.fillRect(x + bw / 2 - 0.6, hy - bh - u * 1.2, 1.2, u * 1.2);
        blitGlow(ctx, glow('255,80,80', 0.7), x + bw / 2, hy - bh - u * 1.2, 3.5);
      }
      x += bw + gap;
    }
  }
}

function treeLine(ctx, L, G) {
  const hy = G.hy, u = G.u;
  for (const [col, r0, r1, y0, y1, seed] of [['#151c38', 1.0, 1.9, 0.8, 1.9, 5], ['#0b1222', 0.7, 1.3, 0.1, 0.7, 9]]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    let x = -10, i = 0;
    while (x < L.w + 10) {
      const r = u * (r0 + hash2(i, 1, seed) * (r1 - r0));
      const cy = hy - u * (y0 + hash2(i, 2, seed) * (y1 - y0));
      ctx.moveTo(x + r, cy);
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      if (seed === 5 && hash2(i, 3, seed) > 0.85) { // cây dáng thuôn (bạch đàn / thông) cao hơn
        ctx.moveTo(x - r * 0.5, cy);
        ctx.quadraticCurveTo(x, cy - r * 3.2, x + r * 0.5, cy);
      }
      x += r * (1.0 + hash2(i, 4, seed) * 0.6);
      i++;
    }
    ctx.fill();
    ctx.fillRect(0, hy - u * (seed === 5 ? 0.9 : 0.25), L.w, u * 1.2);
  }
}

function lawnStripes(ctx, L, G, bandH) {
  const pr = G.pr;
  const zh = (G.hy - L.Yf) / pr.k;
  ctx.fillStyle = 'rgba(120,200,150,0.028)';
  for (let x = -16, i = 0; x < W + 16; x += 2.2, i++) {
    if (i % 2) continue;
    ctx.beginPath();
    ctx.moveTo(pr.x(x, zh), G.hy);
    ctx.lineTo(pr.x(x + 2.2, zh), G.hy);
    ctx.lineTo(pr.x(x + 2.2, 0), bandH);
    ctx.lineTo(pr.x(x, 0), bandH);
    ctx.closePath();
    ctx.fill();
  }
}

function farLamps(ctx, L, G) {
  const pr = G.pr;
  for (const [x, z] of [[-5.5, -4.2], [-8.5, -8.5], [-3.2, -11], [39.5, -4.2], [42.5, -8.5], [37.2, -11]]) {
    const y0 = pr.y(z), s = pr.s(z) * 0.95, px = pr.x(x, z);
    if (y0 < G.hy + 2 || px < -20 || px > L.w + 20) continue;
    ctx.fillStyle = 'rgba(255,190,110,0.07)';
    ctx.beginPath(); ctx.ellipse(px, y0, s * 1.4, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b120f';
    ctx.fillRect(px - Math.max(0.6, s * 0.03), y0 - s * 2.5, Math.max(1.2, s * 0.06), s * 2.5);
    blitGlow(ctx, glow('255,200,120', 0.55), px, y0 - s * 2.6, s * 0.9);
    ctx.fillStyle = '#ffe2a6';
    ctx.beginPath(); ctx.arc(px, y0 - s * 2.6, Math.max(1, s * 0.09), 0, Math.PI * 2); ctx.fill();
  }
}

// ================================================================ màn hình bơm hơi
function drawInflatable(ctx, L, G) {
  const { inner: I, t, pw, pL, pR, capY, ground } = G;
  // dây néo: đỉnh cột → cọc cắm trên cỏ (vẽ trước, cột che chỗ buộc)
  ctx.save();
  ctx.lineCap = 'round';
  for (const [pc, dir] of [[pL, -1], [pR, 1]]) {
    if ((dir < 0 ? pc : L.w - pc) < pw * 2 + 24) continue; // không còn chỗ cạnh màn hình (điện thoại dọc)
    for (const [hk, reach] of [[0.18, 0.52], [0.5, 0.3]]) {
      const ax = pc + dir * pw * 0.3, ay = capY + (ground - capY) * hk;
      const by = G.hy + (L.Yf - G.hy) * 0.62;
      const bx = pc + dir * Math.min((by - ay) * reach + pw, dir < 0 ? pc - 6 : L.w - pc - 6);
      ctx.strokeStyle = 'rgba(205,212,230,0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 6, bx, by);
      ctx.stroke();
      ctx.fillStyle = '#c9c3b2';
      ctx.fillRect(bx - 1, by - 3, 2, 4);
    }
  }
  ctx.restore();
  // khung ống (vòng chữ nhật bo góc) — tối, phồng: dải giữa sáng hơn + vệt bóng phía trên-trái
  const ox = I.x - t, oy = I.y - t, ow = I.w + t * 2, oh = I.h + t * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  rrPath(ctx, ox, oy, ow, oh, t * 1.15);
  ctx.fillStyle = '#1a1d25';
  ctx.fill();
  ctx.restore();
  const mid = (lw, col, off) => {
    rrPath(ctx, I.x - t / 2 + off, I.y - t / 2 + off, I.w + t, I.h + t, t * 0.65);
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  mid(t * 0.62, '#323744', 0);
  mid(t * 0.26, 'rgba(104,113,140,0.8)', -t * 0.13);
  mid(Math.max(1, t * 0.09), 'rgba(220,230,255,0.45)', -t * 0.2);
  // đường nối các khúc ống
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  const seams = Math.max(2, Math.round(I.w / (t * 7)));
  for (let i = 1; i < seams; i++) {
    const x = I.x + (I.w * i) / seams;
    ctx.beginPath(); ctx.moveTo(x, oy + 1); ctx.lineTo(x, I.y - 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, I.y + I.h + 1); ctx.lineTo(x, oy + oh - 1); ctx.stroke();
  }
  // viền đen sát màn hình
  ctx.fillStyle = '#050608';
  ctx.fillRect(I.x, I.y, I.w, I.h);
  // hai cột hơi (đứng trước khung, che hai cạnh ống): chồng các khúc phồng, eo lại ở chỗ nối
  for (const pc of [pL, pR]) {
    const x0 = pc - pw / 2;
    const segH = pw * 2.3;
    const grad = hGrad(ctx, x0, x0 + pw, [[0, '#121419'], [0.22, '#4a5163'], [0.42, '#363b49'], [0.8, '#1d2028'], [1, '#0e1014']]);
    for (let y = capY, i = 0; y < ground; y += segH, i++) {
      const h = Math.min(segH + 2, ground - y + 2);
      const pinch = i === 0 ? 0 : pw * 0.045;
      ctx.fillStyle = grad;
      rrPath(ctx, x0 + pinch, y, pw - pinch * 2, h, i === 0 ? [pw / 2, pw / 2, pw * 0.36, pw * 0.36] : pw * 0.36);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x0 + pw * 0.1, y + h - 3, pw * 0.8, 2);
      ctx.fillStyle = 'rgba(215,226,255,0.32)';
      rrPath(ctx, x0 + pw * 0.2, y + h * 0.14, Math.max(1.2, pw * 0.09), h * 0.68, pw * 0.05);
      ctx.fill();
    }
    // đèn báo trên đỉnh cột
    blitGlow(ctx, glow('255,96,96', 0.55), pc, capY + pw * 0.28, pw * 0.7);
    ctx.fillStyle = '#ff8a8a';
    ctx.beginPath(); ctx.arc(pc, capY + pw * 0.28, Math.max(1.2, pw * 0.1), 0, Math.PI * 2); ctx.fill();
  }
}

// ================================================================ hiệu ứng mỗi khung (stage đã cắt bỏ khung video)
export function skyFx(ctx, L, now) {
  const G = sceneGeo(L);
  for (const st of G.twinkle) {
    const k = 0.5 + 0.5 * Math.sin(now / st.per + st.ph);
    const a = 0.15 + 0.85 * k * k;
    const r = st.r * (0.7 + 0.5 * k);
    ctx.fillStyle = `rgba(232,238,255,${a})`;
    ctx.fillRect(st.x - r * 0.5, st.y - r * 0.5, r, r);
    ctx.fillStyle = `rgba(232,238,255,${a * 0.5})`;
    ctx.fillRect(st.x - r * 2.2, st.y - 0.35, r * 4.4, 0.7);
    ctx.fillRect(st.x - 0.35, st.y - r * 2.2, 0.7, r * 4.4);
  }
  // sao băng: mỗi ~9 s một vệt ngắn ở vùng trời trống
  const P = 9000, cyc = Math.floor(now / P), el = now - cyc * P;
  if (el < 850) {
    const left = hash2(cyc, 1, 55) < 0.5;
    const span = left ? G.sideL : L.w - G.sideR;
    if (span > 120 && G.skyLimit > 90) {
      const k = el / 850;
      const len = clamp(span * 0.45, 50, 160);
      const x0 = left ? 20 + hash2(cyc, 2, 55) * (span - 40) : G.sideR + 20 + hash2(cyc, 2, 55) * (span - 40);
      const y0 = 50 + hash2(cyc, 3, 55) * (G.skyLimit * 0.45);
      const dx = (left ? -1 : 1) * 0.86, dy = 0.5;
      const hx = x0 + dx * len * k, hyy = y0 + dy * len * k;
      const tail = len * 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.15));
      const g = ctx.createLinearGradient(hx, hyy, hx - dx * tail, hyy - dy * tail);
      const a = 0.85 * Math.sin(Math.PI * k);
      g.addColorStop(0, `rgba(255,250,235,${a})`);
      g.addColorStop(1, 'rgba(255,250,235,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hyy); ctx.lineTo(hx - dx * tail, hyy - dy * tail); ctx.stroke();
    }
  }
}
