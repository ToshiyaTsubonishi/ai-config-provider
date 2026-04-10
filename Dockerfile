FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies for building
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runner

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist

# In Cloud Run, ai-config needs to be mounted or copied here.
# Assuming you will copy it via CI/CD, you might need:
# COPY ../ai-config /ai-config
# ENV AI_CONFIG_DIR=/ai-config

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]