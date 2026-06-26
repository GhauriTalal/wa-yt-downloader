FROM node:18-slim

# Install yt-dlp and ffmpeg inside the Linux container
RUN apt-get update && apt-get install -y yt-dlp ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install project dependencies
COPY package*.json ./
RUN npm install

# Copy all project files
COPY . .

EXPOSE 3000

# Start the Node.js server
CMD ["node", "server.js"]
