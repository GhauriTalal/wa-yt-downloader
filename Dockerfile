FROM node:18-slim

# Install python3, curl, and ffmpeg inside the Linux container
RUN apt-get update && apt-get install -y python3 curl ffmpeg && rm -rf /var/lib/apt/lists/*

# Download the latest Linux yt-dlp binary and make it executable
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install project dependencies
COPY package*.json ./
RUN npm install

# Copy all project files
COPY . .

EXPOSE 3000

# Start the Node.js server
CMD ["node", "server.js"]
