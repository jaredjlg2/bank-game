const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// In-memory game storage
const games = {}; 
const highScores = [];
// games[gameName] = {
//   hostId,
//   totalRounds,
//   rollInterval,
//   round,
//   pot,
//   rollNumber,
//   rolling,
//   timer,
//   rollerIndex,
//   isComplete,
//   players: [{ id, name, score, hasBanked }]
// };

function broadcastGameState(gameName) {
  const game = games[gameName];
  if (!game) return;

  const leaderboard = [...game.players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  io.to(gameName).emit('game_state', {
    gameName,
    totalRounds: game.totalRounds,
    rollInterval: game.rollInterval,
    round: game.round,
    pot: game.pot,
    rollNumber: game.rollNumber,
    phase: game.rollNumber <= 3 ? 1 : 2,
    isComplete: game.isComplete,
    players: leaderboard.map(p => ({
      name: p.name,
      score: p.score,
      hasBanked: p.hasBanked
    }))
  });
}

function endRound(gameName, reason) {
  const game = games[gameName];
  if (!game) return;

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }
  game.rolling = false;
  if (game.nextRoundTimer) {
    clearTimeout(game.nextRoundTimer);
    game.nextRoundTimer = null;
  }

  const nextRoundDelay = reason === 'seven' ? 3 : 0;

  io.to(gameName).emit('round_ended', {
    round: game.round,
    reason, // 'seven' or 'all_banked'
    pot: game.pot,
    nextRoundDelay
  });

  const advanceRound = () => {
    game.round += 1;

    if (game.round > game.totalRounds) {
      // Game over
      const finalPlayers = [...game.players].sort((a, b) => b.score - a.score);
      game.isComplete = true;
      game.rolling = false;
      game.timer = null;
      game.nextRoundTimer = null;
      game.round = game.totalRounds;
      game.rollNumber = 0;
      io.to(gameName).emit('game_over', {
        gameName,
        players: finalPlayers.map(p => ({
          name: p.name,
          score: p.score
        }))
      });
      updateHighScores(finalPlayers);
      emitHighScores();
      return;
    }

    // Reset for next round
    game.pot = 0;
    game.rollNumber = 0;
    game.players.forEach(p => { p.hasBanked = false; });

    broadcastGameState(gameName);
    startRolling(gameName);
  };

  if (nextRoundDelay > 0) {
    game.nextRoundTimer = setTimeout(() => {
      game.nextRoundTimer = null;
      advanceRound();
    }, nextRoundDelay * 1000);
  } else {
    advanceRound();
  }
}

function performRoll(gameName) {
  const game = games[gameName];
  if (!game || !game.rolling) return;

  const activePlayers = game.players.filter(p => !p.hasBanked);
  if (activePlayers.length === 0) {
    endRound(gameName, 'all_banked');
    return;
  }

  // Advance roller index until we land on someone who hasn't banked
  let guard = 0;
  while (game.players[game.rollerIndex].hasBanked && guard < game.players.length + 1) {
    game.rollerIndex = (game.rollerIndex + 1) % game.players.length;
    guard++;
  }

  const roller = game.players[game.rollerIndex];
  game.rollerIndex = (game.rollerIndex + 1) % game.players.length;

  game.rollNumber += 1;

  const dice1 = Math.floor(Math.random() * 6) + 1;
  const dice2 = Math.floor(Math.random() * 6) + 1;
  const sum = dice1 + dice2;
  const isDouble = dice1 === dice2;
  const isSeven = sum === 7;
  const phase = game.rollNumber <= 3 ? 1 : 2;

  const previousPot = game.pot;

  if (phase === 1) {
    if (isSeven) {
      // First 3 rolls: 7 = 70 points, does NOT end round
      game.pot += 70;
    } else if (isDouble) {
      // First 3 rolls: doubles add face value only
      game.pot += sum;
    } else {
      game.pot += sum;
    }
  } else {
    // Phase 2 (danger zone)
    if (isSeven) {
      game.pot = 0;
    } else if (isDouble) {
      game.pot *= 2;
    } else {
      game.pot += sum;
    }
  }

  const rollPayload = {
    gameName,
    round: game.round,
    rollNumber: game.rollNumber,
    phase,
    dice1,
    dice2,
    sum,
    isDouble,
    isSeven,
    previousPot,
    pot: game.pot,
    rollerName: roller.name,
    secondsToNextRoll: game.rollInterval,
    players: [...game.players].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    }).map(p => ({
      name: p.name,
      score: p.score,
      hasBanked: p.hasBanked
    }))
  };

  io.to(gameName).emit('roll_result', rollPayload);

  // If phase 2 and 7 was rolled, end round
  if (phase === 2 && isSeven) {
    endRound(gameName, 'seven');
  } else {
    broadcastGameState(gameName);
  }
}

function startRolling(gameName) {
  const game = games[gameName];
  if (!game) return;

  if (game.timer) clearInterval(game.timer);

  game.rolling = true;
  game.timer = setInterval(() => performRoll(gameName), game.rollInterval * 1000);

  // Also trigger an immediate roll to avoid waiting for the first interval
  performRoll(gameName);
}

function updateHighScores(players) {
  players.forEach(player => {
    highScores.push({ name: player.name, score: player.score });
  });

  highScores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  highScores.splice(5);
}

function emitHighScores(target = io) {
  target.emit('high_scores', { scores: highScores });
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);

  emitHighScores(socket);

  socket.on('create_game', ({ gameName, playerName, totalRounds, rollInterval }) => {
    if (!gameName || !playerName) return;

    if (games[gameName]) {
      socket.emit('error_message', 'A game with that name already exists. Join it instead.');
      return;
    }

    const newGame = {
      hostId: socket.id,
      totalRounds,
      rollInterval,
      round: 1,
      pot: 0,
      rollNumber: 0,
      rollerIndex: 0,
      rolling: false,
      timer: null,
      nextRoundTimer: null,
      isComplete: false,
      groupMuted: false,
      players: [{
        id: socket.id,
        name: playerName,
        score: 0,
        hasBanked: false
      }]
    };

    games[gameName] = newGame;
    socket.join(gameName);

    socket.emit('joined_game', { gameName, isHost: true, groupMuted: newGame.groupMuted });
    socket.to(gameName).emit('voice_peer_joined', { id: socket.id });
    broadcastGameState(gameName);
  });

  socket.on('join_game', ({ gameName, playerName }) => {
    const game = games[gameName];
    if (!game) {
      socket.emit('error_message', 'No game found with that name. Ask the host to create it first.');
      return;
    }

    socket.join(gameName);

    // Reconnect or new player?
    let player = game.players.find(p => p.name === playerName);
    if (player) {
      player.id = socket.id;
    } else {
      game.players.push({
        id: socket.id,
        name: playerName,
        score: 0,
        hasBanked: false
      });
    }

    socket.emit('joined_game', { gameName, isHost: socket.id === game.hostId, groupMuted: game.groupMuted });
    socket.to(gameName).emit('voice_peer_joined', { id: socket.id });
    broadcastGameState(gameName);

    if (game.isComplete) {
      const finalPlayers = [...game.players].sort((a, b) => b.score - a.score);
      socket.emit('game_over', {
        gameName,
        players: finalPlayers.map(p => ({
          name: p.name,
          score: p.score
        }))
      });
    }
  });

  socket.on('start_game', ({ gameName }) => {
    const game = games[gameName];
    if (!game) return;
    if (socket.id !== game.hostId) return; // only host

    // Reset for fresh game
    game.round = 1;
    game.pot = 0;
    game.rollNumber = 0;
    game.rollerIndex = 0;
    game.isComplete = false;
    if (game.nextRoundTimer) {
      clearTimeout(game.nextRoundTimer);
      game.nextRoundTimer = null;
    }
    game.players.forEach(p => {
      p.score = 0;
      p.hasBanked = false;
    });

    broadcastGameState(gameName);
    startRolling(gameName);
  });

  socket.on('toggle_group_mute', ({ gameName }) => {
    const game = games[gameName];
    if (!game) return;
    if (socket.id !== game.hostId) return;
    game.groupMuted = !game.groupMuted;
    io.to(gameName).emit('voice_group_muted', { muted: game.groupMuted });
  });

  socket.on('bank', ({ gameName, playerName }) => {
    const game = games[gameName];
    if (!game) return;
    if (game.isComplete) return;

    const player = game.players.find(p => p.name === playerName);
    if (!player || player.hasBanked) return;

    player.score += game.pot;
    player.hasBanked = true;

    io.to(gameName).emit('player_banked', {
      name: player.name,
      score: player.score,
      pot: game.pot
    });

    const someoneStillActive = game.players.some(p => !p.hasBanked);
    if (!someoneStillActive) {
      endRound(gameName, 'all_banked');
    } else {
      broadcastGameState(gameName);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
    // Leaving state in memory lets players refresh / reconnect.
    const rooms = [...socket.rooms].filter(room => room !== socket.id);
    rooms.forEach(room => {
      socket.to(room).emit('voice_peer_left', { id: socket.id });
    });
  });

  socket.on('voice_offer', ({ gameName, targetId, description }) => {
    if (!gameName || !targetId || !description) return;
    if (!socket.rooms.has(gameName)) return;
    io.to(targetId).emit('voice_offer', {
      from: socket.id,
      description
    });
  });

  socket.on('voice_answer', ({ gameName, targetId, description }) => {
    if (!gameName || !targetId || !description) return;
    if (!socket.rooms.has(gameName)) return;
    io.to(targetId).emit('voice_answer', {
      from: socket.id,
      description
    });
  });

  socket.on('voice_ice', ({ gameName, targetId, candidate }) => {
    if (!gameName || !targetId || !candidate) return;
    if (!socket.rooms.has(gameName)) return;
    io.to(targetId).emit('voice_ice', {
      from: socket.id,
      candidate
    });
  });

  socket.on('end_game', ({ gameName }) => {
    const game = games[gameName];
    if (!game) return;
    if (!socket.rooms.has(gameName)) return;

    if (game.timer) {
      clearInterval(game.timer);
      game.timer = null;
    }
    if (game.nextRoundTimer) {
      clearTimeout(game.nextRoundTimer);
      game.nextRoundTimer = null;
    }
    game.rolling = false;

    io.to(gameName).emit('game_ended');
    delete games[gameName];
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
