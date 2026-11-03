// Rạp Bãi Biển — hình vẽ dùng lại (px CSS, không phụ thuộc phối cảnh): cây dừa, đuốc tiki + ngọn lửa, thân tre, dây
// thừng buộc, quầng sáng vẽ sẵn. Vẽ thủ tục, không ảnh. Dùng bởi render/venues/bien.js.
import { makeCanvas } from '../draw.js';
import { hash2 } from '../../util.js';

export const ART = {
  bamboo: '#a98f5a', bambooLo: '#6d5a35', bambooHi: '#d6c18c', bambooNode: '#54442a',
  rope: '#b9a277', ropeLo: '#6f5e40',
  trunk: '#4b3b2c', trunkLo: '#2a2018',
  frond: '#244a33', frondLo: '#173223', frondHi: '#3a6b4a',
  nut: '#4f4525',
  basket: '#6a4d2d', basketLo: '#3c2a17',
};

// ---------------------------------------------------------------- quầng sáng vẽ sẵn (dán bằng drawImage, rẻ hơn gradient)
const glows = new Map();
/** quầng tròn mềm màu "r,g,b" (64×64) — dán với globalCompositeOperation 'lighter' */
export function glowSprite(rgb = '255,170,80') {
  let cv = glows.get(rgb);
  if (cv) return cv;
  cv = makeCanvas(64, 64);
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.25, `rgba(${rgb},0.5)`);
  gr.addColorStop(0.6, `rgba(${rgb},0.14)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glows.set(rgb, cv);
  return cv;
}

/** vũng sáng trên sàn (64×64): tắt dần đều tới mép — dùng cho quầng dưới chân người nhảy, đốm đèn quét */
export function poolSprite(rgb = '255,170,90') {
  const key = `pool|${rgb}`;
  let cv = glows.get(key);
  if (cv) return cv;
  cv = makeCanvas(64, 64);
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.45, `rgba(${rgb},0.6)`);
  gr.addColorStop(0.8, `rgba(${rgb},0.18)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glows.set(key, cv);
  return cv;
}

/** dán quầng sáng tâm (x, y), bán kính rx × ry, độ đậm a (giữ nguyên globalAlpha cũ) */
export function stampGlow(ctx, sprite, x, y, rx, ry, a) {
  if (a <= 0.004 || rx < 0.5 || ry < 0.5) return;
  const old = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = old;
}

// ---------------------------------------------------------------- tre, dây
/** thân tre đứng: (x, y0) góc trên trái, tới y1, rộng w, đốt cách nhau seg px */
export function bambooV(ctx, x, y0, y1, w, seg) {
  if (y1 - y0 < 0.5 || w < 0.3) return;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, ART.bambooLo);
  g.addColorStop(0.28, ART.bambooHi);
  g.addColorStop(0.55, ART.bamboo);
  g.addColorStop(1, ART.bambooLo);
  ctx.fillStyle = g;
  ctx.fillRect(x, y0, w, y1 - y0);
  if (seg < 4) return;
  const nh = Math.max(0.8, w * 0.16);
  for (let y = y1 - seg * 0.7; y > y0 + nh * 2; y -= seg) {
    ctx.fillStyle = ART.bambooNode;
    ctx.fillRect(x - w * 0.07, y, w * 1.14, nh);
    ctx.fillStyle = 'rgba(255,238,190,0.32)';
    ctx.fillRect(x, y + nh, w, Math.max(0.5, nh * 0.45));
  }
}

/** thân tre nằm ngang: (x0, y) góc trên trái tới x1, dày h */
export function bambooH(ctx, x0, x1, y, h, seg) {
  if (x1 - x0 < 0.5 || h < 0.3) return;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, ART.bambooHi);
  g.addColorStop(0.4, ART.bamboo);
  g.addColorStop(1, ART.bambooLo);
  ctx.fillStyle = g;
  ctx.fillRect(x0, y, x1 - x0, h);
  if (seg < 4) return;
  const nw = Math.max(0.8, h * 0.16);
  for (let x = x0 + seg * 0.6; x < x1 - nw * 2; x += seg) {
    ctx.fillStyle = ART.bambooNode;
    ctx.fillRect(x, y - h * 0.07, nw, h * 1.14);
    ctx.fillStyle = 'rgba(255,238,190,0.28)';
    ctx.fillRect(x + nw, y, Math.max(0.5, nw * 0.45), h);
  }
}

/** dây thừng quấn chéo (chỗ buộc) quanh khung (x, y, w, h) */
export function lashing(ctx, x, y, w, h) {
  const lw = Math.max(0.8, Math.min(w, h) * 0.18);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = ART.ropeLo;
  ctx.lineWidth = lw * 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.strokeStyle = ART.rope;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.beginPath();
  const n = Math.max(2, Math.round(h / (lw * 2.2)));
  for (let i = 0; i <= n; i++) {
    const yy = y + (h * i) / n;
    ctx.moveTo(x - lw * 0.3, yy); ctx.lineTo(x + w + lw * 0.3, yy);
  }
  ctx.lineWidth = lw * 0.7;
  ctx.stroke();
  ctx.restore();
}

/** dây thừng võng từ a tới b (độ võng sag px), nét kép cho ra sợi xoắn */
export function ropeLine(ctx, ax, ay, bx, by, sag, lw) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag * 2, bx, by);
  ctx.strokeStyle = ART.ropeLo;
  ctx.lineWidth = lw * 1.6;
  ctx.stroke();
  ctx.strokeStyle = ART.rope;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- cây dừa
/**
 * Cây dừa (px): gốc (bx, by), cao hp px, ngọn lệch lean px (âm = sang trái). seed → biến thể.
 * o.far (0..1): càng xa càng tối & lẫn vào trời; o.rimSide: -1 / 1 phía trăng hắt viền sáng (0 = từ trên);
 * o.warmSide: -1 / 1 phía có đuốc (viền ấm), 0 = không.
 * Trả về khung bao { x0, y0, x1, y1 } (px).
 */
export function drawPalm(ctx, bx, by, hp, lean, seed, o = {}) {
  const far = o.far || 0;
  const rimSide = o.rimSide || 0;
  const tx = bx + lean, ty = by - hp;
  // thân: Bézier bậc hai — gốc ngả mạnh rồi vươn thẳng dần lên ngọn
  const cx = bx + lean * 0.9, cy = by - hp * 0.42;
  const w0 = hp * 0.072, w1 = hp * 0.04;
  const N = 16;
  const L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * bx + 2 * u * t * cx + t * t * tx;
    const y = u * u * by + 2 * u * t * cy + t * t * ty;
    const dx = 2 * u * (cx - bx) + 2 * t * (tx - cx), dy = 2 * u * (cy - by) + 2 * t * (ty - cy);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = (w1 + (w0 - w1) * u + w0 * 0.55 * Math.pow(u, 6)) / 2;
    L.push([x + nx * w, y + ny * w]);
    R.push([x - nx * w, y - ny * w]);
  }
  const trunk = far ? mixRgb(ART.trunk, '#141b2e', far * 0.75) : ART.trunk;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fillStyle = trunk;
  ctx.fill();
  // viền sáng (trăng) dọc một mép thân
  const rimPts = rimSide < 0 ? R : L;
  ctx.strokeStyle = far ? `rgba(170,195,235,${0.22 * (1 - far * 0.6)})` : 'rgba(200,215,240,0.28)';
  ctx.lineWidth = Math.max(0.6, w0 * 0.22);
  ctx.beginPath();
  ctx.moveTo(rimPts[2][0], rimPts[2][1]);
  for (let i = 3; i < rimPts.length; i++) ctx.lineTo(rimPts[i][0], rimPts[i][1]);
  ctx.stroke();
  if (o.warmSide) {
    const wp = o.warmSide < 0 ? R : L;
    ctx.strokeStyle = 'rgba(255,165,85,0.32)';
    ctx.lineWidth = Math.max(0.8, w0 * 0.3);
    ctx.beginPath();
    ctx.moveTo(wp[0][0], wp[0][1]);
    for (let i = 1; i < wp.length * 0.7; i++) ctx.lineTo(wp[i][0], wp[i][1]);
    ctx.stroke();
  }
  // vòng đốt thân dừa
  ctx.strokeStyle = far ? 'rgba(8,10,20,0.35)' : 'rgba(25,17,10,0.55)';
  ctx.lineWidth = Math.max(0.5, hp * 0.007);
  ctx.beginPath();
  const rings = Math.max(4, Math.round(hp / Math.max(3.5, hp * 0.055)));
  for (let k = 1; k < rings; k++) {
    const i = Math.round((k / rings) * N);
    const a = L[i], b = R[i];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + hp * 0.008;
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mx, my + hp * 0.01, b[0], b[1]);
  }
  ctx.stroke();

  // tàu lá: vẽ lá phía sau (chĩa lên) trước, lá rủ hai bên sau
  const n = 8 + Math.floor(hash2(seed, 1, 5) * 2);
  const base = [198, 168, 142, 116, 92, 66, 40, 14, -14, 186];
  const fronds = [];
  for (let i = 0; i < n; i++) {
    const deg = base[i] + (hash2(seed, i, 7) - 0.5) * 14;
    fronds.push({ th: (deg * Math.PI) / 180, i, up: Math.sin((deg * Math.PI) / 180) });
  }
  fronds.sort((a, b) => b.up - a.up);
  const fl = hp * 0.5;
  let x0 = Math.min(bx, tx) - w0, x1 = Math.max(bx, tx) + w0, y0 = ty, y1 = by;
  const drawOne = (f, dark) => {
    const r = hash2(seed, f.i, 11);
    const len = fl * (0.78 + r * 0.32) * (1 - Math.max(0, f.up) * 0.28);
    const droop = len * (0.5 - Math.max(0, f.up) * 0.25);
    const lift = len * (0.3 + Math.max(0, f.up) * 0.2);
    const dx = Math.cos(f.th), dy = -Math.sin(f.th);
    const M = 12;
    const pts = [];
    for (let j = 0; j <= M; j++) {
      const t = j / M;
      pts.push([tx + dx * len * t, ty + dy * len * t - lift * Math.sin(Math.PI * t * 0.8) + droop * t * t]);
    }
    const side1 = [], side2 = [];
    const wmax = len * 0.2;
    for (let j = 0; j <= M; j++) {
      const t = j / M;
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(M, j + 1)];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      const tx2 = ex / el, ty2 = ey / el;
      let nx = -ty2, ny = tx2;
      if (ny > 0) { nx = -nx; ny = -ny; } // n1: mép trên
      const w = wmax * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.02)), 0.75) * (1 - 0.3 * t);
      const out = j % 2 === 1 ? 1 : 0.42;
      const back = j % 2 === 1 ? w * 0.45 : 0;
      side1.push([pts[j][0] + nx * w * 0.85 * out - tx2 * back, pts[j][1] + ny * w * 0.85 * out - ty2 * back]);
      side2.push([pts[j][0] - nx * w * 1.15 * out - tx2 * back + 0, pts[j][1] - ny * w * 1.15 * out - ty2 * back + w * 0.25 * out]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of side1) ctx.lineTo(p[0], p[1]);
    for (let j = side2.length - 1; j >= 0; j--) ctx.lineTo(side2[j][0], side2[j][1]);
    ctx.closePath();
    let col = dark ? ART.frondLo : r > 0.5 ? ART.frond : mixRgb(ART.frond, ART.frondHi, 0.35);
    if (far) col = mixRgb(col, '#121a2c', far * 0.7);
    ctx.fillStyle = col;
    ctx.fill();
    // gân lá
    ctx.strokeStyle = far ? `rgba(120,150,130,${0.25 * (1 - far)})` : 'rgba(150,180,120,0.45)';
    ctx.lineWidth = Math.max(0.5, hp * 0.006);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
    ctx.stroke();
    // viền trăng mép trên
    const rimK = rimSide === 0 ? 1 : 0.55 + 0.45 * Math.max(0, Math.sign(dx) * rimSide);
    ctx.strokeStyle = far ? `rgba(170,195,235,${0.3 * rimK * (1 - far * 0.5)})` : `rgba(190,215,245,${0.38 * rimK})`;
    ctx.lineWidth = Math.max(0.5, hp * 0.005);
    ctx.beginPath();
    ctx.moveTo(side1[1][0], side1[1][1]);
    for (let j = 2; j < side1.length; j++) ctx.lineTo(side1[j][0], side1[j][1]);
    ctx.stroke();
    if (o.warmSide && Math.sign(dx) === Math.sign(o.warmSide)) {
      ctx.strokeStyle = 'rgba(255,170,90,0.22)';
      ctx.lineWidth = Math.max(0.5, hp * 0.006);
      ctx.beginPath();
      ctx.moveTo(side2[2][0], side2[2][1]);
      for (let j = 3; j < side2.length; j++) ctx.lineTo(side2[j][0], side2[j][1]);
      ctx.stroke();
    }
    for (const p of side1.concat(side2)) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  };
  const nBack = Math.ceil(fronds.length * 0.35);
  for (let i = 0; i < nBack; i++) drawOne(fronds[i], true);
  // trái dừa chùm dưới ngọn
  const nr = hp * 0.034;
  const nuts = 3 + Math.floor(hash2(seed, 2, 9) * 2);
  for (let k = 0; k < nuts; k++) {
    const a = -0.3 + (k / Math.max(1, nuts - 1)) * 0.6 + Math.PI / 2;
    const px = tx + Math.cos(a) * nr * 1.5 - lean * 0.02, py = ty + nr * 0.9 + Math.sin(a) * nr * 0.6;
    ctx.beginPath();
    ctx.arc(px, py, nr, 0, Math.PI * 2);
    ctx.fillStyle = far ? mixRgb(ART.nut, '#141a2a', far * 0.7) : ART.nut;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - nr * 0.3, py - nr * 0.35, nr * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = far ? 'rgba(160,170,140,0.15)' : 'rgba(210,200,140,0.35)';
    ctx.fill();
  }
  for (let i = nBack; i < fronds.length; i++) drawOne(fronds[i], false);
  ctx.restore();
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------- đuốc tiki
/**
 * Cán tre + giỏ đuốc (px): chân (bx, by), s = px / ô, cao hs ô (cán). Trả về chân ngọn lửa { x, y }.
 */
export function drawTorchBody(ctx, bx, by, s, hs = 1.3) {
  const h = hs * s, w = Math.max(1.2, 0.085 * s);
  bambooV(ctx, bx - w / 2, by - h, by, w, 0.34 * s);
  // giỏ đan (hình thang loe miệng)
  const y0 = by - h, bh = 0.26 * s, bw0 = 0.12 * s, bw1 = 0.21 * s;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx - bw0 / 2, y0 + bh * 0.08);
  ctx.lineTo(bx - bw1 / 2, y0 - bh);
  ctx.lineTo(bx + bw1 / 2, y0 - bh);
  ctx.lineTo(bx + bw0 / 2, y0 + bh * 0.08);
  ctx.closePath();
  ctx.fillStyle = ART.basket;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = ART.basketLo;
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  ctx.beginPath();
  for (let k = -3; k <= 3; k++) {
    const x = bx + k * bw1 * 0.17;
    ctx.moveTo(x - bh * 0.5, y0 + bh * 0.1); ctx.lineTo(x + bh * 0.5, y0 - bh);
    ctx.moveTo(x + bh * 0.5, y0 + bh * 0.1); ctx.lineTo(x - bh * 0.5, y0 - bh);
  }
  ctx.stroke();
  ctx.restore();
  // miệng giỏ (than hồng)
  ctx.beginPath();
  ctx.ellipse(bx, y0 - bh, bw1 / 2, Math.max(0.6, bw1 * 0.16), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#3a1a0c';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(bx, y0 - bh, bw1 * 0.36, Math.max(0.4, bw1 * 0.1), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ff9a3c';
  ctx.fill();
  return { x: bx, y: y0 - bh };
}

function teardrop(ctx, x, y, w, h, sway, fill) {
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w * 1.3, y - h * 0.42, x + sway - w * 0.25, y - h * 0.78, x + sway, y - h);
  ctx.bezierCurveTo(x + sway + w * 0.25, y - h * 0.78, x + w * 1.3, y - h * 0.42, x + w, y);
  ctx.quadraticCurveTo(x, y + w * 0.7, x - w, y);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** ngọn lửa lập loè (px): chân (x, y), s = px / ô, t = ms, k = cỡ (0..1+) */
export function drawFlame(ctx, x, y, s, t, seed, k = 1) {
  const f = k * (0.88 + 0.09 * Math.sin(t / 83 + seed * 5.1) + 0.06 * Math.sin(t / 29 + seed * 2.3));
  const hh = 0.44 * s * f, ww = 0.1 * s * k;
  const sway = (Math.sin(t / 170 + seed) + 0.5 * Math.sin(t / 57 + seed * 3)) * 0.03 * s * k;
  teardrop(ctx, x, y, ww, hh, sway, '#f0641c');
  teardrop(ctx, x, y + hh * 0.02, ww * 0.68, hh * 0.7, sway * 0.7, '#ffa634');
  teardrop(ctx, x, y + hh * 0.03, ww * 0.36, hh * 0.38, sway * 0.4, '#fff0b5');
  return hh;
}

// ---------------------------------------------------------------- ván lướt sóng, lâu đài cát, phao
/** ván lướt sóng cắm cát (px): chân (x, y), s = px / ô, nghiêng lean (rad) */
export function drawSurfboard(ctx, x, y, s, lean, col, stripe) {
  const L = 1.9 * s, w = 0.44 * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.beginPath();
  ctx.moveTo(0, -L);
  ctx.bezierCurveTo(w * 0.62, -L * 0.84, w * 0.56, -L * 0.22, w * 0.44, 0);
  ctx.lineTo(-w * 0.44, 0);
  ctx.bezierCurveTo(-w * 0.56, -L * 0.22, -w * 0.62, -L * 0.84, 0, -L);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = stripe;
  ctx.fillRect(-w * 0.08, -L, w * 0.16, L);
  ctx.fillRect(-w, -L * 0.62, w * 2, w * 0.1);
  const g = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = g;
  ctx.fillRect(-w, -L, w * 2, L);
  ctx.restore();
  ctx.strokeStyle = 'rgba(18,12,8,0.55)';
  ctx.lineWidth = Math.max(0.7, s * 0.02);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.75, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(95,84,66,0.95)';
  ctx.fill();
}

/** lâu đài cát nhỏ có cờ (px): chân giữa (x, y), s = px / ô */
export function drawSandcastle(ctx, x, y, s) {
  const lit = '#8d7c60', mid = '#76674f', dark = '#5b4f3c';
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.5, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  const tower = (cx, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(cx - w / 2, y - h, w, h);
    const n = 3, cw = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) ctx.fillRect(cx - w / 2 + i * cw * 2, y - h - cw * 0.9, cw, cw * 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(cx + w * 0.18, y - h, w * 0.32, h);
  };
  ctx.fillStyle = mid;
  ctx.fillRect(x - s * 0.34, y - s * 0.2, s * 0.68, s * 0.2);
  tower(x - s * 0.26, s * 0.18, s * 0.34, lit);
  tower(x + s * 0.26, s * 0.18, s * 0.3, mid);
  tower(x, s * 0.24, s * 0.5, lit);
  ctx.fillStyle = '#1e1810';
  ctx.fillRect(x - s * 0.035, y - s * 0.16, s * 0.07, s * 0.16);
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = Math.max(0.6, s * 0.02);
  ctx.beginPath(); ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x, y - s * 0.82); ctx.stroke();
  ctx.fillStyle = '#e2553f';
  ctx.beginPath(); ctx.moveTo(x, y - s * 0.82); ctx.lineTo(x + s * 0.17, y - s * 0.76); ctx.lineTo(x, y - s * 0.7); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** phao cứu sinh đỏ trắng (px), tâm (x, y), bán kính r */
export function drawLifebuoy(ctx, x, y, r) {
  ctx.save();
  ctx.lineWidth = r * 0.42;
  for (let k = 0; k < 4; k++) {
    ctx.strokeStyle = k % 2 ? '#e8e2d4' : '#c8423e';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, (k / 4) * Math.PI * 2 + 0.3, ((k + 1) / 4) * Math.PI * 2 + 0.3);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.5, r * 0.06);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * 0.56, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- màu
const rgbCache = new Map();
function hexRgb(c) {
  let v = rgbCache.get(c);
  if (!v) {
    const h = c.replace('#', '');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(c, v);
  }
  return v;
}
const hx = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** trộn hai màu #rrggbb (t = 0 → a, 1 → b) → #rrggbb (trộn tiếp được) */
export function mixRgb(a, b, t) {
  const p = hexRgb(a), q = hexRgb(b);
  return `#${hx(p[0] + (q[0] - p[0]) * t)}${hx(p[1] + (q[1] - p[1]) * t)}${hx(p[2] + (q[2] - p[2]) * t)}`;
}

/** làm tối (k < 0, pha đen) / sáng (k > 0, pha trắng) màu #rrggbb */
export function shadeRgb(c, k) {
  return mixRgb(c, k < 0 ? '#000000' : '#ffffff', Math.min(1, Math.abs(k)));
}
