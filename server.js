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
const TICK_INTERVAL = 150;        // 150ms between game ticks
const INITIAL_SNAKE_LENGTH = 3;
const MAX_BOTS = 1;               // only 1 bot for minimal load
const TARGET_TOTAL = 2;           // total = real + bot

// ========== STATE ==========
let players = {};
let food = [];
let nextFoodId = 0;
let botIdCounter = 0;

// Keep a copy of the previous state to compute deltas
let previousState = { players: {}, food: [] };

const BOT_NAMES = ['🐼 Panda'];    // only one name needed

function randomGridPos() {
  return { x: Math.floor(Math.random() * GRID_WIDTH), y: Math.floor(Math.random() * GRID_HEIGHT) };
}

function spawnFood() {
  while (food.length < 5) {        // only 5 food items
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
    name: isBot ? BOT_NAMES[0] : (name || 'Anonymous'),
    skin: isBot ? 0 : (skin || 0),
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

  if (currentBots.length > desiredBots) {
    let toRemove = currentBots.length - desiredBots;
    for (let id in players) {
      if (players[id].isBot && toRemove > 0) {
        delete players[id];
        toRemove--;
      }
    }
  }
  if (currentBots.length < desiredBots) {
    for (let i = 0; i < desiredBots - currentBots.length; i++) {
      const botId = `bot_${botIdCounter++}`;
      players[botId] = createPlayer(botId, null, null, true);
    }
  }
}

// ========== GAME TICK ==========
function gameTick() {
  // --- Bot AI: random wandering ---
  for (let id in players) {
    const p = players[id];
    if (!p.isBot || !p.alive) continue;
    if (Math.random() < 0.15) {
      const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      const newDir = dirs[Math.floor(Math.random() * dirs.length)];
      const cur = p.direction;
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
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      p.alive = false; continue;
    }
    for (let i = 1; i < p.snake.length; i++) {
      if (p.snake[i].x === head.x && p.snake[i].y === head.y) { p.alive = false; break; }
    }
    if (!p.alive) continue;
    for (let otherId in players) {
      if (otherId === id || !players[otherId].alive) continue;
      for (let seg of players[otherId].snake) {
        if (seg.x === head.x && seg.y === head.y) { p.alive = false; break; }
      }
      if (!p.alive) break;
    }
  }

  // --- Respawn dead bots (remove them) ---
  for (let id in players) {
    if (players[id].isBot && !players[id].alive) delete players[id];
  }

  spawnFood();
}

// ========== BUILD DELTA ==========
function buildDelta() {
  const delta = { players: {}, food: [] };
  const currentPlayers = players;
  const prevPlayers = previousState.players;
  const currentFood = food;
  const prevFood = previousState.food;

  // 1. Detect changed or new players
  for (let id in currentPlayers) {
    const p = currentPlayers[id];
    const prev = prevPlayers[id];
    if (!prev) {
      // New player
      delta.players[id] = { 
        id: p.id, name: p.name, skin: p.skin, snake: p.snake, 
        score: p.score, alive: p.alive, isBot: p.isBot 
      };
    } else {
      // Check if snake or score changed
      if (p.score !== prev.score || p.alive !== prev.alive || 
          JSON.stringify(p.snake) !== JSON.stringify(prev.snake)) {
        // Send only the changed fields (but for simplicity, send full player again)
        // For minimal delta, we could send only changed attributes, but full player is still small.
        delta.players[id] = { id: p.id, name: p.name, skin: p.skin, snake: p.snake, score: p.score, alive: p.alive, isBot: p.isBot };
      }
    }
  }

  // 2. Detect removed players
  for (let id in prevPlayers) {
    if (!currentPlayers[id]) {
      delta.players[id] = null; // marker for removal
    }
  }

  // 3. Detect food changes
  const currentFoodIds = new Set(currentFood.map(f => f.id));
  const prevFoodIds = new Set(prevFood.map(f => f.id));

  // New food
  for (let f of currentFood) {
    if (!prevFoodIds.has(f.id)) {
      delta.food.push(f);
    }
  }
  // Removed food (we mark as null)
  for (let f of prevFood) {
    if (!currentFoodIds.has(f.id)) {
      delta.food.push({ id: f.id, removed: true });
    }
  }

  // Store current state as previous for next tick
  // Deep copy to avoid reference issues
  previousState = {
    players: JSON.parse(JSON.stringify(currentPlayers)),
    food: JSON.parse(JSON.stringify(currentFood))
  };

  return delta;
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    manageBots();
    // Send full initial state (delta would be empty)
    io.emit('gameState', { players, food }); // first full state
  });

  socket.on('direction', ({ dx, dy }) => {
    const p = players[socket.id];
    if (p && p.alive) p.nextDirection = { dx, dy };
  });

  socket.on('changeSkin', (skin) => {
    const p = players[socket.id];
    if (p && p.alive) { p.skin = skin; /* delta will capture */ }
  });

  socket.on('respawn', ({ name, skin }) => {
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    socket.emit('respawnConfirmed');
    // Force full state broadcast
    io.emit('gameState', { players, food });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    manageBots();
    // No immediate broadcast; next tick will send delta
  });
});

// ========== GAME LOOP WITH DELTA BROADCAST ==========
let tick = 0;
setInterval(() => {
  gameTick();
  tick++;
  // Broadcast delta every 2 ticks (300ms)
  if (tick % 2 === 0) {
    const delta = buildDelta();
    // Only send if there are actual changes (to avoid empty broadcasts)
    const hasChanges = Object.keys(delta.players).length > 0 || delta.food.length > 0;
    if (hasChanges) {
      io.emit('gameDelta', delta);
    }
  }
}, TICK_INTERVAL);

// ========== PERIODIC BOT CHECK ==========
setInterval(() => {
  manageBots();
}, 10000);

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
