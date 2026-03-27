FROM node:20-slim AS builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-slim
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
USER appuser
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8001) + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
