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
# Photos and files are kept in the database (Turso), so they survive redeploys.
# Set MEDIA_STORAGE_MODE=durable to use S3 instead once its credentials are verified.
ENV MEDIA_STORAGE_MODE=database
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]


