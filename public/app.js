// Enhanced game state with connection management
let socket;
let map;
let playerMarker;
let playerMarkers = new Map();
let zoneCircle;
let targetZoneCircle;
let selectedRole = null;
let playerName = '';
let playerId = null;
let currentLocation = null;
let gameStartTime = null;
let zoneTimer = null;
let gameTimer = null;
let isAdmin = false;
let dummyPlayers = [];
let dummyPlayerCounter = 1;
let locationWatchId = null;

// Connection management
let connectionManager = {
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    heartbeatInterval: null,
    lastHeartbeat: Date.now(),
    backgroundMode: false
};

// Game timers
let gameTimers = {
    locationUpdate: null,
    heartbeat: null,
    reconnect: null,
    gameTimer: null
};

// Enhanced player data object
let playerData = {
    name: '',
    role: null,
    id: null,
    location: null,
    lastUpdate: Date.now(),
    sessionId: generateSessionId()
};

function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// localStorage functions
function savePlayerData() {
    try {
        if (playerName) {
            localStorage.setItem('seekThem_playerName', playerName);
        }
        if (selectedRole) {
            localStorage.setItem('seekThem_selectedRole', selectedRole);
        }
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }
}

// Enhanced localStorage functions with full state management
function savePlayerData() {
    try {
        const gameState = {
            name: playerData.name || playerName,
            role: playerData.role || selectedRole,
            id: playerData.id || playerId,
            location: playerData.location || currentLocation,
            sessionId: playerData.sessionId,
            timestamp: Date.now(),
            gameStartTime: gameStartTime,
            isInGame: !!selectedRole
        };
        
        localStorage.setItem('seekThem_gameState', JSON.stringify(gameState));
        localStorage.setItem('seekThem_lastActive', Date.now().toString());
        
        // Also save individual items for backward compatibility
        if (gameState.name) {
            localStorage.setItem('seekThem_playerName', gameState.name);
        }
        if (gameState.role) {
            localStorage.setItem('seekThem_selectedRole', gameState.role);
        }
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }
}

function loadPlayerData() {
    try {
        // Try to load complete game state first
        const savedState = localStorage.getItem('seekThem_gameState');
        if (savedState) {
            const gameState = JSON.parse(savedState);
            const lastActive = parseInt(localStorage.getItem('seekThem_lastActive') || '0');
            
            // Only use saved data if it's recent (within 2 hours)
            if (Date.now() - lastActive < 7200000) {
                playerData.name = gameState.name || '';
                playerData.role = gameState.role;
                playerData.id = gameState.id;
                playerData.location = gameState.location;
                playerData.sessionId = gameState.sessionId || generateSessionId();
                
                // Set global variables for compatibility
                playerName = playerData.name;
                selectedRole = playerData.role;
                playerId = playerData.id;
                currentLocation = playerData.location;
                gameStartTime = gameState.gameStartTime;
                
                return true;
            }
        }
        
        // Fallback to individual items
        const name = localStorage.getItem('seekThem_playerName');
        const role = localStorage.getItem('seekThem_selectedRole');
        
        if (name) {
            playerData.name = name;
            playerName = name;
            
            // Pre-fill name input if available
            const nameInput = document.getElementById('player-name');
            if (nameInput) {
                nameInput.value = name;
            }
        }
        
        if (role) {
            playerData.role = role;
            selectedRole = role;
        }
        
        return !!(name && role);
    } catch (e) {
        console.warn('Could not load from localStorage:', e);
        return false;
    }
}

// Initialize enhanced connection management
function initializeConnection() {
    if (socket && socket.connected) {
        return; // Already connected
    }
    
    socket = io({
        transports: ['websocket', 'polling'],
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        reconnection: true,
        reconnectionDelay: connectionManager.reconnectDelay,
        reconnectionAttempts: connectionManager.maxReconnectAttempts,
        reconnectionDelayMax: 5000,
        maxReconnectionAttempts: connectionManager.maxReconnectAttempts,
        forceNew: false
    });
    
    setupSocketEventListeners();
    startConnectionMonitoring();
}

// Setup all socket event listeners
function setupSocketEventListeners() {
    // Connection events
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectionError);
    socket.on('reconnect', handleReconnect);
    socket.on('reconnect_error', handleReconnectError);
    
    // Heartbeat
    socket.on('pong', () => {
        connectionManager.lastHeartbeat = Date.now();
    });
    
    // Game events
    socket.on('join-accepted', (data) => {
        playerId = data.playerId;
        selectedRole = data.role;
        updateGameState(data.gameState);
        showScreen('game-screen');
        initializeMap();
        startLocationTracking();
        showToast(`Joined as ${selectedRole}`, 'success');
    });
    
    socket.on('join-rejected', (data) => {
        showToast(data.reason, 'error');
        resetRoleSelection();
        showScreen('role-selection');
    });
    
    socket.on('player-joined', (data) => {
        if (data.reconnected) {
            showGameMessage(`${data.name} reconnected as ${data.role}`, 'success');
        } else {
            showGameMessage(`${data.name} joined as ${data.role}`, 'success');
        }
        updatePlayerCount(data.playerCount);
    });
    
    socket.on('player-left', (data) => {
        if (data.disconnected) {
            showGameMessage(`${data.name} (${data.role}) disconnected - can reconnect with same name`, 'warning');
        } else {
            showGameMessage(`${data.name} (${data.role}) left the game`, 'warning');
        }
        updatePlayerCount(data.playerCount);
    });
    
    socket.on('player-location-update', (data) => {
        updatePlayerMarker(data);
    });
    
    socket.on('game-started', (data) => {
        updateGameState(data.gameState);
        updateZone(data.zone);
        startGameTimer();
        showToast('Game started! Zone is shrinking!', 'success');
    });
    
    socket.on('zone-update', (data) => {
        updateZone(data);
    });
    
    socket.on('zone-settings-updated', (data) => {
        if (document.getElementById('zone-phase-display')) {
            document.getElementById('zone-phase-display').textContent = `Zone Phase: ${data.phase}`;
        }
        showToast(`Zone settings: ${Math.round(data.shrinkRate * 100)}% shrink every ${data.shrinkInterval / 60000}min`, 'info');
    });
    
    socket.on('zone-countdown-update', (data) => {
        updateZoneCountdown(data.remaining, data.total, data.radius);
    });
    
    socket.on('game-ended', (data) => {
        stopTimers();
        showGameEnd(data);
    });
    
    socket.on('game-stopped', () => {
        showToast('Game stopped', 'info');
        resetGame();
    });

    // Admin events
    socket.on('admin-game-state', (data) => {
        updateAdminPanel(data);
    });

    socket.on('dummy-player-added', (data) => {
        showToast(`Dummy ${data.role} added: ${data.name}`, 'success');
        updateDummyList();
    });

    socket.on('dummy-players-removed', () => {
        showToast('All dummy players removed', 'info');
        dummyPlayers = [];
        updateDummyList();
    });
}

// Connection event handlers
function handleConnect() {
    console.log('Connected to server');
    connectionManager.isConnected = true;
    connectionManager.reconnectAttempts = 0;
    connectionManager.reconnectDelay = 1000;
    
    updateConnectionStatus('Connected', 'success');
    
    // Only show role selection if not already in game
    if (!playerId && (!playerData.name || !playerData.role)) {
        showScreen('role-selection');
    }
    
    // Try to restore session if we have saved data
    if (playerData.name && playerData.role) {
        console.log('Attempting to restore session for:', playerData.name);
        setTimeout(() => {
            attemptGameRejoin();
        }, 500);
    }
}

function handleReconnect() {
    console.log('Reconnected to server');
    connectionManager.isConnected = true;
    connectionManager.reconnectAttempts = 0;
    updateConnectionStatus('Reconnected!', 'success');
}

function handleReconnectError(error) {
    console.log('Reconnection failed:', error);
    connectionManager.reconnectAttempts++;
    if (connectionManager.reconnectAttempts >= connectionManager.maxReconnectAttempts) {
        updateConnectionStatus('Connection Failed - Please Refresh', 'error');
    }
}

function handleDisconnect(reason) {
    console.log('Disconnected from server:', reason);
    connectionManager.isConnected = false;
    
    updateConnectionStatus('Disconnected', 'error');
    
    // Save current state
    savePlayerData();
    
    // Don't auto-reconnect if server disconnected us intentionally
    if (reason !== 'io server disconnect') {
        scheduleReconnect();
    }
}

function handleConnectionError(error) {
    console.log('Connection error:', error);
    connectionManager.isConnected = false;
    updateConnectionStatus('Connection Error', 'error');
    scheduleReconnect();
}

function handleReconnect(attemptNumber) {
    console.log('Reconnected after', attemptNumber, 'attempts');
    updateConnectionStatus('Reconnected!', 'success');
}

function handleReconnectError(error) {
    console.log('Reconnection failed:', error);
    connectionManager.reconnectAttempts++;
    
    if (connectionManager.reconnectAttempts >= connectionManager.maxReconnectAttempts) {
        updateConnectionStatus('Connection Failed - Please Refresh', 'error');
    }
}

// Attempt to rejoin game after reconnection
function attemptGameRejoin() {
    if (!socket || !socket.connected || !playerData.name || !playerData.role) {
        return;
    }
    
    console.log('Attempting to rejoin game as:', playerData.name, playerData.role);
    
    socket.emit('join-game', {
        name: playerData.name,
        role: playerData.role,
        reconnecting: true,
        sessionId: playerData.sessionId,
        lastLocation: playerData.location
    });
}

// Missing connection status function
function updateConnectionStatus(message, type) {
    console.log(`Connection status: ${message} (${type})`);
    // Show toast for important connection events
    if (type === 'error') {
        showToast(message, 'error');
    } else if (type === 'success' && message.includes('Reconnected')) {
        showToast(message, 'success');
    }
}

// Event listeners
function setupEventListeners() {
    // Name input
    const nameInput = document.getElementById('player-name');
    nameInput.addEventListener('input', (e) => {
        playerName = e.target.value.trim();
        updateJoinButton();
        if (playerName) savePlayerData();
    });
    
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && document.getElementById('join-btn').disabled === false) {
            joinGame();
        }
    });

    // Role selection cards
    document.querySelectorAll('.role-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const role = card.classList.contains('hider') ? 'hider' : 'seeker';
            selectRole(role);
        });
    });

    // Join button
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            joinGame();
        });
    }
}

// Location handling
function requestLocationPermission() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported', 'error');
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            updateLocationStatus('Location access granted');
        },
        (error) => {
            handleLocationError(error);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function startLocationTracking() {
    if (!navigator.geolocation) return;
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
    };
    
    navigator.geolocation.watchPosition(
        (position) => {
            const newLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy
            };
            
            currentLocation = newLocation;
            
            // Update server with location
            socket.emit('location-update', newLocation);
            
            // Update own marker on map
            updateOwnMarker(newLocation);
            
            // Update location status
            updateLocationStatus(`Accuracy: ±${Math.round(position.coords.accuracy)}m`);
        },
        (error) => {
            handleLocationError(error);
        },
        options
    );
}

function handleLocationError(error) {
    let message = 'Location error: ';
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message += 'Permission denied. Please enable location access.';
            break;
        case error.POSITION_UNAVAILABLE:
            message += 'Position unavailable.';
            break;
        case error.TIMEOUT:
            message += 'Request timeout.';
            break;
        default:
            message += 'Unknown error.';
            break;
    }
    updateLocationStatus(message);
    showToast(message, 'error');
}

// Map functions
function initializeMap() {
    if (map) {
        map.remove();
    }
    
    // Center on Ireland initially
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([53.1424, -7.6921], 7); // Ireland coordinates
    
    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
    }).addTo(map);
    
    // Add zoom control to top right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
    
    // Center on user location when available
    if (currentLocation) {
        map.setView([currentLocation.lat, currentLocation.lng], 16);
    }
}

function updateOwnMarker(location) {
    if (!map) return;
    
    // Center map on user location
    map.setView([location.lat, location.lng], map.getZoom());
    
    // Create or update player marker
    if (playerMarker) {
        playerMarker.setLatLng([location.lat, location.lng]);
    } else {
        const icon = selectedRole === 'hider' ? '🫥' : '🔍';
        playerMarker = L.marker([location.lat, location.lng], {
            icon: L.divIcon({
                html: `<div class="player-marker own-marker">${icon}</div>`,
                className: '',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(map);
        
        playerMarker.bindPopup(`You (${selectedRole})`).openPopup();
    }
}

function updatePlayerMarker(playerData) {
    if (!map || !playerData.location) return;
    
    const { playerId, location, name, role } = playerData;
    
    // Remove existing marker for this player
    if (playerMarkers.has(playerId)) {
        map.removeLayer(playerMarkers.get(playerId));
        playerMarkers.delete(playerId);
    }
    
    // Show seeker locations to everyone
    // Show hider location only to the hider themselves
    const shouldShowMarker = role === 'seeker' || 
                           (role === 'hider' && playerId === playerId);
    
    if (shouldShowMarker) {
        const markerIcon = role === 'hider' ? '🫥' : '🔍';
        const markerClass = role === 'hider' ? 'own-marker' : 'seeker-marker';
        
        const marker = L.marker([location.lat, location.lng], {
            icon: L.divIcon({
                html: `<div class="player-marker ${markerClass}">${markerIcon}</div>`,
                className: '',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(map);
        
        marker.bindPopup(`${name} (${role})`);
        playerMarkers.set(playerId, marker);
    }
}

function removePlayerMarker(playerId) {
    if (playerMarkers.has(playerId)) {
        map.removeLayer(playerMarkers.get(playerId));
        playerMarkers.delete(playerId);
    }
}

function updateZone(zoneData) {
    if (!map || !zoneData) return;
    
    console.log('Updating zone:', zoneData);
    
    // Remove existing zone circles
    if (zoneCircle) {
        map.removeLayer(zoneCircle);
    }
    if (targetZoneCircle) {
        map.removeLayer(targetZoneCircle);
    }
    
    // Add main zone circle (current playable area) - visible to all players
    zoneCircle = L.circle([zoneData.center.lat, zoneData.center.lng], {
        radius: zoneData.radius,
        fillColor: '#ff6b6b',
        fillOpacity: 0.1,
        color: '#ff6b6b',
        weight: 3,
        dashArray: '10, 5'
    }).addTo(map);
    
    // Add target zone circle (next safe zone) - visible to all players
    if (zoneData.targetCenter && zoneData.targetRadius) {
        targetZoneCircle = L.circle([zoneData.targetCenter.lat, zoneData.targetCenter.lng], {
            radius: zoneData.targetRadius,
            fillColor: '#ffffff',
            fillOpacity: 0.15,
            color: '#ffffff',
            weight: 2,
            dashArray: '15, 10'
        }).addTo(map);
    }
    
    // Update zone info display
    updateZoneInfo(zoneData.radius, zoneData.phase);
}

// UI functions
function selectRole(role) {
    selectedRole = role;
    
    // Update UI
    document.querySelectorAll('.role-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    document.querySelector(`.role-card.${role}`).classList.add('selected');
    updateJoinButton();
    savePlayerData();
}

function updateJoinButton() {
    const joinBtn = document.getElementById('join-btn');
    const canJoin = selectedRole && playerName.length >= 2;
    joinBtn.disabled = !canJoin;
}

function joinGame() {
    if (!selectedRole || !playerName) return;
    
    savePlayerData();
    showScreen('loading');
    socket.emit('join-game', { role: selectedRole, name: playerName });
}

// Make functions globally accessible for inline onclick handlers
window.selectRole = selectRole;
window.joinGame = joinGame;
window.startGame = startGame;
window.leaveGame = leaveGame;
window.showRoleSelection = showRoleSelection;
window.foundMe = foundMe;
window.confirmFound = confirmFound;
window.cancelFound = cancelFound;
window.showAdminLogin = showAdminLogin;
window.closeAdminLogin = closeAdminLogin;
window.checkAdminPassword = checkAdminPassword;
window.exitAdmin = exitAdmin;
window.addDummySeeker = addDummySeeker;
window.addDummyHider = addDummyHider;
window.removeDummyPlayers = removeDummyPlayers;
window.adminStartGame = adminStartGame;
window.adminStopGame = adminStopGame;
window.adminResetGame = adminResetGame;
window.updateZoneRadius = updateZoneRadius;
window.updateZoneSettings = updateZoneSettings;
window.triggerZoneShrink = triggerZoneShrink;

function startGame() {
    socket.emit('start-game');
}

function leaveGame() {
    // Clear localStorage
    try {
        localStorage.removeItem('seekThem_playerName');
        localStorage.removeItem('seekThem_selectedRole');
    } catch (e) {
        console.warn('Could not clear localStorage:', e);
    }
    
    // Emit leave event to server
    if (socket && socket.connected) {
        socket.emit('leave-game');
    }
    
    // Force disconnect and reconnect
    if (socket) {
        socket.disconnect();
        setTimeout(() => {
            socket.connect();
        }, 100);
    }
    
    // Reset game state
    resetGame();
}

function resetGame() {
    stopTimers();
    selectedRole = null;
    playerName = '';
    playerId = null;
    currentLocation = null;
    gameStartTime = null;
    
    // Clear map and markers
    if (map) {
        if (playerMarker) {
            map.removeLayer(playerMarker);
            playerMarker = null;
        }
        if (zoneCircle) {
            map.removeLayer(zoneCircle);
            zoneCircle = null;
        }
        if (targetZoneCircle) {
            map.removeLayer(targetZoneCircle);
            targetZoneCircle = null;
        }
        playerMarkers.forEach(marker => map.removeLayer(marker));
        playerMarkers.clear();
        map.remove();
        map = null;
    }
    
    // Reset UI
    resetRoleSelection();
    showScreen('role-selection');
}

function resetRoleSelection() {
    document.querySelectorAll('.role-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.getElementById('player-name').value = '';
    playerName = '';
    selectedRole = null;
    updateJoinButton();
}

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function hideScreen(screenId) {
    document.getElementById(screenId).classList.remove('active');
}

// Game state updates
function updateGameState(gameState) {
    // Update player count
    document.getElementById('player-count').textContent = 
        `👥 ${gameState.playerCount} players online`;
    
    // Update hider status
    const hiderStatus = document.getElementById('hider-status');
    if (hiderStatus) {
        hiderStatus.textContent = gameState.hasHider ? 'Taken' : 'Available';
        hiderStatus.className = 'role-status ' + (gameState.hasHider ? 'taken' : '');
    }
    
    // Update seekers list
    updateSeekersList(gameState.seekers);
    
    // Show start button if player is hider and game hasn't started
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
        startBtn.style.display = 
            (selectedRole === 'hider' && !gameState.gameStarted) ? 'block' : 'none';
    }
    
    // Show found me button if player is hider and game has started
    const foundBtn = document.getElementById('found-me-btn');
    if (foundBtn) {
        foundBtn.style.display = 
            (selectedRole === 'hider' && gameState.gameStarted) ? 'block' : 'none';
    }
    
    // Update role badge
    const roleBadge = document.getElementById('role-badge');
    if (roleBadge && selectedRole) {
        roleBadge.textContent = selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1);
        roleBadge.className = `badge ${selectedRole}`;
    }
}

function updateSeekersList(seekers) {
    const seekersList = document.getElementById('seekers-list');
    if (!seekersList) return;
    
    seekersList.innerHTML = '';
    
    seekers.forEach(seeker => {
        const seekerElement = document.createElement('div');
        seekerElement.className = 'seeker-item';
        seekerElement.innerHTML = `
            <span class="seeker-name">${seeker.name}</span>
            <span class="seeker-status ${seeker.location ? 'online' : 'offline'}">
                ${seeker.location ? '🟢' : '🔴'}
            </span>
        `;
        seekersList.appendChild(seekerElement);
    });
}

function updateLocationStatus(status) {
    const statusElement = document.getElementById('location-status');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

function updateZoneInfo(radius, phase) {
    const radiusElement = document.getElementById('zone-radius');
    if (radiusElement) {
        radiusElement.textContent = `Zone ${phase || 1}: ${Math.round(radius)}m`;
    }
}

// Timer functions
function startGameTimer() {
    gameStartTime = Date.now();
    
    gameTimer = setInterval(() => {
        const elapsed = Date.now() - gameStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        const timeElement = document.getElementById('game-time');
        if (timeElement) {
            timeElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function stopTimers() {
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }
    if (zoneTimer) {
        clearInterval(zoneTimer);
        zoneTimer = null;
    }
}

// Game end handling
function showGameEnd(result) {
    const title = document.getElementById('result-title');
    const details = document.getElementById('result-details');
    
    if (result.winner === 'seekers') {
        title.textContent = 'Seekers Win!';
        if (result.finder) {
            details.innerHTML = `
                <p>🎉 ${result.finder} found the hider!</p>
                <p>Distance: ${result.distance}m</p>
            `;
        } else {
            details.innerHTML = `<p>${result.reason}</p>`;
        }
    } else if (result.winner === 'hider') {
        title.textContent = 'Hider Wins!';
        details.innerHTML = `<p>🎯 ${result.reason}</p>`;
    }
    
    showScreen('game-end');
}

function showRoleSelection() {
    resetGame();
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Zone countdown update
function updateZoneCountdown(remaining, total, radius) {
    const zoneTimer = document.getElementById('zone-timer');
    if (zoneTimer && remaining !== undefined) {
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        zoneTimer.textContent = `Shrinking in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    if (radius !== undefined) {
        const zoneRadius = document.getElementById('zone-radius');
        if (zoneRadius) {
            zoneRadius.textContent = `Zone: ${Math.round(radius)}m`;
        }
    }
}

// Player count update
function updatePlayerCount(count) {
    const playerCountElement = document.getElementById('player-count');
    if (playerCountElement) {
        playerCountElement.textContent = `👥 ${count} players online`;
    }
}

// Game messages
function showGameMessage(message, type = 'info') {
    const messagesContainer = document.getElementById('game-messages');
    if (!messagesContainer) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = `game-message ${type}`;
    messageElement.textContent = message;
    
    messagesContainer.appendChild(messageElement);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }, 5000);
}

// Utility functions
// Found Me button functions
function foundMe() {
    document.getElementById('confirmation-modal').style.display = 'flex';
}

function confirmFound() {
    socket.emit('hider-found');
    document.getElementById('confirmation-modal').style.display = 'none';
}

function cancelFound() {
    document.getElementById('confirmation-modal').style.display = 'none';
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

// Admin Functions
function showAdminLogin() {
    document.getElementById('admin-login-modal').style.display = 'flex';
    document.getElementById('admin-password').focus();
}

function closeAdminLogin() {
    document.getElementById('admin-login-modal').style.display = 'none';
    document.getElementById('admin-password').value = '';
}

function checkAdminPassword() {
    const password = document.getElementById('admin-password').value;
    if (password === 'seek') {
        isAdmin = true;
        closeAdminLogin();
        showScreen('admin-panel');
        socket.emit('request-admin-data');
        showToast('Admin access granted', 'success');
    } else {
        showToast('Invalid password', 'error');
        document.getElementById('admin-password').value = '';
    }
}

function exitAdmin() {
    isAdmin = false;
    showScreen('role-selection');
}

function updateAdminPanel(data) {
    document.getElementById('admin-player-count').textContent = `Players: ${data.playerCount}`;
    document.getElementById('admin-game-status').textContent = `Status: ${data.gameStarted ? 'Active' : 'Waiting'}`;
    document.getElementById('admin-hider-status').textContent = `Hider: ${data.hasHider ? 'Present' : 'None'}`;
    
    if (data.zoneSettings) {
        document.getElementById('shrink-rate-input').value = data.zoneSettings.shrinkRate;
        document.getElementById('shrink-interval-input').value = Math.round(data.zoneSettings.shrinkInterval / 60000); // Convert to minutes
        document.getElementById('zone-radius-input').value = Math.round(data.zoneSettings.currentRadius);
        document.getElementById('admin-zone-phase').textContent = `Phase: ${data.zoneSettings.phase}`;
    }
}

function addDummySeeker() {
    const dummyName = `DummySeeker${dummyPlayerCounter++}`;
    // Generate random location around Dublin, Ireland
    const lat = 53.3498 + (Math.random() - 0.5) * 0.02;
    const lng = -6.2603 + (Math.random() - 0.5) * 0.02;
    
    const dummy = {
        name: dummyName,
        role: 'seeker',
        location: { lat, lng }
    };
    
    dummyPlayers.push(dummy);
    socket.emit('add-dummy-player', dummy);
}

function addDummyHider() {
    const dummyName = `DummyHider${dummyPlayerCounter++}`;
    // Generate random location around Dublin, Ireland
    const lat = 53.3498 + (Math.random() - 0.5) * 0.02;
    const lng = -6.2603 + (Math.random() - 0.5) * 0.02;
    
    const dummy = {
        name: dummyName,
        role: 'hider',
        location: { lat, lng }
    };
    
    dummyPlayers.push(dummy);
    socket.emit('add-dummy-player', dummy);
}

function removeDummyPlayers() {
    socket.emit('remove-dummy-players');
    dummyPlayers = [];
    updateDummyList();
}

function updateDummyList() {
    const list = document.getElementById('dummy-list');
    list.innerHTML = '';
    
    dummyPlayers.forEach((dummy, index) => {
        const item = document.createElement('div');
        item.className = 'dummy-item';
        item.innerHTML = `
            <span>${dummy.name} (${dummy.role})</span>
            <button class="btn small danger" onclick="removeDummyPlayer(${index})">Remove</button>
        `;
        list.appendChild(item);
    });
}

function removeDummyPlayer(index) {
    const dummy = dummyPlayers[index];
    socket.emit('remove-dummy-player', dummy.name);
    dummyPlayers.splice(index, 1);
    updateDummyList();
}

function adminStartGame() {
    socket.emit('admin-start-game');
}

function adminStopGame() {
    socket.emit('admin-stop-game');
}

function adminResetGame() {
    socket.emit('admin-reset-game');
}

function updateZoneRadius() {
    const newRadius = parseInt(document.getElementById('zone-radius-input').value);
    if (newRadius >= 50 && newRadius <= 5000) {
        socket.emit('admin-update-zone', { radius: newRadius });
        showToast(`Zone radius updated to ${newRadius}m`, 'success');
    } else {
        showToast('Radius must be between 50-5000m', 'error');
    }
}

function updateShrinkRateDisplay() {
    const rate = document.getElementById('shrink-rate-slider').value;
    document.getElementById('shrink-rate-display').textContent = `${rate}%`;
}

function updateZoneSettings() {
    const shrinkRate = parseFloat(document.getElementById('shrink-rate-slider').value) / 100;
    const shrinkInterval = parseInt(document.getElementById('shrink-interval-input').value);
    
    if (shrinkRate >= 0.1 && shrinkRate <= 0.9 && shrinkInterval >= 1 && shrinkInterval <= 60) {
        socket.emit('admin-update-zone-settings', { 
            shrinkRate: shrinkRate,
            shrinkInterval: shrinkInterval * 60000 // Convert to milliseconds
        });
        showToast(`Zone settings updated: ${Math.round(shrinkRate * 100)}% shrink every ${shrinkInterval} minutes`, 'success');
    } else {
        showToast('Invalid settings: rate 10-90%, interval 1-60 minutes', 'error');
    }
}

function triggerZoneShrink() {
    socket.emit('admin-trigger-zone-shrink');
    showToast('Zone shrink triggered!', 'success');
}

function updateShrinkRate() {
    const newRate = parseFloat(document.getElementById('shrink-rate-input').value);
    if (newRate >= 0.1 && newRate <= 0.9) {
        socket.emit('admin-update-zone', { shrinkRate: newRate });
        showToast(`Shrink rate updated to ${Math.round((1-newRate)*100)}% reduction`, 'success');
    } else {
        showToast('Shrink rate must be between 0.1-0.9', 'error');
    }
}

function updateShrinkInterval() {
    const newInterval = parseInt(document.getElementById('shrink-interval-input').value) * 60000; // Convert minutes to ms
    if (newInterval >= 60000 && newInterval <= 3600000) { // 1-60 minutes
        socket.emit('admin-update-zone', { shrinkInterval: newInterval });
        showToast(`Shrink interval updated to ${Math.round(newInterval/60000)} minutes`, 'success');
    } else {
        showToast('Interval must be between 1-60 minutes', 'error');
    }
}

// Handle admin password input enter key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('admin-login-modal').style.display === 'flex') {
        checkAdminPassword();
    }
});

// Enhanced initialization with background support
function init() {
    console.log('Initializing SeekThem with enhanced features...');
    
    // Load any saved player data
    const hasRestorableSession = loadPlayerData();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup background handling
    setupBackgroundHandling();
    
    // Initialize connection
    initializeConnection();
    
    // Setup service worker if available
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }
    
    // If we have a restorable session, show appropriate screen
    if (hasRestorableSession && playerData.name) {
        // Pre-fill the name input
        const nameInput = document.getElementById('player-name');
        if (nameInput) {
            nameInput.value = playerData.name;
        }
        
        // Select the role if available
        if (playerData.role) {
            setTimeout(() => {
                selectRole(playerData.role);
            }, 100);
        }
    }
    
    console.log('SeekThem initialization complete');
}

// Enhanced DOM ready with error handling
document.addEventListener('DOMContentLoaded', () => {
    try {
        init();
    } catch (error) {
        console.error('Initialization failed:', error);
        showToast('Failed to initialize app. Please refresh.', 'error');
    }
});

// Handle page load completion
window.addEventListener('load', () => {
    // Ensure connection is established
    if (!socket || !socket.connected) {
        setTimeout(() => {
            if (!socket || !socket.connected) {
                initializeConnection();
            }
        }, 1000);
    }
});

// Handle errors globally
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    savePlayerData(); // Save state on error
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    savePlayerData(); // Save state on error
});