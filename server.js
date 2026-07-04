const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname)));
app.get('/test', (req, res) => res.send('Server is running!'));

// ========== CONFIG ==========
const GRID_WIDTH = 40;
const GRID_HEIGHT = 30;
const TICK_INTERVAL = 150;          // slower game loop (150ms)
const BROADCAST_INTERVAL = 300;      // send updates every 300ms (2 ticks)
const INITIAL_SNAKE_LENGTH = 3;
const MAX_BOTS = 2;                 // only 2 bots max
const TARGET_TOTAL = 3;             // total snakes = real players + bots

// ========== STATE ==========
let players = {};
let food = [];
let nextFoodId = 0;
let botIdCounter = 0;

// Cute bot names (short)
const BOT_NAMES = ['🐼 Panda', '🦊 Fox', '🐱 Cat'];

// ========== HELPERS ==========
function randomGridPos() {
  return { x: Math.floor(Math.random() * GRID_WIDTH), y: Math.floor(Math.random() * GRID_HEIGHT) };
}

function spawnFood() {
  // Keep food count lower (6 instead of 10) to reduce data
  while (food.length < 6) {
    const pos = randomGridPos();
    let occupied = false;
    for (let id in players) {
      if (players[id].snake.some(seg => seg.x === pos.x && seg.y === pos.y)) {
        occupied = true;
        break;
      }
    }
    if (!occupied) food.push({ id: nextFoodId++, ...pos });
  }
}

function createPlayer(id, name, skin, isBot = false) {
  const startX = Math.floor(Math.random() * (GRID_WIDTH - 10)) + 5;
  const startY = Math.floor(Math.random() * (GRID_HEIGHT - 10)) + 5;
  const dir = { dx: 1, dy: 0 };
  const snake = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) snake.push({ x: startX - i, y: startY });
  return {
    id,
    name: isBot ? BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] : (name || 'Anonymous'),
    skin: isBot ? Math.floor(Math.random() * 3) : (skin || 0),
    snake,
    direction: dir,
    nextDirection: dir,
    alive: true,
    score: 0,
    isBot
  };
}

// ========== BOT MANAGEMENT ==========
function manageBots() {
  const realPlayers = Object.values(players).filter(p => !p.isBot);
  const currentBots = Object.values(players).filter(p => p.isBot);
  let desiredBots = Math.max(0, Math.min(MAX_BOTS, TARGET_TOTAL - realPlayers.length));

  // Remove excess bots
  if (currentBots.length > desiredBots) {
    let toRemove = currentBots.length - desiredBots;
    for (let id in players) {
      if (players[id].isBot && toRemove > 0) {
        delete players[id];
        toRemove--;
      }
    }
  }
  // Add missing bots
  if (currentBots.length < desiredBots) {
    for (let i = 0; i < desiredBots - currentBots.length; i++) {
      const botId = `bot_${botIdCounter++}`;
      players[botId] = createPlayer(botId, null, null, true);
    }
  }
}

// ========== GAME TICK ==========
function gameTick() {
  // --- BOT AI: RANDOM WANDERING (no chasing, no distance math) ---
  for (let id in players) {
    const p = players[id];
    if (!p.isBot || !p.alive) continue;
    // Change direction randomly every ~1 second (approx 6-7 ticks)
    if (Math.random() < 0.15) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      const newDir = dirs[Math.floor(Math.random() * dirs.length)];
      const cur = p.direction;
      // Prevent immediate reversal
      if (!(newDir.dx === -cur.dx && newDir.dy === -cur.dy)) {
        p.nextDirection = newDir;
      }
    }
  }

  // --- Movement ---
  const moves = [];
  for (let id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const newDir = p.nextDirection;
    const curDir = p.direction;
    if (!(newDir.dx === -curDir.dx && newDir.dy === -curDir.dy)) p.direction = newDir;
    const head = p.snake[0];
    moves.push({ id, newHead: { x: head.x + p.direction.dx, y: head.y + p.direction.dy } });
  }

  // --- Eat food ---
  const eaten = new Set();
  for (let m of moves) {
    for (let i = 0; i < food.length; i++) {
      if (food[i].x === m.newHead.x && food[i].y === m.newHead.y) {
        eaten.add(m.id);
        food.splice(i, 1);
        i--;
      }
    }
  }

  // --- Apply moves ---
  for (let m of moves) {
    const p = players[m.id];
    if (!p) continue;
    p.snake.unshift(m.newHead);
    if (!eaten.has(m.id)) p.snake.pop();
    else p.score += 10;
  }

  // --- Collisions ---
  for (let id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.snake[0];
    // Walls
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      p.alive = false; continue;
    }
    // Self
    for (let i = 1; i < p.snake.length; i++) {
      if (p.snake[i].x === head.x && p.snake[i].y === head.y) { p.alive = false; break; }
    }
    if (!p.alive) continue;
    // Other snakes
    for (let otherId in players) {
      if (otherId === id || !players[otherId].alive) continue;
      for (let seg of players[otherId].snake) {
        if (seg.x === head.x && seg.y === head.y) { p.alive = false; break; }
      }
      if (!p.alive) break;
    }
  }

  // --- Respawn dead bots immediately (simple deletion) ---
  // They will be re-added by manageBots() which runs on join/leave and every 10s.
  for (let id in players) {
    if (players[id].isBot && !players[id].alive) delete players[id];
  }

  spawnFood();
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    manageBots();
    io.emit('gameState', { players, food });
  });

  socket.on('direction', ({ dx, dy }) => {
    const p = players[socket.id];
    if (p && p.alive) p.nextDirection = { dx, dy };
  });

  socket.on('changeSkin', (skin) => {
    const p = players[socket.id];
    if (p && p.alive) { p.skin = skin; io.emit('gameState', { players, food }); }
  });

  socket.on('respawn', ({ name, skin }) => {
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    socket.emit('respawnConfirmed');
    io.emit('gameState', { players, food });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    manageBots();
    io.emit('gameState', { players, food });
  });
});

// ========== GAME LOOP ==========
let tick = 0;
setInterval(() => {
  gameTick();
  tick++;
  // Broadcast every 2 ticks (300ms)
  if (tick % 2 === 0) {
    io.emit('gameState', { players, food });
  }
}, TICK_INTERVAL);

// ========== PERIODIC BOT CHECK (every 10 seconds) ==========
setInterval(() => {
  manageBots();
  // Also broadcast after adjustment to reflect changes
  io.emit('gameState', { players, food });
}, 10000);

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
