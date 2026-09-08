ARG ALPINE_VERSION=3.20

FROM alpine:${ALPINE_VERSION} AS builder
ARG VERSION=1.18.0
RUN apk add --no-cache nodejs npm python3 make g++
WORKDIR /app/code
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/ frontend/
COPY gulpfile.js logo.svg ./
RUN npm run build -- --revision "${VERSION}" && npm prune --omit=dev

FROM alpine:${ALPINE_VERSION}
ARG CREATED
ARG COMMIT
ARG VERSION=1.18.0
LABEL org.opencontainers.image.authors="on195594" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.url="https://github.com/on195594/meemo" \
      org.opencontainers.image.documentation="https://github.com/on195594/meemo/blob/master/README.md" \
      org.opencontainers.image.source="https://github.com/on195594/meemo" \
      org.opencontainers.image.title="Meemo" \
      org.opencontainers.image.description="Personal notes, ideas, links, and tasks"

RUN apk add --no-cache nodejs \
    && mkdir -p /app/code /app/data/storage \
    && chown -R 1000:1000 /app
WORKDIR /app/code
COPY --from=builder --chown=1000:1000 /app/code/node_modules/ node_modules/
COPY --from=builder --chown=1000:1000 /app/code/public/ public/
COPY --chown=1000:1000 src/ src/
COPY --chown=1000:1000 app.js oidc_develop_user_select.html start.sh things.json ./

ENV PORT=3000 \
    BIND_ADDRESS=0.0.0.0 \
    CLOUDRON_APP_ORIGIN=http://localhost:3000 \
    CLOUDRON_MONGODB_URL=mongodb://mongodb:27017/meemo \
    ATTACHMENT_DIR=/app/data/storage \
    CLOUDRON_LOCAL_AUTH_FILE=/app/data/.users.json \
    NODE_ENV=production
EXPOSE 3000
USER 1000:1000
HEALTHCHECK --interval=3m --timeout=5s --start-period=20s --retries=1 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/healthcheck" || exit 1
CMD ["./start.sh"]
