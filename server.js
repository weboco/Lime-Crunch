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

// Config for dynamic bots
const TARGET_TOTAL_PLAYERS = 6; // How many total snakes we want on the map
const MAX_BOTS = 5;             // Maximum bots allowed

let players = {};
let food = [];
let nextFoodId = 0;
let botIdCounter = 0;

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
    name: isBot ? `🤖 Bot ${Math.floor(Math.random() * 100)}` : (name || 'Anonymous'),
    skin: isBot ? Math.floor(Math.random() * 3) : (skin || 0),
    snake,
    direction: dir,
    nextDirection: dir,
    alive: true,
    score: 0,
    isBot: isBot, // Flag to identify bots
    moveCounter: 0 // For AI logic
  };
}

// ===================== DYNAMIC BOT MANAGEMENT =====================
function manageBots() {
  // Count current real players and bots
  const realPlayers = Object.values(players).filter(p => !p.isBot);
  const currentBots = Object.values(players).filter(p => p.isBot);
  
  // Calculate how many bots we need
  let desiredBots = TARGET_TOTAL_PLAYERS - realPlayers.length;
  desiredBots = Math.max(0, Math.min(MAX_BOTS, desiredBots));
  
  // 1. If we have too many bots, remove the extras
  if (currentBots.length > desiredBots) {
    const botsToRemove = currentBots.length - desiredBots;
    let removed = 0;
    for (let id in players) {
      if (players[id].isBot && removed < botsToRemove) {
        delete players[id];
        removed++;
      }
    }
    console.log(`🤖 Removed ${removed} bots. Real players: ${realPlayers.length}`);
  }
  
  // 2. If we need more bots, spawn them
  if (currentBots.length < desiredBots) {
    const botsToAdd = desiredBots - currentBots.length;
    for (let i = 0; i < botsToAdd; i++) {
      const botId = `bot_${botIdCounter++}`;
      players[botId] = createPlayer(botId, null, null, true);
    }
    console.log(`🤖 Added ${botsToAdd} bots. Real players: ${realPlayers.length}`);
  }
}
// ================================================================

function gameTick() {
  // ---- BOT AI LOGIC ----
  for (let id in players) {
    const p = players[id];
    if (!p.isBot || !p.alive) continue;
    
    const head = p.snake[0];
    let nearest = null;
    let nearestDist = Infinity;
    
    for (let f of food) {
      const dist = Math.sqrt((f.x - head.x)**2 + (f.y - head.y)**2);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = f;
      }
    }
    
    if (nearest) {
      const dx = nearest.x - head.x;
      const dy = nearest.y - head.y;
      let newDx = 0, newDy = 0;
      
      // 70% chase food, 30% random move to avoid getting stuck
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

  // Respawn dead bots automatically
  for (let id in players) {
    const p = players[id];
    if (p.isBot && !p.alive) {
      // Remove dead bot, a new one will spawn in manageBots()
      delete players[id];
    }
  }

  spawnFood();
  
  // ----- DYNAMIC BOT ADJUSTMENT (runs every tick) -----
  manageBots();
}

io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
    console.log('🎮 Player joined:', socket.id, name, skin);
    players[socket.id] = createPlayer(socket.id, name, skin, false);
    
    // Adjust bots immediately when a real player joins
    manageBots();
    
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
    
    // Fill the gap with bots immediately
    manageBots();
    
    io.emit('gameState', { players, food });
  });
});

setInterval(() => {
  gameTick();
  io.emit('gameState', { players, food });
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🌐 Test URL: http://localhost:${PORT}/test`);
});
