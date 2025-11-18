const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Game state
const gameState = {
  players: new Map(),
  hider: null,
  gameStarted: false,
  zoneCenter: null,
  zoneRadius: 1000, // meters
  initialRadius: 1000,
  shrinkRate: 0.98, // 2% reduction each interval
  shrinkInterval: 30000, // 30 seconds
  gameStartTime: null
};

let shrinkTimer = null;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Player joins the game
  socket.on('join-game', (data) => {
    const { role, name } = data;
    
    const player = {
      id: socket.id,
      name: name || `Player ${socket.id.substr(0, 6)}`,
      role: role,
      location: null,
      lastUpdate: Date.now()
    };

    gameState.players.set(socket.id, player);

    if (role === 'hider') {
      if (gameState.hider) {
        // Already have a hider, reject
        socket.emit('join-rejected', { reason: 'Hider slot already taken' });
        gameState.players.delete(socket.id);
        return;
      }
      gameState.hider = socket.id;
    }

    socket.emit('join-accepted', { 
      playerId: socket.id, 
      role: role,
      gameState: getPublicGameState() 
    });

    // Broadcast to all players
    socket.broadcast.emit('player-joined', {
      player: getPublicPlayerInfo(player),
      gameState: getPublicGameState()
    });

    console.log(`${player.name} joined as ${role}`);
  });

  // Location update
  socket.on('location-update', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    player.location = {
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy || 10
    };
    player.lastUpdate = Date.now();

    // If this is the hider and we don't have a zone center yet, set it
    if (player.role === 'hider' && !gameState.zoneCenter) {
      gameState.zoneCenter = { lat: data.lat, lng: data.lng };
    }

    // Broadcast location to seekers (but not the hider's location)
    if (player.role === 'seeker') {
      socket.broadcast.emit('player-location-update', {
        playerId: socket.id,
        location: player.location,
        name: player.name
      });
    }

    // Check if we can start the game
    checkGameStart();
  });

  // Start game manually
  socket.on('start-game', () => {
    const player = gameState.players.get(socket.id);
    if (player && player.role === 'hider' && !gameState.gameStarted) {
      startGame();
    }
  });

  // Hider found button
  socket.on('hider-found', () => {
    const player = gameState.players.get(socket.id);
    if (player && player.role === 'hider' && gameState.gameStarted) {
      io.emit('game-ended', { 
        reason: 'Hider was found', 
        winner: 'seekers',
        finder: 'Hider surrendered'
      });
      stopGame();
    }
  });

  // Player disconnection
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      console.log(`${player.name} disconnected`);
      
      if (player.role === 'hider') {
        gameState.hider = null;
        stopGame();
      }

      gameState.players.delete(socket.id);
      
      socket.broadcast.emit('player-left', {
        playerId: socket.id,
        gameState: getPublicGameState()
      });
    }
  });
});

// Game logic functions
function checkGameStart() {
  if (gameState.gameStarted) return;
  
  const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
  const seekers = Array.from(gameState.players.values()).filter(p => p.role === 'seeker');
  
  // Auto-start if we have a hider with location and at least one seeker
  if (hiderPlayer && hiderPlayer.location && seekers.length > 0) {
    startGame();
  }
}

function startGame() {
  if (gameState.gameStarted) return;
  
  gameState.gameStarted = true;
  gameState.gameStartTime = Date.now();
  
  // Initialize zone around all players if not set
  if (!gameState.zoneCenter) {
    const allLocations = Array.from(gameState.players.values())
      .filter(p => p.location)
      .map(p => p.location);
    
    if (allLocations.length > 0) {
      gameState.zoneCenter = calculateCenterPoint(allLocations);
    }
  }

  console.log('Game started!');
  io.emit('game-started', {
    gameState: getPublicGameState(),
    zone: getZoneInfo()
  });

  // Start zone shrinking
  startZoneShrinking();
}

function stopGame() {
  gameState.gameStarted = false;
  gameState.gameStartTime = null;
  gameState.zoneCenter = null;
  gameState.zoneRadius = gameState.initialRadius;
  
  if (shrinkTimer) {
    clearInterval(shrinkTimer);
    shrinkTimer = null;
  }

  io.emit('game-stopped');
  console.log('Game stopped');
}

function startZoneShrinking() {
  if (shrinkTimer) clearInterval(shrinkTimer);
  
  shrinkTimer = setInterval(() => {
    const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
    
    if (!hiderPlayer || !hiderPlayer.location) return;

    // Move zone center towards hider (but not directly on them)
    const hiderLoc = hiderPlayer.location;
    const currentCenter = gameState.zoneCenter;
    
    // Calculate new center (80% towards hider, with some randomness)
    const moveRatio = 0.3;
    const randomOffset = 0.0005; // Small random offset
    
    const newLat = currentCenter.lat + (hiderLoc.lat - currentCenter.lat) * moveRatio + 
                   (Math.random() - 0.5) * randomOffset;
    const newLng = currentCenter.lng + (hiderLoc.lng - currentCenter.lng) * moveRatio + 
                   (Math.random() - 0.5) * randomOffset;

    gameState.zoneCenter = { lat: newLat, lng: newLng };
    
    // Shrink zone
    gameState.zoneRadius *= gameState.shrinkRate;
    
    // Check win conditions
    checkWinConditions();
    
    // Broadcast zone update
    io.emit('zone-update', getZoneInfo());
    
    console.log(`Zone updated: radius ${Math.round(gameState.zoneRadius)}m, center: ${newLat.toFixed(6)}, ${newLng.toFixed(6)}`);
    
    // Stop shrinking if zone gets too small
    if (gameState.zoneRadius < 50) {
      io.emit('game-ended', { reason: 'Zone collapsed', winner: 'hider' });
      stopGame();
    }
  }, gameState.shrinkInterval);
}

function checkWinConditions() {
  if (!gameState.gameStarted) return;
  
  const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
  
  if (!hiderPlayer || !hiderPlayer.location) return;
  
  // Check if hider is outside the zone
  const hiderDistance = calculateDistance(hiderPlayer.location, gameState.zoneCenter);
  if (hiderDistance > gameState.zoneRadius) {
    io.emit('game-ended', { 
      reason: 'Hider left the zone', 
      winner: 'seekers'
    });
    stopGame();
  }
}

// Helper functions
function getPublicGameState() {
  const seekers = Array.from(gameState.players.values())
    .filter(p => p.role === 'seeker')
    .map(p => getPublicPlayerInfo(p));
    
  return {
    gameStarted: gameState.gameStarted,
    playerCount: gameState.players.size,
    hasHider: !!gameState.hider,
    seekers: seekers,
    gameStartTime: gameState.gameStartTime
  };
}

function getPublicPlayerInfo(player) {
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    location: player.role === 'seeker' ? player.location : null, // Hide hider location
    lastUpdate: player.lastUpdate
  };
}

function getZoneInfo() {
  if (!gameState.zoneCenter) return null;
  
  const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
  let innerCircle = null;
  
  if (hiderPlayer && hiderPlayer.location) {
    // Create smaller circle that contains the hider
    const innerRadius = Math.min(gameState.zoneRadius * 0.3, 100); // 30% of zone or max 100m
    innerCircle = {
      center: hiderPlayer.location,
      radius: innerRadius
    };
  }
  
  return {
    center: gameState.zoneCenter,
    radius: gameState.zoneRadius,
    innerCircle: innerCircle,
    showToSeekers: true // Always show zone to seekers
  };
}

function calculateDistance(pos1, pos2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLon = (pos2.lng - pos1.lng) * Math.PI / 180;
  const lat1 = pos1.lat * Math.PI / 180;
  const lat2 = pos2.lat * Math.PI / 180;

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
           Math.cos(lat1) * Math.cos(lat2) *
           Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function calculateCenterPoint(locations) {
  if (locations.length === 0) return null;
  
  const avgLat = locations.reduce((sum, loc) => sum + loc.lat, 0) / locations.length;
  const avgLng = locations.reduce((sum, loc) => sum + loc.lng, 0) / locations.length;
  
  return { lat: avgLat, lng: avgLng };
}

// Start server
server.listen(PORT, () => {
  console.log(`SeekThem server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
});