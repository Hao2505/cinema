// Trò chuyện: khung log (ngăn kéo / tấm trượt), ô nhập trên dock, bảng thả emoji, khung chat nổi góc dưới trái (máy tính,
// khi ngăn kéo đóng: 4 tin mới nhất, mờ dần sau 12 s). Chữ chỉ vào DOM qua textContent.
// Cuộn mượt: đang ở cuối thì tự bám tin mới (kể cả khi khung đổi cỡ); đang kéo lên đọc tin cũ thì không bị giật xuống,
// hiện nút "↓ Tin mới" để quay lại.
import { LIMITS, REACTIONS } from '../shared/hall.js';
import { send } from '../net.js';
import { react } from '../me.js';
import { store } from '../store.js';
import { el, initial, pad2, reducedMotion, safeColor, setText } from '../util.js';
import { luma } from '../render/draw.js';

const $ = (id) => document.getElementById(id);
const MAX_ITEMS = 120;
const FEED_MAX = 4;
const FEED_MS = 12000;
let unread = 0;
let stuck = true; // đang xem cuối khung
let pending = 0; // tin mới tới khi đang kéo lên đọc
let moreBtn = null;

function timeOf(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function msgNode(m, live) {
  const a = store.players.get(m.pid);
  const color = safeColor(a?.look?.shirt, '#9a90ab');
  const mine = m.pid === store.myId;
  return el('li', { class: `c-msg${live ? ' new' : ''}`, dataset: { pid: String(m.pid) } },
    el('span', { class: 'c-av', style: { background: color, color: luma(color) > 0.6 ? '#1f1300' : '#fff' }, 'aria-hidden': 'true', text: initial(m.name) }),
    el('div', { class: 'c-body' },
      el('div', null, el('span', { class: `c-name${mine ? ' me' : ''}`, text: m.name }), el('span', { class: 'c-time', text: timeOf(m.at) })),
      el('div', { class: 'c-text', text: m.text }),
    ),
  );
}

const atBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < 32;

function toBottom(log, smooth) {
  pending = 0;
  updateMore(log);
  log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
}

let moreLabel = null;
function updateMore(log) {
  if (pending > 0 && !stuck) {
    if (!moreBtn) {
      moreLabel = el('button', { type: 'button', class: 'chat-more', onclick: () => { stuck = true; toBottom(log, true); } });
      moreBtn = el('li', { class: 'chat-more-li' }, moreLabel);
    }
    setText(moreLabel, `↓ ${pending} tin mới`);
    log.append(moreBtn); // luôn nằm cuối (dính đáy khung)
  } else if (moreBtn?.parentNode) {
    moreBtn.remove();
  }
}

function append(log, node) {
  if (moreBtn?.parentNode === log) log.insertBefore(node, moreBtn);
  else log.append(node);
  const items = log.querySelectorAll('.c-msg, .c-sys');
  for (let i = 0; i < items.length - MAX_ITEMS; i++) items[i].remove();
  if (stuck) toBottom(log, true);
  else { pending++; updateMore(log); }
}

export function systemLine(text) {
  append($('chat-log'), el('li', { class: 'c-sys new', text }));
}

/** khung chat nổi: không chặn bấm vào rạp (pointer-events: none), tự mờ rồi biến mất */
function feedPush(feed, m) {
  const a = store.players.get(m.pid);
  const li = el('li', { class: 'feed-item' },
    el('b', { style: { color: safeColor(a?.look?.shirt, '#ffc14d') }, text: m.name }),
    el('span', { text: m.text }));
  feed.append(li);
  while (feed.children.length > FEED_MAX) feed.firstElementChild.remove();
  setTimeout(() => { li.classList.add('out'); setTimeout(() => li.remove(), 600); }, FEED_MS);
}

export function initChat({ isChatVisible, feedVisible, onUnread }) {
  const log = $('chat-log');
  const feed = $('chat-feed');
  const input = $('chat-input');
  const reactions = $('reactions');
  for (const e of REACTIONS) {
    reactions.append(el('button', { type: 'button', class: 'react', text: e, 'aria-label': `Thả ${e}`, title: `Thả ${e}`, onclick: () => react(e) }));
  }
  log.addEventListener('scroll', () => {
    const was = stuck;
    stuck = atBottom(log);
    if (stuck && !was) { pending = 0; updateMore(log); }
  }, { passive: true });
  // khung đổi cỡ (thêm video, mở tấm trượt, xoay máy…) mà đang ở cuối → giữ ở cuối, không giật
  new ResizeObserver(() => { if (stuck) log.scrollTop = log.scrollHeight; }).observe(log);
  store.on('chatReset', (list) => {
    log.replaceChildren(...list.map((m) => msgNode(m, false)));
    stuck = true;
    pending = 0;
    toBottom(log, false);
  });
  store.on('chat', (m) => {
    if (m.pid === store.myId) stuck = true; // mình vừa nhắn → luôn xuống cuối
    append(log, msgNode(m, true));
    if (feed && feedVisible?.()) feedPush(feed, m);
    if (!isChatVisible() && m.pid !== store.myId) { unread++; onUnread?.(unread); }
  });
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) { input.blur(); return; }
    if (Array.from(text).length > LIMITS.chatMax) return;
    if (send({ t: 'chat', text })) input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); e.stopPropagation(); }
  });
  return {
    clearUnread() { unread = 0; onUnread?.(0); },
    enable(on) { input.disabled = !on; setText($('chat-send'), '➤'); },
    /** mở tab chat (điện thoại): nhảy xuống cuối */
    scrollToEnd() { stuck = true; toBottom(log, false); },
  };
}
