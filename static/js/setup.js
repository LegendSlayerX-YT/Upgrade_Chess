import {
  socket, state,
  SLOT_DEFS, TYPE_NAME, MAX_LEVEL,
  DEFAULT_UPGRADE_COSTS, clampLevel, buildPreviewPieces,
} from './state.js';

const setupGrid = document.getElementById('setupGrid');
const setupSection = document.getElementById('setup');
const setupStatusEl = document.getElementById('setupStatus');
const statsSection = document.getElementById('stats');
const statsListEl = document.getElementById('statsList');

const refreshCurrencyBtn = document.getElementById('refreshCurrencyBtn');
const whiteTokensEl = document.getElementById('whiteTokens');
const blackTokensEl = document.getElementById('blackTokens');
const energyEl = document.getElementById('energy');

export function refreshPreviewPieces() {
  if (!state.gameActive) state.currentPieces = buildPreviewPieces();
}

export function showSetup(show) { setupSection.style.display = show ? '' : 'none'; }
export function showStats(show) { statsSection.classList.toggle('on', show); }

function affordableTokens() {
  return state.activeSide === 'w' ? state.myTokens.w : state.myTokens.b;
}

export function renderSetup() {
  const sideLevels = state.myLevels[state.activeSide];
  const pawns = SLOT_DEFS.filter(s => s.type === 'p');
  const back = SLOT_DEFS.filter(s => s.type !== 'p');
  const ordered = state.activeSide === 'b'
    ? [...pawns.slice().reverse(), ...back.slice().reverse()]
    : [...pawns, ...back];
  const rankFor = (type) => state.activeSide === 'w'
    ? (type === 'p' ? '2' : '1')
    : (type === 'p' ? '7' : '8');
  const tokens = affordableTokens();
  setupGrid.classList.toggle('alt-mode', state.altMode);
  setupGrid.innerHTML = ordered.map(({ slot, type, file }) => {
    const label = file + rankFor(type);
    const isKing = type === 'k';
    if (isKing) sideLevels[slot] = 1;
    const level = sideLevels[slot] ?? 1;
    const baseCost = state.upgradeCosts[type];
    const cost = baseCost != null ? baseCost * level : null;
    const atMax = level >= MAX_LEVEL;
    const atMin = level <= 1;
    const isPending = state.pendingUpgrade
      && state.pendingUpgrade.side === state.activeSide
      && state.pendingUpgrade.slot === slot;
    const canAfford = !isKing && !atMax && cost != null && tokens >= cost;
    const sideWord = state.activeSide === 'w' ? 'white' : 'black';

    let action, btnLabel, title, disabled, btnClass;
    if (isKing) {
      action = 'none';
      btnLabel = 'King';
      title = state.altMode ? 'The king cannot be downgraded.' : 'The king cannot be upgraded.';
      disabled = true;
      btnClass = state.altMode ? 'downgrade-btn' : 'upgrade-btn';
    } else if (state.altMode) {
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
        <img src="/static/img/chesspieces/wikipedia/${state.activeSide}${TYPE_NAME[type]}.png" alt="${type}" />
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
  if (!state.isAuthenticated) {
    alert('Sign in to upgrade pieces.');
    return;
  }
  state.pendingUpgrade = { side: state.activeSide, slot };
  renderSetup();
  socket.emit(action === 'downgrade' ? 'downgradePiece' : 'upgradePiece', { color: state.activeSide, slot });
});

function setAltMode(on) {
  if (state.altMode === on) return;
  state.altMode = on;
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
    state.activeSide = side;
    document.querySelectorAll('.setup-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.side === state.activeSide);
    });
    renderSetup();
    if (!state.gameActive && state.board && typeof state.board.orientation === 'function') {
      state.board.orientation(state.activeSide === 'b' ? 'black' : 'white');
    }
  });
});

// ---------- Stats panel ----------
export function renderStats() {
  if (!state.myColor) { statsListEl.innerHTML = ''; return; }
  const mine = Object.entries(state.currentPieces)
    .filter(([, p]) => p.color === state.myColor)
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

// ---------- Levels + currency socket handlers ----------
socket.on('levelsData', ({ levels, costs }) => {
  if (levels && typeof levels === 'object') {
    for (const side of ['w', 'b']) {
      const src = levels[side] || {};
      for (const { slot } of SLOT_DEFS) {
        state.myLevels[side][slot] = clampLevel(src[slot] ?? 1);
      }
    }
  }
  if (costs && typeof costs === 'object') {
    state.upgradeCosts = { ...DEFAULT_UPGRADE_COSTS, ...costs };
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
    state.myLevels[color][slot] = clampLevel(level);
  }
  if (state.pendingUpgrade && state.pendingUpgrade.side === color && state.pendingUpgrade.slot === slot) {
    state.pendingUpgrade = null;
  }
  renderSetup();
  refreshPreviewPieces();
});

socket.on('upgradeError', ({ reason }) => {
  state.pendingUpgrade = null;
  alert(`Upgrade failed: ${reason}`);
  renderSetup();
});

refreshCurrencyBtn.addEventListener('click', () => {
  socket.emit('fetchCurrency');
});

socket.on('currencyData', (data) => {
  if (!data.found) {
    whiteTokensEl.textContent = '0';
    blackTokensEl.textContent = '0';
    energyEl.textContent = '0';
    state.myTokens = { w: 0, b: 0 };
    renderSetup();
    return;
  }
  whiteTokensEl.textContent = data.whiteTokens;
  blackTokensEl.textContent = data.blackTokens;
  energyEl.textContent = data.energy;
  state.myTokens = { w: data.whiteTokens, b: data.blackTokens };
  renderSetup();
});

socket.on('currencyError', ({ reason }) => {
  alert(`Currency fetch failed: ${reason}`);
});
