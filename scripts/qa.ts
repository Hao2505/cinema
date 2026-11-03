// QA hình ảnh: dựng server (YouTube GIẢ, không ghi đĩa) + bot người xem, mở Chrome headless qua CDP, vào rạp như
// người thật trên máy tính (1440×900) và điện thoại (390×844), chụp màn hình, bắt lỗi console, đo độ mượt.
//   npm run qa -- --out <thư mục ảnh> [--bots 14] [--video aqz-KE-bpKQ]
// Trang có nhúng trình phát YouTube thật (cần Internet); phần còn lại chạy cục bộ. Không chạy trong `npm test`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';
import { startBots } from './bots.js';
import { launch, sleep, type Page } from './cdp.js';
import { SPEED } from '../public/js/shared/hall.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const outDir = resolve(args.get('out') || 'qa-shots');
const nBots = Number(args.get('bots') ?? 14);
const video = args.get('video') ?? 'aqz-KE-bpKQ';
const only = args.get('only') || ''; // 'desktop' | 'mobile' | 'smooth' (chỉ đo độ mượt, không chụp)
const smoothSecs = Number(args.get('secs') || 15);
const room = args.get('room') || ''; // rạp cần chụp (vd 'bien'): người xem giả + trang QA vào đúng rạp đó
const roomQs = room ? `?phong=${encodeURIComponent(room)}` : '';
const jitter = Number(args.get('jitter') || 0); // giả lập mạng xấu cho người xem giả (ms)
const bunch = args.has('bunch'); // giả lập gói dồn cục + khựng như đo trên production
mkdirSync(outDir, { recursive: true });

const errors: string[] = [];
function watch(page: Page, tag: string): void {
  page.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
    errors.push(`[${tag}] exception: ${d?.exception?.description ?? d?.text}`);
  });
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    const a = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
    errors.push(`[${tag}] console.${p.type}: ${a.map((x) => String(x.value ?? x.description ?? '')).join(' ')}`);
  });
  page.on('Log.entryAdded', (p) => {
    const e = p.entry as { level?: string; text?: string; url?: string } | undefined;
    if (e && (e.level === 'error' || e.level === 'warning')) errors.push(`[${tag}] log.${e.level}: ${e.text} ${e.url ?? ''}`);
  });
}

async function key(page: Page, code: string, keyName: string, vk: number, type: 'keyDown' | 'keyUp'): Promise<void> {
  // Enter cần kèm text '\r' thì form mới tự submit (giống bấm phím thật)
  const text = type === 'keyDown' && keyName === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
  await page.send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...text });
}
async function hold(page: Page, code: string, keyName: string, vk: number, ms: number): Promise<void> {
  await key(page, code, keyName, vk, 'keyDown');
  await sleep(ms);
  await key(page, code, keyName, vk, 'keyUp');
}
async function shot(page: Page, name: string): Promise<void> {
  const buf = await page.screenshot();
  writeFileSync(join(outDir, name), buf);
  console.log('📸', join(outDir, name));
}
async function waitFor(page: Page, expr: string, ms = 15000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await page.evaluate<boolean>(expr)) return true; } catch { /* trang đang tải */ }
    await sleep(150);
  }
  return false;
}

/** luật YouTube của rạp: không phần tử giao diện nào được đè lên khung video */
async function checkOverlap(page: Page, tag: string): Promise<void> {
  const bad = await page.evaluate<string[]>(`(() => {
    const slot = document.getElementById('screen-slot');
    if (!slot || slot.hidden) return [];
    const v = slot.getBoundingClientRect();
    const out = [];
    for (const id of ['hud-l', 'hud-r', 'dock', 'side', 'sheet', 'toasts', 'react-pop', 'joystick', 'user-card', 'chat-feed', 'screen-tools', 'conn', 'focus-hint']) {
      const e = document.getElementById(id);
      if (!e || e.hidden) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      for (const b of [e.getBoundingClientRect(), ...[...e.children].map((c) => c.getBoundingClientRect())]) {
        if (!b.width || !b.height) continue;
        const ox = Math.min(b.right, v.right) - Math.max(b.left, v.left), oy = Math.min(b.bottom, v.bottom) - Math.max(b.top, v.top);
        if (ox > 0.5 && oy > 0.5) { out.push(id + ' đè video ' + Math.round(ox) + '×' + Math.round(oy)); break; }
      }
    }
    return out;
  })()`);
  for (const b of bad) errors.push(`[${tag}] ${b}`);
}

async function enterCinema(page: Page, name: string): Promise<void> {
  await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
  await page.evaluate(`(() => { const i = document.getElementById('join-name'); i.value = ${JSON.stringify(name)}; document.getElementById('join-form').requestSubmit(); })()`);
  if (!(await waitFor(page, 'window.__vc.store.joined === true', 8000))) {
    errors.push(`[${name}] không vào được rạp: ${await page.evaluate<string>("document.getElementById('join-err').textContent")}`);
  }
}

/**
 * đo độ mượt của người khác: khung "khựng" khi đang đi, bước nhảy vọt, và ĐỘ ĐỀU tốc độ — tốc độ từng khung so với tốc độ
 * đi thật (SPEED; 1/4 bot đi 0,6× như cần analog đẩy nhẹ) + mức đổi tốc giữa 2 khung liền nhau. Thời gian lấy đúng mốc
 * khung vẽ đã dùng cho người đó (a.posAt) nên không lẫn nhịp rAF của trang QA.
 */
async function smoothness(page: Page, seconds = 6): Promise<unknown> {
  return page.evaluate(`new Promise((resolve) => {
    const { store } = window.__vc;
    const SPEED = ${SPEED};
    const last = new Map();
    const lastV = new Map();
    let frames = 0, moving = 0, stalls = 0, steps = [];
    const dirs = new Map(); // hướng mặt người khác lúc đang đi — phải có nhiều hướng (bắt lỗi luôn quay một phía)
    const ratios = [], dv = [];
    const deltas = [];
    const net0 = { ...store.net };
    let prevT = performance.now();
    const t0 = prevT;
    function f() {
      const now = performance.now();
      deltas.push(now - prevT); prevT = now;
      for (const a of store.players.values()) {
        if (a.isMe || !a.lastCt) continue;
        if (a.moveAmt > 0.6) dirs.set(a.dir, (dirs.get(a.dir) || 0) + 1);
        const p = last.get(a.id);
        if (p && a.moveAmt > 0.6 && a.posAt > p.t) {
          moving++;
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d < 1e-4) stalls++; else steps.push(d);
          const dtf = (a.posAt - p.t) / 1000;
          if (dtf > 0.004 && dtf < 0.1) {
            const v = d / dtf;
            ratios.push(v / SPEED);
            const pv = lastV.get(a.id);
            if (pv !== undefined && pv > 0.15 && v > 0.15) dv.push(Math.abs(v - pv) / Math.max(v, pv));
            lastV.set(a.id, v);
          }
        } else lastV.delete(a.id);
        last.set(a.id, { x: a.x, y: a.y, t: a.posAt });
      }
      frames++;
      if (now - t0 < ${seconds * 1000}) requestAnimationFrame(f);
      else {
        const mean = steps.reduce((s, x) => s + x, 0) / Math.max(1, steps.length);
        const sd = Math.sqrt(steps.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, steps.length));
        deltas.shift();
        const hitches = deltas.filter((d) => d > 50).length;
        const ss = [...steps].sort((p, q) => p - q);
        const med = ss.length ? ss[ss.length >> 1] : 0;
        const jumps = med ? steps.filter((x) => x > med * 4).length : 0;
        // phân bố tốc độ (× SPEED) lúc đang đi — đi đều thì dồn vào 0.9–1.1 (và 0.5–0.7 cho bot đi chậm)
        const bins = [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.1], [1.1, 1.3], [1.3, 1.7], [1.7, 99]];
        const hist = {};
        for (const [lo, hi] of bins) hist[lo + '-' + (hi > 9 ? '∞' : hi)] = ratios.length ? +(100 * ratios.filter((r) => r >= lo && r < hi).length / ratios.length).toFixed(1) : 0;
        const dvs = [...dv].sort((p, q) => p - q);
        const q95 = dvs.length ? +dvs[Math.floor(dvs.length * 0.95)].toFixed(3) : null;
        resolve({ frames, fps: Math.round(frames / ${seconds}), movingSamples: moving, stallRatio: moving ? +(stalls / moving).toFixed(3) : null,
          jumps, maxStepRatio: med ? +(ss[ss.length - 1] / med).toFixed(1) : null,
          speedHist: hist, speedChangeP95: q95, speedChangeOver15: dv.length ? +(100 * dv.filter((x) => x > 0.15).length / dv.length).toFixed(2) : null,
          dry: store.net.dry - net0.dry, holdMs: Math.round(store.net.holdMs - net0.holdMs), catchup: store.net.catchup - net0.catchup,
          dirs: Object.fromEntries(dirs),
          stepCV: steps.length ? +(sd / mean).toFixed(3) : null, hitches, buffer: Math.round(store.net.buffer), netFrames: store.net.frames - net0.frames,
          view: window.__vc.view() });
      }
    }
    requestAnimationFrame(f);
  })`);
}

async function main(): Promise<void> {
  const cfg = loadConfig({ port: 0, host: '127.0.0.1', adminToken: 'qa-local-admin', persist: false, ytApiKey: 'fake', maxConnPerIp: 1000, joinsPerMinute: 100000 });
  const app = createApp(cfg, { youtube: createFakeYouTube(), dataDir: null, log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://localhost:${port}`;
  const stopBots = startBots({ url: `ws://127.0.0.1:${port}/ws`, n: nBots, video, room, jitter, bunch });
  const browser = await launch();
  try {
    await sleep(2500);
    if (only === 'smooth') {
      // chỉ đo độ mượt người khác (so sánh thuật toán / mạng giả lập), không chụp ảnh
      const page = await browser.newPage();
      watch(page, 'smooth');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: `${base}/${roomQs}` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await enterCinema(page, 'Tao Test');
      await sleep(4000);
      const sm = await smoothness(page, smoothSecs);
      console.log('🎞️  smooth', JSON.stringify(sm));
    }
    if (only !== 'mobile' && only !== 'smooth') {
      const page = await browser.newPage();
      watch(page, 'desktop');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: `${base}/${roomQs}#admin=qa-local-admin` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await sleep(1200);
      await shot(page, 'desktop-join.png');
      await enterCinema(page, 'Tao Test');
      await sleep(3500);
      await shot(page, 'desktop.png');
      // đi xuống sàn nhảy rồi nhảy
      await hold(page, 'KeyW', 'w', 87, 3000);
      await hold(page, 'KeyA', 'a', 65, 600);
      await key(page, 'Digit3', '3', 51, 'keyDown'); await key(page, 'Digit3', '3', 51, 'keyUp');
      await sleep(900);
      await shot(page, 'desktop-dance.png');
      await key(page, 'KeyE', 'e', 69, 'keyDown'); await key(page, 'KeyE', 'e', 69, 'keyUp');
      await sleep(500);
      await shot(page, 'desktop-wheel.png');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('chat-input').focus()");
      await page.send('Input.insertText', { text: 'Chào cả rạp nha 👋' });
      await key(page, 'Enter', 'Enter', 13, 'keyDown'); await key(page, 'Enter', 'Enter', 13, 'keyUp');
      await sleep(900);
      await shot(page, 'desktop-chat.png');
      await checkOverlap(page, 'desktop');
      await page.evaluate("document.getElementById('btn-react').click()");
      await sleep(400);
      await shot(page, 'desktop-react.png');
      await checkOverlap(page, 'desktop cảm xúc');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(700);
      await shot(page, 'desktop-drawer.png');
      await checkOverlap(page, 'desktop ngăn kéo');
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(400);
      const sm = await smoothness(page, 6);
      console.log('🎞️  desktop', JSON.stringify(sm));
      const ds = (sm as { dirs?: Record<string, number> }).dirs || {};
      if (Object.values(ds).reduce((a, b) => a + b, 0) > 200 && Object.keys(ds).length < 3) errors.push(`[desktop] người khác lúc đi chỉ quay ${Object.keys(ds).join('/')} — hướng mặt không theo hướng đi`);
      console.log('▶️  player', JSON.stringify(await page.evaluate('window.__vc.player()')));
      await page.evaluate("document.getElementById('btn-admin').click()");
      await sleep(700);
      await shot(page, 'desktop-admin.png');
      await checkOverlap(page, 'desktop admin');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      await page.evaluate("document.getElementById('btn-prefs').click()");
      await sleep(700);
      await shot(page, 'desktop-prefs.png');
      await checkOverlap(page, 'desktop tùy chọn');
      await key(page, 'Escape', 'Escape', 27, 'keyDown'); await key(page, 'Escape', 'Escape', 27, 'keyUp');
      // góc xem (menu 📺): rộng = video to nhất · cân = khán phòng rộng · rồi về mặc định (lớn)
      for (const v of ['rong', 'can', 'lon']) {
        await page.evaluate("document.getElementById('btn-theater').click()");
        await sleep(250);
        await page.evaluate(`document.querySelector('[data-view="${v}"]').click()`);
        await sleep(800);
        if (v !== 'lon') {
          await shot(page, `desktop-${v}.png`);
          await checkOverlap(page, `desktop góc xem ${v}`);
        }
      }
      // laptop nhỏ
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 680, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      await shot(page, 'desktop-small.png');
      await checkOverlap(page, 'desktop 1280×680');
      // chuyển rạp tại chỗ (không tải lại trang): canvas tối dần → rạp mới sáng dần
      const fromRoom = await page.evaluate<string>('window.__vc.store.roomId');
      await page.evaluate("window.__vcDoc = performance.timeOrigin; document.getElementById('room-pill').click()");
      await sleep(400);
      await page.evaluate("[...document.querySelectorAll('.room-item .btn')].find((b) => b.textContent.includes('Chuyển sang'))?.click()");
      if (!(await waitFor(page, `window.__vc.store.roomId !== ${JSON.stringify(fromRoom)} && window.__vc.store.joined`, 6000))) errors.push('[desktop] chuyển rạp tại chỗ không được');
      if (!(await page.evaluate<boolean>('window.__vcDoc === performance.timeOrigin'))) errors.push('[desktop] chuyển rạp bị tải lại trang');
      await sleep(1200);
      await shot(page, 'desktop-switched.png');
      await checkOverlap(page, 'desktop sau khi chuyển rạp');
      // mở lại trang: người đã vào rạp thấy thẻ "Chào mừng quay lại", bấm một rạp là vào luôn (khỏi đặt tên lại)
      await page.send('Page.navigate', { url: `${base}/` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true && window.__vc.store.rooms.length > 0');
      await sleep(800);
      await shot(page, 'desktop-quick.png');
      const quick = await page.evaluate<boolean>("!document.getElementById('join-quick').hidden && document.getElementById('join-form').hidden");
      if (!quick) errors.push('[desktop] mở lại trang không hiện thẻ "Chào mừng quay lại"');
      await page.evaluate("document.querySelector('.jq-room:not([disabled])').click()");
      if (!(await waitFor(page, 'window.__vc.store.joined === true', 8000))) errors.push('[desktop] bấm rạp trên thẻ chào lại không vào được');
      await page.close();
    }
    if (only !== 'desktop' && only !== 'smooth') {
      const page = await browser.newPage();
      watch(page, 'mobile');
      await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      await page.send('Page.navigate', { url: `${base}/${roomQs}` });
      await waitFor(page, 'window.__vc && window.__vc.store.ready === true');
      await sleep(1200);
      await shot(page, 'mobile-join.png');
      await enterCinema(page, 'Điện Thoại');
      await sleep(3500);
      await shot(page, 'mobile.png');
      await checkOverlap(page, 'mobile');
      await page.evaluate("document.getElementById('btn-actions').click()");
      await sleep(500);
      await shot(page, 'mobile-wheel.png');
      await page.evaluate("document.querySelector('.wheel-btn:nth-child(6)').click()");
      await sleep(1200);
      await page.evaluate("document.getElementById('btn-queue').click()");
      await sleep(600);
      await shot(page, 'mobile-queue.png');
      await checkOverlap(page, 'mobile hàng chờ');
      await page.evaluate("document.getElementById('btn-chat').click()");
      await sleep(500);
      await shot(page, 'mobile-chat.png');
      await page.evaluate("document.getElementById('side-close').click()");
      await sleep(300);
      await page.evaluate("document.getElementById('btn-prefs').click()");
      await sleep(600);
      await shot(page, 'mobile-prefs.png');
      await checkOverlap(page, 'mobile tùy chọn');
      await page.evaluate("document.getElementById('sheet-close').click()");
      await sleep(300);
      const sm = await smoothness(page, 5);
      console.log('🎞️  mobile', JSON.stringify(sm));
      // điện thoại xoay ngang
      await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true });
      await sleep(900);
      await shot(page, 'mobile-land.png');
      await checkOverlap(page, 'mobile ngang');
      await page.close();
    }
  } finally {
    stopBots();
    await browser.close();
    await app.close();
  }
  const real = errors.filter((e) => !/youtube|ytimg|googlevideo|doubleclick|google\.com|gstatic|ERR_BLOCKED_BY_CLIENT/i.test(e));
  if (errors.length) console.log(`\n⚠️  ${errors.length} dòng lỗi / cảnh báo (${real.length} không phải của YouTube):\n${errors.slice(0, 40).join('\n')}`);
  else console.log('\n✅ Không có lỗi console');
  process.exit(real.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
