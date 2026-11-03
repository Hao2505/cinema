// Tạo ảnh dùng khi chia sẻ link (không dùng trong giao diện), vẽ bằng code qua Chrome headless:
//   public/og-image.jpg (1200×630, ảnh xem trước Facebook / Zalo / Messenger) — chụp rạp đang có người + thẻ tiêu đề
//   public/icon-512.png, public/icon-192.png, public/apple-touch-icon.png (180) — biểu tượng màn chiếu + rèm nhung
// Cách dùng: chạy server QA có bot (npx tsx scripts/qa-server.ts + npx tsx scripts/bots.ts) rồi
//   npm run share-images -- --url http://localhost:3399 [--label cinema.vibe-coder.fun] [--out public]
// Ảnh chụp KHÔNG chứa khung hình video YouTube (ẩn trình phát, thay bằng thẻ tiêu đề của rạp).
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, sleep } from './cdp.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const url = args.get('url') || 'http://localhost:3399';
const outDir = resolve(args.get('out') || 'public');
const label = args.get('label') || 'cinema.vibe-coder.fun';

const ICON = (size: number) => `(() => {
  const s = ${size};
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d');
  const k = s / 512;
  x.scale(k, k);
  // nền bo góc tím than
  const bg = x.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#2a1631'); bg.addColorStop(1, '#0e0b12');
  x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, 512, 512, 112); x.fill();
  // diềm
  x.fillStyle = '#8c1528'; x.fillRect(40, 70, 432, 40);
  x.strokeStyle = '#e6b14a'; x.lineWidth = 10;
  x.beginPath(); x.moveTo(40, 110); for (let i = 0; i < 4; i++) x.quadraticCurveTo(40 + i * 108 + 54, 150, 40 + (i + 1) * 108, 110); x.stroke();
  // màn chiếu sáng
  const sc = x.createLinearGradient(0, 150, 0, 360);
  sc.addColorStop(0, '#dbe7ff'); sc.addColorStop(1, '#8fb3ff');
  x.fillStyle = '#05040a'; x.beginPath(); x.roundRect(112, 142, 288, 196, 14); x.fill();
  x.fillStyle = sc; x.beginPath(); x.roundRect(124, 154, 264, 172, 8); x.fill();
  // nút play vàng
  x.fillStyle = '#ffc14d'; x.beginPath(); x.moveTo(232, 196); x.lineTo(232, 284); x.lineTo(304, 240); x.closePath(); x.fill();
  // rèm hai bên
  for (const side of [0, 1]) {
    x.save();
    if (side) { x.translate(512, 0); x.scale(-1, 1); }
    const g = x.createLinearGradient(40, 0, 130, 0);
    g.addColorStop(0, '#5a0a16'); g.addColorStop(0.5, '#c42a40'); g.addColorStop(1, '#7a0f20');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(40, 100); x.lineTo(132, 100); x.quadraticCurveTo(92, 260, 124, 420); x.lineTo(40, 420); x.closePath(); x.fill();
    x.fillStyle = '#e6b14a'; x.beginPath(); x.arc(110, 300, 14, 0, Math.PI * 2); x.fill();
    x.restore();
  }
  // hàng ghế
  for (let i = 0; i < 5; i++) { x.fillStyle = '#a3192f'; x.beginPath(); x.roundRect(86 + i * 70, 398, 58, 52, 14); x.fill(); x.fillStyle = '#c92a44'; x.fillRect(92 + i * 70, 398, 46, 12); }
  return c.toDataURL('image/png').split(',')[1];
})()`;

async function main(): Promise<void> {
  const browser = await launch({ width: 1200, height: 630 });
  try {
    const page = await browser.newPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    // ---- biểu tượng
    await page.send('Page.navigate', { url: `${url}/chinh-sach` });
    await sleep(800);
    for (const [file, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]] as [string, number][]) {
      const b64 = await page.evaluate<string>(ICON(size));
      writeFileSync(join(outDir, file), Buffer.from(b64, 'base64'));
      console.log('✅', join(outDir, file));
    }
    // ---- ảnh xem trước 1200×630
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await page.evaluate<boolean>('!!(window.__vc && window.__vc.store.ready && window.__vc.store.players.size >= 4)')) break;
    }
    await sleep(3500); // cho bot đi lại / nhảy
    await page.evaluate(`(() => {
      const st = document.createElement('style');
      // ẩn mọi nút nổi: rạp tự chiếm lại chỗ (ResizeObserver → syncInsets → không chừa cụm nút / dock)
      st.textContent = '.join,.hud,.dock-wrap,.side,.sheet,.chat-feed,.screen-tools,.toasts,.conn-banner,.focus-hint,.joystick{display:none!important}';
      document.head.append(st);
    })()`);
    await sleep(900);
    await page.evaluate(`(() => {
      const L = window.__vc.view().layout;
      const s = L.screen;
      const card = document.createElement('div');
      card.style.cssText = 'position:absolute;z-index:9;left:' + s.x + 'px;top:' + s.y + 'px;width:' + s.w + 'px;height:' + s.h + 'px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(circle at 50% 40%,#2b1d48,#0d0a16 75%);color:#f4effa;font-family:"Be Vietnam Pro",sans-serif;text-align:center';
      const t = document.createElement('div'); t.textContent = '🎬 VibeCinema'; t.style.cssText = 'font-size:' + Math.round(s.h * 0.2) + 'px;font-weight:800;letter-spacing:.5px';
      const sub = document.createElement('div'); sub.textContent = 'Rạp chiếu phim 2D — xem YouTube cùng cả rạp'; sub.style.cssText = 'font-size:' + Math.round(s.h * 0.085) + 'px;font-weight:600;color:#ffc14d';
      const sub2 = document.createElement('div'); sub2.textContent = 'Đặt tên là vào · đi lại · chat · nhảy · thả tim'; sub2.style.cssText = 'font-size:' + Math.round(s.h * 0.065) + 'px;color:#cfc6dc';
      const dom = document.createElement('div'); dom.textContent = ${JSON.stringify(label)}; dom.style.cssText = 'margin-top:6px;font-size:' + Math.round(s.h * 0.06) + 'px;font-weight:700;color:#fff;background:rgba(255,79,109,.85);padding:4px 14px;border-radius:999px';
      card.append(t, sub, sub2, dom);
      document.getElementById('stage').append(card);
      document.getElementById('screen-slot').hidden = true;
    })()`);
    await sleep(600);
    const r = (await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 })) as { data: string };
    writeFileSync(join(outDir, 'og-image.jpg'), Buffer.from(r.data, 'base64'));
    console.log('✅', join(outDir, 'og-image.jpg'));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
