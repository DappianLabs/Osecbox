# Multi-stage build for OsecBox
FROM node:22.12-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# node-pty is an Electron dependency in the monorepo and may build from source
# on Linux. Keep the web/server image aligned with package.json's Node engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22.12-bookworm-slim

# Create a stable non-root user. This image is Debian-based, not Alpine.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home --shell /usr/sbin/nologin osecbox

WORKDIR /app

# The runtime directory is owned by the application user.
RUN chown -R osecbox:nodejs /app

# The server image does not start Electron or node-pty. Skip install scripts so
# a desktop-only native dependency cannot make the web image platform-specific.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built files from builder
COPY --from=builder --chown=osecbox:nodejs /app/dist ./dist

# Run the server without root privileges.
USER osecbox

# Expose port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port=process.env.PORT || '5000'; require('http').get('http://127.0.0.1:' + port + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

STOPSIGNAL SIGTERM

# Run the application
CMD ["node", "dist/index.cjs"]
