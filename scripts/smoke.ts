// Smoke test toàn hệ thống (không ra Internet): dựng app thật với YouTube GIẢ + thư mục dữ liệu tạm, nối nhiều client
// WebSocket như trình duyệt, kiểm: HTTP tĩnh / chính sách / admin cookie, vào rạp, đi lại + server sửa vị trí, động tác,
// chat (lọc bậy, chặn link, giới hạn tốc độ), emoji, hàng chờ (luật YouTube, giới hạn, trùng), bỏ phiếu, hết bài, lỗi
// trình phát, báo cáo tự gỡ, admin (khoá, tắt tiếng, mời ra, cấm), nhiều phòng, rớt mạng vào lại, lưu / khôi phục.
//   npm run smoke
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { loadConfig, type Config } from '../src/config.js';
import { createApp, type App } from '../src/app.js';
import { createFakeYouTube } from './fake-youtube.js';
import { VENUES, randomLook } from '../public/js/shared/hall.js';

type Msg = Record<string, unknown> & { t: string };

const ADMIN = 'smoke-admin-token-123';
const dataDir = mkdtempSync(join(tmpdir(), 'vc-smoke-'));
const timers: NodeJS.Timeout[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => { timers.push(setTimeout(r, ms)); });

function makeCfg(over: Partial<Config> = {}): Config {
  return loadConfig({
    port: 0, host: '127.0.0.1', adminToken: ADMIN, ytApiKey: 'fake', persist: true, dataDir, roomCapacity: 8, maxRooms: 2, queueAddSeconds: 0.01, lookupsPerIpMinute: 1000,
    skipVoteRatio: 0.5, skipVoteMin: 2, reportAutoskip: 3, maxQueuePerUser: 2, maxVideoMinutes: 15, tickHz: 20,
    maxConnPerIp: 1000, joinsPerMinute: 1000, siteUrl: '', defaultVideo: '', ...over,
  });
}

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  id = 0;
  token = '';
  ck = Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16);
  closed = false;
  private waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = [];
  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (raw) => {
      let m: Msg;
      try { m = JSON.parse(String(raw)) as Msg; } catch { return; }
      this.msgs.push(m);
      for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
    });
    this.ws.on('close', () => { this.closed = true; });
    this.ws.on('error', () => { /* bỏ qua */ });
  }
  open(): Promise<void> {
    return new Promise((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  send(m: Record<string, unknown>): void { this.ws.send(JSON.stringify(m)); }
  /** chờ thông điệp thoả điều kiện (kể cả đã tới trước đó nếu since = true) */
  wait(pred: (m: Msg) => boolean, ms = 3000, since = false): Promise<Msg> {
    if (since) { const hit = this.msgs.find(pred); if (hit) return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { pred, res };
      this.waiters.push(w);
      timers.push(setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`hết giờ chờ (${pred.toString().slice(0, 120)})`)); } }, ms));
    });
  }
  waitT(t: string, ms = 3000, extra: (m: Msg) => boolean = () => true): Promise<Msg> { return this.wait((m) => m.t === t && extra(m), ms); }
  async join(name: string, room = ''): Promise<Msg> {
    const p = this.wait((m) => m.t === 'welcome' || m.t === 'join_err', 3000);
    this.send({ t: 'join', name, look: randomLook(), room, token: this.token, ck: this.ck });
    const m = await p;
    if (m.t === 'welcome') { this.id = m.you as number; this.token = m.token as string; }
    return m;
  }
  close(): void { try { this.ws.close(); } catch { /* bỏ qua */ } }
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  await fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
}

async function main(): Promise<void> {
  const youtube = createFakeYouTube();
  let app: App = createApp(makeCfg(), { youtube, dataDir, log: () => {} });
  let port = await app.listen(0, '127.0.0.1');
  let http = `http://127.0.0.1:${port}`;
  let wsUrl = `ws://127.0.0.1:${port}/ws`;
  const all: Client[] = [];
  let ipN = 0;
  // mỗi client một IP giả (như người xem khác nhau, qua header X-Real-IP mà nginx ghi ở production)
  const connect = async (headers: Record<string, string> = {}, query = ''): Promise<Client> => {
    const c = new Client(wsUrl + query, { 'x-real-ip': `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...headers });
    all.push(c);
    await c.open();
    await c.wait((m) => m.t === 'hello', 2000, true);
    return c;
  };
  console.log('🎬 smoke VibeCinema');

  // ------------------------------------------------------------ HTTP
  await step('HTTP: trang chủ có phiên bản tài nguyên + CSP, trang chính sách, chặn file lạ', async () => {
    const r = await fetch(`${http}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /src="\/v\/[0-9a-f]{12}\/js\/main\.js"/);
    assert.ok(!html.includes('%SITE_URL%'));
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-src https:\/\/www\.youtube\.com/);
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const ver = /\/v\/([0-9a-f]{12})\//.exec(html)![1];
    const js = await fetch(`${http}/v/${ver}/js/main.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await fetch(`${http}/chinh-sach`)).status, 200);
    assert.match(await (await fetch(`${http}/chinh-sach`)).text(), /YouTube/);
    assert.equal((await fetch(`${http}/js/shared/hall.d.ts`)).status, 404);
    assert.equal((await fetch(`${http}/js/shared/hall.js`)).status, 200);
    assert.equal((await fetch(`${http}/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${http}/.env`)).status, 404);
    const h = await (await fetch(`${http}/api/health`)).json() as { ok: boolean; yt: boolean };
    assert.equal(h.ok, true);
    assert.equal(h.yt, true);
    assert.equal((await fetch(`${http}/api/nope`)).status, 404);
  });

  let adminCookie = '';
  await step('Admin: sai mã 403, đúng mã → cookie HttpOnly SameSite=Strict (không chứa mã thật)', async () => {
    const bad = await fetch(`${http}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'sai-roi-nhe' }) });
    assert.equal(bad.status, 403);
    const notJson = await fetch(`${http}/api/admin/login`, { method: 'POST', body: `token=${ADMIN}` });
    assert.equal(notJson.status, 415);
    const ok = await fetch(`${http}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ADMIN }) });
    assert.equal(ok.status, 204);
    const sc = ok.headers.get('set-cookie') ?? '';
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.ok(!sc.includes(ADMIN), 'cookie không được chứa mã admin thật');
    adminCookie = sc.split(';')[0];
    const out = await fetch(`${http}/api/admin/logout`, { method: 'POST' });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });

  await step('WebSocket: trang khác (Origin lạ) bị từ chối', async () => {
    const ws = new WebSocket(wsUrl, { headers: { origin: 'https://evil.example' } });
    const r = await new Promise<string>((res) => { ws.on('open', () => res('open')); ws.on('error', () => res('error')); ws.on('unexpected-response', () => res('rejected')); });
    assert.notEqual(r, 'open');
  });

  // ------------------------------------------------------------ vào rạp
  const a = await connect();
  const b = await connect();
  await step('hello: người đứng xem nhận phòng + cài đặt, không phải admin', async () => {
    const h = a.msgs.find((m) => m.t === 'hello')!;
    assert.equal(h.admin, false);
    assert.equal((h.rooms as unknown[]).length, VENUES.length, 'mỗi rạp một phòng chính');
    assert.equal(h.room, 'nhung');
    assert.equal((h.cfg as { maxVideoMin: number }).maxVideoMin, 15);
  });
  await step('vào rạp: tên sai bị từ chối, tên đúng nhận welcome, người khác thấy pj', async () => {
    assert.equal((await a.join('A')).t, 'join_err');
    assert.equal((await a.join('admin')).code, 'name');
    const pj = b.waitT('pj');
    const w = await a.join('Hào');
    assert.equal(w.t, 'welcome');
    assert.equal(((await pj).p as { name: string }).name, 'Hào');
    const dup = await b.join('hao');
    assert.equal(dup.code, 'name_taken');
    assert.equal((await b.join('Bống')).t, 'welcome');
  });

  // ------------------------------------------------------------ di chuyển
  await step('di chuyển: hợp lệ → frame cho người khác (giữ giờ máy người đi)', async () => {
    const me = (b.msgs.find((m) => m.t === 'welcome')!.snap as { players: { id: number; x: number; y: number }[] }).players.find((p) => p.id === b.id)!;
    await sleep(300);
    const f = a.wait((m) => m.t === 'f' && (m.p as number[][]).some((e) => e[0] === b.id && e[4] === 5000));
    b.send({ t: 'move', x: me.x, y: me.y - 0.5, d: 1, c: 5000, m: 1 });
    const e = ((await f).p as number[][]).find((x) => x[0] === b.id)!;
    assert.ok(Math.abs(e[2] - (me.y - 0.5)) < 0.02);
  });
  await step('di chuyển: đi nhanh quá / vào tường → server sửa (corr) về chỗ đi được', async () => {
    const corr = b.waitT('corr');
    b.send({ t: 'move', x: 16, y: 1.5, d: 1, c: 5050, m: 1 }); // nhảy cóc nửa rạp trong 50 ms
    const c1 = await corr;
    assert.ok((c1.y as number) > 5, `server phải kéo lại, được y=${c1.y}`);
    await sleep(400);
    const corr2 = b.waitT('corr');
    b.send({ t: 'move', x: 0.2, y: c1.y as number, d: 2, c: 5600, m: 1 }); // vào tường trái
    const c2 = await corr2;
    assert.ok((c2.x as number) >= 1.3);
  });

  // ------------------------------------------------------------ động tác
  await step('động tác: là sự kiện (act) + đi thì server tự bỏ động tác', async () => {
    const ev = a.waitT('act', 2000, (m) => m.id === b.id);
    b.send({ t: 'act', a: 'hiphop', c: 6000 });
    const m = await ev;
    assert.equal(m.a, 'hiphop');
    assert.equal(m.c, 6000);
    const c3 = await connect();
    const snap = (c3.msgs.find((x) => x.t === 'hello')!.snap as { players: { id: number; a: string; ae: number }[] }).players.find((p) => p.id === b.id)!;
    assert.equal(snap.a, 'hiphop');
    c3.close();
    await sleep(250);
    b.send({ t: 'move', x: 16, y: 9.9, d: 0, c: 7000, m: 1 });
    await sleep(150);
    const c4 = await connect();
    const snap2 = (c4.msgs.find((x) => x.t === 'hello')!.snap as { players: { id: number; a: string }[] }).players.find((p) => p.id === b.id)!;
    assert.equal(snap2.a, '');
    c4.close();
  });

  // ------------------------------------------------------------ chat + emoji
  await step('chat: phát cho cả phòng, che từ bậy, chặn link, chặn lặp', async () => {
    const got = a.waitT('chat');
    b.send({ t: 'chat', text: 'phim hay vl' });
    assert.equal(((await got).m as { text: string }).text, 'phim hay ***');
    const n1 = b.waitT('notice');
    b.send({ t: 'chat', text: 'vào shopee.vn mua đi' });
    assert.match((await n1).text as string, /link/);
    await sleep(700);
    const n2 = b.waitT('notice');
    b.send({ t: 'chat', text: 'phim hay vl' });
    assert.match((await n2).text as string, /lặp/);
  });
  await step('chat: gửi dồn dập bị chặn rồi tự tắt tiếng 2 phút', async () => {
    const loud = await connect();
    assert.equal((await loud.join('Ồn Ào')).t, 'welcome');
    const slow = loud.waitT('notice', 2000, (m) => /Chậm lại/.test(m.text as string));
    const muted = loud.waitT('notice', 2000, (m) => /tắt tiếng 2 phút/.test(m.text as string));
    for (let i = 0; i < 7; i++) loud.send({ t: 'chat', text: `tin ${i}` });
    await slow;
    await muted;
    loud.close();
  });
  await step('emoji: hợp lệ thì phát, lạ thì bỏ qua', async () => {
    const e = a.waitT('emo');
    b.send({ t: 'emo', e: '💩' });
    b.send({ t: 'emo', e: '🔥' });
    assert.equal((await e).e, '🔥');
  });

  // ------------------------------------------------------------ hàng chờ
  // (giới hạn thêm video trong test: 1 lần / 10 ms → nghỉ 25 ms giữa các lần)
  const lastNow = (c: Client): { v: string; title: string } | null => (c.msgs.filter((m) => m.t === 'now').pop()?.n as { v: string; title: string } | null) ?? null;
  const qres = async (c: Client, url: string): Promise<Msg> => { await sleep(25); const p = c.waitT('q_res', 3000); c.send({ t: 'q_add', url }); return p; };
  await step('hàng chờ: link sai / chặn nhúng / 18+ / chặn VN / quá dài / riêng tư bị từ chối kèm lý do', async () => {
    assert.match((await qres(a, 'https://vimeo.com/1234')).text as string, /không phải link video YouTube/);
    await sleep(50);
    const cases: [string, RegExp][] = [
      ['https://youtu.be/noEmbed0001', /không cho phép phát/], ['https://youtu.be/ageLimit001', /độ tuổi/],
      ['https://youtu.be/noVietnam01', /Việt Nam/], ['https://youtu.be/tooLong0001', /tối đa 15 phút/],
      ['https://youtu.be/private0001', /không công khai/i], ['https://youtu.be/missing0001', /Không tìm thấy/],
    ];
    for (const [u, re] of cases) { const r = await qres(a, u); assert.match(r.text as string, re, `${u} → ${r.text}`); }
  });
  await step('hàng chờ: thêm được → chiếu ngay (now) + giới hạn mỗi người + chống trùng', async () => {
    const nowP = b.waitT('now', 3000, (m) => !!m.n);
    const r = await qres(b, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    assert.equal(r.ok, true, r.text as string);
    const n = (await nowP).n as { v: string; at: number; dur: number };
    assert.equal(n.v, 'jNQXAC9IVRw');
    assert.ok(n.at > Date.now(), 'giây 0 nằm sau lúc thêm (cho máy tải trình phát)');
    assert.equal((await qres(b, 'https://youtu.be/YE7VzlLtp-4')).ok, true);
    const dup = await qres(a, 'https://youtu.be/YE7VzlLtp-4');
    assert.match(dup.text as string, /đã có trong hàng chờ/);
    assert.equal((await qres(b, 'https://youtu.be/eRsGyueVLvQ')).ok, true);
    const lim = await qres(b, 'https://youtu.be/abcdefghijk');
    assert.match(lim.text as string, /chỉ được chờ 2 video/);
  });
  await step('bỏ phiếu: đủ phiếu → bài kế; người thêm bỏ qua bài mình ngay', async () => {
    const c = await connect();
    await c.join('Cún');
    const cur = (a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string }).v;
    const nextP = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== cur);
    a.send({ t: 'vote', on: true });
    c.send({ t: 'vote', on: true });
    const nx = (await nextP).n as { v: string; by: string };
    assert.notEqual(nx.v, cur);
    // bài đang chiếu do b thêm → b bỏ qua ngay
    const p2 = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== nx.v);
    b.send({ t: 'vote', on: true });
    await p2;
    c.close();
  });
  await step('thêm clip 2 giây (để kiểm hết bài ở bước admin)', async () => {
    const r = await qres(a, 'https://youtu.be/shortClip01');
    assert.equal(r.ok, true, r.text as string);
    const q = a.msgs.filter((m) => m.t === 'queue').pop()!.q as { v: string }[];
    assert.ok(q.some((x) => x.v === 'shortClip01'));
  });

  // ------------------------------------------------------------ admin
  const adm = await connect({ cookie: adminCookie });
  await step('admin: cookie → hello.admin = true; người thường gửi lệnh admin bị lờ', async () => {
    assert.equal(adm.msgs.find((m) => m.t === 'hello')!.admin, true);
    assert.equal((await adm.join('Chủ Rạp')).t, 'welcome');
    a.send({ t: 'adm', op: 'lock', on: true });
    await sleep(200);
    assert.equal(a.msgs.filter((m) => m.t === 'queue').pop()!.locked, false);
  });
  await step('admin: bỏ qua tới clip ngắn, clip tự hết → bài kế', async () => {
    // bỏ qua cho tới khi clip 2 giây đang chiếu
    for (let i = 0; i < 6; i++) {
      const cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string } | null;
      if (cur?.v === 'shortClip01') break;
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal((a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string }).v, 'shortClip01');
    const ended = await a.waitT('now', 9000, (m) => (m.n as { v: string } | null)?.v !== 'shortClip01');
    assert.ok(ended);
  });
  await step('admin: khoá hàng chờ → người thường không thêm được, admin vẫn thêm', async () => {
    const q = a.waitT('queue', 2000, (m) => m.locked === true);
    adm.send({ t: 'adm', op: 'lock', on: true });
    await q;
    const r = await qres(a, 'https://youtu.be/lockTest001');
    assert.match(r.text as string, /khoá/);
    assert.equal((await qres(adm, 'https://youtu.be/adminVid001')).ok, true);
    adm.send({ t: 'adm', op: 'lock', on: false });
    await a.waitT('queue', 2000, (m) => m.locked === false);
  });
  await step('admin: tắt tiếng → không chat được; bật lại → chat được', async () => {
    adm.send({ t: 'adm', op: 'mute', pid: b.id, minutes: 10 });
    await b.waitT('notice', 2000, (m) => /tắt tiếng/.test(m.text as string));
    await sleep(700);
    const n = b.waitT('notice', 2000, (m) => /đang bị tắt tiếng/.test(m.text as string));
    b.send({ t: 'chat', text: 'alo alo' });
    await n;
    adm.send({ t: 'adm', op: 'unmute', pid: b.id });
    await b.waitT('notice', 2000, (m) => /bật tiếng lại/.test(m.text as string));
    const got = a.waitT('chat', 2000, (m) => (m.m as { text: string }).text === 'đã được nói');
    b.send({ t: 'chat', text: 'đã được nói' });
    await got;
  });
  await step('báo cáo: 3 người báo cáo video đang chiếu → tự gỡ + chặn thêm lại', async () => {
    const extra: Client[] = [];
    for (const n of ['Rùa', 'Thỏ']) { const c = await connect(); assert.equal((await c.join(n)).t, 'welcome', n); extra.push(c); }
    let cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string; title: string } | null;
    if (!cur) {
      assert.equal((await qres(adm, 'https://youtu.be/reportMe001')).ok, true);
      await a.waitT('now', 3000, (m) => !!m.n);
      cur = a.msgs.filter((m) => m.t === 'now').pop()!.n as { v: string; title: string };
    }
    const gone = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== cur!.v);
    for (const c of [a, ...extra]) c.send({ t: 'report', kind: 'video', target: cur.v, reason: 'copyright', note: 'thử' });
    await gone;
    const note = await adm.wait((m) => m.t === 'adm' && m.kind === 'note', 2000, true);
    assert.match(note.text as string, /báo cáo/);
    const again = await qres(a, `https://youtu.be/${cur.v}`);
    assert.match(again.text as string, /đã bị gỡ/);
    const log = readFileSync(join(dataDir, 'reports.jsonl'), 'utf8');
    assert.ok(log.includes(cur.v));
    for (const c of extra) c.close();
  });
  await step('lỗi trình phát 150 trên các máy → chuyển bài + không cho thêm lại', async () => {
    // dọn màn hình: admin bỏ qua tới khi không còn gì chiếu
    for (let i = 0; i < 12 && lastNow(a); i++) {
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal(lastNow(a), null);
    const playing = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v === 'embedFail01');
    assert.equal((await qres(adm, 'https://youtu.be/embedFail01')).ok, true);
    await playing;
    const next = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== 'embedFail01');
    a.send({ t: 'vid_err', v: 'embedFail01', code: 150 });
    b.send({ t: 'vid_err', v: 'embedFail01', code: 150 });
    await next;
    const r = await qres(b, 'https://youtu.be/embedFail01');
    assert.match(r.text as string, /không phát được/);
  });
  await step('admin: mời ra → bị đóng kết nối, 2 phút không vào lại được (theo máy, người chung mạng không bị vạ lây)', async () => {
    const victim = await connect({ 'x-real-ip': '10.9.9.9' });
    assert.equal((await victim.join('Phá Đám')).t, 'welcome');
    const k = victim.waitT('kicked');
    adm.send({ t: 'adm', op: 'kick', pid: victim.id });
    await k;
    await sleep(200);
    assert.equal(victim.closed, true);
    const again = await connect({ 'x-real-ip': '10.9.9.9' });
    again.ck = victim.ck;
    assert.equal((await again.join('Phá Đám 2')).code, 'kicked');
    again.close();
    const neighbour = await connect({ 'x-real-ip': '10.9.9.9' }); // cùng wifi, máy khác
    assert.equal((await neighbour.join('Hàng Xóm')).t, 'welcome');
    neighbour.close();
  });
  await step('admin: cấm → không vào lại được (lưu bans.json); bỏ cấm → vào được', async () => {
    const victim = await connect({ 'x-real-ip': '10.8.8.8' });
    assert.equal((await victim.join('Spam')).t, 'welcome');
    adm.send({ t: 'adm', op: 'ban', pid: victim.id, hours: 0 });
    await victim.waitT('kicked');
    const bans = JSON.parse(readFileSync(join(dataDir, 'bans.json'), 'utf8')) as { id: string; name: string }[];
    assert.equal(bans[0].name, 'Spam');
    const again = await connect({ 'x-real-ip': '10.8.8.8' });
    assert.equal((await again.join('Spam Lại')).code, 'banned');
    adm.send({ t: 'adm', op: 'unban', id: bans[0].id });
    await sleep(200);
    const ok = await again.join('Hết Cấm');
    assert.equal(ok.t, 'welcome');
    again.close();
  });
  await step('admin: gỡ hẳn video đang chiếu → chuyển bài + không ai thêm lại được', async () => {
    assert.equal((await qres(adm, 'https://youtu.be/takeDown001')).ok, true);
    for (let i = 0; i < 12 && lastNow(a)?.v !== 'takeDown001'; i++) {
      const p = a.waitT('now', 3000);
      adm.send({ t: 'adm', op: 'skip' });
      await p;
    }
    assert.equal(lastNow(a)?.v, 'takeDown001');
    const gone = a.waitT('now', 3000, (m) => (m.n as { v: string } | null)?.v !== 'takeDown001');
    adm.send({ t: 'adm', op: 'block', v: 'takeDown001' });
    await gone;
    assert.match((await qres(b, 'https://youtu.be/takeDown001')).text as string, /đã bị gỡ/);
  });
  await step('admin: state (danh sách người, báo cáo, cấm, video bị gỡ)', async () => {
    const st = adm.waitT('adm', 2000, (m) => m.kind === 'state');
    adm.send({ t: 'adm', op: 'state' });
    const s = await st;
    assert.ok(Array.isArray(s.players) && (s.players as unknown[]).length >= 2);
    assert.ok((s.blocked as unknown[]).length >= 1);
    assert.ok((s.reports as unknown[]).length >= 3);
  });

  // ------------------------------------------------------------ nhiều rạp + nhiều phòng + rớt mạng
  await step('rạp: link ?phong=bien → xem Rạp Bãi Biển; đổi sang xem rạp khác; vào đúng rạp đã chọn', async () => {
    const c = await connect({}, '?room=bien');
    const h = c.msgs.find((m) => m.t === 'hello')!;
    assert.equal(h.room, 'bien');
    assert.equal((h.snap as { venue: string }).venue, 'bien');
    const h2 = c.wait((m) => m.t === 'hello' && m.room === 'congvien', 2000);
    c.send({ t: 'spec', room: 'congvien' });
    assert.equal(((await h2).snap as { name: string }).name, 'Rạp Công Viên');
    const w = await c.join('Khách Biển', 'doxe');
    assert.equal(w.t, 'welcome');
    assert.equal(w.room, 'doxe');
    assert.equal((w.snap as { venue: string }).venue, 'doxe');
    const c2 = await connect({}, '?room=bien-7'); // bản sao không có → về phòng chính của rạp
    assert.equal(c2.msgs.find((m) => m.t === 'hello')!.room, 'bien');
    c.close();
    c2.close();
  });
  await step('vào lại ở tab mới (mất token, cùng khoá máy) → nhận lại đúng nhân vật, không báo trùng tên; đổi tên → nhân vật mới', async () => {
    const spy = await connect({}, '?room=congvien');
    const t1 = await connect();
    const w1 = await t1.join('Tab Cũ', 'congvien');
    assert.equal(w1.t, 'welcome');
    const ck = t1.ck;
    t1.close();
    await spy.waitT('pu', 2000, (m) => (m.p as { id: number; ghost: boolean }).id === w1.you && (m.p as { ghost: boolean }).ghost);
    const t2 = await connect();
    t2.ck = ck;
    const w2 = await t2.join('Tab Cũ', 'congvien');
    assert.equal(w2.t, 'welcome', 'cùng máy vào lại không được báo trùng tên');
    assert.equal(w2.you, w1.you, 'phải nhận lại đúng nhân vật cũ');
    const gone = spy.waitT('pl', 2000, (m) => m.id === w1.you);
    const t3 = await connect();
    t3.ck = ck;
    const w3 = await t3.join('Tên Mới Toanh', 'congvien');
    assert.equal(w3.t, 'welcome');
    assert.notEqual(w3.you, w1.you, 'đổi tên → nhân vật mới');
    await gone;
    spy.close(); t2.close(); t3.close();
  });
  await step('chuyển rạp tại chỗ (switch): giữ nhân vật, sang rạp mới, rạp cũ thấy rời đi; vào lại chọn rạp khác → chuyển luôn', async () => {
    const spy = await connect({}, '?room=congvien');
    const s1 = await connect();
    const w1 = await s1.join('Người Chuyển', 'congvien');
    assert.equal(w1.room, 'congvien');
    const left = spy.waitT('pl', 2000, (m) => m.id === w1.you);
    const moved = s1.wait((m) => m.t === 'welcome' && m.room === 'bien', 2000);
    s1.send({ t: 'switch', room: 'bien' });
    const w2 = await moved;
    assert.equal(w2.you, w1.you, 'giữ nguyên nhân vật');
    assert.equal((w2.snap as { venue: string }).venue, 'bien');
    await left;
    // tải lại trang (còn token) rồi bấm rạp khác trên thẻ chào lại → vào đúng rạp vừa chọn
    const tok = s1.token, ck = s1.ck;
    s1.close();
    await sleep(100);
    const s2 = await connect();
    s2.token = tok; s2.ck = ck;
    const w3 = await s2.join('Người Chuyển', 'doxe');
    assert.equal(w3.you, w1.you);
    assert.equal(w3.room, 'doxe');
    spy.close(); s2.close();
  });
  await step('đóng tab (leave) → nhân vật biến mất ngay, không kẹt lại; khách mới không chọn rạp → vào rạp đông nhất', async () => {
    const spy = await connect({}, '?room=doxe');
    const l1 = await connect();
    const w = await l1.join('Sắp Về', 'doxe');
    const gone = spy.waitT('pl', 1500, (m) => m.id === w.you);
    l1.send({ t: 'leave' });
    await gone;
    spy.close(); l1.close();
    // server riêng: 2 người ở Rạp Đỗ Xe → khách mới không chọn rạp được xếp vào Rạp Đỗ Xe (đông nhất), không phải rạp đầu danh sách
    const app3 = createApp(makeCfg({ persist: false }), { youtube, dataDir: null, log: () => {} });
    const port3 = await app3.listen(0, '127.0.0.1');
    const mk = (ip: string, q = ''): Client => new Client(`ws://127.0.0.1:${port3}/ws${q}`, { 'x-real-ip': ip });
    const ps: Client[] = [];
    try {
      for (const [i, n] of ['Đỗ Một', 'Đỗ Hai'].entries()) {
        const c = mk(`10.8.0.${i + 1}`);
        ps.push(c);
        await c.open();
        await c.wait((m) => m.t === 'hello', 2000, true);
        assert.equal((await c.join(n, 'doxe')).room, 'doxe');
      }
      const fresh = mk('10.8.0.9');
      ps.push(fresh);
      await fresh.open();
      const h = await fresh.wait((m) => m.t === 'hello', 2000, true);
      assert.equal(h.room, 'doxe', 'khách mới phải vào rạp đông nhất');
    } finally {
      for (const c of ps) c.close();
      await app3.close();
    }
  });
  await step('rạp đầy (8 người, tính cả người đang kết nối lại) → tự mở bản sao cùng rạp (nhung-2)', async () => {
    // đang có: a, b, adm (+ người vào / ra); thêm tới khi tràn
    const extra: Client[] = [];
    let room2 = false;
    for (let i = 0; i < 9 && !room2; i++) {
      const c = await connect();
      // chọn đúng Rạp Nhung Đỏ (không chọn thì server xếp sang rạp khác còn chỗ)
      const w = await c.join(`Khách ${i + 1}`, 'nhung');
      assert.equal(w.t, 'welcome');
      if (w.room === 'nhung-2') room2 = true;
      extra.push(c);
    }
    assert.ok(room2, 'phải có người được xếp sang Rạp Nhung Đỏ 2');
    const rooms = await a.wait((m) => m.t === 'rooms' && (m.rooms as unknown[]).length === VENUES.length + 1, 2500, true);
    assert.ok(rooms);
    for (const c of extra) c.close();
  });
  await step('nối lại khi server vẫn giữ socket cũ (đổi wifi ↔ 4G) → nhận lại nhân vật, socket cũ bị đóng 4002', async () => {
    const t = await connect();
    assert.equal((await t.join('Đổi Mạng')).t, 'welcome');
    const t2 = new Client(wsUrl, { 'x-real-ip': '10.7.7.7' });
    all.push(t2);
    await t2.open();
    t2.token = t.token; t2.ck = t.ck;
    const closed = new Promise<number>((res) => t.ws.once('close', (code) => res(code)));
    const w = await t2.join('Đổi Mạng');
    assert.equal(w.t, 'welcome');
    assert.equal(w.you, t.id);
    assert.equal(await closed, 4002);
    // F5: giờ máy mới bắt đầu gần 0 nhưng gói di chuyển vẫn được nhận
    const me = ((w.snap as { players: { id: number; x: number; y: number }[] }).players).find((p) => p.id === t.id)!;
    await sleep(300);
    // (có thể đang ở Phòng 2 → nghe frame của chính phòng đó qua t2)
    const seen = t2.wait((m) => m.t === 'f' && (m.p as number[][]).some((e) => e[0] === t.id && e[4] === 50), 2000);
    t2.send({ t: 'move', x: me.x + 0.3, y: me.y, d: 3, c: 50, m: 1 });
    await seen;
    t2.close();
  });
  await step('rớt mạng: người khác thấy "mất mạng"; nối lại bằng token → đúng nhân vật cũ', async () => {
    const ghost = a.waitT('pu', 2000, (m) => (m.p as { id: number; ghost: boolean }).id === b.id && (m.p as { ghost: boolean }).ghost);
    const oldId = b.id, token = b.token, ck = b.ck;
    b.ws.terminate();
    await ghost;
    const b2 = new Client(wsUrl);
    all.push(b2);
    await b2.open();
    b2.token = token; b2.ck = ck;
    const w = await b2.join('Bống');
    assert.equal(w.t, 'welcome');
    assert.equal(w.you, oldId);
  });

  // ------------------------------------------------------------ chống ngập
  await step('ngập tin nhắn → bị đóng kết nối', async () => {
    const f = await connect();
    for (let i = 0; i < 400; i++) f.send({ t: 'ping', c: i });
    await sleep(600);
    assert.equal(f.closed, true);
  });

  // ------------------------------------------------------------ lưu / khôi phục
  await step('tắt server → lưu hàng chờ; bật lại → khôi phục video đang chiếu + hàng chờ', async () => {
    assert.equal((await qres(adm, 'https://youtu.be/persist0001')).ok, true);
    const queued = a.waitT('queue', 3000, (m) => (m.q as { v: string }[]).some((q) => q.v === 'persist0002'));
    assert.equal((await qres(adm, 'https://youtu.be/persist0002')).ok, true);
    const before = (await queued).q as { v: string }[];
    for (const c of all) c.close();
    await app.close();
    const saved = JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8')) as { rooms: { id: string; queue: { v: string }[] }[] };
    assert.ok(saved.rooms.find((r) => r.id === 'nhung')!.queue.length >= 1);
    app = createApp(makeCfg(), { youtube, dataDir, log: () => {} });
    port = await app.listen(0, '127.0.0.1');
    http = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
    const c = await connect();
    const h = c.msgs.find((m) => m.t === 'hello')!;
    const snap = h.snap as { queue: { v: string; byId: number }[]; now: { v: string } | null };
    assert.ok(snap.now, 'phải còn video đang chiếu');
    assert.deepEqual(snap.queue.map((q) => q.v), before.map((q) => q.v).filter((v) => v !== snap.now!.v));
    // người lạ vào đầu tiên không được trùng id với chủ video cũ
    const stranger = await connect();
    const ws = await stranger.join('Người Lạ');
    assert.ok(!snap.queue.some((q) => q.byId === ws.you), 'id mới không được trùng byId của video khôi phục');
    // chủ video (cùng khoá máy) vào lại → nhận lại quyền xoá video của mình
    const owner = await connect();
    owner.ck = adm.ck;
    const wo = await owner.join('Chủ Rạp');
    assert.ok((wo.snap as { queue: { byId: number }[] }).queue.some((q) => q.byId === wo.you), 'chủ video nhận lại quyền theo khoá máy');
    c.close(); stranger.close(); owner.close();
  });

  // ------------------------------------------------------------ video mặc định (server riêng, không đụng các bước trên)
  await step('video mặc định: phòng trống → tự phát kênh trực tiếp; không bỏ phiếu được; có video mới → nhường ngay', async () => {
    const app2 = createApp(makeCfg({ persist: false, defaultVideo: 'liveNow0001', defaultIdleSeconds: 0.4 }), { youtube, dataDir: null, log: () => {} });
    const port2 = await app2.listen(0, '127.0.0.1');
    const c = new Client(`ws://127.0.0.1:${port2}/ws?room=bien`, { 'x-real-ip': '10.9.0.1' });
    try {
      await c.open();
      await c.wait((m) => m.t === 'hello', 2000, true);
      const f = await c.wait((m) => m.t === 'now' && !!(m.n as { filler?: boolean } | null)?.filler, 4000, true);
      const n = f.n as { v: string; live: boolean; title: string };
      assert.equal(n.v, 'liveNow0001');
      assert.equal(n.live, true);
      assert.equal(n.title, 'Đang phát trực tiếp');
      assert.equal((await c.join('Người Xem', 'bien')).t, 'welcome');
      const note = c.waitT('notice', 2000);
      c.send({ t: 'vote', on: true });
      assert.match((await note).text as string, /kênh mặc định/);
      const played = c.wait((m) => m.t === 'now' && (m.n as { v?: string } | null)?.v === 'jNQXAC9IVRw', 3000);
      c.send({ t: 'q_add', url: 'https://youtu.be/jNQXAC9IVRw' });
      assert.ok(!((await played).n as { filler?: boolean }).filler, 'video người xem thêm phải phát ngay, không phải video mặc định');
    } finally {
      c.close();
      await app2.close();
    }
  });

  // ------------------------------------------------------------ không có YT_API_KEY (server riêng)
  await step('không có YT_API_KEY: kiểm cơ bản bằng oEmbed → vẫn thêm được video (chưa rõ độ dài, chiếu tối đa giới hạn); người thêm báo độ dài thật → chỉnh giờ hết bài; người khác báo một mình không đủ; nhận ra live; API hết quota cũng tự kiểm cơ bản', async () => {
    type NowMsg = { v: string; unk?: boolean; dur: number; live: boolean; at: number; ends: number; qid: number };
    const ytNoKey = createFakeYouTube({ noKey: true });
    const app3 = createApp(makeCfg({ persist: false, defaultVideo: '' }), { youtube: ytNoKey, dataDir: null, log: () => {} });
    const port3 = await app3.listen(0, '127.0.0.1');
    const a = new Client(`ws://127.0.0.1:${port3}/ws`, { 'x-real-ip': '10.9.1.1' });
    const b = new Client(`ws://127.0.0.1:${port3}/ws`, { 'x-real-ip': '10.9.1.2' });
    try {
      await a.open(); await b.open();
      await a.wait((m) => m.t === 'hello', 2000, true); await b.wait((m) => m.t === 'hello', 2000, true);
      assert.equal((await a.join('Người Thêm', 'nhung')).t, 'welcome');
      assert.equal((await b.join('Người Xem', 'nhung')).t, 'welcome');
      const add = async (c: Client, id: string): Promise<{ ok: boolean; text: string }> => {
        await new Promise((res) => setTimeout(res, 40)); // giới hạn "thêm chậm thôi" (2 lần dồn, hồi 10 ms / lượt ở cấu hình test)
        const r = c.waitT('q_res', 3000);
        c.send({ t: 'q_add', url: `https://youtu.be/${id}` });
        const m = await r;
        return { ok: m.ok === true, text: String(m.text) };
      };
      const r1 = await add(a, 'noEmbed0001');
      assert.equal(r1.ok, false); assert.match(r1.text, /không cho phát trên trang khác/);
      const r2 = await add(a, 'missing0001');
      assert.equal(r2.ok, false); assert.match(r2.text, /Không tìm thấy video/);
      assert.equal(ytNoKey.calls.length, 0, 'không có key thì không gọi Data API');
      // video thường: nhận ngay, chưa rõ độ dài, giờ hết bài = giới hạn 15 phút
      const playing = b.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'jNQXAC9IVRw', 3000);
      const r3 = await add(a, 'jNQXAC9IVRw');
      assert.equal(r3.ok, true, r3.text);
      const n1 = (await playing).n as NowMsg;
      assert.equal(n1.unk, true); assert.equal(n1.dur, 0); assert.equal(n1.live, false);
      assert.ok(Math.abs(n1.ends - n1.at - 15 * 60_000) < 5000, `chiếu tối đa 15 phút, được ${n1.ends - n1.at} ms`);
      // người khác báo một mình (2 mạng đang có mặt → cần 2) → chưa đổi; người thêm báo → nhận ngay
      b.send({ t: 'vid_dur', v: 'jNQXAC9IVRw', d: 5, live: false });
      const fixed = b.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'jNQXAC9IVRw' && !(m.n as NowMsg).unk, 3000);
      await new Promise((r) => setTimeout(r, 150));
      a.send({ t: 'vid_dur', v: 'jNQXAC9IVRw', d: 19, live: false });
      const n2 = (await fixed).n as NowMsg;
      assert.equal(n2.dur, 19, 'lấy độ dài người thêm báo, không phải số người khác báo bừa');
      assert.ok(Math.abs(n2.ends - n2.at - 19_000) < 3000, `giờ hết bài theo độ dài thật, được ${n2.ends - n2.at} ms`);
      // live: người thêm (b) bỏ qua bài đang chiếu của a không được, nên a tự bỏ qua bài mình → tới bài live của b
      const r4 = await add(b, 'liveNow0001');
      assert.equal(r4.ok, true, r4.text);
      const liveNow = a.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'liveNow0001', 3000);
      a.send({ t: 'vote', on: true });
      const n3 = (await liveNow).n as NowMsg;
      assert.equal(n3.unk, true);
      const isLive = a.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'liveNow0001' && (m.n as NowMsg).live, 3000);
      b.send({ t: 'vid_dur', v: 'liveNow0001', d: 36_000, live: true });
      const n4 = (await isLive).n as NowMsg;
      assert.equal(n4.unk, undefined); assert.equal(n4.dur, 0);
      assert.ok(Math.abs(n4.ends - n4.at - 30 * 60_000) < 5000, 'live chiếu tối đa LIVE_MAX_MINUTES');
    } finally {
      a.close(); b.close();
      await app3.close();
    }
    // có key nhưng Data API hết quota → không chặn ai, tự kiểm cơ bản
    const ytQuota = createFakeYouTube({ fail: { ok: false, code: 'quota', text: 'hết quota' } });
    const app4 = createApp(makeCfg({ persist: false, defaultVideo: '' }), { youtube: ytQuota, dataDir: null, log: () => {} });
    const port4 = await app4.listen(0, '127.0.0.1');
    const c = new Client(`ws://127.0.0.1:${port4}/ws`, { 'x-real-ip': '10.9.2.1' });
    try {
      await c.open();
      await c.wait((m) => m.t === 'hello', 2000, true);
      assert.equal((await c.join('Người Xem', 'nhung')).t, 'welcome');
      const playing = c.wait((m) => m.t === 'now' && (m.n as NowMsg | null)?.v === 'eRsGyueVLvQ', 3000);
      const r = c.waitT('q_res', 3000);
      c.send({ t: 'q_add', url: 'https://youtu.be/eRsGyueVLvQ' });
      assert.equal((await r).ok, true);
      assert.equal(((await playing).n as NowMsg).unk, true);
      assert.deepEqual(ytQuota.calls, ['eRsGyueVLvQ']);
      assert.deepEqual(ytQuota.oembedCalls, ['eRsGyueVLvQ']);
    } finally {
      c.close();
      await app4.close();
    }
  });

  for (const c of all) c.close();
  await app.close();
  for (const t of timers) clearTimeout(t);
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`✅ smoke: ${passed} bước đạt`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ smoke lỗi:', e instanceof Error ? e.stack : e);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  process.exit(1);
});
