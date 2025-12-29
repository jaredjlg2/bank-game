const socket = io();

// Lobby elements
const lobbySection = document.getElementById('lobby');
const playerNameInput = document.getElementById('playerName');
const gameNameRow = document.getElementById('gameNameRow');
const gameNameInput = document.getElementById('gameName');
const gameModeInputs = document.querySelectorAll('input[name="gameMode"]');
const roundsSelect = document.getElementById('roundsSelect');
const intervalSelect = document.getElementById('intervalSelect');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const lobbyError = document.getElementById('lobbyError');
const highScoresList = document.getElementById('highScoresList');
const highScoresEmpty = document.getElementById('highScoresEmpty');

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
const endGameBtn = document.getElementById('endGameBtn');
const gameMessage = document.getElementById('gameMessage');
const shareLinkBtn = document.getElementById('shareLinkBtn');
const shareQrBtn = document.getElementById('shareQrBtn');
const shareStatus = document.getElementById('shareStatus');
const qrModal = document.getElementById('qrModal');
const qrImage = document.getElementById('qrImage');
const qrCloseBtn = document.getElementById('qrCloseBtn');
const qrLinkLabel = document.getElementById('qrLinkLabel');
const howToPlayModal = document.getElementById('howToPlayModal');
const howToCloseBtn = document.getElementById('howToCloseBtn');
const howToPlayLobbyBtn = document.getElementById('howToPlayLobbyBtn');
const howToPlayGameBtn = document.getElementById('howToPlayGameBtn');
const pushToTalkBtn = document.getElementById('pushToTalkBtn');
const groupMuteBtn = document.getElementById('groupMuteBtn');
const voiceStatus = document.getElementById('voiceStatus');
const voiceHint = document.getElementById('voiceHint');
const remoteAudio = document.getElementById('remoteAudio');

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
let diceRollAnimationTimeout = null;
let diceRollInterval = null;
let isGameComplete = false;
let startGamePending = false;
let startGamePendingTimeout = null;
let localStream = null;
let localAudioTrack = null;
let peerConnections = new Map();
let isPushToTalkActive = false;
let isGroupMuted = false;

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function getSelectedGameMode() {
  const selected = document.querySelector('input[name="gameMode"]:checked');
  return selected ? selected.value : 'multi';
}

function updateLobbyModeUI() {
  const isSinglePlayer = getSelectedGameMode() === 'single';
  if (gameNameRow) {
    gameNameRow.classList.toggle('hidden', isSinglePlayer);
  }
  if (joinGameBtn) {
    joinGameBtn.classList.toggle('hidden', isSinglePlayer);
  }
  if (createGameBtn) {
    createGameBtn.textContent = isSinglePlayer ? 'Start Solo Game' : 'Create Game';
  }
}

function updateVoiceStatus(message) {
  if (voiceStatus) {
    voiceStatus.textContent = message;
  }
}

function updatePushToTalkLabel() {
  if (!pushToTalkBtn) return;
  pushToTalkBtn.textContent = isPushToTalkActive ? 'Mic On' : 'Mic Off';
  pushToTalkBtn.setAttribute('aria-pressed', String(isPushToTalkActive));
}

function updateGroupMuteUI() {
  if (!groupMuteBtn) return;
  groupMuteBtn.classList.toggle('hidden', !isHost);
  groupMuteBtn.textContent = isGroupMuted ? 'Unmute Group' : 'Mute Group';
}

function setPushToTalkState(isActive) {
  if (!localAudioTrack) return;
  localAudioTrack.enabled = isActive;
  isPushToTalkActive = isActive;
  if (pushToTalkBtn) {
    pushToTalkBtn.classList.toggle('ptt-active', isActive);
  }
  updatePushToTalkLabel();
  updateVoiceStatus(isActive ? 'Talking…' : 'Mic muted');
}

function stopPushToTalk() {
  if (isPushToTalkActive) {
    setPushToTalkState(false);
  }
}

function applyGroupMuteState(muted) {
  isGroupMuted = Boolean(muted);
  updateGroupMuteUI();

  if (isGroupMuted && !isHost) {
    stopPushToTalk();
    if (pushToTalkBtn) {
      pushToTalkBtn.disabled = true;
    }
    updateVoiceStatus('Group muted by host.');
    return;
  }

  if (pushToTalkBtn) {
    pushToTalkBtn.disabled = !currentGameName;
  }

  if (localAudioTrack) {
    updateVoiceStatus(isPushToTalkActive ? 'Talking…' : 'Mic muted');
  } else {
    updateVoiceStatus('Tap the mic button to enable your mic.');
  }
}

function attachRemoteStream(peerId, stream) {
  if (!remoteAudio) return;
  let audioEl = document.getElementById(`remote-audio-${peerId}`);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `remote-audio-${peerId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    remoteAudio.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
}

function removeRemoteAudio(peerId) {
  const audioEl = document.getElementById(`remote-audio-${peerId}`);
  if (!audioEl) return;
  audioEl.srcObject = null;
  audioEl.remove();
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections.set(peerId, pc);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  } else {
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate || !currentGameName) return;
    socket.emit('voice_ice', {
      gameName: currentGameName,
      targetId: peerId,
      candidate: event.candidate
    });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) {
      attachRemoteStream(peerId, stream);
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      closePeerConnection(peerId);
    }
  };

  return pc;
}

function closePeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc) return;
  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.close();
  peerConnections.delete(peerId);
  removeRemoteAudio(peerId);
}

async function createAndSendOffer(peerId) {
  if (!currentGameName) return;
  const pc = createPeerConnection(peerId);
  if (pc.signalingState !== 'stable') return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('voice_offer', {
    gameName: currentGameName,
    targetId: peerId,
    description: pc.localDescription
  });
}

async function renegotiateAllPeers() {
  const tasks = [];
  peerConnections.forEach((pc, peerId) => {
    if (pc.signalingState === 'stable') {
      tasks.push(createAndSendOffer(peerId));
    }
  });
  if (tasks.length) {
    await Promise.allSettled(tasks);
  }
}

async function ensureLocalAudio() {
  if (localStream) return localStream;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    localStream = stream;
    localAudioTrack = stream.getAudioTracks()[0] || null;

    if (localAudioTrack) {
      localAudioTrack.enabled = false;
    }

    updateVoiceStatus('Mic ready. Toggle to talk.');
    if (pushToTalkBtn) {
      pushToTalkBtn.disabled = !isHost && isGroupMuted;
    }

    peerConnections.forEach(pc => {
      if (!localAudioTrack) return;
      const hasAudioSender = pc.getSenders().some(sender => sender.track && sender.track.kind === 'audio');
      if (!hasAudioSender) {
        pc.addTrack(localAudioTrack, localStream);
      }
      pc.getTransceivers().forEach(transceiver => {
        if (transceiver.receiver.track && transceiver.receiver.track.kind === 'audio') {
          transceiver.direction = 'sendrecv';
        }
      });
    });

    await renegotiateAllPeers();
    return stream;
  } catch (err) {
    updateVoiceStatus('Microphone blocked. Allow mic access to talk.');
    if (pushToTalkBtn) {
      pushToTalkBtn.disabled = true;
    }
    return null;
  }
}

function resetVoiceChat() {
  stopPushToTalk();
  peerConnections.forEach((_, peerId) => closePeerConnection(peerId));
  peerConnections = new Map();

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    localAudioTrack = null;
  }

  if (pushToTalkBtn) {
    pushToTalkBtn.disabled = true;
    pushToTalkBtn.classList.remove('ptt-active');
  }
  updatePushToTalkLabel();
  isGroupMuted = false;
  updateGroupMuteUI();

  updateVoiceStatus('Join a game to enable voice chat.');
  if (voiceHint) {
    voiceHint.textContent = 'Press Space or tap the button to toggle your mic.';
  }
  if (remoteAudio) {
    remoteAudio.innerHTML = '';
  }
}

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

function beginDiceRolling() {
  if (!diceCard || diceRollInterval) return;
  diceCard.classList.add('dice-rolling');
  diceRollInterval = setInterval(() => {
    dice1El.textContent = Math.floor(Math.random() * 6) + 1;
    dice2El.textContent = Math.floor(Math.random() * 6) + 1;
  }, 140);
}

function stopDiceRolling() {
  if (diceRollAnimationTimeout) {
    clearTimeout(diceRollAnimationTimeout);
    diceRollAnimationTimeout = null;
  }
  if (diceRollInterval) {
    clearInterval(diceRollInterval);
    diceRollInterval = null;
  }
  if (diceCard) {
    diceCard.classList.remove('dice-rolling');
  }
}

function scheduleDiceRolling(secondsToNextRoll) {
  stopDiceRolling();
  if (!secondsToNextRoll) return;
  const leadTimeSeconds = 2.5;
  const delaySeconds = Math.max(secondsToNextRoll - leadTimeSeconds, 0);
  diceRollAnimationTimeout = setTimeout(beginDiceRolling, delaySeconds * 1000);
}

function showLobby() {
  gameSection.classList.add('hidden');
  lobbySection.classList.remove('hidden');
  updateShareState(null);
}

function showGame() {
  lobbySection.classList.add('hidden');
  gameSection.classList.remove('hidden');
}

function resetGameUI() {
  stopDiceRolling();
  gameMessage.textContent = '';
  rollSummary.textContent = 'Waiting for first roll…';
  dice1El.textContent = '–';
  dice2El.textContent = '–';
  potValue.textContent = '0';
  rollerLabel.textContent = '—';
  timerLabel.textContent = '—';
  updatePhaseVisual(1);
  updateRollCounter(0);
  playersList.innerHTML = '';
  startGameBtn.classList.add('hidden');
  startGameBtn.disabled = false;
  startGameBtn.textContent = 'Start Game';
  restartBtn.classList.add('hidden');
  endGameBtn.classList.add('hidden');
  bankBtn.disabled = false;
  isGameComplete = false;
  startGamePending = false;
  if (startGamePendingTimeout) {
    clearTimeout(startGamePendingTimeout);
    startGamePendingTimeout = null;
  }
  resetVoiceChat();
  updateShareState(null);
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

function buildShareUrl(gameName) {
  const baseUrl = window.location.origin || window.location.href;
  const url = new URL(baseUrl);
  url.searchParams.set('game', gameName);
  return url.toString();
}

function updateShareState(gameName) {
  const isReady = Boolean(gameName);
  if (shareLinkBtn) {
    shareLinkBtn.disabled = !isReady;
  }
  if (shareQrBtn) {
    shareQrBtn.disabled = !isReady;
  }
  if (shareStatus) {
    shareStatus.textContent = isReady ? '' : 'Join a game to share the link.';
  }
  if (!isReady && qrModal) {
    qrModal.classList.add('hidden');
  }
}

async function copyShareLink() {
  if (!currentGameName) return;
  const url = buildShareUrl(currentGameName);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const tempInput = document.createElement('textarea');
      tempInput.value = url;
      tempInput.setAttribute('readonly', '');
      tempInput.style.position = 'absolute';
      tempInput.style.left = '-9999px';
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand('copy');
      tempInput.remove();
    }
    if (shareStatus) {
      shareStatus.textContent = 'Link copied to clipboard.';
    }
  } catch (err) {
    if (shareStatus) {
      shareStatus.textContent = 'Unable to copy. You can still share the QR code.';
    }
  }
}

function openQrModal() {
  if (!currentGameName || !qrModal || !qrImage) return;
  const url = buildShareUrl(currentGameName);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  qrImage.src = qrUrl;
  qrImage.alt = `QR code for ${currentGameName}`;
  if (qrLinkLabel) {
    qrLinkLabel.textContent = url;
  }
  qrModal.classList.remove('hidden');
}

function closeQrModal() {
  if (!qrModal) return;
  qrModal.classList.add('hidden');
}

function openHowToModal() {
  if (!howToPlayModal) return;
  howToPlayModal.classList.remove('hidden');
}

function closeHowToModal() {
  if (!howToPlayModal) return;
  howToPlayModal.classList.add('hidden');
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

  const sortedPlayers = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  sortedPlayers.forEach(player => {
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
  if (state.rollNumber === 0 && state.round === 1 && !state.isComplete) {
    startGameBtn.classList.remove('hidden');
  } else {
    startGameBtn.classList.add('hidden');
  }
}

function markStartGamePending() {
  startGamePending = true;
  startGameBtn.disabled = true;
  startGameBtn.textContent = 'Starting…';

  if (startGamePendingTimeout) {
    clearTimeout(startGamePendingTimeout);
  }

  startGamePendingTimeout = setTimeout(() => {
    if (!startGamePending) return;
    startGamePending = false;
    startGameBtn.disabled = false;
    startGameBtn.textContent = 'Start Game';
    gameMessage.textContent = 'No rolls yet. Tap Start Game to try again.';
    startGamePendingTimeout = null;
  }, 8000);
}

function clearStartGamePending() {
  if (!startGamePending) return;
  startGamePending = false;
  startGameBtn.disabled = false;
  startGameBtn.textContent = 'Start Game';
  if (startGamePendingTimeout) {
    clearTimeout(startGamePendingTimeout);
    startGamePendingTimeout = null;
  }
}

function renderHighScores(scores) {
  if (!highScoresList || !highScoresEmpty) return;
  highScoresList.innerHTML = '';

  if (!scores || scores.length === 0) {
    highScoresEmpty.classList.remove('hidden');
    return;
  }

  highScoresEmpty.classList.add('hidden');
  scores.forEach((entry, index) => {
    const row = document.createElement('li');
    row.className = 'high-score-row';
    row.innerHTML = `<span class="high-score-rank">#${index + 1}</span><span class="high-score-name">${entry.name}</span><span class="high-score-value">${entry.score}</span>`;
    highScoresList.appendChild(row);
  });
}

// --- Socket event handlers ---

socket.on('joined_game', ({ gameName, isHost: hostFlag, groupMuted }) => {
  currentGameName = gameName;
  isHost = hostFlag;
  isGroupMuted = Boolean(groupMuted);
  gameNameLabel.textContent = gameName;
  lobbyError.textContent = '';
  showGame();
  updateShareState(gameName);

  if (pushToTalkBtn) {
    pushToTalkBtn.disabled = !isHost && isGroupMuted;
  }
  updatePushToTalkLabel();
  applyGroupMuteState(isGroupMuted);

  restartBtn.classList.add('hidden');
  endGameBtn.classList.add('hidden');
  // Start button visibility will be updated when we receive game_state
});

socket.on('game_state', (state) => {
  if (!state || state.gameName !== currentGameName) return;

  roundLabel.textContent = state.round;
  totalRoundsLabel.textContent = state.totalRounds;
  potValue.textContent = state.pot;
  updatePhaseVisual(state.phase || 1);
  updateRollCounter(state.rollNumber || 0);
  isGameComplete = Boolean(state.isComplete);
  bankBtn.disabled = isGameComplete;
  if (isGameComplete) {
    endGameBtn.classList.remove('hidden');
  } else {
    endGameBtn.classList.add('hidden');
  }

  renderPlayers(state.players, null);
  updateStartButtonVisibility(state);

  if (state.rollNumber > 0) {
    clearStartGamePending();
  }
});

socket.on('roll_result', (roll) => {
  if (!roll || roll.gameName !== currentGameName) return;

  stopDiceRolling();
  clearStartGamePending();
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
  scheduleDiceRolling(lastRollSecondsToNext);

  // Rolls are happening – make sure Start Game is hidden
  startGameBtn.classList.add('hidden');
  endGameBtn.classList.add('hidden');
  bankBtn.disabled = false;

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
  } else if (roll.phase === 2 && roll.isDouble) {
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
  stopDiceRolling();
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
  stopDiceRolling();
  clearStartGamePending();
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const lines = sorted.map((p, idx) => `${idx + 1}. ${p.name}: ${p.score}`);

  gameMessage.innerHTML = `<span class="game-over">Game over!</span> Winner: ${winner.name} with ${winner.score} points.<br>${lines.join('<br>')}`;

  startGameBtn.classList.add('hidden');
  restartBtn.classList.toggle('hidden', !isHost);
  endGameBtn.classList.remove('hidden');
  bankBtn.disabled = true;
  isGameComplete = true;
});

socket.on('game_ended', () => {
  resetGameUI();
  currentGameName = null;
  currentPlayerName = null;
  isHost = false;
  showLobby();
});

socket.on('high_scores', ({ scores }) => {
  renderHighScores(scores);
});

socket.on('error_message', (msg) => {
  lobbyError.textContent = msg;
});

socket.on('voice_peer_joined', ({ id }) => {
  if (!id || id === socket.id) return;
  createAndSendOffer(id).catch(() => {});
});

socket.on('voice_offer', async ({ from, description }) => {
  if (!from || !description || !currentGameName) return;
  const pc = createPeerConnection(from);
  await pc.setRemoteDescription(description);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('voice_answer', {
    gameName: currentGameName,
    targetId: from,
    description: pc.localDescription
  });
});

socket.on('voice_answer', async ({ from, description }) => {
  if (!from || !description) return;
  const pc = peerConnections.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(description);
});

socket.on('voice_ice', async ({ from, candidate }) => {
  if (!from || !candidate) return;
  const pc = peerConnections.get(from);
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    // Ignore failed ICE candidates
  }
});

socket.on('voice_peer_left', ({ id }) => {
  if (!id) return;
  closePeerConnection(id);
});

socket.on('voice_group_muted', ({ muted }) => {
  applyGroupMuteState(muted);
});

// --- Button handlers ---
updateLobbyModeUI();
gameModeInputs.forEach(input => {
  input.addEventListener('change', () => {
    updateLobbyModeUI();
    lobbyError.textContent = '';
  });
});

createGameBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  const selectedMode = getSelectedGameMode();
  const gameName = gameNameInput.value.trim();
  const totalRounds = parseInt(roundsSelect.value, 10) || 20;
  const rollInterval = parseInt(intervalSelect.value, 10) || 5;
  const resolvedGameName = selectedMode === 'single'
    ? `Solo-${Date.now()}`
    : gameName;

  if (!playerName || (selectedMode !== 'single' && !gameName)) {
    lobbyError.textContent = selectedMode === 'single'
      ? 'Please enter your name.'
      : 'Please enter both your name and a game name.';
    return;
  }

  currentPlayerName = playerName;
  socket.emit('create_game', {
    gameName: resolvedGameName,
    playerName,
    totalRounds,
    rollInterval
  });
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
  stopDiceRolling();
  gameMessage.textContent = '';
  rollSummary.textContent = 'Waiting for first roll…';
  dice1El.textContent = '–';
  dice2El.textContent = '–';
  updateRollCounter(0);
  socket.emit('start_game', { gameName: currentGameName });
  markStartGamePending();
  endGameBtn.classList.add('hidden');
  bankBtn.disabled = false;
});

restartBtn.addEventListener('click', () => {
  if (!isHost || !currentGameName) return;
  stopDiceRolling();
  gameMessage.textContent = '';
  rollSummary.textContent = 'Waiting for first roll…';
  dice1El.textContent = '–';
  dice2El.textContent = '–';
  updateRollCounter(0);
  socket.emit('start_game', { gameName: currentGameName });
  restartBtn.classList.add('hidden');
  endGameBtn.classList.add('hidden');
  bankBtn.disabled = false;
});

bankBtn.addEventListener('click', () => {
  if (!currentGameName || !currentPlayerName) return;
  socket.emit('bank', { gameName: currentGameName, playerName: currentPlayerName });
  safePlay(bankSound);
});

endGameBtn.addEventListener('click', () => {
  if (!currentGameName) return;
  socket.emit('end_game', { gameName: currentGameName });
});

if (groupMuteBtn) {
  groupMuteBtn.addEventListener('click', () => {
    if (!isHost || !currentGameName) return;
    socket.emit('toggle_group_mute', { gameName: currentGameName });
  });
}

if (shareLinkBtn) {
  shareLinkBtn.addEventListener('click', () => {
    copyShareLink();
  });
}

if (shareQrBtn) {
  shareQrBtn.addEventListener('click', () => {
    openQrModal();
  });
}

if (qrCloseBtn) {
  qrCloseBtn.addEventListener('click', () => {
    closeQrModal();
  });
}

if (qrModal) {
  qrModal.addEventListener('click', (event) => {
    if (event.target === qrModal) {
      closeQrModal();
    }
  });
}

if (howToPlayLobbyBtn) {
  howToPlayLobbyBtn.addEventListener('click', () => {
    openHowToModal();
  });
}

if (howToPlayGameBtn) {
  howToPlayGameBtn.addEventListener('click', () => {
    openHowToModal();
  });
}

if (howToCloseBtn) {
  howToCloseBtn.addEventListener('click', () => {
    closeHowToModal();
  });
}

if (howToPlayModal) {
  howToPlayModal.addEventListener('click', (event) => {
    if (event.target === howToPlayModal) {
      closeHowToModal();
    }
  });
}

async function togglePushToTalk() {
  if (!currentGameName) return;
  if (isGroupMuted && !isHost) {
    updateVoiceStatus('Group muted by host.');
    return;
  }
  if (isPushToTalkActive) {
    setPushToTalkState(false);
    return;
  }
  const stream = await ensureLocalAudio();
  if (!stream || !localAudioTrack) return;
  setPushToTalkState(true);
}

if (pushToTalkBtn) {
  pushToTalkBtn.addEventListener('click', (event) => {
    event.preventDefault();
    togglePushToTalk();
  });
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return;
  const target = event.target;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
  if (gameSection.classList.contains('hidden')) return;
  event.preventDefault();
  togglePushToTalk();
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && qrModal && !qrModal.classList.contains('hidden')) {
    closeQrModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && howToPlayModal && !howToPlayModal.classList.contains('hidden')) {
    closeHowToModal();
  }
});

// On first load, show lobby
const params = new URLSearchParams(window.location.search);
const sharedGame = params.get('game');
if (sharedGame && gameNameInput) {
  gameNameInput.value = sharedGame;
}
showLobby();
