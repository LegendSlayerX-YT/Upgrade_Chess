import { socket, state, FALLBACK_AVATAR, TYPE_FULL } from './state.js';

// ---------- Top toast ----------
let topToastTimer = null;
export function showTopToast(msg, ms = 2200) {
  const el = document.getElementById('topToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  if (topToastTimer) clearTimeout(topToastTimer);
  topToastTimer = setTimeout(() => {
    el.classList.remove('on');
    topToastTimer = null;
  }, ms);
}

let enPassantToastTimer = null;
export function showEnPassantToast() {
  const el = document.getElementById('enPassantToast');
  if (!el) return;
  el.classList.add('on');
  if (enPassantToastTimer) clearTimeout(enPassantToastTimer);
  enPassantToastTimer = setTimeout(() => {
    el.classList.remove('on');
    enPassantToastTimer = null;
  }, 6000);
}

// ---------- User menu ----------
const userBadge = document.getElementById('userBadge');
const userMenuBtn = document.getElementById('userMenuBtn');
const userMenu = document.getElementById('userMenu');

export function setUserMenuOpen(open) {
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

// ---------- Player cards ----------
const playerTopEl = document.getElementById('playerTop');
const playerBottomEl = document.getElementById('playerBottom');
const playerTopAvatar = document.getElementById('playerTopAvatar');
const playerBottomAvatar = document.getElementById('playerBottomAvatar');
const playerTopName = document.getElementById('playerTopName');
const playerBottomName = document.getElementById('playerBottomName');
const playerTopColor = document.getElementById('playerTopColor');
const playerBottomColor = document.getElementById('playerBottomColor');

export function setPlayerCard(side, name, picture, colorLabel, color) {
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

export function hidePlayerCards() {
  playerTopEl.style.visibility = 'hidden';
  playerBottomEl.style.visibility = 'hidden';
  playerTopEl.classList.remove('active-turn');
  playerBottomEl.classList.remove('active-turn');
}

export function highlightActiveTurn() {
  if (!state.gameActive) {
    playerTopEl.classList.remove('active-turn');
    playerBottomEl.classList.remove('active-turn');
    return;
  }
  const myTurn = state.chess.turn() === state.myColor;
  playerBottomEl.classList.toggle('active-turn', myTurn);
  playerTopEl.classList.toggle('active-turn', !myTurn);
}

// ---------- Find-game modal ----------
const findBtn = document.getElementById('findBtn');
const findModal = document.getElementById('findModal');
const findModalCloseBtn = document.getElementById('findModalCloseBtn');
const findModalMessage = document.getElementById('findModalMessage');
const waitingPlayersListEl = document.getElementById('waitingPlayersList');
const createWaitingBtn = document.getElementById('createWaitingBtn');

export function renderWaitingList(players) {
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

export function showFindModal() {
  findModal.classList.add('on');
  if (state.imWaiting) {
    findModalMessage.textContent = 'You are waiting for an opponent. Others can join you, or pick one below.';
    createWaitingBtn.style.display = 'none';
  } else {
    findModalMessage.textContent = 'Players waiting for an opponent:';
    createWaitingBtn.style.display = '';
  }
}
export function hideFindModal() { findModal.classList.remove('on'); }
export function isFindModalOpen() { return findModal.classList.contains('on'); }
export function setFindBtnEnabled(enabled) { findBtn.disabled = !enabled; }

findBtn.addEventListener('click', () => {
  if (!state.isAuthenticated) {
    alert('Please sign in with Google first.');
    return;
  }
  socket.emit('findGame');
});

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
  if (state.imWaiting) {
    socket.emit('cancelWaiting');
  }
});

// ---------- End-game modal ----------
const endModal = document.getElementById('endModal');
const modalMessage = document.getElementById('modalMessage');
const modalSub = document.getElementById('modalSub');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalNewGameBtn = document.getElementById('modalNewGameBtn');
const modalRematchBtn = document.getElementById('modalRematchBtn');

export function showEndModal(message, { disconnect = false } = {}) {
  modalMessage.textContent = message;
  modalSub.textContent = '';
  modalRematchBtn.disabled = false;
  modalRematchBtn.textContent = 'Rematch';
  state.rematchRequestedByMe = false;
  endModal.classList.add('on');
  if (disconnect) {
    modalRematchBtn.disabled = true;
    modalSub.textContent = 'Opponent left — rematch unavailable.';
  }
}
export function hideEndModal() { endModal.classList.remove('on'); }
export function isEndModalOpen() { return endModal.classList.contains('on'); }

export function setRematchStatus(text) { modalSub.textContent = text; }
export function setRematchButton({ label, disabled }) {
  if (label != null) modalRematchBtn.textContent = label;
  if (disabled != null) modalRematchBtn.disabled = disabled;
}

modalCloseBtn.addEventListener('click', () => {
  hideEndModal();
  if (state.rematchRequestedByMe) {
    socket.emit('cancelRematch');
    state.rematchRequestedByMe = false;
  }
});

modalNewGameBtn.addEventListener('click', () => {
  hideEndModal();
  state.rematchRequestedByMe = false;
  socket.emit('findGame');
});

modalRematchBtn.addEventListener('click', () => {
  if (modalRematchBtn.disabled) return;
  state.rematchRequestedByMe = true;
  modalRematchBtn.disabled = true;
  modalRematchBtn.textContent = 'Rematch requested';
  modalSub.textContent = 'Waiting for opponent…';
  socket.emit('requestRematch');
});

// ---------- Promotion picker ----------
const promoModal = document.getElementById('promoModal');
const promoChoices = document.getElementById('promoChoices');

export function showPromotionPicker(from, to, color) {
  state.pendingPromotion = { from, to };
  const c = color === 'w' ? 'w' : 'b';
  const pieces = [['q','Queen'], ['r','Rook'], ['b','Bishop'], ['n','Knight']];
  promoChoices.innerHTML = pieces.map(([p, label]) => `
    <button class="promo-btn" data-piece="${p}" aria-label="${label}" title="${label}">
      <img src="/static/img/chesspieces/wikipedia/${c}${p.toUpperCase()}.png" alt="${label}" />
    </button>
  `).join('');
  promoModal.classList.add('on');
}

export function hidePromotionPicker() {
  state.pendingPromotion = null;
  promoModal.classList.remove('on');
}

promoChoices.addEventListener('click', (e) => {
  const btn = e.target.closest('.promo-btn');
  if (!btn || !state.pendingPromotion) return;
  const piece = btn.dataset.piece;
  const { from, to } = state.pendingPromotion;
  hidePromotionPicker();

  const legal = state.chess.moves({ square: from, verbose: true })
    .find(m => m.to === to && m.promotion === piece);
  if (!legal) {
    if (state.board) state.board.position(state.chess.fen());
    return;
  }

  if (legal.captured) {
    state.awaitingCapture = true;
    socket.emit('move', { from, to, promotion: piece });
    return;
  }

  let move;
  try {
    move = state.chess.move({ from, to, promotion: piece });
  } catch (_) {
    move = null;
  }
  if (!move) {
    if (state.board) state.board.position(state.chess.fen());
    return;
  }
  socket.emit('move', { from, to, promotion: piece });
  if (state.board) state.board.position(state.chess.fen());
  highlightActiveTurn();
});

// ---------- Draw prompt + resign/draw buttons ----------
const resignBtn = document.getElementById('resignBtn');
const drawBtn = document.getElementById('drawBtn');
const drawPrompt = document.getElementById('drawPrompt');
const drawPromptText = document.getElementById('drawPromptText');
const drawAcceptBtn = document.getElementById('drawAcceptBtn');
const drawDeclineBtn = document.getElementById('drawDeclineBtn');

export function hideDrawPrompt() { drawPrompt.style.display = 'none'; }
export function showDrawPrompt(text, withButtons) {
  drawPromptText.textContent = text;
  drawAcceptBtn.style.display = withButtons ? '' : 'none';
  drawDeclineBtn.style.display = withButtons ? '' : 'none';
  drawPrompt.style.display = '';
}
export function setGameControlsEnabled(enabled) {
  resignBtn.disabled = !enabled;
  drawBtn.disabled = !enabled;
  if (enabled) drawBtn.textContent = 'Offer Draw';
}
export function markDrawOffered() {
  drawBtn.disabled = true;
  drawBtn.textContent = 'Draw offered';
}
export function resetDrawButton() {
  drawBtn.disabled = false;
  drawBtn.textContent = 'Offer Draw';
}

resignBtn.addEventListener('click', () => {
  if (!state.gameActive) return;
  if (!confirm('Resign this game?')) return;
  socket.emit('resign');
});

drawBtn.addEventListener('click', () => {
  if (!state.gameActive) return;
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

// ---------- Piece hover tooltip ----------
const tooltipEl = document.getElementById('pieceTooltip');
const boardEl = document.getElementById('board');

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
  const piece = state.currentPieces[square];
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

function handleHover(e) {
  const rect = boardEl.getBoundingClientRect();
  const insideBoard =
    e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (!insideBoard) { hideTooltip(); return; }
  let sq = squareFromElement(e.target);
  if (!sq) sq = squareAtPoint(e.clientX, e.clientY);
  if (!sq || !state.currentPieces[sq]) { hideTooltip(); return; }
  showTooltipFor(sq, e.clientX, e.clientY);
}
document.addEventListener('mousemove', handleHover);
document.addEventListener('mouseover', handleHover);
