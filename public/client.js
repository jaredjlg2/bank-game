const socket = io();

// Lobby elements
const lobbySection = document.getElementById('lobby');
const playerNameInput = document.getElementById('playerName');
const gameNameInput = document.getElementById('gameName');
const roundsSelect = document.getElementById('roundsSelect');
const intervalSelect = document.getElementById('intervalSelect');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const lobbyError = document.getElementById('lobbyError');

// Game elements
const gameSection = document.getElementById('game');
const gameNameLabel = document.getElementById('gameNameLabel');
const roundLabel = document.getElementById('roundLabel');
const totalRoundsLabel = document.getElementById('totalRoundsLabel');
const phaseLabel = document.getElementById('phaseLabel');
const rollCounterLabel = document.getElementById('rollCounterLabel');
const potValue = document.getElementById('potValue');
const phaseBadge = document.getElementById('phaseBadge');
const potCard = document.getElementById('potCard');

const timerLabel = document.getElementById('timerLabel');
const rollerLabel = document.getElementById('rollerLabel');
const playersList = document.getElementById('playersList');
const dice1El = document.getElementById('dice1');
const dice2El = document.getElementById('dice2');
const rollSummary = document.getElementById('rollSummary');
const diceCard = document.querySelector('.dice-card');

const startGameBtn = document.getElementById('startGameBtn');
const bankBtn = document.getElementById('bankBtn');
const restartBtn = document.getElementById('restartBtn');
const gameMessage = document.getElementById('gameMessage');

// Audio elements
const diceRollSound = document.getElementById('diceRollSound');
const doubleSound = document.getElementById('doubleSound');
const bustSound = document.getElementById('bustSound');
const bankSound = document.getElementById('bankSound');

// Local state
let currentGameName = null;
let currentPlayerName = null;
let isHost = false;
let countdownInterval = null;
let lastRollSecondsToNext = null;
let potBustTimeout = null;
let doubleFlashTimeout = null;

function triggerDoubleFlash() {
  if (!diceCard) return;
  diceCard.classList.remove('double-flash');
  rollSummary.classList.remove('double-text');

  void diceCard.offsetWidth;
  diceCard.classList.add('double-flash');
  rollSummary.classList.add('double-text');

  if (doubleFlashTimeout) {
    clearTimeout(doubleFlashTimeout);
  }

  doubleFlashTimeout = setTimeout(() => {
    diceCard.classList.remove('double-flash');
    rollSummary.classList.remove('double-text');
    doubleFlashTimeout = null;
  }, 2600);
}

function showLobby() {
  gameSection.classList.add('hidden');
  lobbySection.classList.remove('hidden');
}

function showGame() {
  lobbySection.classList.add('hidden');
  gameSection.classList.remove('hidden');
}

function safePlay(audioEl) {
  if (!audioEl) return;
  const p = audioEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => {});
  }
}

// Update phase visual styling
function updatePhaseVisual(phase) {
  phaseLabel.textContent = phase;
  if (phase <= 1) {
    phaseBadge.textContent = 'Phase 1 · Safe Rolls';
    phaseBadge.classList.remove('phase-danger');
    phaseBadge.classList.add('phase-safe');
  } else {
    phaseBadge.textContent = 'Danger Zone · 7 erases the pot!';
    phaseBadge.classList.remove('phase-safe');
    phaseBadge.classList.add('phase-danger');
  }
}

function updateRollCounter(rollNumber) {
  rollCounterLabel.textContent = rollNumber > 0 ? `#${rollNumber}` : '—';
}

// Countdown timer between rolls (visual only)
function startCountdown(seconds) {
  if (!seconds) {
    timerLabel.textContent = '—';
    return;
  }

  if (countdownInterval) clearInterval(countdownInterval);

  let remaining = seconds;
  timerLabel.textContent = `${remaining}s`;

  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      timerLabel.textContent = 'Rolling…';
    } else {
      timerLabel.textContent = `${remaining}s`;
    }
  }, 1000);
}

// Render players list
function renderPlayers(players, currentRollerName) {
  playersList.innerHTML = '';

  players.forEach(player => {
    const row = document.createElement('div');
    row.className = 'player-row';

    if (player.name === currentRollerName) {
      row.classList.add('player-current');
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = player.name;

    const scoreEl = document.createElement('div');
    scoreEl.className = 'player-score';
    scoreEl.textContent = player.score;

    const statusEl = document.createElement('div');
    if (player.hasBanked) {
      statusEl.className = 'player-banked-tag';
      statusEl.textContent = 'BANKED';
    }

    row.appendChild(nameEl);
    row.appendChild(scoreEl);
    row.appendChild(statusEl);

    playersList.appendChild(row);
  });
}

// Control Start Game button visibility
function updateStartButtonVisibility(state) {
  if (!isHost) {
    startGameBtn.classList.add('hidden');
    return;
  }

  // Show Start Game only before any rolls have happened (rollNumber === 0)
  if (state.rollNumber === 0 && state.round === 1) {
    startGameBtn.classList.remove('hidden');
  } else {
    startGameBtn.classList.add('hidden');
  }
}

// --- Socket event handlers ---

socket.on('joined_game', ({ gameName, isHost: hostFlag }) => {
  currentGameName = gameName;
  isHost = hostFlag;
  gameNameLabel.textContent = gameName;
  lobbyError.textContent = '';
  showGame();

  restartBtn.classList.add('hidden');
  // Start button visibility will be updated when we receive game_state
});

socket.on('game_state', (state) => {
  if (!state || state.gameName !== currentGameName) return;

  roundLabel.textContent = state.round;
  totalRoundsLabel.textContent = state.totalRounds;
  potValue.textContent = state.pot;
  updatePhaseVisual(state.phase || 1);
  updateRollCounter(state.rollNumber || 0);

  renderPlayers(state.players, null);
  updateStartButtonVisibility(state);
});

socket.on('roll_result', (roll) => {
  if (!roll || roll.gameName !== currentGameName) return;

  dice1El.textContent = roll.dice1;
  dice2El.textContent = roll.dice2;
  potValue.textContent = roll.pot;
  rollerLabel.textContent = roll.rollerName || '—';
  updatePhaseVisual(roll.phase);
  updateRollCounter(roll.rollNumber || 0);

  let summaryText = `${roll.rollerName} rolled ${roll.dice1} + ${roll.dice2} = ${roll.sum}. `;
  if (roll.phase <= 1) {
    summaryText += 'Phase 1 (safe). ';
    if (roll.isSeven) {
      summaryText += '7 counts as 70 points!';
    } else if (roll.isDouble) {
      summaryText = `DOUBLE! ${summaryText}Doubles add face value only.`;
    } else {
      summaryText += 'Pot increases by the roll.';
    }
  } else {
    summaryText += 'Danger Zone! ';
    if (roll.isSeven) {
      summaryText += '7 rolled — pot crashes to 0!';
    } else if (roll.isDouble) {
      summaryText = `DOUBLE! ${summaryText}Doubles the pot!`;
    } else {
      summaryText += 'Pot increases by the roll.';
    }
  }

  rollSummary.textContent = summaryText;

  if (roll.players) {
    renderPlayers(roll.players, roll.rollerName);
  }

  lastRollSecondsToNext = roll.secondsToNextRoll || null;
  startCountdown(lastRollSecondsToNext);

  // Rolls are happening – make sure Start Game is hidden
  startGameBtn.classList.add('hidden');

  // Play sounds
  if (roll.phase === 2 && roll.isSeven) {
    safePlay(bustSound);
    potCard.classList.add('pot-bust');
    if (potBustTimeout) {
      clearTimeout(potBustTimeout);
    }
    potBustTimeout = setTimeout(() => {
      potCard.classList.remove('pot-bust');
      potBustTimeout = null;
    }, 3000);
  } else if (roll.isDouble) {
    safePlay(doubleSound);
    potCard.classList.remove('pot-bust');
    triggerDoubleFlash();
  } else {
    safePlay(diceRollSound);
    potCard.classList.remove('pot-bust');
    rollSummary.classList.remove('double-text');
    if (diceCard) {
      diceCard.classList.remove('double-flash');
    }
  }
});

socket.on('player_banked', (data) => {
  if (!data) return;
  gameMessage.textContent = `${data.name} BANKED ${data.pot} points!`;
  safePlay(bankSound);
  setTimeout(() => {
    if (gameMessage.textContent.startsWith(data.name)) {
      gameMessage.textContent = '';
    }
  }, 3000);
});

socket.on('round_ended', ({ round, reason, pot, nextRoundDelay }) => {
  let msg;
  if (reason === 'seven') {
    msg = `Round ${round} ended: someone rolled a 7 in the Danger Zone. Pot crashed to 0.`;
  } else {
    msg = `Round ${round} ended: everyone banked or sat out.`;
  }
  gameMessage.textContent = msg;
  if (nextRoundDelay) {
    startCountdown(nextRoundDelay);
  } else {
    timerLabel.textContent = '—';
  }
});

socket.on('game_over', ({ players }) => {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const lines = sorted.map((p, idx) => `${idx + 1}. ${p.name}: ${p.score}`);

  gameMessage.innerHTML = `<span class="game-over">Game over!</span> Winner: ${winner.name} with ${winner.score} points.<br>${lines.join('<br>')}`;

  restartBtn.classList.remove('hidden');
  startGameBtn.classList.add('hidden');
});

socket.on('error_message', (msg) => {
  lobbyError.textContent = msg;
});

// --- Button handlers ---

createGameBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  const gameName = gameNameInput.value.trim();
  const totalRounds = parseInt(roundsSelect.value, 10) || 20;
  const rollInterval = parseInt(intervalSelect.value, 10) || 5;

  if (!playerName || !gameName) {
    lobbyError.textContent = 'Please enter both your name and a game name.';
    return;
  }

  currentPlayerName = playerName;
  socket.emit('create_game', { gameName, playerName, totalRounds, rollInterval });
});

joinGameBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  const gameName = gameNameInput.value.trim();

  if (!playerName || !gameName) {
    lobbyError.textContent = 'Please enter both your name and a game name.';
    return;
  }

  currentPlayerName = playerName;
  socket.emit('join_game', { gameName, playerName });
});

startGameBtn.addEventListener('click', () => {
  if (!isHost || !currentGameName) return;
  gameMessage.textContent = '';
  rollSummary.textContent = 'Waiting for first roll…';
  dice1El.textContent = '–';
  dice2El.textContent = '–';
  updateRollCounter(0);
  socket.emit('start_game', { gameName: currentGameName });
  startGameBtn.classList.add('hidden');
});

restartBtn.addEventListener('click', () => {
  if (!isHost || !currentGameName) return;
  gameMessage.textContent = '';
  rollSummary.textContent = 'Waiting for first roll…';
  dice1El.textContent = '–';
  dice2El.textContent = '–';
  updateRollCounter(0);
  socket.emit('start_game', { gameName: currentGameName });
  restartBtn.classList.add('hidden');
});

bankBtn.addEventListener('click', () => {
  if (!currentGameName || !currentPlayerName) return;
  socket.emit('bank', { gameName: currentGameName, playerName: currentPlayerName });
  safePlay(bankSound);
});

// On first load, show lobby
showLobby();
