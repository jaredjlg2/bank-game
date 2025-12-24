let socket;
let currentGame = null;
let myPlayerId = null;
let mySecret = null;

// countdown state
let rollIntervalMs = null;
let nextRollTimestamp = null;
let countdownTimer = null;

// DOM elements
const lobbyEl = document.getElementById("lobby");
const gameEl = document.getElementById("game");
const lobbyErrorEl = document.getElementById("lobbyError");

const headerGameCodePill = document.getElementById("headerGameCodePill");
const headerGameCodeEl = document.getElementById("headerGameCode");

const createNameEl = document.getElementById("createName");
const createGameNameEl = document.getElementById("createGameName");
const createRoundsEl = document.getElementById("createRounds");
const createIntervalEl = document.getElementById("createInterval");
const createBtn = document.getElementById("createBtn");

const joinCodeEl = document.getElementById("joinCode");
const joinNameEl = document.getElementById("joinName");
const joinBtn = document.getElementById("joinBtn");

const gameCodeEl = document.getElementById("gameCode");
const roundInfoEl = document.getElementById("roundInfo");
const statusEl = document.getElementById("status");
const nextRollTimerEl = document.getElementById("nextRollTimer");
const bankTotalEl = document.getElementById("bankTotal");
const die1El = document.getElementById("die1");
const die2El = document.getElementById("die2");
const lastSumEl = document.getElementById("lastSum");
const lastRollInfoEl = document.getElementById("lastRollInfo");
const playersListEl = document.getElementById("playersList");
const playerCountEl = document.getElementById("playerCount");
const startBtn = document.getElementById("startBtn");
const bankBtn = document.getElementById("bankBtn");
const gameMessagesEl = document.getElementById("gameMessages");

// --------- Session helpers (PER TAB via sessionStorage) ---------

function saveSession() {
  if (!currentGame || !myPlayerId || !mySecret) return;
  const data = {
    gameCode: currentGame.code, // internal normalized ID
    playerId: myPlayerId,
    secret: mySecret,
  };
  sessionStorage.setItem("bank_session", JSON.stringify(data));
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem("bank_session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --------- UI helpers ---------

function showLobbyError(msg) {
  lobbyErrorEl.textContent = msg || "";
}

function showGameMessage(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  gameMessagesEl.appendChild(p);
  gameMessagesEl.scrollTop = gameMessagesEl.scrollHeight;
}

function switchToGame() {
  lobbyEl.classList.add("hidden");
  gameEl.classList.remove("hidden");
  headerGameCodePill.hidden = false;
}

function resetCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  nextRollTimestamp = null;
  nextRollTimerEl.textContent = "—";
}

function startCountdown() {
  if (!rollIntervalMs || rollIntervalMs <= 0) {
    resetCountdown();
    return;
  }
  if (!nextRollTimestamp) {
    nextRollTimestamp = Date.now() + rollIntervalMs;
  }

  if (countdownTimer) clearInterval(countdownTimer);

  countdownTimer = setInterval(() => {
    if (!nextRollTimestamp) {
      nextRollTimerEl.textContent = "—";
      return;
    }
    const remaining = nextRollTimestamp - Date.now();
    if (remaining <= 0) {
      nextRollTimerEl.textContent = "Rolling…";
      return;
    }
    const seconds = remaining / 1000;
    nextRollTimerEl.textContent = seconds.toFixed(1) + "s";
  }, 100);
}

// --------- Main UI update ---------

function updateUI(game) {
  currentGame = game;
  if (!game) return;

  rollIntervalMs = game.rollIntervalMs;

  const displayName = game.displayName || game.code;

  headerGameCodeEl.textContent = displayName;
  gameCodeEl.textContent = displayName;

  roundInfoEl.textContent = `${Math.min(
    game.roundsCompleted + 1,
    game.roundsTotal
  )} / ${game.roundsTotal}`;
  statusEl.textContent = game.status;
  bankTotalEl.textContent = game.bankTotal;

  // Player count
  playerCountEl.textContent = `${game.players.length} players`;

  // Sort players by score desc for leaderboard
  const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);

  playersListEl.innerHTML = "";
  sortedPlayers.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "player-row";

    const isMe = p.id === myPlayerId;
    const leaderScore = sortedPlayers[0]?.score ?? 0;
    const isLeader = leaderScore > 0 && p.score === leaderScore;

    if (isMe) li.classList.add("me");
    else if (isLeader) li.classList.add("leader");

    // rank
    const rankSpan = document.createElement("span");
    rankSpan.textContent = idx + 1;

    // name + badges
    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name-cell";
    const nameText = document.createElement("span");
    nameText.textContent = p.name;
    nameSpan.appendChild(nameText);

    if (isMe) {
      const meBadge = document.createElement("span");
      meBadge.className = "badge me";
      meBadge.textContent = "You";
      nameSpan.appendChild(meBadge);
    }

    if (p.isBanker) {
      const bankerBadge = document.createElement("span");
      bankerBadge.className = "badge banker";
      bankerBadge.textContent = "Banker";
      nameSpan.appendChild(bankerBadge);
    }

    if (p.hasBankedThisRound) {
      const bankedBadge = document.createElement("span");
      bankedBadge.className = "badge banked";
      bankedBadge.textContent = "BANKed";
      nameSpan.appendChild(bankedBadge);
    }

    if (!p.isConnected) {
      const offlineBadge = document.createElement("span");
      offlineBadge.className = "badge offline";
      offlineBadge.textContent = "Offline";
      nameSpan.appendChild(offlineBadge);
    }

    // score
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = p.score;

    // round status
    const roundSpan = document.createElement("span");
    if (game.status === "in_round") {
      if (p.hasBankedThisRound) {
        roundSpan.textContent = "Done";
      } else {
        roundSpan.textContent = "Playing";
      }
    } else if (game.status === "finished") {
      roundSpan.textContent = "Final";
    } else {
      roundSpan.textContent = "Waiting";
    }

    li.appendChild(rankSpan);
    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    li.appendChild(roundSpan);

    playersListEl.appendChild(li);
  });

  const me = game.players.find((p) => p.id === myPlayerId);

  // Start button only visible to banker in lobby
  if (me && me.isBanker && game.status === "lobby") {
    startBtn.classList.remove("hidden");
  } else {
    startBtn.classList.add("hidden");
  }

  // Bank button: enabled only if in_round and I haven't banked
  if (game.status === "in_round" && me && !me.hasBankedThisRound) {
    bankBtn.disabled = false;
  } else {
    bankBtn.disabled = true;
  }

  // Countdown: only when in_round
  if (game.status === "in_round") {
    if (!nextRollTimestamp) {
      // Kick off a new countdown if we don't know the next timestamp yet
      nextRollTimestamp = Date.now() + rollIntervalMs;
    }
    startCountdown();
  } else {
    resetCountdown();
  }
}

// --------- Socket setup ---------

function connectSocket() {
  socket = io(); // connects to same origin

  socket.on("connect", () => {
    console.log("Connected to server", socket.id);
    const session = loadSession();
    if (session) {
      socket.emit("reconnect_player", session, (res) => {
        if (res.ok) {
          currentGame = res.game;
          myPlayerId = session.playerId;
          mySecret = session.secret;
          switchToGame();
          updateUI(res.game);
          showGameMessage("Reconnected to game.");
        } else {
          sessionStorage.removeItem("bank_session");
        }
      });
    }
  });

  socket.on("game_state", (payload) => {
    updateUI(payload);
  });

  socket.on("roll", (payload) => {
    const { d1, d2, sum, isDoubles, bankTotal, currentRollIndex } = payload;
    die1El.textContent = d1;
    die2El.textContent = d2;
    lastSumEl.textContent = sum;
    bankTotalEl.textContent = bankTotal;

    // Reset countdown from now
    if (rollIntervalMs) {
      nextRollTimestamp = Date.now() + rollIntervalMs;
      startCountdown();
    }

    let info = `Roll #${currentRollIndex}: ${d1} + ${d2} = ${sum}`;
    if (sum === 7 && currentRollIndex <= 3) {
      info += " → 7 on first 3 rolls: +70!";
    } else if (sum === 7) {
      info += " → Round ends on 7!";
    } else if (isDoubles && currentRollIndex <= 3) {
      info += " → Doubles (face value added).";
    } else if (isDoubles) {
      info += " → Doubles (BANK doubled!).";
    }
    lastRollInfoEl.textContent = info;
  });

  socket.on("round_ended", ({ reason, game }) => {
    updateUI(game);
    resetCountdown();
    if (reason === "seven_after_three") {
      showGameMessage("Round ended: 7 rolled.");
    } else if (reason === "all_banked") {
      showGameMessage("Round ended: everyone has BANKed.");
    } else {
      showGameMessage("Round ended.");
    }
  });

  socket.on("game_ended", ({ game }) => {
    updateUI(game);
    resetCountdown();
    showGameMessage("Game finished! Final scores locked in.");
  });

  socket.on("error", (payload) => {
    showGameMessage("Error: " + payload.message);
  });

  socket.on("disconnect", () => {
    showGameMessage("Disconnected from server. Attempting to reconnect…");
  });
}

// --------- Button handlers ---------

createBtn.addEventListener("click", () => {
  showLobbyError("");
  const name = createNameEl.value.trim() || "Player";
  const gameName = createGameNameEl.value.trim() || "BANK GAME";
  const roundsTotal = parseInt(createRoundsEl.value, 10);
  const rollIntervalMsVal = parseInt(createIntervalEl.value, 10);

  socket.emit(
    "create_game",
    { playerName: name, gameName, roundsTotal, rollIntervalMs: rollIntervalMsVal },
    (res) => {
      if (!res.ok) {
        if (res.error === "game_name_taken") {
          showLobbyError("That game name is already in use. Pick another.");
        } else {
          showLobbyError("Could not create game: " + res.error);
        }
        return;
      }
      currentGame = res.game;
      myPlayerId = res.playerId;
      mySecret = res.secret;
      rollIntervalMs = res.game.rollIntervalMs;
      saveSession();
      switchToGame();
      updateUI(res.game);
      showGameMessage("Game created. Share name: " + res.game.displayName);
    }
  );
});

joinBtn.addEventListener("click", () => {
  showLobbyError("");
  const code = joinCodeEl.value.trim();
  const name = joinNameEl.value.trim() || "Player";

  if (!code) {
    showLobbyError("Enter a game name.");
    return;
  }

  socket.emit("join_game", { gameCode: code, playerName: name }, (res) => {
    if (!res.ok) {
      let msg = "Could not join game.";
      if (res.error === "game_not_found") msg = "Game not found.";
      if (res.error === "game_full") msg = "Game is full (max 24 players).";
      if (res.error === "game_already_started")
        msg = "Game already started.";
      if (res.error === "missing_game_name")
        msg = "Enter a game name.";
      showLobbyError(msg);
      return;
    }
    currentGame = res.game;
    myPlayerId = res.playerId;
    mySecret = res.secret;
    rollIntervalMs = res.game.rollIntervalMs;
    saveSession();
    switchToGame();
    updateUI(res.game);
    showGameMessage("Joined game " + res.game.displayName);
  });
});

startBtn.addEventListener("click", () => {
  if (!currentGame || !myPlayerId) return;
  socket.emit(
    "start_game",
    { gameCode: currentGame.code, playerId: myPlayerId },
    (res) => {
      if (!res.ok) {
        showGameMessage("Cannot start game: " + res.error);
        return;
      }
      currentGame = res.game;
      rollIntervalMs = res.game.rollIntervalMs;
      updateUI(res.game);
      showGameMessage("Game started!");
    }
  );
});

bankBtn.addEventListener("click", () => {
  if (!currentGame || !myPlayerId) return;
  socket.emit(
    "bank",
    { gameCode: currentGame.code, playerId: myPlayerId },
    (res) => {
      if (!res || !res.ok) {
        showGameMessage("BANK failed.");
        return;
      }
      showGameMessage("You BANKed this round!");
    }
  );
});

document.addEventListener("DOMContentLoaded", () => {
  connectSocket();
});
