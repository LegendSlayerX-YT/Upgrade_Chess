import { socket, state } from './js/state.js';
import { hidePlayerCards, hideFindModal, setFindBtnEnabled, setGameControlsEnabled } from './js/ui.js';
import { renderSetup, refreshPreviewPieces } from './js/setup.js';
import { initPreviewBoard } from './js/board.js';
import './js/auth.js';
import './js/combat.js';

renderSetup();
refreshPreviewPieces();
initPreviewBoard();

socket.on('disconnect', () => {
  state.gameActive = false;
  state.isAuthenticated = false;
  state.imWaiting = false;
  setFindBtnEnabled(false);
  setGameControlsEnabled(false);
  hidePlayerCards();
  hideFindModal();
});
