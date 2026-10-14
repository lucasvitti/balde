# Balde — System Map

Architecture, module, and request-flow diagrams for **Balde de conhecimento**
(the skills-governance cockpit). Zero-dependency Node HTTP server + vanilla-JS
SPA, deployed as a single Docker container behind nginx + Authentik SSO on the
VPS. Git is the version ledger for the corpus.

> Diagrams are Mermaid — they render on GitHub and in most Markdown previewers.

---

## 1. Deployment / container architecture

Who talks to whom across the network boundary. The **whole app** is gated by
Authentik SSO; the **machine API** (`/api/v1`) is carved out and authenticates by
key in the app itself. `revhub-logs` is a **separate** service (the VSTO add-in's
telemetry) and is *not* wired into Balde.

```mermaid
flowchart TB
    U["Browser SPA<br/>app.js · vanilla JS"]
    M["VSTO add-in · agents · MCP"]
    AI["AI providers<br/>Anthropic · OpenAI · compatible"]

    subgraph vps["VPS · srv1108382"]
      NGINX["nginx :443<br/>TLS · Let's Encrypt"]
      AK["Authentik outpost :8100<br/>SSO · Google · TOTP"]

      subgraph baldec["Balde container :8098"]
        SRV["Node http · server.js + src/*.mjs"]
      end

      subgraph fsv["Host volumes · /opt/balde-corpus"]
        GIT[("git corpora<br/>skills · buddies · groups<br/>docs · prompts · commons")]
        NPS[("non-git<br/>users enc-keys · queue")]
        FB[("feedback *.jsonl")]
      end

      subgraph rhl["revhub-logs :8097 — SEPARATE service"]
        RL["Fastify + better-sqlite3"]
        DB[("events · ai_payloads<br/>chat_feedback .db")]
      end
    end

    U -->|"HTTPS /"| NGINX
    NGINX -->|"auth_request"| AK
    NGINX -->|"authed + X-Authentik-*"| SRV
    M -->|"HTTPS /api/v1 · Bearer key"| NGINX
    NGINX -->|"/api/v1 · no SSO"| SRV
    SRV --> GIT
    SRV --> NPS
    SRV --> FB
    SRV -->|"per-user encrypted key"| AI
    M -.->|"HTTPS · X-RevHub-Key"| RL
    RL --> DB
```

---

## 2. Backend module graph

The `src/*.mjs` modules extracted from `server.js` (modularization in progress).
Arrows = "imports". `config.mjs` and `fs-utils.mjs` are the shared leaves;
`governance.mjs` is self-contained (zero imports).

```mermaid
flowchart TB
    envloader["scripts/env-loader"]
    secrets["scripts/secrets"]
    gengov["scripts/generate-governance-suggestions"]

    config["config.mjs"] --> envloader
    fsutils["fs-utils.mjs"]
    skillfmt["skill-format.mjs"]
    gitcorpus["git-corpus.mjs"] --> config
    gitcorpus --> fsutils
    aiprov["ai-provider.mjs"]
    buddies["buddies.mjs"] --> config
    buddies --> fsutils
    buddies --> gitcorpus
    buddies --> skillfmt
    skillhelpers["skill-helpers.mjs"] --> fsutils
    gov["governance.mjs"]

    server["server.js<br/>handleApi router + serveStatic"]
    server --> config
    server --> fsutils
    server --> skillfmt
    server --> gitcorpus
    server --> aiprov
    server --> buddies
    server --> skillhelpers
    server --> gov
    server --> secrets
    server --> gengov
```

---

## 3. Sequence — create a skill (the git-as-ledger write path)

Balde's signature: every corpus write is a git commit authored by the SSO
identity nginx forwards. This is the same shape for edit / upload / publish.

```mermaid
sequenceDiagram
    actor Owner
    participant SPA as Browser SPA
    participant NG as nginx
    participant AK as Authentik
    participant SRV as Balde server
    participant FS as Corpus (files)
    participant GIT as git

    Owner->>SPA: fill "Criar skill" wizard
    SPA->>NG: POST /api/skills/new
    NG->>AK: auth_request (session valid?)
    AK-->>NG: 200 + X-Authentik-Email / Groups
    NG->>SRV: POST /api/skills/new + identity headers
    SRV->>SRV: assertSafe* · buildStarterSkillMarkdown
    SRV->>FS: write SKILL.md + context files
    SRV->>GIT: commitCorpus (author = SSO identity)
    GIT-->>SRV: commit hash
    SRV-->>SPA: 200 { skill }
    SPA->>SRV: reload GET /api/skills
```

---

## 4. Sequence — machine API fetch (fail-closed, key-authed)

External consumers read the OKF corpus with a Bearer key or personal token.
nginx sends `/api/v1` straight to the app (no Authentik); the app authorizes.

```mermaid
sequenceDiagram
    participant Agent as VSTO add-in / agent
    participant NG as nginx
    participant SRV as Balde server

    Agent->>NG: GET /api/v1/skills · Authorization: Bearer <key>
    NG->>SRV: proxy (no SSO on /api/v1)
    SRV->>SRV: validateMachineToken / authorizeMachine
    alt no / bad key
        SRV-->>Agent: 401 (fail-closed)
    else authorized
        SRV->>SRV: loadSkillsFromDisk · filter by reader ACL
        SRV-->>Agent: 200 OKF list (only readable skills)
    end
```

---

### Legend / notes

- **SSO gate**: `location /` → `auth_request` → Authentik outpost; anon → 302 to login.
- **Machine API**: `location /api/v1/` bypasses SSO; the app authenticates by key and is **fail-closed** (empty key set ⇒ API disabled).
- **Git ledger**: corpora under `/opt/balde-corpus/*` are git repos; every write commits with the SSO identity as author (`commitCorpus`).
- **Secrets**: per-user AI keys are encrypted at rest (`ai-key.enc.json`, `BALDE_SECRET_KEY`); machine keys live in `env_file` outside the deploy dir.
- **Not wired**: `revhub-logs` (SQLite telemetry) receives the VSTO add-in's events directly; it is not connected to Balde's flat-file feedback.
