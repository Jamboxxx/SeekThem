# Hiderr - Real-Time Hide and Seek

A real-time multiplayer hide and seek game with GPS location tracking and dynamic shrinking zones. Perfect for outdoor games with friends!

## How It Works

- **One Hider**: Stays hidden and tries to avoid detection
- **Multiple Seekers**: Work together to find the hider
- **Shrinking Zone**: A circular boundary that gradually shrinks toward the hider
- **Real-Time Tracking**: All seekers can see each other on the map (but not the hider)
- **Mobile-First**: Optimized for phones with location permissions

## Quick Start

### Option 1: Docker Compose (Recommended)
```bash
git clone https://github.com/Jamboxxx/Hiderr.git
cd Hiderr
docker-compose up -d
```

### Option 2: Quick Deploy Script
```bash
./deploy.sh
```

### Option 3: Manual Docker Build
```bash
docker build -t seek-them .
docker run -p 3000:3000 seek-them
```


## How to Play

1. **Setup**:
   - All players open the website on their phones
   - Grant location permissions when prompted

2. **Role Selection**:
   - One player selects "Hider" role
   - All other players select "Seeker" role
   - Enter your name and join the game

3. **Game Start**:
   - Hider clicks "Start Game" when everyone is ready
   - Zone begins shrinking at a customizable rate
   - Seekers try to find the hider before the zone collapses

4. **Winning Conditions**:
   - **Seekers Win**: Hider clicks "Found Me" button
   - **Hider Wins**: Survive until the zone becomes too small

## Admin Tools

Access admin tools from the homepage with password: **`seek`**

### Admin Features:
- **Game Status**: View current player count, game state, and hider status
- **Dummy Players**: Add test seekers and hiders with random Dublin locations
- **Game Controls**: Force start/stop games and reset game state
- **Zone Controls**: Dynamically adjust zone radius and rate of closing

### Testing with Dummy Players:
1. Click " Admin" on homepage
2. Enter password: `seek`
3. Use "Add Dummy Seeker/Hider" to populate the map
4. Test game mechanics without real players

### Edit Zone Settings:
1. Click " Admin" on homepage
2. Enter password: `seek`
3. Edit the "Zone Radius, Shrink Rate or Shrink Interval minutes" to your liking
4. Play!

## Game Features

### Real-Time Location Tracking
- Uses GPS for accurate positioning
- Updates every few seconds
- Shows accuracy radius

### Dynamic Zone Mechanics
- Zone shrinks toward hider (but not centered on them)
- Inner circle shows hider's approximate safe area
- Visual indicators for zone boundaries

### Mobile-Optimized Interface
- Touch-friendly controls
- Responsive design for all screen sizes
- Works in landscape and portrait modes

### Game State Management
- Real-time player connections
- Automatic game state synchronization
- Connection handling and reconnection

## Technical Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js, Express.js, Socket.IO
- **Mapping**: Leaflet.js with OpenStreetMap tiles
- **Real-Time**: WebSocket connections via Socket.IO
- **Location**: HTML5 Geolocation API
- **Deployment**: Docker & Docker Compose


## Network Setup

### Local Network Play
1. Ensure all devices are on the same WiFi network
2. Find your server's IP address:
3. Share `http://YOUR_IP:3000` with players

### Port Forwarding (External Access)
If you want players to connect from outside your network:
1. Forward port 3000 in your router settings or with a port forwarder
2. Share your public IP address
3. Ensure your firewall allows the connection

## Security Features

- Non-root Docker container
- Input validation and sanitization
- Rate limiting on location updates
- CORS protection
- No data persistence (privacy-focused)

## Customization

### Styling
Feel free to modify `public/style.css` for custom themes

## Troubleshooting

### Location Issues
- **"Location access denied"**: Check browser permissions
- **Inaccurate GPS**: Move to an area with better signal
- **Indoor play**: GPS accuracy may be reduced

### Connection Problems
- **Can't connect**: Verify IP address and port
- **Frequent disconnects**: Check WiFi signal strength
- **Game not starting**: Ensure hider has location enabled

### Performance
- **Lag on map**: Reduce number of connected players
- **Battery drain**: Location tracking drains alot of battery
- **Slow updates**: Check network connection

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on mobile devices
5. Submit a pull request

## Credits

Built with love for my friends and gaming enthusiasts!

- Maps powered by OpenStreetMap
- Real-time magic by Socket.IO
- Jetlag The Game: for making me want to play games like this

---
