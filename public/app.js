// Game state
let socket;
let map;
let playerMarker;
let playerMarkers = new Map();
let zoneCircle;
let innerCircle;
let selectedRole = null;
let playerName = '';
let playerId = null;
let currentLocation = null;
let gameStartTime = null;
let zoneTimer = null;
let gameTimer = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    setupEventListeners();
    requestLocationPermission();
});

// Socket.IO initialization
function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
        hideScreen('loading');
        showScreen('role-selection');
    });
    
    socket.on('disconnect', () => {
        showToast('Disconnected from server', 'error');
        showScreen('loading');
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
    });
    
    socket.on('player-joined', (data) => {
        updateGameState(data.gameState);
        showToast(`${data.player.name} joined as ${data.player.role}`, 'info');
    });
    
    socket.on('player-left', (data) => {
        updateGameState(data.gameState);
        removePlayerMarker(data.playerId);
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
    
    socket.on('game-ended', (data) => {
        stopTimers();
        showGameEnd(data);
    });
    
    socket.on('game-stopped', () => {
        showToast('Game stopped', 'info');
        resetGame();
    });
}

// Event listeners
function setupEventListeners() {
    // Name input
    const nameInput = document.getElementById('player-name');
    nameInput.addEventListener('input', (e) => {
        playerName = e.target.value.trim();
        updateJoinButton();
    });
    
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && document.getElementById('join-btn').disabled === false) {
            joinGame();
        }
    });
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
            updateLocationStatus(`📍 Accuracy: ±${Math.round(position.coords.accuracy)}m`);
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
    
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([0, 0], 15);
    
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
    
    const { playerId, location, name } = playerData;
    
    if (playerMarkers.has(playerId)) {
        // Update existing marker
        playerMarkers.get(playerId).setLatLng([location.lat, location.lng]);
    } else {
        // Create new marker for seeker
        const marker = L.marker([location.lat, location.lng], {
            icon: L.divIcon({
                html: `<div class="player-marker seeker-marker">🔍</div>`,
                className: '',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(map);
        
        marker.bindPopup(name);
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
    
    // Remove existing zone circles
    if (zoneCircle) {
        map.removeLayer(zoneCircle);
    }
    if (innerCircle) {
        map.removeLayer(innerCircle);
    }
    
    // Add main zone circle
    zoneCircle = L.circle([zoneData.center.lat, zoneData.center.lng], {
        radius: zoneData.radius,
        fillColor: '#ff6b6b',
        fillOpacity: 0.1,
        color: '#ff6b6b',
        weight: 3,
        dashArray: '10, 5'
    }).addTo(map);
    
    // Add inner circle if available (shows hider's safe area)
    if (zoneData.innerCircle) {
        innerCircle = L.circle([zoneData.innerCircle.center.lat, zoneData.innerCircle.center.lng], {
            radius: zoneData.innerCircle.radius,
            fillColor: '#4CAF50',
            fillOpacity: 0.2,
            color: '#4CAF50',
            weight: 2
        }).addTo(map);
    }
    
    // Update zone info display
    updateZoneInfo(zoneData.radius);
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
}

function updateJoinButton() {
    const joinBtn = document.getElementById('join-btn');
    const canJoin = selectedRole && playerName.length >= 2;
    joinBtn.disabled = !canJoin;
}

function joinGame() {
    if (!selectedRole || !playerName) return;
    
    showScreen('loading');
    socket.emit('join-game', { role: selectedRole, name: playerName });
}

function startGame() {
    socket.emit('start-game');
}

function leaveGame() {
    socket.disconnect();
    socket.connect();
    resetGame();
}

function resetGame() {
    stopTimers();
    selectedRole = null;
    playerName = '';
    playerId = null;
    currentLocation = null;
    gameStartTime = null;
    
    // Clear map
    if (map) {
        map.remove();
        map = null;
    }
    
    // Clear markers
    playerMarkers.clear();
    playerMarker = null;
    zoneCircle = null;
    innerCircle = null;
    
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

function updateZoneInfo(radius) {
    const radiusElement = document.getElementById('zone-radius');
    if (radiusElement) {
        radiusElement.textContent = `Zone: ${Math.round(radius)}m`;
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

// Utility functions
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