import { socket, state, Chess } from './state.js';
import {
  showTopToast, showEnPassantToast,
  setPlayerCard, hidePlayerCards, highlightActiveTurn,
  showPromotionPicker, hidePromotionPicker,
  showEndModal, hideEndModal,
  showFindModal, hideFindModal, isFindModalOpen, renderWaitingList,
  isEndModalOpen,
  hideDrawPrompt, showDrawPrompt,
  setGameControlsEnabled, setFindBtnEnabled,
  markDrawOffered, resetDrawButton,
  setRematchStatus, setRematchButton,
} from './ui.js';
import {
  renderSetup, renderStats, refreshPreviewPieces, showSetup, showStats,
} from './setup.js';

function clearMoveHighlights() {
  document.querySelectorAll('#board .square-55d63').forEach(sq => {
    sq.classList.remove('highlight-move', 'highlight-capture');
  });
}

function showMoveHighlights(source) {
  clearMoveHighlights();
  const moves = state.chess.moves({ square: source, verbose: true });
  const seen = new Set();
  moves.forEach(m => {
    if (seen.has(m.to)) return;
    seen.add(m.to);
    const sq = document.querySelector('#board .square-' + m.to);
    if (!sq) return;
    sq.classList.add(m.captured ? 'highlight-capture' : 'highlight-move');
  });
  // King-attack: enemy king on a square the piece can geometrically reach
  // is a legal move in this variant even though chess.js omits it.
  const mover = state.currentPieces[source];
  if (!mover) return;
  Object.entries(state.currentPieces).forEach(([sq, p]) => {
    if (seen.has(sq)) return;
    if (!p || p.type !== 'k' || p.color === mover.color) return;
    if (canReachForAttack(source, sq, mover.type, mover.color)) {
      const el = document.querySelector('#board .square-' + sq);
      if (el) el.classList.add('highlight-capture');
    }
  });
}

function canReachForAttack(from, to, type, color) {
  const fx = from.charCodeAt(0) - 97, fy = parseInt(from[1], 10) - 1;
  const tx = to.charCodeAt(0) - 97, ty = parseInt(to[1], 10) - 1;
  const dx = tx - fx, dy = ty - fy;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const pathClear = () => {
    const sx = Math.sign(dx), sy = Math.sign(dy);
    let x = fx + sx, y = fy + sy;
    while (x !== tx || y !== ty) {
      const sq = String.fromCharCode(97 + x) + (y + 1);
      if (state.currentPieces[sq]) return false;
      x += sx; y += sy;
    }
    return true;
  };
  switch (type) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      return dy === dir && adx === 1;
    }
    case 'n': return (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
    case 'k': return adx <= 1 && ady <= 1 && (adx + ady) > 0;
    case 'b': return adx === ady && adx > 0 && pathClear();
    case 'r': return (dx === 0 || dy === 0) && (adx + ady) > 0 && pathClear();
    case 'q': return ((adx === ady) || (dx === 0 || dy === 0)) && (adx + ady) > 0 && pathClear();
  }
  return false;
}

function isPromotionMove(source, target) {
  const piece = state.chess.get(source);
  if (!piece || piece.type !== 'p') return false;
  if (piece.color === 'w' && target[1] !== '8') return false;
  if (piece.color === 'b' && target[1] !== '1') return false;
  return state.chess.moves({ square: source, verbose: true })
    .some(m => m.to === target && m.promotion);
}

function isValidTarget(source, target) {
  if (state.chess.moves({ square: source, verbose: true }).some(m => m.to === target)) return true;
  const mover = state.currentPieces[source];
  const tgt = state.currentPieces[target];
  if (mover && tgt && tgt.type === 'k' && tgt.color !== mover.color) {
    return canReachForAttack(source, target, mover.type, mover.color);
  }
  return false;
}

export function selectSquare(sq) {
  if (state.selectedSquare === sq) return;
  clearSelection();
  state.selectedSquare = sq;
  const el = document.querySelector('#board .square-' + sq);
  if (el) el.classList.add('highlight-selected');
  showMoveHighlights(sq);
}

export function clearSelection() {
  if (state.selectedSquare) {
    const el = document.querySelector('#board .square-' + state.selectedSquare);
    if (el) el.classList.remove('highlight-selected');
  }
  state.selectedSquare = null;
  clearMoveHighlights();
}

// Returns: 'pending' | 'invalid' | 'no-visual' | 'move-visual'
function attemptMove(source, target) {
  if (isPromotionMove(source, target)) {
    const legalPromo = state.chess.moves({ square: source, verbose: true })
      .find(m => m.to === target);
    if (legalPromo && legalPromo.captured) {
      // Capture-promotion: defer the choice until after the duel resolves.
      state.awaitingCapture = true;
      socket.emit('move', { from: source, to: target });
      return 'move-visual';
    }
    const color = state.chess.get(source).color;
    showPromotionPicker(source, target, color);
    return 'pending';
  }

  const targetPiece = state.currentPieces[target];
  const moverPiece = state.currentPieces[source];
  const isKingAttack = !!(
    targetPiece && moverPiece &&
    targetPiece.type === 'k' && targetPiece.color !== moverPiece.color
  );

  const legal = state.chess.moves({ square: source, verbose: true })
    .find(m => m.to === target);
  if (!legal && !isKingAttack) return 'invalid';

  if (isKingAttack) {
    state.awaitingCapture = true;
    socket.emit('move', { from: source, to: target });
    return 'no-visual';
  }

  if (legal.captured) {
    state.awaitingCapture = true;
    socket.emit('move', { from: source, to: target });
    return 'move-visual';
  }

  let move;
  try {
    move = state.chess.move({ from: source, to: target, promotion: 'q' });
  } catch (_) {
    move = null;
  }
  if (!move) return 'invalid';

  socket.emit('move', { from: source, to: target });
  highlightActiveTurn();
  return 'move-visual';
}

function onDragStart(source, piece) {
  if (!state.gameActive) return false;
  if (state.chess.isGameOver()) { showTopToast('Game is over.'); return false; }
  if (state.awaitingCapture) { showTopToast('Resolving combat…'); return false; }
  if ((state.myColor === 'w' && piece.startsWith('b')) ||
      (state.myColor === 'b' && piece.startsWith('w'))) {
    showTopToast('That piece isn’t yours.');
    return false;
  }
  if (state.chess.turn() !== state.myColor) {
    showTopToast('It’s the opponent’s turn.');
    return false;
  }
  showMoveHighlights(source);
}

let lastClickFromDropAt = 0;

function onDrop(source, target) {
  // Same-square drop = a click on a piece without dragging. Chessboard.js's
  // dragged-piece clone breaks the browser click event for this case (click
  // target ends up as the common ancestor, not the square), so we route it
  // through handleSquareClick here directly.
  if (source === target) {
    lastClickFromDropAt = Date.now();
    handleSquareClick(source);
    return 'snapback';
  }

  clearSelection();
  const r = attemptMove(source, target);
  if (r === 'invalid') {
    showTopToast('Invalid move.');
    return 'snapback';
  }
  if (r === 'no-visual' || r === 'pending') return 'snapback';
  // 'move-visual': chessboard.js handles the source->target animation.
}

function handleSquareClick(sq) {
  if (!state.gameActive) return;
  if (state.chess.isGameOver()) { clearSelection(); return; }
  if (state.awaitingCapture) return;

  // Move into a valid target square.
  if (
    state.selectedSquare &&
    state.selectedSquare !== sq &&
    state.chess.turn() === state.myColor &&
    isValidTarget(state.selectedSquare, sq)
  ) {
    const from = state.selectedSquare;
    clearSelection();
    const r = attemptMove(from, sq);
    if (r === 'move-visual' && state.board) {
      state.board.move(from + '-' + sq);
    }
    return;
  }

  // Select / toggle our own piece.
  const piece = state.currentPieces[sq];
  const myTurn = state.chess.turn() === state.myColor;
  if (piece && piece.color === state.myColor && myTurn) {
    if (state.selectedSquare === sq) clearSelection();
    else selectSquare(sq);
    return;
  }

  // Click on empty / opponent square that isn't a valid target.
  clearSelection();
}

function bindBoardClicks() {
  const boardEl = document.getElementById('board');
  if (!boardEl || boardEl._clickBound) return;
  boardEl._clickBound = true;
  boardEl.addEventListener('click', (e) => {
    // onDrop already handled this click (same-square piece click). The
    // browser click may still fire on a common ancestor — ignore it.
    if (Date.now() - lastClickFromDropAt < 200) return;
    let el = e.target;
    while (el && el !== boardEl) {
      if (el.classList) {
        for (const cls of el.classList) {
          const m = cls.match(/^square-([a-h][1-8])$/);
          if (m) { handleSquareClick(m[1]); return; }
        }
      }
      el = el.parentElement;
    }
  });
}

function onSnapEnd() {
  state.board.position(state.chess.fen());
}

export function initPreviewBoard() {
  state.board = Chessboard('board', {
    draggable: false,
    position: 'start',
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
  });
}

export function startBoard(fen, color) {
  state.myColor = color === 'white' ? 'w' : 'b';
  state.chess = new Chess(fen);
  if (state.board) state.board.destroy();
  state.board = Chessboard('board', {
    draggable: true,
    position: fen,
    orientation: color,
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
    onDragStart,
    onDrop,
    onSnapEnd,
  });
  state.gameActive = true;
  state.selectedSquare = null;
  setFindBtnEnabled(false);
  setGameControlsEnabled(true);
  hideDrawPrompt();
  showSetup(false);
  showStats(true);
  renderStats();
  highlightActiveTurn();
  bindBoardClicks();
}

export function endGame(payload) {
  state.gameActive = false;
  clearSelection();
  setFindBtnEnabled(state.isAuthenticated);
  hidePlayerCards();
  setGameControlsEnabled(false);
  hideDrawPrompt();
  hidePromotionPicker();
  showSetup(true);
  showStats(false);
  refreshPreviewPieces();
  if (state.board) state.board.destroy();
  state.board = Chessboard('board', {
    draggable: false,
    position: 'start',
    orientation: state.activeSide === 'b' ? 'black' : 'white',
    pieceTheme: '/static/img/chesspieces/wikipedia/{piece}.png',
  });
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
  showEndModal(msg, { disconnect: payload.type === 'disconnect' });
}

// ---------- Socket handlers ----------
socket.on('waiting', () => {
  state.imWaiting = true;
  showFindModal();
});

socket.on('waitingList', ({ players }) => {
  renderWaitingList(players || []);
  showFindModal();
});

socket.on('waitingListUpdate', ({ players }) => {
  if (!isFindModalOpen()) return;
  renderWaitingList(players || []);
});

socket.on('waitingCancelled', () => {
  state.imWaiting = false;
});

socket.on('joinFailed', ({ reason }) => {
  alert(reason || 'Could not join that game.');
});

socket.on('paired', ({ color, fen, pieces, you, opponent, yourPicture, opponentPicture }) => {
  state.imWaiting = false;
  hideEndModal();
  hideFindModal();
  const youLabel = you || state.myName || 'You';
  const oppLabel = opponent || 'Opponent';
  const youColor = color === 'white' ? 'White' : 'Black';
  const oppColor = color === 'white' ? 'Black' : 'White';
  const meCode = color === 'white' ? 'w' : 'b';
  const oppCode = meCode === 'w' ? 'b' : 'w';
  setPlayerCard('top', oppLabel, opponentPicture, oppColor, oppCode);
  setPlayerCard('bottom', youLabel, yourPicture, youColor, meCode);
  state.currentPieces = pieces || {};
  startBoard(fen, color);
});

socket.on('moveMade', ({ from, to, promotion, fen, pieces, combat, is_en_passant }) => {
  if (is_en_passant) showEnPassantToast();
  if (pieces) state.currentPieces = pieces;
  clearSelection();
  const attackerDied = combat && !combat.attacker_survived;
  if (state.chess.fen() !== fen) {
    if (attackerDied) {
      try { state.chess.load(fen); } catch (_) {}
    } else {
      try {
        state.chess.move({ from, to, promotion: promotion || 'q' });
      } catch (_) {
        try { state.chess.load(fen); } catch (_) {}
      }
    }
  }
  if (state.board) state.board.position(state.chess.fen());
  renderStats();
  highlightActiveTurn();

  state.awaitingCapture = false;
  if (state.currentDuel) {
    const d = state.currentDuel;
    state.currentDuel = null;
    d.resolve(attackerDied ? 'attacker' : 'defender');
  }
});

socket.on('illegalMove', ({ reason }) => {
  showTopToast(`Move rejected: ${reason}`);
  state.awaitingCapture = false;
  clearSelection();
  if (state.board) state.board.position(state.chess.fen());
});

socket.on('drawOfferSent', () => {
  markDrawOffered();
});

socket.on('drawOffered', () => {
  showDrawPrompt('Opponent offers a draw.', true);
});

socket.on('drawDeclined', () => {
  resetDrawButton();
  showDrawPrompt('Draw offer declined.', false);
  setTimeout(hideDrawPrompt, 2500);
});

socket.on('drawOfferCleared', () => {
  resetDrawButton();
  hideDrawPrompt();
});

socket.on('needPromotion', ({ from, to, color }) => {
  // Duel finished with the attacker surviving; resolve the duel animation
  // for both players, then prompt only the attacker to pick a piece.
  if (state.currentDuel) {
    const d = state.currentDuel;
    state.currentDuel = null;
    d.resolve('defender');
  }
  if (color === state.myColor) {
    showPromotionPicker(from, to, color, { deferred: true });
  }
});

socket.on('gameOver', endGame);

socket.on('rematchRequested', () => {
  if (!isEndModalOpen()) return;
  setRematchStatus('Opponent wants a rematch.');
  setRematchButton({ label: 'Accept Rematch' });
});

socket.on('rematchPending', () => {
  setRematchStatus('Waiting for opponent…');
});

socket.on('rematchUnavailable', () => {
  if (!isEndModalOpen()) return;
  setRematchButton({ label: 'Rematch', disabled: true });
  setRematchStatus('Opponent left — rematch unavailable.');
  state.rematchRequestedByMe = false;
});
