FROM node:24-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev --ignore-scripts
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
# Photos and other files up to MEDIA_DB_MAX_MB (20 MB) are stored in the main
# database (Turso), so they survive redeploys. Larger files stay on the local disk.
# Use MEDIA_STORAGE_MODE=durable with S3_* for object storage instead.
ENV MEDIA_STORAGE_MODE=database
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]


