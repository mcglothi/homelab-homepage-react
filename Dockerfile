# Stage 1: Build the React app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: Run the Express proxy + serve dist/
FROM node:20-alpine
WORKDIR /app
# Server deps only
COPY server/package*.json ./server/
RUN cd server && npm ci --production
# Built assets
COPY --from=builder /app/dist ./dist
# Proxy server
COPY server/proxy.cjs ./server/proxy.cjs
# Service catalog, read by the proxy's health probe (package.json marks src/*.js as ESM)
COPY package.json ./
COPY src/services.js ./src/services.js
EXPOSE 3010
ENV PORT=3010 NODE_ENV=production
CMD ["node", "server/proxy.cjs"]
