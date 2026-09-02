# TrustNetAI — Loose-End Audit (working document)

**Date:** 2 September 2026  
**Scope:** Current working tree (not README wishful thinking, not the stale fusion-era red-team doc).  
**Mode:** Evidence-traced. UI existing ≠ feature working. AI claimed ≠ RAG/training present.  
**Not in this pass:** code fixes. Execute **WHAT WE SHOULD DO NOW** next.

Live detection is TGNN-only in `server/detection/engine.js`. `fusion.js` and `temporal.js` are **deleted**. Do not use `HACKATHON_RED_TEAM_AUDIT.md` as truth — it still describes fusion bonuses.

---

## BIGGEST PROBLEMS RIGHT NOW

1. **We call it a Temporal GNN / ML model. Weights are `sin()`-seeded and never trained, and game flags still leak into features.**  
   **Solution:** Pitch “graph-temporal embedding detector (fixed weights; expected vs observed city telemetry).” Strip `attackOverrideActive` / injected / quarantined from `runtimeRiskOf`. Never say trained TGNN.

2. **Live “AI Commander” is not RAG.** Game server hits `/commander/explain` (one LLM call, docstring: no RAG). LangGraph + Qdrant live only on unused `/analyze`. Templates and Ollama can look like Commander.  
   **Solution:** Demo line: “explainer paraphrases Level-1 numeric evidence.” Do not claim RAG on the live path. Optional: one Deep Analyze on the primary incident **only if** Groq is up and Qdrant has points.

3. **Stale docs will get us caught.** `TRUST_AND_ANOMALY_REPORT.md` still says browser-only / two time steps / 11 features. `SYSTEM_REPORT.txt` is a May 2026 IoT editor. Commander README sells RAG as the product.  
   **Solution:** Stamp INTERNAL/STALE or delete from the judging packet. One honest one-pager.

4. **FinTech is YAML scenery.** Five finance endpoints under a typo folder (`infrastructue/finance/`). No ₹, no settlement risk, generic IoT attack presets.  
   **Solution:** One finance-origin attack (core banking / payments) + one inspector/dashboard sentence on disruption vs expected. Do not claim a FinTech product.

5. **Demo stack is fragile.** `npm start` wants Docker, Ollama/Groq, Qdrant, Timescale, Python venv, many ports. Ingest overlay can wipe attacks if Timescale returns “healthy” values.  
   **Solution:** Rehearse `npm run dev:all` and `npm start -- --no-ingest` + Groq. Printed runbook. Never cold-start on stage.

6. **Match auto-starts on empty city.** Second seat fills → `tryAutoStartMatch` with possibly zero nodes. Default architecture is a button / `?loadDefault=1`.  
   **Solution:** Auto-load city graph in empty lobby **and** refuse `startMatch` until `nodes.length > 0`.

7. **Fake rooms.** `/play/:roomId` redirects to `/play`. Join always `DEMO`. Third client = session full. Disconnect frees a seat for whoever reconnects.  
   **Solution:** Remove the fake route. Script two tabs only. Do not promise multi-room.

8. **Labels that look fake or broken.** `LIVE` = websocket. “TGNN flags.” `isolationScore` is not Isolation Forest. Attacker lobby: “Waiting for the explainer to reconnect.” Inspector “Attack origin” = any flag.  
   **Solution:** Relabel to graph anomaly score / Connected. Fix the waiting string. Open inspector for defender. Add a 4-row legend.

9. **Open ingest, open Commander, `.env` not gitignored.** `sim:patch` **is** role-gated; the real holes are `:3000`, `:8000` on `0.0.0.0`, unauthenticated `/rooms/:id/metrics`, published Postgres/Qdrant, and attacker **baseline overwrite**.  
   **Solution:** Pitch closed-loop sim. Bind ingest/Commander to localhost. Add `**/.env` to `.gitignore`. Attacker may set overrides only.

10. **Dead UI and two detectors.** Import/export and localStorage never called. Client TGNN pads fake time (`[expected, expected, current]`). Standalone `/dashboard` empty. Carto tiles need venue Wi‑Fi. Inspector closed; map blank.  
    **Solution:** Auto-load city; hide or delete dead IO; prefer server detection in play; offline map fallback fill; never send judges to `/dashboard` cold.

---

## How this audit was done

Traced: canvas → sockets → in-memory room → 1 Hz telemetry tick → produce snapshot → optional Timescale overlay → `runDetection` → incidents → Commander queue → dashboard/inspector.

| Layer | Paths |
|---|---|
| UI | `src/App.jsx`, `src/pages/GamePage.jsx`, `src/pages/DashboardPage.jsx`, `src/features/**`, `src/multiplayer/**` |
| Shared | `shared/trustConfig.js`, `shared/trustModel.js`, `shared/tgnnCore.js`, `shared/tgnnFeatures.js`, `shared/incidents.js`, `shared/cityModel/**` |
| Game server | `server/index.js`, `server/roomStore.js`, `server/detection/*`, `server/telemetry/*`, `server/commander/client.js` |
| Commander | `ai-com-v1/src/**` |
| Ingest | `tele-ingestion/**` |
| City twin | `overfit/city_model/**` (on-disk folder: `infrastructue/`) |
| Docs | `README.md`, `TRUST_AND_ANOMALY_REPORT.md`, `SYSTEM_REPORT.txt`, `ai-com-v1/README.md` |

---

# Findings

Each item: Problem / Why it matters / Evidence / Solution / Implementation / Priority.  
Where two fixes exist, **Recommend** is the hackathon-realistic one.

---

## A. Claims vs code (credibility)

### A1. “TGNN” is a fixed-weight embedder, not a trained temporal GNN

**Problem:** Layer weights are `sin(row * 12.9898 + col * 78.233 + seed) * scale`. No dataset, no backprop, no checkpoint. Forward pass: input proj → two directed neighbor pools → concat K=3 frames → temporal mix → sigmoid of L2 distance (`α = 4.5`). No-change score is **0.5**.

**Why it matters:** An ML/AI judge asking “where is the model file?” ends the TGNN story. Calling this a Temporal Graph Neural Network is the fastest way to look like we oversold.

**Evidence:** `shared/tgnnCore.js` `weight()`, `createTgnnParams()`, `tgnnForwardWindow()`. `TRUST_CONFIG.tgnn.temporalWindow = 3`, `embedDim = 8`. Classifier in `server/detection/tgnn.js`.

**Solution:** Honest name in UI and pitch: graph-temporal residual / embedding detector with **deterministic** weights (good for a reproducible demo). Keep the architecture (spatial + short window) — that part is real, just not learned.

**Implementation:** Relabel KpiStrip / toast / inspector. One slide: formula + “fixed weights so the live match is deterministic.” Optional later: dump `W_*` JSON from a 1-evening synthetic train — **do not** start that unless claims are already honest.

**Recommend:** Relabel + strip game-flag leak (D1). Do not train a model this week.

**Priority:** Critical

### A2. Docs claim browser-only, 11 features, two time steps

**Problem:** `TRUST_AND_ANOMALY_REPORT.md` says trust + TGNN run entirely in the browser with no server; two concatenated steps; eleven features. Code is server-primary, K=3, 14 base channels plus YAML names (can explode to ~257 when the city model loads).

**Why it matters:** A judge who reads the report then opens DevTools will treat the team as unreliable.

**Evidence:** Report intro and “How TGNN works.” `shared/tgnnFeatures.js` `BASE_CITY_FEATURE_KEYS` (14 keys including `runtimeRisk`). `server/telemetry/generator.js` → `runDetection`. `setCityYamlFeatureKeys` / unused YAML endpoints in `buildCitySnapshot`.

**Solution:** Do not put that report in front of judges. Rewrite or mark STALE.

**Implementation:** Header: `STALE — server TGNN, K=3, see tgnnCore.js`. Or delete from the demo folder.

**Priority:** Critical

### A3. SYSTEM_REPORT.txt describes a different product

**Problem:** Generated 15 May 2026: no backend, IoT editor, static dashboard, persistence/import as if live.

**Why it matters:** Same as A2 if anyone opens it during Q&A.

**Evidence:** `SYSTEM_REPORT.txt` executive summary vs `server/`, `DashboardPage.jsx`, `InfrastructureNode.jsx`.

**Solution:** Archive or delete.

**Implementation:** Move to `docs/archive/` or remove from repo root.

**Priority:** Critical

### A4. Commander README / root README overclaim RAG on the product path

**Problem:** Root README: “grounded incident assessments.” `ai-com-v1/README.md`: frozen RAG baseline, LangGraph, Qdrant, MITRE, OT safety. Live game never calls `/analyze`. README also admits “Incident explanations do not need [RAG ingest]” — those two sentences fight.

**Why it matters:** “Show me a citation” has no UI. Campaign mode has no HTTP route.

**Evidence:** `server/commander/client.js` `explainViaCommander` → `POST /commander/explain`. `commander_service.py` `explain_detection`: “No RAG.” `ai-com-v1/README.md` omits `/explain`. `data/processed` empty in repo.

**Solution:** Split claims: live = evidence paraphrase; RAG = optional offline `/analyze`.

**Implementation:** Root README first sentence: city twin + detection + optional LLM narrative. Commander README: “TrustNet live path = `/explain`.”

**Recommend:** Copy only this week unless Qdrant is already populated and Groq is fast.

**Priority:** Critical

### A5. Package name `smarthackathon`

**Problem:** `package.json` `"name": "smarthackathon"`. localStorage key `smarthackathon.canvas.graph.v1` (unused anyway).

**Why it matters:** Looks like a template leftover on screen share of `package.json`.

**Evidence:** root `package.json`; `src/features/graph/graphIO.js`.

**Solution:** Rename to `trustnetai`.

**Implementation:** Change `name`; ignore storage key if you delete persist helpers.

**Priority:** Low

---

## B. AI / Commander / RAG

### B1. Live path is `/explain` only

**Problem:** Tick loop enqueues explanations; only `summary` string is used. No retrieval, no LangGraph, no recommendations, no MITRE, no OT guardrails.

**Why it matters:** The expensive Python service is a chat wrapper around detection JSON.

**Evidence:** `server/telemetry/generator.js` `ingestCitySnapshot` → `enqueueIncidentExplanations`. `client.js` L299–317. `IncidentsPanel.jsx` is the only UI consumer. Inspector has no Commander fields.

**Solution:** Either (A) own “LLM why-fired” or (B) one Deep Analyze button for the top incident showing citations.

**Implementation:** **Recommend A** for demo reliability. B only if Groq + non-empty Qdrant proven in rehearsal.

**Priority:** Critical

### B2. Ollama fallback marked `ready`; templates look like AI

**Problem:** `tryOllamaExplanation` returns `status: 'ready'`. Fallback templates have no badge if status is missed. Ready path in UI is a bare paragraph.

**Why it matters:** Judges cannot tell LLM vs template vs side-channel Ollama.

**Evidence:** `server/commander/client.js` `tryOllamaExplanation`, `fallbackExplanation`, `attachExplanations`. `IncidentsPanel.jsx` explanation statuses.

**Solution:** Distinct statuses: `commander` | `ollama` | `fallback` | `error`. Show “AI” only for Commander success.

**Implementation:** Add `explanationSource`; chip in IncidentsPanel. Always show numeric evidence first.

**Priority:** High

### B3. Queue / timeout / circuit will fail the AI moment

**Problem:** `MAX_IN_FLIGHT = 1`, `MAX_QUEUE = 5`, 45s Commander timeout, 3s health, 15s circuit on any failure. Many incidents per tick → mass `fallback`. Python `ainvoke` unbounded.

**Why it matters:** Live attack → “AI Commander unavailable” after a long pending.

**Evidence:** `server/commander/client.js` constants and `enqueueIncidentExplanations`. `explain_detection` no `asyncio.wait_for`.

**Solution:** Evidence-first UI so LLM is garnish. Optionally shorten timeout; prioritize critical severity.

**Implementation:** Do not block the demo on Commander. Show `formatEvidenceItem` always.

**Priority:** High

### B4. Unauthenticated Commander on `0.0.0.0:8000`

**Problem:** No API key, CORS policy, or rate limit. Venue LAN can burn Groq quota and POST injected detections.

**Why it matters:** Cost + prompt injection + “you left an LLM API open.”

**Evidence:** `ai-com-v1/src/main.py`; `api/routes/commander.py`; `settings.py` host `0.0.0.0`; start-stack uvicorn.

**Solution:** Bind `127.0.0.1`; shared secret from Node.

**Implementation:** `X-Commander-Key` dependency; `server/.env`; 401 otherwise. **Recommend localhost bind even if key slips.**

**Priority:** High (venue) / Medium (honesty of “secure platform”)

### B5. Prompt injection: full detection JSON in the user message

**Problem:** `detection.model_dump_json()` including free-form `evidence[].detail` and metadata. Same pattern on `/analyze` and Node Ollama path.

**Why it matters:** Attacker-influenced labels / a judge curling `/explain` can override instructions (“invent malware”).

**Evidence:** `commander_service.py` L84–92; `client.js` `explainViaOllama`; `detection.py` `evidence: List[Dict[str, Any]]`.

**Solution:** Allowlisted fields only (`code`, `metric`, `deviationPct`, `observed`, `expected`). Wrap in a facts block. Never treat `detail` as instructions.

**Implementation:** Serializer in Node `toDetectionInput` + Python explain path. Hackathon: enough to stop the obvious jailbreak.

**Priority:** High

### B6. `/analyze` has no citation cross-check; sufficiency fails open

**Problem:** LLM-invented `CommanderResponse.evidence` is not matched to Qdrant chunk IDs. Sufficiency exception sets `sufficient=True`.

**Why it matters:** Fake NIST/MITRE cites if you ever demo `/analyze`.

**Evidence:** `graph.py` validate = Pydantic only; sufficiency except path.

**Solution:** Filter citations to retrieved set; fail closed if zero chunks.

**Implementation:** Only if you wire `/analyze`. Otherwise **do not demo analyze**.

**Priority:** High (if analyze) / Low (if explain-only)

### B7. Health check does not verify LLM or Qdrant

**Problem:** `/health` always healthy. Node circuit treats that as up, then burns 45s per job.

**Evidence:** `ai-com-v1` health route; `commanderAvailable()` GET `/health`.

**Solution:** Readiness: ping Groq/Ollama (and Qdrant if analyze). Node uses ready endpoint.

**Priority:** Medium

### B8. Mock INC-001 adapter; campaign orphaned; empty RAG corpus

**Problem:** ID-only curls hit canned incidents. Campaign graph exists without a route. `data/processed` missing.

**Why it matters:** README curl trains the wrong mental model; empty Qdrant → “no authoritative evidence.”

**Solution:** Require `detection` body; drop campaign from V1 pitch; don’t claim RAG without `collection count > 0`.

**Priority:** Medium

### B9. OT/ICS safety and MITRE only on unused path

**Problem:** Keyword filters and ATT&CK-as-candidate rules never run on live explanations (no recommendations).

**Why it matters:** Pitching “OT safety guardrails” is false for the product loop.

**Solution:** Remove from live pitch or run safety on any rec-bearing path.

**Priority:** High (claims) / Low (code if explain-only)

---

## C. Detection, trust, TGNN internals

### C1. Game-flag leak into TGNN features (`runtimeRisk`)

**Problem:** Fusion bonuses are gone, but `runtimeRiskOf` still maxes risk for quarantined (1.0), injected (0.75), `attackOverrideActive` (0.45). Override also selects YAML `under_attack` sampling.

**Why it matters:** Detector can fire because the attacker moved a slider, not because traffic is odd. An ML judge will call this label leakage. Same class of cheat as old fusion.

**Evidence:** `shared/tgnnFeatures.js` `runtimeRiskOf`. `shared/cityModel/liveTelemetry.js` `attackOverrideActive` → `under_attack`. Flag set from override presence in `citySnapshot.js` / client `tgnnWindow.js`.

**Solution:** Features = telemetry + graph structure + expected-vs-observed only. Keep quarantine for **spread resistance and UI**. Injected stays a provenance badge, not a feature.

**Implementation:** Delete those three max() lines. Do not use override to pick `under_attack` for detection features (metric magnitude already carries the attack).

**Recommend:** This over any “train a TGNN” work.

**Priority:** Critical

### C2. YAML feature dim ~257 + ghost `yaml:*` endpoints

**Problem:** Every YAML metric name becomes a channel; unused city endpoints are injected into the snapshot. `endpoints.length` always ≫ 3 so small-graph fallback never runs. Client canvas ≠ server graph.

**Why it matters:** Fixed sin weights in 257-D are mostly noise. Demo can detect on nodes the judge cannot see.

**Evidence:** `buildCitySnapshot` unused endpoints; `setCityYamlFeatureKeys`; runtime 14 + ~243 YAML names (reported from detection audit).

**Solution:** Detect **canvas nodes only**. Freeze TGNN channels to game metrics (`packetsPerSecond`, HTTP, files, logins, graph stats).

**Implementation:** Filter `yamlOnly` in `adaptCitySnapshot` / engine. Do not expand `CITY_FEATURE_KEYS` from full YAML during a match.

**Priority:** Critical

### C3. Ingest overlay can erase attack overrides

**Problem:** Client effective = expected ⊕ ingest ⊕ **overrides**. Server overlay after GET can start from expected and **drop overrides** if ingest returns a “healthy” tick.

**Why it matters:** UI red, engine green — looks broken or fake.

**Evidence:** `src/features/graph/peerTrust.js` merge order vs `overlaySnapshotFromIngested` in `server/telemetry/citySnapshot.js`. Failure mode is **successful wrong ingest**, not ingest down (down falls back to produced, which has overrides).

**Solution:** Overlay merge from **produced**, then ingest, then re-apply `nodeOverrides` / `edgeOverrides`.

**Implementation:** One function in `citySnapshot.js`. Rehearse with ingest up.

**Priority:** Critical

### C4. Attacker `sim:patch` replaces entire `hackSimulator`

**Problem:** Defender merge preserves baselines/`active`. Attacker path: `room.hackSimulator = sanitized`. Missing keys drop `nodeScenarioBaselines` or set `active: false` → expected ≈ live → no drift.

**Why it matters:** Detection goes blind mid-demo. This is the real `sim:patch` bug (role gate exists).

**Evidence:** `server/index.js` L509–527. `validators.js` `sanitizeHackSimulator`.

**Solution:** Attacker may set `nodeOverrides` / `edgeOverrides` only. Baselines owned by server at match start.

**Implementation:**
```js
room.hackSimulator = {
  ...room.hackSimulator,
  nodeOverrides: sanitized.nodeOverrides,
  edgeOverrides: sanitized.edgeOverrides,
}
```

**Priority:** Critical

### C5. Auto-start before topology; `graph:load` in play rebuilds attack layer

**Problem:** Second join → `startMatch` with empty `nodes`. Defender load during play calls `buildAttackLayerFromGraph` → **wipes overrides**.

**Why it matters:** Blank city or attacker work reset when someone clicks Default architecture.

**Evidence:** `server/index.js` `tryAutoStartMatch`, `startMatch`, `graph:load` playing branch. `canEditTopology` not phase-locked.

**Solution:** Require `nodes.length > 0`. Auto-load default city in lobby. On load during play: merge new ids only; do not rebuild overrides.

**Implementation:** Guard in `startMatch`; GamePage effect: defender + lobby + empty → `loadTopology(getDefaultCanvasState())`.

**Priority:** Critical

### C6. Classifier AND-bug; relative/spread knobs dead

**Problem:** `score >= 0.58 && (score >= 0.50 || spreadAndGap)`. Since 0.58 > 0.50, spread/gap never matter.

**Why it matters:** You cannot demo “relative ranking” — the knobs in `TRUST_CONFIG` are lies.

**Evidence:** `server/detection/tgnn.js` `classifyTgnnScores`; duplicate in `src/features/graph/tgnnAnomaly.js`.

**Solution:** Intended likely `score >= 0.58 || (score >= 0.50 && spreadAndGap)`.

**Implementation:** One-line both files + a unit test with scores 0.52 vs 0.40.

**Recommend:** Fix if you mention those knobs; else leave and don’t mention them.

**Priority:** High

### C7. Client TGNN is not temporal

**Problem:** `buildClientTgnnWindows` pads `[expected, expected, current]`. Comment: client has no metric lookback. Server uses SQLite last-K ticks.

**Why it matters:** Fallback path contradicts the TGNN pitch. Early server ticks also pad.

**Evidence:** `src/features/graph/tgnnWindow.js`. `GraphCanvas.jsx` `collectActiveAnomalies` when `serverDetection == null`.

**Solution:** In `playing`, never run client detector. Badge “local estimate” if you must. Do not pitch client temporal.

**Implementation:** `if (phase === 'playing')` require server detection; show stale/off otherwise.

**Priority:** High

### C8. Hard 10% drift gate; subthreshold poisoning

**Problem:** No flag unless max relative deviation ≥ 0.1 or single-metric ≥ 50%. `eps: 1` distorts tiny baselines. Edge-only PPS may miss the **node** drift gate.

**Why it matters:** Slow poison / 9% everywhere is invisible. Judges who “play attacker fairly” may see nothing.

**Evidence:** `TRUST_CONFIG.tgnn.minDeviationRatio`, `metricSpikeDeviationRatio`. `features.js` `hasTelemetryDrift`. Presets in `attackPresets.js` are huge (so demo still flags if presets are used).

**Solution:** Keep 10% as **documented attacker headroom** OR OR-in max edge deviation. Demo uses presets (always visible).

**Implementation:** Pitch: “we require a clear break from city-expected so rush hour is not an incident.” Do not lower to 0.01 (false positives on jitter).

**Recommend:** Keep 10%; always use presets in demo; mention headroom if asked.

**Priority:** High (fairness / Q&A) / Medium (if presets only)

### C9. Peer trust ≠ documentation

**Problem:** Docs: mean of neighbors’ **intrinsic**. Code: mean of neighbors’ **localPosture** (reweighted I+B+X). Blend 0.25 / 0.30 / 0.25 / 0.20 matches. Behavioral zeros at 35% PPS deviation.

**Why it matters:** Walking through the old report formula vs inspector numbers fails.

**Evidence:** `shared/trustModel.js` `localPosture`, `peerFromNeighborLocal`. Report peer section.

**Solution:** Fix docs to match code (do not change the formula mid-hackathon).

**Priority:** High (docs) / Low (code)

### C10. Incident confidence still bills a deleted temporal detector

**Problem:** `confidenceFromSignals` adds `w.temporal` if `temporalScore >= temporalMin`. `buildIncident` never passes `temporalScore` → that 0.35 weight is always 0. Engine reasons are often only `['tgnn_embed']` which maps to **structural_anomaly**. `typePriority` still leads with `temporal_anomaly`.

**Why it matters:** Confidence looks arbitrary. Labels say Structural for a “temporal GNN.”

**Evidence:** `shared/incidents.js`; `server/detection/engine.js` reasons; `incident.js` `buildIncident`.

**Solution:** Drop temporal weight; confidence from isolation + drift + extras. Map `tgnn_embed` to a type you will say out loud (“graph-temporal”) or to behavioural.

**Implementation:** Trim `TRUST_CONFIG.incident.confidence.temporal` and typePriority. Enrich reasons with top metric keys already in evidence.

**Priority:** High

### C11. Spread is heuristic BFS, one primary hop

**Problem:** Trust cutoff 65; quarantine resistance 100. One `primarySpreadEdgeId`. Not epidemiology.

**Why it matters:** Looks like ML physics. Multi-origin attacks under-show blast radius.

**Evidence:** `server/detection/spread.js`. UI “Highest spread risk.”

**Solution:** Legend: “heuristic next hop.” Optional: union at-risk across seeds (small loop).

**Recommend:** Legend this week; multi-seed only if you have time.

**Priority:** Medium

### C12. Tick loop not serialized; two metric stores

**Problem:** `setInterval` 1s fires `emitTelemetryNow` without awaiting the previous tick. SQLite lookback vs Timescale dashboard can disagree.

**Why it matters:** Overlapping ticks / “dashboard dead, map live.”

**Evidence:** `server/telemetry/generator.js`. `server/metrics/store.js` vs tele-ingestion.

**Solution:** Mutex / skip if in flight. UI: ingest banner vs map. Pitch: SQLite = detector window; Timescale = SOC chart (if ingest on).

**Priority:** Medium

---

## D. Security (cyber judge)

### D1. Tele-ingestion has no auth; listens on all interfaces

**Problem:** POST snapshots / GET telemetry on `:3000` with no token. Detection **reads** that overlay.

**Why it matters:** Poisoned ingest = poisoned SOC. Venue LAN.

**Evidence:** `tele-ingestion` routes; `main` listen; `ingestionClient.js`.

**Solution:** Bind `127.0.0.1`; `INGEST_TOKEN` header from game server.

**Implementation:** Middleware + env. **Recommend bind even without token** for the venue.

**Priority:** High (do not claim production security; still bind)

### D2. HTTP `/rooms/:id/metrics` and `/detection` unauthenticated

**Problem:** Anyone who guesses `DEMO` can poll live samples.

**Evidence:** `server/index.js` GET handlers.

**Solution:** Don’t claim SOC access control. Optional join cookie — skip if time.

**Priority:** Medium

### D3. Attacker can patch `provenance` / `quarantined`

**Problem:** Playing-phase `graph:updateNode` merges those fields.

**Why it matters:** Injected node marked legitimate; quarantine cleared.

**Evidence:** `server/index.js` updateNode attacker branch.

**Solution:** Allowlist attacker: metrics + injected position/label. Strip provenance/quarantine unless defender.

**Priority:** High

### D4. `room:setCityContext` has no role/phase check

**Problem:** Any socket in the room can shift expected telemetry (mask anomalies). Viewport broadcast similarly loose.

**Evidence:** `server/index.js` `room:setCityContext`, `graph:setViewport`. CityContextMenu still opens when “locked.”

**Solution:** Defender-only context; disable in playing if that is the design.

**Priority:** Medium

### D5. `.env` not in `.gitignore`

**Problem:** Root `.gitignore` is sqlite/`server/data/` only. Groq keys can be committed.

**Evidence:** `.gitignore`; `ai-com-v1/.env` may exist locally.

**Solution:** Add `.env`, `**/.env`, keep `*.example`.

**Implementation:** Five minutes. Check `git status`.

**Priority:** Critical

### D6. Postgres `smartcity:smartcity_dev` and Qdrant `:6333` published

**Problem:** Default creds / no Qdrant auth on host ports.

**Solution:** `127.0.0.1:` bind or drop `ports` for venue. Don’t claim hardened infra.

**Priority:** Medium

### D7. No graph size cap; 5MB socket buffer

**Problem:** Huge `graph:load` can hang the browser.

**Solution:** Cap ~150 nodes / 400 edges.

**Priority:** Low

### D8. Do not claim “secure product”

**Problem:** Role checks on the game socket are real and worth showing. They are not IAM, TLS mutual auth, or tenant isolation.

**Solution:** Pitch: “closed-loop attacker/defender simulation with role-gated writes.” Show defender-only quarantine vs attacker overrides.

**Priority:** Critical (story)

---

## E. FinTech / smart city / product judges

### E1. No business impact / ₹ layer

**Problem:** Zero `businessImpact` / loss scoring. Finance YAML describes payments; detection is cyber residual + spread.

**Why it matters:** FinTech track: “this is IoT.”

**Evidence:** `overfit/city_model/infrastructue/finance/*.yaml` (5 files). Dashboard KPIs are PPS/HTTP/files/logins. `attackPresets.js` titles are generic floods.

**Solution:** If the track cares about finance: attack `core-banking-system` or `payment-processing-system`; one sentence “this hop sits on payment rails; traffic vs city-expected is X%.” Do not invent a risk engine.

**Implementation:** Preset targeting finance node ids from the city graph + inspector blurb from `sector === 'finance'`. Optional: click district pin → `fitView` finance cluster (`cityMap.js` `DISTRICT_ANCHORS.finance`).

**Recommend:** Messaging + one preset + fitView. Skip a full ₹ model.

**Priority:** High (if FinTech) / Medium (if city-cyber track)

### E2. Finance context multipliers mostly `default`

**Problem:** `SECTOR_TO_FAMILY` has `finance`, but many `TRUST_CONFIG.cityContext.multipliers` blocks omit `finance:` and use `default`.

**Why it matters:** Payment rails don’t get a distinct rush/event signature in the tables you might show.

**Solution:** Add `finance:` keys under rush_hour / major_event / night, or rely on YAML schedules and don’t show the JS tables.

**Priority:** Medium

### E3. Folder typo `infrastructue` / path aliases

**Problem:** On-disk typo; `city.yaml` lists `infrastructure/`; actor filename aliases.

**Why it matters:** Looks unfinished on screen share of the repo.

**Solution:** `git mv` when you can afford a one-shot; until then don’t open that folder on the projector.

**Priority:** Low (rename) / Medium (perception)

### E4. Smart city is real; “just IoT” is a positioning failure

**Problem:** Multi-sector twin (water, transport, healthcare, finance, …) + city contexts (rush, rain, event) + expected vs observed **is** the differentiator — and it is **under-sold** vs TGNN chrome.

**Why it matters:** Judges remember the last buzzword they heard (TGNN), not the actual product (city-expected telemetry).

**Solution:** Demo script order: **city clock / context → expected vs live → then** graph anomaly score → then one sentence of LLM.

**Priority:** Critical (demo script)

### E5. Features that waste demo time

**Problem:** Asset sidebar drag-drop, import/export (dead), snap-to-grid (dead), six detection taxonomy chips, Commander pending spinner, Map↔Dashboard remount.

**Solution:** Script: load city, set rush hour, attacker preset on finance/core, open inspector (expected vs observed), dashboard incidents + evidence. Skip taxonomy lecture.

**Priority:** High

---

## F. UX / demo reliability

### F1. Blank map on first paint

**Problem:** `/` does not set `loadDefault`. No empty-state CTA. Judges see Bengaluru tiles and zero nodes.

**Evidence:** `GraphCanvas.jsx` `forceDefaultOnMount`; `App.jsx` `/default` is the only auto-load route.

**Solution:** Auto-load when defender + lobby + `nodes.length === 0`.

**Priority:** Critical

### F2. “Waiting for the explainer to reconnect”

**Problem:** Attacker lobby copy is leftover nonsense.

**Evidence:** `src/pages/GamePage.jsx` ~200–203.

**Solution:** “Waiting for the other player.”

**Priority:** Critical

### F3. Inspector closed; no legend; “Attack origin” on every flag

**Problem:** Differentiator (trust breakdown, expected vs live) is hidden. Badges unexplained. Every anomaly is an “origin.”

**Evidence:** `defaultPanelsForRole` `inspectorOpen: false`. `InspectorPanel.jsx` `attackOrigin: flagged`. `InfrastructureNode.jsx` badges.

**Solution:** Inspector open for defender. Legend during `playing`. Label “Flagged” / “Anomaly seed.”

**Priority:** Critical (inspector + copy) / High (legend)

### F4. `LIVE` pip; TGNN chrome; isolation naming

**Problem:** LIVE = `socket.connected`. Isolation Forest implication. Neutral TGNN score 0.5 looks like “50% sure.”

**Evidence:** `GamePage.jsx`; `KpiStrip.jsx`; inspector TGNN % / threshold; `isolationScoresByNodeId` throughout.

**Solution:** “Connected” / “Match live” from `phase === 'playing'`. “Anomaly score (0.5 = no change).” Keep internal field names if time is short; **change visible strings**.

**Priority:** High

### F5. Fake `/play/:roomId`; always DEMO; FIFO seats

**Problem:** Share links lie. Third tab dead. Disconnect → seat theft.

**Evidence:** `App.jsx`; `useGameRoom.js` join; `server/index.js` `getOrCreateRoom(DEMO_ROOM_ID)`.

**Solution:** Delete route. Two-tab runbook. Spectator later.

**Recommend:** Delete route + runbook. Do not build nanoid rooms this week unless two teams demo on one laptop.

**Priority:** High

### F6. Dead import/export / localStorage / `startGame` / placeholders

**Problem:** Modals exist, never opened. Persist helpers unused. `startGame` unused. `placeholderIcons.jsx` unused. Snap state never toggled. `_exportGraph` underscored.

**Solution:** Delete or hide. Do not mention JSON IO.

**Priority:** Medium (cleanup) / High if a judge finds the modal code and asks

### F7. Standalone `/dashboard` empty; lobby dashboard quiet

**Problem:** Route looks like a product. Real dashboard needs roomId + playing + samples.

**Solution:** Redirect `/dashboard` to map, or disable tab until playing with tooltip.

**Priority:** High

### F8. Carto tiles / 96 requests; district pins decorative

**Problem:** Offline/venue Wi‑Fi → gray map. Finance pin does not focus the cluster.

**Evidence:** `src/features/graph/cityMap.js` `tileUrl`.

**Solution:** Fallback fill + district labels without tiles. Click finance → fitView.

**Recommend:** Fallback color this week; tile CDN is OK if venue net works (rehearse).

**Priority:** High (offline) / Medium (click-to-fit)

### F9. Dashboard unmounts React Flow

**Problem:** `paused` replaces canvas with empty div — viewport/selection loss.

**Solution:** CSS-hide canvas instead of unmounting.

**Priority:** Low

### F10. New edges labeled `API`

**Problem:** Every new link looks like a FinTech API.

**Evidence:** `GraphCanvas.jsx` `onConnect`.

**Solution:** Label “link” or empty.

**Priority:** Low

### F11. Trust jargon without tooltips

**Problem:** Intrinsic / Peer / Behavioural / Interaction.

**Solution:** “Type / Neighbors / Traffic vs expected / Links.” `title=` one-liners.

**Priority:** High

---

## G. Architecture / startup / scale

### G1. `npm start` fails closed without Docker + Ollama

**Problem:** Pulls 7B; waits for Commander; Postgres 5432 clashes common.

**Evidence:** `scripts/start-stack.mjs`.

**Solution:** Venue boot: `npm run dev:all` (+ Commander if already up). Document `--no-ingest`. Pre-pull model the night before.

**Priority:** Critical

### G2. In-memory rooms; refresh kills the match

**Problem:** `roomStore.js` Map. Process restart = empty DEMO. Both disconnect → telemetry teardown + sqlite delete.

**Solution:** Don’t refresh mid-demo. Don’t claim durability.

**Priority:** High (ops) / Low (code persist)

### G3. Not scalable; browser will die on full twin + client TGNN

**Problem:** 1 Hz ticks, React Flow, optional client forward pass, 1s dashboard poll.

**Solution:** Never claim scale. Cap nodes. Server detection only in play.

**Priority:** Medium

### G4. Three `.env` worlds

**Problem:** Misconfig → silent Commander/ingest failure.

**Solution:** README table: required vs optional. start-stack already copies examples.

**Priority:** Medium

---

## H. Things we forgot (judge questions, edges, competitors)

Prepare answers. Do not invent capabilities.

| Judge question | Honest answer |
|---|---|
| Is the TGNN trained? | No. Deterministic graph embedder + city-expected residual. |
| Where is RAG? | `/analyze` only; live UI is `/explain`. We may not run RAG on stage. |
| Show a citation. | Only if Deep Analyze + Qdrant populated. Otherwise show **numeric evidence**. |
| Where is the rupee? | Not computed. Finance is a sector in the twin; we show traffic vs expected on payment/core-banking nodes. |
| Can I poison telemetry? | Yes: stay under 10% drift; or hit ingest if exposed. We gate on a clear break from expected. |
| Does moving the attack slider flag the node? | **Today yes via `runtimeRisk` — fix before judging.** After fix: only if metrics break expected. |
| Why 0.58? | Operating point on sigmoid L2 distance, not a learned threshold. |
| What does LIVE mean? | Websocket (until we relabel). |
| What if the backend dies? | In-memory room gone; UI OFF; last detection may freeze. Restart stack. |
| Multiple attacks? | Multiple seeds can flag; spread UI emphasizes one primary hop. |
| Large topology? | Not the demo. We cap / use the city default graph. |
| Isolation Forest? | No. Bad field name for embedding distance. |
| Auth? | Role-gated simulation, not production IAM. |
| Competitor with a real trained GNN? | We win on **city-expected vs observed + live attacker/defender**, not on SOTA ML. Lean into that. |
| Competitor with a FinTech dashboard? | We need the finance camera + one impact sentence or we lose that track. |

**Missing explanations:** expected vs observed (hero this). Trust four-way blend (tooltips). Spread = heuristic.

**Missing data:** business impact; RAG chunks on live path; trained weights; per-room isolation.

**Failure modes:** Commander timeout → templates; ingest wrong tick → wiped attack (C3); empty graph start (C5); third browser (F5); tile CDN down (F8).

---

## Ranked lists

### CRITICAL

- A1 TGNN overclaim + C1 feature leak  
- A2/A3/A4 stale / RAG docs  
- B1 live AI is not RAG  
- C2 YAML dim / ghost nodes  
- C3 ingest overlay wipes attacks  
- C4 attacker `sim:patch` baselines  
- C5 empty auto-start / load wipes attack  
- D5 `.env` gitignore  
- D8 / E4 positioning (city-expected, not SOC-grade / not FinTech engine)  
- F1 blank map  
- F2 explainer copy  
- F3 inspector closed  
- G1 boot path  

### HIGH

- B2–B5 Commander labeling, timeouts, open port, injection  
- C6 classifier AND  
- C7 client fake temporal  
- C8/C10 confidence + 10% gate messaging  
- C9 peer formula docs  
- D1 ingest bind  
- D3 provenance patch  
- E1 finance story if that track  
- F4–F7 LIVE/TGNN/dashboard/rooms  
- F8 map offline  
- F11 trust labels  
- E5 demo-time waste  

### MEDIUM

- B6–B8 analyze-only bugs, health, mocks  
- C11–C12 spread / ticks / dual stores  
- D2/D4/D6 HTTP metrics, cityContext, DB ports  
- E2 finance multipliers  
- F6 dead code deletion  
- G3–G4 scale/env docs  

### LOW

- A5 package rename  
- D7 graph cap  
- E3 folder rename (unless you screen-share `overfit/`)  
- F9–F10 canvas remount, edge “API”  
- Snap-to-grid, placeholder icons  

---

## What we should fix first

See **WHAT WE SHOULD DO NOW**. That list is the only order that matters.

## What we can ignore (this hackathon)

- Training a real TGNN / PyG pipeline  
- Production IAM, mTLS, rate limits beyond localhost bind  
- Redis multi-room / horizontal scale  
- Full RAG corpus ingest **unless** you will demo `/analyze`  
- Campaign HTTP API  
- Unifying SQLite + Timescale  
- Offline vector basemap pack if venue net is proven  
- Spectator mode / nanoid rooms (unless two demos share one server)  

## Anything we should remove

- `SYSTEM_REPORT.txt` from judging surface (archive)  
- `TRUST_AND_ANOMALY_REPORT.md` as truth (stale stamp)  
- Fusion/temporal language in old audits  
- UI: TGNN as product name; “Attack origin” for every flag; “explainer to reconnect”; LIVE = socket  
- Dead: `_exportGraph` / persist helpers / unused `startGame` / `placeholderIcons.jsx` if you have 20 minutes  
- Route `/play/:roomId`  
- Pitch: trained model, RAG-on-live, FinTech risk engine, autonomous response, scalable SOC  

## Anything we should add

- `.gitignore` `**/.env`  
- Auto-load city graph  
- `startMatch` requires nodes  
- Attacker patch allowlist (overrides only)  
- Strip `runtimeRisk` game flags  
- Overlay merge from produced + re-apply overrides  
- Filter yaml-only endpoints from detection  
- Waiting-copy + inspector default + legend  
- Honest one-pager (city expected vs observed)  
- Finance preset + fitView if FinTech  
- Localhost bind ingest/Commander  

## Anything we should change in the demo

1. Two browsers only. Defender first. Confirm city graph **before** the attacker joins (or auto-load).  
2. City context: rush hour or major event so “expected” is visible.  
3. Attacker: **preset** on core banking or payment processor — not a 5% slider.  
4. Click the node: inspector **expected vs observed** numbers. Trust rows with plain labels.  
5. Defender: dashboard incidents — **evidence list first**, explanation second. Say “paraphrase of those numbers,” not RAG.  
6. One quarantine to show spread resistance.  
7. Never: cold `/dashboard`, never `npm start` first time on stage, never third tab, never “our trained TGNN.”  

## Anything we should change in claims / story

**Lead:** Simulated Bengaluru multi-sector city twin. Traffic is judged against **city-context expected** (rush, night, rain, event), not a global static baseline. Graph embedding scores **contextual residual**. Humans play attacker vs defender on the same live graph.

**Do not lead:** TGNN. RAG. FinTech. Isolation Forest. Real-time SOC platform. Trained ML.

**If asked FinTech:** Finance is a **critical sector in the twin** (core banking, payments, ATM gateway). We show blast along dependencies and deviation from expected load — not a bank-grade risk engine.

**If asked cyber:** Role-gated simulation, not production security. Detection must not use the attack slider as a feature (fix C1).

**If asked AI:** LLM optional narrative grounded in Level-1 evidence. RAG exists off the live path.

---

## WHAT WE SHOULD DO NOW

Actionable Cursor order. Stop when the demo is honest and cannot blank-screen.

1. **Fix F2** — GamePage attacker waiting copy → “Waiting for the other player.”  
2. **Fix D5** — `.gitignore` add `.env` and `**/.env`.  
3. **Fix F1 + C5** — Auto-load default city in empty defender lobby; `startMatch` no-op if `nodes.length === 0`.  
4. **Fix C4** — Attacker `sim:patch` merge overrides only; never replace baselines/`active`.  
5. **Fix C3** — Overlay from `produced` + re-apply overrides after ingest GET.  
6. **Fix C1** — Remove quarantined / injected / `attackOverrideActive` from `runtimeRiskOf` (and under_attack selection for features).  
7. **Fix C2** — Detection input = canvas endpoints only; freeze TGNN to game metric channels.  
8. **Fix A1/F4** — UI strings: Anomaly score, Connected/Match live, 0.5 = no change; drop Isolation implication.  
9. **Fix F3** — Defender inspector open by default; rename Attack origin; add 4-row legend.  
10. **Fix B2 + demo script** — Evidence first; “AI” chip only if Commander `ready` from `/explain`; never mark Ollama as Commander.  
11. **Fix A2/A3/A4** — STALE banners or remove SYSTEM_REPORT + anomaly report from packet; README: live path is `/explain`, not RAG.  
12. **Fix F5** — Remove `/play/:roomId` redirect theater (or comment “unused”).  
13. **Fix E1** — One finance-targeted preset + sector sentence; optional fitView finance.  
14. **Fix D1/B4** — Bind tele-ingestion + Commander to `127.0.0.1` for venue.  
15. **Fix D3** — Strip attacker provenance/quarantine patches.  
16. **Fix C10** — Drop dead temporal confidence; map `tgnn_embed` to a name you will say.  
17. **Fix C7** — Do not run client TGNN while `phase === 'playing'`.  
18. **Fix G1** — Printed venue boot: `npm run dev:all` / `--no-ingest`; Groq key; two tabs; no cold Docker.  
19. **Optional C6** — Classifier OR if you will mention 0.50/spread knobs.  
20. **Optional B1-B** — Deep Analyze **only** after Qdrant count > 0 and Groq < 5s in rehearsal.  
21. **Cleanup F6** — Delete unused export/persist/`startGame` UI contract / placeholder icons.  
22. **Ignore** — Training TGNN, production auth, multi-tenant rooms, ₹ engine, campaign API.

**Do not** rewrite the detection stack. **Do not** wire RAG until 1–18 are done. **Do not** open the old red-team audit as the punch list (fusion is gone; C1 is the leftover cheat).
