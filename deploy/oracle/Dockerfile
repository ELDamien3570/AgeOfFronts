FROM node:24.18.0-slim AS build
WORKDIR /usr/src/app
RUN npm install --global --ignore-scripts npm@12.1.0
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json vite.skirmish.config.ts index.html ./
COPY resources ./resources
COPY skirmish ./skirmish
COPY src ./src
ARG SOURCE_REVISION
RUN test -n "$SOURCE_REVISION" && mkdir -p build/skirmish && \
    VITE_SKIRMISH_SOURCE_URL="https://github.com/ELDamien3570/AgeOfFronts/tree/$SOURCE_REVISION" \
    npm run build:skirmish && test -s build/skirmish/index.html

FROM node:24.18.0-slim AS runtime
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/build/skirmish ./build/skirmish
COPY --from=build /usr/src/app/resources ./resources
COPY --from=build /usr/src/app/src ./src
COPY --from=build /usr/src/app/tsconfig.json ./tsconfig.json
COPY --from=build /usr/src/app/package.json ./package.json
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
ENV STATIC_DIR=/usr/src/app/build/skirmish MULTIPLAYER_DB=/data/multiplayer.sqlite
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
    CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/skirmish/multiplayer/server.ts"]
