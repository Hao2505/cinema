// Thẻ người xem khi bấm / chạm vào một nhân vật: tên, vẫy chào, báo cáo, ẩn tin nhắn / động tác / cả người đó (chỉ trên
// máy mình — prefs.js); chủ phòng riêng mời người đó ra (xác nhận trong tấm); admin có thêm tắt tiếng / mời ra / cấm.
import { send } from '../net.js';
import { doAction } from '../me.js';
import { store } from '../store.js';
import { clamp, el, setKids } from '../util.js';
import { openSheet, closeSheet } from './sheet.js';
import { personFlags, setPersonFlag } from '../prefs.js';
import { confirmKick } from './private.js';

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
      if (store.isOwner() && !store.priv?.members.some((m) => m.id === a.id && m.adm)) acts.push(el('button', { type: 'button', class: 'btn btn-danger', text: '🚪 Mời ra khỏi phòng', onclick: () => { close(); confirmKick(a.id, a.name); } }));
    }
    const adm = !isMe && adminTools ? adminTools(a, close) : [];
    // ẩn riêng người này (chỉ trên máy mình): tin nhắn · động tác + emoji · cả nhân vật
    let mine = null;
    if (!isMe) {
      const f = personFlags(a.name) || {};
      const tog = (flag, hideText, showText, title) => el('button', {
        type: 'button', class: `btn btn-ghost${f[flag] ? ' on' : ''}`, text: f[flag] ? showText : hideText, title,
        onclick: () => { setPersonFlag(a.name, flag, !f[flag]); close(); },
      });
      mine = el('div', { class: 'uc-mine' },
        el('div', { class: 'uc-mine-title', text: 'Chỉ trên máy bạn' }),
        el('div', { class: 'uc-actions' },
          tog('chat', '🔇 Ẩn tin nhắn', '💬 Hiện tin nhắn', 'Không thấy tin nhắn, bong bóng của người này'),
          tog('acts', '🙈 Ẩn động tác', '🕺 Hiện động tác', 'Không thấy người này nhảy / thả emoji'),
          tog('all', '👻 Ẩn người này', '👤 Hiện người này', 'Không thấy nhân vật này nữa (bỏ ẩn trong ⚙️ Tùy chọn)')));
    }
    setKids(card,
      el('div', { class: 'uc-name', text: isMe ? `${a.name} (bạn)` : a.name }),
      el('div', { class: 'uc-sub', text: a.ghost ? 'Đang kết nối lại…' : a.seated ? 'Đang ngồi xem' : a.act ? a.act.def.label : 'Đang ở trong rạp' }),
      el('div', { class: 'uc-actions' }, acts),
      mine,
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
