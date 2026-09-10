FROM oven/bun:1.4

WORKDIR /app

# Keep the image focused on the API workspace. The root package.json is
# rewritten inside the image so Bun does not try to install the Electron app.
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY shared ./shared

RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.workspaces=['apps/api','packages/*']; fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"

RUN bun install --production

ENV NODE_ENV=production
ENV PORT=8080
ENV SNAPSHOT_PATH=/data/orbit.sqlite
ENV BLOB_STORE_DIR=/data/blobs

EXPOSE 8080

CMD ["bun", "run", "apps/api/src/serve.ts"]
