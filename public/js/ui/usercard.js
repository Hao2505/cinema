// Thẻ người xem khi bấm / chạm vào một nhân vật: tên, vẫy chào, báo cáo; admin có thêm tắt tiếng / mời ra / cấm.
import { send } from '../net.js';
import { doAction } from '../me.js';
import { store } from '../store.js';
import { clamp, el, setKids } from '../util.js';
import { openSheet, closeSheet } from './sheet.js';

const $ = (id) => document.getElementById(id);
let adminTools = null; // (player) → Node[]

export function registerUserAdmin(fn) {
  adminTools = fn;
}

export function initUserCard(stage) {
  const card = $('user-card');
  let openId = 0;

  function close() {
    openId = 0;
    card.hidden = true;
  }

  function openReportUser(a) {
    const reasons = [['harass', 'Quấy rối / chửi bới'], ['spam', 'Spam / quảng cáo'], ['inappropriate', 'Tên / hành vi không phù hợp'], ['other', 'Lý do khác']];
    const note = el('textarea', { maxlength: '300', placeholder: 'Ghi chú thêm (không bắt buộc)' });
    openSheet('report-user', '🚩 Báo cáo người xem', [
      el('p', null, 'Báo cáo ', el('b', { text: a.name }), ' cho admin.'),
      ...reasons.map(([v, label], i) => el('label', { class: 'radio' }, el('input', { type: 'radio', name: 'ureason', value: v, checked: i === 0 }), el('span', { text: label }))),
      note,
      el('div', { class: 'row', style: { marginTop: '10px' } },
        el('button', {
          type: 'button', class: 'btn btn-accent', text: 'Gửi báo cáo',
          onclick: () => {
            const r = document.querySelector('#sheet-body input[name="ureason"]:checked');
            send({ t: 'report', kind: 'user', target: String(a.id), reason: r ? r.value : 'other', note: note.value.slice(0, 300) });
            closeSheet();
          },
        }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Huỷ', onclick: () => closeSheet() }),
      ),
    ]);
  }

  function open(id, clientX, clientY) {
    const a = store.players.get(id);
    if (!a) return;
    openId = id;
    const isMe = id === store.myId;
    const acts = [];
    if (isMe) acts.push(el('button', { type: 'button', class: 'btn', text: '🎭 Động tác', onclick: () => { close(); document.getElementById('btn-actions').click(); } }));
    else {
      acts.push(el('button', { type: 'button', class: 'btn', text: '👋 Vẫy chào', onclick: () => { doAction('wave'); close(); } }));
      if (store.joined) acts.push(el('button', { type: 'button', class: 'btn btn-ghost', text: '🚩 Báo cáo', onclick: () => { close(); openReportUser(a); } }));
    }
    const adm = !isMe && adminTools ? adminTools(a, close) : [];
    setKids(card,
      el('div', { class: 'uc-name', text: isMe ? `${a.name} (bạn)` : a.name }),
      el('div', { class: 'uc-sub', text: a.ghost ? 'Đang kết nối lại…' : a.seated ? 'Đang ngồi xem' : a.act ? a.act.def.label : 'Đang ở trong rạp' }),
      el('div', { class: 'uc-actions' }, acts),
      adm.length ? el('div', { class: 'uc-admin' }, el('div', { class: 'uc-actions' }, adm)) : null,
    );
    card.hidden = false;
    const host = $('stage').getBoundingClientRect();
    const L = stage.layout;
    const minY = L ? L.screen.y + L.screen.h + L.frame + 6 : 0;
    const w = card.offsetWidth, h = card.offsetHeight;
    const x = clamp(clientX - host.left - w / 2, 8, host.width - w - 8);
    let y = clientY - host.top - h - 16;
    if (y < minY) y = clientY - host.top + 18;
    card.style.left = `${x}px`;
    card.style.top = `${clamp(y, minY, Math.max(minY, host.height - h - 8))}px`;
  }

  document.addEventListener('pointerdown', (e) => {
    if (!card.hidden && !card.contains(e.target)) close();
  });
  store.on('players', () => { if (openId && !store.players.has(openId)) close(); });
  return { open, close, get isOpen() { return !card.hidden; } };
}
