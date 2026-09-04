# TrustNet — Project Operational Knowledge

**Purpose.** Pitch-oriented operational knowledge base for the *current* repository implementation. Written so another AI (or human) who has never opened the code can explain the product, architecture, demo narrative, and technical boundaries accurately.

**Scope rules.** This document describes what the code does today. It distinguishes implemented vs simulated vs advisory behavior. Where something is not clearly exposed in the repository, it is marked as such. It is not a slide deck, script, or interview Q&A list.

**Primary code surfaces.** `src/` (React UI), `server/` (match room, detection, Socket.IO), `shared/` (contracts shared by UI and server), `ai-com-v1/` (FastAPI AI Commander + optional RAG), `tele-ingestion/` (TimescaleDB ingest), `overfit/city_model/` (YAML city reference model).

---

## Section 1 — Product Overview

### What the project is

TrustNet (package name `trustnetai`) is an AI-driven cybersecurity **decision-support** demo for smart-city digital infrastructure. It models the city as a **connected cyber-physical graph**: infrastructure endpoints are nodes; dependencies and communications are edges. The product shows operators what is behaving abnormally, where residual risk originated, which neighbors are exposed, why the system considers the situation risky, what simulated economic exposure that implies, and what **safe advisory** response to consider—then lets the operator execute only a small set of **registered simulator containment actions**.

### Problem it solves

A cyber attack on a smart city is not merely an anomaly on one machine. Compromised or stressed assets can affect peer trust, dependency paths, and economically consequential services. Traditional per-device anomaly tools do not tell an operator how graph relationships change the blast radius or what safe next step to take. TrustNet addresses that gap with graph residual detection, peer trust, incident promotion with numeric evidence, optional knowledge retrieval, and policy-gated response.

### Target environment

The modeled environment spans interconnected smart-city sectors present on the live canvas:

Energy, water, traffic/transport, telecom/data, government/citizen services, education, healthcare, emergency/public safety, and banking/payments infrastructure.

Nodes represent logical infrastructure types (gateways, controllers, services, platforms)—not live hardware sensors attached to this demo.

### Smart-city / critical-infrastructure / fintech relevance

- **Smart city / SDG framing.** The demo is city-wide critical infrastructure visibility (resilience of interconnected services).
- **Critical infrastructure.** Detection and response language treat OT/ICS-class assets carefully: advisory plans prefer validation, segmentation, and coordination over unqualified physical shutdowns.
- **FinTech relevance.** Banking and payment endpoints sit on the same graph. Simulated economic exposure maps flagged infrastructure to demo ₹ lakhs/crores so judges can see *business impact of cyber residual on city services*, including but not limited to finance. Exposure is scenario-based and labeled simulated—not measured real-world loss.

### What makes the system different

1. **Graph residual detector** (internal `tgnn*` modules): directed GNN encoder over a frozen checkpoint, idle-window calibrator, logistic residual score, then **hard gates**. User-facing copy should say “graph residual detector / anomaly score,” not Isolation Forest or literature Temporal Graph Network.
2. **Four-component trust** (Intrinsic 25% / Peer 30% / Behavioral 25% / Interaction 20%) as relational posture, separate from the anomaly score.
3. **Seed vs peer vs propagated** distinction: only TGNN anomaly seeds become executable incidents; neighbors are graph context.
4. **AI Commander as downstream decision support**, not the detector.
5. **Hard security boundary**: RAG and LLM text cannot invent or execute actions; only a registry + server policy can.

### What the Commander represents

The **AI Commander** is the operator-facing decision-support layer that sits *after* detection and incident promotion. It helps investigate evidence, attach optional knowledge guidance, present a deterministic advisory response plan, and surface registered actions for the Response Console.

### What “AI Commander” means in this implementation

| Capability | What it actually is |
|---|---|
| Live incident narrative (`POST /commander/explain`) | LLM (or template/Ollama fallback) **restatement** of Level-1 detector evidence. **No RAG** on this path. |
| Investigate UI sections | Mostly **deterministic** formatting of commander-context (evidence, graph, simulated finance). |
| Knowledge card | Optional **RAG** via `POST /commander/knowledge` when Qdrant is available (`npm start -- --with-rag`). Soft-fails if unavailable. |
| Respond plan (CONTAIN/PROTECT/VERIFY/RECOVER) | **Deterministic policy** in `shared/responsePolicy.js`, not LLM-authored execution. |
| Follow-up chat | Mix of deterministic fact answers and optional knowledge+LLM answers; informational only. |
| Lab `POST /commander/analyze` | Full LangGraph + RAG briefing path exists in `ai-com-v1`, but is **not wired into the live telemetry loop** in current match server code. |

### What the system can and cannot do

**Can:** simulate city telemetry; inject attack presets; detect residual anomalies with a frozen GNN encoder; compute trust; promote evidence-bearing incidents; sync state over Socket.IO; show simulated economic exposure; retrieve guidance from a local knowledge corpus when RAG is enabled; recommend advisory phases; execute **Isolate Node** / **Restore Connectivity** inside the simulator.

**Cannot:** control real city infrastructure; measure real financial loss; autonomously remediate; attribute attackers with certainty; guarantee production threat intelligence; invent telemetry when evidence is missing; let LLM/RAG execute quarantine.

### Simulated versus real

| Layer | Nature |
|---|---|
| Telemetry values, attack presets, city clock/context | **Simulated** (deterministic generators + multipliers) |
| Graph topology on live canvas | **Modeled** catalog type-graph + dependency edges (not live OT buses) |
| Timescale ingest | **Real persistence** of the simulated snapshots when tele-ingestion is up |
| GNN encoder | **Real ML inference** on a frozen checkpoint (not online training during demo) |
| Idle calibrator | **Deterministic** online statistics (Welford), not training |
| Trust, finance, policy, isolate/restore | **Deterministic** |
| Explain / knowledge answers | **LLM / RAG** when services are up; deterministic fallbacks otherwise |
| Quarantine | **Simulator state mutation** only |

### Conceptual view vs implementation-grounded view

**Conceptual:** Telemetry → features → graph residual scoring → trust → incidents → AI explanation → economic exposure → safe response → contain → recover.

**Implementation-grounded:** Attacker `sim:patch` / preset overrides → `buildCitySnapshot` every 1s → optional Timescale POST/GET overlay → `adaptCitySnapshot` → SQLite lookback → `runDetection` (`runTgnnAnomaly` + peer exposure + `propagateGraphRisk` + `promoteIncidents`) → SQLite incident upsert → Socket.IO `state:sync` → defender dashboard / Commander / Response Console → `POST …/commander/execute` → `setNodeQuarantined`.

---

## Section 2 — Complete System Workflow

```
┌──────────────┐   sim:patch / presets    ┌─────────────────────┐
│ Attacker UI  │ ───────────────────────► │ room.hackSimulator  │
└──────────────┘                          │   .nodeOverrides    │
                                          └──────────┬──────────┘
                                                     │
                     every TICK_MS=1000              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ server/telemetry/generator.js  emitTelemetryNow / ingestCitySnapshot     │
│  buildCitySnapshot → POST tele-ingestion → overlay → adaptCitySnapshot   │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Detection: features (14-d) → TGNN window K=3 → residual vs idle calibrator│
│ → hard gates → peerExposureFromFlags → propagateGraphRisk → promoteIncidents│
└───────────────────────────────────┬──────────────────────────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Persist SQLite incidents + attachExplanations + enqueue /commander/explain │
│ room.detection updated → publicRoomState → Socket.IO state:sync          │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    ▼
┌──────────────┐   focus incident    ┌─────────────────────────────────────┐
│ Defender UI  │ ──────────────────► │ commander-context + incident-intel  │
│ Overview /   │                     │ Investigate (facts+optional RAG)    │
│ Commander /  │                     │ Respond (deterministic plan)        │
│ Response     │ ◄── execute ────────│ Response Console → registry actions │
└──────────────┘                     └─────────────────────────────────────┘
```

### Stage-by-stage

| Stage | Trigger | Input | Processing | Output | Key files | Kind | Consumed by |
|---|---|---|---|---|---|---|---|
| Telemetry origin | Match playing; 1s loop | Room nodes, overrides, city context | Expected + jittered observed metrics; merge attack overrides unless quarantined | CitySnapshot | `server/telemetry/citySnapshot.js`, `shared/cityContext.js`, `shared/attackPresets.js` | Simulated / deterministic | Ingest + detection adapter |
| Ingest | Each tick | Snapshot | POST `/ingest/snapshot`; GET overlay | Timescale rows; `room.ingestedByEndpoint` | `tele-ingestion/`, `server/telemetry/ingestionClient.js` | Persistence | Overlay for detection |
| Feature extraction | Each tick | DetectionInput endpoints + deps | 14 CITY_FEATURE_KEYS frame | Feature matrix X | `shared/tgnnFeatures.js` | Deterministic | TGNN encoder |
| Graph residual (TGNN) | Each tick after warmup | Feature windows + adjacency | Frozen GNN forward; L2 vs idle; logistic score; spike twin; hard gates | `isolationScore`, `anomalyNodeIds` | `server/detection/tgnn.js`, `shared/tgnnCore.js`, `shared/tgnn_checkpoint.js` | ML + deterministic gates | Peer/propagation + incidents |
| Peer exposure | After seeds | Edges + anomaly seeds | Undirected 1-hop neighbors of seeds | `peerExposedNodeIds` | `shared/trustModel.js` `peerExposureFromFlags` | Deterministic | Incidents / UI / finance |
| Propagation | After seeds | Directed edges + seeds | BFS maxHops=3, decay 0.5 | `propagatedNodeIds`, paths, risk-by-node | `shared/graphPropagation.js` | Deterministic | Incidents / UI / finance |
| Incident promotion | After detection | Seeds only | Build Level-1 evidence, severity, trust blend | `detection.incidents` | `server/detection/incident.js` | Deterministic | Persist + explain + UI |
| Persistence | Each tick | Live incidents | Upsert open; clear stale | SQLite `incidents` | `server/metrics/incidents.js` | Deterministic | History + commander-context |
| Explain | Async after promote | Incident evidence body | LLM restatement or template | `summary` on incident | `server/commander/client.js`, `ai-com-v1` `/explain` | LLM / fallback | Incident lists / timeline |
| Commander context | Focus incident | Stored + live room | Assemble asset, evidence, graph, finance, policy | Context JSON | `server/metrics/incidents.js` commanderContextFor | Deterministic | Investigate / Respond / execute |
| Investigate | UI mode | Context | Format investigation; optional knowledge fetch | Investigation view + knowledgeContext | `shared/commanderIncidentIntel.js`, knowledge API | Deterministic + optional RAG | Operator understanding |
| RAG | Knowledge fetch / ask | Query from context or question | Embed → Qdrant → diversify → structure | Guidance bullets / answer | `ai-com-v1` RAG + knowledge routes | RAG ± LLM polish | Investigate only |
| Financial exposure | Detection / persist / Commander | Flagged node sets | Distinct-service lakhs sum | `exposureLabel`, breakdown, `simulated:true` | `shared/financialExposure.js` | Deterministic simulated | Overview + Investigate |
| Response plan | Respond mode | Context + profile | Advisory CONTAIN/PROTECT/VERIFY/RECOVER | Non-executable phases | `shared/responsePolicy.js` | Deterministic advisory | Respond UI |
| Response Console | Response panel | availableActions | Show registry ∩ policy | Executable buttons | `src/features/response/*` | Deterministic | Operator execute |
| Isolate | Execute isolate-node | Seed incident + live anomaly | Quarantine + clear override | `runtimeState.quarantined=true` | `server/response/executeAction.js`, `quarantineNode.js` | Deterministic sim action | Next telemetry ticks |
| Recovery / clear | Post-isolate ticks | Normalized telemetry | No re-seed while quarantined; closeStaleOpen | Incident status `cleared` | detection + incidents persist | Deterministic | Restore eligibility |
| Restore | Execute restore-connectivity | Prior Commander isolate + quarantined | Unquarantine | `quarantined=false` | executeAction + policy | Deterministic sim action | Healthy reconnect |

---

## Section 3 — Data Origin and Telemetry

### Where telemetry originates

Telemetry is **generated in the match server**, not read from real sensors.

Primary path:

1. `startTelemetryLoop` (`server/telemetry/generator.js`) when the DEMO room enters `playing`.
2. Every **1000 ms**, `emitTelemetryNow` increments `simulationTick` and calls `ingestCitySnapshot`.
3. `buildCitySnapshot(room)` produces expected and observed metrics per endpoint from catalog baselines, city context multipliers, deterministic jitter, and attack overrides.

### Schema (live / game metrics)

Four game keys (`shared/telemetryKeys.js`):

- `packetsPerSecond`
- `httpRequestsPerMin`
- `filesDownloaded`
- `failedLoginsPerMin`

Ingest snake_case aliases: `packets_per_second`, `http_requests_per_min`, `files_downloaded`, `failed_logins_per_min`.

YAML endpoints may list additional metric *names* for the city model. The encoder feature dimension is **frozen at 14**; `setCityYamlFeatureKeys` does not resize the checkpoint. Payment-related YAML metric names are catalog names, not live encoder channels.

### Device / node identity

Live canvas node ids are catalog type nodes of the form `ep-{assetType}` (for example `ep-banking_financial`). YAML city endpoint ids (kebab-case service ids such as `core-banking-system`) map through `shared/cityModel/endpointMap.js` and may appear as metadata (`cityEndpointId`).

### Normal vs abnormal behavior

- **Normal:** `expectedTelemetry` (no jitter) vs `observedTelemetry` (deterministic `jitterFactor(tick, nodeId, key)`), modulated by city context (`normal_day`, `rush_hour`, `night`, `weekend`, `heavy_rain`, `major_event`).
- **Abnormal (attack):** `hackSimulator.nodeOverrides[nodeId]` merges over observed metrics unless the node is quarantined (containment wins).

### Attack presets

Defined in `shared/attackPresets.js` and applied from the attacker UI via `sim:patch` / campaign helpers:

| Preset id | Effect (relative to baseline) |
|---|---|
| `traffic_flood` | PPS ×15 / large floor; modest HTTP lift |
| `data_exfiltration` | filesDownloaded spike; PPS/HTTP elevated |
| `api_abuse` | HTTP ×40 / large floor; PPS elevated |
| `credential_spray` | failedLogins ×50 / large floor; HTTP elevated |

### Timing / ticks

- Wall clock: ~1 second per simulation tick.
- City clock: `TRUST_CONFIG.cityContext` — `ticksPerHour: 8`, start hour 10, start weekday Thursday, rain/event schedules, rush/night bands.

### How telemetry reaches detection

Produced snapshot → optional Timescale POST → overlay from ingested values (fallback to produced if ingest patch empty / degraded) → `adaptCitySnapshot` → DetectionInput → lookback attach → `runDetection`.

If tele-ingestion is down, `room.ingestionStatus` can become `down`; the loop still attempts detection from the produced/overlaid snapshot. Full demo integrity prefers ingest healthy.

### Frontend synchronization

After each successful tick path (and on many room mutations), the server emits Socket.IO **`state:sync`** with `publicRoomState(room)` (`server/roomStore.js`). The client (`src/multiplayer/useGameRoom.js`) replaces local room state from that payload. Fleet metrics may also poll HTTP metrics endpoints; the authoritative match picture is still `state:sync`.

### Lifecycle of one telemetry tick

1. `simulationTick += 1`
2. Build expected/observed snapshot for all endpoints; apply overrides; respect quarantine
3. Ensure infrastructure registration; POST snapshot; refresh ingested overlay
4. Map live telemetry for UI
5. Adapt → append SQLite lookback → attach neighbor lookback
6. Run detection + risk momentum
7. Attach cached explanations; persist incidents; save detection run
8. Set `room.detection`; enqueue async explain jobs
9. `onAfter(room)` → broadcast `state:sync`

---

## Section 4 — City / Graph Model

### Live graph (what the demo canvas shows)

`shared/cityModel/liveGraphTypes.js` freezes **40** live types. `src/features/graph/cityModel.js` builds the dependency graph: one node per live type (`ep-{type}`), edges from filtered `CITY_DEPENDENCIES` plus YAML dependency overlay when both ends map.

**Important:** Older architecture notes mention “~69 catalog nodes.” **Current live code uses 40 live types.** The full `assetCatalog.js` is larger (~80+ sector entries) but not all appear on the live match canvas.

Live types include power/water/transport/telecom/government/education/healthcare/emergency/public-safety and finance endpoints such as `banking_financial`, `bank_gateway`, `payment_processing_system`, `digital_banking_platform`, `atm_network_gateway`.

### YAML / static topology

`overfit/city_model/` (folder typo alias `infrastructue` supported) loads via `server/loadCityModel.js`:

- **54** infrastructure YAML endpoints (object keyed by id)
- **114** dependencies in `dependencies/city-dependencies.yaml`
- Contexts, actors, multipliers

YAML feeds mappings, metric name lists, context overlays, and optional edge overlay. It is **not** the sole React Flow node set for the live match.

### Edges, peers, propagated nodes, critical dependencies

- **Edges:** directed dependency / communication relationships used by interaction trust, TGNN adjacency, peer exposure, and propagation.
- **Peers (trust / exposure):** undirected 1-hop neighbors of anomaly seeds (`peerExposureFromFlags`). Peer-exposed nodes are **not** independently confirmed anomalous.
- **Propagated:** directed multi-hop risk from seeds (`propagateGraphRisk`, max 3 hops, decay 0.5). Assessment/exposure context, not separate executable incidents.
- **Critical dependencies (finance helper):** count of high/critical-criticality neighbors of the flagged set along existing edges.

### How the graph is used downstream

| Consumer | Use |
|---|---|
| Detection features | Degrees, neighbor risk, upstream/downstream stress, peer trust features |
| TGNN | Directed in/out mean pooling over adjacency |
| Trust | Peer component = min of neighbor local posture |
| Incidents | Seed-scoped peer/propagated sets and paths on the seed incident |
| Financial exposure | Flagged ids (seeds ∪ peers ∪ propagated ∪ …) map to services |
| Commander Investigate | Graph impact narrative from those sets |
| Response | Isolate acts on seed node; exposure-only contexts cannot execute |

### Live graph vs simulated telemetry

Topology is a fixed modeled graph for the session. Telemetry and quarantine are runtime state layered onto that graph. Campaign/story layers must not invent topology edges that are not real dependencies.

---

## Section 5 — Detection and ML / TGNN Layer

### Models in use

One primary detector path: **graph residual encoder** (code names `tgnn*`).

- Checkpoint: `shared/tgnn_checkpoint.js` (`fromCheckpoint: true`; trained offline via `npm run train:tgnn` / scripts—not online learning in the match loop).
- Fallback: sin-seed weights if checkpoint shape mismatches.
- Idle calibrator: Welford stats over warmup ticks (**15**), skips whole tick calibration while any attack override is active.
- **No Isolation Forest** in the live path despite historical JSON field name `isolationScore` (residual alias).

### Input features (14 channels)

From `shared/tgnnFeatures.js` `CITY_FEATURE_KEYS`:

`telemetryDeviation`, `behavioralDeviation`, `runtimeRisk` (**hardcoded 0 in current feature extraction**), `intrinsicTrust`, `peerTrust`, `interactionTrust`, `criticality`, `inDegree`, `outDegree`, `neighborRisk`, `upstreamStress`, `downstreamStress`, `activityDeviation`, `contextLoad`.

### Temporal and graph reasoning inside the encoder

- Temporal window **K=3** frames concatenated (`TRUST_CONFIG.tgnn.temporalWindow`).
- Embed dim **8**.
- Directed **2-hop** in/out mean pooling, then temporal projection.
- Output embedding compared (L2) to idle baseline embedding → logistic score (`scoreAlpha=4.5`, `scoreZOffset=1.25`).
- Metric-spike twin: if any metric deviation ≥ **0.5**, take max with spike-frame residual score.

The encoder does **not** “learn” during the demo. It **infers** residual distance of the current graph-featured window versus the idle calibrator / baseline twin. Downstream hard gates decide anomaly labels.

### Anomaly classification thresholds

From `TRUST_CONFIG.tgnn` / `classifyTgnnScores`:

| Knob | Value |
|---|---|
| `anomalyScoreThreshold` | 0.58 |
| `relativeMinScore` | 0.5 |
| `minScoreGap` | 0.04 |
| `minSpread` | 0.06 |
| `minDeviationRatio` | 0.1 |
| `metricSpikeDeviationRatio` | 0.5 |
| `smallGraphMinScore` | 0.55 if N &lt; 3 |
| `minNodesForFullClassify` | 3 |

Quarantined nodes keep a residual score for explainability but **are not re-seeded** as anomalies.

### Trust / risk (related but distinct)

**Trust blend** (`shared/trustModel.js`, weights in `trustConfig`): Intrinsic 25%, Peer 30%, Behavioral 25%, Interaction 20%. Caps for injected/quarantined intrinsic. Peer aggregate = **min** of neighbors.

**Risk momentum** (`shared/riskMomentum.js`): overlay converting peak residual to 0–100 score, trajectory labels—not a second detector. Used by Overview / financial residual bands (HIGH ≥70, ELEVATED ≥45).

### Propagation vs seed

- **Seed / origin:** `anomalyNodeIds` from TGNN gates → only these promote to incidents; `compromisedNodeIds` mirrors seeds in `runDetection`.
- **Peer-exposed:** 1-hop neighbors.
- **Propagated:** multi-hop attenuated risk.
- `atRiskNodeIds` = union of peer-exposed and propagated (UI convenience).

### How an incident is promoted

`promoteIncidents` iterates **only** `anomalyNodeIds`, builds evidence (`tgnn_embed`, metric deviations, peer trust drop, neighbor set change, criticality, edge PPS, dependency interaction), severity/confidence from config bands, and attaches seed-scoped graph context. Peer/propagated nodes do **not** become separate executable incidents in current code (even if some intel helpers still mention secondary incident concepts).

### What TGNN does / does not claim

| Claims supported by code | Not supported |
|---|---|
| Frozen supervised-trained weights exist and are loaded | Online training / continual learning in match |
| Residual vs idle embedding + gates | Pure end-to-end learned “attack class” labels |
| Graph-aware features and pooling | Literature TGN temporal message-passing product claims |
| Score field `isolationScore` as residual alias | Isolation Forest algorithm |

---

## Section 6 — Incident Lifecycle

### Detection → promotion → identity

1. Detection marks seeds.
2. `promoteIncidents` builds structured incidents with Level-1 numeric evidence.
3. Live id pattern: `inc-{endpointId}` (`live_incident_id` in SQLite).
4. Persistent `incident_id` rows upserted per room.

### Open / cleared

Statuses in `shared/incidentIntel.js`: **`open`** | **`cleared`** only.

Each tick, `persistDetectionIncidents` upserts currently promoted incidents as open and **`closeStaleOpen`** marks previously open rows not in the current set as cleared. Match start clears persisted history for the room (`clearPersistedIncidentHistory`).

### Persistence and snapshots

SQLite `incidents` table stores evidence JSON, graph context JSON, financial context JSON, actions_taken JSON, severity, scores, timestamps (`server/metrics/store.js`).

### Stale handling and history

- Stale open → cleared when seed no longer promoted.
- History APIs list past incidents for timelines; optional campaign correlation helpers exist in SQLite tables.
- **Campaign objects are not broadcast** on `state:sync` (`campaigns: []` in public state). Automated campaign analyze enqueue is present in the Commander client but **not called from the live telemetry generator** in current code.

### State synchronization and refresh

- Live detection sits in memory on the room and rides `state:sync`.
- Browser refresh: if the Node process still holds the DEMO room, the client rejoins and receives current state; SQLite still has incident history.
- If the room process is gone / empty room deleted, live match state does not survive; SQLite history may still exist on disk.
- Follow-up chat is React state only—**does not survive refresh**.

### Live detection vs persisted incident vs Commander context

| Concept | Meaning |
|---|---|
| Live detection | `room.detection` this tick (scores, seeds, peers, live incidents array) |
| Persisted incident | SQLite row with status, evidence snapshot, actionsTaken, financial_context |
| Commander context | Assembled view for one incident id: merges stored + live quarantine + availableActions + finance recompute helpers |

---

## Section 7 — AI Commander

### Architecture

```
Detection incidents
    ├─ enqueueIncidentExplanations → ai-com-v1 POST /commander/explain  (LLM, no RAG)
    └─ UI focus
           ├─ GET  /rooms/:id/incidents/:id/commander-context   (deterministic)
           ├─ POST /rooms/:id/commander/incident-intel          (+ optional knowledge)
           ├─ POST /rooms/:id/commander/ask                     (follow-up)
           └─ POST /rooms/:id/commander/execute                 (registry only)
```

Python service (`ai-com-v1`): FastAPI routes for explain, analyze, knowledge, knowledge/ask, ask, posture, health.

Match server client (`server/commander/client.js`): HTTP proxy, explanation cache, knowledge cache (TTL 120s for successful retrieves), health probe cache (~5s), circuit breaker (~15s open on hard failures), queue limits (max 1 in-flight, max 5 queued).

### Investigate vs Respond

- Modes: `investigate` | `respond` (`shared/commanderIncidentIntel.js`).
- Investigate: summary, why suspicious (evidence), graph impact, simulated finance, related; knowledge attached separately.
- Respond: advisory phases from `buildAdvisoryResponsePlanPhases` / `buildResponsePolicy`—deterministic.
- UI resets to Investigate on focus change (`CommanderPanel.jsx`). Follow-up input is Investigate-oriented.

### Deterministic vs LLM

| Piece | Kind |
|---|---|
| commander-context, Investigate body, Respond plan, availableActions | Deterministic |
| explain summaries | LLM (template / optional Ollama fallback) |
| knowledge bullets | RAG chunks; deterministic structure by default; optional LLM polish if `KNOWLEDGE_LLM_STRUCTURE=1` |
| knowledge follow-up answers | LLM preferred with template fallback |
| fact follow-ups | Deterministic `shared/commanderAsk.js` |
| execute | Deterministic registry + policy |

### Failure behavior

- Explain failure → template fallback; may open circuit.
- Knowledge soft-fail → `retrieved:false`; **does not** open the hard circuit the same way.
- Health on Commander `/health` is **process up only**—does not prove Qdrant or LLM readiness.
- Match `/health` probes ingest + Commander health.

### Lab analyze path (present but not live-wired)

`POST /commander/analyze` runs LangGraph (plan → retrieve → sufficiency → assess → safety). OT/ICS keyword safety + rewrite exist on that path. Calling analyze with only `incident_id` hits `MockDetectionAdapter`—must not be demoed as live detection. Campaign analyze enqueue is **not** in the live tick loop today.

---

## Section 8 — Investigate Mode

### What the operator sees

From `buildIncidentInvestigation` and related UI (`IncidentCommanderAgent`, EvidenceCards, GraphImpactPanel, FinancialExposureCard, KnowledgeCitation, follow-up):

- **Incident summary** — type, asset, severity, confirmed anomalous origin wording.
- **Evidence** — Level-1 lines from anomalyEvidence (observed vs expected, deviations, codes). Does not invent telemetry if empty.
- **Graph / risk** — confirmed anomaly asset; peer exposure count (not independently confirmed); propagated risk count; optional path labels; trust/risk numbers when present.
- **Financial / economic impact** — simulated exposure label and narrative; always framed as not actual loss.
- **Knowledge / RAG card** — guidance when retrieval succeeds; degraded/unavailable messaging when not.
- **Follow-up chat** — suggested questions + free text (Investigate).
- **Related incidents** — contextual summaries when present.

### Context maintenance

Focus incident id drives fetch of commander-context and incident-intel. Sync keys (`commanderIntelSyncKey`) avoid stale intel overwrite. Mode and follow-up messages reset appropriately on incident change.

### When RAG or Commander is unavailable

- RAG down: Investigate still shows detector evidence, graph, finance; knowledge section soft-fails.
- Commander explain down: incidents still promote; summaries fall back to templates; Investigate facts remain from upstream evidence.
- Operator can still open Response Console for registry actions if policy allows—execution does not require LLM success.

### What the operator should understand

Investigate answers: what changed, which asset is the seed, what numeric evidence exists, who is peer-exposed vs propagated, what simulated economic services are implicated, and what external guidance documents say—without claiming RAG proved the attack or executing containment.

---

## Section 9 — RAG / Knowledge System

### Pipeline

```
Corpus (PDF/JSON) → process to data/processed/*.json
  → chunk + metadata → LocalEmbeddingProvider (all-MiniLM-L6-v2, 384-d)
  → Qdrant collection ai_commander_knowledge_v1 (cosine)
  → retrieve (top_k≈3 live knowledge) → diversify (max_chunks≈5)
  → optional LLM structure (off by default) → KnowledgeContext
  → strip forbidden keys → Commander UI
```

### Corpus discoverable on disk (`ai-com-v1/data/processed/`)

Examples present at audit time: NIST SP 800-61r3, 800-82r3, IR 8259*, SP 1500-201; ICS incident response PDF; MITRE ICS ATT&CK (`ics-attack.json`); CERT-In / India IRPF and CIGU documents; Designed-In Security for Smart City; ETSI en_303645; a news PDF. Whether a given demo’s Qdrant instance is fully ingested depends on operators running ingest and `--with-rag`. Full Enterprise MITRE corpus beyond ICS is **not clearly present** as a separate processed dump in that folder listing.

### Retrieval behavior

- Live knowledge uses diversified selection across sources.
- Filters can include category when planned.
- Soft-fail returns `retrieved:false` without crashing Investigate.
- Knowledge cache on match server for successful retrieves (~120s).

### Security boundary — RAG is guidance only

Multiple layers prevent knowledge from becoming executable actions:

1. `/commander/knowledge` API contract: knowledge-only.
2. `FORBIDDEN_KNOWLEDGE_KEYS` / `strip_forbidden_keys` remove `responsePlan`, `actionId`, `execute`, `quarantine`, etc.
3. Prompts forbid emitting plans/actions.
4. Server `normalizeKnowledgePayload` strips plan/execute fields.
5. `attachKnowledgeContext` / incident-intel **reverts plan** if RAG mutated it.
6. Execute path only accepts registered `actionId`s via `executeResponseAction`.

**RAG does not create or execute response actions.**

Default stack (`npm start`) does not require Qdrant. RAG is optional via `npm start -- --with-rag`.

---

## Section 10 — Follow-up Chat

### Flow

1. Operator enters a question (or picks a suggestion) in Investigate.
2. UI POSTs `/rooms/:id/commander/ask` with `{ question, incidentId }` only—**no action fields** (`commanderFollowUp.js`).
3. Server routes:
   - If `isKnowledgeFollowUpQuestion(q)` → `askWithKnowledge` (live facts + RAG + LLM answer).
   - Else → `answerCommanderQuestion` in `shared/commanderAsk.js` (deterministic keyword answers over snapshot/context).
4. Answer is informational; `followUpResponseIsInformationalOnly` guards against executable fields.

### Grounding and prohibitions

- Model/context receives commander-context live facts and, for knowledge asks, retrieved chunks.
- Must not invent telemetry, MITRE execution claims, or actionIds.
- Different from main incident analysis: narrower Q&A turn; does not replace Level-1 evidence; does not drive Response Console.

### State

Conversation held in component state; cleared when `incidentId` changes; not persisted; not restored from `state:sync`.

Suggested prompts include evidence, financial exposure, why not isolate every propagated node, and finance-at-risk style questions.

---

## Section 11 — Financial / Economic Exposure

### Why it exists

To connect cyber residual on **city infrastructure** to an understandable **business impact** signal for operators and FinTech-oriented judges—without claiming measured accounting loss.

### Broader than finance-only

`SERVICE_LAKHS` maps finance *and* energy, water, transport, telecom, government, healthcare, emergency/public safety services. A power-grid anomaly can raise simulated exposure even when no bank node is the seed, if mapped services appear in the flagged set (including peers/propagated as configured).

### Calculation (deterministic, simulated)

`computeFinancialExposure` (`shared/financialExposure.js`):

1. Collect flagged ids: anomalies ∪ compromised ∪ atRisk ∪ peerExposed ∪ propagated ∪ incident endpoints.
2. Map each node → canonical service via `TYPE_TO_SERVICE` / YAML / id helpers (`economicServiceKey`).
3. **Deduplicate by service key**; sum lakhs once per distinct service.
4. Format with `formatInrLakhs` → `₹N L` or `₹X Cr` (≥100 L).
5. Residual band from risk momentum score: HIGH ≥70, ELEVATED ≥45.
6. Count critical-dependency neighbors.
7. Always set `simulated: true`.

### When exposure increases / decreases

- Increases when more mapped services enter the flagged set (attack seeds + graph exposure).
- After isolate: seed leaves anomaly set (quarantined not re-seeded); `currentExposureForIncident` prefers **live** seed/peer/propagated sets and can fall to **₹0** current while preserving historical peak snapshot.
- Cleared incidents: current exposure forced to ₹0 with optional historical peak retained for timelines.

### Commander vs Overview

Overview uses city-wide `computeFinancialExposure` on current detection. Commander incident view uses `currentExposureForIncident` for seed-scoped live recompute plus stored financial_context at persist time.

### Pitch significance

These are **simulated scenario-based economic exposure estimates, NOT actual financial losses.** They let the demo say: cyber residual on interconnected city services has quantifiable *illustrative* economic consequence, including municipal payments and banking paths, while remaining honest about simulation.

Separate illustrative field on some incidents: `illustrativeImpact = maxDev * criticalityFactor` (not ₹).

---

## Section 12 — Response Planning

### Response Plan vs Response Actions

| | Response Plan | Response Actions |
|---|---|---|
| What | Advisory CONTAIN / PROTECT / VERIFY / RECOVER phases | Registry entries `isolate-node`, `restore-connectivity` |
| Source | `buildAdvisoryResponsePlanPhases` / profile text | `shared/responseActions.js` |
| Executable? | **No** (`executable: false` semantics on plan steps) | **Yes**, only after policy ∩ registry ∩ server revalidation |
| Who writes it | Deterministic policy templates by profile | Frozen registry constants |

### Profile classification

`classifyResponseProfile` precedence: PROPAGATED_EXPOSURE → credential → exfil → API abuse → traffic flood → OT → finance → general residual. Strong metric signature threshold: **80%** abs deviation. Works without persisted presetId (preset not reliably on incidents).

### Why the plan does not execute infrastructure changes

Plans are operator guidance. Security-sensitive mutations must pass explicit action ids, seed constraints, and server-side revalidation so LLM wording cannot quarantine nodes by accident.

### Why deterministic policy for sensitive actions

Containment changes simulator security state (and would be dangerous if pointed at real OT). Deterministic policy keeps eligibility explainable, testable, and independent of model drift.

---

## Section 13 — Response Actions

### Registry (only two executable actions today)

#### Isolate Node (`isolate-node`)

- **Purpose:** Contain the confirmed anomalous seed; stop attack override influence on that node.
- **Eligibility:** Confirmed seed incident (not exposure-only); target in live `anomalyNodeIds` when seeds exist; listed in policy recommendedActions ∩ registry.
- **Execution:** `POST /rooms/:id/commander/execute` → `executeResponseAction` → `setNodeQuarantined(room, id, true)` → clears that node’s `nodeOverrides`.
- **State:** `runtimeState.quarantined = true`; action recorded in `actionsTaken` (`EXECUTED` or `ALREADY_EXECUTED`).
- **Idempotency:** Re-quarantine of already quarantined → ALREADY_EXECUTED.
- **Alternate path:** Socket `defender:quarantine` can set quarantine without Commander action history (Restore still requires prior **Commander** isolate record).

#### Restore Connectivity (`restore-connectivity`)

- **Purpose:** Unquarantine after recovery conditions.
- **Eligibility:** Prior Commander isolate record (`EXECUTED`/`ALREADY_EXECUTED`) for that node; node currently quarantined (policy); not exposure-only.
- **Execution:** `setNodeQuarantined(..., false)`.
- **Does not** restore attack overrides—attacker must re-apply a preset to re-attack.
- **Why not arbitrary:** Server re-checks prior isolate + quarantine; client `availableActions` is not trusted (`contextForPolicy` merges live room state).

### Complete isolate → restore chain

1. Isolate executes → quarantine + override clear.
2. Next ticks: telemetry normalizes (no override); quarantined node not re-seeded.
3. Incident drops from live promotion → SQLite open row cleared via `closeStaleOpen`.
4. Exposure current → ₹0 when seed no longer anomalous.
5. Restore becomes eligible while quarantined + prior isolate.
6. Restore unquarantines; node rejoins normal graph participation.
7. Action history retained on incident record.

---

## Section 14 — Security Boundaries

Architectural invariants visible in code:

1. **Detection does not execute actions** — it only scores and promotes incidents.
2. **RAG does not execute actions** — knowledge APIs strip plan/action keys.
3. **LLM does not directly execute actions** — explain/ask/analyze text never calls `setNodeQuarantined`.
4. **Response plan does not execute actions** — advisory phases only.
5. **Policy validates** which actionIds may be recommended.
6. **Action registry** is the only catalog of executable ids.
7. **Server revalidates** on execute (seed, exposure, prior isolate, live anomaly membership).
8. **Client availability state is not trusted** — server rebuilds policy context from room + SQLite.
9. **Quarantine changes** go through response execution helpers (or explicit defender quarantine socket)—not through RAG/LLM payloads.

**Why it matters:** Judges can trust that “AI recommended” never silently becomes “AI shut the substation.” The demo remains decision-support with human-triggered, policy-gated simulator containment.

---

## Section 15 — Frontend Architecture

### Major surfaces

| Surface | Role | Key paths |
|---|---|---|
| Game / map | Two-role DEMO session; React Flow city graph | `GamePage.jsx`, `GraphCanvas.jsx` |
| Attacker tools | Apply presets / patches when playing | attack preset UI, `sim:patch` |
| Defender dashboard | Overview, Commander, Fleet, Incidents, Response | `DashboardPage.jsx`, `dashboardPanels.js` |
| Overview | Posture, blast, finance, momentum | `OverviewPanel.jsx`, finance/risk cards |
| Commander | Investigate / Respond, knowledge, follow-up | `CommanderPanel.jsx`, `IncidentCommanderAgent.jsx` |
| Response Console | Execute registered actions | `ResponseConsole.jsx`, `ResponseConsolePanel.jsx` |
| Incidents | Promoted detections / history | `IncidentsPanel.jsx`, timelines |
| Fleet | Per-endpoint metrics vs expected | `EndpointTable.jsx` |
| Inspector | Node detail | `InspectorPanel.jsx` |

Routing: `/` and `/play` → `GamePage`. `/play/:roomId` redirects to `/play` (not a multi-room SaaS product). Dashboard is a defender view query (`?view=dashboard&panel=…&incident=…`).

### State reception

- Socket.IO `state:sync` → room nodes/edges, hackSimulator, detection, tick, cityContext, ingestionStatus, liveTelemetry, commanderBriefing/cityPosture fields as present.
- HTTP for commander-context, incident-intel, ask, execute, metrics.
- Simulation ticks drive continuous refresh of detection-backed UI.
- Intel re-fetch keyed to incident + sync key helpers when focus/detection changes.

---

## Section 16 — Backend Architecture

### Match server (`server/`)

| Module | Purpose | Inputs | Outputs | Does NOT |
|---|---|---|---|---|
| `telemetry/` | Tick loop, snapshot, ingest client | Room state | Snapshots, detection trigger | Real sensor ingest |
| `detection/` | TGNN, calibrator, engine, incidents promote, risk momentum | DetectionInput | detection result | Execute containment |
| `metrics/` | SQLite lookback, runs, incident persist, commander-context | Room + detection | Persisted rows, context | LLM calls |
| `commander/client.js` | Explain/knowledge/ask HTTP + caches/circuit | Incidents / queries | Summaries, knowledge | Mutate quarantine |
| `response/` | executeAction, quarantineNode | actionId + context | Room mutation + action records | Invent new action types |
| `campaign/engine.js` | Preset apply / clear overrides | Preset requests | nodeOverrides changes | Full automated campaign SOC product on public sync |
| `roomStore.js` | In-memory DEMO room | Joins / patches | publicRoomState | Multi-tenant rooms |
| `index.js` | Express + Socket.IO routes/events | HTTP/WS | APIs + sync | — |

### Tele-ingestion (`tele-ingestion/`)

Purpose: validate and persist CitySnapshot telemetry into TimescaleDB; expose query/overlay. Does not run TGNN or Commander.

### AI Commander (`ai-com-v1/`)

Purpose: explain, optional knowledge RAG, lab analyze LangGraph, provider abstraction (Ollama/Groq). Does not own match room state or quarantine.

---

## Section 17 — Database / Persistence

| Store | Technology | Holds | Survives refresh | Survives process restart |
|---|---|---|---|---|
| Room / live detection / players / tick | In-memory Map | Match runtime | If server room still alive | No |
| Lookback, detection runs, incidents, campaigns tables | SQLite `server/data/metrics.sqlite` | Operational + incident history | Yes via API | Yes (file) |
| Telemetry time-series | TimescaleDB via tele-ingestion | Ingested metrics | Yes if DB up | Yes |
| Qdrant vectors | Qdrant (+ local storage under ai-com-v1 when used) | Embeddings | N/A to browser | Yes if storage kept |
| Explanation/knowledge caches | Process memory | Perf cache | N/A | No |
| Follow-up chat | React state | Q&A turns | **No** | No |
| Graph editor draft | localStorage (`graphIO.js`) | Canvas draft | Yes (browser) | Yes (browser) — not match authority |

**Intentionally recomputed each tick:** residual scores, peer/propagation sets, live incidents list, risk momentum, current financial exposure views.

**Persisted snapshots:** evidence/graph/finance JSON at promotion time; actionsTaken across clears as updated.

Match start resets lookback samples, incident history for room, explanation cache, calibrator-related room detection state.

---

## Section 18 — Complete Attack Walkthrough

Example using **current** implementation (credential spray on a live finance-mapped node; any preset follows the same machinery):

1. **City healthy** — Match playing; warmup ticks accumulate idle calibrator (attacks during warmup skip calibration). Residual nominal; no open incidents; exposure ₹0.
2. **Attack preset begins** — Attacker applies `credential_spray` (or other) to a node → `nodeOverrides` via `sim:patch` / preset helper.
3. **Telemetry changes** — Observed failed logins / HTTP (per preset) spike vs expected; snapshot shows deviation.
4. **Detection notices anomaly** — After calibrator ready, TGNN residual rises; drift + gates mark seed in `anomalyNodeIds`.
5. **Seed identified** — Seed id is the overridden endpoint that passed gates (not quarantined).
6. **Peer / propagation calculated** — Neighbors flagged peer-exposed; BFS up to 3 hops fills propagated sets/paths.
7. **Incident promoted** — `inc-{endpointId}` with Level-1 evidence; severity/confidence; trust blend; SQLite open upsert; explain enqueued.
8. **Economic exposure increases** — Distinct mapped services in flagged set sum to simulated ₹ label on Overview/Commander.
9. **Commander analyzes** — Focus incident → Investigate shows evidence/graph/finance; explain summary may appear from LLM/template.
10. **RAG retrieves guidance** — If `--with-rag` and Qdrant populated, knowledge card shows standards/playbook guidance; else soft-degraded.
11. **Response plan generated** — Respond mode shows profile-specific CONTAIN/PROTECT/VERIFY/RECOVER advisory text; `isolate-node` recommended for seed.
12. **Operator executes Isolate Node** — Response Console → execute → quarantine + clear override; action logged.
13. **Node quarantined** — Graph/runtime shows contained; intrinsic trust capped when quarantined.
14. **Graph/telemetry recovers** — Without override, metrics return toward expected; quarantined node not re-seeded.
15. **Incident clears** — Live promotion empty for that seed → SQLite status `cleared`; current exposure → ₹0 (historical peak retained).
16. **Restore becomes eligible** — Policy sees prior Commander isolate + still quarantined.
17. **Operator executes Restore Connectivity** — Unquarantine.
18. **Node reconnects** — Participates normally in trust/graph features again.
19. **Attack override remains cleared** — Re-attack requires a new attacker action.
20. **Healthy state** — Residual/gates quiet; no open seed incidents; demo loop ready for another scenario.

---

## Section 19 — Failure and Recovery Behavior

| Condition | Behavior |
|---|---|
| Python Commander unavailable | Explain falls back to templates; circuit opens briefly; detection/incidents/finance/isolate still work |
| Qdrant unavailable / RAG fail | Knowledge `retrieved:false`; Investigate facts remain; no fake citations |
| LLM structuring fail | Deterministic chunk structuring still usable; optional polish skipped |
| Telemetry continues while RAG down | Tick loop independent of RAG |
| Frontend refresh | Rejoin socket; live state if room alive; chat lost; history from SQLite |
| Incident clears | Status cleared; current finance ₹0; restore path depends on quarantine + prior isolate |
| Action repeated | Idempotent ALREADY_EXECUTED where applicable |
| Invalid action | HTTP 400 from server (unknown, not available, exposure-only, not live seed, missing prior isolate) |
| Ingest down | `ingestionStatus` degraded/down; overlay may use produced telemetry; demo prefers ingest up |
| Calibrating / warmup | Anomaly promotion suppressed or limited until idle window ready; UI can show calibrating |

Graceful degradation preserves **security boundaries**: failures do not unlock free-form LLM execution.

---

## Section 20 — Technology Stack

| Layer | Technology | Role in this repo |
|---|---|---|
| Frontend | React 19, Vite 8, Tailwind 4, React Router 7 | Operator/attacker UI |
| Graph UI | `@xyflow/react` | City topology canvas |
| Charts / icons | Recharts, Lucide | Dashboard visuals |
| Realtime | Socket.IO client/server | `state:sync`, sim/defender events |
| Match API | Node ESM, Express 5 | Rooms, detection orchestration, Commander proxy, execute |
| Shared contracts | Plain JS modules in `shared/` | Trust, TGNN features/core, finance, policy, intel |
| ML inference | Custom JS GNN encoder + frozen checkpoint | Graph residual scores |
| Operational DB | better-sqlite3 | Lookback, incidents, campaign tables |
| Telemetry DB | PostgreSQL + TimescaleDB (`tele-ingestion`, `pg`, Zod) | Time-series ingest |
| AI Commander | FastAPI, Uvicorn, Pydantic | Explain / knowledge / analyze service |
| Agent lab path | LangGraph, LangChain core, Groq & Ollama integrations | `/analyze` workflow |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` | RAG vectors (384-d) |
| Vector DB | Qdrant | Knowledge retrieval (optional) |
| Local LLM | Ollama `qwen2.5:7b-instruct` (default) | Commander generation |
| Optional cloud LLM | Groq (`openai/gpt-oss-20b` when configured) | Primary provider with Ollama fallback |
| City model | YAML (`yaml` package) | Reference topology/contexts |
| Tooling | concurrently, eslint, node:test, pytest (ai-com-v1), docker compose scripts | Dev/test/start stack |
| Start orchestration | `scripts/start-stack.mjs` | One-command demo bring-up |

Technologies merely present in lockfiles but not meaningfully driving the product path are omitted.

---

## Section 21 — Key Design Decisions

| Decision | Why it matters | How implemented |
|---|---|---|
| Deterministic security policy for actions | Prevents model drift from containing wrong nodes | `responsePolicy` + registry + server execute revalidation |
| Separate RAG knowledge path | Guidance ≠ actuation | `/knowledge` strip keys; plan revert; execute isolated |
| Seed vs propagated distinction | Avoids treating exposure as confirmed compromise | `promoteIncidents` seeds only; exposure incidents non-executable |
| Graph residual + hard gates | Graph-aware score with controllable demo false positives | TGNN forward + `classifyTgnnScores` |
| Four-component trust | Relational posture story distinct from anomaly score | `blendTrust` weights 25/30/25/20 |
| Simulated economic exposure | FinTech-relevant impact without fake real losses | Lakhs catalog + `simulated:true` |
| Simulated telemetry | Reproducible demo chain | Generator + presets + tick clock |
| Graceful RAG failure | Demo survives without Qdrant | Soft-fail knowledge; default start without RAG |
| Server-side action validation | Client cannot self-authorize isolate/restore | `executeResponseAction` ignores trusted client availability |
| Isolate clears override; restore does not restore attack | Containment is real in-sim; no silent re-infect | `clearNodeAttackOverride` only on quarantine true |
| Quarantined nodes not re-seeded | Stops open↔cleared thrash | Gate in `runTgnnAnomaly` |
| Live explain without RAG | Fast SOC narrative grounded in detector evidence | `/explain` path; knowledge optional on focus |
| Single DEMO two-role room | Hackathon clarity over multi-tenant SaaS | In-memory room; `/play/:roomId` redirect |
| Frozen encoder dim 14 | Checkpoint stability | `setCityYamlFeatureKeys` no-op |

---

## Section 22 — Demo / Pitch Operational Knowledge

### What the audience sees first

A living city graph (defender + attacker roles). Healthy nodes, expected telemetry bands, idle calibrator warming. Dashboard Overview shows nominal residual/exposure.

### Healthy city

Low residual, empty anomaly seeds, open incident count zero, simulated exposure ₹0, trust posture stable, no quarantine badges.

### When an attack starts

Attacker applies a preset; metric spikes appear on the target; residual climbs; seed highlights; peers/propagated light up as exposure—not as separate confirmed incidents.

### Detection becomes an incident

Gates fire → promoted incident with numeric evidence → appears in Incidents / Commander → optional LLM one-line restatement.

### Impact becomes visible

Blast radius counts, trust drops on affected posture, **simulated ₹ exposure** rises as mapped services enter the flagged set—business language on top of cyber residual.

### Commander helps investigate

Operator opens Investigate: evidence, path, peer vs seed clarity, finance narrative, optional authoritative guidance from NIST/ICS/CERT-style corpora.

### RAG adds guidance

Shows what standards/playbooks say about similar situations. Explicitly guidance—not proof of attacker identity, not an execute button.

### Economic exposure communicates business impact

Judges see why a smart-city cyber event matters to financial and civic continuity **without** claiming actuarial loss numbers.

### Planning vs execution

Respond mode teaches the playbook phases. Response Console is where Isolate actually runs—human-triggered, policy-gated.

### Isolation contains the attack

Override clears; telemetry normalizes; seed stops promoting; exposure current collapses; incident clears.

### Recovery

Restore Connectivity after Commander isolate record; node returns; system ready; integrity of “contain then restore” is visible.

### What proves the system worked

Traceable chain: preset → metric deviation → residual/gates → evidence incident → (optional) knowledge → advisory plan → registry isolate → clear → restore. Every step inspectable in UI or logs without fabricated telemetry.

---

## Section 23 — Implementation Truth / Boundaries

### Current Implementation Boundaries

The current repository does **not** claim or implement:

- Actual physical or network control of real city infrastructure, PLCs, breakers, or firewalls outside the simulator
- Real financial loss measurement, insurance modeling, or production transaction monitoring feeds
- Real DLP, EDR deployment, or packet-capture forensics pipelines
- Automatic remediation without an operator executing a registered action
- Autonomous attack response / self-driving SOC
- Guaranteed attribution of a human adversary
- Production-grade live threat-intelligence subscription feeds
- Real-world sensor hardware attached to this demo
- Multi-room multi-tenant SaaS matchmaking (`/play/:roomId` is not a room product)
- Live-path LangGraph `/analyze` campaign briefing wired into every telemetry tick (code exists; live generator does not enqueue it; public `campaigns` sync is empty)
- RAG on the live `/explain` path
- Encoder online learning during the match
- Expanding TGNN input dim with YAML payment metric channels
- Executable actions beyond **Isolate Node** and **Restore Connectivity** (no rate-limit, credential-reset, or OT power-off actions in the registry)
- Treating peer-exposed or propagated nodes as independently confirmed anomalous executable incidents

### Honest capability summary

TrustNet is a **graph-aware cyber-risk decision-support demonstration**: simulated smart-city telemetry, frozen graph residual ML, deterministic trust and policy, optional RAG guidance, and human-gated simulator containment—designed to be technically defensible under judge questioning when claims stay within this document’s boundaries.

---

*Generated from repository audit of the current implementation. Prefer this file over older notes in `docs/ARCHITECTURE.md` or `docs/archive/` when they conflict (notably live node count and campaign/live-analyze wiring).*
