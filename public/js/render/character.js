// Nhân vật chibi vẽ thủ tục từ `look` — chép từ VibeCorp (../agent_office/public/js/render/character.js) rồi thêm:
// tư thế ngồi bệt ('floor'), khung `anim` cho 8 động tác (render/anims.js), hộp bắp rang, trái tim trước ngực,
// dáng Nam (vai rộng, mày đậm thẳng, có thể để ria / râu quai nón) / Nữ (vai thon, lông mi, má hồng, môi hồng).
// Cao ~1.95 ô, đầu ≈ 45% chiều cao, nhận ra từ sau lưng nhờ kiểu tóc + áo + phụ kiện.
// Toạ độ cục bộ: (0,0) = điểm chân, 1 đơn vị = 1/U ô, trục y hướng xuống (y âm = phía trên).
import { safeColor } from '../util.js';
import { shade, luma, ellipse, circle, rrPath } from './draw.js';

export const U = 24;
const HEAD_R = 10.4; // bán kính đầu (đường kính 20.8 ≈ 0.87 ô)
const HEAD_Y = -34.0; // tâm đầu
const TORSO_TOP = -25.0; // vai
const TORSO_BOT = -8.8; // cạp quần
const LEG_TOP = -11.2;
const SIT = 4.2; // thân hạ xuống khi ngồi
const LINE_W = 1.15;

const palCache = new Map();
function pal(look) {
  const key = look ? `${look.body}|${look.facial}|${look.skin}|${look.hair}|${look.shirt}|${look.pants}|${look.hairStyle}|${look.accessory}` : '-';
  let p = palCache.get(key);
  if (p) return p;
  const skin = safeColor(look?.skin, '#f1c7a0');
  const hair = safeColor(look?.hair, '#2b2118');
  const shirt = safeColor(look?.shirt, '#5b8def');
  const pants = safeColor(look?.pants, '#374151');
  const darkHair = luma(hair) < 0.25;
  const fem = look?.body === 'nu';
  p = {
    fem,
    facial: !fem && (look?.facial === 'ria' || look?.facial === 'rau') ? look.facial : 'none',
    lip: fem ? '#c23a59' : '#8a3f35',
    blush: fem ? 'rgba(255,96,128,0.45)' : null,
    brow: fem ? 'rgba(40,28,30,0.8)' : shade(hair, darkHair ? -0.2 : -0.45),
    beard: shade(hair, darkHair ? 0.06 : -0.1),
    skin, skinS: shade(skin, -0.14), skinD: shade(skin, -0.3),
    hair, hairS: shade(hair, -0.28), hairL: shade(hair, darkHair ? 0.34 : 0.24),
    shirt, shirtS: shade(shirt, -0.22), shirtL: shade(shirt, 0.26), shirtD: shade(shirt, -0.4),
    pants, pantsS: shade(pants, -0.25),
    shoe: luma(pants) > 0.55 ? '#5b4636' : '#23201f',
    line: 'rgba(46,30,34,0.7)',
    style: look?.hairStyle || 'short',
    acc: look?.accessory || 'none',
    capColor: luma(shirt) > 0.6 ? '#2563eb' : shade(shirt, 0.12),
    bow: luma(shirt) > 0.5 && /f472b6|ec4899|db2777/i.test(shirt) ? '#fbbf24' : '#f472b6',
    cups: luma(shirt) > 0.5 ? '#ef4444' : '#f87171',
  };
  if (palCache.size > 200) palCache.clear();
  palCache.set(key, p);
  return p;
}

/** bảng màu tối hơn cho tay phía xa (nhìn nghiêng) */
function farPal(p) {
  if (!p.far) p.far = { ...p, shirt: p.shirtS, skin: p.skinS };
  return p.far;
}

function fillStroke(ctx, fill, stroke, lw = LINE_W) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function rr(ctx, x, y, w, h, r, fill, stroke) {
  rrPath(ctx, x, y, w, h, r);
  fillStroke(ctx, fill, stroke);
}

function circ(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillStroke(ctx, fill, stroke);
}

/** biểu cảm từ emoji vừa thả */
export function moodOf(emote) {
  const e = String(emote || '');
  if (/😂|🤣|😆|😄|😁|🥳|🎉|😍|🥰|😎|🤩|😊|❤|👏|🔥|👍/u.test(e)) return 'happy';
  if (/😮|😱|😨|😳|😵|🙀/u.test(e)) return 'shock';
  if (/😢|😭|😩|😞|😔|🥲/u.test(e)) return 'sad';
  return 'neutral';
}

// ------------------------------------------------------------------ mặt
/** lông mi (nữ): hai nét cong ra ngoài ở góc trên — outer = -1 mắt trái, +1 mắt phải */
function lashes(ctx, x, y, outer, narrow) {
  const ex = x + outer * 1.7 * narrow;
  ctx.strokeStyle = '#2a2228';
  ctx.lineWidth = 0.95;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ex, y); ctx.lineTo(ex + outer * 1.5 * narrow, y - 0.9);
  ctx.moveTo(ex - outer * 0.7 * narrow, y - 0.9); ctx.lineTo(ex + outer * 0.6 * narrow, y - 2.1);
  ctx.stroke();
}

/** g = bảng màu (giới tính) · outer = phía ngoài mặt của mắt này (-1 trái, +1 phải, 0 = nhìn nghiêng → về sau) */
function eye(ctx, x, y, o, narrow = 1, g = null, outer = 0) {
  const m = o.mood;
  const fem = !!g?.fem;
  const male = !!g && !fem;
  const rx = (male ? 1.95 : 2.1) * narrow, ry = male ? 2.55 : 2.8;
  const lashSide = outer || 1;
  if (m === 'sleep' || o.blink) {
    ctx.beginPath();
    ctx.arc(x, y - 0.6, 1.9 * narrow, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.strokeStyle = '#2a2228';
    ctx.lineWidth = 1.15;
    ctx.stroke();
    if (fem) lashes(ctx, x, y + 0.4, lashSide, narrow * 0.8);
    return;
  }
  if (m === 'happy') {
    // mắt cười: cung úp
    ctx.beginPath();
    ctx.arc(x, y + 1.0, 2.0 * narrow, 1.12 * Math.PI, 1.88 * Math.PI);
    ctx.strokeStyle = '#2a2228';
    ctx.lineWidth = 1.35;
    ctx.stroke();
    if (fem) lashes(ctx, x, y + 0.2, lashSide, narrow * 0.8);
    return;
  }
  if (m === 'shock') {
    ellipse(ctx, x, y, 2.4 * narrow, 3.0, '#ffffff');
    ctx.strokeStyle = '#2a2228'; ctx.lineWidth = 0.7; ctx.stroke();
    circle(ctx, x, y + 0.3, 1.05 * narrow, '#2a2228');
    if (fem) lashes(ctx, x, y - 1.8, lashSide, narrow);
    return;
  }
  // mắt to kiểu chibi: tròng đen + ánh sáng
  ellipse(ctx, x, y, rx, ry, '#2a2228');
  if (m === 'angry') ellipse(ctx, x, y + 0.9, rx * 0.9, ry * 0.55, '#2a2228');
  ellipse(ctx, x + 0.6 * narrow, y - 0.9, 0.75 * narrow, 0.95, '#ffffff');
  circle(ctx, x - 0.5 * narrow, y + 1.1, 0.35, 'rgba(255,255,255,0.75)');
  if (fem) lashes(ctx, x, y - 1.5, lashSide, narrow);
}

function brows(ctx, xs, y, mood, narrow = 1, g = null) {
  const male = !!g && !g.fem;
  ctx.strokeStyle = g ? g.brow : 'rgba(40,28,30,0.78)';
  ctx.lineWidth = male ? 1.75 : g ? 0.9 : 1.0;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const x of xs) {
    const inner = x < 0 ? 1 : -1; // phía giữa mặt
    const w = (male ? 2.45 : 2.2) * narrow;
    if (mood === 'angry') { ctx.moveTo(x - w * inner, y - 0.9); ctx.lineTo(x + w * inner, y + 0.6); }
    else if (mood === 'sad') { ctx.moveTo(x - w * inner, y + 0.4); ctx.lineTo(x + w * inner, y - 0.9); }
    else if (mood === 'shock') { ctx.moveTo(x - w, y - 1.6); ctx.quadraticCurveTo(x, y - 2.8, x + w, y - 1.6); }
    else if (mood === 'think') { ctx.moveTo(x - w, y - (inner > 0 ? 1.2 : 0.2)); ctx.lineTo(x + w, y - (inner > 0 ? 0.2 : 1.2)); }
    else if (male) { ctx.moveTo(x - w * inner, y + 0.2); ctx.quadraticCurveTo(x, y - 0.55, x + w * inner, y - 0.35); } // đậm, gần thẳng
    else if (g) { ctx.moveTo(x - w, y + 0.2); ctx.quadraticCurveTo(x, y - 1.3, x + w, y + 0.2); } // mảnh, cong
    else { ctx.moveTo(x - w, y + 0.1); ctx.quadraticCurveTo(x, y - 0.9, x + w, y + 0.1); }
  }
  ctx.stroke();
}

function mouth(ctx, x, y, o, narrow = 1, g = null) {
  const m = o.mood;
  const fem = !!g?.fem;
  if (o.talking) {
    const open = 0.5 + Math.abs(Math.sin(o.t / 95)) * 1.4;
    ellipse(ctx, x, y + 0.3, 1.7 * narrow, open, '#7a2e2a');
    if (open > 1.0) ellipse(ctx, x, y + 0.3 + open * 0.45, 1.0 * narrow, open * 0.35, '#e26d6d');
    return;
  }
  ctx.strokeStyle = g ? g.lip : '#8a3f35';
  ctx.lineWidth = fem ? 1.3 : 1.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (fem && (m === 'neutral' || !m)) {
    // môi hồng nhỏ, hơi cười
    ctx.moveTo(x - 1.8 * narrow, y - 0.2);
    ctx.quadraticCurveTo(x, y + 1.9, x + 1.8 * narrow, y - 0.2);
    ctx.quadraticCurveTo(x, y + 0.5, x - 1.8 * narrow, y - 0.2);
    ctx.closePath();
    ctx.fillStyle = g.lip;
    ctx.fill();
    return;
  }
  if (m === 'happy') {
    ctx.moveTo(x - 2.3 * narrow, y - 0.4);
    ctx.quadraticCurveTo(x, y + 3.2, x + 2.3 * narrow, y - 0.4);
    ctx.closePath();
    ctx.fillStyle = '#7a2e2a';
    ctx.fill();
    return;
  }
  if (m === 'shock') { ellipse(ctx, x, y + 0.5, 1.2 * narrow, 1.5, '#7a2e2a'); return; }
  if (m === 'sad' || m === 'angry') { ctx.arc(x, y + 2.2, 1.9 * narrow, 1.2 * Math.PI, 1.8 * Math.PI); ctx.stroke(); return; }
  if (m === 'sleep') { ellipse(ctx, x, y + 0.4, 0.9 * narrow, 0.7, '#8a3f35'); return; }
  if (m === 'think') { ctx.moveTo(x - 1.6 * narrow, y + 0.3); ctx.lineTo(x + 1.4 * narrow, y - 0.2); ctx.stroke(); return; }
  ctx.arc(x, y - 0.9, 1.9 * narrow, 0.22 * Math.PI, 0.78 * Math.PI);
  ctx.stroke();
}

function sweat(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y - 2.4);
  ctx.quadraticCurveTo(x + 1.7, y, x, y + 1.2);
  ctx.quadraticCurveTo(x - 1.7, y, x, y - 2.4);
  ctx.fillStyle = 'rgba(125,200,255,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,90,140,0.5)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

// ------------------------------------------------------------------ râu (chỉ nam)
/** nhìn từ trước: quai nón = dải râu ôm hàm từ tai này sang tai kia; cả hai kiểu đều có ria mép */
function facialDown(ctx, p, hy) {
  if (p.facial === 'none') return;
  if (p.facial === 'rau') {
    ctx.beginPath();
    ctx.arc(0, hy, HEAD_R + 0.25, 0.03 * Math.PI, 0.97 * Math.PI);
    ctx.ellipse(0, hy + 0.9, 8.5, 6.5, 0, 0.94 * Math.PI, 0.06 * Math.PI, true);
    ctx.closePath();
    fillStroke(ctx, p.beard, p.line, 0.8);
  }
  ctx.beginPath();
  ctx.moveTo(0, hy + 4.7);
  ctx.quadraticCurveTo(-2.7, hy + 3.9, -3.9, hy + 6.1);
  ctx.quadraticCurveTo(-1.9, hy + 5.5, 0, hy + 5.8);
  ctx.quadraticCurveTo(1.9, hy + 5.5, 3.9, hy + 6.1);
  ctx.quadraticCurveTo(2.7, hy + 3.9, 0, hy + 4.7);
  ctx.closePath();
  ctx.fillStyle = p.beard;
  ctx.fill();
}

/** nhìn nghiêng (mặt quay trái): quai nón chạy từ dưới tai theo hàm tới cằm; ria dưới mũi */
function facialSide(ctx, p, hy) {
  if (p.facial === 'none') return;
  if (p.facial === 'rau') {
    ctx.beginPath();
    ctx.moveTo(3.6, hy + 3.4);
    ctx.quadraticCurveTo(4.6, hy + 9.4, -1.0, hy + 10.6);
    ctx.quadraticCurveTo(-7.6, hy + 10.9, -9.6, hy + 6.6);
    ctx.lineTo(-7.8, hy + 6.4);
    ctx.quadraticCurveTo(-4.8, hy + 8.8, -0.8, hy + 6.8);
    ctx.quadraticCurveTo(1.7, hy + 5.4, 1.7, hy + 3.4);
    ctx.closePath();
    fillStroke(ctx, p.beard, p.line, 0.8);
  }
  ctx.beginPath();
  ctx.moveTo(-9.4, hy + 6.0);
  ctx.quadraticCurveTo(-7.4, hy + 4.9, -4.7, hy + 5.9);
  ctx.quadraticCurveTo(-7.0, hy + 7.0, -9.4, hy + 6.0);
  ctx.closePath();
  ctx.fillStyle = p.beard;
  ctx.fill();
}

// ------------------------------------------------------------------ tóc
/** vòm tóc nhìn từ trước (trùm nửa trên đầu, có mái) */
function hairCapDown(ctx, p, hy, style) {
  const R = HEAD_R + 1.0;
  ctx.beginPath();
  if (style === 'spiky') {
    ctx.moveTo(-R, hy + 2.5);
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      const rr2 = i % 2 === 0 ? R + 3.4 : R - 0.3;
      ctx.lineTo(Math.cos(a) * rr2, hy - 0.4 + Math.sin(a) * rr2);
    }
    ctx.lineTo(R, hy + 2.5);
    ctx.lineTo(R - 2, hy - 1.5);
    ctx.lineTo(3.5, hy - 2.8); ctx.lineTo(1.2, hy - 0.6); ctx.lineTo(-1.5, hy - 3.2); ctx.lineTo(-4, hy - 1.2); ctx.lineTo(-R + 2, hy - 1.8);
  } else if (style === 'curly') {
    ctx.moveTo(-R, hy + 3);
    ctx.arc(0, hy - 0.4, R, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(R, hy + 3);
    ctx.quadraticCurveTo(R - 3, hy - 2.5, 0, hy - 2.2);
    ctx.quadraticCurveTo(-R + 3, hy - 2.5, -R, hy + 3);
  } else if (style === 'bob') {
    // tóc bob: hai bên xoã thẳng xuống tận cằm, mái ngang
    ctx.moveTo(-R - 0.6, hy + 8.5);
    ctx.lineTo(-R - 0.6, hy - 0.5);
    ctx.arc(0, hy - 0.4, R + 0.5, Math.PI * 1.0, Math.PI * 2.0);
    ctx.lineTo(R + 0.6, hy + 8.5);
    ctx.lineTo(R - 2.8, hy + 8.5);
    ctx.lineTo(R - 3.0, hy - 1.2);
    ctx.lineTo(-R + 3.0, hy - 1.2);
    ctx.lineTo(-R + 2.8, hy + 8.5);
    ctx.closePath();
  } else if (style === 'long') {
    // tóc dài: mái rẽ giữa, hai lọn ôm má
    ctx.moveTo(-R - 0.4, hy + 6);
    ctx.lineTo(-R - 0.4, hy - 0.2);
    ctx.arc(0, hy - 0.4, R + 0.3, Math.PI * 0.98, Math.PI * 2.02);
    ctx.lineTo(R + 0.4, hy + 6);
    ctx.lineTo(R - 2.6, hy + 6);
    ctx.quadraticCurveTo(R - 1.6, hy - 1.5, 0.8, hy - 6.5);
    ctx.lineTo(-0.8, hy - 6.5);
    ctx.quadraticCurveTo(-R + 1.6, hy - 1.5, -R + 2.6, hy + 6);
    ctx.closePath();
  } else if (style === 'bun' || style === 'ponytail') {
    // tóc búi/cột: vuốt gọn, mái lệch
    ctx.moveTo(-R + 0.2, hy + 1.8);
    ctx.arc(0, hy - 0.5, R - 0.1, Math.PI * 0.97, Math.PI * 2.03);
    ctx.lineTo(R - 0.2, hy + 1.8);
    ctx.quadraticCurveTo(R - 2.6, hy - 3.4, 2.6, hy - 4.8);
    ctx.quadraticCurveTo(-1, hy - 3.2, -3.8, hy - 4.4);
    ctx.quadraticCurveTo(-R + 2, hy - 3.6, -R + 0.2, hy + 1.8);
  } else {
    // short: mái lệch có mấy mảng
    ctx.moveTo(-R + 0.1, hy + 2.2);
    ctx.arc(0, hy - 0.5, R, Math.PI * 0.97, Math.PI * 2.03);
    ctx.lineTo(R - 0.1, hy + 2.2);
    ctx.quadraticCurveTo(R - 1.8, hy - 2.8, 4.8, hy - 2.6);
    ctx.quadraticCurveTo(2.6, hy - 1.2, 1.6, hy - 3.6);
    ctx.quadraticCurveTo(-0.8, hy - 1.6, -2.6, hy - 3.4);
    ctx.quadraticCurveTo(-4.8, hy - 1.8, -6.2, hy - 2.9);
    ctx.quadraticCurveTo(-R + 1.4, hy - 2.4, -R + 0.1, hy + 2.2);
  }
  ctx.closePath();
  fillStroke(ctx, p.hair, p.line);
  if (style === 'curly') {
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 1.03 + (i / 9) * Math.PI * 0.94;
      circ(ctx, Math.cos(a) * (R + 0.6), hy - 0.4 + Math.sin(a) * (R + 0.6), 2.9, p.hair, p.line);
    }
    for (let i = 0; i < 6; i++) circ(ctx, -6 + i * 2.4, hy - 2.6, 1.9, p.hair, null);
  }
  // ánh tóc
  ctx.beginPath();
  ctx.arc(0, hy - 0.5, R - 3.2, Math.PI * 1.18, Math.PI * 1.42);
  ctx.strokeStyle = p.hairL;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** phần tóc phía sau đầu khi nhìn từ trước (vẽ trước thân) */
function hairBackDown(ctx, p, hy, style) {
  if (style === 'long') rr(ctx, -HEAD_R - 1.6, hy - 5, (HEAD_R + 1.6) * 2, 24, [10, 10, 5, 5], p.hairS, p.line);
  else if (style === 'bob') rr(ctx, -HEAD_R - 1.8, hy - 5, (HEAD_R + 1.8) * 2, 15, [10, 10, 6, 6], p.hairS, p.line);
  else if (style === 'ponytail') {
    ctx.beginPath();
    ctx.moveTo(HEAD_R - 4, hy - 4);
    ctx.quadraticCurveTo(HEAD_R + 5, hy + 2, HEAD_R + 1.5, hy + 13);
    ctx.quadraticCurveTo(HEAD_R - 1.5, hy + 6, HEAD_R - 5, hy + 1);
    ctx.closePath();
    fillStroke(ctx, p.hairS, p.line);
  } else if (style === 'curly') {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 0.85 + (i / 7) * Math.PI * 1.3;
      circ(ctx, Math.cos(a) * (HEAD_R + 0.8), hy + Math.sin(a) * (HEAD_R + 0.8) + 1, 3.4, p.hairS, p.line);
    }
  } else if (style === 'bun') {
    circ(ctx, 0, hy - HEAD_R - 2.2, 5.0, p.hairS, p.line);
  }
}

/** tóc vành móng ngựa của người hói */
function baldFringe(ctx, p, hy, view) {
  ctx.save();
  ctx.beginPath(); ctx.arc(0, hy, HEAD_R - 0.3, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = p.hair;
  ctx.lineCap = 'round';
  if (view === 'up') {
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(0, hy - 1.5, HEAD_R - 1.4, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
  } else if (view === 'left') {
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.arc(1, hy - 1, HEAD_R - 1.5, -Math.PI * 0.1, Math.PI * 0.45);
    ctx.stroke();
  }
  ctx.restore();
  if (view === 'down') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * (HEAD_R - 1.0), hy - 0.2, 2.0, 4.0, sx * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = p.hair;
      ctx.fill();
    }
  }
  // bóng loáng trên đỉnh
  ellipse(ctx, view === 'left' ? -1.5 : -3, hy - 5.5, 3.4, 1.8, 'rgba(255,255,255,0.42)');
}

/** tóc nhìn từ sau lưng (trùm kín, bóng dáng đặc trưng từng kiểu) */
function hairUp(ctx, p, hy, style) {
  const R = HEAD_R + 1.0;
  if (style === 'bald') { baldFringe(ctx, p, hy, 'up'); return; }
  if (style === 'long') {
    // tóc dài xoã sau lưng: thon dần, để lộ vai áo hai bên
    ctx.beginPath();
    ctx.moveTo(-HEAD_R - 1.0, hy - 1);
    ctx.quadraticCurveTo(-HEAD_R - 1.6, hy + 10, -7.2, hy + 21);
    ctx.quadraticCurveTo(0, hy + 24.5, 7.2, hy + 21);
    ctx.quadraticCurveTo(HEAD_R + 1.6, hy + 10, HEAD_R + 1.0, hy - 1);
    ctx.closePath();
    fillStroke(ctx, p.hair, p.line);
    ctx.strokeStyle = p.hairS; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-3, hy + 9); ctx.quadraticCurveTo(-3.6, hy + 15, -2.4, hy + 20); ctx.moveTo(3, hy + 9); ctx.quadraticCurveTo(3.6, hy + 15, 2.4, hy + 20); ctx.stroke();
  }
  if (style === 'bob') rr(ctx, -HEAD_R - 1.4, hy - 3, (HEAD_R + 1.4) * 2, 13.5, [7, 7, 6.5, 6.5], p.hair, p.line);
  ctx.beginPath();
  if (style === 'spiky') {
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.95 + (i / n) * Math.PI * 1.1;
      const rr2 = i % 2 === 0 ? R + 3.0 : R - 0.2;
      const x = Math.cos(a) * rr2, y = hy - 0.5 + Math.sin(a) * rr2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(R - 0.5, hy + 5.5);
    ctx.quadraticCurveTo(0, hy + 8.5, -R + 0.5, hy + 5.5);
  } else {
    ctx.arc(0, hy - 0.4, R, Math.PI * 0.82, Math.PI * 2.18);
    ctx.quadraticCurveTo(0, hy + 9.5, -Math.cos(Math.PI * 0.18) * R, hy - 0.4 + Math.sin(Math.PI * 0.18) * R);
  }
  ctx.closePath();
  fillStroke(ctx, p.hair, p.line);
  if (style === 'curly') {
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 0.8 + (i / 11) * Math.PI * 1.4;
      circ(ctx, Math.cos(a) * (R + 0.3), hy - 0.4 + Math.sin(a) * (R + 0.3), 3.0, p.hair, p.line);
    }
  }
  if (style === 'bun') {
    circ(ctx, 0, hy - 9.6, 5.2, p.hair, p.line);
    rr(ctx, -3.2, hy - 5.8, 6.4, 2.0, 1.0, p.bow, null);
  }
  if (style === 'ponytail') {
    ctx.beginPath();
    ctx.moveTo(-3.2, hy - 1);
    ctx.quadraticCurveTo(-4.6, hy + 8, 0, hy + 16);
    ctx.quadraticCurveTo(4.6, hy + 8, 3.2, hy - 1);
    ctx.closePath();
    fillStroke(ctx, p.hair, p.line);
    rr(ctx, -3.0, hy - 2.0, 6.0, 2.2, 1.1, p.bow, null);
  }
  ctx.beginPath();
  ctx.arc(0, hy - 0.5, R - 3.4, Math.PI * 1.15, Math.PI * 1.45);
  ctx.strokeStyle = p.hairL;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** tóc nhìn nghiêng (hướng trái; hướng phải = lật gương): phần xoã sau lưng / đuôi tóc — vẽ TRƯỚC thân */
function hairSideBack(ctx, p, hy, style) {
  if (style === 'long') {
    // tóc dài xoã sau vai, thấy bên cạnh thân
    ctx.beginPath();
    ctx.moveTo(2.0, hy - 4.0);
    ctx.quadraticCurveTo(14.0, hy - 2.0, 13.0, hy + 10.0);
    ctx.quadraticCurveTo(12.4, hy + 18.0, 9.0, hy + 22.0);
    ctx.quadraticCurveTo(4.0, hy + 23.0, 1.6, hy + 18.0);
    ctx.quadraticCurveTo(0.8, hy + 10.0, -1.0, hy + 4.0);
    ctx.closePath();
    fillStroke(ctx, p.hairS, p.line);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(8.0, hy + 8); ctx.quadraticCurveTo(9.2, hy + 14, 7.4, hy + 20); ctx.stroke();
  } else if (style === 'ponytail') {
    // đuôi tóc cột sau gáy, buông xuống sau lưng
    ctx.beginPath();
    ctx.moveTo(6.5, hy - 4.0);
    ctx.quadraticCurveTo(16.5, hy - 2.0, 13.0, hy + 10.0);
    ctx.quadraticCurveTo(12.0, hy + 15.5, 9.5, hy + 16.0);
    ctx.quadraticCurveTo(10.5, hy + 8.0, 6.0, hy + 3.0);
    ctx.closePath();
    fillStroke(ctx, p.hairS, p.line);
  }
}

/** tóc nhìn nghiêng: vòm tóc trùm đỉnh + sau đầu, mái phủ trán, chừa mặt (và tai với kiểu ngắn) */
function hairSide(ctx, p, hy, style) {
  if (style === 'bald') { baldFringe(ctx, p, hy, 'left'); return; }
  const R = HEAD_R + 1.0, cy = hy - 0.4;
  const a0 = Math.PI * 1.06, a1 = Math.PI * 2.2; // trán -> đỉnh -> gáy
  const sx = Math.cos(a0) * R, sy = cy + Math.sin(a0) * R;
  const low = style === 'bob' || style === 'long';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  if (style === 'spiky') {
    const n = 10;
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const r2 = i % 2 === 1 ? R + 3.2 : R - 0.3;
      ctx.lineTo(Math.cos(a) * r2, cy + Math.sin(a) * r2);
    }
  } else ctx.arc(0, cy, R, a0, a1);
  if (low) {
    // bob / tóc dài: xoã xuống ngang cằm, che tai và một phần má sau
    ctx.lineTo(R - 1.6, hy + 9.4);
    ctx.quadraticCurveTo(4.4, hy + 11.2, -1.6, hy + 9.6);
    ctx.lineTo(-2.4, hy + 0.6);
    ctx.quadraticCurveTo(-3.2, hy - 3.2, -5.4, hy - 2.4);
    ctx.quadraticCurveTo(-7.2, hy - 1.0, -8.6, hy - 2.2);
  } else {
    // gáy -> sau tai -> tóc mai -> thái dương -> mái (2 lọn)
    ctx.quadraticCurveTo(7.4, hy + 8.4, 4.4, hy + 6.2);
    ctx.lineTo(3.0, hy + 3.2);
    ctx.quadraticCurveTo(1.4, hy - 1.8, -0.8, hy - 2.6);
    ctx.quadraticCurveTo(-3.4, hy - 4.4, -5.6, hy - 3.0);
    ctx.quadraticCurveTo(-7.2, hy - 1.4, -8.6, hy - 2.8);
  }
  ctx.quadraticCurveTo(-10.0, hy - 1.4, sx, sy);
  ctx.closePath();
  fillStroke(ctx, p.hair, p.line);
  if (style === 'curly') {
    for (let i = 0; i < 10; i++) {
      const a = a0 + ((a1 - a0) * i) / 9;
      circ(ctx, Math.cos(a) * (R + 0.4), cy + Math.sin(a) * (R + 0.4), 2.9, p.hair, p.line);
    }
  }
  if (style === 'bun') {
    circ(ctx, 4.6, hy - 10.2, 4.8, p.hair, p.line);
    rr(ctx, 1.4, hy - 6.8, 5.2, 1.8, 0.9, p.bow, null);
  }
  // ánh tóc
  ctx.beginPath();
  ctx.arc(0, cy, R - 3.2, Math.PI * 1.18, Math.PI * 1.46);
  ctx.strokeStyle = p.hairL;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ------------------------------------------------------------------ phụ kiện
function accessoryFront(ctx, p, hy, dir) {
  const acc = p.acc;
  if (acc === 'glasses') {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.0;
    if (dir === 'down') {
      for (const x of [-4.0, 4.0]) {
        rrPath(ctx, x - 2.9, hy - 1.4, 5.8, 4.8, 1.6);
        ctx.fillStyle = 'rgba(219,234,254,0.3)';
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-1.1, hy + 0.4); ctx.lineTo(1.1, hy + 0.4); ctx.stroke();
      // gọng cài tai
      ctx.beginPath(); ctx.moveTo(-6.9, hy + 0.2); ctx.lineTo(-HEAD_R - 0.6, hy + 1.2); ctx.moveTo(6.9, hy + 0.2); ctx.lineTo(HEAD_R + 0.6, hy + 1.2); ctx.stroke();
    } else if (dir === 'left') {
      // nghiêng: một tròng trước mắt, càng kính gác lên tai, cầu kính ôm sống mũi
      rrPath(ctx, -8.4, hy - 1.0, 5.8, 4.8, 1.6);
      ctx.fillStyle = 'rgba(219,234,254,0.3)';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2.6, hy + 0.4); ctx.lineTo(2.6, hy + 1.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8.4, hy + 0.8); ctx.lineTo(-HEAD_R - 0.8, hy + 1.4); ctx.stroke();
    } else {
      // từ sau lưng: hai càng kính gác tai
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-HEAD_R + 0.4, hy + 0.2); ctx.lineTo(-HEAD_R - 1.0, hy + 1.8);
      ctx.moveTo(HEAD_R - 0.4, hy + 0.2); ctx.lineTo(HEAD_R + 1.0, hy + 1.8);
      ctx.stroke();
    }
  } else if (acc === 'headphones') {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (dir === 'left') {
      // nghiêng: vành ôm từ chụp tai vòng qua đỉnh đầu ra phía trước
      ctx.moveTo(3.6, hy - 2.0);
      ctx.bezierCurveTo(6.2, hy - 10.6, -2.0, hy - 15.4, -9.4, hy - 7.0);
    } else ctx.arc(0, hy - 0.6, HEAD_R + 2.0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (dir === 'left') { ctx.moveTo(4.6, hy - 6.0); ctx.bezierCurveTo(4.6, hy - 11.4, -1.0, hy - 14.0, -5.6, hy - 11.0); }
    else ctx.arc(0, hy - 0.6, HEAD_R + 2.5, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    if (dir === 'left') {
      // chụp tai đúng vị trí tai
      rr(ctx, 0.9, hy - 1.9, 5.4, 7.4, 2.4, p.cups, p.line);
      rr(ctx, 1.9, hy - 0.6, 1.2, 4.6, 0.6, 'rgba(255,255,255,0.35)', null);
    } else {
      rr(ctx, -HEAD_R - 2.8, hy - 2.4, 4.4, 7.6, 2.0, p.cups, p.line);
      rr(ctx, HEAD_R - 1.6, hy - 2.4, 4.4, 7.6, 2.0, p.cups, p.line);
      rr(ctx, -HEAD_R - 2.0, hy - 1.4, 1.2, 4.2, 0.6, 'rgba(255,255,255,0.35)', null);
      rr(ctx, HEAD_R - 0.8, hy - 1.4, 1.2, 4.2, 0.6, 'rgba(255,255,255,0.35)', null);
    }
  } else if (acc === 'cap') {
    const c = p.capColor;
    ctx.beginPath();
    if (dir === 'left') {
      // nghiêng: chỏm mũ trùm đỉnh, lưỡi trai chĩa về trước (-x)
      ctx.arc(0.2, hy - 3.2, HEAD_R + 0.8, Math.PI * 1.0, Math.PI * 2.0);
      ctx.closePath();
      fillStroke(ctx, c, p.line);
      rr(ctx, -HEAD_R - 0.6, hy - 5.2, (HEAD_R + 0.8) * 2 - 0.4, 2.4, 1.0, shade(c, -0.12), null);
      rr(ctx, -HEAD_R - 7.0, hy - 5.0, 9.4, 2.6, [1.3, 0.6, 0.6, 1.3], shade(c, -0.2), p.line);
      circ(ctx, 0.2, hy - HEAD_R - 3.6, 1.3, shade(c, -0.2), null);
    } else {
      ctx.arc(0, hy - 3.2, HEAD_R + 0.6, Math.PI * 1.0, Math.PI * 2.0);
      ctx.closePath();
      fillStroke(ctx, c, p.line);
      rr(ctx, -HEAD_R - 0.8, hy - 5.2, (HEAD_R + 0.8) * 2, 2.4, 1.0, shade(c, -0.12), p.line);
      circ(ctx, 0, hy - HEAD_R - 3.4, 1.3, shade(c, -0.2), null);
      if (dir === 'down') {
        ctx.beginPath();
        ctx.ellipse(0, hy - 3.6, HEAD_R + 1.4, 2.3, 0, 0, Math.PI);
        fillStroke(ctx, shade(c, -0.22), p.line);
      } else {
        // sau lưng: khoá điều chỉnh
        rr(ctx, -3.0, hy - 3.6, 6.0, 2.0, 0.7, shade(c, -0.3), null);
        rr(ctx, -1.2, hy - 3.2, 2.4, 1.2, 0.4, '#e5e7eb', null);
      }
    }
    // ánh sáng trên vành mũ
    ctx.beginPath();
    ctx.arc(dir === 'left' ? 0.2 : 0, hy - 3.2, HEAD_R - 2.6, Math.PI * 1.18, Math.PI * 1.42);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (acc === 'bow') {
    const bx = dir === 'left' ? 5.8 : dir === 'up' ? -5.5 : 6.4;
    const by = dir === 'up' ? hy - 5.5 : dir === 'left' ? hy - 7.6 : hy - 8.4;
    ctx.fillStyle = p.bow;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 5.0, by - 3.2); ctx.lineTo(bx - 5.0, by + 3.2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 5.0, by - 3.2); ctx.lineTo(bx + 5.0, by + 3.2); ctx.closePath(); ctx.fill(); ctx.stroke();
    circ(ctx, bx, by, 1.6, shade(p.bow, -0.25), p.line);
  }
}

// ------------------------------------------------------------------ thân
function torso(ctx, p, o, top, bot, w, view) {
  const x = -w / 2;
  // quần (cạp)
  rr(ctx, x + 0.4, bot - 3.8, w - 0.8, 4.2, [0, 0, 2.8, 2.8], p.pants, p.line);
  // áo — nam vai vuông, nữ vai tròn
  const sh = bot - top - 2.6;
  const radii = p.fem ? [6.2, 6.2, 3.0, 3.0] : [4.0, 4.0, 2.4, 2.4];
  rr(ctx, x, top, w, sh, radii, p.shirt, p.line);
  ctx.save();
  rrPath(ctx, x, top, w, sh, radii);
  ctx.clip();
  // bóng bên phải + ánh sáng bên trái
  ctx.fillStyle = p.shirtS;
  ctx.fillRect(x + w * 0.74, top, w * 0.3, sh);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x + w * 0.1, top + 1.2, w * 0.14, sh - 3);
  if (o.blazer) {
    // vest: hai vạt sẫm, ve áo sáng (nghiêng: vest phủ gần hết, chừa dải sơ mi phía trước)
    ctx.fillStyle = p.shirtD;
    if (view === 'left') ctx.fillRect(x + 2.4, top, w - 2.4, sh);
    else {
      ctx.fillRect(x, top, w * 0.32, sh);
      ctx.fillRect(x + w * 0.68, top, w * 0.32, sh);
    }
    if (view === 'up') {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x + w / 2 - 0.5, top + 2, 1.0, sh - 3);
    }
  }
  if (view === 'up' && !o.blazer) {
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, top + 2.5); ctx.lineTo(0, bot - 4); ctx.stroke();
  }
  ctx.restore();
  if (view === 'down') {
    // cổ áo chữ V + cổ
    ctx.beginPath();
    ctx.moveTo(-3.2, top + 0.2); ctx.lineTo(0, top + 3.6); ctx.lineTo(3.2, top + 0.2); ctx.closePath();
    ctx.fillStyle = p.skin; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4.2, top + 0.1); ctx.lineTo(-0.5, top + 4.0); ctx.lineTo(-1.5, top + 0.1);
    ctx.moveTo(4.2, top + 0.1); ctx.lineTo(0.5, top + 4.0); ctx.lineTo(1.5, top + 0.1);
    ctx.fillStyle = o.blazer ? '#f8fafc' : p.shirtL; ctx.fill();
    if (p.acc === 'tie') {
      ctx.beginPath();
      ctx.moveTo(-1.3, top + 3.2); ctx.lineTo(1.3, top + 3.2); ctx.lineTo(2.0, top + 9.6); ctx.lineTo(0, top + 11.6); ctx.lineTo(-2.0, top + 9.6); ctx.closePath();
      fillStroke(ctx, '#c0262d', 'rgba(60,10,10,0.6)', 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-0.5, top + 4.2, 0.8, 5.5);
    }
    if (o.badge) {
      rr(ctx, 2.4, top + 5.2, 3.8, 4.4, 0.7, o.badge, 'rgba(0,0,0,0.3)');
      rr(ctx, 3.0, top + 7.0, 2.6, 0.9, 0.3, 'rgba(255,255,255,0.85)', null);
    }
  } else if (view === 'left') {
    // cổ áo nhìn nghiêng
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 0.4, top + 0.2); ctx.lineTo(-w / 2 + 3.2, top + 3.4); ctx.lineTo(-w / 2 + 3.6, top + 0.2); ctx.closePath();
    ctx.fillStyle = o.blazer ? '#f8fafc' : p.shirtL; ctx.fill();
    if (p.acc === 'tie') {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 1.0, top + 3.0); ctx.lineTo(-w / 2 + 3.0, top + 3.0); ctx.lineTo(-w / 2 + 2.4, top + 10.4); ctx.lineTo(-w / 2 + 0.8, top + 10.6); ctx.closePath();
      fillStroke(ctx, '#c0262d', null);
    }
  } else if (view === 'up') {
    // cổ áo sau gáy (cà vạt/vest: cổ sơ mi trắng ló ra)
    if (p.acc === 'tie' || o.blazer) rr(ctx, -4.6, top - 0.6, 9.2, 2.2, [0.6, 0.6, 1.4, 1.4], '#f8fafc', p.line);
    else rr(ctx, -3.6, top - 0.2, 7.2, 1.6, [0.4, 0.4, 1.0, 1.0], p.shirtS, null);
  }
}

// Quy ước góc: 0 = buông thẳng xuống; góc dương xoay tay về phía -x (bên trái màn hình).
function arm(ctx, p, sx, sy, angle, len, holding) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  rr(ctx, -2.05, -1.0, 4.1, len * 0.6, 2.0, p.shirt, p.line);
  rr(ctx, -1.7, len * 0.42, 3.4, len * 0.5, 1.6, p.skin, null);
  circ(ctx, 0, len, 2.25, p.skin, p.line);
  if (holding) holding(ctx, 0, len);
  ctx.restore();
}

/** chỉ bắp tay (nhìn từ sau lưng khi đang ngồi, cẳng tay khuất phía trước) */
function upperArm(ctx, p, sx, sy, angle, len) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  rr(ctx, -2.1, -1.0, 4.2, len, 2.1, p.shirt, p.line);
  ctx.restore();
}

function leg(ctx, p, x, top, bottom, lift, w = 4.6) {
  rr(ctx, x - w / 2, top, w, bottom - top - lift, [1, 1, 1.6, 1.6], p.pants, p.line);
  rr(ctx, x - w / 2 - 0.6, bottom - lift - 3.0, w + 1.2, 3.2, [1.4, 1.4, 1.5, 1.5], p.shoe, p.line);
  rr(ctx, x - w / 2 - 0.2, bottom - lift - 2.6, w + 0.4, 0.9, 0.4, 'rgba(255,255,255,0.22)', null);
}

// đồ cầm tay (vẽ trong hệ toạ độ đã xoay của cánh tay)
const HOLD = {
  cup: (ctx, x, y) => { rr(ctx, x - 1.8, y - 3.2, 3.6, 4.4, 0.7, '#fafafa', 'rgba(0,0,0,0.4)'); ctx.fillStyle = '#a16207'; ctx.fillRect(x - 1.8, y - 1.6, 3.6, 1.4); },
  water: (ctx, x, y) => { rr(ctx, x - 1.7, y - 3.2, 3.4, 4.4, 0.7, 'rgba(191,219,254,0.95)', 'rgba(0,0,0,0.35)'); },
  phone: (ctx, x, y) => { rr(ctx, x - 1.7, y - 4.2, 3.4, 5.6, 0.7, '#111827', null); ctx.fillStyle = '#60a5fa'; ctx.fillRect(x - 1.2, y - 3.7, 2.4, 4.2); },
  paddle: (ctx, x, y) => { rr(ctx, x - 0.7, y - 0.6, 1.4, 3.6, 0.6, '#7c4a1e', null); circ(ctx, x, y + 5.0, 3.4, '#dc2626', 'rgba(0,0,0,0.4)'); },
  paper: (ctx, x, y) => { rr(ctx, x - 2.4, y - 1.2, 4.8, 5.6, 0.3, '#ffffff', 'rgba(0,0,0,0.3)'); ctx.fillStyle = 'rgba(100,116,139,0.5)'; for (let k = 0; k < 3; k++) ctx.fillRect(x - 1.6, y + 0.2 + k * 1.2, 3.2 - (k % 2), 0.5); },
  bag: (ctx, x, y) => { rr(ctx, x - 2.4, y - 0.6, 4.8, 5.4, 0.5, '#f97316', 'rgba(0,0,0,0.35)'); ctx.strokeStyle = '#7c2d12'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, y - 0.6, 1.6, Math.PI, 0); ctx.stroke(); },
  // hộp bắp rang sọc đỏ trắng (ngồi xem)
  popcorn: (ctx, x, y) => {
    ctx.beginPath();
    ctx.moveTo(x - 3.0, y - 3.6); ctx.lineTo(x + 3.0, y - 3.6); ctx.lineTo(x + 2.2, y + 2.6); ctx.lineTo(x - 2.2, y + 2.6); ctx.closePath();
    fillStroke(ctx, '#fafafa', 'rgba(90,10,20,0.6)', 0.6);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#e11d48';
    for (let k = -2; k <= 2; k += 2) ctx.fillRect(x + k * 1.05 - 0.5, y - 3.8, 1.05, 6.6);
    ctx.restore();
    for (const [dx, dy] of [[-1.9, -4.3], [-0.4, -4.9], [1.1, -4.4], [2.2, -3.9], [0.4, -3.8], [-2.4, -3.7]]) circ(ctx, x + dx, y + dy, 1.15, '#fff3c4', 'rgba(150,100,20,0.5)');
  },
};

// ------------------------------------------------------------------ nhìn nghiêng (vẽ cho hướng trái; hướng phải = lật gương)
const SIDE_W = 10.2; // bề dày thân khi nhìn nghiêng

/** giày nhìn nghiêng: mũi giày hướng về trước (-x) */
function shoeSide(ctx, p, x, y, far) {
  rr(ctx, x - 5.0, y - 3.1, 7.6, 3.2, [1.5, 1.4, 1.5, 2.2], far ? shade(p.shoe, 0.14) : p.shoe, p.line);
  rr(ctx, x - 4.4, y - 2.7, 5.4, 0.9, 0.4, 'rgba(255,255,255,0.22)', null);
}

/** chân nhìn nghiêng khi đứng/đi: một nét dày xoay quanh hông (góc dương = đưa về trước), giày nằm ngang */
function legSide(ctx, p, hipX, hipY, angle, len, far) {
  const fx = hipX - Math.sin(angle) * len, fy = hipY + Math.cos(angle) * len;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(fx, fy - 1.6);
  ctx.strokeStyle = p.line; ctx.lineWidth = 4.4 + LINE_W * 2; ctx.stroke();
  ctx.strokeStyle = far ? p.pantsS : p.pants; ctx.lineWidth = 4.4; ctx.stroke();
  shoeSide(ctx, p, fx, fy, far);
}

/** chân khi ngồi nhìn nghiêng: đùi đưa về trước, ống chân thả xuống; chân xa vẽ trước, sẫm hơn, lệch nhẹ ra sau */
function legsSideSeated(ctx, p, bot, bean) {
  const hipY = bean ? bot - 0.8 : bot + 0.4;
  const kneeX = bean ? -9.8 : -8.2, kneeY = bean ? bot - 0.2 : bot + 1.6;
  const footX = bean ? -12.4 : -9.0;
  for (const far of [true, false]) {
    const dx = far ? 1.9 : 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0.6 + dx, hipY); ctx.lineTo(kneeX + dx, kneeY); ctx.lineTo(footX + dx, -1.6);
    ctx.strokeStyle = p.line; ctx.lineWidth = 4.8 + LINE_W * 2; ctx.stroke();
    ctx.strokeStyle = far ? p.pantsS : p.pants; ctx.lineWidth = 4.8; ctx.stroke();
    shoeSide(ctx, p, footX + dx, 0, far);
  }
}

/** đầu nhìn nghiêng: một mắt, mũi nhô ở mép trước, tai ở giữa-sau, tóc trùm đỉnh, phụ kiện đúng chỗ */
function headSide(ctx, p, o, hy) {
  circ(ctx, 0, hy, HEAD_R, p.skin, p.line);
  // mũi: bướu nhỏ nhô khỏi vòng đầu (che viền tròn đoạn đó rồi viền lại cạnh ngoài)
  ctx.beginPath();
  ctx.moveTo(-10.3, hy + 0.9);
  ctx.quadraticCurveTo(-HEAD_R - 1.6, hy + 2.4, -HEAD_R - 1.2, hy + 4.3);
  ctx.quadraticCurveTo(-HEAD_R - 0.3, hy + 5.7, -8.5, hy + 6.0);
  ctx.lineTo(-7.4, hy + 4.0); ctx.lineTo(-7.4, hy + 1.2);
  ctx.closePath();
  ctx.fillStyle = p.skin; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-10.3, hy + 0.9);
  ctx.quadraticCurveTo(-HEAD_R - 1.6, hy + 2.4, -HEAD_R - 1.2, hy + 4.3);
  ctx.quadraticCurveTo(-HEAD_R - 0.3, hy + 5.7, -8.5, hy + 6.0);
  ctx.strokeStyle = p.line; ctx.lineWidth = LINE_W; ctx.lineCap = 'round'; ctx.stroke();
  // mặt (vẽ trước tóc để mái phủ lên chân mày khi cần)
  const ey = hy + 1.6;
  eye(ctx, -4.8, ey, o, 0.85, p, 1);
  brows(ctx, [-4.8], ey - 3.7, o.mood, 0.9, p);
  if (p.blush) ellipse(ctx, -6.0, hy + 4.7, 2.0, 1.15, p.blush);
  facialSide(ctx, p, hy);
  mouth(ctx, -6.4, hy + 6.6, o, 0.72, p);
  const earHidden = p.style === 'bob' || p.style === 'long';
  const ear = () => { circ(ctx, 3.2, hy + 1.8, 2.3, p.skinS, p.line); circ(ctx, 3.6, hy + 2.0, 0.9, p.skinD, null); };
  if (p.acc === 'cap') {
    // tóc ló dưới mũ: mảng sau gáy + tóc mai
    rr(ctx, 0.2, hy - 3.6, 10.4, 9.0, 3.6, p.hair, p.line);
    rr(ctx, -2.6, hy - 3.6, 3.6, 5.6, 1.4, p.hair, p.line);
    if (earHidden) rr(ctx, -1.6, hy - 2.0, 11.0, 11.4, 3.2, p.hair, p.line);
    else ear();
  } else {
    if (earHidden) ear();
    hairSide(ctx, p, hy, p.style);
    if (!earHidden) ear();
  }
  accessoryFront(ctx, p, hy, 'left');
  if (p.style === 'ponytail' && p.acc !== 'cap') rr(ctx, 7.6, hy - 3.6, 2.8, 3.0, 1.3, p.bow, null);
  if (o.mood === 'shock') sweat(ctx, -HEAD_R - 1.4, hy - 3.6);
}

// ------------------------------------------------------------------ ngồi bệt (động tác "Ngồi xem" khi không có ghế)
/** nhìn từ trước: hai ống chân bắt chéo trước bụng, gối hai bên */
function legsFloorDown(ctx, p, bot) {
  const y = bot - 1.2;
  circ(ctx, -8.6, y - 1.6, 3.0, p.pants, p.line);
  circ(ctx, 8.6, y - 1.6, 3.0, p.pants, p.line);
  rr(ctx, -9.6, y - 3.2, 12.6, 4.6, 2.3, p.pantsS, p.line);
  rr(ctx, -3.0, y - 1.6, 12.6, 4.6, 2.3, p.pants, p.line);
  rr(ctx, -11.6, y - 2.6, 4.2, 3.6, 1.6, p.shoe, p.line);
  rr(ctx, 7.6, y - 1.0, 4.2, 3.6, 1.6, p.shoe, p.line);
}

/** nhìn từ sau: chỉ thấy hai đầu gối ló hai bên hông */
function legsFloorUp(ctx, p, bot) {
  ellipse(ctx, -8.8, bot - 2.2, 3.2, 2.6, p.pantsS);
  ellipse(ctx, 8.8, bot - 2.2, 3.2, 2.6, p.pantsS);
}

/** nhìn nghiêng (hướng trái): đùi đưa về trước, gối hơi nhô, ống chân gập về dưới mông */
function legsSideFloor(ctx, p, bot) {
  for (const far of [true, false]) {
    const dx = far ? 1.6 : 0;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0.8 + dx, bot - 0.6); ctx.lineTo(-8.2 + dx, bot - 3.4); ctx.lineTo(-3.4 + dx, -1.4);
    ctx.strokeStyle = p.line; ctx.lineWidth = 4.8 + LINE_W * 2; ctx.stroke();
    ctx.strokeStyle = far ? p.pantsS : p.pants; ctx.lineWidth = 4.8; ctx.stroke();
    shoeSide(ctx, p, -2.2 + dx, 0.2, far);
  }
}

/** trái tim nhỏ (động tác "Thả tim": hai tay chụm trước ngực) */
function heartShape(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.9, y - r * 1.25, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 0.9, y - r * 1.25, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  ctx.closePath();
  fillStroke(ctx, fill, 'rgba(120,10,40,0.55)', 0.8);
  ellipse(ctx, x - r * 0.45, y - r * 0.35, r * 0.28, r * 0.18, 'rgba(255,255,255,0.6)');
}

// ------------------------------------------------------------------ vẽ chính
// Vẽ một nhân vật. ctx đã translate tới điểm chân và scale (tỉ lệ nhân vật)/U ô.
// o: dir, pose ('stand' | 'sit' | 'floor'), moving, phase, t, seed, mood, talking, blink, hold,
//    anim (động tác — tính ở render/anims.js): { bob, bx, lean, pivot, liftY, headDY, headTilt, squat, legL, legR, stride,
//    arms: { l, r, near, far: { a, len, hold } }, front, heart, mouth, eyes, mood }.
const FLOOR = 8.2; // thân hạ xuống khi ngồi bệt
export function drawCharacter(ctx, look, o) {
  const p = pal(look);
  const dir = o.dir || 'down';
  const pose = o.pose || 'stand';
  const A = o.anim || null;
  const t = o.t || 0;
  const moving = !!o.moving && pose === 'stand';
  const ph = o.phase || 0;
  const s = Math.sin(ph);
  const breath = A ? 0 : Math.sin(t / 820 + (o.seed || 0)) * 0.45;
  const bob = (moving ? -Math.abs(s) * 1.5 : breath) + (A?.bob || 0);
  const squatDrop = (A?.squat || 0) * 3.4;
  if (A?.mouth) o.talking = true;
  if (A?.eyes === 'closed') o.blink = true;
  if (A?.mood) o.mood = A.mood;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // bóng (ngồi ghế: ghế đổ bóng)
  if (pose !== 'sit') {
    const sk = A?.lean ? 1 + Math.abs(Math.sin(A.lean)) * 0.9 : 1;
    ellipse(ctx, 0, 0.5, (pose === 'floor' ? 11 : 9.5) * sk, 3.3, 'rgba(8,4,12,0.38)');
  }

  if (A?.lean) {
    const py = A.pivot ?? 0;
    ctx.translate(0, A.liftY || 0);
    ctx.translate(0, py);
    ctx.rotate(A.lean);
    ctx.translate(0, -py);
  }
  if (dir === 'right') ctx.scale(-1, 1);
  const side = dir === 'left' || dir === 'right';
  const view = side ? 'left' : dir;

  const drop = (pose === 'sit' ? SIT : pose === 'floor' ? FLOOR : 0) + squatDrop;
  const top = TORSO_TOP + drop + bob;
  const bot = TORSO_BOT + drop + bob * 0.5;
  const hy = HEAD_Y + drop + bob + (A?.headDY || 0);
  const tw = side ? SIDE_W : p.fem ? 13.6 : 15.8; // nam vai rộng hơn
  const holdFn = o.hold ? HOLD[o.hold] : null;
  const legTop = LEG_TOP + bob * 0.4 + squatDrop;
  const liftL = A?.legL || 0, liftR = A?.legR || 0;
  const arms = A?.arms || null;
  const holdOf = (spec, fallback) => (spec && spec.hold ? HOLD[spec.hold] || null : fallback);

  // ---------- chân
  if (side) {
    if (pose === 'stand') {
      // sải chân: hai chân xoay quanh hông ngược chiều nhau, chân xa vẽ trước
      const a = moving ? s * 0.46 : (A?.stride || 0);
      const hipY = legTop + 0.4;
      const len = -hipY;
      legSide(ctx, p, 1.7, hipY, -a, len - (moving ? Math.max(0, -s) * 0.8 : 0) - liftL, true);
      legSide(ctx, p, -1.1, hipY, a, len - (moving ? Math.max(0, s) * 0.8 : 0) - liftR, false);
    } else if (pose === 'floor') legsSideFloor(ctx, p, bot);
    else legsSideSeated(ctx, p, bot, false);
  } else if (pose === 'stand') {
    leg(ctx, p, -3.3, legTop, 0, (moving ? Math.max(0, s) * 2.6 : 0) + liftL);
    leg(ctx, p, 3.3, legTop, 0, (moving ? Math.max(0, -s) * 2.6 : 0) + liftR);
  } else if (view === 'down') {
    if (pose === 'floor') legsFloorDown(ctx, p, bot);
    else {
      // ngồi ghế quay mặt ra: đùi đưa về trước, giày ở dưới
      const ly = -8.6;
      rr(ctx, -6.8, ly, 5.6, 6.2, 1.8, p.pants, p.line);
      rr(ctx, 1.2, ly, 5.6, 6.2, 1.8, p.pants, p.line);
      rr(ctx, -7.4, ly + 4.4, 6.4, 3.0, 1.4, p.shoe, p.line);
      rr(ctx, 1.0, ly + 4.4, 6.4, 3.0, 1.4, p.shoe, p.line);
    }
  } else if (pose === 'floor') legsFloorUp(ctx, p, bot);

  // thân trên có thể lắc ngang (nhảy) — chân đứng yên
  if (A?.bx) ctx.translate(A.bx, 0);

  // ---------- phần sau (tóc dài, tay xa)
  if (view === 'down') hairBackDown(ctx, p, hy, p.style);
  if (view === 'left') hairSideBack(ctx, p, hy, p.style);

  const swing = moving ? s * 0.6 : 0;
  const armLen = 10.6;
  if (view === 'left') {
    const far = farPal(p);
    if (arms?.far) arm(ctx, far, 1.4, top + 2.0, arms.far.a, arms.far.len ?? armLen - 0.8, null);
    else if (moving) arm(ctx, far, 1.4, top + 2.0, -swing * 1.1, armLen - 0.8, null);
  }
  // nhìn từ sau, tay đưa ra trước ngực (vỗ tay, thả tim): tay khuất sau lưng → vẽ trước thân
  const backArms = () => {
    const L = arms?.l, R = arms?.r;
    arm(ctx, p, -tw / 2 - 0.5, top + 2.0, L ? L.a : 0.12, L?.len ?? armLen, null);
    arm(ctx, p, tw / 2 + 0.5, top + 2.0, R ? R.a : -0.12, R?.len ?? armLen, null);
  };
  if (view === 'up' && arms && A?.front) backArms();

  // ---------- thân
  torso(ctx, p, o, top, bot, tw, view);

  // tay (trước/sau tuỳ hướng). Góc dương = xoay về phía -x.
  if (view === 'down') {
    if (arms) {
      const L = arms.l, R = arms.r;
      arm(ctx, p, -tw / 2 - 0.5, top + 2.0, L ? L.a : 0.12, L?.len ?? armLen, holdOf(L, null));
      arm(ctx, p, tw / 2 + 0.5, top + 2.0, R ? R.a : -0.12, R?.len ?? armLen, holdOf(R, holdFn));
    } else {
      arm(ctx, p, -tw / 2 - 0.5, top + 2.0, 0.12 + swing, armLen, null);
      arm(ctx, p, tw / 2 + 0.5, top + 2.0, -0.12 + swing, armLen, holdFn);
    }
    if (A?.heart) heartShape(ctx, 0, top + 5.4, 3.4 * A.heart, '#ff4d7a');
  } else if (view === 'up') {
    if (arms && !A?.front) backArms();
    else if (!arms) {
      if (pose !== 'stand') {
        // nhìn từ sau lưng khi ngồi: chỉ thấy bắp tay, khuỷu hơi bè ra
        upperArm(ctx, p, -tw / 2 - 0.1, top + 1.8, 0.3, 8.0);
        upperArm(ctx, p, tw / 2 + 0.1, top + 1.8, -0.3, 8.0);
      } else {
        arm(ctx, p, -tw / 2 - 0.5, top + 2.0, 0.12 - swing, armLen, null);
        arm(ctx, p, tw / 2 + 0.5, top + 2.0, -0.12 - swing, armLen, null);
      }
    }
  }

  // ---------- đầu (có thể gật / nghiêng)
  const tilt = A?.headTilt || 0;
  const neckY = hy + HEAD_R * 0.9;
  const headStart = () => { if (tilt) { ctx.save(); ctx.translate(0, neckY); ctx.rotate(tilt); ctx.translate(0, -neckY); } };
  const headEnd = () => { if (tilt) ctx.restore(); };
  if (view === 'up') {
    headStart();
    circ(ctx, -HEAD_R + 0.3, hy + 1.4, 2.5, p.skinS, p.line);
    circ(ctx, HEAD_R - 0.3, hy + 1.4, 2.5, p.skinS, p.line);
    circ(ctx, 0, hy, HEAD_R, p.skin, p.line);
    ellipse(ctx, 0, hy + HEAD_R - 1.5, 4.0, 2.2, p.skinS); // gáy
    hairUp(ctx, p, hy, p.style);
    if (p.acc !== 'none' && p.acc !== 'tie') accessoryFront(ctx, p, hy, 'up');
    headEnd();
    // ngồi xem: hộp bắp ló bên hông
    if (o.hold === 'popcorn' && pose !== 'stand') HOLD.popcorn(ctx, 10.6, top + 9.5);
  } else if (view === 'down') {
    headStart();
    circ(ctx, -HEAD_R + 0.3, hy + 1.4, 2.5, p.skinS, p.line);
    circ(ctx, HEAD_R - 0.3, hy + 1.4, 2.5, p.skinS, p.line);
    circ(ctx, 0, hy, HEAD_R, p.skin, p.line);
    const ey = hy + 1.6;
    eye(ctx, -4.0, ey, o, 1, p, -1);
    eye(ctx, 4.0, ey, o, 1, p, 1);
    brows(ctx, [-4.0, 4.0], ey - 3.8, o.mood, 1, p);
    if (p.blush) {
      ellipse(ctx, -6.8, hy + 4.8, 2.4, 1.3, p.blush);
      ellipse(ctx, 6.8, hy + 4.8, 2.4, 1.3, p.blush);
    }
    facialDown(ctx, p, hy);
    mouth(ctx, 0, hy + 6.6, o, 1, p);
    if (p.style === 'bald') {
      baldFringe(ctx, p, hy, 'down');
    } else if (p.acc !== 'cap') {
      hairCapDown(ctx, p, hy, p.style);
      if (p.style === 'bun') { circ(ctx, 0, hy - HEAD_R - 2.4, 4.6, p.hair, p.line); rr(ctx, -2.8, hy - HEAD_R + 0.4, 5.6, 1.7, 0.8, p.bow, null); }
      if (p.style === 'ponytail') rr(ctx, HEAD_R - 4.0, hy - 5.2, 2.6, 2.6, 1.2, p.bow, null);
    } else {
      // tóc lộ ra dưới mũ
      rr(ctx, -HEAD_R - 0.6, hy - 3.4, 3.8, 7.4, 1.6, p.hair, p.line);
      rr(ctx, HEAD_R - 3.2, hy - 3.4, 3.8, 7.4, 1.6, p.hair, p.line);
      if (p.style === 'long' || p.style === 'bob') {
        rr(ctx, -HEAD_R - 1.4, hy, 4.0, p.style === 'long' ? 14 : 8.5, 1.8, p.hair, p.line);
        rr(ctx, HEAD_R - 2.6, hy, 4.0, p.style === 'long' ? 14 : 8.5, 1.8, p.hair, p.line);
      }
    }
    accessoryFront(ctx, p, hy, 'down');
    if (o.mood === 'shock') sweat(ctx, HEAD_R + 1.6, hy - 2.4);
    headEnd();
  } else {
    // nghiêng trái: tay gần vẽ TRƯỚC đầu (không đè lên mặt) — trừ khi giơ cao quá đầu (vẫy, giơ nắm đấm)
    const near = arms?.near;
    const nearArm = () => {
      if (near) arm(ctx, p, -0.2, top + 2.2, near.a, near.len ?? armLen, holdOf(near, holdFn));
      else if (pose !== 'stand') arm(ctx, p, 0.0, top + 2.2, 0.36 + (holdFn ? 0.5 : 0), armLen, holdFn);
      else arm(ctx, p, 0.0, top + 2.2, 0.06 + swing * 1.1 + (holdFn ? 0.62 : 0), armLen, holdFn);
    };
    const raised = !!near && Math.abs(near.a) > 2.2;
    if (!raised) nearArm();
    headStart();
    headSide(ctx, p, o, hy);
    headEnd();
    if (raised) nearArm();
    if (A?.heart) heartShape(ctx, -9.8, top + 4.6, 3.2 * A.heart, '#ff4d7a');
  }
  ctx.restore();
}

/** đỉnh đầu (đơn vị cục bộ, chưa tính tỉ lệ nhân vật) — để đặt bong bóng / emote */
export function headTop(pose) {
  return HEAD_Y - HEAD_R - 3.5 + (pose === 'sit' ? SIT : pose === 'floor' ? FLOOR : 0);
}

/** tâm đầu (đơn vị cục bộ) */
export function headCenter(pose) {
  return HEAD_Y + (pose === 'sit' ? SIT : pose === 'floor' ? FLOOR : 0);
}

/** bán kính đầu (đơn vị cục bộ) */
export const HEAD_RADIUS = HEAD_R;

/** chân dung chibi (avatar trong khung chat, danh sách người xem) */
export function portrait(look, size, opts = {}) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  const full = !!opts.full;
  // khung: full = cả người, ngược lại = đầu + vai
  const unitsTall = full ? 52 : 34;
  const k = (size * dpr) / unitsTall;
  ctx.setTransform(k, 0, 0, k, (size * dpr) / 2, full ? size * dpr - 3 * k : (size * dpr) + 10.5 * k);
  drawCharacter(ctx, look, { dir: 'down', pose: 'stand', t: opts.t || 0, seed: 1, mood: opts.mood || 'neutral' });
  return c;
}
