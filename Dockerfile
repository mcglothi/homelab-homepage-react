# Stage 1: Build the React app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Stage 2: the Python server (backend/server.py, stdlib only) serves dist/ and /api/*
FROM python:3.13-slim
WORKDIR /app
COPY backend ./backend
COPY --from=builder /app/dist ./dist
# Service catalog, read by /api/health and search (backend/homeapi/routes.py)
COPY src/services.js ./src/services.js
# Mirror database (backend/homeapi/mirror.py); compose mounts a volume here
RUN mkdir -p /app/data
EXPOSE 3010
ENV PORT=3010 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python3", "backend/server.py"]
