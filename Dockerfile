FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# معادلات التسعيرة مشتركة بين الخادم والواجهة
COPY server/src/lib/pricingFormulas.js /app/server/src/lib/pricingFormulas.js
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
ENV UPLOAD_DIR=/data/uploads PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
