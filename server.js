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
let gameState = {
  gameStarted: false,
  gameEndTime: null,
  zoneCenter: null,
  zoneRadius: 5000,
  initialRadius: 5000, // Add initial radius for reset purposes
  targetZoneCenter: null,
  targetZoneRadius: null,
  zonePhase: 'waiting', // 'waiting', 'showing-target', 'shrinking'
  shrinkRate: 0.5, // 50% shrink by default
  shrinkInterval: 15 * 60 * 1000, // 15 minutes in milliseconds
  zoneTimer: null,
  zoneShrinkStartTime: null,
  players: new Map(),
  disconnectedPlayers: new Map(), // Store disconnected player data
  hider: null
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
    
    console.log(`=== JOIN REQUEST DEBUG ===`);
    console.log(`Join request: ${name} wants to be ${role}`);
    console.log(`Current hider: ${gameState.hider}`);
    console.log(`Players in game: ${gameState.players.size}`);
    console.log(`Disconnected players: ${gameState.disconnectedPlayers.size}`);
    console.log(`Game started: ${gameState.gameStarted}`);
    
    // Check if this username is already connected
    const existingPlayer = Array.from(gameState.players.values()).find(p => p.name === name);
    if (existingPlayer && existingPlayer.id !== socket.id) {
      console.log(`Rejecting ${name}: username already in use by ${existingPlayer.id}`);
      socket.emit('join-rejected', { reason: 'Username already in use' });
      return;
    }

    // Check if this is a reconnection
    const disconnectedPlayer = gameState.disconnectedPlayers.get(name);
    let player;

    if (disconnectedPlayer) {
      console.log(`Found disconnected player data for ${name}: role ${disconnectedPlayer.role}`);
      // Reconnecting player
      player = {
        id: socket.id,
        name: name,
        role: disconnectedPlayer.role,
        location: disconnectedPlayer.location,
        lastUpdate: Date.now()
      };
      gameState.disconnectedPlayers.delete(name);
      
      if (disconnectedPlayer.role === 'hider') {
        gameState.hider = socket.id;
        console.log(`Restored hider: ${socket.id}`);
      }
      
      gameState.players.set(socket.id, player);
      
      console.log(`${player.name} reconnected as ${player.role}. Hider is now: ${gameState.hider}`);
      
      socket.emit('join-accepted', { 
        playerId: socket.id, 
        role: player.role,
        gameState: getPublicGameState(),
        reconnected: true
      });
      
      // Broadcast reconnection
      socket.broadcast.emit('player-joined', {
        player: getPublicPlayerInfo(player),
        gameState: getPublicGameState(),
        reconnected: true
      });
    } else {
      console.log(`New player joining as ${role}`);
      // New player
      if (role === 'hider') {
        if (gameState.hider) {
          // Check if this is the same player trying to rejoin as hider
          const existingHider = gameState.players.get(gameState.hider);
          if (existingHider && existingHider.name === name) {
            console.log(`Same player (${name}) rejoining as hider, updating their socket ID`);
            // Remove old hider entry and update to new socket ID
            gameState.players.delete(gameState.hider);
            gameState.hider = socket.id;
          } else {
            // Different player trying to be hider
            console.log(`REJECTING ${name} as hider because ${gameState.hider} is already hider`);
            socket.emit('join-rejected', { reason: 'Hider slot already taken' });
            return;
          }
        } else {
          gameState.hider = socket.id;
          console.log(`Set new hider: ${socket.id}`);
        }
      }

      const player = {
        id: socket.id,
        name: name || `Player ${socket.id.substr(0, 6)}`,
        role: role,
        location: null,
        lastUpdate: Date.now()
      };

      gameState.players.set(socket.id, player);

      console.log(`${player.name} joined as ${role}. Hider is now: ${gameState.hider}`);
      console.log(`=== JOIN SUCCESSFUL ===`);

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
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      // Store player data for potential reconnection
      if (player.name && player.name !== 'Admin') {
        gameState.disconnectedPlayers.set(player.name, {
          name: player.name,
          role: player.role,
          location: player.location,
          disconnectedAt: Date.now()
        });
      }
      
      gameState.players.delete(socket.id);
      
      // If the hider disconnected, keep their data but mark as disconnected
      if (gameState.hider === socket.id) {
        gameState.hider = null; // Will be restored on reconnect
      }
      
      socket.broadcast.emit('player-left', {
        playerId: socket.id,
        name: player.name,
        disconnected: true
      });
      
      console.log(`Player ${player.name} disconnected`);
    }
  });

  socket.on('location-update', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    player.location = {
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy || 10
    };
    player.lastUpdate = Date.now();

    // Don't auto-set zone center here - let startGame() handle proper randomization

    // Broadcast seeker locations to everyone
    // Broadcast hider location only to the hider themselves
    if (player.role === 'seeker') {
      // Send seeker location to all players
      io.emit('player-location-update', {
        playerId: socket.id,
        location: player.location,
        name: player.name,
        role: player.role
      });
    } else if (player.role === 'hider') {
      // Send hider location only to the hider themselves
      socket.emit('player-location-update', {
        playerId: socket.id,
        location: player.location,
        name: player.name,
        role: player.role
      });
    }
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

  // Leave game manually
  socket.on('leave-game', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      console.log(`${player.name} left the game manually`);
      
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

  // Admin functions
  socket.on('request-admin-data', () => {
    // Clean up any invalid entries in players map
    for (const [socketId, player] of gameState.players.entries()) {
      if (!player || !player.name || !player.role) {
        console.log(`Removing invalid player entry: ${socketId}`, player);
        gameState.players.delete(socketId);
      }
    }
    
    socket.emit('admin-game-state', {
      ...getPublicGameState(),
      zoneSettings: {
        shrinkRate: gameState.shrinkRate,
        shrinkInterval: gameState.shrinkInterval,
        currentRadius: gameState.zoneRadius,
        phase: gameState.zonePhase
      }
    });
  });

  socket.on('add-dummy-player', (dummyData) => {
    const dummyId = 'dummy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const dummyPlayer = {
      id: dummyId,
      name: dummyData.name,
      role: dummyData.role,
      location: dummyData.location,
      lastUpdate: Date.now(),
      isDummy: true
    };

    gameState.players.set(dummyId, dummyPlayer);

    if (dummyData.role === 'hider' && !gameState.hider) {
      gameState.hider = dummyId;
      if (!gameState.zoneCenter) {
        gameState.zoneCenter = { lat: dummyData.location.lat, lng: dummyData.location.lng };
      }
    }

    // Broadcast to all players
    io.emit('player-joined', {
      player: getPublicPlayerInfo(dummyPlayer),
      gameState: getPublicGameState()
    });

    socket.emit('dummy-player-added', {
      name: dummyData.name,
      role: dummyData.role
    });

    console.log(`Dummy ${dummyData.role} added: ${dummyData.name}`);
  });

  socket.on('remove-dummy-players', () => {
    const dummyIds = [];
    gameState.players.forEach((player, id) => {
      if (player.isDummy) {
        dummyIds.push(id);
      }
    });

    dummyIds.forEach(id => {
      const player = gameState.players.get(id);
      if (player && player.role === 'hider') {
        gameState.hider = null;
      }
      gameState.players.delete(id);
    });

    if (dummyIds.length > 0) {
      stopGame();
    }

    io.emit('dummy-players-removed');
    console.log(`Removed ${dummyIds.length} dummy players`);
  });

  socket.on('remove-dummy-player', (dummyName) => {
    let removedId = null;
    gameState.players.forEach((player, id) => {
      if (player.isDummy && player.name === dummyName) {
        removedId = id;
      }
    });

    if (removedId) {
      const player = gameState.players.get(removedId);
      if (player && player.role === 'hider') {
        gameState.hider = null;
        stopGame();
      }
      gameState.players.delete(removedId);
      
      io.emit('player-left', {
        playerId: removedId,
        gameState: getPublicGameState()
      });
    }
  });

  socket.on('admin-start-game', () => {
    if (!gameState.gameStarted) {
      startGame();
    }
  });

  socket.on('admin-stop-game', () => {
    if (gameState.gameStarted) {
      stopGame();
    }
  });

  socket.on('admin-reset-game', () => {
    console.log('Admin reset triggered - performing complete game reset');
    
    // Stop the game and clear all timers
    stopGame();
    
    // Comprehensive state reset
    gameState.players.clear();
    gameState.disconnectedPlayers.clear();
    gameState.hider = null;
    gameState.zoneCenter = null;
    gameState.targetZoneCenter = null;
    gameState.zoneRadius = gameState.initialRadius;
    gameState.targetZoneRadius = null;
    gameState.zonePhase = 'waiting';
    gameState.gameStartTime = null;
    gameState.gameEndTime = null;
    gameState.zoneShrinkStartTime = null;
    
    // Clear any remaining timers
    if (gameState.zoneTimer) {
      clearTimeout(gameState.zoneTimer);
      gameState.zoneTimer = null;
    }
    if (shrinkTimer) {
      clearInterval(shrinkTimer);
      shrinkTimer = null;
    }
    
    console.log('Game reset complete - all state cleared');
    io.emit('game-stopped');
  });

  socket.on('admin-update-zone', (data) => {
    if (data.radius) {
      gameState.zoneRadius = data.radius;
    }
    if (data.shrinkRate) {
      gameState.shrinkRate = data.shrinkRate;
    }
    if (data.shrinkInterval) {
      gameState.shrinkInterval = data.shrinkInterval;
      // Restart timer with new interval if game is active
      if (gameState.gameStarted) {
        startZoneShrinking();
      }
    }
    if (gameState.gameStarted && gameState.zoneCenter) {
      io.emit('zone-update', getZoneInfo());
    }
  });

  socket.on('admin-update-zone-settings', (data) => {
    if (data.shrinkRate) {
      gameState.shrinkRate = data.shrinkRate;
    }
    if (data.shrinkInterval) {
      gameState.shrinkInterval = data.shrinkInterval;
      // Restart timer with new interval if game is active
      if (gameState.gameStarted) {
        startZoneShrinking();
      }
    }
    
    // Notify all clients about the settings update
    io.emit('zone-settings-updated', {
      shrinkRate: gameState.shrinkRate,
      shrinkInterval: gameState.shrinkInterval,
      phase: gameState.zonePhase
    });
  });

  socket.on('admin-trigger-zone-shrink', () => {
    if (gameState.gameStarted && gameState.zoneCenter) {
      // Clear existing timer
      if (gameState.zoneTimer) {
        clearTimeout(gameState.zoneTimer);
      }
      
      // If no target zone exists, generate one
      if (!gameState.targetZoneCenter) {
        generateNextTargetZone();
      }
      
      // Immediately move to target
      moveZoneToTarget();
      
      console.log('Admin triggered zone shrink');
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
function startGame() {
  if (gameState.gameStarted) return;
  
  gameState.gameStarted = true;
  gameState.gameStartTime = Date.now();
  

  if (!gameState.zoneCenter) {
    // Get hider location to base initial zone on
    const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
    const hiderLocation = hiderPlayer?.location;
    
    if (hiderLocation) {
      // Generate random zone center that puts hider randomly within the zone (not at center)
      // Place hider at random position within the circle
      const hiderDistanceFromCenter = Math.random() * gameState.zoneRadius * 0.8; // Hider up to 80% from center
      const hiderAngleFromCenter = Math.random() * 2 * Math.PI;
      
      // Calculate where the zone center should be to put hider at this random position
      const centerOffsetLat = -(hiderDistanceFromCenter * Math.cos(hiderAngleFromCenter)) / 111320;
      const centerOffsetLng = -(hiderDistanceFromCenter * Math.sin(hiderAngleFromCenter)) / (111320 * Math.cos(hiderLocation.lat * Math.PI / 180));
      
      gameState.zoneCenter = {
        lat: hiderLocation.lat + centerOffsetLat,
        lng: hiderLocation.lng + centerOffsetLng
      };
      
      console.log(`Initial zone: hider positioned ${hiderDistanceFromCenter.toFixed(0)}m from center (${(hiderDistanceFromCenter/gameState.zoneRadius*100).toFixed(1)}% of radius)`);
    }
  }
  console.log('Game started! Zone center:', gameState.zoneCenter);
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
  gameState.targetZoneCenter = null;
  gameState.zoneRadius = gameState.initialRadius;
  gameState.targetZoneRadius = gameState.initialRadius * 0.5;
  gameState.zonePhase = 1;
  
  // Clear all players and disconnected players cache when game stops
  gameState.players.clear();
  gameState.disconnectedPlayers.clear();
  gameState.hider = null;
  
  if (shrinkTimer) {
    clearInterval(shrinkTimer);
    shrinkTimer = null;
  }

  io.emit('game-stopped');
  console.log('Game stopped - all players cleared');
}

// Fortnite-style zone functions
function generateNextTargetZone() {
  const hiderPlayer = gameState.hider ? gameState.players.get(gameState.hider) : null;
  
  if (!hiderPlayer || !hiderPlayer.location || !gameState.zoneCenter) return;
  
  // Calculate next zone size
  const nextRadius = gameState.zoneRadius * gameState.shrinkRate;
  const hiderLoc = hiderPlayer.location;
  
  // Use same approach as initial zone: place hider randomly within the new zone
  const hiderDistanceFromNewCenter = Math.random() * nextRadius * 0.8; // Hider up to 80% from new center
  const hiderAngleFromNewCenter = Math.random() * 2 * Math.PI;
  
  // Calculate where the new zone center should be to put hider at this random position
  const centerOffsetLat = -(hiderDistanceFromNewCenter * Math.cos(hiderAngleFromNewCenter)) / 111320;
  const centerOffsetLng = -(hiderDistanceFromNewCenter * Math.sin(hiderAngleFromNewCenter)) / (111320 * Math.cos(hiderLoc.lat * Math.PI / 180));
  
  const newCenter = {
    lat: hiderLoc.lat + centerOffsetLat,
    lng: hiderLoc.lng + centerOffsetLng
  };
  
  // Make sure the new zone center is within reasonable bounds of the current zone
  const distanceFromCurrentCenter = calculateDistance(newCenter, gameState.zoneCenter);
  const maxAllowedDistance = gameState.zoneRadius - nextRadius;
  
  if (distanceFromCurrentCenter > maxAllowedDistance) {
    // If the random position would put the zone too far, constrain it
    const constrainAngle = Math.atan2(newCenter.lng - gameState.zoneCenter.lng, newCenter.lat - gameState.zoneCenter.lat);
    const constrainedLat = gameState.zoneCenter.lat + (maxAllowedDistance / 111320) * Math.cos(constrainAngle);
    const constrainedLng = gameState.zoneCenter.lng + (maxAllowedDistance / (111320 * Math.cos(gameState.zoneCenter.lat * Math.PI / 180))) * Math.sin(constrainAngle);
    
    gameState.targetZoneCenter = { lat: constrainedLat, lng: constrainedLng };
  } else {
    gameState.targetZoneCenter = newCenter;
  }
  
  gameState.targetZoneRadius = nextRadius;
  
  console.log(`Next zone: hider will be ${hiderDistanceFromNewCenter.toFixed(0)}m from center (${(hiderDistanceFromNewCenter/nextRadius*100).toFixed(1)}% of radius)`);
}

function moveZoneToTarget() {
  if (!gameState.targetZoneCenter) return;
  
  // Move current zone to target zone position and size
  gameState.zoneCenter = { ...gameState.targetZoneCenter };
  gameState.zoneRadius = gameState.targetZoneRadius;
  gameState.zonePhase++;
  
  // Generate next target zone for the following phase
  generateNextTargetZone();
}

function startZoneShrinking() {
  if (shrinkTimer) clearInterval(shrinkTimer);
  
  // Generate first target zone
  generateNextTargetZone();
  
  // Send initial zone info with target
  io.emit('zone-update', getZoneInfo());
  
  // Start countdown timer that updates every second
  const countdownTimer = setInterval(() => {
    if (!gameState.gameStarted) {
      clearInterval(countdownTimer);
      return;
    }
    
    const nextShrinkTime = gameState.zoneShrinkStartTime + gameState.shrinkInterval;
    const remaining = Math.max(0, nextShrinkTime - Date.now());
    
    io.emit('zone-countdown-update', {
      remaining: remaining,
      total: gameState.shrinkInterval,
      radius: gameState.zoneRadius
    });
    
    if (remaining === 0) {
      clearInterval(countdownTimer);
    }
  }, 1000);
  
  gameState.zoneShrinkStartTime = Date.now();
  
  shrinkTimer = setInterval(() => {
    // Move current zone toward target zone and shrink
    moveZoneToTarget();
    
    // Check win conditions
    checkWinConditions();
    
    // Broadcast zone update
    io.emit('zone-update', getZoneInfo());
    
    // Restart countdown for next shrink
    gameState.zoneShrinkStartTime = Date.now();
    
    console.log(`Zone Phase ${gameState.zonePhase}: radius ${Math.round(gameState.zoneRadius)}m, center: ${gameState.zoneCenter.lat.toFixed(6)}, ${gameState.zoneCenter.lng.toFixed(6)}`);
    
    // Stop shrinking if zone gets too small
    if (gameState.zoneRadius < 25) {
      clearInterval(countdownTimer);
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
    .filter(p => p && p.role === 'seeker')
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
  
  return {
    center: gameState.zoneCenter,
    radius: gameState.zoneRadius,
    targetCenter: gameState.targetZoneCenter,
    targetRadius: gameState.targetZoneRadius,
    phase: gameState.zonePhase,
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