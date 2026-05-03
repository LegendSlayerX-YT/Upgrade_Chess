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

function makeGameId() {
  return Math.random().toString(36).slice(2, 10);
}

function startGame(whiteSocket, blackSocket) {
  const gameId = makeGameId();
  const chess = new Chess();
  games.set(gameId, {
    id: gameId,
    chess,
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
  whiteSocket.emit('paired', { gameId, color: 'white', fen: chess.fen() });
  blackSocket.emit('paired', { gameId, color: 'black', fen: chess.fen() });
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
  socket.on('findGame', () => {
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

    io.to(gameId).emit('moveMade', {
      from: result.from,
      to: result.to,
      promotion: result.promotion,
      san: result.san,
      fen: game.chess.fen(),
      turn: game.chess.turn(),
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
