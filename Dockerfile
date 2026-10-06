FROM node:22-bookworm-slim

# better-sqlite3 compiles a native addon when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace manifests first so `npm ci` installs every workspace's deps and
# stays cached until a package.json/lockfile changes.
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/cv-match/package.json packages/cv-match/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/semantic-match/package.json packages/semantic-match/
COPY packages/source-adapters/package.json packages/source-adapters/
COPY packages/test-utils/package.json packages/test-utils/
RUN npm ci --prefer-offline

COPY . .

# 4000 = API, 4001 = frontend dev server (docker-compose `web` service).
EXPOSE 4000 4001

CMD ["npm", "run", "dev"]
