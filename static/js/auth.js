import { socket, state } from './state.js';
import { setUserMenuOpen, setFindBtnEnabled } from './ui.js';

const userBadge = document.getElementById('userBadge');
const userNameEl = document.getElementById('userName');
const userAvatarEl = document.getElementById('userAvatar');
const signOutBtn = document.getElementById('signOutBtn');
const signInDiv = document.querySelector('.g_id_signin');
const setupStatusEl = document.getElementById('setupStatus');

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

function clearSignedInUi() {
  state.isAuthenticated = false;
  state.myName = null;
  userBadge.style.display = 'none';
  userNameEl.textContent = '';
  userAvatarEl.removeAttribute('src');
  if (signInDiv) signInDiv.style.display = '';
  setFindBtnEnabled(false);
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
}

signOutBtn.addEventListener('click', async () => {
  setUserMenuOpen(false);
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* ignore network failure; UI signs out either way */ }
  clearSignedInUi();
  socket.disconnect();
  socket.connect();
});

socket.on('authenticated', ({ name, picture }) => {
  state.isAuthenticated = true;
  state.myName = name;
  userNameEl.textContent = name;
  if (picture) {
    userAvatarEl.src = picture;
    userAvatarEl.style.display = '';
  } else {
    userAvatarEl.style.display = 'none';
  }
  userBadge.style.display = '';
  if (signInDiv) signInDiv.style.display = 'none';
  if (!state.gameActive) setFindBtnEnabled(true);
  if (setupStatusEl) setupStatusEl.textContent = 'Loading your upgrades…';
  socket.emit('fetchLevels');
  socket.emit('fetchCurrency');
});

socket.on('authError', ({ reason }) => {
  alert(`Sign-in failed: ${reason}`);
  state.isAuthenticated = false;
  setFindBtnEnabled(false);
});

socket.on('signedOut', () => {
  clearSignedInUi();
});
