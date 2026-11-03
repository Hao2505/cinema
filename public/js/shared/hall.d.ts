// Kiểu cho public/js/shared/hall.js (server import file .js này qua tsx). Giữ khớp tay khi sửa hall.js.

export declare const PROTOCOL: number;

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export declare const HOME: { readonly x: number; readonly y: number };
export declare const HALL: {
  readonly W: number;
  readonly H: number;
  readonly stageLip: number;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  readonly danceFloor: Rect;
  readonly rows: readonly number[];
  readonly blocks: readonly { readonly x0: number; readonly n: number }[];
  readonly speakers: readonly Rect[];
  readonly counter: Rect;
  readonly exits: readonly number[];
};

export declare function isWalkable(x: number, y: number): boolean;
export declare function clampToWalkable(x: number, y: number): { x: number; y: number };
export declare function moveWithCollision(x: number, y: number, dx: number, dy: number): { x: number; y: number };
export declare const SPEED: number;

export interface Seat { readonly x: number; readonly y: number; readonly row: number; readonly col: number }
export declare const SEATS: readonly Seat[];
export declare function nearestSeat(x: number, y: number, maxD?: number): Seat | null;
export declare function seatAt(x: number, y: number, eps?: number): Seat | null;
export declare function spawnPoint(rand?: () => number): { x: number; y: number };

export interface Venue { readonly id: string; readonly name: string; readonly emoji: string; readonly desc: string }
export declare const VENUES: readonly Venue[];
export declare const DEFAULT_VENUE: string;
export declare const ROOM_ID_RE: RegExp;
/** id phòng riêng: "p-" + 10 ký tự [a-z0-9] */
export declare const PRIVATE_ROOM_RE: RegExp;
/** id phòng chung hoặc riêng */
export declare const ANY_ROOM_ID_RE: RegExp;
export declare function isPrivateRoomId(id: unknown): boolean;
export declare function venueById(id: string): Venue | null;
export declare function parseRoomId(id: unknown): { venue: Venue; n: number } | null;
export declare function roomName(id: string): string;

export type Dir = 'down' | 'up' | 'left' | 'right';
export declare const DIRS: readonly Dir[];
export declare function dirIndex(d: string): number;

export type ActionId = 'wave' | 'clap' | 'hiphop' | 'headbang' | 'bounce' | 'sit' | 'heart' | 'laugh';
export interface ActionDef {
  readonly id: ActionId;
  readonly key: number;
  readonly label: string;
  readonly emoji: string;
  /** ms; 0 = lặp tới khi đi / đổi động tác */
  readonly dur: number;
  readonly seat: boolean;
}
export declare const ACTIONS: readonly ActionDef[];
export declare const ACTION_IDS: readonly ActionId[];
export declare function actionById(id: string): ActionDef | null;
export declare const REACTIONS: readonly string[];

export interface Look {
  /** 'nam' | 'nu' */
  body: string;
  skin: string;
  hair: string;
  hairStyle: string;
  shirt: string;
  pants: string;
  accessory: string;
  /** 'none' | 'ria' | 'rau' */
  facial: string;
}
export interface Option { readonly id: string; readonly label: string }
export declare const SKINS: readonly string[];
export declare const HAIR_COLORS: readonly string[];
export declare const HAIR_STYLES: readonly Option[];
export declare const SHIRTS: readonly string[];
export declare const PANTS: readonly string[];
export declare const ACCESSORIES: readonly Option[];
export declare const BODIES: readonly Option[];
export declare const FACIALS: readonly Option[];
export declare function normalizeLook(raw: unknown): Look;
export declare function randomLook(rand?: () => number): Look;

export declare const LIMITS: {
  readonly nameMin: number;
  readonly nameMax: number;
  readonly chatMax: number;
  readonly sendHz: number;
};
