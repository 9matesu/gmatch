# Official goonMatch API image. Build context MUST be the monorepo root:
#   docker build -f apps/api/Dockerfile .
FROM oven/bun:1.4
WORKDIR /app

# Workspace deps first (bun understands npm workspaces at the root).
COPY package.json bun.lock* package-lock.json* ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN bun install --cwd /app

# App source (migrations/ must sit next to src/ — migrate.ts resolves it
# relative to the app dir).
COPY apps/api ./apps/api

ENV PORT=8080
ENV SNAPSHOT_PATH=/data/orbit.sqlite
ENV BLOB_STORE_DIR=/data/blobs
VOLUME /data
EXPOSE 8080

# Health = boot speed + db readiness; fly tcp_checks hit this.
HEALTHCHECK --interval=15s --timeout=3s CMD bun -e "const r=await fetch('http://127.0.0.1:8080/api/health').then(x=>x.json());if(!r.db_ready)process.exit(1)"

WORKDIR /app/apps/api
CMD ["bun", "run", "src/serve.ts"]
