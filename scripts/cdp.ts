// Điều khiển Chrome / Chromium headless qua DevTools Protocol, chỉ cần `ws` (đã có) — không thêm dependency.
// Dùng bởi scripts/qa.ts (chụp màn hình + bắt lỗi console) và scripts/share-images.ts (ảnh chia sẻ).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

export function findChrome(): string {
  const cands = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of cands) if (c && existsSync(c)) return c;
  throw new Error('Không tìm thấy Chrome / Chromium — đặt CHROME_PATH=<đường dẫn tới file chạy Chrome>');
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Reply = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown> };

export interface Page {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  screenshot(): Promise<Buffer>;
  on(method: string, fn: (params: Record<string, unknown>) => void): void;
  close(): Promise<void>;
}

export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export async function launch(opts: { width?: number; height?: number } = {}): Promise<Browser> {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'vc-qa-'));
  const proc: ChildProcess = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    // tab headless không bị coi là "chạy nền" → requestAnimationFrame chạy đủ 60 fps (để đo độ mượt)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${opts.width ?? 1440},${opts.height ?? 900}`, 'about:blank',
  ], { stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); ready = true; } catch { await sleep(120); }
  }
  if (!ready) { proc.kill(); throw new Error('Chrome không mở được cổng DevTools'); }
  return {
    async newPage(): Promise<Page> {
      const t = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string; id: string };
      const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      let seq = 0;
      const pending = new Map<number, (m: Reply) => void>();
      const subs = new Map<string, ((p: Record<string, unknown>) => void)[]>();
      ws.on('message', (raw) => {
        let m: Reply;
        try { m = JSON.parse(String(raw)) as Reply; } catch { return; }
        if (typeof m.id === 'number' && pending.has(m.id)) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
        if (m.method) for (const fn of subs.get(m.method) ?? []) fn(m.params ?? {});
      });
      const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message ?? 'lỗi'}`)) : res(m.result)));
        ws.send(JSON.stringify({ id, method, params }));
      });
      await send('Page.bringToFront').catch(() => { /* bỏ qua */ });
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { /* bỏ qua */ });
      return {
        send,
        async evaluate<T>(expression: string): Promise<T> {
          const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
          if (r?.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
          return r?.result?.value as T;
        },
        async screenshot(): Promise<Buffer> {
          const r = (await send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
          if (typeof r?.data !== 'string') throw new Error('Không chụp được màn hình');
          return Buffer.from(r.data, 'base64');
        },
        on(method, fn) { subs.set(method, [...(subs.get(method) ?? []), fn]); },
        async close() { try { ws.close(); } catch { /* bỏ qua */ } },
      };
    },
    async close() {
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* bỏ qua */ }
    },
  };
}
