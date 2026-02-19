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
  }
});

app.use(express.static(path.join(__dirname)));

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
  let startX, startY;
  const side = Math.floor(Math.random() * 4);
  if (side === 0) {
    startX = Math.floor(GRID_WIDTH / 2) + (Math.random() - 0.5) * 5;
    startY = 2;
  } else if (side === 1) {
    startX = GRID_WIDTH - 3;
    startY = Math.floor(GRID_HEIGHT / 2) + (Math.random() - 0.5) * 5;
  } else if (side === 2) {
    startX = Math.floor(GRID_WIDTH / 2) + (Math.random() - 0.5) * 5;
    startY = GRID_HEIGHT - 3;
  } else {
    startX = 2;
    startY = Math.floor(GRID_HEIGHT / 2) + (Math.random() - 0.5) * 5;
  }
  startX = Math.max(1, Math.min(GRID_WIDTH - 2, Math.floor(startX)));
  startY = Math.max(1, Math.min(GRID_HEIGHT - 2, Math.floor(startY)));

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

  spawnFood();
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', ({ name, skin }) => {
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
    if (p) {
      p.skin = skin;
      io.emit('gameState', { players, food });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('gameState', { players, food });
    console.log('Player disconnected:', socket.id);
  });
});

setInterval(() => {
  gameTick();
  io.emit('gameState', { players, food });
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
