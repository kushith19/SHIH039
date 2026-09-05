# TrustNet

Smart-city cyber-resilience demo: live topology and attack simulation in the browser, a Node API for rooms/telemetry, and an AI Commander that restates detector evidence (`/commander/explain` on incident lists) and composes a safety-checked briefing for correlated patterns (`/commander/analyze` → `commanderBriefing`). Live Q&A does not invent telemetry. RAG is optional; empty Qdrant is labeled **DEGRADED**.

Current architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The detector is a **graph residual encoder** (directed GNN, 14 features, 3-frame window, idle-window calibrator, hard gates). It is not a literature Temporal Graph Network and not Isolation Forest. Trust is a four-component posture score (25/30/25/20), not the anomaly score.

---

## How to run

### Prerequisites

| Requirement | Version / notes |
|---|---|
| **Node.js** | 20 or newer (root UI, `server/`, `tele-ingestion`) |
| **Python** | 3.10–3.12 (`ai-com-v1`) |
| **Docker** | TimescaleDB (default with `npm start`) and optional Qdrant |
| **xAI / Groq API key** | Optional. Faster LLM for Commander; falls back to Ollama if unset |
| **Ollama** | Optional local LLM at `http://localhost:11434` |

### Quick start (recommended)

From the repo root:

```bash
cp server/.env.example server/.env
cp ai-com-v1/.env.example ai-com-v1/.env
# optional Timescale ingest:
cp tele-ingestion/.env.example tele-ingestion/.env

npm install
npm install --prefix server

npm start
```

`npm start` will:

1. Copy any missing `.env` files from the examples  
2. Start TimescaleDB + tele-ingestion on port **3000** (unless `--no-ingest`)  
3. Create `ai-com-v1/venv`, install Python deps if needed, and run Commander on **8000**  
4. Start the Vite UI on **5173** and the Node API on **3001**  
5. Start Qdrant only if you pass `--with-rag`

Then open **http://localhost:5173** in two tabs (defender + attacker). Wait for the **15-tick idle window** before attacking.

Stop everything with `Ctrl+C`.

#### Flags

```bash
npm start -- --no-ingest   # skip TimescaleDB + tele-ingestion
npm start -- --with-rag    # also start Qdrant (lab /analyze RAG only)
```

#### Optional local LLM

`npm start` does **not** start Ollama. In another terminal:

```bash
npm run ollama:qwen
```

That starts `ollama serve` if needed and pulls `qwen2.5:7b-instruct`.

### Ports

| Service | Path | URL |
|---|---|---|
| Web UI | `/` (Vite + React) | http://localhost:5173 |
| Game / detection API | `server/` | http://localhost:3001 |
| AI Commander | `ai-com-v1/` | http://localhost:8000 |
| Telemetry ingest | `tele-ingestion/` | http://localhost:3000 |
| Qdrant (optional) | `ai-com-v1/docker-compose.yml` | http://localhost:6333 |

### Environment

Never commit `.env` files or API keys.

**Commander** (`ai-com-v1/.env`) — defaults favor Grok; Ollama works offline:

```ini
LLM_PROVIDER=grok          # grok | ollama | groq | auto
XAI_API_KEY=               # required when LLM_PROVIDER=grok
OLLAMA_MODEL=qwen2.5:7b-instruct
OLLAMA_BASE_URL=http://localhost:11434
```

For local-only (no cloud key):

```ini
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b-instruct
OLLAMA_BASE_URL=http://localhost:11434
```

**Server** (`server/.env`) — keep Commander reachable:

```ini
AI_COMMANDER_URL=http://localhost:8000
TELE_INGESTION_URL=http://127.0.0.1:3000
OLLAMA_FALLBACK=0
```

If you change the Ollama model name, set the **same** value in both `ai-com-v1/.env` and `server/.env`.

### Run services separately

Use this when debugging one process, or when Commander is already up.

**AI Commander**

```bash
cd ai-com-v1
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Health check: `curl http://localhost:8000/health`

**UI + API only** (Commander already running):

```bash
npm run dev:all
```

API-only: `npm run dev:server` · UI-only: `npm run dev`

**Telemetry ingest only**

```bash
cd tele-ingestion
npm install
docker compose up -d postgres
npm run db:init
npm run dev
```

**Qdrant + knowledge ingest** (lab `/analyze` only — live SOC `/explain` does not use RAG)

```bash
cd ai-com-v1
docker compose up -d qdrant
# with venv active:
python -m src.rag.ingest --input data/processed --batch-size 256
```

---

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
