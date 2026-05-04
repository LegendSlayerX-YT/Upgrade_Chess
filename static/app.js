import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';
const socket = io();

let isAuthenticated = false;
let myName = null;

window.handleCredentialResponse = (response) => {
  if (!response || !response.credential) return;
  socket.emit('authenticate', { credential: response.credential });
};

const userBadge = document.getElementById('userBadge');
const userNameEl = document.getElementById('userName');
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

function setPlayerCard(side, name, picture, colorLabel) {
  const isTop = side === 'top';
  const avatar = isTop ? playerTopAvatar : playerBottomAvatar;
  const nameEl = isTop ? playerTopName : playerBottomName;
  const colorEl = isTop ? playerTopColor : playerBottomColor;
  const card = isTop ? playerTopEl : playerBottomEl;
  avatar.src = picture || FALLBACK_AVATAR;
  avatar.onerror = () => { avatar.onerror = null; avatar.src = FALLBACK_AVATAR; };
  nameEl.textContent = name;
  colorEl.textContent = colorLabel;
  card.style.visibility = 'visible';
}

function hidePlayerCards() {
  playerTopEl.style.visibility = 'hidden';
  playerBottomEl.style.visibility = 'hidden';
}

const statusEl = document.getElementById('status');
const historyEl = document.getElementById('history');
const findBtn = document.getElementById('findBtn');
const resignBtn = document.getElementById('resignBtn');
const drawBtn = document.getElementById('drawBtn');
const drawPrompt = document.getElementById('drawPrompt');
const drawPromptText = document.getElementById('drawPromptText');
const drawAcceptBtn = document.getElementById('drawAcceptBtn');
const drawDeclineBtn = document.getElementById('drawDeclineBtn');

const waitingEl = document.getElementById('waiting');
function showWaiting() { waitingEl.classList.add('on'); }
function hideWaiting() { waitingEl.classList.remove('on'); }

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
  renderHistory();
  updateStatus();
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
  k: { hp: 10, dmg: 10 },
};
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
const LEVEL_STORAGE_KEY_V1 = 'chessrpg.levels.v1';
const LEVEL_STORAGE_KEY = 'chessrpg.levels.v2';

function clampLevel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  if (v > 99) return 99;
  return v;
}

function emptyLevels() {
  const out = {};
  for (const { slot } of SLOT_DEFS) out[slot] = 1;
  return out;
}

function loadLevels() {
  try {
    const raw = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const out = { w: emptyLevels(), b: emptyLevels() };
      for (const side of ['w', 'b']) {
        for (const { slot } of SLOT_DEFS) {
          out[side][slot] = clampLevel(parsed?.[side]?.[slot] ?? 1);
        }
      }
      return out;
    }
    const legacy = localStorage.getItem(LEVEL_STORAGE_KEY_V1);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const same = {};
      for (const { slot } of SLOT_DEFS) same[slot] = clampLevel(parsed?.[slot] ?? 1);
      return { w: { ...same }, b: { ...same } };
    }
  } catch (_) {}
  return { w: emptyLevels(), b: emptyLevels() };
}

function saveLevels(levels) {
  try { localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify(levels)); } catch (_) {}
}

let myLevels = loadLevels();
let activeSide = 'w';

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
    const base = PIECE_BASE[type];
    pieces[wSq] = { id: 'w'+slot, type, color: 'w', level: wLvl, hp: base.hp*wLvl, dmg: base.dmg*wLvl };
    pieces[bSq] = { id: 'b'+slot, type, color: 'b', level: bLvl, hp: base.hp*bLvl, dmg: base.dmg*bLvl };
  }
  return pieces;
}

const setupGrid = document.getElementById('setupGrid');
const setupSection = document.getElementById('setup');
const resetLevelsBtn = document.getElementById('resetLevelsBtn');
const statsSection = document.getElementById('stats');
const statsListEl = document.getElementById('statsList');

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
  setupGrid.innerHTML = ordered.map(({ slot, type, file }) => {
    const label = file + rankFor(type);
    return `
      <div class="setup-cell">
        <img src="/static/img/chesspieces/wikipedia/${activeSide}${TYPE_NAME[type]}.png" alt="${type}" />
        <div class="slot-label">${label}</div>
        <input type="number" min="1" max="99" data-slot="${slot}" value="${sideLevels[slot] ?? 1}" />
      </div>
    `;
  }).join('');
}

setupGrid.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  const slot = t.dataset.slot;
  if (!slot) return;
  myLevels[activeSide][slot] = clampLevel(t.value);
  saveLevels(myLevels);
  refreshPreviewPieces();
});
setupGrid.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  t.value = String(clampLevel(t.value));
});
resetLevelsBtn.addEventListener('click', () => {
  for (const { slot } of SLOT_DEFS) myLevels[activeSide][slot] = 1;
  saveLevels(myLevels);
  renderSetup();
  refreshPreviewPieces();
});
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

let pendingFightResolve = null;
let awaitingCapture = false;

function playCaptureAnimation({
  capturedSquare, attackerSquare, isEnPassant,
  attackerType, attackerColor, defenderType, defenderColor,
  mode, onStrike,
}) {
  const sqEl = getSquareEl(capturedSquare);
  if (!sqEl) return;
  const rect = sqEl.getBoundingClientRect();
  const size = rect.width;
  if (!size) return;

  const overlay = document.createElement('div');
  overlay.className = 'fight-overlay' + (isEnPassant ? ' fight-overlay--solo' : '');
  overlay.style.left = rect.left + 'px';
  overlay.style.top = rect.top + 'px';
  overlay.style.width = size + 'px';
  overlay.style.height = size + 'px';

  const flash = document.createElement('div');
  flash.className = 'fight-flash';
  overlay.appendChild(flash);

  let atk = null;
  if (!isEnPassant && attackerType && attackerColor) {
    atk = document.createElement('img');
    atk.src = PIECE_IMG(attackerColor, attackerType);
    atk.alt = '';
    atk.draggable = false;
    atk.className = 'fight-attacker';
    overlay.appendChild(atk);
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
  document.body.appendChild(overlay);

  // Hide the real chessboard.js attacker piece while we show the shrunk overlay
  // pair on the same square. (Skip for en passant — different squares.)
  let restoreReal = null;
  if (!isEnPassant && attackerSquare) {
    restoreReal = hideRealPieceAt(attackerSquare);
  }

  let resolved = false;
  const resolve = () => {
    if (resolved) return;
    resolved = true;
    if (atk) atk.remove();
    if (restoreReal) restoreReal();
    def.classList.add('fight-fly');
    setTimeout(() => overlay.remove(), FIGHT_FLY_MS + 80);
  };

  if (mode === 'manual') {
    const btn = document.createElement('button');
    btn.className = 'fight-resolve-btn';
    btn.type = 'button';
    btn.textContent = 'Strike!';
    btn.addEventListener('click', () => {
      btn.remove();
      if (onStrike) onStrike();
      resolve();
    });
    overlay.appendChild(btn);
  } else if (mode === 'wait') {
    // caller stores resolve and triggers it on remote signal
  } else {
    setTimeout(resolve, FIGHT_CLASH_MS);
  }
  return resolve;
}


function setStatus(msg) { statusEl.textContent = msg; }

function renderHistory() {
  const moves = chess.history();
  let out = '';
  for (let i = 0; i < moves.length; i += 2) {
    const num = (i / 2) + 1;
    out += `${num}. ${moves[i]}${moves[i + 1] ? ' ' + moves[i + 1] : ''}\n`;
  }
  historyEl.textContent = out;
}

function updateStatus() {
  if (!gameActive) return;
  const turn = chess.turn() === 'w' ? 'White' : 'Black';
  const me = myColor === 'w' ? 'White' : 'Black';
  let s = `You are ${me}. ${turn} to move.`;
  if (chess.inCheck()) s += ' Check!';
  setStatus(s);
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

  const legal = chess.moves({ square: source, verbose: true })
    .find(m => m.to === target);
  if (!legal) return 'snapback';

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
  renderHistory();
  updateStatus();
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
  renderHistory();
  updateStatus();
}

function endGame(payload) {
  gameActive = false;
  findBtn.disabled = !isAuthenticated;
  hidePlayerCards();
  resignBtn.disabled = true;
  drawBtn.disabled = true;
  drawBtn.textContent = 'Offer Draw';
  hideDrawPrompt();
  hideWaiting();
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
    case 'resign':    msg = `${payload.winner} wins by resignation.`; break;
    case 'disconnect': msg = `Opponent disconnected. ${payload.winner} wins.`; break;
    case 'agreement': msg = 'Draw by agreement.'; break;
    case 'stalemate': msg = 'Draw by stalemate.'; break;
    case 'threefold': msg = 'Draw by threefold repetition.'; break;
    case 'insufficient': msg = 'Draw by insufficient material.'; break;
    case 'draw': msg = 'Draw.'; break;
    default: msg = 'Game over.';
  }
  setStatus(msg);
  showEndModal(msg);
  if (payload.type === 'disconnect') {
    modalRematchBtn.disabled = true;
    modalSub.textContent = 'Opponent left — rematch unavailable.';
  }
}

findBtn.addEventListener('click', () => {
  if (!isAuthenticated) {
    setStatus('Please sign in with Google first.');
    return;
  }
  setStatus('Looking for an opponent…');
  findBtn.disabled = true;
  socket.emit('findGame', { levelsByColor: myLevels });
});

socket.on('authenticated', ({ name }) => {
  isAuthenticated = true;
  myName = name;
  userNameEl.textContent = name;
  userBadge.style.display = '';
  if (signInDiv) signInDiv.style.display = 'none';
  if (!gameActive) findBtn.disabled = false;
  setStatus(`Signed in as ${name}. Click Find Game.`);
});

socket.on('authError', ({ reason }) => {
  setStatus(`Sign-in failed: ${reason}`);
  isAuthenticated = false;
  findBtn.disabled = true;
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
  setStatus('Waiting for an opponent to join…');
  showWaiting();
});

socket.on('paired', ({ gameId, color, fen, pieces, you, opponent, yourPicture, opponentPicture }) => {
  hideWaiting();
  hideEndModal();
  const youLabel = you || myName || 'You';
  const oppLabel = opponent || 'Opponent';
  setStatus(`Paired! Game ${gameId}. You are ${color}. Playing against ${oppLabel}.`);
  const youColor = color === 'white' ? 'White' : 'Black';
  const oppColor = color === 'white' ? 'Black' : 'White';
  setPlayerCard('top', oppLabel, opponentPicture, oppColor);
  setPlayerCard('bottom', youLabel, yourPicture, youColor);
  currentPieces = pieces || {};
  startBoard(fen, color);
});

socket.on('captureWindow', ({ from, to, attackerColor }) => {
  const localIsAttacker = attackerColor === myColor;

  // Opponent's chessboard hasn't moved the attacker yet; do a visual-only move.
  if (!localIsAttacker && board) {
    board.move(`${from}-${to}`);
  }

  const mover = currentPieces[from];
  let capturedSquare = to;
  let defender = currentPieces[to];
  let isEP = false;
  if (mover && mover.type === 'p' && from[0] !== to[0] && !defender) {
    isEP = true;
    capturedSquare = to[0] + (mover.color === 'w' ? '5' : '4');
    defender = currentPieces[capturedSquare];
  }
  if (!mover || !defender) return;

  if (pendingFightResolve) {
    const prev = pendingFightResolve;
    pendingFightResolve = null;
    prev();
  }
  pendingFightResolve = playCaptureAnimation({
    capturedSquare,
    attackerSquare: to,
    isEnPassant: isEP,
    attackerType: mover.type,
    attackerColor: mover.color,
    defenderType: defender.type,
    defenderColor: defender.color,
    mode: localIsAttacker ? 'manual' : 'wait',
    onStrike: () => socket.emit('resolveCapture'),
  });
});

socket.on('moveMade', ({ from, to, promotion, fen, pieces }) => {
  if (pieces) currentPieces = pieces;
  if (chess.fen() !== fen) {
    try {
      chess.move({ from, to, promotion: promotion || 'q' });
    } catch (_) {
      chess.load(fen);
    }
  }
  if (board) board.position(chess.fen());
  renderHistory();
  renderStats();
  updateStatus();

  awaitingCapture = false;
  if (pendingFightResolve) {
    const r = pendingFightResolve;
    pendingFightResolve = null;
    r();
  }
});

socket.on('illegalMove', ({ reason }) => {
  setStatus(`Move rejected: ${reason}`);
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
  setStatus('Looking for an opponent…');
  findBtn.disabled = true;
  showWaiting();
  socket.emit('findGame', { levelsByColor: myLevels });
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

socket.on('disconnect', () => {
  setStatus('Disconnected from server.');
  gameActive = false;
  isAuthenticated = false;
  findBtn.disabled = true;
  resignBtn.disabled = true;
  drawBtn.disabled = true;
  hidePlayerCards();
  hideWaiting();
});

board = Chessboard('board', {
  draggable: false,
  position: 'start',
  pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
});
