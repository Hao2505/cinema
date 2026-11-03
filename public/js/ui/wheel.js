// Vòng chọn động tác (phím E / nút 🎭): 8 nút xếp tròn quanh nhân vật mình; phím 1–8 chọn thẳng. Không đè lên video.
import { ACTIONS } from '../shared/hall.js';
import { doAction, me } from '../me.js';
import { store } from '../store.js';
import { clamp, el, isTouch, setKids } from '../util.js';

const $ = (id) => document.getElementById(id);

export function initWheel(stage) {
  const node = $('wheel');
  let open = false;

  function place() {
    const L = stage.layout;
    const p = stage.screenPosOf(store.myId);
    const host = $('stage');
    const w = host.clientWidth, h = host.clientHeight;
    const R = w < 720 ? 84 : 96;
    const minY = (L ? L.screen.y + L.screen.h + L.frame : 0) + R + 40;
    let cx = p ? p.x : w / 2, cy = p ? p.y - p.T * 1.1 : h * 0.7;
    cx = clamp(cx, R + 40, w - R - 40);
    const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h')) || 62;
    cy = clamp(cy, minY, Math.max(minY, h - R - dock - 34));
    node.style.left = `${cx}px`;
    node.style.top = `${cy}px`;
    return R;
  }

  function render() {
    const R = place();
    const btns = ACTIONS.map((a, i) => {
      const ang = -Math.PI / 2 + (i / ACTIONS.length) * Math.PI * 2;
      const on = me.act && me.act.id === a.id;
      return el('button', {
        type: 'button', class: `wheel-btn${on ? ' on' : ''}`, role: 'menuitem',
        style: { left: `${Math.cos(ang) * R}px`, top: `${Math.sin(ang) * R}px`, animationDelay: `${i * 18}ms` },
        'aria-label': `${a.label} (phím ${a.key})`, title: `${a.label} — phím ${a.key}`,
        onclick: (e) => { e.stopPropagation(); doAction(a.id); close(); },
      }, a.emoji, el('small', { text: a.label }), el('span', { class: 'k', text: String(a.key) }));
    });
    setKids(node, btns, el('span', { class: 'wheel-hint', style: { left: '0px', top: `${R + 46}px` }, text: isTouch() ? 'Chạm để chọn động tác' : 'Chọn động tác · phím 1–8 · Esc đóng' }));
  }

  function show() {
    if (!me.active) return;
    open = true;
    render();
    node.hidden = false;
    $('btn-actions').classList.add('on');
    setTimeout(() => node.querySelector('.wheel-btn')?.focus({ preventScroll: true }), 20);
  }
  function close() {
    if (!open) return;
    open = false;
    node.hidden = true;
    $('btn-actions').classList.remove('on');
  }
  const toggle = () => (open ? close() : show());
  $('btn-actions').addEventListener('click', toggle);
  document.addEventListener('pointerdown', (e) => {
    if (open && !node.contains(e.target) && !$('btn-actions').contains(e.target)) close();
  });
  node.addEventListener('keydown', (e) => {
    const btns = [...node.querySelectorAll('.wheel-btn')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  });
  // vòng bám theo nhân vật khi đang mở
  setInterval(() => { if (open) place(); }, 120);
  return { show, close, toggle, get open() { return open; } };
}
