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
EXPOSE 3010
ENV PORT=3010 NODE_ENV=production
CMD ["node", "server/proxy.cjs"]
