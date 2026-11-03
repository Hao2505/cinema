// Rạp Công Viên — đồ vẽ dùng chung: bảng màu đêm, quầng sáng (gradient vẽ sẵn vào ảnh nhỏ → mỗi khung chỉ drawImage),
// cây tán tròn kiểu hoạt hình, cột đèn công viên cổ, vị trí cây / đèn, phép chiếu xấp xỉ cho dải trên.
import { HALL } from '../../shared/hall.js';
import { hash2 } from '../../util.js';
import { makeCanvas } from '../draw.js';

export const W = HALL.W, H = HALL.H;
export const XL = 1, XR = W - 1; // hai hàng rào cây (mặt trong)
export const ZW = -1.2; // mặt phẳng màn hình

export const C = {
  void: '#07120d',
  grass: '#143222',
  path: '#3a3328',
  pathEdge: '#262119',
  deck: '#5a3b22',
  deckLo: '#3b2414',
  deckHi: '#7a5434',
  iron: '#1b2420',
  ironHi: '#43554b',
  lampGlass: '#ffd98f',
  warm: '255,204,128',
};

// ================================================================ quầng sáng (ảnh 64 px, cache theo màu)
const glowCache = new Map();
/** ảnh quầng sáng tròn: rgb 'r,g,b', a0 = độ đậm ở tâm, mid (0..1) = giữ sáng tới đâu */
export function glow(rgb, a0 = 1, mid = 0) {
  const key = `${rgb}|${a0}|${mid}`;
  let cv = glowCache.get(key);
  if (!cv) {
    cv = makeCanvas(64, 64);
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},${a0})`);
    if (mid) gr.addColorStop(mid, `rgba(${rgb},${a0 * 0.45})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(key, cv);
  }
  return cv;
}

/** dán quầng sáng tâm (x, y), bán kính rx × ry (px) */
export function blitGlow(ctx, sprite, x, y, rx, ry = rx) {
  ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
}

// ================================================================ phép chiếu xấp xỉ từ bố cục (camera giữa, không phóng)
/** dùng cho dải trên (cố định, không lia theo camera) — khớp render/persp.js khi xcam = W/2, zoom = 1 */
export function approxProj(L) {
  const k = (L.Yn - L.Yf) / H;
  const ds = (L.s1 - L.s0) / H;
  const s = (z) => L.s0 + ds * z;
  return { k, s, x: (x, z) => L.Xc + (x - W / 2) * s(z), y: (z, h = 0) => L.Yf + k * z - h * s(z) };
}

// ================================================================ cây tán tròn
// tán = nhiều "cụm lá" tròn chồng nhau (ô, gốc cây ở (0,0), y âm = lên trên)
const PUFFS = [
  [[0, -2.55, 0.95], [-0.72, -2.15, 0.68], [0.74, -2.2, 0.7], [-0.42, -3.05, 0.66], [0.4, -3.1, 0.64], [0, -1.9, 0.6], [-0.98, -2.68, 0.48], [0.98, -2.74, 0.5]],
  [[0, -2.75, 0.84], [-0.6, -2.28, 0.62], [0.62, -2.32, 0.64], [-0.36, -3.32, 0.62], [0.36, -3.38, 0.6], [0, -3.82, 0.45], [0, -1.98, 0.58]],
  [[0, -2.4, 0.9], [-0.84, -2.1, 0.7], [0.86, -2.06, 0.72], [-0.5, -2.95, 0.66], [0.5, -2.98, 0.68], [-1.22, -2.34, 0.48], [1.22, -2.3, 0.5], [0, -1.82, 0.6]],
];
export const TREE_TOP = 4.3; // ô (cao nhất của tán, đã tính viền)

export const TREE_PAL = {
  near: { rim: '#06110c', base: '#183a28', dark: '#0f2619', light: '#235236', hl: '#3d7556', rimLight: 'rgba(170,205,255,0.42)', trunk: '#3a2d26', trunkLo: '#211813', speck: 'rgba(120,190,140,0.22)' },
  far: { rim: '#070b18', base: '#111b30', dark: '#0c1324', light: '#18263f', hl: '#22365a', rimLight: 'rgba(150,170,240,0.22)', trunk: '#151827', trunkLo: '#0d0f1a', speck: 'rgba(110,130,190,0.14)' },
};

function puffPath(ctx, puffs, grow) {
  ctx.beginPath();
  for (const [x, y, r] of puffs) {
    ctx.moveTo(x + r + grow, y);
    ctx.arc(x, y, r + grow, 0, Math.PI * 2);
  }
}

/** cây (vẽ thẳng): gốc ở (x, y) px, s = px / ô, v = biến thể, pal = bảng màu, flip = lật ngang (cây bên phải rạp) */
export function drawTree(ctx, x, y, s, v, pal, flip = false) {
  const puffs = PUFFS[v % PUFFS.length];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -s : s, s);
  // bóng đổ dưới gốc
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0.1, 0, 0.75, 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // thân: loe ở rễ, hơi cong
  const th = 1.5;
  ctx.beginPath();
  ctx.moveTo(-0.3, 0.03);
  ctx.quadraticCurveTo(-0.13, -0.12, -0.12, -0.6);
  ctx.quadraticCurveTo(-0.1, -1.1, -0.15, -th);
  ctx.lineTo(0.14, -th);
  ctx.quadraticCurveTo(0.1, -1.0, 0.13, -0.6);
  ctx.quadraticCurveTo(0.14, -0.12, 0.32, 0.03);
  ctx.closePath();
  ctx.fillStyle = pal.trunk;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = pal.trunkLo;
  ctx.fillRect(0.02, -th, 0.4, th + 0.1);
  ctx.strokeStyle = pal.trunkLo;
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.15); ctx.lineTo(-0.04, -0.7);
  ctx.moveTo(-0.08, -0.85); ctx.lineTo(-0.05, -1.25);
  ctx.stroke();
  ctx.restore();
  // cành chĩa vào tán
  ctx.strokeStyle = pal.trunk;
  ctx.lineWidth = 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -1.25); ctx.quadraticCurveTo(-0.3, -1.6, -0.5, -1.85);
  ctx.moveTo(0.02, -1.35); ctx.quadraticCurveTo(0.3, -1.65, 0.48, -1.9);
  ctx.stroke();
  // tán: viền tối → nền → bóng phía dưới → cụm sáng phía trên → lốm đốm lá → viền sáng phía màn hình
  puffPath(ctx, puffs, 0.06);
  ctx.fillStyle = pal.rim;
  ctx.fill();
  puffPath(ctx, puffs, 0);
  ctx.fillStyle = pal.base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = pal.dark;
  ctx.beginPath();
  ctx.ellipse(0.25, -1.55, 1.5, 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [px, py, r] of puffs) {
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.arc(px - r * 0.16, py - r * 0.2, r * 0.68, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [px, py, r] of puffs) {
    ctx.fillStyle = pal.hl;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(px - r * 0.32, py - r * 0.42, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.speck;
  for (let i = 0; i < 34; i++) {
    const p = puffs[i % puffs.length];
    const a = hash2(i, v, 41) * Math.PI * 2, d = Math.sqrt(hash2(i, v, 43)) * p[2] * 0.9;
    ctx.beginPath();
    ctx.ellipse(p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, 0.07, 0.05, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // viền sáng (ánh màn hình hắt từ phía giữa rạp)
  ctx.strokeStyle = pal.rimLight;
  ctx.lineWidth = 0.05;
  for (const [px, py, r] of puffs) {
    if (px < 0.3) continue;
    ctx.beginPath();
    ctx.arc(px, py, r - 0.03, -1.15, 0.35);
    ctx.stroke();
  }
  ctx.restore();
}

const treeCache = new Map();
/** cây từ ảnh cache (theo biến thể / bảng màu / cỡ px): gốc (x, y) px CSS, s px/ô */
export function blitTree(ctx, x, y, s, dpr, v, palKey, flip = false) {
  const ps = Math.max(8, Math.ceil((s * dpr) / 8) * 8);
  const key = `${v}|${palKey}|${ps}`;
  let cv = treeCache.get(key);
  if (!cv) {
    if (treeCache.size > 60) treeCache.clear();
    cv = makeCanvas(3.7 * ps, 4.6 * ps);
    drawTree(cv.getContext('2d'), 1.85 * ps, 4.4 * ps, ps, v, TREE_PAL[palKey]);
    treeCache.set(key, cv);
  }
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(cv, -1.85 * s, -4.4 * s, 3.7 * s, 4.6 * s);
  ctx.restore();
}

// ================================================================ cột đèn công viên (gang, chụp đèn kính vàng ấm)
export const LAMP_H = 2.62; // tâm chụp đèn (ô)

/** cột đèn: chân ở (x, y) px, s px/ô */
export function drawLampPost(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0.05, 0, 0.3, 0.08, 0, 0, Math.PI * 2); ctx.fill();
  // đế
  ctx.fillStyle = C.iron;
  ctx.beginPath();
  ctx.moveTo(-0.16, 0); ctx.lineTo(-0.12, -0.24); ctx.lineTo(-0.06, -0.3); ctx.lineTo(0.06, -0.3); ctx.lineTo(0.12, -0.24); ctx.lineTo(0.16, 0);
  ctx.closePath();
  ctx.fill();
  // thân cột
  ctx.fillRect(-0.035, -2.38, 0.07, 2.1);
  ctx.fillStyle = C.ironHi;
  ctx.fillRect(-0.03, -2.36, 0.022, 2.05);
  ctx.fillRect(-0.12, -0.26, 0.05, 0.22);
  // vòng trang trí
  ctx.fillStyle = C.iron;
  for (const h of [0.95, 2.05]) ctx.fillRect(-0.065, -h - 0.04, 0.13, 0.08);
  // móc treo dây đèn
  ctx.strokeStyle = C.iron;
  ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.moveTo(-0.03, -2.2); ctx.lineTo(-0.16, -2.24); ctx.moveTo(0.03, -2.2); ctx.lineTo(0.16, -2.24); ctx.stroke();
  // chụp đèn: đế, kính sáng, mái, núm
  ctx.fillStyle = C.iron;
  ctx.fillRect(-0.12, -2.44, 0.24, 0.07);
  const gy = -2.8;
  ctx.fillStyle = C.lampGlass;
  ctx.beginPath();
  ctx.moveTo(-0.1, -2.44); ctx.lineTo(-0.15, gy); ctx.lineTo(0.15, gy); ctx.lineTo(0.1, -2.44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,235,0.85)';
  ctx.fillRect(-0.04, -2.72, 0.08, 0.22);
  ctx.strokeStyle = C.iron;
  ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(0, -2.44); ctx.lineTo(0, gy); ctx.stroke();
  ctx.fillStyle = C.iron;
  ctx.beginPath();
  ctx.moveTo(-0.2, gy + 0.01); ctx.lineTo(0, gy - 0.17); ctx.lineTo(0.2, gy + 0.01);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(0, gy - 0.2, 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

const lampCache = new Map();
export function blitLamp(ctx, x, y, s, dpr) {
  const ps = Math.max(8, Math.ceil((s * dpr) / 8) * 8);
  let cv = lampCache.get(ps);
  if (!cv) {
    if (lampCache.size > 24) lampCache.clear();
    cv = makeCanvas(0.6 * ps, 3.15 * ps);
    drawLampPost(cv.getContext('2d'), 0.3 * ps, 3.1 * ps, ps);
    lampCache.set(ps, cv);
  }
  ctx.drawImage(cv, x - 0.3 * s, y - 3.1 * s, 0.6 * s, 3.15 * s);
}

// ================================================================ vị trí (ngoài hai hàng rào; lối vào ở lối đi ngang cuối rạp)
export const GATE = { z0: 14.6, z1: 16.4 }; // khoảng hở hàng rào chỗ lối đi ngang cắt qua
// [x, z, cỡ, biến thể]
export const TREES = [
  [-0.95, 0.7, 1.0, 0], [-1.25, 3.9, 1.08, 1], [-0.85, 7.1, 0.96, 2], [-1.15, 10.3, 1.05, 0], [-0.95, 13.2, 1.0, 1],
  [-1.3, 17.7, 1.1, 2], [-1.0, 21.3, 1.0, 0],
  [34.95, 1.3, 1.02, 2], [35.25, 4.5, 0.96, 0], [34.85, 7.7, 1.08, 1], [35.15, 10.9, 1.0, 2], [34.95, 13.0, 1.04, 0],
  [35.35, 18.0, 0.98, 1], [35.05, 21.6, 1.05, 2],
];
// cây tầng giữa sau màn hình (vẽ ở dải trên, màu xanh đêm nhạt dần theo xa)
export const BACK_TREES = [
  [-3.6, -3.7, 1.05, 1], [-0.6, -2.7, 0.95, 0], [2.0, -4.6, 1.12, 2],
  [31.9, -4.4, 1.08, 0], [34.5, -2.9, 0.98, 2], [37.4, -3.9, 1.02, 1],
];
export const LAMP_Z = [2.2, 6.4, 10.4, 14.35, 16.65];
export const LAMPS = [0.3, W - 0.3].flatMap((x) => LAMP_Z.map((z) => ({ x, z })));
// dây đèn nháy nối các cột cùng bên (không bắc ngang qua đầu khán giả: khỏi lệch thứ tự vẽ với người)
export const STRINGS = [0.3, W - 0.3].flatMap((x) => [[2.2, 6.4], [6.4, 10.4], [10.4, 14.35]].map(([z0, z1]) => ({ x, z0, z1 })));
export const BULB_COLORS = ['255,214,140', '255,214,140', '255,150,190', '255,214,140', '140,230,255', '255,214,140', '200,255,150'];
