# TrustNetAI — Hackathon Red-Team Audit

**Date:** 2 September 2026  
**Scope:** Entire repository as it exists on disk (not README wishful thinking)  
**Mode:** Audit only. This document does not prescribe a code commit; it ranks what would need to change to survive judging.  
**Verdict:** Do not bet on winning as-is. The architecture is real. The story, claims, FinTech fit, and demo reliability are not judge-proof.

**₹10 lakh bet: NO.** Estimated probability of winning against ~30 polished teams: **~15%**.

---

## How this audit was done

Features were traced UI → state → API → model → persistence → output. A component existing was not treated as a working feature. Documentation was compared to code. Known “limitations” in older reports were **not** accepted at face value; each was scored for how badly it hurts judging.

Primary evidence locations:

| Layer | Paths |
|---|---|
| UI | `src/App.jsx`, `src/pages/GamePage.jsx`, `src/pages/DashboardPage.jsx`, `src/features/**` |
| Shared models | `shared/trustConfig.js`, `shared/trustModel.js`, `shared/tgnnCore.js`, `shared/tgnnFeatures.js` |
| Game server | `server/index.js`, `server/roomStore.js`, `server/detection/*`, `server/commander/client.js` |
| Commander | `ai-com-v1/src/**` |
| Telemetry DB | `tele-ingestion/**` |
| City twin | `overfit/city_model/**` |
| Docs | `README.md`, `TRUST_AND_ANOMALY_REPORT.md`, `SYSTEM_REPORT.txt`, service READMEs |

---

# PHASE 1 — Repository forensics

## 1.1 Layout

```
trustNet/
├── README.md
├── SYSTEM_REPORT.txt          # stale (browser-only era)
├── TRUST_AND_ANOMALY_REPORT.md  # stale vs server fusion
├── package.json               # name: smarthackathon
├── scripts/start-stack.mjs    # npm start
├── src/                       # Vite + React UI
├── shared/                    # trust, TGNN core, city helpers
├── overfit/city_model/        # YAML digital twin (folder typo: infrastructue/)
├── server/                    # Express + Socket.IO :3001
├── ai-com-v1/                 # FastAPI Commander + RAG :8000
└── tele-ingestion/            # Timescale ingest :3000
```

No `docs/`, no pitch deck, no `HACKATHON*` file besides this audit.

## 1.2 Feature inventory

| Feature | Claimed | Actually implemented | End-to-end connected | Evidence | Risk |
|---|---|---|---|---|---|
| Live topology canvas | Yes | Yes | Yes | `GraphCanvas.jsx`, `InfrastructureNode.jsx` | Empty graph if default never loaded |
| Asset catalog / drag-drop | Yes | Yes | Yes | `SidebarAssets.jsx`, `assetCatalog.js` | Catalog defaults are hardcoded PPS/trust |
| City YAML digital twin | Yes | Yes | Yes if overlay loads | `overfit/city_model/**`, `loadCityModel.js`, `loadCityModel.client.js` | Folder typo `infrastructue`; overlay can fail silently in judges’ minds |
| City map background | Yes | Yes | Yes | `CityMapBackground.jsx`, `cityMap.js` | Decorative vs operational |
| City context scenarios | Yes | Yes | Yes | `CityContextMenu.jsx`, `shared/cityContext.js`, `room:setCityContext` | Locks at match start |
| Trust score 0–100 | Yes | Yes (formula) | Yes | `shared/trustModel.js`, `peerTrust.js` `computeGraphTrustState` | Not calibrated; docs describe wrong peer formula |
| Baseline vs expected vs effective telemetry | Yes | Yes | Yes | `peerTrust.js` `getNodeBaselineMetrics` / `getNodeExpectedMetrics` / `getNodeEffectiveMetrics` | **This is a real differentiator — poorly visualized** |
| Compromise / attack presets | Yes | Yes | Yes when `phase === 'playing'` | `attackPresets.js`, `sim:patch` | Canned multipliers |
| Rogue / injected nodes | Yes | Yes | Yes | `validators.js` provenance `injected` | Fusion **bonus** for injected = cheat |
| Browser TGNN | Yes | Fixed-weight forward pass | Fallback only when server detection null | `tgnnAnomaly.js`, `tgnnCore.js`, `tgnnWindow.js` `buildClientTgnnWindows` | Client is **not temporal**; overclaim |
| Server TGNN + fusion | Partial in docs | Yes | Yes in live match | `server/detection/engine.js`, `fusion.js`, `tgnn.js`, `temporal.js` | Fusion bonuses leak game flags |
| Attack spread | Yes | Heuristic BFS | Yes | `attackSpread.js`, `server/detection/spread.js` | Not physics; undirected adj; cutoff 65 |
| Attacker/defender multiplayer | Yes | FIFO 2 seats, one room | Partial | `useGameRoom.js`, `server/index.js` `room:join` | Always `DEMO`; URL room id discarded |
| Match start | Implied manual | Auto-start when both seats fill | Partial | `tryAutoStartMatch`; `startGame` **unused by UI** | Race: start before topology |
| Inspector | Yes | Yes | Yes | `InspectorPanel.jsx` | Closed by default; judges may never open it |
| Dashboard KPIs | Yes | Derived, not hardcoded | Conditional | `DashboardPage.jsx`, `KpiStrip.jsx`; poll `/rooms/:id/metrics` | Standalone `/dashboard` empty; needs playing + samples |
| Incidents + evidence | Yes | Yes | Yes | `server/detection/incident.js`, `IncidentsPanel.jsx` | Buried in dashboard tab |
| AI Commander | Grounded RAG assessments | FastAPI + LangGraph + Qdrant | **Live UI uses `/explain`, not `/analyze`** | `server/commander/client.js` `explainViaCommander`; `commander.py` | RAG not on the live path; 45s timeout; template fallback |
| RAG / vector search | Yes | Yes inside `/analyze` | Not on live incidents | `ai-com-v1/src/rag/*` | First-time ingest path `data/processed` may be missing |
| Timescale telemetry | Optional | Real Express + pg | Conditional | `tele-ingestion`, `server/telemetry/ingestionClient.js` | `npm start` depends on Docker postgres |
| JSON import/export | Implied by code | Parse/serialize + modals | **No** | `graphIO.js`; GraphCanvas `_exportGraph` orphaned | Dead feature |
| localStorage graph | Implied | `loadPersistedGraph` / `persistGraphJson` | **No callers** | `graphIO.js` | Dead |
| Multi-room `/play/:roomId` | URL suggests yes | `Navigate` to `/play` | **No** | `src/App.jsx` | False affordance |
| Auth / users | Sometimes denied in old reports | None | N/A | — | Fine for hackathon if you don’t claim it |
| FinTech product | Possible track story | Finance YAML sector only | Topology only | `overfit/city_model/infrastructue/finance/*.yaml` | Judge: “this is IoT” |

## 1.3 Dependency inventory

**Root (`package.json`, name `smarthackathon`):** React 19, react-router-dom 7, `@xyflow/react`, socket.io-client, recharts, yaml, lucide-react, nanoid. Vite 8, Tailwind 4. **No engines field** (README says Node 20+). **No Zustand.**

**Server (`server/package.json`):** express 5, socket.io, cors, better-sqlite3, yaml, nanoid.

**Tele-ingestion:** express 4, pg, zod, dotenv. Engines `node >= 20`.

**AI Commander (`ai-com-v1/requirements.txt`):** fastapi, uvicorn, pydantic, httpx, langchain-core, langchain-ollama, langchain-groq, langgraph, qdrant-client, sentence-transformers, pymupdf, pytest.

## 1.4 Route inventory (React)

| Path | Component | Reality |
|---|---|---|
| `/` | `GamePage` | Main product. README calls this “Dashboard UI” — **wrong**. |
| `/play` | `GamePage` | Alias |
| `/play/:roomId` | redirect → `/play` | **Room id thrown away** |
| `/default` | redirect `/?loadDefault=1` | Forces default topology |
| `/dashboard` | `DashboardPage` with no `roomId` | **Empty CTA shell** |

Defender map vs SOC: `?view=dashboard` inside `GamePage` only.

Vite proxy (`vite.config.js`): `/socket.io`, `/rooms`, `/health` → `:3001`. Optional `VITE_WS_URL` in `src/multiplayer/socket.js` — **not in any `.env.example`**.

## 1.5 API / backend inventory

### Game server (`server/index.js`, default :3001)

HTTP:

- `GET /health` → `{ ok: true }`
- `GET /rooms/:id/metrics` — **no auth**
- `GET /rooms/:id/detection` — **no auth**

Socket.IO inbound (representative): `room:join`, `room:setDetectionMode`, `room:setCityContext`, `game:start`, `graph:load|addNode|updateNode|deleteNode|addEdge|updateEdge|deleteEdge|nodeChanges|setViewport`, `sim:patch`, `defender:quarantine`.

Broadcast: `state:sync`.

Roles: first join **defender**, second **attacker**, keyed by `socket.id` (`server/validators.js`). Third rejected.

Env (`server/.env.example`): `PORT`, `CLIENT_ORIGIN`, `AI_COMMANDER_URL`, `TELE_INGESTION_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK` (default 0).

SQLite: `server/metrics/store.js` → `server/data/metrics.sqlite` (lookback 10 ticks, retention 600).

### AI Commander (`ai-com-v1`, :8000)

- `GET /health`
- `POST /commander/analyze` — LangGraph + RAG
- `POST /commander/explain` — **LLM only, undocumented in Commander README**

`get_detection_adapter()` always returns `MockDetectionAdapter` (`INC-001`… canned city incidents). Live server **does** send `detection:` in the body, so mock IDs are bypassed **if** the payload is present (`resolve_detection` in `commander.py`).

No CORS middleware. Host `0.0.0.0`. No auth. No rate limit.

### Tele-ingestion (:3000)

- `GET /health`
- `POST /ingest/snapshot`, `POST /ingest/infrastructure`
- `GET /api/infrastructure`, `/api/telemetry/recent`, `/api/telemetry/history/:endpointId`

No CORS, no auth, no rate limit in `app.ts`.

## 1.6 Database / vector / LLM inventory

| System | Where | Notes |
|---|---|---|
| SQLite | `server/data/metrics.sqlite` | Detection/metrics lookback |
| Timescale/Postgres | `tele-ingestion/docker-compose.yml` | user `smartcity`, db `smart_city`, port 5432 |
| Qdrant | `ai-com-v1/docker-compose.yml` | 6333/6334, collection `ai_commander_knowledge_v1` |
| Embeddings | MiniLM `all-MiniLM-L6-v2` | Downloaded first run |
| Ollama | :11434 | Default `qwen2.5:7b-instruct` (~8 GB RAM) |
| Groq | optional | `openai/gpt-oss-20b`, `GROQ_API_KEY` |

## 1.7 AI / ML inventory

See Phase 4. Training code for the detector: **none**. RAG loads a pretrained SentenceTransformer; that is not TGNN training.

## 1.8 State-management inventory

| Store | Contents |
|---|---|
| `useGameRoom` | Room graph, viewport, phase, players, hackSimulator, detection, tick, cityContext, liveTelemetry, role, connected, errors |
| `HackSimulatorContext` | Attack layer + derived scan (overrides, baselines, anomaly/spread ids, trustByNodeId) |
| Local UI in `GamePage` | Selection, panels, optimistic hack mirror |
| Optimistic canvas | `mpNodes` / `mpEdges` in `GraphCanvas` |
| Server | In-memory `Map` of rooms (`roomStore.js`); one live room `DEMO` |

No Redux/Zustand.

## 1.9 Persistence / import / export

| Mechanism | Status |
|---|---|
| Server room graph | Live for the session |
| Default architecture | `getDefaultCanvasState` / `buildCityDependencyGraph` — yes if user clicks or `?loadDefault=1` |
| localStorage `smarthackathon.canvas.graph.v1` | **Dead** |
| JSON export/import UI | **Orphaned** |
| Timescale history | Yes if ingest stack is up |
| Qdrant corpus | Manual ingest; README path `data/processed` may not exist |

## 1.10 Demo-only / mock / static inventory

- Hardcoded `DEMO_ROOM_ID = 'DEMO'`
- `CITY_DEPENDENCIES` hardcoded edge PPS/labels in `cityModel.js`
- `assetCatalog` / `ATTACK_PRESETS` static multipliers
- TGNN weights = `sin(...)` not learned
- `MockDetectionAdapter` for Commander when no `detection` body
- OSM/CARTO map tiles (network dependency during demo)
- Dashboard empty zeros when not playing
- Fusion bonuses for `injected` / `override` (game metadata, not sensor truth)

## 1.11 Unused / dead / duplicate inventory

- `src/features/icons/placeholderIcons.jsx` — never imported
- `loadPersistedGraph` / `persistGraphJson` — no callers
- `disconnectGameSocket` — unused
- `useGameRoom.startGame` — unused by `GamePage`
- GraphCanvas `_exportGraph` / `_onImportClick`
- `CITY_CONTEXT_LABELS` duplicate in `metrics.js`
- `SYSTEM_REPORT.txt` LobbyPage / IoTDeviceNode — files gone
- Root package name `smarthackathon` vs product TrustNetAI

## 1.12 Test inventory

Frontend `src/`: **no tests**.  
Server: a few `*.test.js` (city model, commander client, incident evidence, ingestion client).  
Shared: `tgnnKeys.test.js`, `liveTelemetry.test.js`.  
Tele-ingestion: vitest.  
Commander: pytest suite + RAG tests.

---

# PHASE 2 — What can break the demo

## Startup

| Issue | Repro | Expected | Actual | Severity | Fix (do not implement in this audit) |
|---|---|---|---|---|---|
| `npm start` requires Docker + Ollama + Python venv + RAM | Fresh laptop, no Docker | App opens | `start-stack.mjs` `fail()` | **CRITICAL** | Venue path: `npm run dev:all` only; Commander optional |
| First-time `ollama pull qwen2.5:7b-instruct` | Cold start | Instant demo | Minutes + 8 GB | **CRITICAL** | Never pull on stage; Groq or templates |
| MiniLM / pip install on first Commander start | Cold `npm start` | Instant | Long wait; 180s health timeout | **HIGH** | Pre-bake venv |
| Port conflicts 3000/3001/5173/8000/5432/6333/11434 | Anything else bound | Stack up | Wait-then-fail | **HIGH** | Document kill list |
| Missing `.env` | Forgotten copy | Fail closed | Stack copies examples | LOW | OK |
| RAG ingest `data/processed` missing | Follow README | Vectors | Command fails | MEDIUM | Don’t ingest on stage |
| CORS | UI not on 5173 | Sockets work | Blocked | MEDIUM | `CLIENT_ORIGIN` |
| `better-sqlite3` native build | Odd Node version | Server starts | Install fail | MEDIUM | Pin Node 20 |

## Runtime / UI

| Issue | Repro | Expected | Actual | Severity | Fix |
|---|---|---|---|---|---|
| Empty graph match | Two browsers join before default load | City on map | `playing`, 0 nodes | **CRITICAL** | Auto-load city on `startMatch` |
| Seat collision | Third tab or two judges | Isolated rooms | Rejected / stolen seats | **CRITICAL** | `?room=` or solo demo |
| `/play/:id` | Share URL | Join that room | Redirect drops id | **HIGH** | Don’t show that route |
| Attacker waiting copy | Attacker in lobby | “Waiting for defender” | “Waiting for the explainer to reconnect” | **HIGH** | Copy fix — looks unfinished |
| No Start button | Need to delay start | Explicit start | Auto-start only | HIGH | UI or auto-load first |
| Commander hang | Ollama 7B | Instant narrative | 45s then “AI Commander unavailable” | **CRITICAL** for AI story | Evidence-first; LLM bonus |
| Dashboard `/dashboard` | Judge bookmarks it | SOC | Empty | HIGH | Redirect to game |
| Ingest down | Skip Timescale | KPIs still tell story | Spark 0; warning if `ingestionStatus` down | MEDIUM | Script around map not spark |
| React Flow + many nodes | Huge graph | Smooth | Jank | MEDIUM | Stay on 46-node city |
| Map tiles | No internet | Map | Blank basemap | MEDIUM | Offline fallback or accept |
| City context locked | Change mid-match | Flexible | Locked | LOW | Explain in demo |
| Detection mode locked | Same | — | Locks at start | LOW | Hide radios in demo |
| Optimistic vs `state:sync` | Rapid edits | Consistent | Possible flicker | MEDIUM | Don’t spam edits on stage |
| Delete compromised node | Attacker/defender delete | Detection updates | Must not crash; spread seeds vanish | MEDIUM | Rehearse; don’t delete mid-shot |
| Tiny graph &lt; 3 nodes | Sparse topology | Detection | `smallGraphMinScore` 0.55 | LOW | Always load full city |
| Cyclic graphs | Cycles in twin | Spread works | BFS still runs | LOW | Fine |
| Topology change during attack | Add edges mid-play | Spread updates | Yes, can confuse | LOW | Freeze topology in demo |
| No anomalies | Weak attack | Something happens | Gates 10% / 0.58 | **HIGH** | Use presets that spike ≥50% one metric |
| Multiple anomalies | Several presets | Readable | Map noise | MEDIUM | One origin in 3-min script |
| Refresh / reconnect | Reload | Same role | Socket id match only | HIGH | Don’t refresh mid-demo |
| Simultaneous edits | Both roles patch | Last write wins | Race | MEDIUM | Scripted turns |

## Multiplayer truth

Connected path is real: Socket.IO → `DEMO` → FIFO roles → auto `startMatch` → graph events → `sim:patch` / quarantine → server detection → client prefers `room.detection` (`GraphCanvas.jsx` serverDetection branch).

It is **not** a productized multi-room game. Treat it as a **two-seat instrument** for a staged demo.

---

# PHASE 3 — Cybersecurity audit

Separate **repository-real** from **theoretical**. Hackathon-sized response: do not build Keycloak in 12 hours.

## Real

1. **Authentication:** None on HTTP or sockets. Fine if you pitch “local demo.” Fatal if you pitch “secure platform.”
2. **Authorization / roles:** Server-side `isDefender` / `isAttacker` — real for the two seats. Client UI is secondary. **Good.**
3. **Room isolation:** Broken as multi-tenancy. One `DEMO` room. Metrics keyed by `room_id` in SQLite but live play is shared.
4. **API authorization:** `/rooms/:id/metrics` and `/detection` unauthenticated. Commander and ingest unauthenticated and bound `0.0.0.0`.
5. **WebSocket:** Origin allowlist (`CLIENT_ORIGIN` + 127.0.0.1:5173), `credentials: true`, `maxHttpBufferSize: 5e6`. No JWT. Role = socket.id.
6. **Input validation:** `sanitizeNode` / `sanitizeEdge` coerce types; **no label length / node-count caps** beyond 5MB buffer.
7. **JSON import:** Parser exists; UI not wired. Server re-sanitizes `graph:load`. DoS via huge graph is the real risk.
8. **localStorage:** Graph JSON only; not secrets. Dead path anyway.
9. **Secrets:** README says never commit `.env`. Root `.gitignore` **only** ignores `server/data/` sqlite — **not `.env`**. `server/.env` and `ai-com-v1/.env` exist on disk. `GROQ_API_KEY` may be empty.
10. **XSS:** Labels are React text. No `dangerouslySetInnerHTML` on graph labels. Low classic XSS. UI pollution via huge strings still possible.
11. **Trust-score / telemetry manipulation:** Attacker is **supposed** to override metrics. Fusion then **adds score** for `injected` and `override` — that is **labeled leakage**, not a CVE, but a **credibility kill**.
12. **API abuse / rate limit:** None. Local DoS easy. Irrelevant on a closed LAN unless a security track judge cares.
13. **Dependency vulns:** Not scanned in this audit. Don’t claim “hardened.”

## Theoretical / low for this venue

Prompt injection into Commander, RAG poisoning, adversarial ML on a non-trained embedding, IDOR across rooms that don’t exist, chem/bio N/A.

## Hackathon-sized security story

Say: “This is a **closed-loop simulation**. Roles are enforced on the server. We did not build production IAM.”  
Do: remove fusion cheat bonuses; gitignore `.env`; don’t expose Commander to a public Wi-Fi without a firewall.

---

# PHASE 4 — ML / TGNN audit

## Is it a TGNN?

**No.** It is a **hand-crafted GNN-style forward pass** with a tiny temporal concat. It is not TGN, TGAT, DyRep, or any trained temporal graph network.

### Algorithm (`shared/tgnnCore.js`)

Weights:

```
scale = seed === 1 || seed === 4 ? 0.55 : 0.22
w = sin(row * 12.9898 + col * 78.233 + seed) * scale
```

Layers: `W_IN` (seed 1), `W_MSG` (2), `W_OUT` (3), `W_TEMP` (4). `embedDim = 8`.

Spatial: `h0 = tanh(W_IN x)` → directed in/out mean pool → `h1 = tanh(h0 + W_MSG n1)` → second pool → `h2`.

Temporal: pad/truncate to `K = 3`, concat K embeddings, `tanh(W_TEMP · concat)`, residual with last frame.

Score: `d = ||e_obs - e_base||_2`, `score = σ(4.5 · d)`.

### Temporal?

- **Client** (`buildClientTgnnWindows`): **No real lookback.** Observed = `[expected, expected, current]`. Baseline = expected × 3. Comment in code admits this.
- **Server** (`server/detection/tgnnWindow.js` + SQLite lookback 10): **Weakly temporal.** Short residual window, not a learned temporal kernel.

### Graph-aware?

**Yes.** Directed message passing, two rounds. This is the defensible part.

### Learning? Training? Learned weights?

**No.** No gradients, no dataset, no `.pth`.

### What is an anomaly?

A node with **telemetry drift** (and not quarantined) whose fused or TGNN score clears **hardcoded gates**:

From `TRUST_CONFIG.tgnn` / `classifyTgnnScores`:

| Knob | Value |
|---|---|
| `anomalyScoreThreshold` | 0.58 |
| `relativeMinScore` | 0.50 |
| `minScoreGap` | 0.04 |
| `minSpread` | 0.06 |
| `minDeviationRatio` | 0.10 |
| `metricSpikeDeviationRatio` | 0.50 |
| `smallGraphMinScore` | 0.55 |
| `minNodesForFullClassify` | 3 |

Fusion (`fusion.js`): `fused = clamp01((0.55·temporal + 0.45·tgnn)·critWeight + bonuses)`, threshold **0.55**, plus drift, not quarantined.

**Bonuses (hostile):** trust&lt;40 → +0.05; **injected → +0.08**; **override → +0.04**.

### Evasion / dilution / baseline contamination

- Slow-roll metrics under 10% relative change: **evades** drift gate.
- Many small overrides: **dilutes** visual story; scores may still fire if fusion bonuses apply.
- Snapshot after attack already applied: expected ≈ attack → **no drift**.
- Graph size: small graphs use 0.55 floor; large graphs increase JS cost, not “more learning.”
- Multiple anomalies: all drift candidates can flag; map becomes unreadable.
- Features: `tgnnFeatures.js` 14 base keys + optional `yaml:*`. Docs still say **eleven** features. Normalization is heuristic 0–1, not statistically fit.
- Calibration: **none.** Do not show the number as a probability.
- Confidence: incident `confidence` mix exists in `TRUST_CONFIG.incident.confidence` — **show it**, don’t invent ML certainty.
- Explainability: evidence codes (`metric_deviation`, expected/observed) are **better than the embedding**. Feature attribution of `W_IN` is not meaningful (random-ish sin weights).

### Practical improvements (no giant model)

1. Stop calling it a trained TGNN in the UI.
2. Remove injected/override bonuses.
3. Lead with **metric attribution** (top 2 deviations).
4. Optional adaptive threshold: median + k·MAD on scores.
5. Peer-group: compare node to same `sector` (you already have sector on YAML).
6. Keep fusion as the honest default (temporal + graph).
7. Deterministic replay of telemetry for the demo (presets already exist).

---

# PHASE 5 — Trust score audit

## Formula (code, not the old markdown)

`blendTrust` in `shared/trustModel.js`:

`0.25·intrinsic + 0.30·peer + 0.25·behavioral + 0.20·interaction` → round clamp 0–100.

- **Intrinsic:** type trust mixed with criticality baseline (`criticalityMix` 0.2). Caps: injected ≤28, quarantined ≤15.
- **Behavioral:** max relative deviation vs expected telemetry; 0 at 35% (`fullPenaltyRatio`). Also activity bands (normal / elevated / extreme), city-context aware.
- **Interaction:** upstream/downstream 50/50; contract penalty 0.35; isolated → 100 (neutral).
- **Peer:** mean of neighbors’ **local posture** (intrinsic+behavioral+interaction), not mean intrinsic. Isolated → own local (`isolatedUses: 'local'`).

**TRUST_AND_ANOMALY_REPORT.md is wrong** on peer (says neighbor intrinsic) and on “browser only.”

## Edge cases

| Case | Behavior |
|---|---|
| Zero baseline PPS | `eps = 1` in ratios |
| Zero traffic | Behavioral can look like huge relative change vs eps |
| Isolated node | Peer = local; interaction 100 |
| Extreme PPS | Behavioral → 0; trust drops; may or may not flag depending on gates |
| Invalid / missing metrics | Coercion / defaults from catalog |
| Topology change | Peer and interaction recompute; no hysteresis |
| Feedback loop | Yes: peer uses neighbors’ local posture, so one bad node pulls adjacent trust |

## Why should a judge trust this number?

They should treat it as a **transparent posture index**, not a probability of compromise. The inspector breakdown is the defense. A single 0–100 badge without bars is a vanity meter.

## Hierarchy (enforce in language)

| Name | Meaning | Must not be confused with |
|---|---|---|
| Trust / posture | Weighted reliability index 0–100 | Detection |
| Temporal / telemetry residual | Heuristic series score | TGNN |
| Graph residual (“TGNN”) | Embedding L2 distance | Trained model |
| Fused detection score | Mix + threshold → flag | Trust |
| Incident severity / confidence | Bands from config | Financial loss |
| Business / financial risk | **Not computed today** | Trust |

If you mix “Trust Score 41 = the bank is hacked,” you will lose the FinTech judge.

---

# PHASE 6 — Product / judge audit

## A. Cybersecurity judge

- **Impresses:** Server role checks, quarantine vs spread resistance 100, evidence objects, OT-ish safety language in Commander (if shown).
- **Confuses:** Game vs SOC; fusion vs TGNN radios.
- **Distrusts:** Detecting `injected` provenance; “LIVE” pip as if this were production telemetry.
- **Challenges:** “Turn off the injected bonus and show me the same attack.” “Is this signature or behavioral?”
- **Looks fake:** Template “AI Commander unavailable.”
- **Innovative:** Expected vs effective + graph residual on a twin.
- **Missing:** MITRE mapping on the **map** (corpus exists in RAG, not on the live path).
- **Others score higher:** Cleaner purple-team story, real PCAPs, no overclaim.
- **Biggest add:** Detection that only uses telemetry+graph; cheat flags off.

## B. AI/ML judge

- **Impresses:** Feature list (degree, neighbor risk, context); server lookback; fusion weights documented in one config file.
- **Confuses:** Two detectors + trust.
- **Distrusts:** The letters T-G-N-N.
- **Challenges:** “Show me the training loop.” “What is the loss?”
- **Looks fake:** sin weights; client padding.
- **Innovative:** Using graph context at all in a hackathon.
- **Missing:** Honesty slide; attribution.
- **Others score higher:** Even a tiny trained sklearn model with a held-out split looks more “ML.”
- **Biggest add:** Rename + why-line + don’t lie.

## C. FinTech judge

- **Impresses:** Payment-processing / core-banking YAML exists.
- **Confuses:** Why ATMs and hospitals share one trust formula.
- **Distrusts:** No ₹, no transactions in the UI.
- **Challenges:** “This is OT/IoT.”
- **Looks fake:** Finance as a map pin (`cityMap.js` `finance` zone).
- **Innovative:** Could be municipal payments as critical infrastructure — **you don’t say it**.
- **Missing:** Blast radius, failed_transactions on the hero node, treasury hop.
- **Others score higher:** Actual payment-risk or fraud graph.
- **Biggest add:** Payment-rail blast radius.

## D. Smart city judge

- **Impresses:** 46 endpoints, contexts, map, sectors.
- **Confuses:** Attacker game framing.
- **Distrusts:** Simulated telemetry (acceptable if labeled).
- **Challenges:** “Who operates this in a real city?”
- **Looks fake:** Overfit folder name `overfit`.
- **Innovative:** Digital twin + context multipliers.
- **Missing:** Citizen impact sentence.
- **Others score higher:** Clearer ops UX, less game chrome.
- **Biggest add:** 30-second thesis on the first screen.

## E. Venture / product judge

- **Impresses:** Ambition, full stack.
- **Confuses:** Buyer (city CISO vs bank vs insurer vs hackathon game).
- **Distrusts:** Unscalable browser GNN story.
- **Challenges:** “What’s the wedge?”
- **Looks fake:** Four services for a demo that still says Generating…
- **Innovative:** Twin + two-player could be a training product for SOCs.
- **Missing:** One buyer, one metric (₹ or minutes of payment halt).
- **Others score higher:** Tighter narrative, fake-it-less.
- **Biggest add:** Municipal payments ops wedge.

### Scorecard /10

| Axis | Score |
|---|---|
| Problem relevance | 8 |
| Innovation | 6 |
| Technical depth | 7 |
| AI credibility | 3 |
| FinTech relevance | 3 |
| Cybersecurity depth | 6 |
| Smart-city relevance | 8 |
| Explainability | 4 |
| UX | 5 |
| Demo quality | 4 |
| Scalability | 3 |
| Real-world applicability | 5 |
| Business potential | 4 |

---

# PHASE 7 — FinTech fit

**Could a judge reasonably say this is just an IoT cybersecurity project?**  
**Yes.**

Why, exactly:

- The core loop is node PPS / HTTP / login-style metrics, trust, graph residual, spread, quarantine.
- Finance appears as **one sector among many** (water, hospital, traffic, telecom…).
- There is no ledger, no payment authorization decisioning, no AML, no settlement, no cyber-insurance quote, no cyber credit product.
- `transaction_requests` / `failed_transactions` live in YAML (e.g. `payment-processing-system.yaml`) but the **demo story does not make them the protagonist**.
- Trust is not a financial risk number.

### Smallest high-impact changes (reuse architecture; reject gimmicks)

**Do:**

1. Default topology **is** the municipal payment rail: citizen payments → `payment-processing-system` → `core-banking-system` → gov/treasury edges that already exist in the twin.
2. **Financial blast radius** from existing directed dependencies: hops into `category: finance` + criticality weights → ₹ band + “citizen payments delayed.”
3. Put **failed_transactions / transaction_latency** on the hero node during the attack (only if those keys already merge into live telemetry; if not, that wiring is the real FinTech feature).
4. One sentence buyer: city treasury + payment ops, not “all IoT.”

**Don’t:** blockchain, NFT, fake AI credit score = trust×1000, generic “DeFi.”

### Track checklist

| Theme | Today | Worth it? |
|---|---|---|
| Payment infrastructure | YAML nodes | Yes — make default |
| Municipal treasury | Possible via gov↔finance edges | Yes — name it |
| Citizen payments | Implied | Yes — copy |
| Transaction-risk detection | YAML metrics unused in story | Yes if keys flow |
| Financial exposure | No | **Highest ROI** |
| Cyber insurance | No | One derived field max |
| Cyber credit score | No | Gimmick — skip |
| Systemic financial risk | Spread heuristic only | Phrase as blast radius |
| Transaction-flow anomaly | Not really | Don’t claim |
| Payment gateway risk | `bank-gateway` / payment node | Highlight |
| Financial blast radius | No | **Build** |

---

# PHASE 8 — UX / visual story

**Can a judge understand the value in 30 seconds without explanation?**  
**No.**

What they see: logo, role, `tick N · normal_day · fusion · LIVE`, Map/Dashboard (defender only), context menu, panel toggles, a map that may be empty, an asset tray. No thesis. Inspector closed. Dashboard hidden. Detection radios during lobby. Attacker copy bug.

### Failures

- Information overload without hierarchy
- Labels: fusion / TGNN / Telemetry + TGNN
- Empty `/dashboard`
- Mobile: fixed overlay panels (`max-lg`) — not a judging surface
- Severity colors exist (`--tn-crit` etc.) but trust vs anomaly vs spread purple need a **legend on canvas**
- Attack flow: attacker must know to wait for `playing`, select node, apply preset — **not discoverable**
- AI output: dashboard incidents, not the map
- Features judges never find: default architecture, quarantine in inspector, evidence list, city YAML richness

### Improved first screen (design, not implemented)

1. Persistent one-liner: **“Live city payment rail — expected vs observed telemetry, containment, blast radius.”**
2. City **already loaded** in lobby.
3. Legend: trust badge, red origin, purple at-risk, quarantine.
4. Strip: payment-node trust | fused score | ₹ at risk | one **why** sentence.
5. Demo buttons: Run attack / Contain / Reset.
6. Advanced: detection mode radios collapsed.

---

# PHASE 9 — Demo script attack

## 3-minute (intended)

0:00 Thesis + zoom payment rail.  
0:20 Show expected ≈ observed, healthy trust.  
0:40 One-click attack on payment-processing.  
1:10 Red origin, purple at-risk, **why** (metric, expected, observed).  
1:40 Quarantine → trust ≤15, spread stops.  
2:10 Dashboard: incident + ₹. LLM only if already `ready`.  
2:40 Honesty: “graph + temporal residual, not a trained TGNN.”  
3:00 Stop talking.

## 5-minute add-ons

CityContext (event vs night) proving **expected** moves; compare fusion vs graph-only; one rogue injected node **after** you explained detection doesn’t need the cheat bonus (bonus must be gone or you lose the cyber judge).

## How judges break it

| Break | Why |
|---|---|
| “Is the TGNN trained?” | You named it TGNN |
| “Show another room” | DEMO only |
| Refresh | Role/graph reset pain |
| “Open dashboard in a new tab” | Empty `/dashboard` |
| Unplug Docker | `npm start` culture |
| Quiet attack | 10% gate |
| Ask for RAG citation | Live path is `/explain` |
| Third laptop | Seat full |
| “Shut down the hospital” to Commander | Only if you demo `/analyze` safety — currently you don’t |

## Impressive-looking but unproven

- LIVE pip
- TGNN label
- Qdrant running in Docker while UI never shows a retrieved chunk
- Timescale while judge stares at the map
- Recharts spark with zeros

## SAFE DEMO MODE (specification)

Must never depend on luck:

- Preloaded topology (full city, camera on finance)
- Deterministic preset (known spike ≥50% on a visible metric)
- Deterministic tick (don’t wait for “maybe this tick”)
- Fallback copy = evidence template; LLM optional
- Backend-offline: keep last `state:sync`; show OFF; client `collectActiveAnomalies` already exists as fallback
- Reset to snapshot
- One-click attack, one-click quarantine
- Visible before/after: trust, failed tx or PPS, ₹ at risk
- Solo mode: scripted attacker seat **or** `?demo=1` that enables attacker tools for the presenter without a second human
- Never `npm start` cold on venue Wi-Fi; never ollama pull; never first-time pip

---

# PHASE 10 — Competitor differentiation

Assume 30 teams have: chatbot, anomaly %, dashboard, threat score, attack sim, smart-city IoT, blockchain, generic ML.

**Hard to copy quickly:** YAML twin with schedules + cityContext expected telemetry; two-player live topology with server fusion; quarantine changing spread; evidence objects.

**Looks generic:** Chatbot, “AI SOC,” TGNN name, KPI strip, map of IoT.

**Five signature features** (live-demoable, credible, visual, not gimmicks):

1. Payment-rail **blast radius** on real edges  
2. **Expected vs effective** telemetry (make it the visual)  
3. Dual-control topology + quarantine  
4. **Evidence-first** incident line (beats LLM)  
5. Honest **graph residual + temporal fusion** with inspector bars  

Originality &gt; quantity. Hide extra radios.

---

# PHASE 11 — Scalability

Let N = nodes, E = edges, D = 8, K = 3, F ≈ 14+.

| Stage | Complexity | Practical |
|---|---|---|
| Feature frame | O(N+E) | Fine at 46 |
| Spatial TGNN | O(N F D + N·deg·D) | Fine at 100; pain at 1k in JS every tick |
| Window | ×K ×2 (obs+base) | |
| Spread | BFS; worst ~O(E(N+E)) for primary pick | Fine at 46 |
| React Flow | Dominant UX bottleneck | ~100–300 nodes |
| Socket state:sync | Full graph | Don’t do 10k |
| SQLite lookback | Cheap | |
| Timescale ingest | Fine | |
| Qdrant | Irrelevant to tick loop | |
| Commander | 45s, queue 5 | Not a scale path |

**First bottleneck:** browser graph + per-tick JS, not Postgres.

**Realistic scaling architecture (future, not hackathon):** server-side graph compute, canvas shows sampled/aggregated view, telemetry stream, detection service, IAM. **For judging: cap at the 46-endpoint twin and say so.**

10 nodes: fine. 100: OK. 1,000: UI dies first. 10,000: different product.

---

# PHASE 12 — Claim verification

| Claim | Evidence | Accurate? | Overclaim? | Better wording |
|---|---|---|---|---|
| “Smart-city cyber-resilience demo” (`README.md`) | Real twin + sim | Yes | Mild | Keep |
| “Dashboard UI” at `/` | `GamePage` | **No** | Yes | “Live topology / match UI” |
| TGNN (UI, KPI “TGNN flags”, docs title) | Fixed embedding | Graph-aware residual **yes**; TGNN **no** | **Severe** | “Graph residual detector (GNN-style, untrained)” |
| Temporal | Client pad; server lookback 10 | Weak | Yes on client | “Short telemetry window on the server; client is padded” |
| “Both run entirely in the browser… no separate server” (`TRUST_AND_ANOMALY_REPORT.md`) | Four services | **False** | Severe | Delete or rewrite |
| “No authentication / no backend” (`SYSTEM_REPORT.txt`) | Backend exists; still no auth | Stale | Confusing | Archive the file |
| RAG grounded assessments | `/analyze` yes; live `/explain` no RAG | Partial | **Yes** on live demo | “Optional LLM narrative; RAG on analyze path” |
| Real-time | Socket ticks + simulated telemetry | Sim real-time | If said as city sensors | “Simulated live telemetry over sockets” |
| AI | Commander + residual detector | Narrow | If said as trained AI SOC | “Heuristic detection + optional LLM explanation” |
| Predict | Not really forecasting | No | Don’t say predict | “Detect residual vs expected” |
| Secure / production-ready | No auth, open ports | No | Don’t say | “Closed-loop demo” |
| Autonomous | Quarantine is human click | No | Don’t say autonomous response | “Operator containment” |
| Financial risk | YAML only | No | Don’t say until blast radius exists | “Finance-sector dependencies in the twin” |
| 14 docs / 5830 chunks (Commander README) | Not re-counted here | Unverified | Don’t quote unless you verify | “RAG corpus of public cyber guidance” |
| Frozen integration baseline | Marketing | N/A | Skip | Skip |
| Scalable | Browser tick | No | Don’t say | “Designed around a ~50-node twin” |

README is relatively honest about being a **demo** and about Ollama RAM. The **UI labels and TRUST_AND_ANOMALY_REPORT** are the overclaim engines.

---

# PHASE 13 — Prioritized fix plan

This section is **recommendations**. This markdown file is not a mandate to change code.

For every item: ID, problem, why judges care, evidence, solution, files, difficulty (S/M/L), demo impact, judge impact, dependencies, acceptance.

## P0 — Will lose / demo-break

### P0-1 Empty graph auto-start
- **Problem:** Match starts with zero nodes.  
- **Why:** Dead canvas in the first 30s.  
- **Evidence:** `tryAutoStartMatch` vs optional default load; `GamePage` does not force topology.  
- **Solution:** On `startMatch`, if `nodes.length === 0`, load `buildCityDependencyGraph`. Add **Reset** to that snapshot.  
- **Files:** `server/index.js`, city graph builder, `GamePage.jsx` / `GraphCanvas.jsx`.  
- **Difficulty:** S. **Demo:** critical. **Judge:** critical. **Deps:** none.  
- **Accept:** Two browsers, never click default, still see the city.

### P0-2 SAFE DEMO MODE
- **Problem:** Two humans, luck, LLM.  
- **Why:** Competing teams one-click.  
- **Evidence:** FIFO seats; 45s explain; unused `startGame`.  
- **Solution:** `?demo=1` — preloaded city, one-click attack preset on payment node, one-click quarantine, Reset, evidence-first copy, solo or scripted attacker.  
- **Files:** `GamePage.jsx`, `useGameRoom.js`, `attackPresets.js`, `IncidentsPanel.jsx`.  
- **Difficulty:** M. **Demo:** critical. **Judge:** high. **Deps:** P0-1.  
- **Accept:** One laptop, no Groq, complete 3-minute script twice in a row.

### P0-3 Evidence-first AI
- **Problem:** “Generating…” / “AI Commander unavailable” becomes the AI story.  
- **Why:** Looks like a broken chatbot.  
- **Evidence:** `IncidentsPanel` `explanationPreview`; `client.js` timeouts, circuit breaker, `/explain`.  
- **Solution:** Default visible text = `formatEvidenceItem` lines. LLM only if `explanationStatus === 'ready'`. Never block the map on Commander.  
- **Files:** `IncidentsPanel.jsx`, `server/commander/client.js`.  
- **Difficulty:** S. **Demo:** high. **Judge:** AI + product. **Deps:** none.  
- **Accept:** Unplug :8000, demo still has a crisp why.

### P0-4 Fusion cheat bonuses
- **Problem:** +0.08 injected, +0.04 override.  
- **Why:** Cyber judge: you detect your own labels.  
- **Evidence:** `TRUST_CONFIG.fusion.bonuses`, `server/detection/fusion.js`.  
- **Solution:** Remove those two bonuses (keep optional low-trust bonus only if you can defend it). Rehearse the same preset still flags via drift.  
- **Files:** `shared/trustConfig.js`, `fusion.js`, tests.  
- **Difficulty:** S. **Demo:** must re-tune preset. **Judge:** cyber critical. **Deps:** retune P0-2 preset.  
- **Accept:** Injected node without telemetry drift does **not** flag; spiked payment node **does**.

### P0-5 Naming and copy
- **Problem:** TGNN in header/KPIs; “explainer to reconnect.”  
- **Why:** ML gotcha; unfinished UX.  
- **Evidence:** `GamePage.jsx` waitingCopy; `KpiStrip.jsx` “TGNN flags”.  
- **Solution:** “Graph residual” / “Fusion”; fix waiting strings.  
- **Files:** `GamePage.jsx`, `KpiStrip.jsx`, `metrics.js`, `DashboardPage.jsx`, inspector labels.  
- **Difficulty:** S. **Demo:** medium. **Judge:** ML critical. **Deps:** none.  
- **Accept:** Screenshot of header contains no undefended “TGNN” as a product name (internal code can keep it).

### P0-6 Venue start path
- **Problem:** `npm start` is a Rube Goldberg of Docker/Ollama.  
- **Why:** Boot fail = no demo.  
- **Evidence:** `scripts/start-stack.mjs` hard `fail()` without docker/ollama.  
- **Solution:** Printed runbook: `dev:all` + optional Commander. Do not live-pull models.  
- **Files:** README (when you choose to edit docs).  
- **Difficulty:** S. **Demo:** critical. **Judge:** n/a. **Deps:** none.  
- **Accept:** Cold `dev:all` on a known-good Node 20 machine in &lt;2 minutes.

## P1 — Major score loss

### P1-1 Financial blast radius
- **Problem:** No money in the product.  
- **Why:** FinTech / venture tracks.  
- **Evidence:** finance YAML unused as hero.  
- **Solution:** For flagged node, walk downstream (and 1 hop upstream) finance-category endpoints; `exposure = f(criticality, hops, cityContext)`; show ₹ band + citizen-payment sentence.  
- **Files:** new small helper under `shared/` or `src/features/dashboard/`; inspector + KPI strip.  
- **Difficulty:** M. **Demo:** high. **Judge:** FinTech. **Deps:** P0-1 city load.  
- **Accept:** Attacking payment-processing changes a visible ₹ number; attacking an isolated sensor does not equally.

### P1-2 Payment-rail default framing
- **Problem:** Generic mesh.  
- **Why:** 30-second story.  
- **Evidence:** `cityMap.js` finance coords exist; camera not story-driven.  
- **Solution:** Fit view to finance cluster on load; labels.  
- **Files:** `GraphCanvas.jsx`, `cityMap.js`, default graph builder.  
- **Difficulty:** S–M. **Demo:** high. **Judge:** product. **Deps:** P0-1.

### P1-3 Why-line on the map
- **Problem:** Evidence buried in dashboard.  
- **Why:** Judges never click Dashboard.  
- **Evidence:** toast “TGNN flagged…” in `GraphCanvas.jsx`; incidents in `IncidentsPanel`.  
- **Solution:** Canvas toast/strip: metric, expected, observed, %.  
- **Files:** `GraphCanvas.jsx`, incident evidence helpers.  
- **Difficulty:** S. **Demo:** high. **Judge:** explainability. **Deps:** detection already emits evidence.

### P1-4 Stop lying about rooms
- **Problem:** `/play/:roomId` discard.  
- **Why:** Trust.  
- **Evidence:** `App.jsx`.  
- **Solution:** Honor query `?room=` **or** remove the route.  
- **Files:** `App.jsx`, `useGameRoom.js`.  
- **Difficulty:** S–M. **Demo:** medium. **Judge:** engineering. **Deps:** optional for solo demo.

### P1-5 Secrets hygiene
- **Problem:** `.gitignore` misses `.env`.  
- **Why:** Security judge trivia; accidental key commit.  
- **Evidence:** `.gitignore`.  
- **Solution:** Ignore `.env`, keep `.env.example`.  
- **Files:** `.gitignore`.  
- **Difficulty:** S. **Demo:** none. **Judge:** cyber hygiene. **Deps:** none.

### P1-6 Docs vs product
- **Problem:** Stale reports.  
- **Why:** Judges who `cat` the repo.  
- **Evidence:** `TRUST_AND_ANOMALY_REPORT.md`, `SYSTEM_REPORT.txt`.  
- **Solution:** Banner “stale” or rewrite 20 lines of honest detector description.  
- **Files:** those markdown files.  
- **Difficulty:** S. **Demo:** none. **Judge:** ML. **Deps:** P0-5 language.

## P2 — Noticeable weakness

- Wire **or hide** JSON import/export (`graphIO.js`, GraphCanvas).  
- Hide detection-mode radios in demo.  
- Rename npm package `smarthackathon`.  
- Fix folder typo `infrastructue` only if it won’t break loaders (high regression risk — maybe don’t).  
- If Groq key exists, use it; if not, don’t wait on 7B.  
- Delete `placeholderIcons.jsx` or ignore.  
- Frontend smoke test for demo preset still flags after bonus removal.

## P3 — Polish

Legend, mobile, accessibility of icon-only panel buttons (some `aria-label`s already exist), package engines, Commander README `/explain`.

## P4 — Future work

Trained model, multi-room product, auth, 10k nodes, live `/analyze`+RAG on every incident, real city telemetry, true transaction-flow ML.

---

# PHASE 14 — Do this or lose

## 1. TOP 10 REASONS WE COULD LOSE

1. An ML judge asks where the TGNN is trained.  
2. `npm start` / Ollama / Docker eats the slot.  
3. Match starts on an empty graph.  
4. Two-player seating fails (one laptop, three tabs, refresh).  
5. FinTech judge: “This is IoT with a bank icon.”  
6. Fusion detects `injected` / `override` flags.  
7. The AI moment is a 45-second spinner then a fallback disclaimer.  
8. First screen has no thesis; dashboard is hidden.  
9. You claim RAG; live path is `/explain` without retrieval.  
10. A tighter team tells a clearer story in 30 seconds.

## 2. TOP 10 THINGS THAT ARE ACTUALLY IMPRESSIVE

1. A real four-service stack, not a single mocked page.  
2. YAML city digital twin with schedules and contexts.  
3. Expected vs effective telemetry (the actual invention).  
4. Server-side fusion + SQLite lookback (more honest than the client pad).  
5. Topology-aware message passing (even with fixed weights).  
6. Dual-role live React Flow session with server authority.  
7. Quarantine that changes spread resistance.  
8. Structured incident evidence (expected/observed/codes).  
9. Commander LangGraph + safety **if** you ever show `/analyze`.  
10. Trust decomposition that can be opened in the inspector.

## 3. TOP 10 TECHNICAL FIXES

1. Auto-load city + Reset (P0-1).  
2. Remove fusion injected/override bonuses (P0-4).  
3. Evidence-first explanations (P0-3).  
4. Retune attack preset so it still flags post-bonus-removal.  
5. Map why-line from existing evidence (P1-3).  
6. Blast radius from finance subgraph (P1-1).  
7. Honor or delete room URLs (P1-4).  
8. `.gitignore` `.env` (P1-5).  
9. Stop client TGNN padding from being described as temporal.  
10. Keep `OLLAMA_FALLBACK=0` on stage.

## 4. TOP 10 PRODUCT FIXES

1. Payment rail as the default story.  
2. ₹ blast radius in the header strip.  
3. 30-second thesis sentence on screen.  
4. Demo Reset / one-click attack / contain.  
5. Hide advanced detection radios.  
6. Solo demo mode.  
7. Don’t ship standalone empty `/dashboard`.  
8. Honest detector name.  
9. Buyer: municipal payments + city ops.  
10. Inspector open when a node is flagged.

## 5. TOP 10 DEMO FIXES

1. `?demo=1` path.  
2. Preloaded graph before anyone joins.  
3. One-click attack on payment-processing.  
4. One-click contain.  
5. Never cold `npm start` on venue Wi-Fi.  
6. Template why, not LLM, as the punchline.  
7. Second-device QR **or** scripted attacker — pick one and rehearse.  
8. Groq if key exists; otherwise skip LLM entirely.  
9. Practice the sentence: “Not a trained TGNN.”  
10. Reset between judges.

## 6. TOP 10 FINTECH UPGRADES

1. Default camera on finance cluster.  
2. `failed_transactions` on the hero card during attack.  
3. Treasury / gov hop named in the toast.  
4. Exposure formula → ₹ band.  
5. “Citizen payments halted / delayed” copy.  
6. At most one cyber-insurance derived field from exposure.  
7. Contagion via **existing** edges to core-banking-backup.  
8. Use cityContext as payday/event load — already in the twin.  
9. Payment gateway (`bank-gateway`) as secondary highlight.  
10. Reject blockchain / fake credit score.

## 7. TOP 10 UNIQUE FEATURES

1. Context-aware expected telemetry.  
2. Digital twin YAML (46 endpoints).  
3. Live dual-role topology.  
4. Residual + fusion detection.  
5. Spread + quarantine coupling.  
6. Evidence objects.  
7. Optional grounded Commander (analyze path).  
8. Map + SOC tab on the same room.  
9. Transparent four-part trust index.  
10. City contexts that change the baseline, not just a theme.

## 8. FEATURES TO DELETE OR HIDE

- Standalone `/dashboard`  
- `/play/:roomId` unless it works  
- JSON I/O until wired  
- TGNN-only radio in the judged demo  
- Detection radios in the 3-minute path  
- `placeholderIcons.jsx`  
- `SYSTEM_REPORT.txt` as if current  
- Unused Start API without a button  
- Qdrant/RAG as a talking point unless a chunk is on screen  
- Ollama 7B during the live attack

## 9. CLAIMS WE SHOULD STOP MAKING

- Trained / real TGNN  
- Production-ready  
- Secure multi-tenant platform  
- RAG on every live incident  
- Real city sensor feeds  
- Autonomous response  
- Transaction-level FinTech AI  
- Scalable to thousands of nodes in this UI  
- “Dashboard” as the homepage

## 10. CLAIMS WE SHOULD EMPHASIZE

- Digital twin of city **dependencies**  
- Context-aware **expected vs observed** telemetry  
- Graph-aware residual **plus** temporal fusion  
- Operator-in-the-loop containment  
- Explainable **evidence** (numbers, not vibes)  
- Municipal **payment-rail blast radius** (after it exists)  
- Closed-loop **simulation** for operators, not a magic SOC  
- Honest about what is simulated

## 11. 24-HOUR PLAN

- **0–4h:** P0-1, P0-4, P0-5, gitignore, header copy.  
- **4–10h:** SAFE DEMO, one-click attack/contain/reset, retune preset.  
- **10–16h:** Blast radius + payment-rail framing + map why-line.  
- **16–20h:** Evidence-first incidents; hide dead routes; rewrite 20 lines of TRUST report.  
- **20–24h:** Two dry runs on `dev:all` with Commander **off**. One run with Groq if available.

## 12. 12-HOUR PLAN

P0-1, P0-2, P0-3, P0-4, P0-5, P1-1 (minimal ₹), P1-2, P1-3. Skip RAG, auth, extra rooms, Timescale worship.

## 13. 4-HOUR EMERGENCY PLAN

Auto-load city. `?demo=1` one-click attack on payment node. Remove cheat bonuses; confirm preset still flags. Rename TGNN in UI. Evidence one-liner on map. Reset. **Do not touch Commander.**

## 14. FINAL JUDGE SCORE /100

**52 / 100** as the repository stands today.

If P0 + P1-1/2/3 land and the pitch is honest: **70–75** is reachable. That is contention, not a lock.

## 15. EXACT REASONS FOR THE SCORE

- **+** Smart-city twin, expected/effective model, working dual-role graph, real detection pipeline, inspector math.  
- **−** TGNN naming, FinTech emptiness, demo fragility, RAG overclaim, fusion label leakage, first-screen silence, stale docs.  
- Not a 30: there is real engineering. Not a winner: claims and story lose to polished teams.

## 16. ONE-SENTENCE WINNING PITCH

**TrustNetAI is a live digital twin of a city’s payment and infrastructure dependencies: we compare context-aware expected telemetry to what the graph is doing now, show containment and blast radius, and we will not insult you by calling a fixed embedding a trained TGNN.**

---

# FINAL BET

**YES or NO: NO.**

**Probability of winning:** ~**15%**.

**Three biggest reasons:**

1. The AI/ML story is indefensible if anyone asks about training.  
2. The demo depends on stack luck, two seats, and a graph that may be empty.  
3. FinTech and venture judges can truthfully call this a smart-city IoT SOC with a finance folder.

**Three changes most likely to increase that probability:**

1. Honest detector naming, no fusion cheats, evidence **why** on the map.  
2. Luck-proof one-click demo on a preloaded city.  
3. Make municipal **payment-rail blast radius** the visual and verbal center.

Be ruthless with yourselves: the codebase is stronger than the pitch. The pitch is currently how you lose.
