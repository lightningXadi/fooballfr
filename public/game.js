// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 480;          // logical game resolution — never changes
canvas.width = W; canvas.height = H;

const FIELD  = { x:40, y:40, w:W-80, h:H-80, goalW:14, goalH:110 };
const GOAL_Y = (H - FIELD.goalH) / 2;

// ─── State ────────────────────────────────────────────────────────────────────
let myCode     = null;
let myPlayerId = null;
let isHost     = false;
let gameState  = null;
let keys       = {};
let inputLoop  = null;
let isMobile   = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Joystick state
const joy = { active: false, touchId: null, cx: 0, cy: 0, dx: 0, dy: 0 };

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
const joystickZone    = document.getElementById('joystick-zone');
const joystickKnob    = document.getElementById('joystick-knob');
const rotatePrompt    = document.getElementById('rotate-prompt');
const canvasWrapper   = document.getElementById('canvas-wrapper');

// ─── Canvas sizing ────────────────────────────────────────────────────────────
// On mobile: fill the entire screen (canvas-wrapper = 100vw × 100vh, letterboxed)
// On desktop: fit inside viewport with small padding
function resizeCanvas() {
  if (gameEl.classList.contains('hidden')) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const scaleX = vw / W;
  const scaleY = vh / H;
  const scale  = Math.min(scaleX, scaleY);   // allow up-scaling on mobile

  const dw = Math.round(W * scale);
  const dh = Math.round(H * scale);

  canvasWrapper.style.width  = dw + 'px';
  canvasWrapper.style.height = dh + 'px';
  canvas.style.width  = dw + 'px';
  canvas.style.height = dh + 'px';
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));

// ─── Portrait detection (only relevant during game) ───────────────────────────
function checkOrientation() {
  if (gameEl.classList.contains('hidden')) {
    rotatePrompt.classList.add('hidden');
    return;
  }
  const isPortrait = window.innerHeight > window.innerWidth;
  if (isMobile && isPortrait) {
    rotatePrompt.classList.remove('hidden');
  } else {
    rotatePrompt.classList.add('hidden');
    resizeCanvas();
  }
}

window.addEventListener('resize',            checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 300));

// ─── Copy code ────────────────────────────────────────────────────────────────
function copyCode() {
  if (!myCode) return;
  const btn   = document.getElementById('copy-btn');
  const label = document.getElementById('copy-label');
  navigator.clipboard.writeText(myCode).then(() => {
    btn.classList.add('copied');
    label.textContent = '✓ Copied!';
    setTimeout(() => { btn.classList.remove('copied'); label.textContent = 'Copy Code'; }, 2000);
  }).catch(() => {
    // fallback for older mobile browsers
    const ta = document.createElement('textarea');
    ta.value = myCode;
    document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.classList.add('copied');
    label.textContent = '✓ Copied!';
    setTimeout(() => { btn.classList.remove('copied'); label.textContent = 'Copy Code'; }, 2000);
  });
}

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
  '1v1': 'One player each side — 2 players total',
  '2v2': '2 per side — host can start with 2, 3, or 4 players',
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
  const nick = document.getElementById('nickname').value.trim() || 'Player';
  socket.emit('createRoom', { mode: selectedMode, nickname: nick });
});

function doJoin() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  const nick = document.getElementById('nickname').value.trim() || 'Player';
  if (code.length !== 4) { lobbyError.textContent = 'Enter a 4-letter room code'; return; }
  socket.emit('joinRoom', { code, nickname: nick });
}

document.getElementById('join-btn').addEventListener('click', doJoin);
document.getElementById('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
startBtn.addEventListener('click', () => socket.emit('startGame', { code: myCode }));

// ─── Keyboard input ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (!gameEl.classList.contains('hidden')) e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// ─── Joystick ─────────────────────────────────────────────────────────────────
// Floating-origin design: the base snaps to wherever the thumb lands,
// not a fixed centre point. This feels far more natural on mobile.
// JOY_RADIUS is in *screen* px — scales with whatever size the canvas is rendered at.
const JOY_RADIUS = 55;   // max thumb travel in screen px

// Reposition the visible base to where the touch started
function placeJoyBase(screenX, screenY) {
  const zr   = joystickZone.getBoundingClientRect();
  // clamp inside the zone
  const lx   = Math.max(JOY_RADIUS, Math.min(screenX - zr.left, zr.width  - JOY_RADIUS));
  const ly   = Math.max(JOY_RADIUS, Math.min(screenY - zr.top,  zr.height - JOY_RADIUS));
  const base = document.getElementById('joystick-base');
  base.style.position = 'absolute';
  base.style.left     = (lx - base.offsetWidth  / 2) + 'px';
  base.style.top      = (ly - base.offsetHeight / 2) + 'px';
}

joystickZone.addEventListener('touchstart', e => {
  e.preventDefault();
  // Only track first touch that lands in the zone
  if (joy.active) return;
  const t = e.changedTouches[0];
  joy.active  = true;
  joy.touchId = t.identifier;
  joy.cx      = t.clientX;   // origin = where thumb landed
  joy.cy      = t.clientY;
  placeJoyBase(t.clientX, t.clientY);
  updateJoy(t.clientX, t.clientY);
}, { passive: false });

joystickZone.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.touchId) {
      updateJoy(t.clientX, t.clientY);
      break;
    }
  }
}, { passive: false });

['touchend', 'touchcancel'].forEach(ev => {
  joystickZone.addEventListener(ev, e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.touchId) { resetJoy(); break; }
    }
  }, { passive: false });
});

function updateJoy(tx, ty) {
  let dx   = tx - joy.cx;
  let dy   = ty - joy.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Clamp knob travel to JOY_RADIUS
  if (dist > JOY_RADIUS) {
    dx = (dx / dist) * JOY_RADIUS;
    dy = (dy / dist) * JOY_RADIUS;
  }

  // Normalise to −1..1 (preserving magnitude for variable speed)
  joy.dx = dx / JOY_RADIUS;
  joy.dy = dy / JOY_RADIUS;

  // Move the knob visually relative to the base centre
  joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function resetJoy() {
  joy.active = false;
  joy.dx = 0;
  joy.dy = 0;
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  // Reset base to default bottom-left position
  const base = document.getElementById('joystick-base');
  base.style.position = '';
  base.style.left     = '';
  base.style.top      = '';
}

// ─── Build analog input vector ────────────────────────────────────────────────
// Joystick:  joy.dx / joy.dy are already −1..1 proportional to push distance
// Keyboard:  compose a unit vector from held keys, normalize diagonal
function getInputVector() {
  // Joystick takes priority if active
  if (joy.active && (Math.abs(joy.dx) > 0.05 || Math.abs(joy.dy) > 0.05)) {
    return { ax: joy.dx, ay: joy.dy };
  }

  // Keyboard — build raw vector
  let ax = 0, ay = 0;
  if (keys['a'] || keys['ArrowLeft'])  ax -= 1;
  if (keys['d'] || keys['ArrowRight']) ax += 1;
  if (keys['w'] || keys['ArrowUp'])    ay -= 1;
  if (keys['s'] || keys['ArrowDown'])  ay += 1;

  // Normalize diagonal so moving at 45° isn't faster than straight
  const len = Math.sqrt(ax*ax + ay*ay);
  if (len > 0) { ax /= len; ay /= len; }

  return { ax, ay };
}

function startInputLoop() {
  if (inputLoop) return;
  inputLoop = setInterval(() => {
    if (!myCode || !myPlayerId) return;
    socket.emit('input', { code: myCode, input: getInputVector() });
  }, 1000 / 60);
}

function stopInputLoop() {
  clearInterval(inputLoop);
  inputLoop = null;
  resetJoy();
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
  countdownEl.offsetHeight;
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

socket.on('reset',    state => { gameState = state; });

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
  rotatePrompt.classList.add('hidden');

  roomCodeDisplay.textContent = myCode;
  updateSlotsUI(state);

  if (isHost) {
    startBtn.classList.remove('hidden');
    waitingMsg.textContent = 'Start whenever everyone has joined';
  } else {
    startBtn.classList.add('hidden');
    waitingMsg.textContent = 'Waiting for host to start…';
  }
}

function updateSlotsUI(state) {
  const players      = Object.values(state.players);
  const leftPlayers  = players.filter(p => p.team === 'left') .sort((a,b) => a.id.localeCompare(b.id));
  const rightPlayers = players.filter(p => p.team === 'right').sort((a,b) => a.id.localeCompare(b.id));

  const renderTeam = (list, lbl) => `
    <div class="slots-team">
      <div class="slots-team-label">${lbl}</div>
      ${list.map(p => {
        const isYou = p.id === myPlayerId;
        return `<div class="slot-card ${p.connected?'filled':''} ${isYou?'you':''}" style="--dot-color:${p.color}">
          <span class="slot-dot"></span>
          <span>${p.connected ? p.label+(isYou?' (You)':'') : 'Empty slot'}</span>
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

  // Show joystick only on touch devices
  if (isMobile) {
    joystickZone.classList.remove('hidden');
  } else {
    joystickZone.classList.add('hidden');
  }

  const me = state.players[myPlayerId];
  if (me) {
    yourHint.textContent = `You → ${me.team === 'left' ? '⬅ Left' : '➡ Right'} Team`;
    yourHint.style.color = me.color;
  }

  timerDisplay.textContent = formatTime(state.timeLeft);
  setTimeout(() => { resizeCanvas(); checkOrientation(); }, 60);
}

function backToLobby() {
  stopInputLoop();
  myCode = null; myPlayerId = null; isHost = false; gameState = null; keys = {};
  rotatePrompt.classList.add('hidden');
  lobbyEl.classList.remove('hidden');
  waitingEl.classList.add('hidden');
  gameEl.classList.add('hidden');
  fulltimeOverlay.classList.remove('show');
  disconnectOv.classList.add('hidden');
  lobbyError.textContent = '';
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
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);

  // Grass
  const g = ctx.createLinearGradient(FIELD.x, FIELD.y, FIELD.x, FIELD.y+FIELD.h);
  g.addColorStop(0, '#2a6228'); g.addColorStop(0.5, '#2e7a2b'); g.addColorStop(1, '#2a6228');
  ctx.fillStyle = g;
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);

  // Mowed stripes
  const sw = FIELD.w / 14;
  for (let i = 0; i < 14; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(FIELD.x + i*sw, FIELD.y, sw, FIELD.h);
    }
  }

  // Boundary line
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5;
  ctx.strokeRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);

  // Centre line
  ctx.setLineDash([10, 7]);
  ctx.beginPath(); ctx.moveTo(W/2, FIELD.y); ctx.lineTo(W/2, FIELD.y+FIELD.h); ctx.stroke();
  ctx.setLineDash([]);

  // Centre circle
  ctx.beginPath(); ctx.arc(W/2, H/2, 58, 0, Math.PI*2); ctx.stroke();

  // Centre dot
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(W/2, H/2, 4, 0, Math.PI*2); ctx.fill();

  // Penalty areas
  const paW = 95, paH = 190;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5;
  ctx.strokeRect(FIELD.x, (H-paH)/2, paW, paH);
  ctx.strokeRect(FIELD.x+FIELD.w-paW, (H-paH)/2, paW, paH);

  // Goal boxes (smaller inner box)
  const gbW = 48, gbH = 100;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(FIELD.x, (H-gbH)/2, gbW, gbH);
  ctx.strokeRect(FIELD.x+FIELD.w-gbW, (H-gbH)/2, gbW, gbH);

  // Goals
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(FIELD.x - FIELD.goalW, GOAL_Y, FIELD.goalW, FIELD.goalH);
  ctx.fillRect(FIELD.x + FIELD.w,     GOAL_Y, FIELD.goalW, FIELD.goalH);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.5;
  ctx.strokeRect(FIELD.x - FIELD.goalW, GOAL_Y, FIELD.goalW, FIELD.goalH);
  ctx.strokeRect(FIELD.x + FIELD.w,     GOAL_Y, FIELD.goalW, FIELD.goalH);

  // Corner arcs
  [[FIELD.x, FIELD.y, 0], [FIELD.x+FIELD.w, FIELD.y, Math.PI/2],
   [FIELD.x+FIELD.w, FIELD.y+FIELD.h, Math.PI], [FIELD.x, FIELD.y+FIELD.h, Math.PI*1.5]
  ].forEach(([cx, cy, sa]) => {
    ctx.beginPath(); ctx.arc(cx, cy, 18, sa, sa+Math.PI/2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  });
}

// ─── Draw: Player ─────────────────────────────────────────────────────────────
function drawPlayer(p) {
  const isMe = p.id === myPlayerId;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(p.x+4, p.y+p.r+3, p.r*0.75, 6, 0, 0, Math.PI*2); ctx.fill();

  // Outer ring
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
  ctx.fillStyle = isMe ? '#e8c060' : 'rgba(255,255,255,0.92)';
  ctx.fill();

  // Colour fill
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r-3, 0, Math.PI*2);
  ctx.fillStyle = p.color; ctx.fill();

  // Shine
  ctx.beginPath(); ctx.arc(p.x - p.r*0.22, p.y - p.r*0.22, p.r*0.36, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();

  // Label
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(p.r * 0.72)}px Barlow, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.label, p.x, p.y + 1);

  // "You" arc above
  if (isMe) {
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r+6, Math.PI*1.18, Math.PI*1.82);
    ctx.strokeStyle = '#e8c060'; ctx.lineWidth = 3; ctx.stroke();
  }
}

// ─── Draw: Ball ───────────────────────────────────────────────────────────────
function drawBall(b) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(b.x+4, b.y+b.r-1, b.r*0.75, 5, 0, 0, Math.PI*2); ctx.fill();

  // Ball
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
  const bg = ctx.createRadialGradient(b.x-3, b.y-3, 1, b.x, b.y, b.r);
  bg.addColorStop(0, '#fff'); bg.addColorStop(0.6, '#e8e8e8'); bg.addColorStop(1, '#aaa');
  ctx.fillStyle = bg; ctx.fill();

  // Pentagon patches
  const ang = Math.PI*2/5, pr = b.r*0.38;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = i*ang - Math.PI/2;
    i === 0 ? ctx.moveTo(b.x+Math.cos(a)*pr, b.y+Math.sin(a)*pr)
            : ctx.lineTo(b.x+Math.cos(a)*pr, b.y+Math.sin(a)*pr);
  }
  ctx.closePath();
  ctx.fillStyle = '#222'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.fill(); ctx.stroke();
}
