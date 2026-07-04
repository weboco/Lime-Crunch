const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname)));

app.get('/test', (req, res) => {
  res.send('Server is running!');
});

const GRID_WIDTH = 40;
const GRID_HEIGHT = 30;
const TICK_INTERVAL = 100;
const INITIAL_SNAKE_LENGTH = 3;

// === OPTIMIZED: Fewer total snakes ===
const TARGET_TOTAL_PLAYERS = 4; // Changed from 6 to 4
const MAX_BOTS = 3;

let players = {};
let food = [];
let nextFoodId = 0;
let botIdCounter = 0;

// === OPTIMIZED: Bot names with cute emojis ===
const botNames = [
  '🐼 Panda', '🦊 Fox', '🐱 Cat', '🐶 Dog', 
  '🐰 Bunny', '🐨 Koala', '🦄 Unicorn', '🐧 Penguin',
  '🍕 Pizza', '🌮 Taco', '🍣 Sushi', '🧁 Cupcake'
];

function randomGridPos() {
  return {
    x: Math.floor(Math.random() * GRID_WIDTH),
    y: Math.floor(Math.random() * GRID_HEIGHT)
  };
}

function spawnFood() {
  while (food.length < 10) {
    const pos = randomGridPos();
    let occupied = false;
    for (let id in players) {
      if (players[id].snake.some(seg => seg.x === pos.x && seg.y === pos.y)) {
        occupied = true;
        break;
      }
    }
    if (!occupied) {
      food.push({ id: nextFoodId++, ...pos });
    }
  }
}

function createPlayer(socketId, name, skin, isBot = false) {
  const startX = Math.floor(Math.random() * (GRID_WIDTH - 10)) + 5;
  const startY = Math.floor(Math.random() * (GRID_HEIGHT - 10)) + 5;

  const dir = { dx: 1, dy: 0 };
  const snake = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    snake.push({ x: startX - i, y: startY });
  }
  
  return {
    id: socketId,
    name: isBot ? botNames[Math.floor(Math.random() * botNames.length)] : (name || 'Anonymous'),
    skin: isBot ? Math.floor(Math.random() * 3) : (skin || 0),
    snake,
    direction: dir,
    nextDirection: dir,
    alive: true,
    score: 0,
    isBot: isBot,
    moveCounter: 0
  };
}

// ===================== BOT MANAGEMENT (optimized) =====================
function manageBots() {
  const realPlayers = Object.values(players).filter(p => !p.isBot);
  const currentBots = Object.values(players).filter(p => p.isBot);
  
  let desiredBots = TARGET_TOTAL_PLAYERS - realPlayers.length;
  desiredBots = Math.max(0, Math.min(MAX_BOTS, desiredBots));
  
  // Remove extra bots
  if (currentBots.length > desiredBots) {
    const botsToRemove = currentBots.length - desiredBots;
    let removed = 0;
    for (let id in players) {
      if (players[id].isBot && removed < botsToRemove) {
        delete players[id];
        removed++;
      }
    }
  }
  
  // Add missing bots
  if (currentBots.length < desiredBots) {
    const botsToAdd = desiredBots - currentBots.length;
    for (let i = 0; i < botsToAdd; i++) {
      const botId = `bot_${botIdCounter++}`;
      players[botId] = createPlayer(botId, null, null, true);
    }
  }
}
// ================================================================

function gameTick() {
  // ---- OPTIMIZED BOT AI (no Math.sqrt!) ----
  for (let id in players) {
    const p = players[id];
    if (!p.isBot || !p.alive) continue;
    
    const head = p.snake[0];
    let nearest = null;
    let nearestDistSq = Infinity; // Use squared distance
    
    for (let f of food) {
      const dx = f.x - head.x;
      const dy = f.y - head.y;
      const distSq = dx*dx + dy*dy; // No square root!
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = f;
      }
    }
    
    if (nearest) {
      const dx = nearest.x - head.x;
      const dy = nearest.y - head.y;
      let newDx = 0, newDy = 0;
      
      if (Math.random() < 0.7) {
        if (Math.abs(dx) > Math.abs(dy)) {
          newDx = dx > 0 ? 1 : -1;
        } else {
          newDy = dy > 0 ? 1 : -1;
        }
      } else {
        const dirs = [{dx:1,dy:0}, {dx:-1,dy:0}, {dx:0,dy:1}, {dx:0,dy:-1}];
        const rand = dirs[Math.floor(Math.random() * dirs.length)];
        newDx = rand.dx;
        newDy = rand.dy;
      }
      
      const current = p.direction;
      if (!(newDx === -current.dx && newDy === -current.dy)) {
        p.nextDirection = { dx: newDx, dy: newDy };
      }
    }
  }
  // ---- END BOT AI ----

  const moves = [];
  for (let id in players) {
    const p = players[id];
    if (!p.alive) continue;

    const newDir = p.nextDirection;
    const currentDir = p.direction;
    if (!(newDir.dx === -currentDir.dx && newDir.dy === -currentDir.dy)) {
      p.direction = newDir;
    }

    const head = p.snake[0];
    const newHead = {
      x: head.x + p.direction.dx,
      y: head.y + p.direction.dy
    };
    moves.push({ id, newHead });
  }

  const foodEaten = new Set();
  for (let move of moves) {
    for (let i = 0; i < food.length; i++) {
      if (food[i].x === move.newHead.x && food[i].y === move.newHead.y) {
        foodEaten.add(move.id);
        food.splice(i, 1);
        i--;
      }
    }
  }

  for (let move of moves) {
    const p = players[move.id];
    if (!p) continue;
    p.snake.unshift(move.newHead);
    if (!foodEaten.has(move.id)) {
      p.snake.pop();
    } else {
      p.score += 10;
    }
  }

  // Check collisions
  for (let id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.snake[0];

    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      p.alive = false;
      continue;
    }

    for (let i = 1; i < p.snake.length; i++) {
      if (p.snake[i].x === head.x && p.snake[i].y === head.y) {
        p.alive = false;
        break;
      }
    }
    if (!p.alive) continue;

    for (let otherId in players) {
      if (otherId === id || !players[otherId].alive) continue;
      const otherSnake = players[otherId].snake;
      for (let seg of otherSnake) {
        if (seg.x === head.x && seg.y === head.y) {
          p.alive = false;
          break;
      }}
    }
  }

  // Respawn dead bots
  for (let id in players) {
    const p = players[id];
    if (p.isBot && !p.alive) {
      delete players[id];
    }
  }

  spawnFood();
  
  // === OPTIMIZED: Don't call manageBots() here anymore ===
  // It's called only on player join/leave + every 10 seconds
}

// === OPTIMIZED: Separate interval for bot management (every 10 seconds) ===
setInterval(() => {
  manageBots();
}, 10000);

io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
    console.log('🎮 Player joined:', socket.id, name, skin);
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    manageBots(); // Only here
    io.emit('gameState', { players, food });
  });

  socket.on('direction', ({ dx, dy }) => {
    const p = players[socket.id];
    if (p && p.alive) {
      p.nextDirection = { dx, dy };
    }
  });

  socket.on('changeSkin', (skin) => {
    const p = players[socket.id];
    if (p && p.alive) {
      p.skin = skin;
      io.emit('gameState', { players, food });
    }
  });

  socket.on('respawn', ({ name, skin }) => {
    console.log('🔄 Respawn requested for:', socket.id, name, skin);
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    socket.emit('respawnConfirmed');
    io.emit('gameState', { players, food });
    console.log('✅ Respawn complete for:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('❌ Player disconnected:', socket.id);
    delete players[socket.id];
    manageBots(); // Only here
    io.emit('gameState', { players, food });
  });
});

// === OPTIMIZED: Game loop with throttled broadcasts ===
let tickCounter = 0;
setInterval(() => {
  gameTick();
  tickCounter++;
  
  // === KEY FIX: Send state only every 2 ticks (200ms) ===
  if (tickCounter % 2 === 0) {
    io.emit('gameState', { players, food });
  }
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🌐 Test URL: http://localhost:${PORT}/test`);
});
