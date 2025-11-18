# 🕵️ SeekThem - Real-Time Hide and Seek

A real-time multiplayer hide and seek game with GPS location tracking and dynamic shrinking zones. Perfect for outdoor games with friends!

## 🎮 How It Works

- **One Hider**: Stays hidden and tries to avoid detection
- **Multiple Seekers**: Work together to find the hider
- **Shrinking Zone**: A circular boundary that gradually shrinks toward the hider
- **Real-Time Tracking**: All seekers can see each other on the map (but not the hider)
- **Mobile-First**: Optimized for phones with location permissions

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)
```bash
git clone https://github.com/Jamboxxx/SeekThem.git
cd SeekThem
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

### Option 4: Development Mode
```bash
npm install
npm start
```

## 📱 How to Play

1. **Setup**:
   - Host starts the server and shares the local IP
   - All players open the website on their phones
   - Grant location permissions when prompted

2. **Role Selection**:
   - One player selects "Hider" role
   - All other players select "Seeker" role
   - Enter your name and join the game

3. **Game Start**:
   - Hider clicks "Start Game" when everyone is ready
   - Zone begins shrinking every 30 seconds
   - Seekers try to find the hider before the zone collapses

4. **Winning Conditions**:
   - **Seekers Win**: Get within 20 meters of the hider
   - **Hider Wins**: Survive until the zone becomes too small
   - **Seekers Win**: Hider leaves the safe zone

## 🎯 Game Features

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

## 🛠 Technical Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js, Express.js, Socket.IO
- **Mapping**: Leaflet.js with OpenStreetMap tiles
- **Real-Time**: WebSocket connections via Socket.IO
- **Location**: HTML5 Geolocation API
- **Deployment**: Docker & Docker Compose

## 🔧 Configuration

### Environment Variables
```bash
PORT=3000                    # Server port (default: 3000)
NODE_ENV=production         # Environment mode
```

### Game Settings (server.js)
```javascript
zoneRadius: 1000,           // Initial zone size (meters)
shrinkRate: 0.98,           // Zone shrink rate (2% per interval)
shrinkInterval: 30000,      // Shrink every 30 seconds
```

## 📡 Network Setup

### Local Network Play
1. Ensure all devices are on the same WiFi network
2. Find your server's IP address:
   ```bash
   # Linux/Mac
   hostname -I
   
   # Windows
   ipconfig
   ```
3. Share `http://YOUR_IP:3000` with players

### Port Forwarding (External Access)
If you want players to connect from outside your network:
1. Forward port 3000 in your router settings
2. Share your public IP address
3. Ensure your firewall allows the connection

## 🔒 Security Features

- Non-root Docker container
- Input validation and sanitization
- Rate limiting on location updates
- CORS protection
- No data persistence (privacy-focused)

## 🎨 Customization

### Changing Zone Behavior
Edit `server.js` line ~150 to modify zone movement:
```javascript
const moveRatio = 0.3; // How quickly zone moves toward hider
const randomOffset = 0.0005; // Random offset to prevent centering
```

### Styling
Modify `public/style.css` for custom themes:
- Color schemes
- Mobile responsiveness
- Animation effects

### Win Conditions
Adjust detection distance in `server.js`:
```javascript
if (distance < 20) { // Change detection range (meters)
```

## 🐛 Troubleshooting

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
- **Battery drain**: Location tracking is intensive
- **Slow updates**: Check network connection

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly on mobile devices
5. Submit a pull request

## 📄 License

MIT License - feel free to modify and distribute!

## 🎉 Credits

Built with love for outdoor gaming enthusiasts!

- Maps powered by OpenStreetMap
- Real-time magic by Socket.IO
- Mobile-first design principles

---

**Ready to play? Start the server and gather your friends! 🏃‍♂️💨**