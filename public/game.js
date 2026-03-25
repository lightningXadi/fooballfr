// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 480;   // logical size (never changes)
canvas.width = W; canvas.height = H;

const FIELD  = { x:40, y:40, w:W-80, h:H-80, goalW:14, goalH:110 };
const GOAL_Y = (H - FIELD.goalH) / 2;

// ─── Game state ───────────────────────────────────────────────────────────────
let myCode     = null;
let myPlayerId = null;
let isHost     = false;
let gameState  = null;
let keys       = {};
let dpadKeys   = {};
let inputLoop  = null;
let isMobile   = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const lobbyEl         = document.getElementById('lobby');
const waitingEl       = document.getElementById('waiting-room');
const gameEl          = document.getElementById('game-screen');
const lobbyError      = document.getElementById('lobby-error');
const roomCodeDisplay = document.getElementById('room-code-display');
const slotsGrid       = document.getElementById('slots-grid');
const startBtn        = document.getElementById('start-btn');
const waitingMsg      = document.getElementById('waiting-msg');
const countdownEl     = document.getElementById('countdown-display');
const timerDisplay    = document.getElementById('timer-display');
const goalFlash       = document.getElementById('goal-flash');
const fulltimeOverlay = document.getElementById('fulltime-overlay');
const fulltimeResult  = document.getElementById('fulltime-result');
const disconnectOv    = document.getElementById('disconnect-overlay');
const yourHint        = document.getElementById('your-player-hint');
const dpad            = document.getElementById('dpad');
const canvasWrapper   = document.getElementById('canvas-wrapper');

// ─── Detect touch ─────────────────────────────────────────────────────────────
isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ─── Canvas scaling ───────────────────────────────────────────────────────────
function resizeCanvas() {
  const gameScreen = document.getElementById('game-screen');
  if (gameScreen.classList.contains('hidden')) return;

  // Available height: viewport minus scoreboard (≈44px) minus dpad (mobile ≈70px) minus margins
  const scoreboardH = document.getElementById('scoreboard').offsetHeight || 44;
  const dpadH       = (isMobile && !dpad.classList.contains('hidden')) ? (dpad.offsetHeight + 10) || 74 : 32;
  const available_h = window.innerHeight - scoreboardH - dpadH - 24;
  const available_w = window.innerWidth  - 8;

  const scaleW = available_w / W;
  const scaleH = available_h / H;
  const scale  = Math.min(scaleW, scaleH, 1); // never upscale beyond native

  const displayW = Math.floor(W * scale);
  const displayH = Math.floor(H * scale);

  canvasWrapper.style.width  = displayW + 'px';
  canvasWrapper.style.height = displayH + 'px';
  canvas.style.width         = displayW + 'px';
  canvas.style.height        = displayH + 'px';
}

window.addEventListener('resize',            resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

// ─── Lobby tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    lobbyError.textContent = '';
  });
});

// ─── Mode select ──────────────────────────────────────────────────────────────
const modeDescs = {
  '1v1': '1 player each side — 2 players total',
  '2v2': '2 per side — start with 2, 3, or 4 players',
};
let selectedMode = '1v1';

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode = btn.dataset.mode;
    document.getElementById('mode-desc').textContent = modeDescs[selectedMode];
  });
});

// ─── Create / Join ────────────────────────────────────────────────────────────
document.getElementById('create-btn').addEventListener('click', () => {
  const nick = document.getElementById('nickname').value.trim() || 'P1';
  socket.emit('createRoom', { mode: selectedMode, nickname: nick });
});

document.getElementById('join-btn').addEventListener('click', doJoin);
document.getElementById('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  const nick = document.getElementById('nickname').value.trim() || 'P?';
  if (code.length !== 4) { lobbyError.textContent = 'Enter a 4-letter room code'; return; }
  socket.emit('joinRoom', { code, nickname: nick });
}

startBtn.addEventListener('click', () => { socket.emit('startGame', { code: myCode }); });

// ─── Keyboard input ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e => { keys[e.key] = true;  if (gameEl && !gameEl.classList.contains('hidden')) e.preventDefault(); });
document.addEventListener('keyup',   e => { keys[e.key] = false; });

// ─── D-pad touch input ────────────────────────────────────────────────────────
document.querySelectorAll('.dpad-btn').forEach(btn => {
  const dir = btn.dataset.dir;

  const press = (e) => {
    e.preventDefault();
    dpadKeys[dir] = true;
    btn.classList.add('pressed');
  };
  const release = (e) => {
    e.preventDefault();
    dpadKeys[dir] = false;
    btn.classList.remove('pressed');
  };

  btn.addEventListener('touchstart',  press,   { passive: false });
  btn.addEventListener('touchend',    release, { passive: false });
  btn.addEventListener('touchcancel', release, { passive: false });
  // Mouse fallback for testing on desktop
  btn.addEventListener('mousedown',   press);
  btn.addEventListener('mouseup',     release);
  btn.addEventListener('mouseleave',  release);
});

function getActiveKeys() {
  return {
    up:    !!(keys['w'] || keys['ArrowUp']    || dpadKeys['up']),
    down:  !!(keys['s'] || keys['ArrowDown']  || dpadKeys['down']),
    left:  !!(keys['a'] || keys['ArrowLeft']  || dpadKeys['left']),
    right: !!(keys['d'] || keys['ArrowRight'] || dpadKeys['right']),
  };
}

function startInputLoop() {
  if (inputLoop) return;
  inputLoop = setInterval(() => {
    if (!myCode || !myPlayerId) return;
    socket.emit('input', { code: myCode, keys: getActiveKeys() });
  }, 1000 / 60);
}

function stopInputLoop() {
  clearInterval(inputLoop);
  inputLoop = null;
  dpadKeys = {};
  document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('pressed'));
}

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('roomCreated', ({ code, playerId, state }) => {
  myCode = code; myPlayerId = playerId; isHost = true; gameState = state;
  showWaiting(state);
});

socket.on('roomJoined', ({ code, playerId, state }) => {
  myCode = code; myPlayerId = playerId; isHost = false; gameState = state;
  showWaiting(state);
});

socket.on('joinError', msg => { lobbyError.textContent = msg; });
socket.on('error',     msg => { lobbyError.textContent = msg; });

socket.on('playerJoined', ({ state }) => {
  gameState = state;
  updateSlotsUI(state);
});

socket.on('playerLeft', ({ playerId }) => {
  if (gameState?.players[playerId]) gameState.players[playerId].connected = false;
  if (gameState) updateSlotsUI(gameState);
  if (!gameEl.classList.contains('hidden')) {
    disconnectOv.classList.remove('hidden');
    stopInputLoop();
  }
});

socket.on('roomClosed', () => {
  alert('Host left — room closed.');
  backToLobby();
});

socket.on('countdown', n => {
  startBtn.classList.add('hidden');
  waitingMsg.textContent = '';
  countdownEl.classList.remove('hidden');
  countdownEl.textContent = n;
  countdownEl.style.animation = 'none';
  countdownEl.offsetHeight;   // reflow
  countdownEl.style.animation = '';
});

socket.on('start', state => {
  gameState = state;
  showGame(state);
  startInputLoop();
  requestAnimationFrame(renderLoop);
});

socket.on('state', state => {
  gameState = state;
  timerDisplay.textContent = formatTime(state.timeLeft);
  timerDisplay.classList.toggle('urgent', state.timeLeft <= 30);
  document.getElementById('left-score').textContent  = state.score.left;
  document.getElementById('right-score').textContent = state.score.right;
});

socket.on('goal', ({ scorer }) => {
  goalFlash.textContent   = scorer === 'left' ? '⚽ Left Scores!' : '⚽ Right Scores!';
  goalFlash.style.color   = scorer === 'left' ? '#e07a3a' : '#4a90d9';
  goalFlash.style.opacity = '1';
  setTimeout(() => { goalFlash.style.opacity = '0'; }, 1200);
});

socket.on('reset',    state  => { gameState = state; });

socket.on('gameover', ({ score }) => {
  stopInputLoop();
  fulltimeResult.textContent =
    score.left > score.right  ? '🏆 Left Team Wins!'  :
    score.right > score.left  ? '🏆 Right Team Wins!' : "It's a Draw!";
  fulltimeOverlay.classList.add('show');
});

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showWaiting(state) {
  lobbyEl.classList.add('hidden');
  waitingEl.classList.remove('hidden');
  gameEl.classList.add('hidden');
  roomCodeDisplay.textContent = myCode;
  updateSlotsUI(state);
  if (isHost) {
    startBtn.classList.remove('hidden');
    waitingMsg.textContent = 'Start when everyone has joined';
  } else {
    startBtn.classList.add('hidden');
    waitingMsg.textContent = 'Waiting for host to start…';
  }
}

function updateSlotsUI(state) {
  const players     = Object.values(state.players);
  const leftPlayers = players.filter(p => p.team === 'left') .sort((a,b) => a.id.localeCompare(b.id));
  const rightPlayers= players.filter(p => p.team === 'right').sort((a,b) => a.id.localeCompare(b.id));

  const renderTeam = (list, label) => `
    <div class="slots-team">
      <div class="slots-team-label">${label}</div>
      ${list.map(p => {
        const isYou = p.id === myPlayerId;
        return `<div class="slot-card ${p.connected ? 'filled':''} ${isYou ? 'you':''}" style="--dot-color:${p.color}">
          <span class="slot-dot"></span>
          <span>${p.connected ? p.label + (isYou ? ' (You)' : '') : 'Empty'}</span>
        </div>`;
      }).join('')}
    </div>`;

  slotsGrid.innerHTML = `
    ${renderTeam(leftPlayers,  '⬅ Left')}
    <div class="vs-divider">VS</div>
    ${renderTeam(rightPlayers, 'Right ➡')}
  `;
}

function showGame(state) {
  lobbyEl.classList.add('hidden');
  waitingEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  countdownEl.classList.add('hidden');
  fulltimeOverlay.classList.remove('show');
  disconnectOv.classList.add('hidden');

  // Show / hide D-pad based on touch
  if (isMobile) {
    dpad.classList.remove('hidden');
  } else {
    dpad.classList.add('hidden');
  }

  const me = state.players[myPlayerId];
  if (me) {
    yourHint.textContent = `You → ${me.team === 'left' ? '⬅ Left' : '➡ Right'} Team`;
    yourHint.style.color = me.color;
  }

  timerDisplay.textContent = formatTime(state.timeLeft);
  setTimeout(resizeCanvas, 50);
}

function backToLobby() {
  stopInputLoop();
  myCode = null; myPlayerId = null; isHost = false; gameState = null;
  lobbyEl.classList.remove('hidden');
  waitingEl.classList.add('hidden');
  gameEl.classList.add('hidden');
  fulltimeOverlay.classList.remove('show');
  disconnectOv.classList.add('hidden');
  lobbyError.textContent = '';
  keys = {}; dpadKeys = {};
}

function formatTime(s) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function renderLoop() {
  if (gameEl.classList.contains('hidden')) return;
  if (gameState) {
    drawField();
    Object.values(gameState.players).forEach(drawPlayer);
    if (gameState.ball) drawBall(gameState.ball);
  }
  requestAnimationFrame(renderLoop);
}

// ─── Draw: Field ──────────────────────────────────────────────────────────────
function drawField() {
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, W, H);

  const g = ctx.createLinearGradient(FIELD.x, FIELD.y, FIELD.x, FIELD.y+FIELD.h);
  g.addColorStop(0,'#2d6b2a'); g.addColorStop(0.5,'#317a2e'); g.addColorStop(1,'#2d6b2a');
  ctx.fillStyle = g;
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);

  const sw = FIELD.w / 14;
  for (let i=0;i<14;i++) {
    if (i%2===0) { ctx.fillStyle='rgba(0,0,0,0.07)'; ctx.fillRect(FIELD.x+i*sw,FIELD.y,sw,FIELD.h); }
  }

  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=2.5;
  ctx.strokeRect(FIELD.x,FIELD.y,FIELD.w,FIELD.h);

  ctx.setLineDash([8,6]);
  ctx.beginPath(); ctx.moveTo(W/2,FIELD.y); ctx.lineTo(W/2,FIELD.y+FIELD.h); ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath(); ctx.arc(W/2,H/2,55,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(W/2,H/2,3,0,Math.PI*2); ctx.fill();

  const paW=90,paH=180;
  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=2.5;
  ctx.strokeRect(FIELD.x,(H-paH)/2,paW,paH);
  ctx.strokeRect(FIELD.x+FIELD.w-paW,(H-paH)/2,paW,paH);

  ctx.fillStyle='rgba(255,255,255,0.12)';
  ctx.fillRect(FIELD.x-FIELD.goalW,GOAL_Y,FIELD.goalW,FIELD.goalH);
  ctx.fillRect(FIELD.x+FIELD.w,GOAL_Y,FIELD.goalW,FIELD.goalH);
  ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=2;
  ctx.strokeRect(FIELD.x-FIELD.goalW,GOAL_Y,FIELD.goalW,FIELD.goalH);
  ctx.strokeRect(FIELD.x+FIELD.w,GOAL_Y,FIELD.goalW,FIELD.goalH);

  const cAng=Math.PI/2;
  [[FIELD.x,FIELD.y,0],[FIELD.x+FIELD.w,FIELD.y,Math.PI/2],
   [FIELD.x+FIELD.w,FIELD.y+FIELD.h,Math.PI],[FIELD.x,FIELD.y+FIELD.h,Math.PI*1.5]
  ].forEach(([cx,cy,sa])=>{
    ctx.beginPath(); ctx.arc(cx,cy,16,sa,sa+cAng);
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.5; ctx.stroke();
  });
}

// ─── Draw: Player ─────────────────────────────────────────────────────────────
function drawPlayer(p) {
  const isMe = p.id === myPlayerId;

  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(p.x+3,p.y+p.r+2,p.r*0.8,5,0,0,Math.PI*2); ctx.fill();

  ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
  ctx.fillStyle = isMe ? '#e8c060' : 'rgba(255,255,255,0.9)';
  ctx.fill();

  ctx.beginPath(); ctx.arc(p.x,p.y,p.r-3,0,Math.PI*2);
  ctx.fillStyle = p.color; ctx.fill();

  ctx.beginPath(); ctx.arc(p.x-p.r*0.2,p.y-p.r*0.2,p.r*0.38,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.fill();

  ctx.fillStyle='#fff';
  ctx.font=`bold ${Math.floor(p.r*0.72)}px Barlow, sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(p.label, p.x, p.y+1);

  if (isMe) {
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r+5,Math.PI*1.2,Math.PI*1.8);
    ctx.strokeStyle='#e8c060'; ctx.lineWidth=2.5; ctx.stroke();
  }
}

// ─── Draw: Ball ───────────────────────────────────────────────────────────────
function drawBall(b) {
  ctx.fillStyle='rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(b.x+3,b.y+b.r-1,b.r*0.8,4,0,0,Math.PI*2); ctx.fill();

  ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
  const bg=ctx.createRadialGradient(b.x-3,b.y-3,1,b.x,b.y,b.r);
  bg.addColorStop(0,'#fff'); bg.addColorStop(0.6,'#e8e8e8'); bg.addColorStop(1,'#aaa');
  ctx.fillStyle=bg; ctx.fill();

  const ang=Math.PI*2/5, pr=b.r*0.38;
  ctx.beginPath();
  for(let i=0;i<5;i++){
    const a=i*ang-Math.PI/2;
    i===0?ctx.moveTo(b.x+Math.cos(a)*pr,b.y+Math.sin(a)*pr):ctx.lineTo(b.x+Math.cos(a)*pr,b.y+Math.sin(a)*pr);
  }
  ctx.closePath();
  ctx.fillStyle='#222'; ctx.strokeStyle='#333'; ctx.lineWidth=1;
  ctx.fill(); ctx.stroke();
}
