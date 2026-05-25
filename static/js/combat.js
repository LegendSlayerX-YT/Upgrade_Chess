import { socket, state, PIECE_IMG } from './state.js';

const boardEl = document.getElementById('board');

const FIGHT_FLY_MS = 850;

function getSquareEl(square) {
  return boardEl.querySelector(`.square-${square}`)
      || boardEl.querySelector(`[data-square="${square}"]`);
}

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

export function playCaptureAnimation({
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

socket.on('captureWindow', ({
  from, to, attackerColor, defenderSquare,
  attackerHp, defenderHp, turn,
}) => {
  const localIsAttacker = attackerColor === state.myColor;

  // Opponent's chessboard hasn't moved the attacker yet; do a visual-only move.
  if (!localIsAttacker && state.board) {
    state.board.move(`${from}-${to}`);
  }

  const mover = state.currentPieces[from];
  const capturedSquare = defenderSquare || to;
  const isEP = capturedSquare !== to;
  const defender = state.currentPieces[capturedSquare];
  if (!mover || !defender) return;

  if (state.currentDuel) {
    const prev = state.currentDuel;
    state.currentDuel = null;
    prev.resolve();
  }
  state.currentDuel = playCaptureAnimation({
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
  if (state.currentDuel) state.currentDuel.update({ attackerHp, defenderHp, turn });
});
