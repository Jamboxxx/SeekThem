#!/bin/bash

# Build and deploy script for SeekThem
set -e

echo "🔨 Building SeekThem Docker container..."

# Build the Docker image
docker build -t seek-them:latest .

echo "✅ Build complete!"

# Check if container is already running
if docker ps | grep -q seek-them-app; then
    echo "🔄 Stopping existing container..."
    docker stop seek-them-app
    docker rm seek-them-app
fi

echo "🚀 Starting SeekThem container..."

# Run the container
docker run -d \
    --name seek-them-app \
    --restart unless-stopped \
    -p 3000:3000 \
    seek-them:latest

echo "✅ SeekThem is now running!"
echo "🌐 Open http://localhost:3000 in your browser"
echo "📱 Share this URL with players on your local network:"

# Get local IP address (works on most Unix systems)
LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1)

if [ ! -z "$LOCAL_IP" ]; then
    echo "📱 http://$LOCAL_IP:3000"
else
    echo "📱 http://YOUR_LOCAL_IP:3000"
fi

echo ""
echo "🎮 Game Controls:"
echo "   - One player selects 'Hider'"
echo "   - Other players select 'Seeker'"
echo "   - Hider starts the game when ready"
echo "   - Stay within the shrinking zone!"