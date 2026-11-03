// QA nhân vật: vẽ bảng 8 động tác × 4 hướng (đứng / ngồi ghế / ngồi bệt) ở vài thời điểm, chụp PNG để soi từng tư thế;
// thêm bảng dáng Nam / Nữ (kiểu tóc, râu, biểu cảm) × 4 hướng.
//   npx tsx scripts/qa-characters.ts --url http://localhost:3399 --out <thư mục>
// Cần một server rạp đang chạy (vd scripts/qa-server.ts) để nạp module vẽ.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, sleep } from './cdp.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const url = args.get('url') || 'http://localhost:3399';
const outDir = resolve(args.get('out') || 'qa-shots');
mkdirSync(outDir, { recursive: true });

const SCRIPT = (times: number[]) => `(async () => {
  const { drawCharacter, U } = await import('/js/render/character.js');
  const { actionPose } = await import('/js/render/anims.js');
  const { ACTIONS } = await import('/js/shared/hall.js');
  document.body.innerHTML = '';
  document.body.style.background = '#1b1422';
  const cell = 120, cols = 4 * ${times.length}, rows = ACTIONS.length + 2;
  const cv = document.createElement('canvas');
  cv.width = cols * cell + 150; cv.height = rows * cell + 40;
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1422'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = '600 13px sans-serif'; ctx.fillStyle = '#ddd';
  const look = { skin: '#f1c7a0', hair: '#3a2a1e', hairStyle: 'ponytail', shirt: '#3b82f6', pants: '#1f2937', accessory: 'headphones' };
  const dirs = ['down', 'up', 'left', 'right'];
  const times = ${JSON.stringify(times)};
  const labels = ['Đứng', 'Đi bộ', ...ACTIONS.map((a) => a.label)];
  labels.forEach((l, r) => ctx.fillText(l, 8, 40 + r * cell + cell / 2));
  times.forEach((t, ti) => dirs.forEach((d, di) => { ctx.fillText(d + ' t=' + t, 150 + (ti * 4 + di) * cell + 10, 20); }));
  for (let r = 0; r < rows; r++) {
    for (let ti = 0; ti < times.length; ti++) {
      for (let di = 0; di < 4; di++) {
        const x = 150 + (ti * 4 + di) * cell + cell / 2, y = 40 + r * cell + cell - 14;
        const dir = dirs[di];
        const view = dir === 'left' || dir === 'right' ? 'left' : dir;
        let opts = { dir, pose: 'stand', t: times[ti], seed: 1, mood: 'neutral' };
        if (r === 1) opts = { ...opts, moving: true, phase: times[ti] / 100 };
        if (r >= 2) {
          const a = ACTIONS[r - 2];
          const p = actionPose(a.id, times[ti], view, false, dir);
          if (p) { opts.anim = p.anim; if (p.pose) opts.pose = p.pose === 'sit' ? 'floor' : p.pose; if (p.hold) opts.hold = p.hold; if (p.dir) opts.dir = p.dir; }
        }
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x - cell / 2 + 4, y - cell + 18, cell - 8, cell - 8);
        ctx.translate(x, y); ctx.scale(2.2, 2.2);
        drawCharacter(ctx, look, opts);
        ctx.restore();
      }
    }
  }
  return [cv.width, cv.height];
})()`;

// bảng dáng người: mỗi hàng một ngoại hình, cột = 4 hướng + mặt cười + đang nói + ngồi ghế nhìn từ sau
const GALLERY = `(async () => {
  const { drawCharacter } = await import('/js/render/character.js');
  const { normalizeLook } = await import('/js/shared/hall.js');
  document.body.innerHTML = '';
  const looks = [
    ['Nam tóc ngắn', { body: 'nam', skin: '#f1c7a0', hair: '#2b2118', hairStyle: 'short', shirt: '#3b82f6', pants: '#1f2937' }],
    ['Nam đầu đinh + ria', { body: 'nam', skin: '#d9a77c', hair: '#3a2a1e', hairStyle: 'spiky', shirt: '#22c55e', pants: '#374151', facial: 'ria' }],
    ['Nam trọc + quai nón', { body: 'nam', skin: '#c68a5e', hair: '#1a1410', hairStyle: 'bald', shirt: '#ef4444', pants: '#1f2937', facial: 'rau', accessory: 'glasses' }],
    ['Nam xoăn + mũ', { body: 'nam', skin: '#8d5a3b', hair: '#1a1410', hairStyle: 'curly', shirt: '#f59e0b', pants: '#334155', accessory: 'cap', facial: 'rau' }],
    ['Nữ tóc dài', { body: 'nu', skin: '#f6d5b8', hair: '#2b2118', hairStyle: 'long', shirt: '#ec4899', pants: '#1f2937' }],
    ['Nữ tóc bob + nơ', { body: 'nu', skin: '#f1c7a0', hair: '#7c4a1e', hairStyle: 'bob', shirt: '#a855f7', pants: '#334155', accessory: 'bow' }],
    ['Nữ đuôi ngựa', { body: 'nu', skin: '#d9a77c', hair: '#f5d06b', hairStyle: 'ponytail', shirt: '#14b8a6', pants: '#1f2937', accessory: 'headphones' }],
    ['Nữ tóc ngắn', { body: 'nu', skin: '#c68a5e', hair: '#3a2a1e', hairStyle: 'short', shirt: '#f97316', pants: '#374151' }],
  ];
  const cols = [['down', 'neutral'], ['left', 'neutral'], ['up', 'neutral'], ['right', 'neutral'], ['down', 'happy'], ['down', 'talk'], ['up', 'sit']];
  const cell = 150, W = 190 + cols.length * cell, H = 40 + looks.length * cell;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1422'; ctx.fillRect(0, 0, W, H);
  ctx.font = '600 14px sans-serif'; ctx.fillStyle = '#ddd';
  cols.forEach(([d, m], i) => ctx.fillText(d + ' · ' + m, 190 + i * cell + 20, 24));
  looks.forEach(([label, raw], r) => {
    const look = normalizeLook(raw);
    ctx.fillStyle = '#ddd'; ctx.fillText(label, 10, 40 + r * cell + cell / 2);
    cols.forEach(([dir, mood], c) => {
      const x = 190 + c * cell + cell / 2, y = 40 + r * cell + cell - 16;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x - cell / 2 + 4, y - cell + 20, cell - 8, cell - 8);
      ctx.translate(x, y); ctx.scale(2.6, 2.6);
      drawCharacter(ctx, look, { dir, pose: mood === 'sit' ? 'sit' : 'stand', t: 400, seed: 1, mood: mood === 'happy' ? 'happy' : 'neutral', talking: mood === 'talk' });
      ctx.restore();
    });
  });
  return [W, H];
})()`;

async function main(): Promise<void> {
  const browser = await launch({ width: 2200, height: 1400 });
  try {
    const page = await browser.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Page.navigate', { url: `${url}/chinh-sach` });
    await sleep(1500);
    for (const [name, times] of [['characters-a.png', [300, 1200]], ['characters-b.png', [700, 1900]]] as [string, number[]][]) {
      const [w, h] = await page.evaluate<[number, number]>(SCRIPT(times));
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      writeFileSync(join(outDir, name), await page.screenshot());
      console.log('📸', join(outDir, name));
    }
    const [gw, gh] = await page.evaluate<[number, number]>(GALLERY);
    await page.send('Emulation.setDeviceMetricsOverride', { width: gw, height: gh, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    writeFileSync(join(outDir, 'characters-bodies.png'), await page.screenshot());
    console.log('📸', join(outDir, 'characters-bodies.png'));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
