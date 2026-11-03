// Rạp Công Viên — mặt đất + lớp phòng (cache theo camera):
// texture nhìn từ trên: cỏ đêm (ngọn cỏ lấm tấm, vệt cắt cỏ), lối sỏi dọc hai lối đi + lối ngang sau hàng cuối (xuyên qua cổng
// hàng rào), thảm picnic caro dưới mỗi dãy gối lười, sàn nhảy bằng ván gỗ, vũng sáng dưới cột đèn, bóng hàng rào.
// drawRoom: trải sàn theo phối cảnh → đèn dây viền sàn gỗ → bục gỗ trước màn hình (đèn dây rủ) → (cắt bỏ khung video) cây
// tán tròn, cột đèn + dây đèn nháy, hàng rào cây thấp hai bên. Ngoài hàng rào không ai đi tới (x < 1,3) nên vẽ ở lớp này
// luôn đúng thứ tự trước / sau với người (vật ở phía ngoài không bao giờ che vật ở phía trong).
import { HALL } from '../../shared/hall.js';
import { hash2 } from '../../util.js';
import { makeCanvas, vGrad, hGrad, rrPath } from '../draw.js';
import { poly, drawFloor } from '../persp.js';
import {
  C, W, H, XL, XR, ZW, glow, blitGlow, blitTree, blitLamp, LAMP_H, TREES, LAMPS, STRINGS, GATE, BULB_COLORS,
} from './congvien-art.js';

const STAGE_H = 0.75; // cao bục (bố cục stage.js giả định đúng số này)
const TEX = { x0: -10, x1: W + 10, z0: -0.3, z1: H + 7 };
const AISLES = (() => {
  const b = HALL.blocks;
  return [[b[0].x0 + b[0].n, b[1].x0], [b[1].x0 + b[1].n, b[2].x0]];
})();
const CROSS = { z0: 14.75, z1: 16.25 }; // lối đi ngang sau hàng cuối (chỗ xuất hiện)

// ================================================================ texture sàn
function grassTile(px) {
  const cv = makeCanvas(px, px);
  const g = cv.getContext('2d');
  g.fillStyle = C.grass;
  g.fillRect(0, 0, px, px);
  const n = Math.round((px * px) / 26);
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, 501) * px, y = hash2(i, 2, 501) * px;
    const len = 2 + hash2(i, 3, 501) * 4, a = (hash2(i, 4, 501) - 0.5) * 0.9;
    const h = hash2(i, 5, 501);
    g.strokeStyle = h > 0.55 ? `rgba(70,140,95,${0.18 + (h - 0.55) * 0.5})` : `rgba(4,18,10,${0.2 + h * 0.4})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len);
    g.stroke();
  }
  // hoa dại li ti (rất ít)
  for (let i = 0; i < px / 24; i++) {
    g.fillStyle = hash2(i, 9, 501) > 0.5 ? 'rgba(235,235,255,0.35)' : 'rgba(255,220,150,0.3)';
    g.fillRect(hash2(i, 7, 501) * px, hash2(i, 8, 501) * px, 1.5, 1.5);
  }
  return cv;
}

/** vẽ một lần: cỏ, lối sỏi, thảm caro, sàn gỗ, vũng đèn (ô; scale px / ô) */
export function floorTexture(scale = 48) {
  const cv = makeCanvas((TEX.x1 - TEX.x0) * scale, (TEX.z1 - TEX.z0) * scale);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = ctx.createPattern(grassTile(Math.round(scale * 4)), 'repeat');
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, -TEX.x0 * scale, -TEX.z0 * scale);
  // mảng cỏ đậm / nhạt lớn (cỏ tự nhiên không đều)
  for (let i = 0; i < 150; i++) {
    const x = TEX.x0 + hash2(i, 1, 61) * (TEX.x1 - TEX.x0), z = TEX.z0 + hash2(i, 2, 61) * (TEX.z1 - TEX.z0);
    const r = 0.8 + hash2(i, 3, 61) * 2.6;
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    const light = hash2(i, 4, 61) > 0.5;
    const col = light ? '60,120,80' : '0,10,4';
    g.addColorStop(0, `rgba(${col},${light ? 0.1 : 0.16})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, z - r, r * 2, r * 2);
  }
  // vệt máy cắt cỏ (dọc về phía màn hình → chụm theo phối cảnh)
  ctx.fillStyle = 'rgba(150,225,175,0.035)';
  for (let x = XL, i = 0; x < XR; x += 1.6, i++) if (i % 2) ctx.fillRect(x, TEX.z0, 1.6, TEX.z1 - TEX.z0);
  // ngoài hàng rào: cỏ tối hơn, mép xa tan vào màu nền
  ctx.fillStyle = 'rgba(0,8,4,0.24)';
  ctx.fillRect(TEX.x0, TEX.z0, XL - 0.55 - TEX.x0, TEX.z1 - TEX.z0);
  ctx.fillRect(XR + 0.55, TEX.z0, TEX.x1 - XR - 0.55, TEX.z1 - TEX.z0);
  ctx.fillStyle = hGrad(ctx, TEX.x0, TEX.x0 + 4, [[0, C.void], [1, 'rgba(7,18,13,0)']]);
  ctx.fillRect(TEX.x0, TEX.z0, 4, TEX.z1 - TEX.z0);
  ctx.fillStyle = hGrad(ctx, TEX.x1 - 4, TEX.x1, [[0, 'rgba(7,18,13,0)'], [1, C.void]]);
  ctx.fillRect(TEX.x1 - 4, TEX.z0, 4, TEX.z1 - TEX.z0);
  // bóng hàng rào đổ vào trong
  ctx.fillStyle = hGrad(ctx, XL, XL + 0.7, [[0, 'rgba(0,0,0,0.34)'], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(XL, TEX.z0, 0.7, TEX.z1 - TEX.z0);
  ctx.fillStyle = hGrad(ctx, XR - 0.7, XR, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.34)']]);
  ctx.fillRect(XR - 0.7, TEX.z0, 0.7, TEX.z1 - TEX.z0);
  drawPaths(ctx);
  HALL.rows.forEach((z, r) => HALL.blocks.forEach((b, bi) => drawBlanket(ctx, b.x0 + 0.08, z - 0.68, b.n - 0.16, 1.2, (r * 3 + bi * 2 + 1) % BLANKETS.length, r * 7 + bi)));
  drawDeckTex(ctx);
  // vũng sáng ấm dưới cột đèn (lệch vào trong một chút)
  for (const l of LAMPS) {
    const x = l.x + (l.x < W / 2 ? 0.5 : -0.5);
    const g = ctx.createRadialGradient(x, l.z, 0, x, l.z, 2.4);
    g.addColorStop(0, 'rgba(255,196,120,0.2)');
    g.addColorStop(0.5, 'rgba(255,196,120,0.07)');
    g.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 2.4, l.z - 2.4, 4.8, 4.8);
  }
  // bóng bục gỗ đổ xuống cỏ
  ctx.fillStyle = vGrad(ctx, 0, 0.7, [[0, 'rgba(0,0,0,0.42)'], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(XL, 0, XR - XL, 0.7);
  return { canvas: cv, ...TEX, scale };
}

function wobblyRect(ctx, x0, z0, x1, z1, along, seed) {
  // along = 'z': mép trái / phải gợn; 'x': mép trên / dưới gợn
  const n = Math.max(2, Math.ceil((along === 'z' ? z1 - z0 : x1 - x0) / 0.25));
  const wob = (i, side) => (hash2(i, side, seed) - 0.5) * 0.09 + Math.sin(i * 0.9 + side * 2 + seed) * 0.03;
  ctx.beginPath();
  if (along === 'z') {
    for (let i = 0; i <= n; i++) { const z = z0 + ((z1 - z0) * i) / n; i ? ctx.lineTo(x0 + wob(i, 1), z) : ctx.moveTo(x0 + wob(i, 1), z); }
    for (let i = n; i >= 0; i--) ctx.lineTo(x1 + wob(i, 2), z0 + ((z1 - z0) * i) / n);
  } else {
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; i ? ctx.lineTo(x, z0 + wob(i, 1)) : ctx.moveTo(x, z0 + wob(i, 1)); }
    for (let i = n; i >= 0; i--) ctx.lineTo(x0 + ((x1 - x0) * i) / n, z1 + wob(i, 2));
  }
  ctx.closePath();
}

function drawPaths(ctx) {
  const d = HALL.danceFloor;
  const rects = [
    ...AISLES.map(([a0, a1], i) => [a0 + 0.12, d.y + d.h - 0.1, a1 - 0.12, CROSS.z0 + 0.2, 'z', 11 + i]),
    [TEX.x0, CROSS.z0, TEX.x1, CROSS.z1, 'x', 17],
  ];
  for (const [x0, z0, x1, z1, along, seed] of rects) {
    ctx.save();
    wobblyRect(ctx, x0, z0, x1, z1, along, seed);
    ctx.fillStyle = C.path;
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = C.pathEdge;
    ctx.stroke();
    ctx.clip();
    // sỏi li ti
    const area = (x1 - x0) * (z1 - z0);
    const cols = ['#4c4436', '#2b261d', '#5a5241', '#3f382c', '#6a604c'];
    for (let i = 0; i < area * 70; i++) {
      const x = x0 + hash2(i, 1, seed) * (x1 - x0), z = z0 + hash2(i, 2, seed) * (z1 - z0);
      const r = 0.025 + hash2(i, 3, seed) * 0.035;
      ctx.fillStyle = cols[Math.floor(hash2(i, 4, seed) * cols.length)];
      ctx.fillRect(x - r, z - r, r * 2, r * 2);
    }
    // mép hơi tối (đất lẫn cỏ)
    ctx.lineWidth = 0.22;
    ctx.strokeStyle = 'rgba(10,22,14,0.35)';
    wobblyRect(ctx, x0, z0, x1, z1, along, seed);
    ctx.stroke();
    ctx.restore();
  }
}

// thảm picnic caro: [màu đậm, màu nền]
const BLANKETS = [['#8f2b37', '#c2b7a8'], ['#2b4884', '#b6bfcb'], ['#a77a27', '#c6bda3'], ['#2b6b4b', '#b8c2b0'], ['#7a3a86', '#c4b8c9']];

function drawBlanket(ctx, x, z, w, d, pi, seed) {
  const [dark, light] = BLANKETS[pi];
  ctx.save();
  ctx.translate(x + w / 2, z + d / 2);
  ctx.rotate((hash2(seed, 1, 93) - 0.5) * 0.03);
  ctx.translate(-w / 2, -d / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0.04, 0.05, w, d);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, d);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, d);
  ctx.clip();
  const cell = 0.45;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = dark;
  for (let i = 0; i * cell < w; i += 2) ctx.fillRect(i * cell, 0, cell, d);
  for (let j = 0; j * cell < d; j += 2) ctx.fillRect(0, j * cell, w, cell);
  ctx.globalAlpha = 1;
  // nếp vải + tối dần về mép (đêm)
  ctx.fillStyle = vGrad(ctx, 0, d, [[0, 'rgba(255,255,255,0.05)'], [1, 'rgba(0,0,0,0.25)']]);
  ctx.fillRect(0, 0, w, d);
  ctx.restore();
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(0.03, 0.03, w - 0.06, d - 0.06);
  // tua rua hai đầu
  ctx.strokeStyle = light;
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  for (let j = 0.08; j < d; j += 0.12) { ctx.moveTo(0, j); ctx.lineTo(-0.1, j); ctx.moveTo(w, j); ctx.lineTo(w + 0.1, j); }
  ctx.stroke();
  ctx.restore();
}

function drawDeckTex(ctx) {
  const d = HALL.danceFloor;
  ctx.save();
  rrPath(ctx, d.x, d.y, d.w, d.h, 0.15);
  ctx.fillStyle = C.deckLo;
  ctx.fill();
  ctx.clip();
  // ván dọc về phía màn hình, mỗi ván nhiều khúc dài ngắn khác màu
  const pw = 0.5;
  for (let i = 0, x = d.x; x < d.x + d.w - 0.01; i++, x += pw) {
    let z = d.y - hash2(i, 1, 37) * 2.4;
    let j = 0;
    while (z < d.y + d.h) {
      const len = 1.4 + hash2(i, j + 2, 37) * 2.2;
      const k = hash2(i, j + 40, 37);
      ctx.fillStyle = `rgb(${Math.round(66 + k * 30)},${Math.round(42 + k * 19)},${Math.round(24 + k * 10)})`;
      ctx.fillRect(x + 0.02, z + 0.03, pw - 0.04, len - 0.06);
      // vân gỗ
      ctx.fillStyle = 'rgba(40,20,8,0.22)';
      ctx.fillRect(x + 0.12 + k * 0.2, z + 0.1, 0.025, len - 0.2);
      z += len;
      j++;
    }
  }
  // ánh màn hình hắt lên phía trong, tối dần ra ngoài
  ctx.fillStyle = vGrad(ctx, d.y, d.y + d.h, [[0, 'rgba(170,190,255,0.12)'], [1, 'rgba(0,0,0,0.12)']]);
  ctx.fillRect(d.x, d.y, d.w, d.h);
  ctx.restore();
  ctx.lineWidth = 0.08;
  ctx.strokeStyle = '#24140a';
  rrPath(ctx, d.x, d.y, d.w, d.h, 0.15);
  ctx.stroke();
}

// ================================================================ lớp phòng
export function drawRoom(ctx, P, tex, L, dpr, step = 2) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, P, tex, dpr, P.Yf, L.h, step);
  ctx.restore();
  // sàn gỗ + bục nằm hẳn dưới mép video (mép sau bục thấp hơn mép video 0,3 ô)
  deckBorderLights(ctx, P, L);
  drawPlatform(ctx, P, L);
  // cây / cột đèn cao vươn lên cạnh màn hình: không bao giờ vẽ đè khung video
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, L.w, L.h);
  ctx.rect(L.screen.x - L.frame, L.screen.y - L.frame, L.screen.w + L.frame * 2, L.screen.h + L.frame * 2);
  ctx.clip('evenodd');
  sideScenery(ctx, P, L, dpr);
  ctx.restore();
}

function bulb(ctx, x, y, r, rgb, core = 1) {
  blitGlow(ctx, glow(rgb, 0.75, 0.18), x, y, r);
  ctx.fillStyle = `rgba(${rgb},${core})`;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.9, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
}

/** đèn dây nằm viền sàn gỗ (trước + hai bên; phía trong thưa hơn) */
function deckBorderLights(ctx, P, L) {
  const d = HALL.danceFloor;
  const pts = [];
  for (let x = d.x + 0.25; x < d.x + d.w; x += 0.62) pts.push([x, d.y + d.h + 0.02]);
  for (let z = d.y + 0.35; z < d.y + d.h - 0.2; z += 0.62) { pts.push([d.x - 0.02, z]); pts.push([d.x + d.w + 0.02, z]); }
  for (let x = d.x + 0.6; x < d.x + d.w; x += 1.3) pts.push([x, d.y - 0.02]);
  ctx.strokeStyle = 'rgba(15,10,6,0.7)';
  ctx.lineWidth = 0.8;
  const a = P.pt(d.x, d.y + d.h), b = P.pt(d.x + d.w, d.y + d.h), c = P.pt(d.x + d.w, d.y), e = P.pt(d.x, d.y);
  ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  pts.forEach(([x, z], i) => {
    const p = P.pt(x, z, 0.03);
    if (p.x < -10 || p.x > L.w + 10) return;
    bulb(ctx, p.x, p.y, Math.max(3, p.s * 0.2), BULB_COLORS[i % BULB_COLORS.length], 0.95);
  });
}

/** bục gỗ thấp dưới màn hình: mặt ván chụm về điểm tụ, mặt trước ốp ván ngang, đèn dây rủ */
function drawPlatform(ctx, P, L) {
  const tf0 = P.pt(XL, ZW, STAGE_H), tf1 = P.pt(XR, ZW, STAGE_H);
  const tn0 = P.pt(XL, 0, STAGE_H), tn1 = P.pt(XR, 0, STAGE_H);
  poly(ctx, [tf0, tf1, tn1, tn0], vGrad(ctx, tf0.y, tn0.y, [[0, '#3c2a1a'], [1, '#6b4a2c']]));
  ctx.strokeStyle = 'rgba(25,12,4,0.38)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = XL + 0.5; x < XR; x += 0.5) {
    const a = P.pt(x, ZW, STAGE_H), b = P.pt(x, 0, STAGE_H);
    if (b.x < -10 || b.x > L.w + 10) continue;
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // ánh màn hình hắt lên mặt bục
  const cx = L.Xc ?? L.w / 2;
  ctx.save();
  poly(ctx, [tf0, tf1, tn1, tn0]);
  ctx.clip();
  ctx.fillStyle = hGrad(ctx, cx - L.screen.w * 0.6, cx + L.screen.w * 0.6, [[0, 'rgba(150,175,255,0)'], [0.5, 'rgba(150,175,255,0.14)'], [1, 'rgba(150,175,255,0)']]);
  ctx.fillRect(0, tf0.y - 2, L.w, tn0.y - tf0.y + 4);
  ctx.restore();
  // mặt trước
  const f0 = P.pt(XL, 0, 0), f1 = P.pt(XR, 0, 0);
  poly(ctx, [tn0, tn1, f1, f0], vGrad(ctx, tn0.y, f0.y, [[0, C.deckHi], [0.12, C.deck], [1, '#2a180c']]));
  ctx.strokeStyle = 'rgba(20,10,4,0.5)';
  ctx.beginPath();
  for (const h of [0.25, 0.5]) {
    const a = P.pt(XL, 0, h), b = P.pt(XR, 0, h);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  for (let x = XL + 4; x < XR; x += 4) {
    const a = P.pt(x, 0, STAGE_H), b = P.pt(x, 0, 0);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,225,180,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(tn0.x, tn0.y); ctx.lineTo(tn1.x, tn1.y); ctx.stroke();
  // đèn dây rủ theo mép bục
  const span = 1.6;
  ctx.lineWidth = 0.9;
  let bi = 0;
  for (let x = XL + 0.5; x < XR - 0.4; x += span) {
    const x1 = Math.min(XR - 0.5, x + span);
    const A = P.pt(x, 0, 0.68), B = P.pt(x1, 0, 0.68), M = P.pt((x + x1) / 2, 0, 0.42);
    if (B.x < -20 || A.x > L.w + 20) { bi += 4; continue; }
    ctx.strokeStyle = 'rgba(20,12,6,0.85)';
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.quadraticCurveTo(M.x, 2 * M.y - (A.y + B.y) / 2, B.x, B.y);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const px = A.x + (B.x - A.x) * t;
      const py = A.y + (B.y - A.y) * t + 4 * t * (1 - t) * (M.y - (A.y + B.y) / 2);
      bulb(ctx, px, py, Math.max(3, A.s * 0.22), BULB_COLORS[bi++ % BULB_COLORS.length]);
    }
  }
}

/** ngoài hàng rào: cây (xa → gần), rồi cột đèn + dây đèn, rồi hàng rào — vật phía ngoài không bao giờ che vật phía trong */
function sideScenery(ctx, P, L, dpr) {
  const vis = (x, z, r) => {
    const px = P.sx(x, z), s = P.s(z);
    return px > -r * s && px < L.w + r * s && P.sy(z) - 4.6 * s < L.h;
  };
  for (const [x, z, k, v] of [...TREES].sort((a, b) => a[1] - b[1])) {
    if (!vis(x, z, 2.2 * k)) continue;
    blitTree(ctx, P.sx(x, z), P.sy(z), P.s(z) * k, dpr, v, 'near', x > W / 2);
  }
  // dây đèn nháy giữa hai cột cùng bên (võng xuống giữa)
  for (const st of STRINGS) {
    if (!vis(st.x, st.z1, 1) && !vis(st.x, st.z0, 1)) continue;
    const n = Math.max(3, Math.round((st.z1 - st.z0) / 0.55));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(P.pt(st.x, st.z0 + (st.z1 - st.z0) * t, LAMP_H - 0.42 - 0.42 * 4 * t * (1 - t)));
    }
    ctx.strokeStyle = 'rgba(12,12,10,0.8)';
    ctx.lineWidth = Math.max(0.8, pts[0].s * 0.025);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    for (let i = 1; i < n; i++) bulb(ctx, pts[i].x, pts[i].y + 1.5, Math.max(3, pts[i].s * 0.2), BULB_COLORS[(i + Math.round(st.z0)) % BULB_COLORS.length]);
  }
  for (const l of [...LAMPS].sort((a, b) => a.z - b.z)) {
    if (!vis(l.x, l.z, 1.5)) continue;
    const p = P.pt(l.x, l.z), s = p.s;
    blitLamp(ctx, p.x, p.y, s, dpr);
    const hy = p.y - LAMP_H * s;
    blitGlow(ctx, glow(C.warm, 0.34, 0.3), p.x, hy, s * 1.5);
    blitGlow(ctx, glow('255,236,190', 0.7), p.x, hy, s * 0.42);
  }
  hedge(ctx, P, L, -1);
  hedge(ctx, P, L, 1);
}

/** hàng rào cây xén thấp (mặt trong + mặt trên + mép lá lởm chởm + đốm lá), chừa cổng ở lối đi ngang */
function hedge(ctx, P, L, side) {
  const xi = side < 0 ? XL : XR, xo = xi + side * 0.58, hh = 0.62;
  for (const [z0, z1] of [[0.1, GATE.z0], [GATE.z1, H + 7]]) {
    const a = P.pt(xi, z0, 0), b = P.pt(xi, z1, 0), c = P.pt(xi, z1, hh), d = P.pt(xi, z0, hh);
    const e = P.pt(xo, z0, hh), f = P.pt(xo, z1, hh);
    if ((side < 0 && Math.max(a.x, e.x) < -30) || (side > 0 && Math.min(a.x, e.x) > L.w + 30)) continue;
    poly(ctx, [a, b, c, d], '#16341f');
    poly(ctx, [P.pt(xi, z0, hh * 0.62), P.pt(xi, z1, hh * 0.62), c, d], 'rgba(120,190,140,0.07)');
    poly(ctx, [a, b, P.pt(xi, z1, 0.16), P.pt(xi, z0, 0.16)], 'rgba(3,12,7,0.5)');
    poly(ctx, [e, d, c, f], '#22492f');
    if (z1 === GATE.z0) poly(ctx, [P.pt(xi, z1, 0), P.pt(xo, z1, 0), f, c], '#112a19');
    // mép lá lởm chởm + đốm lá (xa → gần)
    for (let z = z0 + 0.06, i = Math.round(z0 * 10); z < z1 - 0.04; z += 0.24, i++) {
      const p = P.pt(xi, z, hh), s = p.s;
      if (p.x < -s || p.x > L.w + s || p.y - s > L.h) continue;
      const j = hash2(i, side + 3, 81), q = hash2(i, side + 9, 81);
      const o = P.pt(xo, z, hh);
      ctx.fillStyle = '#22492f';
      ctx.beginPath(); ctx.arc(o.x, o.y + s * 0.02, s * (0.09 + 0.06 * q), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y + s * 0.03, s * (0.1 + 0.06 * j), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(150,215,170,0.22)';
      ctx.beginPath(); ctx.arc(p.x - side * s * 0.03, p.y - s * 0.02, s * (0.05 + 0.03 * j), 0, Math.PI * 2); ctx.fill();
      const bse = P.pt(xi, z + 0.12, 0.05);
      ctx.fillStyle = '#0d2214';
      ctx.beginPath(); ctx.arc(bse.x, bse.y, s * (0.07 + 0.05 * q), 0, Math.PI * 2); ctx.fill();
      const sz = Math.max(1.2, s * 0.05);
      const m = P.pt(xi, z + 0.1, 0.12 + 0.42 * j);
      ctx.fillStyle = q > 0.5 ? 'rgba(110,180,130,0.3)' : 'rgba(0,0,0,0.28)';
      ctx.fillRect(m.x - sz / 2, m.y - sz / 2, sz, sz);
      const t = P.pt(xi + (xo - xi) * q, z + 0.05, hh);
      ctx.fillStyle = j > 0.5 ? 'rgba(140,210,160,0.3)' : 'rgba(0,10,4,0.3)';
      ctx.fillRect(t.x - sz / 2, t.y - sz / 2, sz, sz * 0.7);
    }
  }
}
