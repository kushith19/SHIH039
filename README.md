# TrustNet

Smart-city cyber-resilience demo: live topology and attack simulation in the browser, a Node API for rooms/telemetry, and an AI Commander that restates detector evidence (`/commander/explain` on incident lists) and composes a safety-checked briefing for correlated patterns (`/commander/analyze` → `commanderBriefing`). Live Q&A does not invent telemetry. RAG is optional; empty Qdrant is labeled **DEGRADED**.

Current architecture in one page: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The detector is a **graph residual encoder** (directed GNN, 14 features, 3-frame window, idle-window calibrator, hard gates). It is not a literature Temporal Graph Network and not Isolation Forest. Trust is a four-component posture score (25/30/25/20), not the anomaly score.

## What you need

| Requirement | Version / notes |
|---|---|
| **Node.js** | 20 or newer (root UI + `server/`; `tele-ingestion` also expects Node 20+) |
| **Python** | 3.10–3.12 recommended (`ai-com-v1`) |
| **Docker** | For Qdrant (`ai-com-v1/docker-compose.yml`) |
| **Ollama** | Local LLM at `http://localhost:11434` |
| **Groq API key** | Optional. Faster primary LLM; Commander falls back to Ollama if Groq is unset or fails |
| **PostgreSQL / TimescaleDB** | Only if you run `tele-ingestion` |

RAM: `qwen2.5:7b-instruct` typically needs about **8 GB** free. Smaller machines can use a 3B instruct model (see below).

## Ollama model

The repo is wired to this model name:

**`qwen2.5:7b-instruct`**

It is the default in:

- `ai-com-v1` (`OLLAMA_MODEL`, `src/config/settings.py`)
- `server` (`OLLAMA_MODEL` in `.env.example`)

Install Ollama, then pull and run that tag:

```bash
# https://ollama.com — install the app or CLI for your OS

ollama pull qwen2.5:7b-instruct
ollama serve          # if the daemon is not already running
ollama list           # confirm qwen2.5:7b-instruct is present
```

Keep the Ollama server on **port 11434** (default).

If you change the model, use the **same** name in both env files:

- `ai-com-v1/.env` → `OLLAMA_MODEL=...`
- `server/.env` → `OLLAMA_MODEL=...`

Example lighter alternative: `qwen2.5:3b-instruct` (set both env vars; quality of Commander JSON will be worse).

Optional Groq (faster, used as primary when `LLM_PROVIDER=groq`):

- Model: `openai/gpt-oss-20b`
- Set `GROQ_API_KEY` in `ai-com-v1/.env`

The Node server’s local Ollama explain path is **off** by default (`OLLAMA_FALLBACK=0`) so live attacks do not spin the laptop. Commander still uses Ollama when `LLM_PROVIDER=ollama` or as Groq fallback.

## Repo layout

| Path | Role | Default URL |
|---|---|---|
| `/` (Vite + React) | Two-role session UI (map + defender dashboard) | http://localhost:5173 |
| `server/` | Demo room, sockets, detection, Commander `/explain` client | http://localhost:3001 |
| `ai-com-v1/` | FastAPI Commander. Live: `/explain`. Lab: `/analyze` + RAG | http://localhost:8000 |
| `tele-ingestion/` | Optional CitySnapshot → TimescaleDB | http://localhost:3000 |

## 1. Clone and env files

```bash
cd trustNet

cp server/.env.example server/.env
cp ai-com-v1/.env.example ai-com-v1/.env
# optional:
cp tele-ingestion/.env.example tele-ingestion/.env
```

In `ai-com-v1/.env` (local-only, no Groq):

```ini
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b-instruct
OLLAMA_BASE_URL=http://localhost:11434
```

In `server/.env`, leave `AI_COMMANDER_URL=http://localhost:8000` so the UI/API can call Commander. Keep `OLLAMA_FALLBACK=0` unless you explicitly want the Node process to call Ollama.

Never commit `.env` files or API keys.

## 2. Qdrant (optional — Commander `/analyze` only)

The live SOC does **not** use RAG. Skip this unless you will ingest corpora and call `/analyze` with a real detection body (not `INC-001` mocks).

```bash
cd ai-com-v1
docker compose up -d qdrant
```

Dashboard: http://localhost:6333/dashboard

First-time knowledge ingest (from `ai-com-v1/` with the venv active):

```bash
python -m src.rag.ingest --input data/processed --batch-size 256
```

Embeddings use **`sentence-transformers/all-MiniLM-L6-v2`** (downloaded on first run; no Ollama needed for embeddings).

## 3. AI Commander

```bash
cd ai-com-v1
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Health:

```bash
curl http://localhost:8000/health
```

Analyze a **mock** incident (lab only — not live match detections):

```bash
curl -X POST http://localhost:8000/commander/analyze \
  -H "Content-Type: application/json" \
  -d '{"incidentId": "INC-001"}'
```

## 4. Node API + web UI

From the **repo root**:

```bash
npm install
npm install --prefix server
npm start                 # UI + API + Commander; Qdrant only with --with-rag
# or just the browser app + game server:
npm run dev:all
```

That starts Vite (`5173`) and the API (`3001`). Open http://localhost:5173

API-only: `npm run dev:server`. UI-only: `npm run dev`.

## 5. Telemetry ingestion (Timescale on :3000)

`npm start` starts this by default:

- TimescaleDB via `tele-ingestion/docker-compose.yml` (`postgres` on port 5432)
- `npm run db:init` then the ingest API on **port 3000**

The live dashboard waits for `http://127.0.0.1:3000/health`. Skip ingest with `npm start -- --no-ingest`.

Manual-only:

```bash
cd tele-ingestion
npm install
docker compose up -d postgres
npm run db:init
npm run dev
```

## Suggested start order

From the **repo root**, after `npm install` and `npm install --prefix server`:

```bash
npm start
```

That one command:

1. Copies missing `.env` files from the examples  
2. Starts Ollama if it is not already on port 11434, and pulls `qwen2.5:7b-instruct` if needed  
3. Starts Qdrant only if you pass `--with-rag`  
4. Starts TimescaleDB + tele-ingestion unless you pass `--no-ingest`  
5. Creates `ai-com-v1/venv` and installs Python deps if needed, then runs Commander on port 8000  
6. Starts the Vite UI (`5173`) and Node API (`3001`)

Open http://localhost:5173 as two tabs (defender + attacker). Wait for the 15-tick idle window before attacking.

Ctrl+C stops Commander, the UI, and the API.

```bash
npm start -- --no-ingest
npm start -- --with-rag
```

To run only the UI + API (Commander already up): `npm run dev:all`.  

## Tests

```bash
# From repo root (Node detection, story, commander client)
npm test

# Commander (from ai-com-v1, venv on)
pytest tests/test_agent.py tests/test_phase_6b.py tests/test_phase_6c_1.py tests/test_phase_6c_2.py tests/test_risk_compose.py tests/rag/

# Ingestion
cd tele-ingestion && npm test
```

Architecture, LangGraph nodes, and API contracts for Commander: [ai-com-v1/README.md](ai-com-v1/README.md).
