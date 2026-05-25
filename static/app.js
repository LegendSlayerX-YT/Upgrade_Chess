import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';
const socket = io();

let isAuthenticated = false;
let myName = null;

window.handleCredentialResponse = async (response) => {
  if (!response || !response.credential) return;
  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ credential: response.credential }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Sign-in failed: ${err.error || res.statusText}`);
      return;
    }
    socket.disconnect();
    socket.connect();
  } catch (e) {
    alert(`Sign-in failed: ${e.message}`);
  }
};

const userBadge = document.getElementById('userBadge');
const userNameEl = document.getElementById('userName');
const userAvatarEl = document.getElementById('userAvatar');
const signOutBtn = document.getElementById('signOutBtn');
const userMenuBtn = document.getElementById('userMenuBtn');
const userMenu = document.getElementById('userMenu');

function setUserMenuOpen(open) {
  userMenu.style.display = open ? '' : 'none';
  userMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
userMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setUserMenuOpen(userMenu.style.display === 'none');
});
document.addEventListener('click', (e) => {
  if (!userMenu.contains(e.target) && e.target !== userMenuBtn) {
    setUserMenuOpen(false);
  }
});
const signInDiv = document.querySelector('.g_id_signin');
const playerTopEl = document.getElementById('playerTop');
const playerBottomEl = document.getElementById('playerBottom');
const playerTopAvatar = document.getElementById('playerTopAvatar');
const playerBottomAvatar = document.getElementById('playerBottomAvatar');
const playerTopName = document.getElementById('playerTopName');
const playerBottomName = document.getElementById('playerBottomName');
const playerTopColor = document.getElementById('playerTopColor');
const playerBottomColor = document.getElementById('playerBottomColor');

const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="%23d6dae5"/><circle cx="22" cy="17" r="7" fill="%238a93a6"/><path d="M6 40c2-8 10-12 16-12s14 4 16 12z" fill="%238a93a6"/></svg>'
  );

function setPlayerCard(side, name, picture, colorLabel, color) {
  const isTop = side === 'top';
  const avatar = isTop ? playerTopAvatar : playerBottomAvatar;
  const nameEl = isTop ? playerTopName : playerBottomName;
  const colorEl = isTop ? playerTopColor : playerBottomColor;
  const card = isTop ? playerTopEl : playerBottomEl;
  avatar.src = picture || FALLBACK_AVATAR;
  avatar.onerror = () => { avatar.onerror = null; avatar.src = FALLBACK_AVATAR; };
  nameEl.textContent = name;
  colorEl.textContent = colorLabel;
  card.dataset.color = color;
  card.style.visibility = 'visible';
}

function hidePlayerCards() {
  playerTopEl.style.visibility = 'hidden';
  playerBottomEl.style.visibility = 'hidden';
  playerTopEl.classList.remove('active-turn');
  playerBottomEl.classList.remove('active-turn');
}

function highlightActiveTurn() {
  if (!gameActive) {
    playerTopEl.classList.remove('active-turn');
    playerBottomEl.classList.remove('active-turn');
    return;
  }
  const turn = chess.turn();
  const myTurn = turn === myColor;
  playerBottomEl.classList.toggle('active-turn', myTurn);
  playerTopEl.classList.toggle('active-turn', !myTurn);
}

const findBtn = document.getElementById('findBtn');
const resignBtn = document.getElementById('resignBtn');
const drawBtn = document.getElementById('drawBtn');
const drawPrompt = document.getElementById('drawPrompt');
const drawPromptText = document.getElementById('drawPromptText');
const drawAcceptBtn = document.getElementById('drawAcceptBtn');
const drawDeclineBtn = document.getElementById('drawDeclineBtn');

const findModal = document.getElementById('findModal');
const findModalCloseBtn = document.getElementById('findModalCloseBtn');
const findModalMessage = document.getElementById('findModalMessage');
const waitingPlayersListEl = document.getElementById('waitingPlayersList');
const createWaitingBtn = document.getElementById('createWaitingBtn');
let imWaiting = false;

function renderWaitingList(players) {
  if (!players || players.length === 0) {
    waitingPlayersListEl.innerHTML = '<div class="waiting-list-empty">No players waiting. Create a new game to wait for an opponent.</div>';
    return;
  }
  waitingPlayersListEl.innerHTML = players.map(p => `
    <div class="waiting-row${p.is_self ? ' is-self' : ''}" data-sid="${p.sid}"${p.is_self ? ' data-self="1"' : ''}>
      <img src="${p.picture || FALLBACK_AVATAR}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_AVATAR}'" />
      <div class="waiting-name">${(p.name || 'Player').replace(/</g, '&lt;')}</div>
      ${p.is_self ? '<div class="waiting-self-tag">self</div>' : '<div class="waiting-join">Join →</div>'}
    </div>
  `).join('');
}

function showFindModal() {
  findModal.classList.add('on');
  if (imWaiting) {
    findModalMessage.textContent = 'You are waiting for an opponent. Others can join you, or pick one below.';
    createWaitingBtn.style.display = 'none';
  } else {
    findModalMessage.textContent = 'Players waiting for an opponent:';
    createWaitingBtn.style.display = '';
  }
}
function hideFindModal() { findModal.classList.remove('on'); }

waitingPlayersListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.waiting-row');
  if (!row) return;
  if (row.dataset.self) return;
  const partnerSid = row.dataset.sid;
  if (!partnerSid) return;
  socket.emit('joinWaitingGame', { sid: partnerSid });
});

createWaitingBtn.addEventListener('click', () => {
  socket.emit('createWaitingGame');
});

findModalCloseBtn.addEventListener('click', () => {
  hideFindModal();
  if (imWaiting) {
    socket.emit('cancelWaiting');
  }
});

const endModal = document.getElementById('endModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalSub = document.getElementById('modalSub');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalNewGameBtn = document.getElementById('modalNewGameBtn');
const modalRematchBtn = document.getElementById('modalRematchBtn');

let rematchRequestedByMe = false;

function showEndModal(message) {
  modalMessage.textContent = message;
  modalSub.textContent = '';
  modalRematchBtn.disabled = false;
  modalRematchBtn.textContent = 'Rematch';
  rematchRequestedByMe = false;
  endModal.classList.add('on');
}
function hideEndModal() { endModal.classList.remove('on'); }

const promoModal = document.getElementById('promoModal');
const promoChoices = document.getElementById('promoChoices');
let pendingPromotion = null;

function showPromotionPicker(from, to, color) {
  pendingPromotion = { from, to };
  const c = color === 'w' ? 'w' : 'b';
  const pieces = [['q','Queen'], ['r','Rook'], ['b','Bishop'], ['n','Knight']];
  promoChoices.innerHTML = pieces.map(([p, label]) => `
    <button class="promo-btn" data-piece="${p}" aria-label="${label}" title="${label}">
      <img src="/static/img/chesspieces/wikipedia/${c}${p.toUpperCase()}.png" alt="${label}" />
    </button>
  `).join('');
  promoModal.classList.add('on');
}

function hidePromotionPicker() {
  pendingPromotion = null;
  promoModal.classList.remove('on');
}

promoChoices.addEventListener('click', (e) => {
  const btn = e.target.closest('.promo-btn');
  if (!btn || !pendingPromotion) return;
  const piece = btn.dataset.piece;
  const { from, to } = pendingPromotion;
  hidePromotionPicker();

  const legal = chess.moves({ square: from, verbose: true })
    .find(m => m.to === to && m.promotion === piece);
  if (!legal) {
    if (board) board.position(chess.fen());
    return;
  }

  if (legal.captured) {
    awaitingCapture = true;
    socket.emit('move', { from, to, promotion: piece });
    return;
  }

  let move;
  try {
    move = chess.move({ from, to, promotion: piece });
  } catch (_) {
    move = null;
  }
  if (!move) {
    if (board) board.position(chess.fen());
    return;
  }
  socket.emit('move', { from, to, promotion: piece });
  if (board) board.position(chess.fen());
  highlightActiveTurn();
});

function hideDrawPrompt() { drawPrompt.style.display = 'none'; }
function showDrawPrompt(text, withButtons) {
  drawPromptText.textContent = text;
  drawAcceptBtn.style.display = withButtons ? '' : 'none';
  drawDeclineBtn.style.display = withButtons ? '' : 'none';
  drawPrompt.style.display = '';
}

let chess = new Chess();
let board = null;
let myColor = null;
let gameActive = false;
let currentPieces = {};
function refreshPreviewPieces() {
  if (!gameActive) currentPieces = buildPreviewPieces();
}

const PIECE_BASE = {
  p: { hp: 10, dmg: 10 },
  n: { hp: 10, dmg: 10 },
  b: { hp: 10, dmg: 10 },
  r: { hp: 10, dmg: 10 },
  q: { hp: 10, dmg: 10 },
  k: { hp: 10, dmg: 1000000 },
};
const PIECE_LEVEL_MULT = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 1 };
const HP_TO_DMG_INC_RATIO = 1.5;
function pieceStats(type, level) {
  const base = PIECE_BASE[type];
  const mult = PIECE_LEVEL_MULT[type];
  const incDmg = base.dmg * mult;
  const incHp = Math.floor(incDmg * HP_TO_DMG_INC_RATIO);
  return {
    hp: base.hp + (level - 1) * incHp,
    dmg: base.dmg + (level - 1) * incDmg,
  };
}
const SLOT_DEFS = [
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
const TYPE_NAME = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

const DEFAULT_UPGRADE_COSTS = { p: 1, n: 3, b: 3, r: 5, q: 8 };
const MAX_LEVEL = 99;

function clampLevel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  if (v > MAX_LEVEL) return MAX_LEVEL;
  return v;
}

function emptyLevels() {
  const out = {};
  for (const { slot } of SLOT_DEFS) out[slot] = 1;
  return out;
}

let myLevels = { w: emptyLevels(), b: emptyLevels() };
let upgradeCosts = { ...DEFAULT_UPGRADE_COSTS };
let myTokens = { w: 0, b: 0 };
let pendingUpgrade = null;
let activeSide = 'w';
let altMode = false;

const SLOT_TO_W_SQUARE = {
  Ra:'a1', Nb:'b1', Bc:'c1', Q:'d1', K:'e1', Bf:'f1', Ng:'g1', Rh:'h1',
  Pa:'a2', Pb:'b2', Pc:'c2', Pd:'d2', Pe:'e2', Pf:'f2', Pg:'g2', Ph:'h2',
};
function buildPreviewPieces() {
  const pieces = {};
  for (const { slot, type } of SLOT_DEFS) {
    const wSq = SLOT_TO_W_SQUARE[slot];
    const bSq = wSq[0] + (wSq[1] === '1' ? '8' : '7');
    const wLvl = clampLevel(myLevels.w[slot] ?? 1);
    const bLvl = clampLevel(myLevels.b[slot] ?? 1);
    const wStats = pieceStats(type, wLvl);
    const bStats = pieceStats(type, bLvl);
    pieces[wSq] = { id: 'w'+slot, type, color: 'w', level: wLvl, hp: wStats.hp, dmg: wStats.dmg };
    pieces[bSq] = { id: 'b'+slot, type, color: 'b', level: bLvl, hp: bStats.hp, dmg: bStats.dmg };
  }
  return pieces;
}

const setupGrid = document.getElementById('setupGrid');
const setupSection = document.getElementById('setup');
const setupStatusEl = document.getElementById('setupStatus');
const statsSection = document.getElementById('stats');
const statsListEl = document.getElementById('statsList');

function affordableTokens() {
  return activeSide === 'w' ? myTokens.w : myTokens.b;
}

function renderSetup() {
  const sideLevels = myLevels[activeSide];
  const pawns = SLOT_DEFS.filter(s => s.type === 'p');
  const back = SLOT_DEFS.filter(s => s.type !== 'p');
  const ordered = activeSide === 'b'
    ? [...pawns.slice().reverse(), ...back.slice().reverse()]
    : [...pawns, ...back];
  const rankFor = (type) => activeSide === 'w'
    ? (type === 'p' ? '2' : '1')
    : (type === 'p' ? '7' : '8');
  const tokens = affordableTokens();
  setupGrid.classList.toggle('alt-mode', altMode);
  setupGrid.innerHTML = ordered.map(({ slot, type, file }) => {
    const label = file + rankFor(type);
    const isKing = type === 'k';
    if (isKing) sideLevels[slot] = 1;
    const level = sideLevels[slot] ?? 1;
    const baseCost = upgradeCosts[type];
    const cost = baseCost != null ? baseCost * level : null;
    const atMax = level >= MAX_LEVEL;
    const atMin = level <= 1;
    const isPending = pendingUpgrade && pendingUpgrade.side === activeSide && pendingUpgrade.slot === slot;
    const canAfford = !isKing && !atMax && cost != null && tokens >= cost;
    const sideWord = activeSide === 'w' ? 'white' : 'black';

    let action, btnLabel, title, disabled, btnClass;
    if (isKing) {
      action = 'none';
      btnLabel = 'King';
      title = altMode ? 'The king cannot be downgraded.' : 'The king cannot be upgraded.';
      disabled = true;
      btnClass = altMode ? 'downgrade-btn' : 'upgrade-btn';
    } else if (altMode) {
      const refund = !atMin && baseCost != null ? Math.floor(baseCost * (level - 1) / 2) : null;
      action = 'downgrade';
      disabled = atMin || isPending;
      btnLabel = isPending ? '…' : `<span class="arrow">▼</span>${refund != null ? ` ${refund}` : ''}`;
      title = atMin
        ? 'Already at level 1.'
        : `Refund ${refund} ${sideWord} token${refund === 1 ? '' : 's'} (level ${level} → ${level - 1}).`;
      btnClass = 'downgrade-btn';
    } else {
      action = 'upgrade';
      disabled = atMax || !canAfford || isPending;
      btnLabel = atMax ? 'Max' : isPending ? '…' : `<span class="arrow">▲</span> ${cost}`;
      title = atMax
        ? 'Already at max level.'
        : canAfford
          ? `Spend ${cost} ${sideWord} token${cost === 1 ? '' : 's'} to reach level ${level + 1}.`
          : `Need ${cost} ${sideWord} token${cost === 1 ? '' : 's'} (you have ${tokens}).`;
      btnClass = 'upgrade-btn';
    }

    return `
      <div class="setup-cell${isKing ? ' locked' : ''}">
        <img src="/static/img/chesspieces/wikipedia/${activeSide}${TYPE_NAME[type]}.png" alt="${type}" />
        <div class="slot-label">${label}</div>
        <div class="slot-level">Lv ${level}</div>
        <button type="button" class="action-btn ${btnClass}" data-slot="${slot}" data-action="${action}" ${disabled ? 'disabled' : ''} title="${title}">${btnLabel}</button>
      </div>
    `;
  }).join('');
}

setupGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.action-btn');
  if (!btn || btn.disabled) return;
  const slot = btn.dataset.slot;
  const action = btn.dataset.action;
  if (!slot || (action !== 'upgrade' && action !== 'downgrade')) return;
  if (!isAuthenticated) {
    alert('Sign in to upgrade pieces.');
    return;
  }
  pendingUpgrade = { side: activeSide, slot };
  renderSetup();
  socket.emit(action === 'downgrade' ? 'downgradePiece' : 'upgradePiece', { color: activeSide, slot });
});

function setAltMode(on) {
  if (altMode === on) return;
  altMode = on;
  renderSetup();
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') setAltMode(true);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') setAltMode(false);
});
window.addEventListener('blur', () => setAltMode(false));

document.querySelectorAll('.setup-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const side = btn.dataset.side;
    if (side !== 'w' && side !== 'b') return;
    activeSide = side;
    document.querySelectorAll('.setup-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.side === activeSide);
    });
    renderSetup();
    if (!gameActive && board && typeof board.orientation === 'function') {
      board.orientation(activeSide === 'b' ? 'black' : 'white');
    }
  });
});
renderSetup();
refreshPreviewPieces();

function showSetup(show) { setupSection.style.display = show ? '' : 'none'; }
function showStats(show) { statsSection.classList.toggle('on', show); }

const tooltipEl = document.getElementById('pieceTooltip');
const TYPE_FULL = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

function squareFromElement(el) {
  while (el && el.nodeType === 1) {
    if (el.hasAttribute && el.hasAttribute('data-square')) {
      const v = el.getAttribute('data-square');
      if (/^[a-h][1-8]$/.test(v)) return v;
    }
    const cn = typeof el.className === 'string' ? el.className : '';
    const m = cn.match(/\bsquare-([a-h][1-8])\b/);
    if (m) return m[1];
    el = el.parentElement;
  }
  return null;
}

function squareAtPoint(x, y) {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const sq = squareFromElement(el);
    if (sq) return sq;
  }
  return null;
}

function showTooltipFor(square, x, y) {
  const piece = currentPieces[square];
  if (!piece) { hideTooltip(); return; }
  const colorName = piece.color === 'w' ? 'White' : 'Black';
  tooltipEl.innerHTML = `
    <div class="tt-row"><strong>${colorName} ${TYPE_FULL[piece.type]}</strong> <span style="color:#aaa">${square}</span></div>
    <div class="tt-row">
      <span class="tt-lvl">Lv ${piece.level}</span>
      <span class="tt-hp">${piece.hp} HP</span>
      <span class="tt-dmg">${piece.dmg} DMG</span>
    </div>
  `;
  tooltipEl.classList.add('on');
  const pad = 14;
  const rect = tooltipEl.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 4) left = x - pad - rect.width;
  if (top + rect.height > window.innerHeight - 4) top = y - pad - rect.height;
  tooltipEl.style.left = left + 'px';
  tooltipEl.style.top = top + 'px';
}
function hideTooltip() { tooltipEl.classList.remove('on'); }

const boardEl = document.getElementById('board');
let lastTooltipSquare = null;
function handleHover(e) {
  const rect = boardEl.getBoundingClientRect();
  const insideBoard =
    e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (!insideBoard) {
    lastTooltipSquare = null;
    hideTooltip();
    return;
  }
  let sq = squareFromElement(e.target);
  if (!sq) sq = squareAtPoint(e.clientX, e.clientY);
  if (!sq || !currentPieces[sq]) {
    lastTooltipSquare = null;
    hideTooltip();
    return;
  }
  lastTooltipSquare = sq;
  showTooltipFor(sq, e.clientX, e.clientY);
}
document.addEventListener('mousemove', handleHover);
document.addEventListener('mouseover', handleHover);

function renderStats() {
  if (!myColor) { statsListEl.innerHTML = ''; return; }
  const mine = Object.entries(currentPieces)
    .filter(([, p]) => p.color === myColor)
    .sort(([sqA, a], [sqB, b]) => {
      const order = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 };
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return sqA.localeCompare(sqB);
    });
  statsListEl.innerHTML = mine.map(([sq, p]) => `
    <div class="row">
      <img src="/static/img/chesspieces/wikipedia/${p.color}${TYPE_NAME[p.type]}.png" alt="${p.type}" />
      <span class="sq">${sq}</span>
      <span class="lvl">L${p.level}</span>
      <span class="hp">${p.hp}hp</span>
      <span class="dmg">${p.dmg}dmg</span>
    </div>
  `).join('');
}

const PIECE_IMG = (color, type) => `/static/img/chesspieces/wikipedia/${color}${TYPE_NAME[type]}.png`;

function getSquareEl(square) {
  return boardEl.querySelector(`.square-${square}`)
      || boardEl.querySelector(`[data-square="${square}"]`);
}

const FIGHT_CLASH_MS = 500;
const FIGHT_FLY_MS = 850;

function hideRealPieceAt(square) {
  let restored = false;
  let pieceEl = null;
  let intervalId = null;
  let attempts = 0;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (pieceEl) pieceEl.style.visibility = '';
  };
  const tryHide = () => {
    if (restored || pieceEl) return;
    const sq = getSquareEl(square);
    const found = sq && sq.querySelector('img');
    if (found) {
      pieceEl = found;
      pieceEl.style.visibility = 'hidden';
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    } else if (++attempts >= 30) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }
  };
  tryHide();
  if (!pieceEl) intervalId = setInterval(tryHide, 40);
  return restore;
}

let currentDuel = null;
let awaitingCapture = false;

function playCaptureAnimation({
  capturedSquare, attackerSquare, isEnPassant,
  attackerType, attackerColor, defenderType, defenderColor,
  attackerHp, defenderHp, initialTurn, localRole, onStrike,
}) {
  const sqEl = getSquareEl(capturedSquare);
  if (!sqEl) return null;
  const rect = sqEl.getBoundingClientRect();
  const size = rect.width;
  if (!size) return null;

  const overlay = document.createElement('div');
  overlay.className = 'fight-overlay';
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = size + 'px';
  overlay.style.height = size + 'px';

  const flash = document.createElement('div');
  flash.className = 'fight-flash';
  overlay.appendChild(flash);

  let atk = null;
  let atkHpEl = null;
  if (attackerType && attackerColor) {
    atk = document.createElement('img');
    atk.src = PIECE_IMG(attackerColor, attackerType);
    atk.alt = '';
    atk.draggable = false;
    atk.className = 'fight-attacker';
    overlay.appendChild(atk);

    atkHpEl = document.createElement('div');
    atkHpEl.className = 'fight-hp fight-hp--attacker';
    atkHpEl.textContent = attackerHp;
    overlay.appendChild(atkHpEl);
  }

  const def = document.createElement('img');
  def.src = PIECE_IMG(defenderColor, defenderType);
  def.alt = '';
  def.draggable = false;
  def.className = 'fight-defender';

  const sign = Math.random() < 0.5 ? -1 : 1;
  const dx = sign * (size * 4 + Math.random() * size * 3);
  const dy = -size * 3 - Math.random() * size * 3;
  const rot = Math.random() * 720 - 360;
  def.style.setProperty('--fly-x', dx + 'px');
  def.style.setProperty('--fly-y', dy + 'px');
  def.style.setProperty('--fly-rot', rot + 'deg');

  overlay.appendChild(def);

  const defHpEl = document.createElement('div');
  defHpEl.className = 'fight-hp fight-hp--defender';
  defHpEl.textContent = defenderHp;
  overlay.appendChild(defHpEl);

  const btn = document.createElement('button');
  btn.className = 'fight-resolve-btn';
  btn.type = 'button';
  btn.textContent = 'Strike!';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    if (onStrike) onStrike();
  });
  overlay.appendChild(btn);

  const waitingLabel = document.createElement('div');
  waitingLabel.className = 'fight-waiting';
  waitingLabel.textContent = 'Waiting…';
  overlay.appendChild(waitingLabel);

  document.body.appendChild(overlay);

  let restoreReal = null;
  if (!isEnPassant && attackerSquare) {
    restoreReal = hideRealPieceAt(attackerSquare);
  }

  const update = ({ attackerHp: aHp, defenderHp: dHp, turn }) => {
    if (atkHpEl && aHp != null) atkHpEl.textContent = aHp;
    if (dHp != null) defHpEl.textContent = dHp;
    const myTurn = turn === localRole;
    btn.style.display = myTurn ? '' : 'none';
    btn.disabled = !myTurn;
    waitingLabel.style.display = myTurn ? 'none' : '';
  };
  update({ attackerHp, defenderHp, turn: initialTurn });

  let resolved = false;
  const resolve = (loser = 'defender') => {
    if (resolved) return;
    resolved = true;
    btn.remove();
    waitingLabel.remove();
    if (loser === 'attacker') {
      def.style.visibility = 'hidden';
      if (defHpEl) defHpEl.style.visibility = 'hidden';
      if (atk) {
        const sign2 = Math.random() < 0.5 ? -1 : 1;
        const dx2 = sign2 * (size * 4 + Math.random() * size * 3);
        const dy2 = -size * 3 - Math.random() * size * 3;
        const rot2 = Math.random() * 720 - 360;
        atk.style.setProperty('--fly-x', dx2 + 'px');
        atk.style.setProperty('--fly-y', dy2 + 'px');
        atk.style.setProperty('--fly-rot', rot2 + 'deg');
        atk.classList.add('fight-fly');
      }
      if (atkHpEl) atkHpEl.remove();
    } else {
      if (atk) atk.remove();
      if (atkHpEl) atkHpEl.remove();
      if (restoreReal) restoreReal();
      def.classList.add('fight-fly');
      if (defHpEl) defHpEl.remove();
    }
    setTimeout(() => overlay.remove(), FIGHT_FLY_MS + 80);
  };

  return { resolve, update };
}



function onDragStart(_source, piece) {
  if (!gameActive) return false;
  if (chess.isGameOver()) return false;
  if (awaitingCapture) return false;
  if ((myColor === 'w' && piece.startsWith('b')) ||
      (myColor === 'b' && piece.startsWith('w'))) return false;
  if (chess.turn() !== myColor) return false;
}

function isPromotionMove(source, target) {
  const piece = chess.get(source);
  if (!piece || piece.type !== 'p') return false;
  if (piece.color === 'w' && target[1] !== '8') return false;
  if (piece.color === 'b' && target[1] !== '1') return false;
  return chess.moves({ square: source, verbose: true })
    .some(m => m.to === target && m.promotion);
}

function onDrop(source, target) {
  if (isPromotionMove(source, target)) {
    const color = chess.get(source).color;
    showPromotionPicker(source, target, color);
    return;
  }

  const targetPiece = currentPieces[target];
  const moverPiece = currentPieces[source];
  const isKingAttack = !!(
    targetPiece && moverPiece &&
    targetPiece.type === 'k' && targetPiece.color !== moverPiece.color
  );

  const legal = chess.moves({ square: source, verbose: true })
    .find(m => m.to === target);
  if (!legal && !isKingAttack) return 'snapback';
  if (isKingAttack) {
    awaitingCapture = true;
    socket.emit('move', { from: source, to: target });
    return 'snapback';
  }

  if (legal.captured) {
    awaitingCapture = true;
    socket.emit('move', { from: source, to: target });
    return;
  }

  let move;
  try {
    move = chess.move({ from: source, to: target, promotion: 'q' });
  } catch (_) {
    move = null;
  }
  if (!move) return 'snapback';

  socket.emit('move', { from: source, to: target });
  highlightActiveTurn();
}

function onSnapEnd() {
  board.position(chess.fen());
}

function startBoard(fen, color) {
  myColor = color === 'white' ? 'w' : 'b';
  chess = new Chess(fen);
  if (board) board.destroy();
  board = Chessboard('board', {
    draggable: true,
    position: fen,
    orientation: color,
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
    onDragStart,
    onDrop,
    onSnapEnd,
  });
  gameActive = true;
  findBtn.disabled = true;
  resignBtn.disabled = false;
  drawBtn.disabled = false;
  drawBtn.textContent = 'Offer Draw';
  hideDrawPrompt();
  showSetup(false);
  showStats(true);
  renderStats();
  highlightActiveTurn();
}

function endGame(payload) {
  gameActive = false;
  findBtn.disabled = !isAuthenticated;
  hidePlayerCards();
  resignBtn.disabled = true;
  drawBtn.disabled = true;
  drawBtn.textContent = 'Offer Draw';
  hideDrawPrompt();
  hidePromotionPicker();
  showSetup(true);
  showStats(false);
  refreshPreviewPieces();
  if (board && typeof board.orientation === 'function') {
    board.orientation(activeSide === 'b' ? 'black' : 'white');
  }
  let msg;
  switch (payload.type) {
    case 'checkmate': msg = `Checkmate. ${payload.winner} wins.`; break;
    case 'kingDeath': msg = `The king fell in battle. ${payload.winner} wins.`; break;
    case 'resign':    msg = `${payload.winner} wins by resignation.`; break;
    case 'disconnect': msg = `Opponent disconnected. ${payload.winner} wins.`; break;
    case 'agreement': msg = 'Draw by agreement.'; break;
    case 'stalemate': msg = 'Draw by stalemate.'; break;
    case 'threefold': msg = 'Draw by threefold repetition.'; break;
    case 'insufficient': msg = 'Draw by insufficient material.'; break;
    case 'draw': msg = 'Draw.'; break;
    default: msg = 'Game over.';
  }
  showEndModal(msg);
  if (payload.type === 'disconnect') {
    modalRematchBtn.disabled = true;
    modalSub.textContent = 'Opponent left — rematch unavailable.';
  }
}

findBtn.addEventListener('click', () => {
  if (!isAuthenticated) {
    alert('Please sign in with Google first.');
    return;
  }
  socket.emit('findGame');
});

socket.on('authenticated', ({ name, picture }) => {
  isAuthenticated = true;
  myName = name;
  userNameEl.textContent = name;
  if (picture) {
    userAvatarEl.src = picture;
    userAvatarEl.style.display = '';
  } else {
    userAvatarEl.style.display = 'none';
  }
  userBadge.style.display = '';
  if (signInDiv) signInDiv.style.display = 'none';
  if (!gameActive) findBtn.disabled = false;
  if (setupStatusEl) setupStatusEl.textContent = 'Loading your upgrades…';
  socket.emit('fetchLevels');
  socket.emit('fetchCurrency');
});

socket.on('authError', ({ reason }) => {
  alert(`Sign-in failed: ${reason}`);
  isAuthenticated = false;
  findBtn.disabled = true;
});

signOutBtn.addEventListener('click', async () => {
  setUserMenuOpen(false);
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* ignore network failure; UI signs out either way */ }
  isAuthenticated = false;
  myName = null;
  userBadge.style.display = 'none';
  userNameEl.textContent = '';
  userAvatarEl.removeAttribute('src');
  if (signInDiv) signInDiv.style.display = '';
  findBtn.disabled = true;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  socket.disconnect();
  socket.connect();
});

socket.on('signedOut', () => {
  isAuthenticated = false;
  myName = null;
  userBadge.style.display = 'none';
  userNameEl.textContent = '';
  userAvatarEl.removeAttribute('src');
  if (signInDiv) signInDiv.style.display = '';
  findBtn.disabled = true;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
});

socket.on('levelsData', ({ levels, costs }) => {
  if (levels && typeof levels === 'object') {
    for (const side of ['w', 'b']) {
      const src = levels[side] || {};
      for (const { slot } of SLOT_DEFS) {
        myLevels[side][slot] = clampLevel(src[slot] ?? 1);
      }
    }
  }
  if (costs && typeof costs === 'object') {
    upgradeCosts = { ...DEFAULT_UPGRADE_COSTS, ...costs };
  }
  if (setupStatusEl) setupStatusEl.textContent = 'Upgrades are stored on your account.';
  renderSetup();
  refreshPreviewPieces();
});

socket.on('levelsError', ({ reason }) => {
  if (setupStatusEl) setupStatusEl.textContent = `Could not load upgrades: ${reason}`;
});

socket.on('upgraded', ({ color, slot, level }) => {
  if (color === 'w' || color === 'b') {
    myLevels[color][slot] = clampLevel(level);
  }
  if (pendingUpgrade && pendingUpgrade.side === color && pendingUpgrade.slot === slot) {
    pendingUpgrade = null;
  }
  renderSetup();
  refreshPreviewPieces();
});

socket.on('upgradeError', ({ reason }) => {
  pendingUpgrade = null;
  alert(`Upgrade failed: ${reason}`);
  renderSetup();
});

resignBtn.addEventListener('click', () => {
  if (!gameActive) return;
  if (!confirm('Resign this game?')) return;
  socket.emit('resign');
});

drawBtn.addEventListener('click', () => {
  if (!gameActive) return;
  socket.emit('offerDraw');
});

drawAcceptBtn.addEventListener('click', () => {
  socket.emit('acceptDraw');
  hideDrawPrompt();
});

drawDeclineBtn.addEventListener('click', () => {
  socket.emit('declineDraw');
  hideDrawPrompt();
});

socket.on('waiting', () => {
  imWaiting = true;
  showFindModal();
});

socket.on('waitingList', ({ players }) => {
  renderWaitingList(players || []);
  showFindModal();
});

socket.on('waitingListUpdate', ({ players }) => {
  if (!findModal.classList.contains('on')) return;
  renderWaitingList(players || []);
});

socket.on('waitingCancelled', () => {
  imWaiting = false;
});

socket.on('joinFailed', ({ reason }) => {
  alert(reason || 'Could not join that game.');
});

socket.on('paired', ({ color, fen, pieces, you, opponent, yourPicture, opponentPicture }) => {
  imWaiting = false;
  hideEndModal();
  hideFindModal();
  const youLabel = you || myName || 'You';
  const oppLabel = opponent || 'Opponent';
  const youColor = color === 'white' ? 'White' : 'Black';
  const oppColor = color === 'white' ? 'Black' : 'White';
  const meCode = color === 'white' ? 'w' : 'b';
  const oppCode = meCode === 'w' ? 'b' : 'w';
  setPlayerCard('top', oppLabel, opponentPicture, oppColor, oppCode);
  setPlayerCard('bottom', youLabel, yourPicture, youColor, meCode);
  currentPieces = pieces || {};
  startBoard(fen, color);
});

socket.on('captureWindow', ({
  from, to, attackerColor, defenderSquare,
  attackerHp, defenderHp, turn,
}) => {
  const localIsAttacker = attackerColor === myColor;

  // Opponent's chessboard hasn't moved the attacker yet; do a visual-only move.
  if (!localIsAttacker && board) {
    board.move(`${from}-${to}`);
  }

  const mover = currentPieces[from];
  const capturedSquare = defenderSquare || to;
  const isEP = capturedSquare !== to;
  const defender = currentPieces[capturedSquare];
  if (!mover || !defender) return;

  if (currentDuel) {
    const prev = currentDuel;
    currentDuel = null;
    prev.resolve();
  }
  currentDuel = playCaptureAnimation({
    capturedSquare,
    attackerSquare: to,
    isEnPassant: isEP,
    attackerType: mover.type,
    attackerColor: mover.color,
    defenderType: defender.type,
    defenderColor: defender.color,
    attackerHp,
    defenderHp,
    initialTurn: turn || 'attacker',
    localRole: localIsAttacker ? 'attacker' : 'defender',
    onStrike: () => socket.emit('duelStrike'),
  });
});

socket.on('duelUpdate', ({ attackerHp, defenderHp, turn }) => {
  if (currentDuel) currentDuel.update({ attackerHp, defenderHp, turn });
});

let enPassantToastTimer = null;
function showEnPassantToast() {
  const el = document.getElementById('enPassantToast');
  if (!el) return;
  el.classList.add('on');
  if (enPassantToastTimer) clearTimeout(enPassantToastTimer);
  enPassantToastTimer = setTimeout(() => {
    el.classList.remove('on');
    enPassantToastTimer = null;
  }, 6000);
}

socket.on('moveMade', ({ from, to, promotion, fen, pieces, combat, is_en_passant }) => {
  if (is_en_passant) showEnPassantToast();
  if (pieces) currentPieces = pieces;
  const attackerDied = combat && !combat.attacker_survived;
  if (chess.fen() !== fen) {
    if (attackerDied) {
      try { chess.load(fen); } catch (_) {}
    } else {
      try {
        chess.move({ from, to, promotion: promotion || 'q' });
      } catch (_) {
        try { chess.load(fen); } catch (_) {}
      }
    }
  }
  if (board) board.position(chess.fen());
  renderStats();
  highlightActiveTurn();

  awaitingCapture = false;
  if (currentDuel) {
    const d = currentDuel;
    currentDuel = null;
    d.resolve(attackerDied ? 'attacker' : 'defender');
  }
});

socket.on('illegalMove', ({ reason }) => {
  alert(`Move rejected: ${reason}`);
  awaitingCapture = false;
  if (board) board.position(chess.fen());
});

socket.on('drawOfferSent', () => {
  drawBtn.disabled = true;
  drawBtn.textContent = 'Draw offered';
});

socket.on('drawOffered', () => {
  showDrawPrompt('Opponent offers a draw.', true);
});

socket.on('drawDeclined', () => {
  drawBtn.disabled = false;
  drawBtn.textContent = 'Offer Draw';
  showDrawPrompt('Draw offer declined.', false);
  setTimeout(hideDrawPrompt, 2500);
});

socket.on('drawOfferCleared', () => {
  drawBtn.disabled = false;
  drawBtn.textContent = 'Offer Draw';
  hideDrawPrompt();
});

socket.on('gameOver', endGame);

modalCloseBtn.addEventListener('click', () => {
  hideEndModal();
  if (rematchRequestedByMe) {
    socket.emit('cancelRematch');
    rematchRequestedByMe = false;
  }
});

modalNewGameBtn.addEventListener('click', () => {
  hideEndModal();
  rematchRequestedByMe = false;
  socket.emit('findGame');
});

modalRematchBtn.addEventListener('click', () => {
  if (modalRematchBtn.disabled) return;
  rematchRequestedByMe = true;
  modalRematchBtn.disabled = true;
  modalRematchBtn.textContent = 'Rematch requested';
  modalSub.textContent = 'Waiting for opponent…';
  socket.emit('requestRematch');
});

socket.on('rematchRequested', () => {
  if (!endModal.classList.contains('on')) return;
  modalSub.textContent = 'Opponent wants a rematch.';
  modalRematchBtn.textContent = 'Accept Rematch';
});

socket.on('rematchPending', () => {
  modalSub.textContent = 'Waiting for opponent…';
});

socket.on('rematchUnavailable', () => {
  if (!endModal.classList.contains('on')) return;
  modalRematchBtn.disabled = true;
  modalRematchBtn.textContent = 'Rematch';
  modalSub.textContent = 'Opponent left — rematch unavailable.';
  rematchRequestedByMe = false;
});

const refreshCurrencyBtn = document.getElementById('refreshCurrencyBtn');
const whiteTokensEl = document.getElementById('whiteTokens');
const blackTokensEl = document.getElementById('blackTokens');
const energyEl = document.getElementById('energy');

refreshCurrencyBtn.addEventListener('click', () => {
  socket.emit('fetchCurrency');
});

socket.on('currencyData', (data) => {
  if (!data.found) {
    whiteTokensEl.textContent = '0';
    blackTokensEl.textContent = '0';
    energyEl.textContent = '0';
    myTokens = { w: 0, b: 0 };
    renderSetup();
    return;
  }
  whiteTokensEl.textContent = data.whiteTokens;
  blackTokensEl.textContent = data.blackTokens;
  energyEl.textContent = data.energy;
  myTokens = { w: data.whiteTokens, b: data.blackTokens };
  renderSetup();
});

socket.on('currencyError', ({ reason }) => {
  alert(`Currency fetch failed: ${reason}`);
});

socket.on('disconnect', () => {
  gameActive = false;
  isAuthenticated = false;
  imWaiting = false;
  findBtn.disabled = true;
  resignBtn.disabled = true;
  drawBtn.disabled = true;
  hidePlayerCards();
  hideFindModal();
});

board = Chessboard('board', {
  draggable: false,
  position: 'start',
  pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
});
