// Điểm vào client: (1) đăng nhập admin nếu link có #admin=, (2) dựng canvas rạp + trình phát YouTube + giao diện,
// (3) nối WebSocket. Người xem đứng xem ngoài cửa (thấy rạp sống) tới khi đặt tên → "Vào rạp".
// Phòng riêng (link /#phong=p-… — id nằm sau dấu # nên không bao giờ tới máy chủ, nhật ký hay YouTube; link cũ ?phong=p-…
// vẫn mở được, tự đổi sang #): đứng xem rạp chung trong lúc nhập mật khẩu; vào rồi thì thanh địa chỉ giữ #phong= để tải
// lại / rớt mạng vẫn về đúng phòng (vé vào lại vc.rt, store.js).
import { backToSpectate, dropRt, rtFor, store } from './store.js';
import { adminLoginFromUrl, connect, isOpen, linkRoom, privLinkToHash, send } from './net.js';
import { applyCorrection, me, placeMe, tickMe, walkTo } from './me.js';
import { DIRS, ROOM_ID_RE, isPrivateRoomId, parseRoomId, roomName, venueById } from './shared/hall.js';
import { prefetchThemes } from './render/venues/index.js';
import { createStage } from './render/stage.js';
import { createPlayer } from './player.js';
import { initInput } from './input.js';
import {
  initJoin, isReturning, lookEditor, rememberJoin, saveLook, saveName, savedLook, savedName, setJoinBusy, showJoinError,
} from './ui/join.js';
import {
  ADMIN_WATCHING, createRow, initPrivate, openCreateSheet, privateOk, privateReset, privateResult, privateSection,
} from './ui/private.js';
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

privLinkToHash(); // link cũ ?phong=p-… → #phong=p-… TRƯỚC mọi yêu cầu khác (đăng nhập admin, tải rạp…)
await adminLoginFromUrl();

// link phòng riêng nằm sau dấu #: dán link mời vào tab đang mở rạp, hay bấm Quay lại, chỉ đổi phần sau # nên trình duyệt
// KHÔNG tải lại trang → phòng riêng trong link đổi thì tự tải lại (như mở link mới)
window.addEventListener('hashchange', (e) => {
  const a = linkRoom(e.oldURL), b = linkRoom(e.newURL);
  if (a !== b && (isPrivateRoomId(a) || isPrivateRoomId(b))) location.reload();
});

initToasts($('toasts'));
initSheet();

// phòng riêng đang được mời vào (link #phong=p-… hoặc vào lại hỏng) trong lúc CHƯA ở trong phòng ('' = không)
let privLink = '';
// phòng riêng người xem vừa bỏ ("Vào rạp chung thay thế"): lời nhắc / kết quả tới muộn của phòng đó không bật lại chế độ
// phòng riêng; abandonedJoin = lúc bỏ đang chờ kết quả vào phòng đó (vào bằng vé) → kết quả tới sau bị bỏ qua
let dismissedPriv = '';
let abandonedJoin = false;

// ---------------------------------------------------------------- canvas + trình phát
let player = null;
const stage = createStage($('hall'), $('screen-slot'), {
  beforeFrame: (dt, now) => tickMe(dt, now),
  onLayout: (L) => layoutOverlays(L),
  screenInfo: () => {
    const n = store.now;
    if (!store.joined) {
      // link phòng riêng: phía sau là rạp chung đang đứng xem — không ghi tên video của rạp chung cho khỏi nhầm
      if (privLink) return { show: true, title: '🔒 Phòng riêng', sub: 'Đặt tên, nhập mật khẩu bạn bè gửi là vào xem cùng nhau' };
      return { show: true, title: n ? `Đang chiếu: ${n.title}` : 'Chưa có video nào đang chiếu', sub: 'Đặt tên rồi vào rạp để xem cùng mọi người 🍿' };
    }
    if (!n && store.inPrivate()) {
      return { show: true, title: 'Phòng riêng đang trống', sub: 'Dán link YouTube vào 📋 Hàng chờ để xem cùng nhau' };
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
    $('btn-tap-play').hidden = !s.needsTap || !showing || s.offVideo;
    setText($('btn-tap-play'), '▶ Bấm để xem');
    // trình duyệt tự tắt tiếng lúc tự phát (chặn tự phát có tiếng) → mời bật tiếng; âm lượng thường dùng thanh của YouTube
    $('btn-unmute').hidden = !(s.askUnmute && !s.needsTap && showing);
    // người xem đang ở video gợi ý của YouTube → nút quay về (không tự quay lại — chính sách YouTube); hiện cả khi rạp đã
    // hết video (bấm = về màn hình của rạp)
    $('btn-back-room').hidden = !(s.offVideo && s.enabled);
    $('btn-fs').hidden = !showing;
  },
  onNotice: (t) => toast(t, 'warn'),
  onHint: (t) => toast(t, 'info', 4500),
});
$('btn-tap-play').addEventListener('click', () => player.userPlay());
$('btn-unmute').addEventListener('click', () => player.userPlay());
$('btn-back-room').addEventListener('click', () => player.backToRoom());
$('btn-fs').addEventListener('click', () => player.fullscreen());
// cụm ⏭ · ⏸ · 🚩 · ⛶: ẩn hẳn khi không còn nút nào hiện (CSS :has() chưa có trên WebView cũ → JS lo)
{
  const group = $('tool-group');
  const syncGroup = () => {
    const want = ![...group.children].some((c) => !c.hidden);
    if (group.hidden !== want) group.hidden = want; // chỉ gán khi đổi (gán lại cũng sinh bản ghi → lặp vô tận)
  };
  new MutationObserver(syncGroup).observe(group, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  syncGroup();
}

function layoutOverlays(L) {
  const top = $('stage').getBoundingClientRect().top;
  const stripTop = L.screen.y + L.screen.h + L.frame;
  const tools = $('screen-tools');
  tools.style.left = `${L.screen.x}px`;
  tools.style.width = `${L.screen.w}px`;
  tools.style.top = `${Math.round(stripTop + Math.max(0, (L.audTop - stripTop - 28) / 2))}px`;
  // một hàng 28 px; màn hẹp mà nhiều nút cùng hiện thì xuống hàng — cao thêm về phía dưới (không bao giờ lên đè video)
  tools.style.minHeight = '28px';
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
// khung chat nổi (máy tính): hiện trừ lúc thẻ Trò chuyện đang mở (đã thấy chat trong ngăn kéo)
const feedVisible = () => FEED.matches && !(sideOpen() && side.dataset.tab === 'chat');
const chat = initChat({
  // tin mới thấy được (ngăn kéo, thẻ chat, hoặc khung chat nổi góc dưới trái) → không đếm chưa đọc
  isChatVisible: () => feedVisible() || (sideOpen() && side.dataset.tab === 'chat'),
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
  // cụm trái không bao giờ chạm cụm phải: tên phòng dài (phòng riêng "Phòng của …") tự rút gọn "…" cho vừa
  if (r.width) root.style.setProperty('--hud-l-max', `${Math.max(120, Math.floor(r.left - l.left - 6))}px`);
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
  $('btn-queue').classList.toggle('on', open && side.dataset.tab === 'queue');
  $('btn-chat').classList.toggle('on', open && side.dataset.tab === 'chat');
  $('chat-feed').hidden = !feedVisible();
}
function openSide(tab) {
  if (tab) side.dataset.tab = tab;
  side.classList.add('open');
  for (const b of side.querySelectorAll('.side-tab')) b.classList.toggle('on', b.dataset.tab === side.dataset.tab);
  if (isDesk()) { lsSet('vc.side', '1'); lsSet('vc.sideTab', side.dataset.tab); }
  if (side.dataset.tab === 'chat') { chat.clearUnread(); chat.scrollToEnd(); }
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
/** 📋 / 💬: mở đúng thẻ của nút (đang mở thẻ kia thì chuyển thẻ); bấm lại nút của thẻ đang mở thì đóng */
function toggleSide(tab) {
  if (sideOpen() && side.dataset.tab === tab) closeSide();
  else openSide(tab);
}
$('btn-queue').addEventListener('click', () => toggleSide('queue'));
$('btn-chat').addEventListener('click', () => toggleSide('chat'));
$('side-close').addEventListener('click', closeSide);
for (const b of side.querySelectorAll('.side-tab')) b.addEventListener('click', () => openSide(b.dataset.tab));
side.dataset.tab = lsGet('vc.sideTab', 'queue') === 'chat' ? 'chat' : 'queue';
for (const b of side.querySelectorAll('.side-tab')) b.classList.toggle('on', b.dataset.tab === side.dataset.tab);
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
  // nút mời bấm dưới màn hình (về video của rạp / bấm để xem / bật tiếng) đang hiện → không làm mờ: người xem bấm video
  // gợi ý thì chuột nằm trong khung YouTube, trang không nhận được sự kiện nào → nút "↩ Về video của rạp" mờ gần như mất
  const cta = !$('btn-back-room').hidden || !$('btn-tap-play').hidden || !$('btn-unmute').hidden;
  const busy = !reactPop.hidden || !viewPop.hidden || sheetOpen() || sideOpen() || wheel.open || userCard.isOpen || cta
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
    store.inPrivate()
      ? el('p', { text: 'Chỉ chiếu video YouTube cho phép nhúng, kiểm như rạp chung. Không gửi link, không chửi bậy trong chat.' })
      : el('p', { text: `Chỉ chiếu video YouTube công khai, cho phép nhúng, không giới hạn tuổi, xem được ở Việt Nam, dài tối đa ${store.cfg.maxVideoMin} phút. Mỗi người chờ tối đa ${store.cfg.maxPerUser} video. Bỏ qua khi đủ ${Math.round(store.cfg.skipRatio * 100)}% người trong phòng bỏ phiếu. Không gửi link, không chửi bậy trong chat.` }),
    el('h3', { text: '🔒 Phòng riêng' }),
    el('p', { text: 'Xem chung với người yêu / bạn bè ở xa: bấm ô tên rạp góc trên trái → 🔒 Tạo phòng riêng (hoặc nút đó ở màn vào rạp), đặt mật khẩu rồi gửi link + mật khẩu cho nhau. Phòng riêng miễn phí, không hiện trong danh sách rạp; quản trị viên rạp có thể vào khi xử lý báo cáo.' }),
    el('p', { text: privateRules() }),
    el('p', null, el('a', { href: '/chinh-sach', target: '_blank', rel: 'noopener', text: 'Chính sách & quyền riêng tư' })),
  ]);
});

/**
 * luật phòng riêng theo cấu hình server (mặc định: 12 giờ, 10 video). 12 giờ chỉ cho video rạp kiểm đủ được qua YouTube;
 * video chỉ qua kiểm cơ bản (rạp chưa có / hết lượt YouTube API) vẫn giới hạn như rạp chung
 */
function privateRules() {
  const min = Number(store.cfg.privMaxMin) || 720;
  const len = min % 60 === 0 ? `${min / 60} giờ` : `${min} phút`;
  return `Phòng riêng: video dài tới ${len} (lúc rạp chỉ kiểm cơ bản được video thì tối đa ${Number(store.cfg.maxVideoMin) || 15} phút như rạp chung), mỗi người chờ tối đa ${Number(store.cfg.privPerUser) || 10} video, ai trong phòng cũng dừng / phát tiếp được, chủ phòng bỏ qua / mời ra / đổi mật khẩu / đóng phòng.`;
}

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

// chọn rạp (bấm ô phòng góc trên): mỗi rạp một khung cảnh, màn hình + hàng chờ riêng. Đang ở phòng riêng: phần phòng
// riêng (thành viên, công cụ chủ phòng) lên đầu; đang ở phòng chung: hàng đầu là "🔒 Tạo phòng riêng"
$('room-pill').addEventListener('click', () => {
  const inPriv = store.inPrivate();
  const sec = inPriv ? privateSection() : null;
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
  openSheet('rooms', inPriv ? '🔒 Phòng riêng' : '🎬 Chọn rạp', [
    sec?.node,
    inPriv ? el('h3', { class: 'pr-split', text: '🎬 Rạp chung' }) : null,
    !inPriv && store.joined ? el('div', { class: 'room-list pr-create-list' }, createRow()) : null,
    el('p', { text: `Mỗi rạp một khung cảnh, có màn hình và hàng chờ riêng, tối đa ${store.cfg.capacity} người. Rạp đầy thì tự mở thêm phòng của rạp đó.` }),
    el('div', { class: 'room-list' }, items),
  ], sec ? () => sec.dispose() : undefined);
});

// ---------------------------------------------------------------- vào rạp
let wantJoin = false;
let joinName = '';
let joinLook = null;
let joinRoom = ''; // phòng muốn vào ('' = phòng đang đứng xem)
let rejoining = false; // đang vào lại sau rớt mạng (vẫn đang "ở trong rạp", socket mới) — chờ kết quả join
let lastJoinRt = ''; // vé phòng riêng gửi kèm join gần nhất ('' = không có)
let pendingAuth = null; // { room, name, look, quick, timer } — đang chờ server kiểm mật khẩu phòng riêng
let pendingCreate = null; // { name, look } — tạo phòng riêng từ màn vào rạp (chưa có nhân vật): vào thẳng phòng mới
let leavingPriv = false; // vừa bấm "🚪 Rời phòng riêng"
let outText = '', outAt = 0; // vừa bị đưa ra khỏi phòng riêng (bị mời ra / phòng đóng)
let refused = null; // { room, rt, timer } — xin vào phòng riêng nhưng server nối lại nhân vật cũ ở phòng khác (lý do tới ngay sau)
let joinWarn = null; // { text, at } — cảnh báo (notice) server gửi lúc đang xin vào phòng riêng từ màn vào rạp (có thể là lý do)
const CLOSED_LINE = 'Phòng riêng này đã đóng (mọi người đã rời đi). Bạn vẫn có thể vào rạp chung 👇';
const NO_REPLY = 'Máy chủ chưa trả lời — thử lại nhé.';
const NAME_CODES = ['name', 'name_taken']; // mã lỗi "tên không dùng được" (join_err / proom_res)

const join = initJoin({
  onSubmit: (name, look, pass) => {
    joinName = name;
    joinLook = look;
    if (privLink && pass) { startAuth(pass, { name, look, quick: false }); return; }
    wantJoin = true;
    joinRoom = privLink || '';
    sendJoin();
  },
  onQuick: (roomId) => quickJoin(roomId),
  // thẻ chào lại ở chế độ phòng riêng: có mật khẩu → hỏi server trước; đã có quyền (vé / admin) → vào luôn
  onQuickPass: (pass) => {
    if (!privLink) return;
    if (pass) startAuth(pass, { name: savedName(), look: savedLook(), quick: true });
    else quickJoin(privLink);
  },
  onCreate: (from) => {
    // chưa vào rạp: tên + nhân vật lấy từ form (kiểm tên trước) hoặc đã nhớ (thẻ chào lại) — tạo xong là vào thẳng phòng mới
    if (from === 'form') {
      const name = join.validName();
      if (!name) return;
      saveName(name);
      saveLook(join.look);
      pendingCreate = { name, look: join.look };
    } else pendingCreate = { name: savedName(), look: savedLook() };
    openCreateSheet();
  },
  onPublic: () => {
    // bỏ hẳn link phòng riêng: thôi chờ mật khẩu / vé (lượt vào đang chờ server thì kết quả tới sau bị bỏ qua), thôi
    // "Đang vào phòng riêng…" → danh sách rạp chung bấm được ngay
    cancelAuth();
    if (privLink) dismissedPriv = privLink;
    if (wantJoin && isPrivateRoomId(joinRoom)) { dismissedPriv = joinRoom; abandonedJoin = true; wantJoin = false; joinRoom = ''; }
    clearTimeout(refused?.timer);
    refused = null;
    clearPrivLink();
    join.setQuickBusy('');
    setJoinBusy(false);
  },
});

initPrivate({
  ck,
  createName: () => (store.joined ? store.me()?.name || savedName() : pendingCreate?.name || ''),
  /** [Vào lại] phòng riêng của mình (tạo phòng báo "đang có phòng") */
  enterRoom: (room) => {
    if (store.joined) { switchRoom(room); return; }
    const who = pendingCreate || { name: savedName(), look: savedLook() };
    setPrivLink(room, true);
    wantJoin = true;
    joinName = who.name;
    joinLook = who.look;
    joinRoom = room;
    sendJoin();
  },
  leavePrivate: () => {
    closeSheet();
    leavingPriv = true;
    switchRoom(store.venue); // phòng chung của cùng rạp (đầy thì server xếp bản sao)
  },
});

/** chế độ phòng riêng của màn vào rạp (authorized = có vé / vừa nhập đúng mật khẩu / admin → không cần ô mật khẩu) */
function setPrivLink(room, authorized) {
  privLink = isPrivateRoomId(room) ? room : '';
  if (privLink) { dismissedPriv = ''; abandonedJoin = false; } // người xem lại chọn phòng riêng (vd [Vào lại])
  join.setPrivate(privLink ? { room: privLink, authorized } : null);
}
/** bỏ link phòng riêng: màn vào rạp thường + gỡ #phong= khỏi thanh địa chỉ */
function clearPrivLink() {
  setPrivLink('', false);
  syncUrl('');
}

/**
 * thanh địa chỉ theo phòng đang ở: phòng riêng → /#phong=<id> (tải lại / rớt mạng vẫn về đúng phòng; phần sau # không bao
 * giờ tới máy chủ / YouTube); phòng chung → bỏ phong (cả ?phong= lẫn #phong=, giữ tham số khác)
 */
function syncUrl(roomId) {
  try {
    if (isPrivateRoomId(roomId)) {
      const want = `#phong=${roomId}`;
      if (location.hash !== want || location.search || location.pathname !== '/') history.replaceState(null, '', `/${want}`);
      return;
    }
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (!url.searchParams.has('phong') && !hash.has('phong')) return;
    url.searchParams.delete('phong');
    hash.delete('phong');
    const h = hash.toString();
    history.replaceState(history.state, '', `${url.pathname}${url.search}${h ? `#${h}` : ''}`);
  } catch { /* bỏ qua */ }
}

/** báo ngay trên thẻ vào rạp đang hiện (toast nằm dưới lớp phủ). note = dòng thông tin (vàng), không phải lỗi */
function joinMsg(text, note = false) {
  if (join.isQuick) {
    join.quickError(note ? '' : text);
    join.quickNote(note ? text : '');
  } else showJoinError(text, note);
}

/** form / thẻ chào lại ở link phòng riêng: hỏi server mật khẩu (đúng → proom_ok → join kèm vé) */
function startAuth(pass, who) {
  cancelAuth();
  const room = privLink;
  if (!send({ t: 'proom_auth', room, pass, ck })) { joinMsg('Đang mất kết nối, thử lại sau nhé.'); return; }
  pendingAuth = {
    room, ...who,
    timer: setTimeout(() => { if (pendingAuth) { pendingAuth = null; joinMsg(NO_REPLY); } }, 12_000),
  };
}
function cancelAuth() {
  if (pendingAuth) clearTimeout(pendingAuth.timer);
  pendingAuth = null;
}

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
  const room = joinRoom || store.roomId;
  // phòng riêng: gửi kèm vé vào lại (nếu có) — server kiểm ngay, không cần mật khẩu
  lastJoinRt = isPrivateRoomId(room) ? rtFor(room) : '';
  send({ t: 'join', name: joinName, look: joinLook, room, token, ck, ...(lastJoinRt ? { rt: lastJoinRt } : {}) });
}

store.on('hello', () => {
  updateRoomPill();
  if (store.admin && !document.getElementById('btn-admin').dataset.ready) {
    document.getElementById('btn-admin').dataset.ready = '1';
    import('./ui/admin.js').then((m) => m.initAdmin()).catch((e) => console.warn('[rạp] không nạp được admin', e));
  }
  // admin mở link phòng riêng: server cho đứng xem thẳng phòng đó (không cần mật khẩu)
  if (privLink && !store.joined && store.admin && store.roomId === privLink) setPrivLink(privLink, true);
  if (store.helloSeq === 1) abandonedJoin = false; // socket mới: lượt vào đã bỏ trên socket cũ không còn kết quả nào tới
  rejoining = wantJoin && store.joined;
  if (wantJoin) sendJoin(); // nối lại sau khi rớt mạng: vào lại đúng nhân vật cũ (server giữ 15 giây)
});

/**
 * chuyển rạp tại chỗ (không tải lại trang): canvas tối dần + tải khung cảnh rạp mới ngay, server chuyển nhân vật sang và
 * gửi welcome mới → khung cảnh mới sáng dần. Server từ chối (đầy, trùng tên) / mạng chậm → sáng lại rạp đang ở.
 * Phòng riêng: gửi kèm vé; khung cảnh lấy từ `venue` (id phòng riêng không chứa tên rạp), toast dùng `name`.
 */
let switchTimer = 0;
function switchRoom(id, venue = '', name = '') {
  const priv = isPrivateRoomId(id);
  const v = priv ? venueById(venue) : parseRoomId(id)?.venue;
  if (!priv && !v) return;
  const rt = priv ? rtFor(id) : '';
  if (!send({ t: 'switch', room: id, ...(rt ? { rt } : {}) })) return;
  fadeTo(v?.id || '', priv ? `Đang vào 🔒 ${name || 'phòng riêng'}…` : `Đang chuyển sang ${roomName(id)}…`);
}
/** canvas tối dần sang khung cảnh rạp mới trong lúc chờ welcome (quá 4 s → sáng lại rạp đang ở) */
function fadeTo(venueId, text) {
  if (venueById(venueId)) stage.setVenue(venueId);
  if (text) toast(text, 'info', 1800);
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => { switchTimer = 0; leavingPriv = false; stage.setVenue(store.venue); }, 4000);
}
/** server từ chối chuyển phòng → sáng lại rạp đang ở */
function cancelSwitch() {
  leavingPriv = false;
  if (!switchTimer) return;
  clearTimeout(switchTimer);
  switchTimer = 0;
  stage.setVenue(store.venue);
}

// vào một rạp vắng trong khi rạp khác đang có người → nhắc một lần (để mọi người gặp được nhau). Phòng riêng: vắng là đúng ý
let aloneHinted = false;
function hintBusyRoom() {
  if (aloneHinted || !store.joined || store.inPrivate()) return;
  const here = store.rooms.find((r) => r.id === store.roomId);
  const busy = [...store.rooms].filter((r) => r.id !== store.roomId && r.count > 0).sort((a, b) => b.count - a.count)[0];
  if (!here || here.count > 1 || !busy) return;
  aloneHinted = true;
  toast(`${busy.count} người đang ở ${busy.name} — bấm tên rạp góc trên để sang gặp mọi người`, 'info', 7000);
}

/**
 * Mở link phòng riêng mà máy này còn nhân vật cũ ở phòng chung (tab khác / vừa tải lại): server nối lại nhân vật đó TẠI
 * CHỖ (welcome phòng chung) rồi báo vì sao không cho sang phòng riêng (cần mật khẩu / đã đóng / đầy / bị mời ra). Người xem
 * đang ở màn vào rạp và muốn vào phòng riêng → bỏ nhân vật đó (leave: server coi là đứng xem), giữ màn vào rạp, báo lý do
 * ngay trên thẻ — không bật trình phát (video phòng chung không chợt phát rồi tắt).
 */
function refusedWelcome() {
  if ($('join').hidden || !wantJoin || !isPrivateRoomId(joinRoom) || store.roomId === joinRoom) return false;
  send({ t: 'leave' });
  store.joined = false;
  wantJoin = false;
  rejoining = false;
  clearTimeout(refused?.timer);
  // lý do thường tới ngay sau welcome (proom_need / proom_res). Có lúc server chỉ gửi một dòng cảnh báo (notice — có khi
  // ngay TRƯỚC welcome): chờ chút cho lý do cụ thể, không có thì hiện dòng cảnh báo đó; không có gì cả (hiếm) → chung chung
  const warned = !!joinWarn && performance.now() - joinWarn.at < 3000;
  refused = {
    room: joinRoom, rt: lastJoinRt,
    timer: setTimeout(() => {
      if (!refused) return;
      refused = null;
      const w = joinWarn && performance.now() - joinWarn.at < 6000 ? joinWarn.text : '';
      joinWarn = null;
      joinMsg(w || 'Chưa vào được phòng riêng — thử lại nhé.');
    }, warned ? 400 : 2500),
  };
  return true;
}
const takeRefused = (room) => {
  if (!refused || refused.room !== room) return null;
  const r = refused;
  clearTimeout(r.timer);
  refused = null;
  joinWarn = null;
  return r;
};
/**
 * cảnh báo của server khi màn vào rạp đang hiện (toast nằm DƯỚI lớp phủ): đang xin vào phòng riêng → đây là lý do không vào
 * được (vd trùng tên trong phòng riêng) → báo ngay trên thẻ. true = đã xử lý (không toast)
 */
function joinNotice(text) {
  if ($('join').hidden) return false;
  if (refused) {
    // server đã nối lại nhân vật cũ ở phòng khác (refusedWelcome): dòng này chính là lý do
    takeRefused(refused.room);
    joinMsg(text);
    return true;
  }
  if (!wantJoin || !isPrivateRoomId(joinRoom)) return false;
  joinWarn = { text, at: performance.now() }; // tới trước welcome: refusedWelcome dùng nếu không có lý do cụ thể hơn
  return true;
}

/**
 * Người xem đã bấm "Vào rạp chung thay thế" trong lúc chờ kết quả vào phòng riêng bằng vé mà server vẫn cho vào phòng đó →
 * bỏ nhân vật vừa vào (leave: kết nối về đứng xem rạp chung, server gửi hello), giữ màn vào rạp; đã kịp bấm một rạp chung
 * thì hello tới sẽ vào rạp đó (sendJoin). Server nối lại nhân vật cũ ở phòng chung → nhận luôn.
 */
function abandonedWelcome() {
  if (!abandonedJoin) return false;
  abandonedJoin = false;
  if (!isPrivateRoomId(store.roomId) || store.roomId !== dismissedPriv) return false;
  send({ t: 'leave' });
  store.joined = false;
  rejoining = false;
  return true;
}

store.on('welcome', (msg) => {
  if (abandonedWelcome()) return;
  if (refusedWelcome()) return;
  joinWarn = null;
  clearTimeout(switchTimer);
  switchTimer = 0;
  rejoining = false;
  cancelAuth();
  pendingCreate = null;
  if (privLink) setPrivLink('', false); // đã vào: màn vào rạp thôi chế độ phòng riêng
  syncUrl(store.roomId);
  if (leavingPriv && !store.inPrivate()) toast('Đã rời phòng riêng — mở lại link để vào lại.', 'info', 5000);
  leavingPriv = false;
  setTimeout(hintBusyRoom, 1500);
  ssSet('vc.token', store.token);
  rememberJoin(store.roomId); // lần sau mở trang: vào thẳng, khỏi đặt tên / tạo nhân vật lại
  joinRoom = store.roomId; // rớt mạng quá lâu phải vào lại thì về đúng phòng này (phòng riêng: kèm vé vc.rt)
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

// Điện thoại: chuyển app / về màn hình chính / tắt màn hình (trang ẩn) → báo 'away': người khác không thấy nhân vật nữa
// (trước đây tab Chrome còn chạy nền là nhân vật đứng "kẹt" lại; đóng tab từ màn đa nhiệm thì hiện "mất mạng" một lúc).
// Mở lại → 'back': hiện lại đúng chỗ cũ. Máy tính để tab chạy nền vẫn đang nghe nên giữ nguyên.
const AWAY_ON_HIDE = window.matchMedia('(hover: none) and (pointer: coarse)');
let awaySent = false;
function syncAway() {
  if (!store.joined || !AWAY_ON_HIDE.matches) { awaySent = false; return; }
  if (document.hidden && !awaySent) awaySent = send({ t: 'away' });
  else if (!document.hidden && awaySent) { awaySent = false; send({ t: 'back' }); }
}
document.addEventListener('visibilitychange', syncAway);
// vào lại / nối lại đúng lúc trang đang ẩn (mạng chập chờn khi chạy nền) → ẩn luôn
store.on('welcome', () => { awaySent = false; syncAway(); });

/** nút "Dán link YouTube để chiếu" dưới màn hình khi rạp chưa chiếu gì / đang phát kênh mặc định */
function updateAddPill() { $('btn-add-video').hidden = !(store.joined && (!store.now || store.now.filler)); }
store.on('now', updateAddPill);

/**
 * về màn vào rạp: tắt trình phát TRƯỚC (lớp phủ màn vào rạp không được nằm trên video đang chạy). Đang ở trong rạp mà
 * vào lại hỏng → hiện phòng kết nối đang đứng xem thay cho phòng cũ đứng hình. quick = thẻ chào lại (người quay lại),
 * note = dòng thông tin thay vì lỗi
 */
function backToJoin(text, { busy = false, quick = false, note = false } = {}) {
  const wasJoined = store.joined;
  wantJoin = false;
  rejoining = false;
  me.active = false;
  player.disable();
  if (wasJoined) backToSpectate();
  store.joined = false;
  closeSheet(); // tấm nổi trên lớp phủ màn vào rạp — đóng cho khỏi lạc chỗ
  userCard.close();
  wheel.close();
  $('joystick').hidden = true;
  updateAddPill();
  chat.enable(false);
  if (quick) { join.showQuick(); joinMsg(text, note); } else { join.show(note ? '' : text); if (note) showJoinError(text, true); }
  if (busy) setJoinBusy(true);
}

/** vào phòng riêng bị từ chối: cần mật khẩu (vé hết hiệu lực — mật khẩu đã đổi) / phòng đã đóng / bị chủ phòng mời ra */
function onPrivJoinError(e, room, wasRejoin) {
  const target = isPrivateRoomId(room) ? room : privLink;
  wantJoin = false;
  joinRoom = ''; // đã xử lý xong: proom_need theo sau (cùng phòng) không ghi đè câu báo cụ thể hơn
  if (target) dropRt(target);
  let text, note = false;
  if (e.code === 'priv_need') {
    setPrivLink(target, false);
    text = lastJoinRt ? 'Mật khẩu phòng đã đổi — nhập mật khẩu mới để vào lại.' : e.text || 'Phòng riêng này cần mật khẩu.';
  } else if (e.code === 'priv_gone') {
    clearPrivLink();
    text = wasRejoin ? 'Phòng riêng đã đóng trong lúc bạn mất kết nối.' : CLOSED_LINE;
    note = true;
  } else {
    clearPrivLink();
    text = e.text || 'Chủ phòng đã mời bạn ra khỏi phòng này.';
  }
  if (store.joined) backToJoin(text, { quick: isReturning(), note });
  else joinMsg(text, note);
  if (e.code === 'priv_need') join.focusPass();
}

store.on('joinError', (e) => {
  // kết quả của lượt vào phòng riêng người xem đã bỏ ("Vào rạp chung thay thế") — không còn liên quan (server trả lời theo
  // thứ tự: lượt vào rạp chung bấm sau đó có kết quả riêng tới sau)
  if (abandonedJoin) { abandonedJoin = false; return; }
  joinWarn = null;
  const wasRejoin = rejoining;
  rejoining = false;
  const wasJoined = store.joined;
  const room = joinRoom;
  if (sheetOpen('create')) closeSheet(); // tạo phòng xong mà vào không được: lỗi hiện trên màn vào rạp
  if (e.code === 'priv_need' || e.code === 'priv_gone' || e.code === 'priv_kicked') { onPrivJoinError(e, room, wasRejoin); return; }
  // vào phòng riêng hỏng vì lý do khác (đầy, trùng tên…): màn vào rạp vẫn ở chế độ phòng riêng của phòng đó
  if (isPrivateRoomId(room) && privLink !== room) setPrivLink(room, !!rtFor(room) || store.admin);
  // tên đã nhớ bị trùng / không hợp lệ → về màn đặt tên; lỗi khác giữ thẻ chào lại, báo ngay trên thẻ
  if (join.isQuick && !['name', 'name_taken', 'banned', 'kicked'].includes(e.code)) {
    wantJoin = false;
    join.quickError(e.text);
    return;
  }
  if (['banned', 'kicked', 'name', 'name_taken', 'full', 'rate'].includes(e.code)) {
    // đang ở phòng riêng mà nối lại bị từ chối (đầy…): thẻ chào lại ở chế độ phòng riêng
    const quick = wasJoined && !!privLink && isReturning() && !['name', 'name_taken'].includes(e.code);
    backToJoin(e.text, { quick });
    return;
  }
  if (!$('join').hidden) showJoinError(e.text);
  else toast(e.text, 'err', 6000);
});

store.on('kicked', (e) => {
  ssSet('vc.token', null);
  toast(e.text, 'err', 8000);
  backToJoin(`${e.text} Tải lại trang để vào lại sau.`, { busy: true });
});

// mở rạp ở tab / máy khác (cùng nhân vật): tab này nhường, không tự nối lại
store.on('replaced', () => {
  player.disable();
  me.active = false;
  const banner = $('conn');
  banner.hidden = false;
  setText(banner, 'Bạn đang xem rạp ở tab khác — tải lại trang để xem ở đây.');
});

// ---------------------------------------------------------------- phòng riêng: kết quả từ server
store.on('proomOk', (o) => {
  privateOk(o); // tạo phòng: nhớ mật khẩu (trong bộ nhớ) cho thẻ mời
  if (pendingAuth && pendingAuth.room === o.room) {
    // mật khẩu đúng → vào phòng bằng vé vừa nhận (giữ chế độ phòng riêng qua lỗi tên)
    const a = pendingAuth;
    cancelAuth();
    setPrivLink(o.room, true);
    if (store.joined) return; // đang có nhân vật: server tự chuyển sang (welcome)
    wantJoin = true;
    joinName = a.name;
    joinLook = a.look;
    joinRoom = o.room;
    if (a.quick) join.setQuickBusy(o.room); else setJoinBusy(true);
    sendJoin();
    return;
  }
  if (o.created && !store.joined && pendingCreate) {
    // tạo phòng từ màn vào rạp → vào thẳng phòng mới (không đi qua phòng chung)
    setPrivLink(o.room, true);
    wantJoin = true;
    joinName = pendingCreate.name;
    joinLook = pendingCreate.look;
    joinRoom = o.room;
    if (join.isQuick) join.setQuickBusy(o.room); else setJoinBusy(true);
    sendJoin();
    return;
  }
  // đang ở trong rạp: server chuyển nhân vật sang phòng riêng ngay (welcome) — tối dần sang khung cảnh phòng đó
  if (store.joined) fadeTo(o.venue, `Đang vào 🔒 ${o.name || 'phòng riêng'}…`);
});

store.on('proomNeed', ({ room, exists }) => {
  if (pendingAuth && pendingAuth.room === room) {
    // đang chờ kiểm mật khẩu: chỉ "phòng không còn" mới là kết quả (nhắc "cần mật khẩu" thì cứ chờ proom_ok / proom_res)
    if (!exists) { cancelAuth(); clearPrivLink(); joinMsg(CLOSED_LINE, true); }
    return;
  }
  // phòng người xem vừa bỏ ("Vào rạp chung thay thế"): lời nhắc tới muộn không bật lại chế độ phòng riêng
  if (room === dismissedPriv) return;
  if (store.joined) {
    if (rejoining) return; // nối lại: chờ kết quả join (join_err priv_*)
    // chuyển sang phòng riêng bị từ chối
    cancelSwitch();
    toast(exists ? 'Phòng riêng này cần mật khẩu — mở link bạn bè gửi để vào nhé.' : 'Phòng riêng này đã đóng.', 'warn', 5000);
    return;
  }
  const ref = takeRefused(room);
  if (!exists) {
    // link mở ra phòng đã đóng (mọi người rời đi quá lâu / chủ phòng đóng) → màn vào rạp thường + dòng giải thích
    if (ref || privLink === room || joinRoom === room) {
      wantJoin = false;
      clearPrivLink();
      joinMsg(CLOSED_LINE, true);
    }
    return;
  }
  if (ref) {
    // vé không còn hiệu lực (mật khẩu đã đổi) / chưa có vé → nhập mật khẩu
    if (ref.rt) dropRt(room);
    setPrivLink(room, false);
    joinMsg(ref.rt ? 'Mật khẩu phòng đã đổi — nhập mật khẩu mới để vào lại.' : 'Phòng riêng này cần mật khẩu.');
    join.focusPass();
  }
  // còn lại: server nhắc phòng cần mật khẩu ngay sau hello khi mở link — chế độ phòng riêng đã bật từ lúc mở trang (đọc
  // link), đang tự vào bằng vé thì chờ kết quả. Không bật lại ở đây (người xem có thể vừa chọn rạp chung)
});

/** bị đưa ra khỏi phòng riêng (chủ phòng mời ra / phòng đóng): server đã xếp kết nối về rạp chung (welcome hoặc hello) */
function onOut(r) {
  outText = r.text || 'Bạn đã ra khỏi phòng riêng.';
  outAt = performance.now();
  dropRt(r.room || store.lastPrivRoom);
  privateReset();
  if (sheetOpen()) closeSheet(); // tấm của phòng cũ (thành viên, công cụ chủ phòng…) không còn đúng
  if (rejoining) { clearPrivLink(); backToJoin(outText, { quick: isReturning() }); return; }
  if (!$('join').hidden) { joinMsg(outText); return; } // server đã gửi hello trước: đang ở màn vào rạp
  toast(outText, 'warn', 7000);
}

store.on('proomRes', (r) => {
  if (r.code === 'out') { onOut(r); return; }
  if (pendingAuth) {
    // mật khẩu sai / thử nhiều quá / máy chủ bận / phòng đầy / bị mời ra…: báo ngay trên thẻ, giữ chế độ phòng riêng
    const a = pendingAuth;
    cancelAuth();
    if (r.code === 'kicked' || r.code === 'gone') {
      dropRt(a.room);
      clearPrivLink();
      joinMsg(r.code === 'gone' ? CLOSED_LINE : r.text || 'Chủ phòng đã mời bạn ra khỏi phòng này.', r.code === 'gone');
      return;
    }
    joinMsg(r.text || 'Chưa vào được phòng, thử lại nhé.');
    join.focusPass();
    return;
  }
  if (privateResult(r)) return; // tấm tạo phòng / công cụ chủ phòng
  if (r.room && r.room === dismissedPriv && !store.inPrivate()) return; // phòng người xem vừa bỏ: kết quả tới muộn
  if (!r.ok) cancelSwitch();
  // lý do không cho sang phòng riêng (đầy / bị mời ra / trùng tên…) — báo ngay dưới
  const ref = r.room ? takeRefused(r.room) : null;
  if (ref && NAME_CODES.includes(r.code) && !$('join').hidden) {
    // tên đang dùng bị trùng trong phòng riêng: về form đặt tên (vẫn chế độ phòng riêng, có vé thì khỏi mật khẩu)
    join.show(r.text || 'Tên này đang có người dùng trong phòng riêng — đổi tên rồi vào nhé.');
    return;
  }
  if (r.code === 'kicked' && r.room) {
    // bị chủ phòng mời ra: vé vô dụng, link không vào được nữa
    dropRt(r.room);
    if (privLink === r.room) clearPrivLink();
  }
  if (!r.text) return;
  if (!$('join').hidden) joinMsg(r.text);
  else toast(r.text, r.ok ? 'ok' : 'warn', 5000);
});

// server tách nhân vật khỏi phòng riêng mà không xếp được vào phòng chung nào → chỉ còn đứng xem: về màn vào rạp
store.on('detached', () => {
  const text = outText && performance.now() - outAt < 5000 ? outText : 'Bạn đã ra khỏi phòng riêng.';
  privateReset();
  clearPrivLink();
  backToJoin(text, { quick: isReturning() });
});

store.on('correct', (c) => applyCorrection(c.x, c.y));
store.on('notice', (n) => {
  if (switchTimer && n.kind === 'warn') cancelSwitch();
  if ((n.kind === 'warn' || n.kind === 'err') && joinNotice(n.text)) return; // đang ở màn vào rạp: báo trên thẻ
  if (n.kind === 'info') systemLine(n.text);
  toast(n.text, n.kind === 'info' ? 'info' : n.kind, n.kind === 'info' ? 3200 : 4500);
});
store.on('now', () => player.sync());

function updateRoomPill() {
  const pill = $('room-pill');
  const priv = isPrivateRoomId(store.roomId) ? store.priv : null;
  if (isPrivateRoomId(store.roomId)) {
    // phòng riêng: "🔒 <tên>" (tên dài tự rút gọn "…", đủ tên khi rê chuột), số người = thành viên (kể cả đang ẩn; quản trị
    // viên rạp không chiếm chỗ) / tối đa. Quản trị viên rạp đang xem phòng → dấu 🛡 luôn hiện (không chỉ một dòng báo lúc vào)
    const name = priv?.name || store.roomName;
    const adm = store.adminWatching();
    setText($('room-name'), `🔒 ${name}`);
    setText($('room-count'), String(priv ? store.memberCount() : store.present()));
    setText($('room-cap'), String(priv?.cap || '?'));
    $('room-adm').hidden = !adm;
    pill.title = adm ? `${name} — ${ADMIN_WATCHING}` : name;
    pill.setAttribute('aria-label', adm ? `Chọn phòng — ${ADMIN_WATCHING}` : 'Chọn phòng');
    pill.classList.add('priv');
    return;
  }
  const r = store.rooms.find((x) => x.id === store.roomId);
  setText($('room-name'), `${venueById(store.venue)?.emoji || '🎬'} ${store.roomName}`);
  setText($('room-count'), String(r ? r.count : store.present()));
  setText($('room-cap'), String(r ? r.cap : store.cfg.capacity));
  $('room-adm').hidden = true;
  pill.title = 'Phòng đang xem — bấm để đổi phòng';
  pill.setAttribute('aria-label', 'Chọn phòng');
  pill.classList.remove('priv');
}
store.on('rooms', updateRoomPill);
store.on('players', updateRoomPill);
store.on('priv', updateRoomPill);
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

// mở trang: vừa chuyển phòng / link thẳng tới một rạp (?phong=<rạp>) → vào luôn; đã từng vào rạp → thẻ "Chào mừng quay lại"
// (bấm một rạp là vào, khỏi đặt tên / tạo nhân vật lại); lần đầu → màn đặt tên + chọn nhân vật.
// Link phòng riêng (#phong=p-…; link cũ ?phong=p-… đã đổi sang # ở đầu file): chế độ phòng riêng NGAY (không chờ server) —
// có vé vc.rt thì người quay lại tự vào luôn ("Đang vào phòng riêng…"), người mới thì form không cần ô mật khẩu; chưa có
// vé → ô mật khẩu
{
  const urlRoom = linkRoom();
  const switching = ssGet('vc.autojoin') === '1';
  if (switching) { ssSet('vc.autojoin', null); ssSet('vc.token', null); }
  if (isPrivateRoomId(urlRoom)) {
    const rt = rtFor(urlRoom);
    setPrivLink(urlRoom, !!rt);
    if (isReturning()) {
      join.showQuick();
      if (rt) {
        join.setQuickBusy(urlRoom);
        const off = store.on('hello', () => { off(); if (!wantJoin && privLink === urlRoom) quickJoin(urlRoom); });
      } else join.focusPass();
    }
  } else if (isReturning()) {
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
