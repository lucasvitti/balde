# Hosted 1.x setup (nginx + Authentik). The 2.x runtime listens on 127.0.0.1 only and drops
# proxy identity headers, so it does not run behind this as is: see README, Quickstart.
# Balde de conhecimento (Knowledge pail) — zero-dependency Node app.
# Serves the SYNTHETIC demo corpus only; no real corpus, no AI key.
# Base is debian-slim (not alpine): the DuckDB CLI is a glibc binary.
FROM node:20-slim

WORKDIR /app

# Image-level TOOLS (the app itself keeps ZERO runtime npm dependencies):
# - git       = the corpus version ledger (Balde commits on every write)
# - duckdb    = ephemeral governed-query engine (Executar/Inspecionar sandbox)
# - pdftotext = raw-knowledge ingestion (Mapear conhecimento bruto) PDF extraction
ARG DUCKDB_VERSION=1.3.2
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl unzip poppler-utils \
 && curl -sL -o /tmp/duckdb.zip "https://github.com/duckdb/duckdb/releases/download/v${DUCKDB_VERSION}/duckdb_cli-linux-amd64.zip" \
 && unzip -q /tmp/duckdb.zip -d /usr/local/bin \
 && rm -f /tmp/duckdb.zip \
 && apt-get purge -y curl unzip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*' \
 && duckdb --version

# No npm install: package.json declares zero runtime deps.
# The build context is trimmed by .dockerignore (no secrets, no real corpus).
COPY . .

# CORPUS_ROOT drives every root (three-level namespace: repos/<repo>/{skills,commons} +
# global roots). Prod overrides it to the host-volume mount via docker-compose.
ENV NODE_ENV=production \
    PORT=8098 \
    CORPUS_ROOT=/app/demo-corpus \
    FEEDBACK_WATCH=0 \
    AI_DIRECT_OPENAI=0

EXPOSE 8098

CMD ["node", "server.js"]
