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
  // Add these for better connection handling
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Add a test route
app.get('/test', (req, res) => {
  res.send('Server is running!');
});

const GRID_WIDTH = 40;
const GRID_HEIGHT = 30;
const TICK_INTERVAL = 100;
const INITIAL_SNAKE_LENGTH = 3;

let players = {};
let food = [];
let nextFoodId = 0;

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

function createPlayer(socketId, name, skin) {
  // Spawn in the middle
  const startX = Math.floor(GRID_WIDTH / 2);
  const startY = Math.floor(GRID_HEIGHT / 2);

  const dir = { dx: 1, dy: 0 };
  const snake = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    snake.push({ x: startX - i, y: startY });
  }
  return {
    id: socketId,
    name: name || 'Anonymous',
    skin: skin || 0,
    snake,
    direction: dir,
    nextDirection: dir,
    alive: true,
    score: 0
  };
}

function gameTick() {
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

    // Wall collision
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      p.alive = false;
      continue;
    }

    // Self collision
    for (let i = 1; i < p.snake.length; i++) {
      if (p.snake[i].x === head.x && p.snake[i].y === head.y) {
        p.alive = false;
        break;
      }
    }
    if (!p.alive) continue;

    // Collision with other snakes
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

  spawnFood();
}

io.on('connection', (socket) => {
  console.log('✅ Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
    console.log('🎮 Player joined:', socket.id, name, skin);
    const player = createPlayer(socket.id, name, skin);
    players[socket.id] = player;
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
    
    // Create new player
    const newPlayer = createPlayer(socket.id, name, skin);
    players[socket.id] = newPlayer;
    
    // Send confirmation back to the client
    socket.emit('respawnConfirmed');
    
    // Broadcast updated game state to everyone
    io.emit('gameState', { players, food });
    
    console.log('✅ Respawn complete for:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('❌ Player disconnected:', socket.id);
    delete players[socket.id];
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
