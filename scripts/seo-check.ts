// Kiểm tra SEO + xem trước khi chia sẻ link (Facebook / Zalo / Messenger / Telegram / X / Google) của một site đang chạy:
// thẻ meta, Open Graph, Twitter, JSON-LD, ảnh chia sẻ (đúng 1200×630, nhẹ), robots.txt, sitemap.xml, manifest + mọi biểu
// tượng / ảnh app (đúng cỡ khai báo), favicon.ico, trang chính sách, giả làm bot của từng mạng xã hội, http → https.
//   npm run seo-check -- --url https://cinema.vibe-coder.fun      (production)
//   npm run seo-check -- --url http://localhost:3399              (máy nhà: npx tsx scripts/qa-server.ts)
// Thoát mã 1 nếu có lỗi (❌); ⚠️ là gợi ý. Không đổi gì trên site.
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) { const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args.set(k.slice(2), v); i++; } else args.set(k.slice(2), '1'); }
}
const base = (args.get('url') || 'http://localhost:3399').replace(/\/+$/, '');
const origin = new URL(base).origin;
const isProd = origin.startsWith('https://');

let errors = 0, warns = 0;
const ok = (m: string): void => console.log(`  ✅ ${m}`);
const bad = (m: string): void => { errors++; console.log(`  ❌ ${m}`); };
const warn = (m: string): void => { warns++; console.log(`  ⚠️  ${m}`); };
const check = (cond: boolean, good: string, fail: string): boolean => { if (cond) ok(good); else bad(fail); return cond; };

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const BOTS: [string, string][] = [
  ['Facebook / Messenger', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['Zalo', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Zalo/24.11'],
  ['Telegram', 'TelegramBot (like TwitterBot)'],
  ['X / Twitter', 'Twitterbot/1.0'],
  ['WhatsApp', 'WhatsApp/2.24.1 A'],
  ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
  ['Google', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
];

async function get(url: string, ua = BROWSER_UA, extra: RequestInit = {}): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'vi' }, redirect: 'follow', signal: AbortSignal.timeout(15_000), ...extra });
}

/** thẻ <meta>/<link> trong <head> — đọc đơn giản bằng regex (trang do mình viết, không cần trình phân tích HTML) */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = decode(m[2]);
  return out;
}
const decode = (s: string): string => s.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function parseHead(html: string): { title: string; meta: Map<string, string>; links: Record<string, string>[]; ld: string[]; lang: string } {
  const head = html.split(/<\/head>/i)[0];
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = a.property || a.name;
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const ld = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return { title: decode((/<title>([^<]*)<\/title>/i.exec(head)?.[1] ?? '').trim()), meta, links, ld, lang: /<html[^>]*\blang="([^"]+)"/i.exec(html)?.[1] ?? '' };
}

/** kích thước ảnh từ byte đầu: PNG (IHDR) hoặc JPEG (khung SOF) */
function imageSize(buf: Uint8Array): { w: number; h: number; type: string } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const v = new DataView(buf.buffer, buf.byteOffset);
    return { w: v.getUint32(16), h: v.getUint32(20), type: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1];
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8], type: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function checkImage(label: string, url: string, want?: { w: number; h: number }, maxKb = 0): Promise<void> {
  try {
    const r = await get(url);
    if (!r.ok) { bad(`${label}: ${url} → ${r.status}`); return; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const size = imageSize(buf);
    const kb = Math.round(buf.length / 1024);
    const type = r.headers.get('content-type') || '';
    if (!/^image\//.test(type)) { bad(`${label}: Content-Type "${type}" không phải ảnh`); return; }
    if (want && size && (size.w !== want.w || size.h !== want.h)) { bad(`${label}: ảnh ${size.w}×${size.h}, khai báo ${want.w}×${want.h}`); return; }
    if (maxKb && kb > maxKb) { bad(`${label}: ${kb} KB (nên < ${maxKb} KB — WhatsApp / Zalo bỏ ảnh nặng)`); return; }
    ok(`${label}: ${size ? `${size.w}×${size.h} ${size.type}` : type}, ${kb} KB`);
  } catch (e) { bad(`${label}: ${url} lỗi ${(e as Error).message}`); }
}

const abs = (u: string): boolean => /^https?:\/\//.test(u) && (!isProd || u.startsWith('https://'));

async function main(): Promise<void> {
  console.log(`🔎 Kiểm tra SEO + chia sẻ: ${base}\n`);

  // ---------------------------------------------------------------- trang chủ
  console.log('Trang chủ');
  const r = await get(`${base}/`, BROWSER_UA, { headers: { 'User-Agent': BROWSER_UA, 'Accept-Encoding': 'br, gzip' } });
  if (!check(r.ok, `200 · ${r.headers.get('content-type')}`, `trang chủ trả ${r.status}`)) return;
  const html = await r.text();
  const enc = r.headers.get('content-encoding');
  if (enc) ok(`nén ${enc}`); else warn('trang không nén (br / gzip)');
  const h = parseHead(html);
  check(!/%[A-Z_]+%/.test(html), 'không còn chỗ trống %…% chưa thay', `còn chỗ trống chưa thay: ${(html.match(/%[A-Z_]+%/g) || []).slice(0, 3).join(', ')}`);
  check(h.lang === 'vi', 'html lang="vi"', `html lang="${h.lang}" (cần "vi")`);
  check(h.title.length >= 30 && h.title.length <= 65, `<title> ${h.title.length} ký tự: "${h.title}"`, `<title> ${h.title.length} ký tự (nên 30–65): "${h.title}"`);
  const desc = h.meta.get('description') || '';
  check(desc.length >= 70 && desc.length <= 170, `description ${desc.length} ký tự`, `description ${desc.length} ký tự (nên 70–170)`);
  check(!!h.meta.get('viewport'), 'có viewport', 'thiếu meta viewport');
  check(!/noindex|nofollow/.test(h.meta.get('robots') || ''), `robots: ${h.meta.get('robots') || '(mặc định)'}`, 'meta robots chặn index');
  const canon = h.links.find((l) => l.rel === 'canonical')?.href || '';
  check(canon === `${origin}/`, `canonical ${canon}`, `canonical "${canon}" (cần ${origin}/)`);
  const alts = h.links.filter((l) => l.rel === 'alternate' && l.hreflang);
  check(alts.length > 0 && alts.every((l) => abs(l.href)), `hreflang: ${alts.map((l) => l.hreflang).join(', ')}`, 'hreflang thiếu / không tuyệt đối');

  // ---------------------------------------------------------------- Open Graph + Twitter
  console.log('\nOpen Graph (Facebook, Zalo, Messenger, Telegram, Discord, LinkedIn) + Twitter / X');
  for (const k of ['og:type', 'og:site_name', 'og:locale', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']) {
    const v = h.meta.get(k) || '';
    check(v.length > 0, `${k}: ${v.length > 70 ? `${v.slice(0, 67)}…` : v}`, `thiếu ${k}`);
  }
  const ogt = h.meta.get('og:title') || '', ogd = h.meta.get('og:description') || '';
  if (ogt.length > 60) warn(`og:title ${ogt.length} ký tự — Facebook cắt sau ~60`);
  if (ogd.length > 200) warn(`og:description ${ogd.length} ký tự — dài, dễ bị cắt`);
  const ogUrl = h.meta.get('og:url') || '';
  check(ogUrl === `${origin}/`, `og:url ${ogUrl}`, `og:url "${ogUrl}" (cần ${origin}/)`);
  check(h.meta.get('twitter:card') === 'summary_large_image', 'twitter:card summary_large_image', `twitter:card "${h.meta.get('twitter:card')}"`);
  const ogImg = h.meta.get('og:image') || '';
  if (check(abs(ogImg), `og:image ${ogImg}`, `og:image "${ogImg}" phải là URL tuyệt đối${isProd ? ' https' : ''}`)) {
    check(h.meta.get('og:image:width') === '1200' && h.meta.get('og:image:height') === '630', 'og:image:width/height 1200×630', 'thiếu / sai og:image:width / height');
    check((h.meta.get('twitter:image') || '') === ogImg, 'twitter:image trùng og:image', 'twitter:image khác og:image');
    await checkImage('ảnh chia sẻ (og:image)', ogImg, { w: 1200, h: 630 }, 300);
  }

  // ---------------------------------------------------------------- JSON-LD
  console.log('\nDữ liệu có cấu trúc (JSON-LD — Google)');
  if (!h.ld.length) bad('không có JSON-LD');
  for (const raw of h.ld) {
    try {
      const j = JSON.parse(raw) as { '@context'?: string; '@graph'?: { '@type'?: string | string[]; url?: string }[] };
      const types = (j['@graph'] || [j as { '@type'?: string }]).map((n) => [n['@type']].flat().join('/'));
      check(j['@context'] === 'https://schema.org', `JSON-LD hợp lệ: ${types.join(', ')}`, `JSON-LD @context "${j['@context']}"`);
      const urls = JSON.stringify(j).match(/"(?:url|@id|logo|image|screenshot|contentUrl)":\s*"([^"]+)"/g) || [];
      const badUrls = urls.map((u) => /"([^"]+)"$/.exec(u)?.[1] || '').filter((u) => u.startsWith('http') && !u.startsWith(origin) && !/github\.com|schema\.org/.test(u));
      if (badUrls.length) warn(`JSON-LD có URL khác tên miền: ${badUrls.slice(0, 3).join(', ')}`);
    } catch (e) { bad(`JSON-LD không đọc được: ${(e as Error).message}`); }
  }

  // ---------------------------------------------------------------- biểu tượng + manifest
  console.log('\nBiểu tượng + manifest (PWA, Android, iPhone)');
  const resolveUrl = (u: string): string => new URL(u, `${base}/`).href;
  for (const l of h.links.filter((x) => /icon/.test(x.rel || ''))) {
    const m = /^(\d+)x(\d+)$/.exec(l.sizes || '');
    const isIco = /\.ico(\?|$)/.test(l.href);
    await checkImage(`<link rel="${l.rel}"${l.sizes ? ` sizes="${l.sizes}"` : ''}>`, resolveUrl(l.href), m && !isIco ? { w: +m[1], h: +m[2] } : undefined);
  }
  const fav = await get(`${base}/favicon.ico`);
  check(fav.ok && /icon/.test(fav.headers.get('content-type') || ''), `/favicon.ico ${fav.status} ${fav.headers.get('content-type')}`, `/favicon.ico → ${fav.status}`);
  const manHref = h.links.find((l) => l.rel === 'manifest')?.href;
  if (check(!!manHref, `manifest ${manHref}`, 'thiếu <link rel="manifest">') && manHref) {
    try {
      const mr = await get(resolveUrl(manHref));
      const man = await mr.json() as { name?: string; short_name?: string; start_url?: string; display?: string; icons?: { src: string; sizes: string; purpose?: string }[]; screenshots?: { src: string; sizes: string }[] };
      check(mr.ok && /manifest\+json|json/.test(mr.headers.get('content-type') || ''), `manifest ${mr.status} ${mr.headers.get('content-type')}`, `manifest → ${mr.status}`);
      check(!!man.name && !!man.short_name && !!man.start_url && !!man.display, `manifest: "${man.name}" / "${man.short_name}", ${man.display}`, 'manifest thiếu name / short_name / start_url / display');
      const icons = man.icons || [];
      check(icons.some((i) => i.sizes === '512x512') && icons.some((i) => i.sizes === '192x192') && icons.some((i) => (i.purpose || '').includes('maskable')),
        `manifest có icon 192, 512, maskable`, 'manifest thiếu icon 192 / 512 / maskable');
      for (const i of [...icons, ...(man.screenshots || [])]) {
        const m = /^(\d+)x(\d+)$/.exec(i.sizes);
        await checkImage(`manifest ${i.src}`, resolveUrl(i.src), m ? { w: +m[1], h: +m[2] } : undefined);
      }
    } catch (e) { bad(`manifest không đọc được: ${(e as Error).message}`); }
  }

  // ---------------------------------------------------------------- robots + sitemap + chính sách
  console.log('\nrobots.txt + sitemap.xml + trang chính sách');
  const rb = await get(`${base}/robots.txt`);
  const rbt = await rb.text();
  check(rb.ok && /text\/plain/.test(rb.headers.get('content-type') || ''), `robots.txt ${rb.status}`, `robots.txt → ${rb.status} ${rb.headers.get('content-type')}`);
  check(rbt.includes(`Sitemap: ${origin}/sitemap.xml`), 'robots.txt trỏ tới sitemap', 'robots.txt thiếu dòng Sitemap đúng tên miền');
  check(!/^Disallow:\s*\/\s*$/m.test(rbt), 'robots.txt không chặn cả site', 'robots.txt chặn cả site (Disallow: /)');
  const sm = await get(`${base}/sitemap.xml`);
  const smt = await sm.text();
  check(sm.ok && /xml/.test(sm.headers.get('content-type') || ''), `sitemap.xml ${sm.status}`, `sitemap.xml → ${sm.status}`);
  const locs = [...smt.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(locs.includes(`${origin}/`), `sitemap: ${locs.join(', ')}`, `sitemap thiếu ${origin}/`);
  for (const loc of locs.filter((l) => l !== `${origin}/`)) {
    const pr = await get(loc.replace(origin, base));
    const ph = parseHead(await pr.text());
    check(pr.ok && !!ph.title && !!ph.meta.get('description') && !!ph.links.find((l) => l.rel === 'canonical'),
      `${loc}: 200, có title / description / canonical`, `${loc}: ${pr.status}, thiếu title / description / canonical`);
  }

  // ---------------------------------------------------------------- bot mạng xã hội
  console.log('\nGiả làm bot mạng xã hội (phải thấy đủ thẻ — không bị chặn / chuyển hướng lạ)');
  for (const [name, ua] of BOTS) {
    try {
      const br = await get(`${base}/`, ua);
      const bh = parseHead(await br.text());
      check(br.ok && bh.meta.get('og:image') === ogImg && !!bh.meta.get('og:title'), `${name}: ${br.status}, thấy og:title + og:image`, `${name}: ${br.status}, thiếu thẻ OG`);
    } catch (e) { bad(`${name}: lỗi ${(e as Error).message}`); }
  }

  // ---------------------------------------------------------------- http → https
  if (isProd) {
    console.log('\nhttp → https');
    try {
      const hr = await fetch(`http://${new URL(base).host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const loc = hr.headers.get('location') || '';
      check(hr.status === 301 && loc.startsWith(`${origin}/`), `http:// → ${hr.status} ${loc}`, `http:// trả ${hr.status} ${loc} (cần 301 sang ${origin}/)`);
    } catch (e) { warn(`không thử được http://: ${(e as Error).message}`); }
  }

  console.log(`\n${errors ? '❌' : '✅'} ${errors} lỗi, ${warns} gợi ý`);
  if (isProd && !errors) {
    console.log('Làm mới ảnh xem trước đã lưu: Facebook https://developers.facebook.com/tools/debug/ → dán link → "Scrape Again"; '
      + 'Zalo / Messenger / Telegram tự lấy lại sau vài giờ — muốn thấy ngay thì chia sẻ link kèm ?v=2.');
  }
}

main().then(() => process.exit(errors ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
