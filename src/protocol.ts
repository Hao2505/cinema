// Kiểm tra từng thông điệp client gửi lên: đúng dạng ClientMsg hoặc null (bỏ qua). Không tin gì từ client.
import type { RawData } from 'ws';
import { ACTION_IDS, REACTIONS, ROOM_ID_RE } from '../public/js/shared/hall.js';
import type { ActionId } from '../public/js/shared/hall.js';
import type { AdminOp, ClientMsg } from './types.js';

export const MAX_MSG_BYTES = 4096;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v: unknown, min: number, max: number): number | null => (fin(v) && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function rawToString(data: RawData, isBinary: boolean): string | null {
  if (isBinary) return null;
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  if (buf.length === 0 || buf.length > MAX_MSG_BYTES) return null;
  return buf.toString('utf8');
}

function parseAdmin(m: Record<string, unknown>): AdminOp | null {
  switch (m.op) {
    case 'skip': case 'pause': case 'resume': case 'clear_chat': case 'state':
      return { op: m.op };
    case 'remove': case 'top': {
      const qid = int(m.qid, 1, 1e9);
      return qid === null ? null : { op: m.op, qid };
    }
    case 'lock':
      return typeof m.on === 'boolean' ? { op: 'lock', on: m.on } : null;
    case 'mute': {
      const pid = int(m.pid, 1, 1e9), minutes = int(m.minutes, 0, 60 * 24 * 30);
      return pid === null || minutes === null ? null : { op: 'mute', pid, minutes };
    }
    case 'unmute': case 'kick': {
      const pid = int(m.pid, 1, 1e9);
      return pid === null ? null : { op: m.op, pid };
    }
    case 'ban': {
      const pid = int(m.pid, 1, 1e9), hours = int(m.hours, 0, 24 * 365);
      return pid === null || hours === null ? null : { op: 'ban', pid, hours };
    }
    case 'unban': {
      const id = str(m.id, 40);
      return id && /^[a-f0-9]{4,40}$/.test(id) ? { op: 'unban', id } : null;
    }
    case 'unblock': {
      const v = str(m.v, 11);
      return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? { op: 'unblock', v } : null;
    }
    case 'block': {
      // v rỗng = video đang chiếu trong phòng của admin
      const v = m.v === undefined || m.v === '' ? '' : str(m.v, 11);
      return v === '' || (v && /^[A-Za-z0-9_-]{11}$/.test(v)) ? { op: 'block', v: v || '' } : null;
    }
    default:
      return null;
  }
}

export function parseClientMsg(text: string): ClientMsg | null {
  let m: unknown;
  try { m = JSON.parse(text); } catch { return null; }
  if (!isRecord(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'ping': {
      return fin(m.c) ? { t: 'ping', c: m.c } : { t: 'ping', c: 0 };
    }
    case 'spec': {
      const room = str(m.room, 16); // "congvien-2" = 10 ký tự (ROOM_ID_RE kiểm dạng)
      return room && ROOM_ID_RE.test(room) ? { t: 'spec', room } : null;
    }
    case 'leave': return { t: 'leave' };
    case 'away': return { t: 'away' };
    case 'back': return { t: 'back' };
    case 'switch': {
      const room = str(m.room, 16); // "congvien-2" = 10 ký tự (ROOM_ID_RE kiểm dạng)
      return room && ROOM_ID_RE.test(room) ? { t: 'switch', room } : null;
    }
    case 'join': {
      const name = str(m.name, 80);
      if (name === null) return null;
      const room = str(m.room, 16) ?? '';
      const token = str(m.token, 64) ?? '';
      const ck = str(m.ck, 64) ?? '';
      return {
        t: 'join', name, look: m.look,
        room: ROOM_ID_RE.test(room) ? room : '',
        token: /^[a-f0-9]{32}$/.test(token) ? token : '',
        ck: /^[a-f0-9]{16,64}$/.test(ck) ? ck : '',
      };
    }
    case 'move': {
      if (!fin(m.x) || !fin(m.y) || !fin(m.c)) return null;
      const d = int(m.d, 0, 3);
      if (d === null || Math.abs(m.x) > 1000 || Math.abs(m.y) > 1000 || m.c < 0 || m.c > 1e12) return null;
      return { t: 'move', x: m.x, y: m.y, d, c: Math.round(m.c), m: m.m === 1 || m.m === true ? 1 : 0 };
    }
    case 'act': {
      const a = typeof m.a === 'string' && (m.a === '' || (ACTION_IDS as readonly string[]).includes(m.a)) ? (m.a as ActionId | '') : null;
      if (a === null) return null;
      const c = fin(m.c) && m.c >= 0 && m.c <= 1e12 ? Math.round(m.c) : 0;
      return { t: 'act', a, c };
    }
    case 'chat': {
      const text = str(m.text, 1000);
      return text === null ? null : { t: 'chat', text };
    }
    case 'emo': {
      return typeof m.e === 'string' && REACTIONS.includes(m.e) ? { t: 'emo', e: m.e } : null;
    }
    case 'look':
      return isRecord(m.look) ? { t: 'look', look: m.look } : null;
    case 'q_add': {
      const url = str(m.url, 500);
      return url === null ? null : { t: 'q_add', url };
    }
    case 'q_del': {
      const qid = int(m.qid, 1, 1e9);
      return qid === null ? null : { t: 'q_del', qid };
    }
    case 'vote':
      return typeof m.on === 'boolean' ? { t: 'vote', on: m.on } : null;
    case 'report': {
      if (m.kind !== 'video' && m.kind !== 'user') return null;
      const target = str(m.target, 40) ?? '';
      const reason = str(m.reason, 40);
      if (!reason) return null;
      return { t: 'report', kind: m.kind, target, reason, note: (str(m.note, 600) ?? '') };
    }
    case 'vid_err': {
      const v = str(m.v, 11);
      const code = int(m.code, 0, 10000);
      return v && /^[A-Za-z0-9_-]{11}$/.test(v) && code !== null ? { t: 'vid_err', v, code } : null;
    }
    case 'vid_dur': {
      const v = typeof m.v === 'string' ? m.v : '';
      if (!/^[A-Za-z0-9_-]{11}$/.test(v) || !fin(m.d) || m.d < 0 || m.d > 1e8) return null;
      return { t: 'vid_dur', v, d: m.d, live: m.live === true || m.live === 1 };
    }
    case 'adm': {
      const op = parseAdmin(m);
      return op ? { t: 'adm', ...op } : null;
    }
    default:
      return null;
  }
}
