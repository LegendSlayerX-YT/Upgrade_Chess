import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';

export { Chess };

export const APP_PREFIX = window.APP_PREFIX || '';
export const STATIC_BASE = `${APP_PREFIX}/static`;
export const PIECES_BASE = `${STATIC_BASE}/img/chesspieces/wikipedia`;

export const socket = io({ path: `${APP_PREFIX}/socket.io` });

export const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="%23d6dae5"/><circle cx="22" cy="17" r="7" fill="%238a93a6"/><path d="M6 40c2-8 10-12 16-12s14 4 16 12z" fill="%238a93a6"/></svg>'
  );

export const PIECE_BASE = {
  p: { hp: 10, dmg: 10 },
  n: { hp: 10, dmg: 10 },
  b: { hp: 10, dmg: 10 },
  r: { hp: 10, dmg: 10 },
  q: { hp: 10, dmg: 10 },
  k: { hp: 10, dmg: 1000000 },
};
export const PIECE_LEVEL_MULT = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 1 };
export const HP_TO_DMG_INC_RATIO = 1.5;

export function pieceStats(type, level) {
  const base = PIECE_BASE[type];
  const mult = PIECE_LEVEL_MULT[type];
  const incDmg = base.dmg * mult;
  const incHp = Math.floor(incDmg * HP_TO_DMG_INC_RATIO);
  return {
    hp: base.hp + (level - 1) * incHp,
    dmg: base.dmg + (level - 1) * incDmg,
  };
}

export const SLOT_DEFS = [
  { slot: 'Ra', type: 'r', file: 'a' },
  { slot: 'Nb', type: 'n', file: 'b' },
  { slot: 'Bc', type: 'b', file: 'c' },
  { slot: 'Q',  type: 'q', file: 'd' },
  { slot: 'K',  type: 'k', file: 'e' },
  { slot: 'Bf', type: 'b', file: 'f' },
  { slot: 'Ng', type: 'n', file: 'g' },
  { slot: 'Rh', type: 'r', file: 'h' },
  { slot: 'Pa', type: 'p', file: 'a' },
  { slot: 'Pb', type: 'p', file: 'b' },
  { slot: 'Pc', type: 'p', file: 'c' },
  { slot: 'Pd', type: 'p', file: 'd' },
  { slot: 'Pe', type: 'p', file: 'e' },
  { slot: 'Pf', type: 'p', file: 'f' },
  { slot: 'Pg', type: 'p', file: 'g' },
  { slot: 'Ph', type: 'p', file: 'h' },
];

export const GAME_ENERGY_COST = 5;  // energy required to start a game; mirrors server

export const TYPE_NAME = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
export const TYPE_FULL = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
export const DEFAULT_UPGRADE_COSTS = { p: 1, n: 3, b: 3, r: 5, q: 8 };
export const MAX_LEVEL = 99;
export const PAWN_FRONT_ABILITY_LEVEL = 25;
export const PAWN_FRONT_ABILITY_COOLDOWN = 3;

export const SLOT_TO_W_SQUARE = {
  Ra:'a1', Nb:'b1', Bc:'c1', Q:'d1', K:'e1', Bf:'f1', Ng:'g1', Rh:'h1',
  Pa:'a2', Pb:'b2', Pc:'c2', Pd:'d2', Pe:'e2', Pf:'f2', Pg:'g2', Ph:'h2',
};

export function clampLevel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  if (v > MAX_LEVEL) return MAX_LEVEL;
  return v;
}

export function emptyLevels() {
  const out = {};
  for (const { slot } of SLOT_DEFS) out[slot] = 1;
  return out;
}

export const PIECE_IMG = (color, type) =>
  `${PIECES_BASE}/${color}${TYPE_NAME[type]}.png`;

export const state = {
  isAuthenticated: false,
  myName: null,

  chess: new Chess(),
  board: null,
  myColor: null,
  gameActive: false,
  currentGameMode: null,
  currentPieces: {},
  turnCycle: 0,
  awaitingCapture: false,
  currentDuel: null,
  selectedSquare: null,

  myLevels: { w: emptyLevels(), b: emptyLevels() },
  upgradeCosts: { ...DEFAULT_UPGRADE_COSTS },
  myTokens: { w: 0, b: 0 },
  myEnergy: 0,
  energyNextAt: null,
  pendingUpgrade: null,
  activeSide: 'w',
  altMode: false,

  imWaiting: false,
  rematchRequestedByMe: false,
  pendingPromotion: null,
};

export function buildPreviewPieces() {
  const pieces = {};
  for (const { slot, type } of SLOT_DEFS) {
    const wSq = SLOT_TO_W_SQUARE[slot];
    const bSq = wSq[0] + (wSq[1] === '1' ? '8' : '7');
    const wLvl = clampLevel(state.myLevels.w[slot] ?? 1);
    const bLvl = clampLevel(state.myLevels.b[slot] ?? 1);
    const wStats = pieceStats(type, wLvl);
    const bStats = pieceStats(type, bLvl);
    pieces[wSq] = { id: 'w' + slot, type, color: 'w', level: wLvl, hp: wStats.hp, dmg: wStats.dmg, ability_ready_on_cycle: 0 };
    pieces[bSq] = { id: 'b' + slot, type, color: 'b', level: bLvl, hp: bStats.hp, dmg: bStats.dmg, ability_ready_on_cycle: 0 };
  }
  return pieces;
}
