# TrustNetAI — current architecture (hackathon V1)

Live path: simulated telemetry overlay → Timescale ingest (optional) → graph residual detector (14-d GNN encoder, 8-d embed, 3-frame concat, idle-window calibrator, hard gates) → four-component trust (25/30/25/20) → reachability spread (trust cutoff 65) → incident promotion with numeric evidence → Socket.IO `state:sync` → React graph + SOC.

- YAML city: 46 endpoints under `overfit/city_model/`. Live canvas: catalog type-graph (~69 nodes).
- Game metrics: pps / HTTP / files / failed logins. Encoder does not ingest YAML payment channels.
- Commander: incident lists still use `POST /commander/explain` (no RAG). Campaign briefing uses `POST /commander/analyze` and stores `commanderBriefing` on `state:sync`. City posture is deterministic. Q&A is `POST /rooms/:id/commander/ask` over the snapshot. `incidentId`-only `/analyze` still hits mock INC-001 — do not demo that.
- Session: one in-memory `DEMO` two-role room.
- Campaigns apply preset metric overrides; stories are assessment overlays, not a second detector.
- Persistence: Timescale for ingest; SQLite `server/data/metrics.sqlite` for lookback/campaigns.

Do not open `docs/archive/` as the product description.
