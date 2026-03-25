const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants (must match client) ───────────────────────────────────────────
const W = 800, H = 480;
const FIELD        = { x: 40, y: 40, w: W - 80, h: H - 80, goalW: 14, goalH: 110 };
const GOAL_Y       = (H - FIELD.goalH) / 2;
const PLAYER_R     = 20;
const BALL_R       = 11;
const PLAYER_SPEED = 4.5;
const BALL_FRIC    = 0.982;
const BOUNCE_DAMP  = 0.65;
const KICK_FORCE   = 8;
const MATCH_DUR    = 120; // seconds
const TICK_MS      = 1000 / 60; // 60 Hz server tick

// ─── Room store ───────────────────────────────────────────────────────────────
// rooms[code] = { players, state, interval, countdown }
const rooms = {};

function makeCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Slot layout per mode:
// 1v1  → left:[slot0],        right:[slot1]
// 2v1  → left:[slot0,slot1],  right:[slot2]
// 1v2  → left:[slot0],        right:[slot1,slot2]
// 2v2  → left:[slot0,slot1],  right:[slot2,slot3]
const MODE_SLOTS = {
  '1v1': { left: 1, right: 1 },
  '2v1': { left: 2, right: 1 },
  '1v2': { left: 1, right: 2 },
  '2v2': { left: 2, right: 2 },
};

const TEAM_COLORS = {
  left:  ['#e07a3a', '#e8a060'],
  right: ['#4a90d9', '#72b0f0'],
};

// Starting X positions per slot within their half
function slotStartX(side, idx, total) {
  if (side === 'left') {
    return total === 1
      ? FIELD.x + 60
      : FIELD.x + 50 + idx * 30;
  } else {
    return total === 1
      ? FIELD.x + FIELD.w - 60
      : FIELD.x + FIELD.w - 50 - idx * 30;
  }
}

function slotStartY(idx, total) {
  if (total === 1) return H / 2;
  return H / 2 + (idx === 0 ? -60 : 60);
}

function makeGameState(mode) {
  const { left, right } = MODE_SLOTS[mode];
  const players = {};

  // left team
  for (let i = 0; i < left; i++) {
    const id = `L${i}`;
    players[id] = {
      id, team: 'left', slotIdx: i,
      x: slotStartX('left', i, left),
      y: slotStartY(i, left),
      r: PLAYER_R,
      color: TEAM_COLORS.left[i],
      label: String(i + 1),
      socketId: null,
      keys: {}
    };
  }
  // right team
  for (let i = 0; i < right; i++) {
    const id = `R${i}`;
    players[id] = {
      id, team: 'right', slotIdx: i,
      x: slotStartX('right', i, right),
      y: slotStartY(i, right),
      r: PLAYER_R,
      color: TEAM_COLORS.right[i],
      label: String(i + 1),
      socketId: null,
      keys: {}
    };
  }

  return {
    players,
    ball: makeBall(),
    score: { left: 0, right: 0 },
    timeLeft: MATCH_DUR,
    frameCount: 0,
    phase: 'waiting', // waiting | countdown | playing | gameover
    mode
  };
}

function makeBall() {
  return {
    x: W / 2, y: H / 2,
    vx: (Math.random() > 0.5 ? 1 : -1) * 4,
    vy: (Math.random() - 0.5) * 2.5,
    r: BALL_R
  };
}

function resetPositions(state) {
  const { left, right } = MODE_SLOTS[state.mode];
  Object.values(state.players).forEach(p => {
    const total = p.team === 'left' ? left : right;
    p.x = slotStartX(p.team, p.slotIdx, total);
    p.y = slotStartY(p.slotIdx, total);
    p.keys = {};
  });
  state.ball = makeBall();
}

// ─── Physics tick ─────────────────────────────────────────────────────────────
function tick(code) {
  const room = rooms[code];
  if (!room) return;
  const st = room.state;
  if (st.phase !== 'playing') return;

  const players = Object.values(st.players);

  // Timer
  st.frameCount++;
  if (st.frameCount >= 60) {
    st.frameCount = 0;
    st.timeLeft   = Math.max(0, st.timeLeft - 1);
    if (st.timeLeft === 0) {
      st.phase = 'gameover';
      io.to(code).emit('gameover', { score: st.score });
      clearInterval(room.interval);
      return;
    }
  }

  // Move players
  players.forEach(p => {
    if (p.keys['up'])    p.y -= PLAYER_SPEED;
    if (p.keys['down'])  p.y += PLAYER_SPEED;
    if (p.keys['left'])  p.x -= PLAYER_SPEED;
    if (p.keys['right']) p.x += PLAYER_SPEED;
    p.x = Math.max(FIELD.x + p.r, Math.min(FIELD.x + FIELD.w - p.r, p.x));
    p.y = Math.max(FIELD.y + p.r, Math.min(FIELD.y + FIELD.h - p.r, p.y));
  });

  // Player–player push
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const minD = a.r + b.r;
      if (dist < minD && dist > 0) {
        const ov = (minD - dist) / 2;
        const nx = dx/dist, ny = dy/dist;
        a.x -= nx*ov; a.y -= ny*ov;
        b.x += nx*ov; b.y += ny*ov;
      }
    }
  }

  // Ball physics
  const b = st.ball;
  b.vx *= BALL_FRIC;
  b.vy *= BALL_FRIC;
  if (Math.abs(b.vx) < 0.05) b.vx = 0;
  if (Math.abs(b.vy) < 0.05) b.vy = 0;
  b.x += b.vx;
  b.y += b.vy;

  // Ball vs walls
  if (b.y - b.r < FIELD.y) { b.y = FIELD.y + b.r; b.vy = Math.abs(b.vy) * BOUNCE_DAMP; }
  if (b.y + b.r > FIELD.y + FIELD.h) { b.y = FIELD.y + FIELD.h - b.r; b.vy = -Math.abs(b.vy) * BOUNCE_DAMP; }

  const inGoal = b.y > GOAL_Y && b.y < GOAL_Y + FIELD.goalH;
  if (!inGoal && b.x - b.r < FIELD.x) { b.x = FIELD.x + b.r; b.vx = Math.abs(b.vx) * BOUNCE_DAMP; }
  if (!inGoal && b.x + b.r > FIELD.x + FIELD.w) { b.x = FIELD.x + FIELD.w - b.r; b.vx = -Math.abs(b.vx) * BOUNCE_DAMP; }

  // Goal detection
  if (inGoal) {
    if (b.x - b.r < FIELD.x - FIELD.goalW) {
      st.score.right++;
      io.to(code).emit('goal', { scorer: 'right', score: st.score });
      st.phase = 'cooldown';
      setTimeout(() => { resetPositions(st); st.phase = 'playing'; io.to(code).emit('reset', st); }, 1500);
      return;
    }
    if (b.x + b.r > FIELD.x + FIELD.w + FIELD.goalW) {
      st.score.left++;
      io.to(code).emit('goal', { scorer: 'left', score: st.score });
      st.phase = 'cooldown';
      setTimeout(() => { resetPositions(st); st.phase = 'playing'; io.to(code).emit('reset', st); }, 1500);
      return;
    }
  }

  // Ball vs players
  players.forEach(p => {
    const dx = b.x - p.x, dy = b.y - p.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const minD = b.r + p.r;
    if (dist < minD && dist > 0) {
      const nx = dx/dist, ny = dy/dist;
      b.x = p.x + nx*minD;
      b.y = p.y + ny*minD;
      const dot = b.vx*nx + b.vy*ny;
      b.vx -= 2*dot*nx; b.vy -= 2*dot*ny;
      const speed = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
      const ks = Math.max(speed, KICK_FORCE);
      b.vx = nx*ks; b.vy = ny*ks;
    }
  });

  // Broadcast state (strip keys from broadcast)
  const broadcastPlayers = {};
  players.forEach(p => {
    broadcastPlayers[p.id] = { id: p.id, x: p.x, y: p.y, r: p.r, color: p.color, label: p.label, team: p.team };
  });
  io.to(code).emit('state', { players: broadcastPlayers, ball: st.ball, timeLeft: st.timeLeft, score: st.score });
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('connect', socket.id);

  // ── Create room ──
  socket.on('createRoom', ({ mode, nickname }) => {
    let code = makeCode();
    while (rooms[code]) code = makeCode();

    const state = makeGameState(mode);
    rooms[code] = { state, interval: null, hostId: socket.id, sockets: {} };

    // Assign host to first left slot
    const firstSlot = Object.values(state.players).find(p => p.team === 'left' && p.slotIdx === 0);
    firstSlot.socketId = socket.id;
    firstSlot.label    = nickname ? nickname.substring(0, 3) : '1';
    rooms[code].sockets[socket.id] = firstSlot.id;

    socket.join(code);
    socket.emit('roomCreated', { code, playerId: firstSlot.id, state: sanitize(state) });
    console.log(`Room ${code} created by ${socket.id} [${mode}]`);
  });

  // ── Join room ──
  socket.on('joinRoom', ({ code, nickname }) => {
    const room = rooms[code];
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.state.phase === 'gameover') { socket.emit('error', 'Game already over'); return; }

    // Find first empty slot
    const emptySlot = Object.values(room.state.players).find(p => !p.socketId);
    if (!emptySlot) { socket.emit('error', 'Room is full'); return; }

    emptySlot.socketId = socket.id;
    emptySlot.label    = nickname ? nickname.substring(0, 3) : emptySlot.label;
    room.sockets[socket.id] = emptySlot.id;

    socket.join(code);
    socket.emit('roomJoined', { code, playerId: emptySlot.id, state: sanitize(room.state) });
    io.to(code).emit('playerJoined', { playerId: emptySlot.id, state: sanitize(room.state) });
    console.log(`${socket.id} joined room ${code} as ${emptySlot.id}`);
  });

  // ── Start game (host only) ──
  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.state.phase !== 'waiting') return;

    // Countdown 3..2..1..
    let count = 3;
    room.state.phase = 'countdown';
    io.to(code).emit('countdown', count);
    const cdInt = setInterval(() => {
      count--;
      if (count > 0) {
        io.to(code).emit('countdown', count);
      } else {
        clearInterval(cdInt);
        room.state.phase = 'playing';
        io.to(code).emit('start', sanitize(room.state));
        room.interval = setInterval(() => tick(code), TICK_MS);
      }
    }, 1000);
  });

  // ── Player input ──
  socket.on('input', ({ code, keys }) => {
    const room = rooms[code];
    if (!room) return;
    const playerId = room.sockets[socket.id];
    if (!playerId) return;
    const player = room.state.players[playerId];
    if (player) player.keys = keys;
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      if (!room.sockets[socket.id]) continue;

      const playerId = room.sockets[socket.id];
      const player   = room.state.players[playerId];
      if (player) { player.socketId = null; player.keys = {}; }
      delete room.sockets[socket.id];

      io.to(code).emit('playerLeft', { playerId });

      // If host left, close room
      if (room.hostId === socket.id) {
        io.to(code).emit('roomClosed');
        clearInterval(room.interval);
        delete rooms[code];
      }
      break;
    }
  });
});

function sanitize(state) {
  const players = {};
  Object.values(state.players).forEach(p => {
    players[p.id] = { id: p.id, x: p.x, y: p.y, r: p.r, color: p.color, label: p.label, team: p.team, connected: !!p.socketId };
  });
  return { players, ball: state.ball, score: state.score, timeLeft: state.timeLeft, phase: state.phase, mode: state.mode };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
