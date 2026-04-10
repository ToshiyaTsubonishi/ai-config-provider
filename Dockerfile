FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies for building
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY provider-bundle ./provider-bundle

ENV PORT=8080
ENV AI_CONFIG_PROVIDER_DIR=/app/provider-bundle
EXPOSE 8080

CMD ["node", "dist/index.js"]
