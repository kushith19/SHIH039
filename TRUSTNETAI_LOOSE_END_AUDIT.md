# TrustNetAI — Loose-end audit (working document)

**Date:** 2026-09-03  
**Scope:** Entire repo as implemented today (UI, Node server, shared TGNN, AI Commander, tele-ingestion, city YAML, docs).  
**Method:** Traced claims through code. UI existence was not treated as proof.  
**Stance:** Assume a technical, AI/ML, cyber, FinTech, and product judge each want a reason to dock points.

This is not a generic checklist. Every item below is something this codebase actually does (or fails to do).

---

## BIGGEST PROBLEMS RIGHT NOW

1. **We overclaim “TGNN” / “trained model.”** The encoder is a 2-hop mean-pool GNN + concat of 3 frames; the checkpoint barely moved from `sin(...)` init (max Δ ≈ 0.07). Detection is gated by hardcoded drift/spike thresholds. **Fix:** Rename in UI/pitch to “graph residual detector (tiny GNN encoder + match calibrator).” Keep the math; stop saying Temporal Graph Neural Network / Isolation Forest. Show the checkpoint + 1 honest sentence.

2. **We overclaim “grounded AI.”** Live path is `POST /commander/explain` with **no RAG**. `/analyze` + Qdrant is a side product on mock INC-001. README still says “grounded incident assessments.” **Fix:** Pitch “LLM narrative over detector evidence.” Do not mention RAG unless you run `/analyze` live. Hide INC-001 curl from the demo script.

3. **FinTech is a folder, not a product.** Game telemetry is 4 keys (`pps/http/files/logins`). Payment YAML (`failed_transactions`, etc.) never drives the hero UI. `food_supply` sits in domain `Finance`. **Fix:** Demo the banking node + failed-login / API-abuse on that node, add one ₹/txn-impact line derived from existing metrics. Do not claim payments ML.

4. **Demo can start on an empty map.** Match auto-starts when the second player joins (`tryAutoStartMatch`). Room starts with `nodes: []`. If attacker joins before “Default architecture,” you calibrate and attack nothing. **Fix:** Auto-load default city when the first defender joins (or delay `startMatch` until `nodes.length > 0`).

5. **Attacker left panel can be blank.** `sideTab` initializes to `'devices'` in lobby; when the match starts, tabs become Rogue/Presets but `sideTab` stays `'devices'` → empty sidebar. **Fix:** `useEffect` when `showAttackTools` becomes true: `setSideTab('presets')`.

6. **“LIVE” and dashboard numbers can be catalog baselines.** LIVE = Socket.IO connected. Dashboard falls back to asset-catalog PPS when Timescale samples are missing. **Fix:** Split “socket / ingest / detection” status. Show “—” or “baseline (not live)” when ingest is down/empty.

7. **Inspector labels every TGNN flag as “Attack origin.”** `attackOrigin = anomalyNodeIds.includes(nodeId)`. **Fix:** Label “TGNN seed / flagged.” Reserve “Attack origin” for attacker-selected / override nodes only.

8. **Single shared DEMO room + “Session full.”** `/play/:roomId` redirects away; server ignores room ids. Third laptop / leftover tab kills the demo. **Fix:** Unique room per demo pair (even `DEMO-<nanoid>`), or a “Kick / Reset session” button. Do not pitch multiplayer rooms.

9. **Stale docs will get us scored on the wrong product.** `SYSTEM_REPORT.txt` still says no backend, localStorage, static dashboard, LobbyPage. `HACKATHON_RED_TEAM_AUDIT.md` still says TGNN weights are untrained `sin` (training exists now). **Fix:** Delete or quarantine `SYSTEM_REPORT.txt` from the repo root judges see. Do not open it.

10. **Startup is fragile and slow.** `npm start` wants Docker, Ollama 7B, Qdrant, Timescale, Commander — while live explanations skip RAG and often use templates (`OLLAMA_FALLBACK=0`). **Fix:** Demo script: UI + API + Commander (Groq or Ollama) only. Skip Qdrant ingest. Pre-pull model. Pre-load default city. Wait 15 ticks *before* attacking.

---

## How to read this file

Each finding: **Problem / Why it matters / Evidence / Solution / Implementation / Priority.**  
If several fixes exist, the recommended one is first.

**Priority meaning**

- **Critical** — Demo death, fake-claim exposure, or credibility kill.
- **High** — Material score loss if a judge pokes it.
- **Medium** — Weakens us; fix if time.
- **Low** — Polish.

---

# CRITICAL

---

### C1. “TGNN” name vs actual model

**Problem:** Product copy, KPIs, inspector, and docs present a Temporal Graph Neural Network. The implementation is: 14 hand features → 8-d embeddings → 2 hops of **unweighted mean** in/out pooling + `tanh` residual → concat last **K=3** spatial vectors → linear `W_TEMP`. No time encoding, no memory, no attention, no event stream. Scoring is L2 residual → logistic (`residualToScore` / `distToScore`), not a learned classifier head. Classification then applies **hard gates** (score ≥ 0.58, relative 0.5, spread 0.06, gap 0.04, drift ≥ 10% or spike ≥ 50%).

**Why it matters:** An ML judge who asks “is this TGN/TGAT?” or “where is the temporal operator?” will correctly say no. Naming is the fastest way to look like we faked AI.

**Evidence:**
- `shared/tgnnCore.js` — `spatialForward`, `tgnnForwardWindow`, `distToScore`, `residualToScore`
- `shared/trustConfig.js` — `tgnn.anomalyScoreThreshold` 0.58 and related knobs
- `server/detection/tgnn.js` — `classifyTgnnScores`
- Client: `src/features/graph/tgnnWindow.js` comment: “Client has no metric lookback. Pad with expected frames… `[expected, expected, current]`.”

**Solution (recommended):** Keep the encoder. Change the **story**: “miniature directed GNN + 3-step window + per-match embedding calibrator.” Never say TGN, never say Isolation Forest. Optional: rename KPI “Graph flags” and field `isolationScore` → `residualScore`.

**Implementation:** Search/replace user-visible strings (`GamePage.jsx`, `KpiStrip.jsx`, `InspectorPanel.jsx`, README). Keep internal `tgnn*` filenames if a rename is too risky this week. Add a 3-line “What the model is / is not” in the inspector footer.

**Priority:** Critical

---

### C2. “Trained weights” are technically true, practically near-init

**Problem:** `npm run train:tgnn` runs handwritten SGD on **synthetic 4–7 node graphs**, 20 epochs × 24 graphs, contrastive pull/push. Checkpoint `trainedAt: 2026-09-02`, `finalLoss ≈ 0.01`. Weights differ from deterministic `sin(row, col, seed)` init by **max ~0.07** (`W_IN`); `W_TEMP` Δ ≈ 0.008. Low loss is easy when positives are `pps * 15` floods.

**Why it matters:** “We trained a TGNN” collapses if a judge diffs init vs checkpoint or asks for held-out AUC. There is **no ROC, no precision, no real-city eval** in-repo for this detector.

**Evidence:** `shared/tgnnCore.js` `weight()`; `shared/tgnnTrain.js` `trainTgnn`; `scripts/train-tgnn.mjs`; `shared/tgnn_checkpoint.js`.

**Solution (recommended):** Honest one-liner: “toy encoder fine-tuned on synthetic floods so residuals sit near zero on idle; detection still uses drift gates.” Do **not** spend the remaining hackathon retraining a real TGN.

**Alternative (only if an ML judge is guaranteed):** 1 hour: dump a tiny table (synthetic precision on held-out floods vs idle) in the inspector “Model” fold. Still don’t call it production ML.

**Priority:** Critical (claim) / High (if you only fix copy)

---

### C3. Live AI is explain-without-RAG; RAG Commander is a lab sidecar

**Problem:** Node calls only `/commander/explain`. `CommanderService.explain_detection` docstring: **“No RAG.”** `/commander/analyze` uses LangGraph + Qdrant, but `get_detection_adapter()` is always `MockDetectionAdapter` (INC-001…006, `source: mock_tgnn`). Local `data/processed` missing; Qdrant collections empty; `start-stack.mjs` never ingests. Root README: “grounded incident assessments.” Health endpoint always `"healthy"` with no Qdrant/LLM check.

**Why it matters:** Opening `ai-com-v1/README.md` or curling INC-001 in front of a judge shows canned TGNN. Claiming RAG while the SOC panel uses templates + ungrounded LLM is an integrity hit.

**Evidence:**
- `server/commander/client.js` `explainViaCommander`
- `ai-com-v1/src/services/commander_service.py` `explain_detection`
- `ai-com-v1/src/api/routes/commander.py` `MockDetectionAdapter`
- `ai-com-v1/src/adapters/detection_adapter.py` INC-001
- `README.md` line 3 vs line 190 (“Incident explanations do not need [RAG]”)

**Solution (recommended):** Demo script uses **evidence cards** (already structured in `promoteIncidents`) + optional LLM one-liner. Say “LLM restates detector facts.” Do not start Qdrant unless you will ingest and call `/analyze` once as a **separate** “knowledge assist” click.

**Implementation:** Change README first sentence. Incidents panel already admits fallback (`IncidentsPanel.jsx` `explanationStatus`). Add visible “Ungrounded LLM” vs “Template” vs “RAG” badge — never implied RAG on `/explain`.

**Priority:** Critical

---

### C4. Empty-graph auto-start

**Problem:** `createEmptyRoom` has `nodes: []`. Second `room:join` calls `tryAutoStartMatch` → `startMatch` → telemetry + 15-tick calibrator on **zero endpoints**. `runDetection` early-returns if no endpoints. Default city is **not** loaded unless defender clicks “Default architecture” or `?loadDefault=1` **and** the graph is still empty.

**Why it matters:** Classic two-laptop demo: attacker opens `/` while defender is still talking. Match starts. Map empty. Attacks do nothing. Looks broken.

**Evidence:** `server/roomStore.js` `createEmptyRoom`; `server/index.js` `startMatch` / `tryAutoStartMatch`; `GraphCanvas.jsx` default load gated on `forceDefaultOnMount` and `nodes.length`.

**Solution (recommended):** On first defender join, if `nodes.length === 0`, server (or client) loads `getDefaultCanvasState()`. Also: do not `startMatch` until `nodes.length >= N` (e.g. 3, already `minNodesForFullClassify`).

**Implementation:** Smallest: client `GamePage` after join as defender, if empty, call `graphRef.loadDefaultArchitecture()`. Better: server `startMatch` returns false if no nodes; UI shows “Load city to start.”

**Priority:** Critical

---

### C5. Attacker tools panel blank until a tab click

**Problem:** `SidebarAssets` `useState(showAttackTools ? 'inject' : 'devices')`. Attacker in lobby has `showAttackTools === false` (`GamePage` `canUseAttackTools`). When phase becomes `playing`, tabs switch but state stays `'devices'`. Neither presets nor inject branch renders; `showDevices` is false → **null column**.

**Why it matters:** Attacker “has no attacks.” Panic. Wasted minutes.

**Evidence:** `src/features/assets/SidebarAssets.jsx` ~173–255; `GamePage.jsx` `canUseAttackTools`.

**Solution:** When `showAttackTools` flips true, `setSideTab('presets')`. Optionally disable presets until `!tgnnCalibrating`.

**Priority:** Critical

---

### C6. Dual / dead dashboard + fake multi-room URLs

**Problem:** `/dashboard` mounts `DashboardPage` with no room props → empty CTA. Live SOC is defender `?view=dashboard` inside `GamePage`. `/play/:roomId` **Navigate** to `/play`. Server `room:join` always `DEMO`.

**Why it matters:** Judges bookmark `/dashboard` or type a room code. They think the product is unfinished. Pitching “multiplayer rooms” is false.

**Evidence:** `src/App.jsx`; `server/index.js` `DEMO_ROOM_ID`; `useGameRoom.js` join payload.

**Solution (recommended):** Redirect `/dashboard` → `/` with copy “open as defender, then Dashboard.” Remove or implement room ids. Pitch “two-role live session,” not a room product.

**Priority:** Critical (demo confusion) / High (if demo script never uses those URLs)

---

### C7. Session full / leftover DEMO contention

**Problem:** Third connection: `'Session full'`. Disconnect clears the seat but **phase stays `playing`**. Rejoin fills a slot into a mid-match room with leftover overrides/calibrator. No Reset Match UI. In-memory only — server restart wipes the graph, SQLite metrics can linger.

**Why it matters:** Judge opens a third tab. Or previous heat didn’t disconnect. Demo dead.

**Evidence:** `server/index.js` join + disconnect; `server/detection/calibrator.js` `deleteTgnnCalibrator` **never called** from `teardownRoomTelemetry`.

**Solution:** Header button “Reset match” (defender): empty overrides, `resetTgnnCalibrator`, optionally return to lobby. On empty room, delete calibrator. For the event: one DEMO URL, close extra tabs, one API process.

**Priority:** Critical

---

### C8. Stale SYSTEM_REPORT / contradictory audits in the repo

**Problem:** `SYSTEM_REPORT.txt` (open in the IDE) describes a **browser-only IoT editor**, localStorage, static `/dashboard`, LobbyPage. That is not this app. `HACKATHON_RED_TEAM_AUDIT.md` is partly stale (e.g. “training code: none,” “weights = sin”).

**Why it matters:** Judges clone the repo and read the first `.txt`. They audit ghosts. Credibility: we don’t know our own architecture.

**Solution:** Delete `SYSTEM_REPORT.txt` from the repo **or** move to `docs/archive/` and add a 20-line current `ARCHITECTURE.md`. Do not hand judges the red-team doc unless updated.

**Priority:** Critical (if files are visible) / High (if gitignored from the zip)

---

# HIGH

---

### H1. LIVE = websocket; KPIs fallback to catalog defaults

**Problem:** Header and KPI “LIVE” use `connected`. `DashboardPage` rows: `lastPpsMap.get(n.id)?.value ?? baseline.packetsPerSecond` (banking default 23_000). Empty series → `lastValue` 0. Ingest `down`/`empty` still looks like a SOC.

**Why it matters:** “Real-time telemetry” is the first thing a cyber judge tests. Fake-looking numbers.

**Evidence:** `GamePage.jsx` 249–255; `KpiStrip.jsx` 85–87; `DashboardPage.jsx` 112–115; `src/features/dashboard/metrics.js` `lastValue`.

**Solution:** Three pips: Socket / Ingest / Detector. If no samples for an endpoint, show “—” and badge “catalog baseline.”

**Priority:** High

---

### H2. “Attack origin” is a lie

**Problem:** Any node in `anomalyNodeIds` gets threat label “Attack origin.” Spread target / at-risk are separate and more honest.

**Evidence:** `InspectorPanel.jsx` 139–174; `peerTrust.js` (`attackOrigin: anomalyNodeIds.includes`).

**Solution:** `attackOrigin` = node has attacker override or `provenance === 'injected'`. Flagged ≠ origin.

**Priority:** High

---

### H3. Client TGNN ≠ server TGNN

**Problem:** Live match uses `server/detection/engine.js`. If `room.detection` is null (lobby, API blip), `GraphCanvas` runs `collectActiveAnomalies` → client windows padded `[E,E,current]`, **`distToScore` without calibrator**, idle score **0.5**, classify fallback `isolationScore >= 0.58` without full gates.

**Why it matters:** Offline or mid-glitch, the UI still says TGNN. Scores won’t match the dashboard.

**Evidence:** `GraphCanvas.jsx` 235–254; `tgnnAnomaly.js` 223–236; `server/detection/tgnn.js` uses `residualToScore`.

**Solution:** If `phase !== 'playing'` or `!serverDetection`, show “Detector idle” and **do not** paint anomaly colors from the client model. Delete or hide client scoring in the demo build.

**Priority:** High

---

### H4. Calibrator is not “TGNN learning”

**Problem:** Welford mean/std of embeddings for 15 ticks, skip if `attackOverrideActive`, then **freeze**. UI: “TGNN calibrating live baseline.” Attacking during warmup skips ticks (`skippedAttackTicks`) and delays ready — or poisons if you attack without the flag.

**Why it matters:** Judges hear online learning. It is z-score residual vs idle embeddings.

**Evidence:** `server/detection/calibrator.js`; `TRUST_CONFIG.tgnn.warmupTicks` 15; dashboard copy `DashboardPage.jsx` 239–240.

**Solution:** Copy: “Idle window 15s — do not attack yet.” Disable preset buttons while `tgnnCalibrating`.

**Priority:** High

---

### H5. Detection types look like six models

**Problem:** Incidents UI filters Behavioural / Structural / Temporal / Dependency / Communication / Graph propagation. Engine `reasonsByNodeId` is almost always `['tgnn_embed']` → `structural_anomaly`. Extra types are **heuristic evidence** bolted on in `promoteIncidents` (communication/dependency/spread), not separate detectors. `confidenceFromSignals` weights `temporalScore` but `buildIncident` **does not pass it** (always 0).

**Why it matters:** Looks like a fusion SOC. It is one residual + rule tags.

**Evidence:** `server/detection/engine.js` 50–53; `shared/incidents.js` `DETECTION_TYPES`, `confidenceFromSignals`; `server/detection/incident.js` `buildIncident`.

**Solution:** One primary type “Graph residual.” Show evidence codes as facts, not as extra models. Or pass a real temporal signal if you keep the filter.

**Priority:** High

---

### H6. Trust score is a heuristic and is not the detector

**Problem:** `T = 0.25 I + 0.30 P + 0.25 B + 0.20 X`. Intrinsic from **device class** (firewall 94, etc.). Behavioral full penalty at 35% relative deviation. Game flags cap trust (injected ≤28, quarantined ≤15). TGNN does **not** write trust. Client can patch `behaviour.intrinsicTrust` via `graph:updateNode`.

**Why it matters:** Mixing “Trust 41 = bank hacked” is a FinTech/product own-goal. Cyber judge: trust is not attested.

**Evidence:** `shared/trustModel.js` `blendTrust`; `shared/trustConfig.js` blend weights; `server/index.js` unrestricted node patch merge; `validators.js` `canEditSim`.

**Solution:** Inspector subtitle: “Composite posture, not PKI / not the anomaly score.” Don’t let attacker patch intrinsicTrust (strip that key server-side).

**Priority:** High

---

### H7. Telemetry is a game, not sensors — and YAML FinTech metrics are mostly unused

**Problem:** Observed metrics come from city context multipliers + attacker `nodeOverrides` / presets. Four **game** keys. YAML city model has `transaction_requests`, `failed_transactions`, etc. (`overfit/city_model/infrastructue/finance/*.yaml` — folder typo `infrastructue`). `setCityYamlFeatureKeys` is a **no-op** so YAML names cannot resize the 14-d encoder. Attack presets only write the four game keys.

**Why it matters:** “Smart-city digital twin + payments telemetry” is mostly catalog PPS. A FinTech judge who opens payment YAML will ask where `failed_transactions` is on the graph.

**Evidence:** `shared/telemetryKeys.js` `GAME_METRIC_KEYS`; `src/features/graph/attackPresets.js`; `shared/tgnnFeatures.js` `setCityYamlFeatureKeys`; `src/features/graph/nodeMetrics.js`.

**Solution (recommended, hackathon-sized):** Pick **one** finance endpoint. Map YAML `failed_transactions` (or reuse `failedLoginsPerMin` + HTTP) onto the inspector as “failed txn proxy” with an honest caption. Do not expand TGNN dim this week.

**Priority:** High

---

### H8. FinTech / food-in-Finance / no money impact

**Problem:** Finance domain includes `banking_financial`, `retail_infrastructure`, and **`food_supply`**. UI has no ₹, no failed settlement, no blast-radius cost. Smart-city map + IoT-ish SOC is the visual. Competitors with a fraud graph will own the FinTech lane.

**Evidence:** `assetCatalog.js` 584–613; no `$`/`₹` in `src/` product strings; finance YAML unused in presets.

**Solution:** (1) Move `food_supply` out of Finance. (2) On banking incident, one derived line: `est. impact = f(pps or http deviation) ` labeled **illustrative**. (3) Demo script: attack **Banking & Financial Services**, then show hospital/power as **cascade** (you already have dependency edges).

**Priority:** High

---

### H9. Prompt injection + unauthenticated Commander / ingest / game socket

**Problem:** No auth on Socket.IO, `/rooms/:id/metrics`, `/rooms/:id/detection`, Commander, tele-ingestion POST. `explain_detection` dumps full detection JSON (attacker-influenced labels, evidence `detail`) into the LLM. Node `graph:updateNode` can set provenance/quarantine/metrics. `room:setCityContext` has **no role check**. `maxHttpBufferSize: 5e6`, no rate limit.

**Why it matters:** Cyber track: “you built a SOC with no auth and the attacker can rewrite trust inputs.” For a **local hackathon demo** this is expected — but **do not claim secure telemetry or production API security.** A judge who types a node label `Ignore previous instructions...` can embarrass the LLM.

**Evidence:** `server/index.js` (no auth middleware); `validators.js`; `ai-com-v1/src/services/commander_service.py` 84–91; `ai-com-v1/src/main.py` bare FastAPI.

**Solution (recommended):** Don’t claim security of the control plane. Strip/limit node `label` length. Don’t send free-text labels into the LLM (IDs + numeric evidence only). Optional 20-min: shared `DEMO_TOKEN` query param. Skip real auth.

**Priority:** High (claims) / Medium (actual exploit at a fair)

---

### H10. Attack during warmup + presets not gated

**Problem:** Banner says wait; presets still fire. Warmup skips attack ticks so the model “never finishes” or idle mean is wrong.

**Solution:** `disabled={!canUsePresets || tgnnCalibrating}` and toast “Wait for 15/15.”

**Evidence:** `GamePage.jsx` 337–348 vs `SidebarAssets.jsx` 223–240; calibrator skip path.

**Priority:** High

---

### H11. Default city is ~69 nodes — demo and TGNN cost

**Problem:** `buildCityDependencyGraph` creates **one node per catalog type** (~69 `sector({` entries) plus YAML overlay edges. Viewport zoom 0.4. 96 Carto tiles (`12×8`). GNN every 1s over all nodes. Judges won’t read the city; it looks like a hairball.

**Why it matters:** “Large topology” claim without a simplified **demo subgraph**. Performance hitch on a projector laptop. Hard to find the bank.

**Evidence:** `assetCatalog.js` sector count; `cityModel.js` `buildCityDependencyGraph`; `cityMap.js` `TILE_COLS/ROWS`; telemetry interval 1000ms in `generator.js`.

**Solution (recommended):** Demo preset “Judge path”: ~12 nodes (power → telecom → bank → hospital → traffic) with the rest loadable. Don’t rewrite the catalog.

**Priority:** High

---

### H12. Map looks like live Bengaluru GIS; nodes are icons on a grid

**Problem:** OSM/Carto tiles, district anchors. Nodes are not real endpoints. Offline / blocked CDN → blank map (Google fonts + Carto).

**Evidence:** `cityMap.js` `tileUrl` cartocdn; `index.html` Google Fonts; `CityMapBackground.jsx`.

**Solution:** Pitch “schematic on a city basemap.” Prefetch tiles or ship a static screenshot layer. Self-host fonts.

**Priority:** High (offline venue) / Medium (online)

---

### H13. README / package identity amateur signals

**Problem:** Root `package.json` `"name": "smarthackathon"`. Dead `nanoid` on server. `server/.env` copied by start-stack but **server never loads dotenv**. No root `npm test`. No `engines`. Qdrant started though unused on live path.

**Evidence:** `package.json`; `server/package.json`; `server/index.js` `process.env` without dotenv; `scripts/start-stack.mjs`.

**Solution:** Rename package `trustnetai`. `node --env-file=server/.env`. Don’t start Qdrant in the default demo path. Add `npm test` that runs the existing node:test files you already have.

**Priority:** High (name/dotenv) / Medium (test script)

---

### H14. Commander often templates; Groq story vs Ollama default

**Problem:** Circuit opens 15s → `fallbackExplanation`. `OLLAMA_FALLBACK=0`. ai-com default `LLM_PROVIDER=ollama` while README talks Groq-primary. Local 7B can stall the machine during a heat.

**Evidence:** `server/commander/client.js`; `server/.env.example`; `ai-com-v1/src/config/settings.py`.

**Solution:** Either Groq key for the heat **or** proudly use templates as “deterministic evidence English” and treat LLM as optional. Don’t apologize mid-demo.

**Priority:** High

---

### H15. Quarantine one-way; inspector closed; wrong waiting copy

**Problem:** Inspector starts closed — trust/TGNN live there. No unquarantine. Attacker lobby copy: “Waiting for the explainer to reconnect.”

**Evidence:** `GamePage.jsx` 12–16, 200–203; `InspectorPanel.jsx` 447–462.

**Solution:** Open inspector when first anomaly fires. Add Unquarantine. Fix copy: “Waiting for defender.”

**Priority:** High (copy/blank inspector) / Medium (unquarantine)

---

# MEDIUM

---

### M1. `isolationScore` naming

**Problem:** Sounds like Isolation Forest. It is logistic(L2 residual).

**Solution:** Rename UI to “residual / anomaly score.” Keep JSON field if needed for compatibility.

**Priority:** Medium (Critical if you say “isolation forest” out loud)

---

### M2. Attack spread is BFS through trust &lt; 65

**Problem:** Not exploit simulation. Undirected traversal. Quarantine → resistance 100. Fine as what-if; fatal if called “learned propagation.”

**Evidence:** `server/detection/spread.js`; `src/features/graph/attackSpread.js`; `TRUST_CONFIG.spread.trustCutoff` 65.

**Solution:** UI “reachability under trust cutoff 65.”

**Priority:** Medium

---

### M3. Dead UI: import/export, localStorage graph, unused `startGame`

**Problem:** GraphCanvas has import/export modals; callbacks `_exportGraph` not bound to visible buttons. `graphIO.js` persist helpers unused. `useGameRoom` exports `startGame` unused (auto-start only).

**Solution:** Remove dead UI **or** wire Export for a saved judge graph. Don’t leave half-modals.

**Priority:** Medium

---

### M4. HTTP `/rooms/:id/metrics` is not room SQLite

**Problem:** Name says room; body is last 5 minutes of **global** tele-ingestion, mapped by city endpoint. Cross-talk / empty if ingest down while detection still runs on overlay.

**Evidence:** `server/index.js` 67–88 vs unused `queryMetrics` in `metrics/store.js`.

**Solution:** Serve SQLite `queryMetrics(roomId)` **or** label JSON `source: 'ingestion-global'`.

**Priority:** Medium

---

### M5. Telemetry races

**Problem:** `setInterval` 1s `emitTelemetryNow` plus `syncWithTelemetry` on every graph edit. No mutex. Calibrator/detection/ingest can interleave.

**Solution:** Single-flight queue (`inFlight` flag). Good enough for demo.

**Priority:** Medium

---

### M6. `runtimeRisk` feature always 0

**Problem:** Encoder channel reserved; quarantine/injected excluded **by design**. Fine for honesty, bad if you claimed game-state-aware GNN.

**Evidence:** `shared/tgnnFeatures.js` `runtimeRiskOf()`.

**Solution:** Don’t mention the 14th channel. Or drop it in the next train (not this week).

**Priority:** Medium

---

### M7. Duplicate TGNN banners

**Problem:** Header + strip + canvas toast during the quiet 15s.

**Solution:** One banner.

**Priority:** Medium

---

### M8. Domain accent map keys don’t match catalog domains

**Problem:** Sidebar `DOMAIN_ACCENT` uses `'Energy & Utilities'` / `'Financial & Commercial'`; catalog uses `'Energy'` / `'Finance'`. Accents never apply.

**Evidence:** `SidebarAssets.jsx` 9–33 vs `assetCatalog.js` `ASSET_DOMAINS`.

**Solution:** Align keys or delete the maps.

**Priority:** Medium

---

### M9. City context is load multipliers, not “modes”

**Problem:** Menu looks like product modes. It’s sim hour × YAML/context scales.

**Solution:** Pitch “demand overlay,” not a second product.

**Priority:** Medium

---

### M10. Incident stream is ephemeral

**Problem:** Incidents are the latest detection promote, not a ticket DB. Filter UI implies a SOC queue.

**Solution:** “Live flags this tick,” not ServiceNow.

**Priority:** Medium

---

### M11. Health checks lie

**Problem:** Commander `/health` always healthy. Node `/health` `{ ok: true }` even if ingest/commander down.

**Solution:** Composite health for the demo operator only (optional). Don’t show fake green in the UI.

**Priority:** Medium

---

### M12. Sufficiency fail-open + no citation check (analyze path)

**Problem:** If you *do* show `/analyze`, empty RAG still proceeds; citations not verified against Qdrant hits.

**Evidence:** `ai-com-v1/src/agent/graph.py` exception handler defaults `sufficient=True`.

**Solution:** Don’t demo `/analyze` without ingest. If you do, show “no knowledge hits.”

**Priority:** Medium (Critical if you demo RAG cold)

---

### M13. Leftover junk in the working tree

**Problem:** Git status noise: `node`, `smarthackathon@0.0.0`, `dist/`, deleted `TRUST_AND_ANOMALY_REPORT.md`. Looks unshipped.

**Solution:** Delete leftovers. Don’t zip `node_modules` / `dist` / `venv`.

**Priority:** Medium

---

### M14. Typo `infrastructue` in city model path

**Problem:** Looks careless in a directory judges will browse.

**Solution:** Don’t rename mid-hackathon (import.meta.glob). Mention it’s historical. Fix after if you have time (alias).

**Priority:** Low–Medium

---

### M15. Attack presets are canned multipliers

**Problem:** Not adaptive AI attacks. Fine — **say so**. “Credential spray” is `failedLogins * 50`.

**Evidence:** `attackPresets.js` `computePresetOverrides`.

**Solution:** Pitch “repeatable attack tools for the detector,” not an attacking agent.

**Priority:** Medium

---

### M16. Simultaneous attacks / large blast

**Problem:** Multiple presets on many nodes: gates (`minSpread` / winner-takes-anomaly) may flag **one** winner; spread BFS may look random. No campaign correlation API (Commander campaign is scripts-only).

**Solution:** Demo **one** primary attack, then optionally a second hop. Don’t spray the whole city.

**Priority:** Medium

---

### M17. Backend death during demo

**Problem:** Vite still up; WS errors. Client may fall back to client TGNN (H3). Templates for explanations.

**Evidence:** `src/multiplayer/socket.js`; connect error banner in `GamePage`.

**Solution:** Rehearse “API died” — don’t improvise TGNN. Restart `npm run dev:server`. Pre-explain fallback.

**Priority:** Medium

---

### M18. Google Fonts + Carto + first-time Ollama pull

**Problem:** Venue wifi. 7B model download. Docker daemon not running.

**Solution:** Offline fonts, cached tiles, pre-pulled `qwen2.5:7b-instruct` or Groq-only Commander, Docker images loaded.

**Priority:** Medium (Critical on bad wifi)

---

# LOW

---

### L1. Root package name `smarthackathon`

Rename when you touch `package.json` anyway.

### L2. No unquarantine, no rematch, no spectator

Nice-to-have. Reset match covers rematch.

### L3. `nanoid` unused on server

Remove from `server/package.json`.

### L4. Dashboard fetch deps `[roomId]` only

Works via `tickRef`; fragile. Include `tick` if you touch it.

### L5. StrictMode double-mount

Dev-only double effects; don’t debug that on stage.

### L6. `maxHttpBufferSize` 5MB

Irrelevant for the fair unless you claim hardening.

### L7. Education/water YAML richness unused in the 4-metric game

Ignore unless FinTech/story needs one extra metric.

### L8. ICS ATT&CK JSON only (no Enterprise MITRE)

Ignore unless you demo RAG analyze.

---

# Things we have forgotten (judge questions)

These are not extra “features.” They are **questions we are not ready to answer**.

| Judge asks | Today’s honest answer | Prepare |
|---|---|---|
| Is the TGNN trained? | Light SGD on synthetic floods; near-init. | One sentence + don’t oversell. |
| Where is the temporal part? | Concat 3 frames; client pads expected. | Server lookback only. |
| Is telemetry from the city? | Simulated from YAML/context + attacker overrides. | Call it a digital-twin **simulator**. |
| Why should a bank care? | Bank is a high-trust node on a city graph; no ₹ model. | Demo bank + illustrative impact line. |
| Is Commander RAG? | Not on the live path. | Don’t say grounded. |
| Can I join as a third SOC analyst? | Session full. | Don’t offer. |
| What if two attacks at once? | One residual winner + heuristics. | Demo one seed. |
| Can the attacker poison the model? | Stay under 10% drift; poison 15-tick idle mean; patch intrinsicTrust. | Don’t claim adversarial robustness. |
| Show me the ROC. | None. | Don’t volunteer “accuracy.” |
| Is trust zero-trust / PKI? | No. Class prior + neighbors + deviation. | Say “posture score.” |
| Production scale? | In-memory DEMO, JS GNN/tick, 69 nodes. | “Demo scale.” |
| Auth? | None. | “Local two-player sim.” |
| What happens when Ollama is down? | Templates. | Show the badge; keep going. |
| Why Qdrant in `npm start`? | Leftover for unused `/analyze`. | Don’t start it. |
| Map tiles failed. | CDN. | Schematic fallback. |
| Click `/dashboard`. | Empty shell. | Redirect. |
| This is just IoT cyber. | Fair if we don’t lead with bank cascade + money. | Story: city mesh **including** core banking as a dependent of power/telecom. |

**What would make the demo look fake**

- Attacking before 15/15.
- Empty map auto-start.
- Blank attacker sidebar.
- “Attack origin” on a node the attacker never touched.
- LIVE numbers that don’t move.
- Reading SYSTEM_REPORT.
- Curling INC-001 as “our detection.”
- Saying Isolation Forest / TGN / RAG.

**What a competitor can do that we cannot**

- Held-out metrics (AUC) on a real dataset.
- Transaction-level fraud graph.
- Authenticated multi-tenant SOC.
- True streaming TGN.
- Closed-loop response into a real controller.
- Persistent incident tickets.

We should **not** try to grow into those this week. We should **stop implying we already did.**

---

# Ranked lists

## CRITICAL (lose / fake / demo-break)

C1 TGNN naming · C2 trained-model overclaim · C3 RAG/grounding overclaim · C4 empty auto-start · C5 blank attacker panel · C6 dead dashboard / fake rooms · C7 session full · C8 stale SYSTEM_REPORT

## HIGH (score cut)

H1 LIVE/baseline · H2 Attack origin · H3 client vs server detector · H4 calibrator copy + ungated presets · H5 six detection types · H6 trust vs detector / patchable intrinsic · H7 YAML metrics unused · H8 FinTech emptiness · H9 insecure control plane **claims** · H10 attack in warmup · H11 69-node hairball · H12 map/CDN · H13 smarthackathon / dotenv / Qdrant · H14 LLM/template · H15 inspector/copy/quarantine

## MEDIUM

M1–M18 as above (spread honesty, dead import, metrics API lie, races, banners, accents, health, junk files, presets honesty, dual attacks, backend death, wifi)

## LOW

L1–L8 polish

---

# What we should fix first

Order is **demo survival → claim honesty → FinTech story → leftover credibility.**

1. C5 blank attacker tab  
2. C4 auto-load default city / don’t start empty  
3. C7 reset session + calibrator teardown  
4. H10 disable presets until calibrated  
5. C1/C2/M1 rename user-visible ML claims (`isolationScore` label, TGNN subtitle)  
6. C3/H14 README + incident badge: explain ≠ RAG  
7. H2 Attack origin label  
8. H1 LIVE vs ingest vs baseline  
9. H15 waiting copy; open inspector on first flag  
10. C6 redirect `/dashboard`; stop pitching rooms  
11. H8/H7 banking-first demo + one impact line; move food out of Finance  
12. H11 optional 12-node “demo city” button  
13. C8 delete/archive SYSTEM_REPORT  
14. H13 package name + don’t boot Qdrant by default  
15. H3 hide client TGNN when server detection exists / not playing  

---

# What we can ignore (this hackathon)

- Production auth, rate limits, IDOR, TLS, RBAC  
- Real TGN/TGAT rewrite, PyTorch, GPU training  
- Wiring tele-ingestion as the TGNN source of truth  
- Full RAG ingest + `/analyze` on every tick  
- True multi-room product  
- Unquarantine polish after Reset exists  
- Renaming `infrastructue/` folder  
- Isolation Forest, enterprise MITRE, PCI-DSS corpus  
- 10k-node scalability  
- Campaign HTTP API  
- Fixing every YAML metric into the encoder  

---

# Anything we should remove

- **`SYSTEM_REPORT.txt`** from the judge-facing root (archive or delete).  
- Visible **import/export** if unwired (or wire one Export).  
- **`/play/:roomId`** if it only redirects — or make it real.  
- **Qdrant + RAG ingest** from default `npm start` unless you demo `/analyze`.  
- **Mock INC-001** as the documented happy path (move to `docs/dev`).  
- Leftover **`node`**, **`smarthackathon@0.0.0`**, stale **`dist/`**.  
- Pitch words: Temporal Graph Neural Network, Isolation Forest, grounded RAG, trained production model, live city sensors, multi-room SaaS, zero-trust, PCI.  

Keep the **code** for the miniature GNN, calibrator, spread BFS, Commander explain, Timescale — just don’t market the unused half.

---

# Anything we should add (small)

1. **Reset match** button.  
2. **Demo city** (12 nodes) including Banking.  
3. **Status strip:** socket / ingest / calibrating / detecting.  
4. **Illustrative ₹ or txn impact** on finance incident (formula in `metrics.js`, labeled).  
5. **Preset lock** during warmup.  
6. **Honest model blurb** in inspector (3 lines).  
7. **Spoken demo script** (below) — not more features.

---

# Anything we should change in the demo

**Do this sequence (two browsers, defender first):**

1. Defender opens `/` only. Confirm default city loaded (after C4 fix). Zoom to **Finance / Banking**.  
2. Attacker opens `/` **after** the map is visible. Wait until header `15/15` (or your warmup).  
3. Attacker: select **Banking & Financial Services** → Preset **Credential spray** or **API abuse** (FinTech-legible).  
4. Defender: Dashboard tab — incidents + evidence numbers. Inspector: residual score, **not** “Attack origin” unless they selected that node.  
5. Quarantine the seed. Show spread freeze / trust cap.  
6. Optional: one sentence “LLM restates these facts” — if template, say template and move on.  
7. **Do not:** open `/dashboard`, curl INC-001, click Random YAML, flood 10 presets, explain Qdrant, claim TGN.

**Waste of time:** City context tour, Rogue device unless you need a visual, import/export, tick-watching, RAG architecture slides.

**Wifi risk:** Map tiles, fonts, Groq. Have a screenshot of the city and Groq key **or** templates.

**Laptop risk:** Don’t run 7B + Timescale + Qdrant + Chrome×2. Trim stack.

---

# Anything we should change in claims / story

**Lead story (recommended):**  
*Two-player smart-city cyber exercise: live graph of municipal + banking infrastructure, simulated telemetry, a tiny directed GNN residual detector with a 15-second idle calibrator, blast-radius under a trust cutoff, and an LLM that narrates detector evidence. Finance is in the blast radius of power/telecom, not a payments-fraud product.*

**Stop saying:** TGNN as in the literature; trained SOTA; RAG-grounded Commander on the live path; real-time sensors; Isolation Forest; production SOC; multi-room; scalable; secure-by-design API.

**Start saying:** Simulator. Residual detector. Match calibrator. Evidence-first. Illustrative financial impact. Demo-scale.

**Differentiation that is real (use this):** Shared encoder in `shared/tgnnCore.js` used by train script + server; Welford calibrator; city YAML overlay; two-role Socket.IO; structured incident evidence; optional LLM. That is enough if we don’t lie about the rest.

**FinTech angle that won’t get laughed at:** Core banking as a **critical dependent** of city infrastructure; attack shows failed-auth / API abuse on the bank node; cascade via existing edges (power, telecom). Not “we detect card fraud.”

**Smart-city angle:** Bengaluru schematic + sector catalog + context load. Not live BBMP telemetry.

**Cyber angle:** Detection + quarantine what-if. Not a hardened C2.

---

# WHAT WE SHOULD DO NOW

Action list for a developer in Cursor, in order. Stop after 1–12 if time is short; 13+ is credibility polish.

1. **Fix `SidebarAssets` tab state** when `showAttackTools` becomes true (`setSideTab('presets')`).  
2. **Auto-load default city** for empty DEMO on defender join; **block `startMatch`** until `nodes.length > 0`.  
3. **Add Reset match** (clear overrides, `resetTgnnCalibrator`, call `deleteTgnnCalibrator` on teardown).  
4. **Disable attack presets** while `tgnnCalibrating`.  
5. **User-visible copy:** residual/graph detector, not TGN/Isolation Forest; calibrator = idle window; LIVE ≠ ingest.  
6. **Rename threat label** off “Attack origin” unless override/injected.  
7. **Redirect `/dashboard`** to the game; fix attacker waiting copy.  
8. **Incidents / README:** live path is `/explain`, not RAG; remove INC-001 as the product demo.  
9. **Dashboard:** “—” when no samples; badge catalog baseline.  
10. **Don’t paint client TGNN** when server detection is the authority / not playing.  
11. **FinTech demo path:** bank node + impact one-liner; recategorize `food_supply`.  
12. **Archive/delete `SYSTEM_REPORT.txt`**; don’t show `HACKATHON_RED_TEAM_AUDIT.md` unless updated.  
13. **Optional 12-node demo topology** button.  
14. **Rename npm package** off `smarthackathon`; load `server/.env`; skip Qdrant in default start.  
15. **Strip attacker `intrinsicTrust` patches** on the server.  
16. **Open inspector** when the first anomaly appears.  
17. **Self-host fonts / note Carto dependency.**  
18. **Delete junk:** unused import UI or wire Export; `node` leftover; `nanoid` if unused.  
19. **Rehearse the 7-step demo** on two browsers with the trimmed stack.  
20. **Do not** rewrite the GNN, build auth, or ingest RAG unless the pitch explicitly needs `/analyze` once.

---

## What is actually solid (so we don’t “fix” it into a rewrite)

- Server detection pipeline: snapshot → optional ingest overlay → lookback SQLite → `runDetection` → spread → incidents → socket sync.  
- Shared 14-d encoder + checkpoint file with coherent shapes.  
- Calibrator math (Welford) is real, just overnamed.  
- Incident evidence objects are real numbers a judge can read.  
- Two-role Socket.IO sync works when DEMO isn’t full.  
- Incidents panel already admits Commander fallback/error.  
- City YAML + context multipliers exist (even if the game only attacks 4 metrics).

Protect these. Change **names, demo gating, and story** first. That is how we stop losing to ourselves.
