// Điểm vào client: (1) đăng nhập admin nếu link có #admin=, (2) dựng canvas rạp + trình phát YouTube + giao diện,
// (3) nối WebSocket. Người xem đứng xem ngoài cửa (thấy rạp sống) tới khi đặt tên → "Vào rạp".
import { store } from './store.js';
import { adminLoginFromUrl, connect, isOpen, send } from './net.js';
import { applyCorrection, me, placeMe, tickMe, walkTo } from './me.js';
import { DIRS } from './shared/hall.js';
import { createStage } from './render/stage.js';
import { createPlayer } from './player.js';
import { initInput } from './input.js';
import { initJoin, lookEditor, saveLook, setJoinBusy, showJoinError } from './ui/join.js';
import { initChat, systemLine } from './ui/chat.js';
import { initQueue } from './ui/queue.js';
import { initWheel } from './ui/wheel.js';
import { initUserCard } from './ui/usercard.js';
import { initSheet, openSheet, closeSheet, sheetOpen, onSheetChange } from './ui/sheet.js';
import { initToasts, toast } from './ui/toasts.js';
import { el, isTouch, lsGet, lsSet, randomHex, setText, ssGet, ssSet } from './util.js';

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
    if (!n) return { show: true, title: 'Màn hình đang trống', sub: 'Dán link YouTube vào Hàng chờ để chiếu cho cả rạp' };
    return { show: false };
  },
  onPick: (id, cx, cy) => userCard.open(id, cx, cy),
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
    if (sideOpen()) { closeSide(); return true; }
    return false;
  },
});

// màn hình lớn: bật = video to nhất (khán phòng gọn lại); mặc định tắt = chia cân video và khán phòng
let theater = lsGet('vc.bigscreen', '0') === '1';
stage.setTheater(theater);
$('btn-theater').classList.toggle('on', theater);
$('btn-theater').addEventListener('click', () => {
  theater = !theater;
  lsSet('vc.bigscreen', theater ? '1' : '0');
  stage.setTheater(theater);
  $('btn-theater').classList.toggle('on', theater);
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
    el('p', { text: 'Dưới đáy: 😀 thả cảm xúc · 🎭 động tác · ô chat · 📋 hàng chờ (dán link YouTube) · 💬 trò chuyện. Góc trên: 📺 màn hình lớn · ⛶ toàn màn hình · 🎨 đổi ngoại hình · 🛠 quản trị (admin).' }),
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

// chọn phòng
$('room-pill').addEventListener('click', () => {
  const items = store.rooms.map((r) => el('div', { class: `room-item${r.id === store.roomId ? ' cur' : ''}` },
    el('div', null, el('b', { text: r.name }), el('div', { class: 'now-meta', text: `${r.count}/${r.cap} người` })),
    r.id === store.roomId
      ? el('span', { class: 'badge badge-live', text: 'ĐANG Ở ĐÂY' })
      : el('button', {
        type: 'button', class: 'btn', text: store.joined ? 'Chuyển sang' : 'Xem phòng này',
        disabled: r.count >= r.cap,
        onclick: () => {
          if (!store.joined) { send({ t: 'spec', room: r.id }); closeSheet(); return; }
          ssSet('vc.autojoin', '1');
          location.href = `/?phong=${encodeURIComponent(r.id)}`;
        },
      })));
  openSheet('rooms', '🎬 Các phòng chiếu', [
    el('p', { text: `Mỗi phòng tối đa ${store.cfg.capacity} người, có màn hình và hàng chờ riêng. Phòng đầy thì rạp tự mở phòng mới.` }),
    el('div', { class: 'room-list' }, items),
  ]);
});

// ---------------------------------------------------------------- vào rạp
let wantJoin = false;
let joinName = '';
let joinLook = null;
const join = initJoin((name, look) => {
  wantJoin = true;
  joinName = name;
  joinLook = look;
  sendJoin();
});

function sendJoin() {
  if (!wantJoin || !store.ready) return;
  const token = ssGet('vc.token', '') || '';
  send({ t: 'join', name: joinName, look: joinLook, room: store.roomId, token, ck });
}

store.on('hello', () => {
  updateRoomPill();
  if (store.admin && !document.getElementById('btn-admin').dataset.ready) {
    document.getElementById('btn-admin').dataset.ready = '1';
    import('./ui/admin.js').then((m) => m.initAdmin()).catch((e) => console.warn('[rạp] không nạp được admin', e));
  }
  if (wantJoin) sendJoin(); // nối lại sau khi rớt mạng: vào lại đúng nhân vật cũ (server giữ 15 giây)
});

store.on('welcome', (msg) => {
  ssSet('vc.token', store.token);
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

/** nút "Dán link YouTube để chiếu" dưới màn hình khi rạp chưa chiếu gì */
function updateAddPill() { $('btn-add-video').hidden = !(store.joined && !store.now); }
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
  if (n.kind === 'info') systemLine(n.text);
  toast(n.text, n.kind === 'info' ? 'info' : n.kind, n.kind === 'info' ? 3200 : 4500);
});
store.on('now', () => player.sync());

function updateRoomPill() {
  const r = store.rooms.find((x) => x.id === store.roomId);
  setText($('room-name'), store.roomName);
  setText($('room-count'), String(r ? r.count : store.present()));
  setText($('room-cap'), String(r ? r.cap : store.cfg.capacity));
}
store.on('rooms', updateRoomPill);
store.on('players', updateRoomPill);

store.on('conn', (state) => {
  const banner = $('conn');
  if (state === 'replaced') return;
  if (state === 'open') { banner.hidden = true; return; }
  if (state === 'closed') { banner.hidden = false; setText(banner, 'Mất kết nối — đang nối lại…'); }
});

// chuyển phòng xong (trang tải lại): tự vào lại với tên cũ
if (ssGet('vc.autojoin') === '1') {
  ssSet('vc.autojoin', null);
  ssSet('vc.token', null);
  const off = store.on('hello', () => {
    off();
    if (!wantJoin && $('join-name').value.trim().length >= 2) $('join-form').requestSubmit();
  });
}

connect();

// móc chỉ-đọc cho script QA headless (không chứa gì ngoài dữ liệu đã có trên máy này)
Object.defineProperty(window, '__vc', {
  value: { store, me, view: () => $('hall').__view?.(), player: () => player.debug(), isOpen },
  enumerable: false,
});
