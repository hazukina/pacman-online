const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Maze definition (21×23) ───────────────────────────────────────────────
// 0=empty  1=wall  2=pellet  3=power-pellet
const MAZE_TEMPLATE = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,1],
  [1,3,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,3,1],
  [1,2,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,2,1,1,1,1,1,1,1,2,1,2,1,1,2,1],
  [1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1],
  [1,1,1,1,2,1,1,1,0,0,1,0,0,1,1,1,2,1,1,1,1],
  [1,1,1,1,2,1,0,0,0,0,0,0,0,0,0,1,2,1,1,1,1],
  [1,1,1,1,2,1,0,1,1,0,0,0,1,1,0,1,2,1,1,1,1],
  [0,0,0,0,2,0,0,1,0,0,0,0,0,1,0,0,2,0,0,0,0],
  [1,1,1,1,2,1,0,1,1,1,1,1,1,1,0,1,2,1,1,1,1],
  [1,1,1,1,2,1,0,0,0,0,0,0,0,0,0,1,2,1,1,1,1],
  [1,1,1,1,2,1,0,1,1,1,1,1,1,1,0,1,2,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,2,1],
  [1,3,2,1,2,2,2,2,2,2,0,2,2,2,2,2,2,1,2,3,1],
  [1,1,2,1,2,1,2,1,1,1,1,1,1,1,2,1,2,1,2,1,1],
  [1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1],
  [1,2,1,1,1,1,1,1,2,1,1,1,2,1,1,1,1,1,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,2,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const COLS = MAZE_TEMPLATE[0].length; // 21
const ROWS = MAZE_TEMPLATE.length;    // 23
const CELL = 28; // pixels per cell

// Player spawn positions [row, col]
const PACMAN_SPAWN = { row: 16, col: 10 };
const GHOST_SPAWNS = [
  { row: 9, col: 9 },
  { row: 9, col: 11 },
  { row: 11, col: 9 },
  { row: 11, col: 11 },
];

// Speed: cells per second
const PACMAN_SPEED = 5;
const GHOST_SPEED  = 4;
const TICK_MS = 50; // 20 ticks/sec

// ─── Room store ────────────────────────────────────────────────────────────
const rooms = {}; // roomId → RoomState

function makeMaze() {
  return MAZE_TEMPLATE.map(row => [...row]);
}

function countPellets(maze) {
  let n = 0;
  maze.forEach(row => row.forEach(c => { if (c === 2 || c === 3) n++; }));
  return n;
}

function createRoom(roomId) {
  return {
    id: roomId,
    phase: 'lobby',   // 'lobby' | 'playing' | 'over'
    players: {},      // socketId → PlayerState
    maze: makeMaze(),
    pelletsLeft: countPellets(makeMaze()),
    totalPellets: countPellets(makeMaze()),
    tickInterval: null,
    countdown: 0,
  };
}

function assignRoles(room) {
  const ids = Object.keys(room.players);
  // Shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  ids.forEach((id, i) => {
    const p = room.players[id];
    if (i === 0) {
      p.role = 'pacman';
      p.row = PACMAN_SPAWN.row;
      p.col = PACMAN_SPAWN.col;
      p.x = PACMAN_SPAWN.col * CELL + CELL / 2;
      p.y = PACMAN_SPAWN.row * CELL + CELL / 2;
      p.dx = 0; p.dy = 0;
      p.nextDx = 0; p.nextDy = 0;
    } else {
      const gi = i - 1;
      const sp = GHOST_SPAWNS[gi % GHOST_SPAWNS.length];
      p.role = 'ghost';
      p.ghostIndex = gi;
      p.row = sp.row;
      p.col = sp.col;
      p.x = sp.col * CELL + CELL / 2;
      p.y = sp.row * CELL + CELL / 2;
      p.dx = 0; p.dy = 0;
    }
    p.score = 0;
    p.alive = true;
  });
}

// ─── Movement helpers ───────────────────────────────────────────────────────
function wallAt(maze, row, col) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return maze[row][col] === 1;
}

// Wrap-around tunnel (row 10, cols 0 and 20)
function wrapPos(x, y) {
  const totalW = COLS * CELL;
  const totalH = ROWS * CELL;
  if (x < 0) x = totalW + x;
  if (x > totalW) x = x - totalW;
  return { x, y };
}

function cellOf(v) { return Math.floor(v / CELL); }
function centerOf(cellIdx) { return cellIdx * CELL + CELL / 2; }

// Can the center of a circle at (cx,cy) move dx,dy while not entering walls?
// We check 4 corners of the circle (radius = CELL*0.4)
function canMove(maze, cx, cy, dx, dy) {
  const r = CELL * 0.38;
  const nx = cx + dx;
  const ny = cy + dy;
  // 4 probe points
  const probes = [
    { x: nx - r, y: ny - r },
    { x: nx + r, y: ny - r },
    { x: nx - r, y: ny + r },
    { x: nx + r, y: ny + r },
  ];
  for (const p of probes) {
    const c = cellOf(p.x);
    const r2 = cellOf(p.y);
    if (wallAt(maze, r2, c)) return false;
  }
  return true;
}

// Simple ghost AI: pick direction that reduces distance to pacman
function ghostAI(room, ghost) {
  const pacman = Object.values(room.players).find(p => p.role === 'pacman');
  if (!pacman) return;

  const speed = GHOST_SPEED * CELL / (1000 / TICK_MS);
  const dirs = [
    { dx: speed, dy: 0 },
    { dx: -speed, dy: 0 },
    { dx: 0, dy: speed },
    { dx: 0, dy: -speed },
  ];

  // Don't reverse direction unless forced
  const reversed = { dx: -ghost.dx, dy: -ghost.dy };

  let best = null;
  let bestDist = Infinity;

  for (const d of dirs) {
    if (d.dx === reversed.dx && d.dy === reversed.dy && (ghost.dx !== 0 || ghost.dy !== 0)) continue;
    if (canMove(room.maze, ghost.x, ghost.y, d.dx, d.dy)) {
      const nx = ghost.x + d.dx;
      const ny = ghost.y + d.dy;
      const dist = Math.hypot(nx - pacman.x, ny - pacman.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
  }

  // Fallback: allow reverse
  if (!best) {
    for (const d of dirs) {
      if (canMove(room.maze, ghost.x, ghost.y, d.dx, d.dy)) {
        best = d;
        break;
      }
    }
  }

  if (best) {
    ghost.dx = best.dx;
    ghost.dy = best.dy;
  }
}

// ─── Game tick ─────────────────────────────────────────────────────────────
function gameTick(room) {
  if (room.phase !== 'playing') return;

  const players = Object.values(room.players);
  const pacman = players.find(p => p.role === 'pacman');
  const ghosts = players.filter(p => p.role === 'ghost');

  // Move pacman
  if (pacman && pacman.alive) {
    const speed = PACMAN_SPEED * CELL / (1000 / TICK_MS);

    // Try queued direction first
    if (pacman.nextDx !== 0 || pacman.nextDy !== 0) {
      if (canMove(room.maze, pacman.x, pacman.y, pacman.nextDx * speed, pacman.nextDy * speed)) {
        pacman.dx = pacman.nextDx;
        pacman.dy = pacman.nextDy;
        pacman.nextDx = 0;
        pacman.nextDy = 0;
      }
    }

    if (canMove(room.maze, pacman.x, pacman.y, pacman.dx * speed, pacman.dy * speed)) {
      pacman.x += pacman.dx * speed;
      pacman.y += pacman.dy * speed;
      const w = wrapPos(pacman.x, pacman.y);
      pacman.x = w.x; pacman.y = w.y;
    }

    // Eat pellet
    const pr = Math.round((pacman.y - CELL / 2) / CELL);
    const pc = Math.round((pacman.x - CELL / 2) / CELL);
    if (pr >= 0 && pr < ROWS && pc >= 0 && pc < COLS) {
      const cell = room.maze[pr][pc];
      if (cell === 2) {
        room.maze[pr][pc] = 0;
        pacman.score += 10;
        room.pelletsLeft--;
      } else if (cell === 3) {
        room.maze[pr][pc] = 0;
        pacman.score += 50;
        room.pelletsLeft--;
      }
    }
  }

  // Move ghosts (player-controlled)
  for (const ghost of ghosts) {
    const speed = GHOST_SPEED * CELL / (1000 / TICK_MS);
    if (ghost.dx !== 0 || ghost.dy !== 0) {
      if (canMove(room.maze, ghost.x, ghost.y, ghost.dx * speed, ghost.dy * speed)) {
        ghost.x += ghost.dx * speed;
        ghost.y += ghost.dy * speed;
      }
    }
  }

  // Collision: ghost catches pacman
  if (pacman && pacman.alive) {
    for (const ghost of ghosts) {
      const dist = Math.hypot(ghost.x - pacman.x, ghost.y - pacman.y);
      if (dist < CELL * 0.75) {
        pacman.alive = false;
        endGame(room, 'ghosts');
        return;
      }
    }
  }

  // All pellets eaten
  if (room.pelletsLeft <= 0) {
    endGame(room, 'pacman');
    return;
  }

  broadcastState(room);
}

function endGame(room, winner) {
  room.phase = 'over';
  clearInterval(room.tickInterval);
  room.tickInterval = null;

  const state = buildState(room);
  state.winner = winner;
  io.to(room.id).emit('game_over', state);
}

function buildState(room) {
  return {
    phase: room.phase,
    maze: room.maze,
    pelletsLeft: room.pelletsLeft,
    totalPellets: room.totalPellets,
    players: Object.entries(room.players).map(([id, p]) => ({
      id,
      name: p.name,
      role: p.role,
      ghostIndex: p.ghostIndex,
      x: p.x,
      y: p.y,
      dx: p.dx,
      dy: p.dy,
      score: p.score,
      alive: p.alive,
    })),
  };
}

function broadcastState(room) {
  io.to(room.id).emit('state', buildState(room));
}

// ─── Socket.io ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('create_room', ({ name }) => {
    const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
    rooms[roomId] = createRoom(roomId);
    currentRoomId = roomId;
    socket.join(roomId);

    rooms[roomId].players[socket.id] = {
      id: socket.id, name, role: null, score: 0, alive: true,
      x: 0, y: 0, dx: 0, dy: 0, nextDx: 0, nextDy: 0,
    };

    socket.emit('room_created', { roomId });
    broadcastLobby(rooms[roomId]);
  });

  socket.on('join_room', ({ name, roomId }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', { msg: 'ルームが見つかりません' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { msg: 'ゲームはすでに始まっています' }); return; }
    if (Object.keys(room.players).length >= 4) { socket.emit('error', { msg: 'ルームが満員です（最大4人）' }); return; }

    currentRoomId = roomId;
    socket.join(roomId);
    room.players[socket.id] = {
      id: socket.id, name, role: null, score: 0, alive: true,
      x: 0, y: 0, dx: 0, dy: 0, nextDx: 0, nextDy: 0,
    };

    socket.emit('room_joined', { roomId });
    broadcastLobby(room);
  });

  socket.on('start_game', () => {
    const room = rooms[currentRoomId];
    if (!room) return;
    if (Object.keys(room.players).length < 2) {
      socket.emit('error', { msg: '2人以上必要です' });
      return;
    }

    room.maze = makeMaze();
    room.pelletsLeft = countPellets(room.maze);
    assignRoles(room);
    room.phase = 'playing';

    broadcastState(room);
    room.tickInterval = setInterval(() => gameTick(room), TICK_MS);
  });

  socket.on('input', ({ dx, dy }) => {
    const room = rooms[currentRoomId];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || player.role !== 'pacman') return;
    player.nextDx = dx;
    player.nextDy = dy;
  });

  socket.on('ghost_move', ({ dx, dy }) => {
    const room = rooms[currentRoomId];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || player.role !== 'ghost') return;
    player.dx = dx;
    player.dy = dy;
  });

  socket.on('restart', () => {
    const room = rooms[currentRoomId];
    if (!room) return;
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.phase = 'lobby';
    room.maze = makeMaze();
    room.pelletsLeft = countPellets(room.maze);
    Object.values(room.players).forEach(p => { p.role = null; p.score = 0; p.alive = true; });
    broadcastLobby(room);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms[currentRoomId];
    if (!room) return;
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      if (room.tickInterval) clearInterval(room.tickInterval);
      delete rooms[currentRoomId];
    } else {
      if (room.phase === 'playing') {
        endGame(room, 'disconnect');
      } else {
        broadcastLobby(room);
      }
    }
  });
});

function broadcastLobby(room) {
  io.to(room.id).emit('lobby', {
    roomId: room.id,
    players: Object.values(room.players).map(p => ({ id: p.id, name: p.name })),
  });
}

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
