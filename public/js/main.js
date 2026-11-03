// Điểm vào client: (1) đăng nhập admin nếu link có #admin=, (2) dựng canvas rạp + trình phát YouTube + giao diện,
// (3) nối WebSocket. Người xem đứng xem ngoài cửa (thấy rạp sống) tới khi đặt tên → "Vào rạp".
import { store } from './store.js';
import { adminLoginFromUrl, connect, isOpen, send } from './net.js';
import { applyCorrection, me, placeMe, tickMe, walkTo } from './me.js';
import { DIRS, ROOM_ID_RE, VENUES, parseRoomId, roomName, venueById } from './shared/hall.js';
import { prefetchThemes } from './render/venues/index.js';
import { createStage } from './render/stage.js';
import { createPlayer } from './player.js';
import { initInput } from './input.js';
import {
  initJoin, isReturning, lookEditor, rememberJoin, saveLook, savedLook, savedName, setJoinBusy, showJoinError,
} from './ui/join.js';
import { initChat, systemLine } from './ui/chat.js';
import { initQueue } from './ui/queue.js';
import { initWheel } from './ui/wheel.js';
import { initUserCard } from './ui/usercard.js';
import { initSheet, openSheet, closeSheet, sheetOpen, onSheetChange } from './ui/sheet.js';
import { initToasts, toast } from './ui/toasts.js';
import { hiddenList, onPrefs, prefs, resetPrefs, setPref, unhidePerson } from './prefs.js';
import { el, isTouch, lsGet, lsSet, randomHex, setKids, setText, ssGet, ssSet } from './util.js';

const $ = (id) => document.getElementById(id);

// khoá máy (chống spam / cấm theo máy) — ngẫu nhiên, không chứa thông tin cá nhân
let ck = lsGet('vc.ck', '');
if (!/^[a-f0-9]{16,64}$/.test(ck)) { ck = randomHex(16); lsSet('vc.ck', ck); }

await adminLoginFromUrl();

initToasts($('toasts'));
initSheet();

// ---------------------------------------------------------------- canvas + trình phát
let player = null;
const stage = createStage($('hall'), $('screen-slot'), {
  beforeFrame: (dt, now) => tickMe(dt, now),
  onLayout: (L) => layoutOverlays(L),
  screenInfo: () => {
    const n = store.now;
    if (!store.joined) {
      return { show: true, title: n ? `Đang chiếu: ${n.title}` : 'Chưa có video nào đang chiếu', sub: 'Đặt tên rồi vào rạp để xem cùng mọi người 🍿' };
    }
    if (!n) {
      const idle = Number(store.cfg.defaultIdleSec) || 0;
      return {
        show: true, title: 'Màn hình đang trống',
        sub: idle ? `Dán link YouTube vào Hàng chờ — trống quá ${Math.round(idle)} giây rạp tự phát kênh trực tiếp` : 'Dán link YouTube vào Hàng chờ để chiếu cho cả rạp',
      };
    }
    return { show: false };
  },
  onPick: (id, cx, cy) => userCard.open(id, cx, cy),
  // đang xem video cùng cả rạp (không phải đứng ngoài màn vào rạp) → làm tối xung quanh (⚙️)
  watching: () => store.joined && !!store.now && !store.now.paused,
  onFloorTap: (x, y) => { if (!wheel.open) walkTo(x, y); },
});
player = createPlayer($('screen-slot'), $('yt-host'), {
  onStatus: (s) => {
    const showing = !!store.now && s.enabled;
    $('btn-tap-play').hidden = !s.needsTap || !showing;
    setText($('btn-tap-play'), '▶ Bấm để xem');
    // trình duyệt tự tắt tiếng (chặn tự phát có tiếng) mà người xem không chọn tắt → mời bật tiếng
    $('btn-unmute').hidden = !(s.muted && !player.muted && !s.needsTap && showing);
    $('vol').hidden = !showing;
    $('btn-fs').hidden = !showing;
    setText($('btn-vol'), player.muted ? '🔇' : player.volume < 45 ? '🔉' : '🔊');
    $('vol-range').value = String(player.muted ? 0 : player.volume);
  },
  onNotice: (t) => toast(t, 'warn'),
});
$('btn-tap-play').addEventListener('click', () => player.userPlay());
$('btn-unmute').addEventListener('click', () => player.userPlay());
$('btn-vol').addEventListener('click', () => player.toggleMute());
$('vol-range').addEventListener('input', (e) => player.setVolume(Number(e.target.value)));
$('btn-fs').addEventListener('click', () => player.fullscreen());

function layoutOverlays(L) {
  const top = $('stage').getBoundingClientRect().top;
  const stripTop = L.screen.y + L.screen.h + L.frame;
  const tools = $('screen-tools');
  tools.style.left = `${L.screen.x}px`;
  tools.style.width = `${L.screen.w}px`;
  tools.style.top = `${Math.round(stripTop + Math.max(0, (L.audTop - stripTop - 28) / 2))}px`;
  tools.style.height = '28px';
  document.documentElement.style.setProperty('--aud-top', `${L.audTop}px`);
  document.documentElement.style.setProperty('--sheet-top', `${Math.round(top + stripTop + 4)}px`);
}
window.addEventListener('resize', () => { if (stage.layout) layoutOverlays(stage.layout); });

// ---------------------------------------------------------------- giao diện nổi
const wheel = initWheel(stage);
const userCard = initUserCard(stage);
initQueue();
// ngăn kéo kiểu thẻ nổi bên phải (máy tính, điện thoại xoay ngang) hay tấm trượt từ dưới (điện thoại dọc) — khớp style.css
const DESK = window.matchMedia('(min-width: 900px), (min-width: 640px) and (max-height: 519px)');
const SHORT = window.matchMedia('(max-height: 519px)'); // màn thấp: dock nổi đè lên lối đi cuối rạp, không chiếm chỗ
const FEED = window.matchMedia('(min-width: 900px) and (min-height: 520px)'); // có chỗ cho khung chat nổi
const isDesk = () => DESK.matches;
const isNarrow = () => !window.matchMedia('(min-width: 900px)').matches;
const side = $('side');
const sideOpen = () => side.classList.contains('open');
const feedVisible = () => FEED.matches && !sideOpen();
const chat = initChat({
  // tin mới thấy được (ngăn kéo, thẻ chat, hoặc khung chat nổi góc dưới trái) → không đếm chưa đọc
  isChatVisible: () => feedVisible() || (sideOpen() && (isDesk() || side.dataset.tab === 'chat')),
  feedVisible,
  onUnread: (n) => setText($('c-badge'), n ? String(Math.min(n, 99)) : ''),
});

/** cụm nút góc trên, dock dưới, ngăn kéo / tấm bên phải chiếm chỗ nào → canvas chừa chỗ, video không bao giờ bị đè */
function syncInsets() {
  const root = document.documentElement;
  const sideW = parseFloat(getComputedStyle(root).getPropertyValue('--side-w')) || 340;
  const right = isDesk() && (sideOpen() || sheetOpen()) ? sideW + 20 : 0;
  root.style.setProperty('--right-inset', `${right}px`);
  // đo sau khi đặt --right-inset (cụm nút phải dời theo ngăn kéo)
  const sr = $('stage').getBoundingClientRect();
  const vw = sr.width || window.innerWidth, vh = sr.bottom || window.innerHeight;
  const l = $('hud-l').getBoundingClientRect(), r = $('hud-r').getBoundingClientRect();
  const dr = $('dock').getBoundingClientRect();
  const dockH = dr.height ? Math.max(0, Math.ceil(vh - dr.top)) : 0; // dock bị ẩn → không chừa chỗ
  root.style.setProperty('--dock-h', `${dockH}px`);
  stage.setInsets({
    right,
    bottom: SHORT.matches ? 0 : dockH,
    hudH: Math.max(l.height ? l.bottom : 0, r.height ? r.bottom : 0),
    hudL: l.width ? l.right : 0,
    hudR: r.width ? Math.max(0, vw - right - r.left) : 0,
  });
}
const insetRo = new ResizeObserver(() => syncInsets());
for (const id of ['dock', 'hud-l', 'hud-r']) insetRo.observe($(id));
window.addEventListener('resize', syncInsets);
onSheetChange(syncInsets);

function updateDock() {
  const open = sideOpen();
  $('btn-queue').classList.toggle('on', open && (isDesk() || side.dataset.tab === 'queue'));
  $('btn-chat').classList.toggle('on', open && (isDesk() || side.dataset.tab === 'chat'));
  $('chat-feed').hidden = !feedVisible();
}
function openSide(tab) {
  if (tab) side.dataset.tab = tab;
  side.classList.add('open');
  for (const b of side.querySelectorAll('.side-tab')) b.classList.toggle('on', b.dataset.tab === side.dataset.tab);
  if (isDesk()) lsSet('vc.side', '1');
  if (isDesk() || side.dataset.tab === 'chat') { chat.clearUnread(); chat.scrollToEnd(); }
  updateDock();
  syncInsets();
}
function closeSide() {
  if (!sideOpen()) return;
  side.classList.remove('open');
  if (isDesk()) lsSet('vc.side', '0');
  updateDock();
  syncInsets();
}
/** 📋 / 💬: máy tính = bật / tắt ngăn kéo (thấy cả hai); điện thoại = mở đúng thẻ, bấm lại thẻ đang mở thì đóng */
function toggleSide(tab) {
  if (sideOpen() && (isDesk() || side.dataset.tab === tab)) closeSide();
  else openSide(tab);
}
$('btn-queue').addEventListener('click', () => toggleSide('queue'));
$('btn-chat').addEventListener('click', () => toggleSide('chat'));
$('side-close').addEventListener('click', closeSide);
for (const b of side.querySelectorAll('.side-tab')) b.addEventListener('click', () => openSide(b.dataset.tab));
side.dataset.tab = 'queue';
$('btn-add-video').addEventListener('click', () => {
  openSide('queue');
  setTimeout(() => $('add-input').focus({ preventScroll: true }), 230);
});
SHORT.addEventListener('change', syncInsets);
FEED.addEventListener('change', updateDock);
DESK.addEventListener('change', () => {
  if (!isDesk()) side.classList.remove('open');
  else if (lsGet('vc.side', '0') === '1') side.classList.add('open');
  updateDock();
  syncInsets();
});
if (isDesk() && lsGet('vc.side', '0') === '1') side.classList.add('open');
updateDock();
syncInsets();

// bảng thả cảm xúc (nút 😀 trên dock): mở rồi bấm liên tục được, bấm ra ngoài / Esc để đóng
const reactPop = $('react-pop');
function setReactPop(open) {
  reactPop.hidden = !open;
  $('btn-react').classList.toggle('on', open);
  $('btn-react').setAttribute('aria-expanded', open ? 'true' : 'false');
}
$('btn-react').addEventListener('click', () => setReactPop(reactPop.hidden));
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') setReactPop(false); });
if (isTouch()) $('chat-input').placeholder = 'Nhắn gì đó…';
document.addEventListener('pointerdown', (e) => {
  if (!reactPop.hidden && !reactPop.contains(e.target) && !$('btn-react').contains(e.target)) setReactPop(false);
});

initInput({
  wheel,
  blocked: () => !$('join').hidden || sheetOpen(),
  closeAll: () => {
    if (userCard.isOpen) { userCard.close(); return true; }
    if (sheetOpen()) { closeSheet(); return true; }
    if (!reactPop.hidden) { setReactPop(false); return true; }
    if (!viewPop.hidden) { setViewPop(false); return true; }
    if (sideOpen()) { closeSide(); return true; }
    return false;
  },
});

// góc xem (nút 📺): cân = khán phòng rộng · lớn (mặc định) = video to · rộng = video to nhất, khán phòng mỏng
const VIEWS = [
  { id: 'can', icon: '🎦', label: 'Cân', sub: 'Video vừa, khán phòng rộng' },
  { id: 'lon', icon: '📺', label: 'Màn lớn', sub: 'Video to, khán phòng gọn' },
  { id: 'rong', icon: '🖥️', label: 'Màn rộng', sub: 'Video to nhất, khán phòng mỏng' },
];
let view = lsGet('vc.view', 'lon');
if (!VIEWS.some((v) => v.id === view)) view = 'lon';
const viewPop = $('view-pop');
function setViewPop(open) {
  viewPop.hidden = !open;
  $('btn-theater').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('btn-theater').classList.toggle('on', open);
}
function renderViewPop() {
  setKids(viewPop, VIEWS.map((v) => el('button', {
    type: 'button', class: `view-opt${v.id === view ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': v.id === view ? 'true' : 'false',
    dataset: { view: v.id },
    onclick: () => { view = v.id; lsSet('vc.view', view); stage.setView(view); renderViewPop(); setViewPop(false); },
  }, el('span', { class: 'vo-icon', text: v.icon }), el('span', { class: 'vo-text' }, el('b', { text: v.label }), el('small', { text: v.sub })))));
}
renderViewPop();
stage.setView(view);
$('btn-theater').addEventListener('click', () => setViewPop(viewPop.hidden));
document.addEventListener('pointerdown', (e) => {
  if (!viewPop.hidden && !viewPop.contains(e.target) && !$('btn-theater').contains(e.target)) setViewPop(false);
});

// toàn màn hình cả rạp (ẩn thanh trình duyệt); iPhone không hỗ trợ → ẩn nút
if (document.fullscreenEnabled) {
  const fb = $('btn-full');
  fb.hidden = false;
  fb.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => fb.classList.toggle('on', document.fullscreenElement === document.documentElement));
}

// ---------------------------------------------------------------- ⚙️ tùy chọn (chỉ trên máy này — prefs.js)
function prefToggle(key, label, sub) {
  return el('label', { class: 'pref-row' },
    el('span', { class: 'pref-text' }, el('b', { text: label }), sub ? el('small', { text: sub }) : null),
    el('span', { class: 'switch' },
      el('input', { type: 'checkbox', checked: !!prefs[key], 'aria-label': label, onchange: (e) => setPref(key, e.target.checked) }),
      el('span', { class: 'switch-ui', 'aria-hidden': 'true' })));
}
function prefChoice(key, label, opts, sub) {
  const btns = opts.map(([v, t]) => el('button', {
    type: 'button', class: `chip${prefs[key] === v ? ' on' : ''}`, text: t, dataset: { v }, 'aria-pressed': prefs[key] === v ? 'true' : 'false',
    onclick: () => {
      setPref(key, v);
      for (const b of btns) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); }
    },
  }));
  return el('div', { class: 'pref-row pref-choice' },
    el('span', { class: 'pref-text' }, el('b', { text: label }), sub ? el('small', { text: sub }) : null),
    el('div', { class: 'pref-chips', role: 'group', 'aria-label': label }, btns));
}
function hiddenBox() {
  const list = hiddenList();
  if (!list.length) return el('p', { class: 'pref-note', text: 'Chưa ẩn riêng ai. Bấm vào một nhân vật để ẩn tin nhắn, động tác hoặc cả người đó.' });
  return el('ul', { class: 'pref-hidden' }, list.map((h) => el('li', null,
    el('span', null, el('b', { text: h.name }), el('small', { text: [h.all && 'ẩn cả người', h.chat && 'ẩn tin nhắn', h.acts && 'ẩn động tác'].filter(Boolean).join(' · ') })),
    el('button', { type: 'button', class: 'btn', text: 'Bỏ ẩn', onclick: () => unhidePerson(h.key) }))));
}
function prefsContent() {
  return [
    el('p', { class: 'pref-note', text: 'Chỉ áp dụng trên máy này, không ảnh hưởng người khác.' }),
    el('h3', { text: '🎬 Khi đang chiếu' }),
    prefChoice('dim', 'Làm tối xung quanh', [['tat', 'Tắt'], ['nhe', 'Nhẹ'], ['vua', 'Vừa'], ['dam', 'Đậm']], 'Video nổi bật hơn'),
    prefToggle('autoHide', 'Tự làm mờ các nút', 'Khi đang xem và không động chuột / chạm vài giây'),
    el('h3', { text: '💬 Trò chuyện' }),
    prefToggle('chat', 'Chat của mọi người', 'Tắt = không thấy tin nhắn của ai (tin của bạn vẫn gửi được)'),
    prefToggle('bubbles', 'Bong bóng chat trên đầu'),
    prefToggle('feed', 'Khung chat nổi góc dưới', 'Máy tính, khi ngăn kéo hàng chờ / chat đang đóng'),
    el('h3', { text: '👥 Người khác' }),
    prefToggle('people', 'Hiện người khác', 'Tắt = chỉ thấy nhân vật của bạn, xem phim yên tĩnh'),
    prefChoice('names', 'Tên trên đầu', [['all', 'Tất cả'], ['auto', 'Tự động'], ['off', 'Chỉ tên mình']], 'Tự động: rạp đông thì chỉ hiện người đang nói / mới vào'),
    prefToggle('othersActs', 'Động tác của người khác', 'Nhảy, vỗ tay, cười lăn…'),
    prefToggle('emoji', 'Emoji cảm xúc người khác thả'),
    prefToggle('actFx', 'Emoji bay theo động tác', '🎵 khi nhảy, ❤️ khi thả tim…'),
    el('h3', { text: '✨ Hình ảnh' }),
    prefToggle('lights', 'Đèn & hiệu ứng', 'Đèn sàn nhảy, chùm máy chiếu, sao, đom đóm…'),
    prefChoice('quality', 'Chất lượng hình', [['auto', 'Tự động'], ['high', 'Cao'], ['low', 'Nhẹ máy']]),
    el('h3', { text: '🙈 Đang ẩn riêng' }),
    el('div', { id: 'pref-hidden-box' }, hiddenBox()),
    el('div', { class: 'row', style: { marginTop: '14px' } },
      el('button', { type: 'button', class: 'btn btn-ghost', text: '↺ Khôi phục mặc định', onclick: () => { resetPrefs(); openPrefs(); } })),
  ];
}
function openPrefs() {
  openSheet('prefs', '⚙️ Tùy chọn', prefsContent());
  // đặt con trỏ vào nút đóng (đặt vào chip đầu trông như đang được chọn)
  setTimeout(() => $('sheet-close').focus({ preventScroll: true }), 40);
}
$('btn-prefs').addEventListener('click', () => (sheetOpen('prefs') ? closeSheet() : openPrefs()));
onPrefs((k) => {
  if (k === 'hidden' && sheetOpen('prefs')) { const box = document.getElementById('pref-hidden-box'); if (box) setKids(box, hiddenBox()); }
});

// đang chiếu + không động chuột / chạm vài giây → làm mờ các nút (⚙️ "Tự làm mờ các nút")
let lastActive = performance.now();
const wake = () => { lastActive = performance.now(); document.body.classList.remove('ui-quiet'); };
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
setInterval(() => {
  const watching = store.joined && !!store.now && !store.now.paused;
  document.body.classList.toggle('watching', watching);
  const a = document.activeElement;
  const busy = !reactPop.hidden || !viewPop.hidden || sheetOpen() || sideOpen() || wheel.open || userCard.isOpen
    || (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  document.body.classList.toggle('ui-quiet', watching && prefs.autoHide && !busy && performance.now() - lastActive > 4000);
}, 400);

// hướng dẫn
$('btn-help').addEventListener('click', () => {
  const row = (k, v) => el('tr', null, el('td', null, k), el('td', { text: v }));
  const kb = (...keys) => keys.map((k) => el('kbd', { text: k }));
  openSheet('help', '❔ Hướng dẫn', [
    el('p', { text: 'Mỗi người xem điều khiển một nhân vật. Dán link YouTube vào Hàng chờ để chiếu cho cả rạp; ai cũng xem cùng một chỗ trong video.' }),
    el('table', { class: 'keys' },
      row(kb('W', 'A', 'S', 'D'), 'Đi lại (hoặc phím mũi tên). Bấm / chạm sàn để đi tới chỗ đó, bấm ghế để ngồi.'),
      row(kb('E'), 'Mở vòng chọn động tác'),
      row(kb('1', '…', '8'), 'Vẫy tay · Vỗ tay · Hip hop · Lắc đầu quẩy · Nhún nhảy · Ngồi xem · Thả tim · Cười lăn'),
      row(kb('Enter'), 'Chat — tin nhắn hiện thành bong bóng trên đầu'),
      row(kb('Esc'), 'Đóng bảng đang mở'),
    ),
    el('h3', { text: 'Các nút' }),
    el('p', { text: 'Dưới đáy: 😀 thả cảm xúc · 🎭 động tác · ô chat · 📋 hàng chờ (dán link YouTube) · 💬 trò chuyện. Góc trên: 📺 góc xem (cân / màn lớn / màn rộng) · ⛶ toàn màn hình · 🎨 đổi ngoại hình · ⚙️ tùy chọn (làm tối khi chiếu, ẩn chat / động tác / người khác…) · 🛠 quản trị (admin). Bấm vào một nhân vật để ẩn riêng người đó.' }),
    el('h3', { text: 'Trên điện thoại' }),
    el('p', { text: 'Kéo cần điều khiển góc trái để đi, chạm sàn để đi tới, nút 🎭 để làm động tác, chụm hai ngón để phóng to / thu nhỏ.' }),
    el('h3', { text: 'Luật rạp' }),
    el('p', { text: `Chỉ chiếu video YouTube công khai, cho phép nhúng, không giới hạn tuổi, xem được ở Việt Nam, dài tối đa ${store.cfg.maxVideoMin} phút. Mỗi người chờ tối đa ${store.cfg.maxPerUser} video. Bỏ qua khi đủ ${Math.round(store.cfg.skipRatio * 100)}% người trong phòng bỏ phiếu. Không gửi link, không chửi bậy trong chat.` }),
    el('p', null, el('a', { href: '/chinh-sach', target: '_blank', rel: 'noopener', text: 'Chính sách & quyền riêng tư' })),
  ]);
});

// đổi ngoại hình
$('btn-look').addEventListener('click', () => {
  const mine = store.me();
  const ed = lookEditor(mine?.look, () => {});
  openSheet('look', '🎨 Đổi ngoại hình', [
    ed.node,
    el('div', { class: 'row', style: { marginTop: '14px' } },
      el('button', { type: 'button', class: 'btn btn-accent', text: 'Lưu', onclick: () => { saveLook(ed.get()); send({ t: 'look', look: ed.get() }); closeSheet(); } }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', onclick: () => closeSheet() }),
    ),
  ]);
});

// chọn rạp (bấm ô phòng góc trên): mỗi rạp một khung cảnh, màn hình + hàng chờ riêng
$('room-pill').addEventListener('click', () => {
  const items = store.rooms.map((r) => {
    const v = venueById(r.venue) || parseRoomId(r.id)?.venue;
    return el('div', { class: `room-item${r.id === store.roomId ? ' cur' : ''}` },
      el('span', { class: 'ri-emoji', 'aria-hidden': 'true', text: v?.emoji || '🎬' }),
      el('div', { class: 'ri-body' },
        el('b', { text: r.name }),
        el('div', { class: 'now-meta', text: `${r.count}/${r.cap} người${v ? ` · ${v.desc}` : ''}` })),
      r.id === store.roomId
        ? el('span', { class: 'badge badge-live', text: 'ĐANG Ở ĐÂY' })
        : el('button', {
          type: 'button', class: 'btn', text: store.joined ? 'Chuyển sang' : 'Xem rạp này',
          disabled: r.count >= r.cap,
          onclick: () => {
            closeSheet();
            if (!store.joined) send({ t: 'spec', room: r.id });
            else switchRoom(r.id);
          },
        }));
  });
  openSheet('rooms', '🎬 Chọn rạp', [
    el('p', { text: `Mỗi rạp một khung cảnh, có màn hình và hàng chờ riêng, tối đa ${store.cfg.capacity} người. Rạp đầy thì tự mở thêm phòng của rạp đó.` }),
    el('div', { class: 'room-list' }, items),
  ]);
});

// ---------------------------------------------------------------- vào rạp
let wantJoin = false;
let joinName = '';
let joinLook = null;
let joinRoom = ''; // phòng muốn vào ('' = phòng đang đứng xem)
const join = initJoin((name, look) => {
  wantJoin = true;
  joinName = name;
  joinLook = look;
  joinRoom = '';
  sendJoin();
}, (roomId) => quickJoin(roomId));

/** vào bằng tên + nhân vật đã nhớ (người quay lại / vừa chuyển phòng) */
function quickJoin(roomId) {
  wantJoin = true;
  joinName = savedName();
  joinLook = savedLook();
  joinRoom = roomId || '';
  join.setQuickBusy(roomId || store.roomId);
  sendJoin();
}

function sendJoin() {
  if (!wantJoin || !store.ready) return;
  const token = ssGet('vc.token', '') || '';
  send({ t: 'join', name: joinName, look: joinLook, room: joinRoom || store.roomId, token, ck });
}

store.on('hello', () => {
  updateRoomPill();
  if (store.admin && !document.getElementById('btn-admin').dataset.ready) {
    document.getElementById('btn-admin').dataset.ready = '1';
    import('./ui/admin.js').then((m) => m.initAdmin()).catch((e) => console.warn('[rạp] không nạp được admin', e));
  }
  if (wantJoin) sendJoin(); // nối lại sau khi rớt mạng: vào lại đúng nhân vật cũ (server giữ 15 giây)
});

/**
 * chuyển rạp tại chỗ (không tải lại trang): canvas tối dần + tải khung cảnh rạp mới ngay, server chuyển nhân vật sang và
 * gửi welcome mới → khung cảnh mới sáng dần. Server từ chối (đầy, trùng tên) / mạng chậm → sáng lại rạp đang ở.
 */
let switchTimer = 0;
function switchRoom(id) {
  const v = parseRoomId(id)?.venue;
  if (!v || !send({ t: 'switch', room: id })) return;
  stage.setVenue(v.id);
  toast(`Đang chuyển sang ${roomName(id)}…`, 'info', 1800);
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => { switchTimer = 0; stage.setVenue(store.venue); }, 4000);
}

// vào một rạp vắng trong khi rạp khác đang có người → nhắc một lần (để mọi người gặp được nhau)
let aloneHinted = false;
function hintBusyRoom() {
  if (aloneHinted || !store.joined) return;
  const here = store.rooms.find((r) => r.id === store.roomId);
  const busy = [...store.rooms].filter((r) => r.id !== store.roomId && r.count > 0).sort((a, b) => b.count - a.count)[0];
  if (!here || here.count > 1 || !busy) return;
  aloneHinted = true;
  toast(`${busy.count} người đang ở ${busy.name} — bấm tên rạp góc trên để sang gặp mọi người`, 'info', 7000);
}

store.on('welcome', (msg) => {
  clearTimeout(switchTimer);
  switchTimer = 0;
  setTimeout(hintBusyRoom, 1500);
  ssSet('vc.token', store.token);
  rememberJoin(store.roomId); // lần sau mở trang: vào thẳng, khỏi đặt tên / tạo nhân vật lại
  joinRoom = store.roomId; // rớt mạng quá lâu phải vào lại thì về đúng phòng này
  join.hide();
  const mine = msg.snap?.players?.find((p) => p.id === store.myId);
  if (mine) placeMe(mine.x, mine.y, DIRS[mine.d] || 'up');
  me.active = true;
  chat.enable(true);
  $('btn-look').hidden = false;
  $('joystick').hidden = !(isTouch() || isNarrow());
  player.enable();
  player.sync();
  updateRoomPill();
  updateAddPill();
});

/** nút "Dán link YouTube để chiếu" dưới màn hình khi rạp chưa chiếu gì / đang phát kênh mặc định */
function updateAddPill() { $('btn-add-video').hidden = !(store.joined && (!store.now || store.now.filler)); }
store.on('now', updateAddPill);

/** về màn vào rạp: tắt trình phát TRƯỚC (lớp phủ màn vào rạp không được nằm trên video đang chạy) */
function backToJoin(text, busy = false) {
  wantJoin = false;
  me.active = false;
  store.joined = false;
  player.disable();
  $('joystick').hidden = true;
  updateAddPill();
  chat.enable(false);
  join.show();
  showJoinError(text);
  if (busy) setJoinBusy(true);
}

store.on('joinError', (e) => {
  // tên đã nhớ bị trùng / không hợp lệ → về màn đặt tên; lỗi khác giữ thẻ chào lại, báo ngay trên thẻ
  if (join.isQuick && !['name', 'name_taken', 'banned', 'kicked'].includes(e.code)) {
    wantJoin = false;
    join.quickError(e.text);
    return;
  }
  if (!$('join').hidden) showJoinError(e.text);
  else toast(e.text, 'err', 6000);
  if (['banned', 'kicked', 'name', 'name_taken', 'full', 'rate'].includes(e.code)) backToJoin(e.text);
});

store.on('kicked', (e) => {
  ssSet('vc.token', null);
  toast(e.text, 'err', 8000);
  backToJoin(`${e.text} Tải lại trang để vào lại sau.`, true);
});

// mở rạp ở tab / máy khác (cùng nhân vật): tab này nhường, không tự nối lại
store.on('replaced', () => {
  player.disable();
  me.active = false;
  const banner = $('conn');
  banner.hidden = false;
  setText(banner, 'Bạn đang xem rạp ở tab khác — tải lại trang để xem ở đây.');
});

store.on('correct', (c) => applyCorrection(c.x, c.y));
store.on('notice', (n) => {
  if (switchTimer && n.kind === 'warn') { clearTimeout(switchTimer); switchTimer = 0; stage.setVenue(store.venue); }
  if (n.kind === 'info') systemLine(n.text);
  toast(n.text, n.kind === 'info' ? 'info' : n.kind, n.kind === 'info' ? 3200 : 4500);
});
store.on('now', () => player.sync());

function updateRoomPill() {
  const r = store.rooms.find((x) => x.id === store.roomId);
  setText($('room-name'), `${venueById(store.venue)?.emoji || '🎬'} ${store.roomName}`);
  setText($('room-count'), String(r ? r.count : store.present()));
  setText($('room-cap'), String(r ? r.cap : store.cfg.capacity));
}
store.on('rooms', updateRoomPill);
store.on('players', updateRoomPill);
// rạp đổi (xem rạp khác trước khi vào, hoặc vào rạp) → đổi khung cảnh
store.on('venue', (v) => { stage.setVenue(v); updateRoomPill(); });

// ---------------------------------------------------------------- mở trang mượt
// Chỉ hiện giao diện khi đã dựng xong + có danh sách rạp (hello đầu tiên) + phông chữ (tối đa 2,5 s) — không còn cảnh
// hiện từng mảnh (ô đặt tên trước, bảng nhân vật sau…). Canvas tối tới khi biết đúng rạp rồi sáng dần (stage.setVenue).
{
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fonts = document.fonts?.ready ? Promise.race([document.fonts.ready, wait(2500)]) : Promise.resolve();
  const hello = new Promise((res) => { const off = store.on('hello', () => { off(); res(); }); });
  hello.then(() => stage.setVenue(store.venue));
  Promise.race([Promise.all([fonts, hello]), wait(2500)]).then(() => {
    document.documentElement.classList.remove('booting');
    stage.setVenue(store.venue); // mạng chậm chưa có hello: hiện khung cảnh mặc định, hello tới sẽ tự đổi
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    idle(() => prefetchThemes(), { timeout: 4000 }); // tải sẵn các rạp khác → chuyển rạp không phải chờ mạng
  });
  // phông chữ tới muộn: vẽ lại chữ trên canvas (biển hiệu, tên) bằng đúng phông
  document.fonts?.ready?.then(() => stage.refresh());
}

store.on('conn', (state) => {
  const banner = $('conn');
  if (state === 'replaced') return;
  if (state === 'open') { banner.hidden = true; return; }
  if (state === 'closed') { banner.hidden = false; setText(banner, 'Mất kết nối — đang nối lại…'); }
});

// mở trang: vừa chuyển phòng / link thẳng tới một rạp (?phong=…) → vào luôn; đã từng vào rạp → thẻ "Chào mừng quay lại"
// (bấm một rạp là vào, khỏi đặt tên / tạo nhân vật lại); lần đầu → màn đặt tên + chọn nhân vật
{
  const urlRoom = new URLSearchParams(location.search).get('phong') || '';
  const switching = ssGet('vc.autojoin') === '1';
  if (switching) { ssSet('vc.autojoin', null); ssSet('vc.token', null); }
  if (isReturning()) {
    join.showQuick();
    if (switching || ROOM_ID_RE.test(urlRoom)) {
      join.setQuickBusy(urlRoom || 'auto');
      const off = store.on('hello', () => { off(); if (!wantJoin) quickJoin(store.roomId); });
    }
  }
}

connect();

// móc chỉ-đọc cho script QA headless (không chứa gì ngoài dữ liệu đã có trên máy này)
Object.defineProperty(window, '__vc', {
  value: { store, me, view: () => $('hall').__view?.(), player: () => player.debug(), isOpen },
  enumerable: false,
});
