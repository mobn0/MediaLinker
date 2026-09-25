FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build --configuration production

FROM node:22-alpine
RUN apk add --no-cache python3 ffmpeg ca-certificates \
 && wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp && chown node:node /usr/local/bin/yt-dlp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY --from=frontend /build/dist/frontend/browser ./public
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
# yt-dlp breaks often as YouTube changes; self-update on start (best effort)
CMD ["sh", "-c", "yt-dlp -U >/dev/null 2>&1 || true; exec node server.js"]
