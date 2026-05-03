const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

let waitingSocketId = null;
const games = new Map();
const socketToGame = new Map();
const pendingLevels = new Map();

const PIECE_BASE = {
  p: { hp: 10, dmg: 10 },
  n: { hp: 10, dmg: 10 },
  b: { hp: 10, dmg: 10 },
  r: { hp: 10, dmg: 10 },
  q: { hp: 10, dmg: 10 },
  k: { hp: 10, dmg: 10 },
};

const SLOT_TO_START_SQUARE = {
  Ra: 'a1', Nb: 'b1', Bc: 'c1', Q: 'd1', K: 'e1', Bf: 'f1', Ng: 'g1', Rh: 'h1',
  Pa: 'a2', Pb: 'b2', Pc: 'c2', Pd: 'd2', Pe: 'e2', Pf: 'f2', Pg: 'g2', Ph: 'h2',
};
const SLOT_TYPES = {
  Ra: 'r', Nb: 'n', Bc: 'b', Q: 'q', K: 'k', Bf: 'b', Ng: 'n', Rh: 'r',
  Pa: 'p', Pb: 'p', Pc: 'p', Pd: 'p', Pe: 'p', Pf: 'p', Pg: 'p', Ph: 'p',
};

function clampLevel(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  if (v > 99) return 99;
  return v;
}

function pieceStats(type, level) {
  const base = PIECE_BASE[type];
  return { hp: base.hp * level, dmg: base.dmg * level };
}

function buildPieces(whiteLevels, blackLevels) {
  const pieces = {};
  for (const slot of Object.keys(SLOT_TO_START_SQUARE)) {
    const type = SLOT_TYPES[slot];
    const wSquare = SLOT_TO_START_SQUARE[slot];
    const bSquare = wSquare[0] + (wSquare[1] === '1' ? '8' : '7');

    const wLevel = clampLevel(whiteLevels?.[slot] ?? 1);
    const bLevel = clampLevel(blackLevels?.[slot] ?? 1);
    const wStats = pieceStats(type, wLevel);
    const bStats = pieceStats(type, bLevel);

    pieces[wSquare] = { id: 'w' + slot, type, color: 'w', level: wLevel, hp: wStats.hp, dmg: wStats.dmg };
    pieces[bSquare] = { id: 'b' + slot, type, color: 'b', level: bLevel, hp: bStats.hp, dmg: bStats.dmg };
  }
  return pieces;
}

function applyMoveToPieces(pieces, move) {
  const next = { ...pieces };
  const mover = next[move.from];
  if (!mover) return next;
  delete next[move.from];

  if (move.flags.includes('e')) {
    const epRank = move.color === 'w' ? '5' : '4';
    delete next[move.to[0] + epRank];
  } else if (move.flags.includes('c')) {
    delete next[move.to];
  }

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const kingside = move.flags.includes('k');
    const rank = move.color === 'w' ? '1' : '8';
    const rookFrom = (kingside ? 'h' : 'a') + rank;
    const rookTo = (kingside ? 'f' : 'd') + rank;
    const rook = next[rookFrom];
    if (rook) {
      delete next[rookFrom];
      next[rookTo] = rook;
    }
  }

  if (move.promotion) {
    const newType = move.promotion;
    const stats = pieceStats(newType, mover.level);
    next[move.to] = { ...mover, type: newType, hp: stats.hp, dmg: stats.dmg };
  } else {
    next[move.to] = mover;
  }
  return next;
}

function makeGameId() {
  return Math.random().toString(36).slice(2, 10);
}

function startGame(whiteSocket, blackSocket) {
  const gameId = makeGameId();
  const chess = new Chess();
  const whiteSide = pendingLevels.get(whiteSocket.id)?.w || {};
  const blackSide = pendingLevels.get(blackSocket.id)?.b || {};
  pendingLevels.delete(whiteSocket.id);
  pendingLevels.delete(blackSocket.id);
  const pieces = buildPieces(whiteSide, blackSide);
  games.set(gameId, {
    id: gameId,
    chess,
    pieces,
    white: whiteSocket.id,
    black: blackSocket.id,
    drawOfferBy: null,
    state: 'active',
    rematchRequests: new Set(),
  });
  socketToGame.set(whiteSocket.id, gameId);
  socketToGame.set(blackSocket.id, gameId);
  whiteSocket.join(gameId);
  blackSocket.join(gameId);
  whiteSocket.emit('paired', { gameId, color: 'white', fen: chess.fen(), pieces });
  blackSocket.emit('paired', { gameId, color: 'black', fen: chess.fen(), pieces });
}

function pair(socket) {
  if (waitingSocketId === socket.id) return;

  if (waitingSocketId && io.sockets.sockets.get(waitingSocketId)) {
    const opponent = io.sockets.sockets.get(waitingSocketId);
    waitingSocketId = null;
    const whiteIsOpponent = Math.random() < 0.5;
    startGame(
      whiteIsOpponent ? opponent : socket,
      whiteIsOpponent ? socket : opponent,
    );
  } else {
    waitingSocketId = socket.id;
    socket.emit('waiting');
  }
}

function endGame(gameId, payload) {
  const game = games.get(gameId);
  if (!game || game.state !== 'active') return;
  game.state = 'ended';
  game.rematchRequests = new Set();
  io.to(gameId).emit('gameOver', payload);
}

function leaveEndedGame(socket) {
  const gameId = socketToGame.get(socket.id);
  if (!gameId) return;
  const game = games.get(gameId);
  if (!game || game.state !== 'ended') return;

  socketToGame.delete(socket.id);
  socket.leave(gameId);

  const opponentId = socket.id === game.white ? game.black : game.white;
  if (socketToGame.get(opponentId) === gameId) {
    io.to(opponentId).emit('rematchUnavailable');
  } else {
    games.delete(gameId);
  }
}

io.on('connection', (socket) => {
  socket.on('findGame', (payload) => {
    if (payload && payload.levelsByColor && typeof payload.levelsByColor === 'object') {
      const cleaned = { w: {}, b: {} };
      for (const side of ['w', 'b']) {
        const src = payload.levelsByColor[side] || {};
        for (const slot of Object.keys(SLOT_TYPES)) {
          cleaned[side][slot] = clampLevel(src[slot] ?? 1);
        }
      }
      pendingLevels.set(socket.id, cleaned);
    } else if (payload && payload.levels && typeof payload.levels === 'object') {
      const same = {};
      for (const slot of Object.keys(SLOT_TYPES)) {
        same[slot] = clampLevel(payload.levels[slot] ?? 1);
      }
      pendingLevels.set(socket.id, { w: { ...same }, b: { ...same } });
    }
    leaveEndedGame(socket);
    pair(socket);
  });

  socket.on('move', ({ from, to, promotion }) => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'active') return;

    const turnColor = game.chess.turn() === 'w' ? 'white' : 'black';
    const playerColor = socket.id === game.white ? 'white' : 'black';
    if (turnColor !== playerColor) {
      socket.emit('illegalMove', { reason: 'not your turn' });
      return;
    }

    let result;
    try {
      result = game.chess.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      result = null;
    }
    if (!result) {
      socket.emit('illegalMove', { reason: 'illegal' });
      return;
    }

    if (game.drawOfferBy) {
      game.drawOfferBy = null;
      io.to(gameId).emit('drawOfferCleared');
    }

    game.pieces = applyMoveToPieces(game.pieces, result);

    io.to(gameId).emit('moveMade', {
      from: result.from,
      to: result.to,
      promotion: result.promotion,
      san: result.san,
      fen: game.chess.fen(),
      turn: game.chess.turn(),
      pieces: game.pieces,
    });

    if (game.chess.isGameOver()) {
      let outcome;
      if (game.chess.isCheckmate()) {
        outcome = { type: 'checkmate', winner: playerColor };
      } else if (game.chess.isStalemate()) {
        outcome = { type: 'stalemate' };
      } else if (game.chess.isThreefoldRepetition()) {
        outcome = { type: 'threefold' };
      } else if (game.chess.isInsufficientMaterial()) {
        outcome = { type: 'insufficient' };
      } else if (game.chess.isDraw()) {
        outcome = { type: 'draw' };
      } else {
        outcome = { type: 'over' };
      }
      endGame(gameId, outcome);
    }
  });

  socket.on('offerDraw', () => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'active') return;
    const color = socket.id === game.white ? 'white' : 'black';
    if (game.drawOfferBy === color) return;
    if (game.drawOfferBy && game.drawOfferBy !== color) {
      game.drawOfferBy = null;
      endGame(gameId, { type: 'agreement' });
      return;
    }
    game.drawOfferBy = color;
    const opponentId = color === 'white' ? game.black : game.white;
    io.to(opponentId).emit('drawOffered', { by: color });
    socket.emit('drawOfferSent');
  });

  socket.on('acceptDraw', () => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'active') return;
    const color = socket.id === game.white ? 'white' : 'black';
    if (!game.drawOfferBy || game.drawOfferBy === color) return;
    game.drawOfferBy = null;
    endGame(gameId, { type: 'agreement' });
  });

  socket.on('declineDraw', () => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'active') return;
    const color = socket.id === game.white ? 'white' : 'black';
    if (!game.drawOfferBy || game.drawOfferBy === color) return;
    game.drawOfferBy = null;
    io.to(gameId).emit('drawDeclined');
  });

  socket.on('resign', () => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'active') return;
    const loserColor = socket.id === game.white ? 'white' : 'black';
    const winnerColor = loserColor === 'white' ? 'black' : 'white';
    endGame(gameId, { type: 'resign', winner: winnerColor });
  });

  socket.on('requestRematch', () => {
    const gameId = socketToGame.get(socket.id);
    const game = gameId && games.get(gameId);
    if (!game || game.state !== 'ended') return;

    const opponentId = socket.id === game.white ? game.black : game.white;
    const opponentStillIn = socketToGame.get(opponentId) === gameId
      && io.sockets.sockets.has(opponentId);
    if (!opponentStillIn) {
      socket.emit('rematchUnavailable');
      return;
    }

    game.rematchRequests.add(socket.id);
    if (game.rematchRequests.has(opponentId)) {
      const newWhiteSocket = io.sockets.sockets.get(game.black);
      const newBlackSocket = io.sockets.sockets.get(game.white);
      socketToGame.delete(game.white);
      socketToGame.delete(game.black);
      newWhiteSocket.leave(gameId);
      newBlackSocket.leave(gameId);
      games.delete(gameId);
      startGame(newWhiteSocket, newBlackSocket);
    } else {
      socket.emit('rematchPending');
      io.to(opponentId).emit('rematchRequested');
    }
  });

  socket.on('cancelRematch', () => {
    leaveEndedGame(socket);
  });

  socket.on('disconnect', () => {
    if (waitingSocketId === socket.id) waitingSocketId = null;
    pendingLevels.delete(socket.id);

    const gameId = socketToGame.get(socket.id);
    if (!gameId) return;
    const game = games.get(gameId);
    if (!game) return;

    if (game.state === 'active') {
      const winnerColor = socket.id === game.white ? 'black' : 'white';
      endGame(gameId, { type: 'disconnect', winner: winnerColor });
    }
    socketToGame.delete(socket.id);
    const opponentId = socket.id === game.white ? game.black : game.white;
    if (socketToGame.get(opponentId) === gameId) {
      io.to(opponentId).emit('rematchUnavailable');
    } else {
      games.delete(gameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ChessRPG server listening on http://localhost:${PORT}`);
});
