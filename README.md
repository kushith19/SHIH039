# TrustNetAI (smarthackathon)

Browser-based IoT topology lab with trust scoring, live-match attack simulation, and **2-player multiplayer** (defender vs attacker) in a **single shared session**.

## Quick start

```bash
npm install
cd server && npm install && cd ..
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173). The game server must be running (port 3001).

### Live telemetry (tele-ingestion)

During a match the game server **generates** jittered city snapshots each second, **POSTs** them to tele-ingestion, then **reads** `GET /api/telemetry/recent` for detection, the dashboard, the graph, and AI incident evidence.

```bash
cd tele-ingestion
docker compose up -d
pnpm install
pnpm db:init
```

Keep that Compose stack running (API on **port 3000**, Timescale on **5432**). Then start TrustNet (`npm run dev:all`). No separate friend generator is required. Override the URL with `TELE_INGESTION_URL` if needed (`http://127.0.0.1:3000` by default).

Or run frontend and server in separate terminals:

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
npm run dev
```

### Play flow

There is one shared session. No room codes.

1. **You (explainer):** open the app. You are assigned **defender**. Load **Default architecture**, pick the detection model, and build or walk through the topology.
2. **Judge (or second window):** open the **same URL** in another browser, tab, or device. They are assigned **attacker**.
3. When both are connected, the match starts automatically (`playing` phase).
4. **Attacker:** select a node and use the **Inspector** or **Attack tools** presets (traffic flood, data exfiltration, API abuse, credential spray). Spike packets/s, HTTP requests, file downloads, or failed logins. Drop **rogue** devices from **Attack tools** and wire them into the mesh.
5. **Defender:** watch trust/anomaly colors; select suspicious nodes → **Quarantine**.

A third client is rejected (session full). If both disconnect, the next pair starts a fresh session.

### Production deploy

- **Frontend:** build with `npm run build`, host static files (Vercel, Netlify, etc.).
- **Server:** deploy `server/` (Render, Fly, Railway, etc.) and set `CLIENT_ORIGIN` to your frontend URL.
- **Frontend env:** set `VITE_WS_URL` to your server origin (e.g. `https://your-api.onrender.com`). Leave empty in dev to use the Vite proxy to `localhost:3001`.

## Routes

| Path | Description |
|------|-------------|
| `/` | Live session (first client = defender, second = attacker) |
| `/play` | Same session |
| `/play/:roomId` | Redirects to `/play` |
| `/default` | Same session, loads default topology when the graph is empty |
| `/dashboard` | Static demo KPIs (live metrics when opened from a match as defender) |

## Stack

React 19, Vite, React Flow, Tailwind, client-side TGNN anomaly detection, Socket.IO (multiplayer).
