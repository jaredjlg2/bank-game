const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// In-memory game store
const games = new Map();

/**
 * Normalize a game name to use as an internal ID / key.
 * Example: "Family Night" => "FAMILY NIGHT"
 */
function normalizeGameName(name) {
  return name.trim().toUpperCase();
}

/**
 * Simple random ID generator for player IDs and secrets.
 */
function generateId(length = 10) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * Strip out secrets / socketIds so we only send safe state to clients.
 */
function publicGame(game) {
  return {
    code: game.code, // normalized name used internally
    displayName: game.displayName, // pretty name host chose
    status: game.status,
    roundsTotal: game.roundsTotal,
    roundsCompleted: game.roundsCompleted,
    bankTotal: game.bankTotal,
    currentRollIndex: game.currentRollIndex,
    rollIntervalMs: game.rollIntervalMs,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBanker: p.isBanker,
      score: p.score,
      hasBankedThisRound: p.hasBankedThisRound,
      isConnected: p.isConnected,
    })),
  };
}

function broadcastGame(game) {
  io.to(game.code).emit("game_state", publicGame(game));
}

function resetRoundState(game) {
  game.bankTotal = 0;
  game.currentRollIndex = 0;
  game.players.forEach((p) => {
    p.hasBankedThisRound = false;
  });
}

function endRound(game, reason) {
  if (game.nextRollTimeout) {
    clearTimeout(game.nextRollTimeout);
    game.nextRollTimeout = null;
  }

  game.roundsCompleted++;

  // Game finished
  if (game.roundsCompleted >= game.roundsTotal) {
    game.status = "finished";
    const finalState = publicGame(game);
    io.to(game.code).emit("round_ended", { reason, game: finalState });
    io.to(game.code).emit("game_ended", { game: finalState });
    return;
  }

  // Between rounds
  game.status = "between_rounds";
  const betweenState = publicGame(game);
  io.to(game.code).emit("round_ended", { reason, game: betweenState });

  // Start next round after short pause
  setTimeout(() => {
    if (!games.has(game.code)) return; // game removed meanwhile
    resetRoundState(game);
    game.status = "in_round";
    broadcastGame(game);
    scheduleNextRoll(game);
  }, 3000);
}

function scheduleNextRoll(game) {
  if (game.status !== "in_round") return;
  if (game.nextRollTimeout) {
    clearTimeout(game.nextRollTimeout);
  }
  const delay = game.rollIntervalMs || 5000;
  game.nextRollTimeout = setTimeout(() => {
    performRoll(game);
  }, delay);
}

/**
 * Main dice roll logic, including all special rules.
 */
function performRoll(game) {
  if (game.status !== "in_round") return;

  // If no active players left (everyone banked / disconnected) → end round.
  let activePlayers = game.players.filter(
    (p) => !p.hasBankedThisRound && p.isConnected
  );
  if (activePlayers.length === 0) {
    endRound(game, "all_banked");
    return;
  }

  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const sum = d1 + d2;
  const isDoubles = d1 === d2;

  game.currentRollIndex = (game.currentRollIndex || 0) + 1;

  // First three rolls special handling
  if (game.currentRollIndex <= 3) {
    if (sum === 7) {
      // First three rollers: 7 = +70 points, round does NOT end
      game.bankTotal += 70;
    } else if (isDoubles) {
      // Doubles only add face value during first three rolls
      game.bankTotal += sum;
    } else {
      // Normal add
      game.bankTotal += sum;
    }
  } else {
    // From 4th roll onward
    if (sum === 7) {
      // 7 ends the round, no extra added to pot
      io.to(game.code).emit("roll", {
        d1,
        d2,
        sum,
        isDoubles,
        bankTotal: game.bankTotal,
        currentRollIndex: game.currentRollIndex,
      });
      endRound(game, "seven_after_three");
      return;
    } else if (isDoubles) {
      // Doubles double the current BANK total
      game.bankTotal = game.bankTotal * 2;
    } else {
      // Normal add
      game.bankTotal += sum;
    }
  }

  io.to(game.code).emit("roll", {
    d1,
    d2,
    sum,
    isDoubles,
    bankTotal: game.bankTotal,
    currentRollIndex: game.currentRollIndex,
  });

  // If all players have now banked this round, end the round.
  activePlayers = game.players.filter(
    (p) => !p.hasBankedThisRound && p.isConnected
  );
  if (activePlayers.length === 0) {
    endRound(game, "all_banked");
    return;
  }

  // Otherwise, continue rolling
  scheduleNextRoll(game);
}

function addPlayer(game, { socketId, name, isBanker }) {
  const id = generateId(10);
  const secret = generateId(12);
  const player = {
    id,
    secret,
    socketId,
    name,
    isBanker: !!isBanker,
    score: 0,
    hasBankedThisRound: false,
    isConnected: true,
  };
  game.players.push(player);
  return { player, playerId: id, secret };
}

io.on("connection", (socket) => {
  console.log("Client connected", socket.id);

  // Create a new game with a host-chosen name
  socket.on("create_game", (payload, cb) => {
    try {
      const { playerName, gameName, roundsTotal, rollIntervalMs } = payload;

      if (!playerName) {
        return cb && cb({ ok: false, error: "missing_player_name" });
      }

      const displayNameRaw =
        gameName && gameName.trim() ? gameName.trim() : "BANK GAME";

      const code = normalizeGameName(displayNameRaw);

      if (games.has(code)) {
        return cb && cb({ ok: false, error: "game_name_taken" });
      }

      const game = {
        code, // normalized game name (internal ID)
        displayName: displayNameRaw, // pretty label
        status: "lobby",
        roundsTotal: Number(roundsTotal) || 20,
        roundsCompleted: 0,
        bankTotal: 0,
        currentRollIndex: 0,
        rollIntervalMs: Number(rollIntervalMs) || 5000,
        nextRollTimeout: null,
        players: [],
      };

      const { playerId, secret } = addPlayer(game, {
        socketId: socket.id,
        name: playerName,
        isBanker: true,
      });

      games.set(code, game);
      socket.join(code);

      const pub = publicGame(game);
      cb && cb({ ok: true, game: pub, playerId, secret });

      broadcastGame(game);
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, error: "server_error" });
    }
  });

  // Join an existing game by its name
  socket.on("join_game", (payload, cb) => {
    try {
      const { gameCode, playerName } = payload;
      if (!gameCode) {
        return cb && cb({ ok: false, error: "missing_game_name" });
      }

      const code = normalizeGameName(gameCode);
      const game = games.get(code);

      if (!game) {
        return cb && cb({ ok: false, error: "game_not_found" });
      }

      if (game.players.length >= 24) {
        return cb && cb({ ok: false, error: "game_full" });
      }

      if (game.status !== "lobby") {
        return cb && cb({ ok: false, error: "game_already_started" });
      }

      const { playerId, secret } = addPlayer(game, {
        socketId: socket.id,
        name: playerName || "Player",
        isBanker: false,
      });

      socket.join(code);

      const pub = publicGame(game);
      cb && cb({ ok: true, game: pub, playerId, secret });

      broadcastGame(game);
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, error: "server_error" });
    }
  });

  // Reconnect a previously joined player in THIS TAB (sessionStorage)
  socket.on("reconnect_player", (payload, cb) => {
    try {
      const { gameCode, playerId, secret } = payload;
      if (!gameCode || !playerId || !secret) {
        return cb && cb({ ok: false, error: "invalid_session" });
      }

      const code = normalizeGameName(gameCode);
      const game = games.get(code);
      if (!game) {
        return cb && cb({ ok: false, error: "game_not_found" });
      }

      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.secret !== secret) {
        return cb && cb({ ok: false, error: "invalid_session" });
      }

      player.socketId = socket.id;
      player.isConnected = true;

      socket.join(code);

      const pub = publicGame(game);
      cb && cb({ ok: true, game: pub });

      broadcastGame(game);
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, error: "server_error" });
    }
  });

  // Banker starts the game
  socket.on("start_game", (payload, cb) => {
    try {
      const { gameCode, playerId } = payload;
      const code = normalizeGameName(gameCode);
      const game = games.get(code);

      if (!game) {
        return cb && cb({ ok: false, error: "game_not_found" });
      }

      const player = game.players.find((p) => p.id === playerId);
      if (!player || !player.isBanker) {
        return cb && cb({ ok: false, error: "not_banker" });
      }

      if (game.status !== "lobby") {
        return cb && cb({ ok: false, error: "already_started" });
      }

      resetRoundState(game);
      game.roundsCompleted = 0;
      game.status = "in_round";

      broadcastGame(game);
      scheduleNextRoll(game);

      cb && cb({ ok: true, game: publicGame(game) });
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false, error: "server_error" });
    }
  });

  // Player calls BANK
  socket.on("bank", (payload, cb) => {
    try {
      const { gameCode, playerId } = payload;
      const code = normalizeGameName(gameCode);
      const game = games.get(code);

      if (!game) {
        cb && cb({ ok: false });
        return;
      }

      if (game.status !== "in_round") {
        cb && cb({ ok: false });
        return;
      }

      const player = game.players.find((p) => p.id === playerId);
      if (!player || player.hasBankedThisRound) {
        cb && cb({ ok: false });
        return;
      }

      player.score += game.bankTotal;
      player.hasBankedThisRound = true;

      broadcastGame(game);
      cb && cb({ ok: true });

      const remaining = game.players.filter(
        (p) => !p.hasBankedThisRound && p.isConnected
      );
      if (remaining.length === 0) {
        endRound(game, "all_banked");
      }
    } catch (err) {
      console.error(err);
      cb && cb({ ok: false });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected", socket.id);
    // Mark matching player as offline in any game they belong to
    games.forEach((game) => {
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.isConnected = false;
        broadcastGame(game);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
