# Dashboard UI Inventory (Current Implementation)

**Purpose.** Accurate baseline of the **current** Dashboard frontend before any redesign.  
**Scope.** Inspected from source as of this document. No redesign recommendations.  
**Entry surface.** Defender match view with `?view=dashboard` mounts `DashboardPage` inside `GamePage`. Route `/dashboard` redirects to `/` (`App.jsx`).

**Audit note.** Several files under `src/features/dashboard/` exist but are **not mounted** by `DashboardPage` today. They are listed in [Orphan / unmounted dashboard modules](#orphan--unmounted-dashboard-modules) so redesign work does not confuse them with live UI.

---

## Complete component hierarchy

```
GamePage (host shell — Map/Dashboard toggle; not part of Dashboard chrome)
└── DashboardPage                          src/pages/DashboardPage.jsx
    ├── [no roomId] Empty path
    │   ├── PageHeader                     src/ui/PageHeader.jsx
    │   └── EmptyState                     src/ui/EmptyState.jsx
    │
    └── [with roomId] Live path
        ├── DashboardNav                   src/features/dashboard/DashboardNav.jsx
        ├── PageHeader                     src/ui/PageHeader.jsx
        │   └── [optional] filter clear button (inline)
        ├── Banner(s)                      src/ui/Banner.jsx   ← Overview panel only
        └── Panel body (URL ?panel=)
            ├── overview → OverviewPanel   src/features/dashboard/OverviewPanel.jsx
            │   ├── MiniSpark (local)      Recharts LineChart
            │   ├── SectionLabel (local)
            │   ├── RiskBar (local)
            │   ├── StageDot (local)
            │   └── StatusBadge            src/ui/StatusBadge.jsx
            │
            ├── fleet → EndpointTable      src/features/dashboard/EndpointTable.jsx
            │   ├── Toolbar                src/ui/Toolbar.jsx
            │   ├── Sparkline (local)      SVG polyline
            │   ├── StatusBadge
            │   └── EmptyState
            │
            ├── incidents → IncidentsPanel src/features/dashboard/IncidentsPanel.jsx
            │   ├── Toolbar + FilterChip   src/ui/Toolbar.jsx
            │   ├── QueueRow (local)
            │   │   └── StatusBadge
            │   ├── EmptyState
            │   ├── IncidentCard           src/features/dashboard/IncidentCard.jsx
            │   │   └── StatusBadge
            │   ├── HistoryIncidentTimeline src/features/dashboard/HistoryIncidentTimeline.jsx
            │   │   ├── StatusBadge
            │   │   └── EmptyState
            │   └── CampaignIntelligence   src/features/dashboard/CampaignIntelligence.jsx
            │       └── StatusBadge
            │
            ├── commander → CommanderPanel src/features/commander/CommanderPanel.jsx
            │   ├── [focusIncidentId set] Incident path
            │   │   ├── IncidentCommanderAgent
            │   │   │   ├── StatusBadge, FilterChip
            │   │   │   ├── InvestigateView (local)
            │   │   │   │   ├── Block (local)
            │   │   │   │   └── GraphImpactBlock (local)
            │   │   │   ├── RespondView (local)
            │   │   │   └── KnowledgeSection (local)
            │   │   └── CommanderInput     (Investigate mode only)
            │   │       ├── FollowUpInline / FollowUpAnswer (local)
            │   │       └── suggestion chips / chat form
            │   └── [no focusIncidentId] Room briefing path
            │       ├── ThreatSummary
            │       ├── HeroStat (local) ×4 (city posture)
            │       ├── RiskBreakdown
            │       ├── FilterChip section tabs
            │       ├── EvidenceCards → EmptyState
            │       ├── MitreCandidateCard
            │       ├── GraphImpactPanel   (receives graphContext prop; reads localBlurb only)
            │       ├── ResponsePlan → ResponseStep → SafetyStatus
            │       ├── InvestigationQueue
            │       ├── Financial impact <section> (inline, if briefing.financialImpact)
            │       ├── KnowledgeCitation
            │       └── CommanderInput     (unfocused ask)
            │
            └── response → ResponseConsolePanel src/features/response/ResponseConsolePanel.jsx
                ├── [no focusIncidentId] EmptyState (+ Link to Incidents)
                └── ResponseConsole        src/features/response/ResponseConsole.jsx
                    └── StatusBadge
```

**Supporting non-UI modules used by Dashboard (not React components):**

| Module | Path | Role |
|---|---|---|
| `dashboardPanels.js` | `src/features/dashboard/dashboardPanels.js` | Panel IDs, copy, URL href builders |
| `metrics.js` | `src/features/dashboard/metrics.js` | Telemetry series / formatting helpers |
| `overviewView.js` | `src/features/dashboard/overviewView.js` | Overview view-model (`buildOverviewModel`) |
| `historyTimelineView.js` | `src/features/dashboard/historyTimelineView.js` | History timeline event shaping |
| `campaignIntelligenceView.js` | `src/features/dashboard/campaignIntelligenceView.js` | Campaign visibility filter |
| `commanderBriefing.js` | `src/features/commander/commanderBriefing.js` | Briefing normalize |
| `commanderFollowUp.js` | `src/features/commander/commanderFollowUp.js` | Follow-up ask helpers |
| `commanderIntelApply.js` / `commanderIntelSyncKey.js` | commander/ | Intel fetch identity / merge |
| `responseConsoleView.js` | `src/features/response/responseConsoleView.js` | Execute wiring + display helpers |
| Shared: `cityContext.js`, `incidents.js`, `incidentIntel.js`, `riskMomentum.js`, `financialExposure.js`, `commanderIncidentIntel.js` | `shared/` | Contracts / pure transforms |

---

## DASHBOARD PAGE STRUCTURE

### Host chrome (outside `DashboardPage`, still visible)

When defender selects **Dashboard** in `GamePage` header:

1. **App header** (`GamePage`): brand, role, Map | Dashboard toggle, tick/calibration status pips, connection status, panel toggles (assets/inspector — map side panels; graph remains mounted but `hidden` / paused).
2. **Dashboard body** replaces the map layout visually (`isDashboardView`).

### Within `DashboardPage` (left → right, top → bottom)

**Layout shell**

- **Left / top nav:** `DashboardNav` — horizontal scroll on mobile; vertical sidebar (`md:w-56`) on desktop. Five panel links: Overview, Commander, Fleet, Incidents, Response. Incidents shows live count badge.
- **Right content column:**
  - **PageHeader** — panel title + blurb from `DASHBOARD_PANEL_COPY`; optional endpoint filter chip (“Clear”) when `filterId` set.
  - **Main scroll region** (Commander uses flex overflow instead of page scroll).

**Per-panel content**

| Panel (`?panel=`) | Visual structure (top → bottom) |
|---|---|
| **overview** (default) | Status banners → Mesh posture hero + 4 KPI cells → Active threat (3 cols) + Risk trajectory (2 cols) → Attack path (3) + Business impact (2) → Response status + Telemetry health → Active conditions strip |
| **fleet** | Search toolbar → endpoint table (Node, Type, PPS/HTTP/Files/Logins, spark vs expected, State) |
| **incidents** | Detection-type filter chips → Live incident stream list → Selected incident detail (`IncidentCard`) → History timeline \| Campaign intelligence (2-col on large screens) |
| **commander** | Either incident-focused agent UI + sticky follow-up input, or room-level briefing (threat summary, risk breakdown, section tabs, sticky ask) |
| **response** | Empty state (pick incident) or Response Console (current state \| actions + status footer) |

**Empty room (`!roomId`)** — full-page header + empty state only (not used from live `GamePage`, which always passes a room id).

---

## Component catalog

For each live component: fields 1–20 as requested.

### DashboardPage

1. **Name:** `DashboardPage`  
2. **File:** `src/pages/DashboardPage.jsx`  
3. **Parent:** `GamePage` (when `view=dashboard`); theoretically standalone if given props  
4. **Children:** `DashboardNav`, `PageHeader`, `Banner`, `EmptyState`, `OverviewPanel` \| `EndpointTable` \| `IncidentsPanel` \| `CommanderPanel` \| `ResponseConsolePanel`  
5. **Purpose:** Live-room SOC dashboard shell: telemetry fetch, fleet row derivation, panel routing, shared endpoint filter  
6. **User sees:** Nav + panel header + one panel body; or empty “Open as defender”  
7. **Data displayed:** Indirect — feeds panels with nodes, detection, incidents, telemetry rows, PPS series, feed status  
8. **Data from:** Props from `GamePage` / `useGameRoom` (`state:sync`); HTTP `GET /rooms/:roomId/metrics` every 1s  
9. **Props:** `roomId`, `phase`, `tick`, `nodes`, `edges`, `detection`, `cityContext`, `cityContextLocked`, `simHour`, `connected`, `ingestionStatus`, `hackSimulator`, `commanderBriefing`, `cityPosture`  
10. **State/hooks:** `samples`, `fetchError`, `feedStatus`, `filterId`; refs `heldPctRef`, `tickRef`; many `useMemo` for rows/series; `useSearchParams` for `panel` / `incident`  
11. **APIs:** `GET /rooms/:id/metrics?fromTick=0&toTick=…`  
12. **Context/store:** URL search params; no React Context. Room state via props from Socket.IO  
13. **Events:** Clear filter; panel switch via nav links; endpoint filter toggled by child callbacks  
14. **Conditional:** `!roomId` empty; panel switch; banners only on overview; commander layout class differs  
15. **Loading/empty/error:** `fetchError` banner; feed down/empty banners; lobby banner; no-samples banner; empty room EmptyState  
16. **Real-time:** Props update on `state:sync`; metrics poll 1s; `tick` bounds samples and row expected-load math  
17. **Reusable:** Page-level; reusable as embedded panel host  
18. **Kinds:** navigation + informational shell; orchestrates metric/KPI, incident, Commander, financial (via children)  
19. **Layout role:** Root composition / panel router  
20. **Duplication:** Status banners overlap Telemetry health inside Overview; incident/risk/finance also appear in Incidents/Commander/Response

---

### DashboardNav

1. **Name:** `DashboardNav`  
2. **File:** `src/features/dashboard/DashboardNav.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children:** none (Lucide icons + `Link`)  
5. **Purpose:** Switch among five dashboard panels via URL  
6. **User sees:** Overview / Commander / Fleet / Incidents / Response; incident count on Incidents  
7. **Data:** `panel`, `incidentCount`  
8. **From:** Parent props; hrefs from `dashboardPanelHref`  
9. **Props:** `panel`, `incidentCount`  
10. **Hooks:** `useSearchParams`  
11. **APIs:** none  
12. **Context:** URL only  
13. **Events:** Navigate (replace) to `?view=dashboard&panel=…` (overview drops `panel`; non-commander/response drops `incident`)  
14. **Conditional:** Active styling; count badge if `> 0`  
15. **Empty/error:** none  
16. **Real-time:** Count updates when parent incidents change  
17. **Reusable:** Dashboard-specific  
18. **Kinds:** navigation  
19. **Layout role:** Left/top persistent nav  
20. **Duplication:** Panel names also appear as PageHeader titles

---

### PageHeader (shared UI)

1. **Name:** `PageHeader`  
2. **File:** `src/ui/PageHeader.jsx`  
3. **Parent:** `DashboardPage` (also usable elsewhere)  
4. **Children:** optional `actions`, `children`  
5. **Purpose:** Page title + subtitle + action slot  
6. **User sees:** Panel label/blurb; optional selected-endpoint clear control  
7. **Data:** title/subtitle from `dashboardPanelMeta`  
8. **From:** `dashboardPanels.js` copy  
9. **Props:** `title`, `subtitle`, `actions`, `children`  
10. **Hooks:** none  
11–12. none  
13. **Events:** via actions slot  
14–16. none special  
17. **Reusable:** yes (shared UI)  
18. **Kinds:** informational / navigation chrome  
19. **Layout role:** Top of content column  
20. **Duplication:** Subtitle overlaps Overview section labels conceptually

---

### Banner (shared UI)

1. **Name:** `Banner`  
2. **File:** `src/ui/Banner.jsx`  
3. **Parent:** `DashboardPage` (overview status stack)  
4. **Children:** text  
5. **Purpose:** Status / warning messages for ingest and match phase  
6. **User sees:** Fetch errors; tele-ingestion down/empty; no tick-aligned samples; lobby waiting  
7. **Data:** strings from parent conditions  
8. **From:** `fetchError`, `feedStatus`, `phase`, `sampleTicks`  
9. **Props:** `tone`, `children`  
17. **Reusable:** yes  
18. **Kinds:** status/alert  
19. **Layout role:** Above Overview body only  
20. **Duplication:** Overlaps Overview “Telemetry health”

---

### EmptyState (shared UI)

1. **Name:** `EmptyState`  
2. **File:** `src/ui/EmptyState.jsx`  
3. **Parents:** `DashboardPage`, `EndpointTable`, `IncidentsPanel`, `HistoryIncidentTimeline`, `EvidenceCards`, `ResponseConsolePanel`  
5. **Purpose:** Centered empty / CTA messaging  
17. **Reusable:** yes  
18. **Kinds:** informational / navigation (when action link present)

---

### OverviewPanel

1. **Name:** `OverviewPanel`  
2. **File:** `src/features/dashboard/OverviewPanel.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children (local):** `MiniSpark`, `SectionLabel`, `RiskBar`, `StageDot`; shared `StatusBadge`; React Router `Link`  
5. **Purpose:** SOC command-center posture — threat, risk trajectory, path, business impact, response lifecycle, telemetry, quick signals. Navigation only (no execute)  
6. **User sees:** Eight sections described in page structure  
7. **Data:** posture, stats, primary incident + metric evidence, detection tags, risk momentum series/score, attack path, finance exposure, lifecycle stages, telemetry health, quick signals, primarySpreadNodeId  
8. **From:** `buildOverviewModel(...)` in `overviewView.js` over props (`detection`, `nodes`, `edges`, `incidents`, `rows`, feed/phase/ticks, `pps`) + `computeFinancialExposure` / `riskMomentum` from detection  
9. **Props:** `detection`, `nodes`, `edges`, `incidents`, `rows`, `feedStatus`, `phase`, `sampleTicks`, `fetchError`, `pps`, `onSelectEndpoint`  
10. **Hooks:** `useSearchParams`, `useNavigate`; pure model build each render  
11. **APIs:** none directly  
12. **Context:** URL for commander/response/incidents hrefs  
13. **Events:** Select endpoint; navigate to Incidents / Commander / Response; click threat card  
14. **Conditional:** Primary incident vs system clear; path active vs none; finance lakhs; lifecycle stage states; primary spread footer  
15. **Empty:** System clear / no propagation copy  
16. **Real-time:** Recomputes when detection/nodes/rows/tick-driven props change  
17. **Reusable:** Dashboard Overview-specific (large composite)  
18. **Kinds:** informational, interactive (nav), metric/KPI, status/alert, visualization (sparks/bars), incident-related, financial/economic, graph/network (path list — not React Flow), Commander-related (links only)  
19. **Layout role:** Primary overview composition (max-w-7xl stacked sections)  
20. **Duplication:** Incident summary vs Incidents panel; path vs IncidentCard; finance vs FinancialExposureCard (unmounted) and Commander finance; risk vs RiskMomentumCard (unmounted) / KpiStrip (unmounted)

**Local subcomponents**

| Subcomponent | Purpose | User sees |
|---|---|---|
| `MiniSpark` | Tiny Recharts spark for risk series | Line spark or elevated placeholder |
| `SectionLabel` | Uppercase section eyebrow | Label text |
| `RiskBar` | 0–100 meter | Colored width bar |
| `StageDot` | Lifecycle stage glyph | ✓ / pip / ring / muted |

---

### EndpointTable (Fleet panel)

1. **Name:** `EndpointTable`  
2. **File:** `src/features/dashboard/EndpointTable.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children:** `Toolbar`, `Sparkline` (local SVG), `StatusBadge`, `EmptyState`  
5. **Purpose:** Per-endpoint live vs catalog telemetry table; select endpoint filter  
6. **User sees:** Searchable sorted table; rail colors; % vs expected; Ok/Flag/Drift/Hold/Catalog badges  
7. **Data:** row fields from parent: label, type, pps/http/files/logins, spark[], ppsVsExpected, anomaly, quarantined, catalogBaseline  
8. **From:** `DashboardPage` rows (metrics + baselines + detection anomaly ids)  
9. **Props:** `rows`, `sparkDomain`, `filterId`, `onSelect`, `hideHeader`  
10. **State:** local `query` search  
11–12. none  
13. **Events:** row click → `onSelect`; search input  
14. **Conditional:** selected/anomaly/drift row backgrounds; catalog shows `—` for metrics  
15. **Empty:** EmptyState when no nodes / no search matches  
16. **Real-time:** Rows refresh with parent poll + sync  
17. **Reusable:** Could embed elsewhere; currently dashboard Fleet  
18. **Kinds:** interactive, metric/KPI, visualization (spark), status/alert, informational  
19. **Layout role:** Full fleet panel body  
20. **Duplication:** Endpoint PPS also summarized in Overview telemetry; anomaly flags overlap incidents

---

### IncidentsPanel

1. **Name:** `IncidentsPanel`  
2. **File:** `src/features/dashboard/IncidentsPanel.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children:** `Toolbar`/`FilterChip`, `QueueRow`, `IncidentCard`, `HistoryIncidentTimeline`, `CampaignIntelligence`, `EmptyState`, `StatusBadge`  
5. **Purpose:** Live promoted detections + detail + persisted history/campaigns  
6. **User sees:** Type filters; live stream; selected detail; timeline; campaign intelligence  
7. **Data:** live `incidents`; history incidents/campaigns from HTTP; `primarySpreadNodeId`  
8. **From:** props (`detection.incidents`); `GET .../incidents/campaigns` + `GET .../incidents/history?order=` every 2s  
9. **Props:** `roomId`, `incidents`, `nodes`, `primarySpreadNodeId`, `onSelectEndpoint`, `hideHeader`  
10. **State:** `typeFilter`, `selectedKey`, `historyCampaigns`, `historyIncidents`, `historyOrder`, `timelineFocusId`  
11. **APIs:** campaigns + history endpoints  
12. **Context:** none  
13. **Events:** filter chips; select stream row; timeline select syncs live selection when match found  
14. **Conditional:** empty stream; next-target purple rail; selected styling  
15. **Empty:** EmptyState for live stream; timeline/campaign empty copy  
16. **Real-time:** Live list from `state:sync`; history poll 2s; reload when `incidents.length` or order changes  
17. **Reusable:** Dashboard Incidents-specific composite  
18. **Kinds:** incident-related, interactive, status/alert, informational, financial (via IncidentCard), Commander-related (links)  
19. **Layout role:** Full incidents panel  
20. **Duplication:** Primary threat on Overview; history vs live stream; campaign id also on cards/commander

#### QueueRow (local)

- **Purpose:** One live incident list button  
- **Shows:** endpoint, severity badge, detection type, explanation preview, optional “Next target”  
- **Data:** incident object + selection flags  
- **Interactive:** click to select

---

### IncidentCard

1. **Name:** `IncidentCard`  
2. **File:** `src/features/dashboard/IncidentCard.jsx`  
3. **Parent:** `IncidentsPanel`  
4. **Children:** `StatusBadge`, Links to Commander/Response  
5. **Purpose:** Detail for selected live incident — risk/trust/exposure, why it matters, path, next target, signals, related  
6. **User sees:** Severity/status; metrics; narrative sections; CTA links  
7. **Data:** incident fields + derived via `incidentIntel` (`primaryAttackPath`, `riskPercent`, `keySignals`, `whyItMatters`); `financialContext`; `primarySpreadNodeId`  
8. **From:** parent incident + nodes + detection spread id  
9. **Props:** `inc`, `nodes`, `primarySpreadNodeId`, `onSelectEndpoint`  
10. **Hooks:** `useSearchParams` for hrefs  
11. **APIs:** none  
13. **Events:** endpoint / next-target click; navigate Commander/Response with `?incident=`  
14. **Conditional:** money line; path length; next target; related; campaignId  
17. **Reusable:** incident detail widget (dashboard-scoped today)  
18. **Kinds:** incident-related, interactive, financial, graph/network (path text), Commander-related, metric/KPI  
19. **Layout role:** Middle detail pane of Incidents  
20. **Duplication:** Strong overlap with Overview active threat + attack path + business impact + Commander incident context

---

### HistoryIncidentTimeline

1. **Name:** `HistoryIncidentTimeline`  
2. **File:** `src/features/dashboard/HistoryIncidentTimeline.jsx`  
3. **Parent:** `IncidentsPanel`  
4. **Children:** `StatusBadge`, `EmptyState`  
5. **Purpose:** Chronology of **persisted** match incidents (not live stream)  
6. **User sees:** Vertical timeline of history events with severity/status/type/summary/exposure/campaign  
7. **Data:** events from `historyEventsFromIncidents` + campaign annotation  
8. **From:** parent history arrays (HTTP)  
9. **Props:** `incidents`, `campaigns`, `order`, `selectedKey`, `selectedIncidentId`, `onSelectEvent`  
13. **Events:** click event → parent `onSelectEvent`  
15. **Empty:** EmptyState  
17. **Reusable:** dashboard history widget  
18. **Kinds:** incident-related, interactive, informational, financial (exposure labels)  
19. **Layout role:** Left secondary column under live stream  
20. **Duplication:** Overlaps live stream; distinct from unmounted `IncidentTimeline.jsx` (kind-based storytelling timeline)

---

### CampaignIntelligence

1. **Name:** `CampaignIntelligence`  
2. **File:** `src/features/dashboard/CampaignIntelligence.jsx`  
3. **Parent:** `IncidentsPanel`  
4. **Children:** `StatusBadge`  
5. **Purpose:** Display backend-correlated campaigns (no client-side scoring)  
6. **User sees:** Campaign status/severity, time span, services, sequence, correlation reasons  
7. **Data:** filtered campaigns (`visibleHistoryCampaigns` requires ≥2 incidents)  
8. **From:** history campaigns HTTP  
9. **Props:** `campaigns`  
15. **Empty:** “No correlated campaign yet…”  
17. **Reusable:** dashboard secondary pane  
18. **Kinds:** incident-related, informational  
19. **Layout role:** Right secondary column  
20. **Duplication:** Campaign ids also shown on IncidentCard / Commander

---

### CommanderPanel

1. **Name:** `CommanderPanel`  
2. **File:** `src/features/commander/CommanderPanel.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children:** See hierarchy — briefing mode components or `IncidentCommanderAgent` + `CommanderInput`  
5. **Purpose:** AI Commander decision-support UI (not the detector). Room briefing **or** per-incident investigate/respond  
6. **User sees:** Depends on `?incident=` focus  
7. **Data:** `commanderBriefing`, `cityPosture`, `incidents`, fetched commander-context + incident-intel  
8. **From:** props (`state:sync` briefing/posture); `GET .../commander-context`; `POST .../commander/incident-intel`  
9. **Props:** `roomId`, `briefing`, `posture`, `incidents`, `focusIncidentId`, `simulationTick` (accepted but must not drive RAG — unused in fetch deps except ignored), `detection` (for `intelSyncKey`)  
10. **State:** `section`, `incidentContext`, `mode`, `intel`; request seq/identity refs  
11. **APIs:** commander-context, incident-intel; child ask/execute elsewhere  
13. **Events:** section chips; mode via agent; ask input  
14. **Conditional:** focusIncidentId branches entire tree; posture block; section content; Investigate-only sticky input  
15. **Loading:** “Loading structured incident context…”  
16. **Real-time:** `intelSyncKey` from detection flagged sets (not every tick); briefing updates from sync  
17. **Reusable:** Commander feature; mounted only from Dashboard today in this audit path  
18. **Kinds:** Commander-related, informational, interactive, incident-related, financial (sections), graph (text), navigation (modes)  
19. **Layout role:** Full commander panel (flex column + sticky input)  
20. **Duplication:** Overlaps Overview response/threat, IncidentCard, Response Console context metrics

#### Briefing-mode children (no incident focus)

| Component | File | Purpose / user sees | Data source |
|---|---|---|---|
| `ThreatSummary` | `ThreatSummary.jsx` | Severity, confidence, summary, knowledge status | `briefing.assessment` etc. |
| `HeroStat` (local) | in `CommanderPanel` | City posture KPIs | `cityPosture` |
| `RiskBreakdown` | `RiskBreakdown.jsx` | Overall/behavioral/graph/trust/criticality | `briefing.risk` or `posture.risk` |
| `EvidenceCards` | `EvidenceCards.jsx` | Up to 3 Level-1 evidence snippets | `incidents[].evidence` |
| `MitreCandidateCard` | `MitreCandidateCard.jsx` | Candidate MITRE techniques | `briefing.mitreCandidates` |
| `GraphImpactPanel` | `GraphImpactPanel.jsx` | Short local-risk blurb | Prop `localBlurb` (parent currently passes `graphContext` — **unused**) |
| `ResponsePlan` | `ResponsePlan.jsx` | Advisory plan steps | `briefing.responsePlan` |
| `ResponseStep` | `ResponseStep.jsx` | One plan step + safety badge | step object |
| `SafetyStatus` | `SafetyStatus.jsx` | approved / corrected / dropped | step safety field |
| `InvestigationQueue` | `InvestigationQueue.jsx` | Ordered investigation strings | `briefing.investigationSteps` |
| `KnowledgeCitation` | `KnowledgeCitation.jsx` | Sources / degraded retrieval notice | citations + knowledgeStatus |
| Inline finance section | in `CommanderPanel` | Financial/operational impact paragraph | `briefing.financialImpact` |

#### IncidentCommanderAgent

1. **Name:** `IncidentCommanderAgent`  
2. **File:** `src/features/commander/IncidentCommanderAgent.jsx`  
3. **Parent:** `CommanderPanel`  
4. **Children:** local `InvestigateView`, `RespondView`, `GraphImpactBlock`, `KnowledgeSection`, `Block`; `StatusBadge`, `FilterChip`  
5. **Purpose:** Structured incident investigate/respond agent UI from backend context + intel  
6. **User sees:** Header modes; incident context KPIs; analysis / graph / finance / related; response plan; knowledge sections  
7. **Data:** `context` (commander-context), `intel` (built/merged), `mode`  
8. **From:** parent fetches  
9. **Props:** `context`, `mode`, `onModeChange`, `intel`  
13. **Events:** Investigate / Respond mode chips  
14. **Conditional:** mode-gated sections; knowledge retrieved vs unavailable  
17. **Reusable:** Commander feature  
18. **Kinds:** Commander-related, incident-related, financial, graph/network (text path), informational, interactive  
19. **Layout role:** Main scroll content when incident focused  
20. **Duplication:** Finance/path/risk repeat Overview + IncidentCard + ResponseConsole

#### CommanderInput

1. **Name:** `CommanderInput`  
2. **File:** `src/features/commander/CommanderInput.jsx`  
3. **Parent:** `CommanderPanel`  
4. **Children:** `FollowUpInline`, `FollowUpAnswer` (local)  
5. **Purpose:** Follow-up / ask questions grounded in match or incident context (informational; no execute)  
6. **User sees:** Suggestions (focused), chat transcript, input form  
7. **Data:** Q&A messages; answers from API  
8. **From:** `POST /rooms/:roomId/commander/ask`  
9. **Props:** `roomId`, `disabled`, `incidentId`, `focused`, `mode`  
10. **State:** `q`, `messages`, `busy`  
13. **Events:** submit / suggestion click  
14. **Conditional:** `shouldShowCommanderFollowUp` — returns `null` when not Investigate+focused appropriately; unfocused ask always in briefing mode  
15. **Busy:** “Commander is answering…”  
17. **Reusable:** Commander feature  
18. **Kinds:** Commander-related, interactive, informational  
19. **Layout role:** Sticky bottom of Commander panel

---

### ResponseConsolePanel / ResponseConsole

#### ResponseConsolePanel

1. **Name:** `ResponseConsolePanel`  
2. **File:** `src/features/response/ResponseConsolePanel.jsx`  
3. **Parent:** `DashboardPage`  
4. **Children:** `EmptyState` or `ResponseConsole`  
5. **Purpose:** Load commander-context for selected incident; wire execute refresh  
6. **User sees:** Empty CTA or console  
7. **Data:** context object  
8. **From:** `GET .../incidents/:id/commander-context`  
9. **Props:** `roomId`, `focusIncidentId` (`?incident=`)  
10. **State:** `context`, `loading`, `error`  
13. **Events:** Link to Incidents; refresh after execute  
14. **Conditional:** no focusIncidentId → EmptyState  
15. **Loading/error:** passed to `ResponseConsole`  
17. **Reusable:** Dashboard Response panel wrapper  
18. **Kinds:** incident-related, Commander-related (context), interactive (via console), navigation  
19. **Layout role:** Full response panel

#### ResponseConsole

1. **Name:** `ResponseConsole`  
2. **File:** `src/features/response/ResponseConsole.jsx`  
3. **Parent:** `ResponseConsolePanel`  
4. **Children:** `StatusBadge`; action list UI inline  
5. **Purpose:** Show incident operational state and **execute** registered containment actions via backend  
6. **User sees:** Asset header; risk/trust/blast/exposure/peers/propagated; action cards with Execute; response status footer  
7. **Data:** context fields + local execution UI status  
8. **From:** parent context; `POST /rooms/:roomId/commander/execute` via `postCommanderExecute`  
9. **Props:** `roomId`, `context`, `loading`, `error`, `onRefreshContext`  
10. **State:** `localByAction`  
13. **Events:** Execute buttons  
14. **Conditional:** loading/error/no-context early returns; empty actions copy  
15. **Loading/error/empty:** dedicated sections  
16. **Real-time:** Context refresh after execute; underlying room state updates via sync (quarantine etc. reflected on next context load / Overview lifecycle)  
17. **Reusable:** Response feature  
18. **Kinds:** interactive, incident-related, status/alert, metric/KPI, financial (exposure display), Commander-related  
19. **Layout role:** Response panel body  
20. **Duplication:** Current-state metrics overlap IncidentCard / IncidentCommanderAgent; Overview Response status is lifecycle-only (no execute)

---

### Shared UI primitives used by Dashboard

| Component | File | Used by Dashboard | Reusable | Role |
|---|---|---|---|---|
| `PageHeader` | `src/ui/PageHeader.jsx` | DashboardPage | yes | chrome |
| `Banner` | `src/ui/Banner.jsx` | DashboardPage | yes | status |
| `EmptyState` | `src/ui/EmptyState.jsx` | multiple | yes | empty |
| `StatusBadge` | `src/ui/StatusBadge.jsx` | many | yes | status chips |
| `Toolbar` / `FilterChip` | `src/ui/Toolbar.jsx` | Fleet, Incidents, Commander | yes | filters |
| `Stat` | `src/ui/Stat.jsx` | **not** by live Dashboard (used by unmounted `KpiStrip`) | yes | KPI cell |

---

## Orphan / unmounted dashboard modules

These live under `src/features/dashboard/` (or related) but are **not imported by `DashboardPage` or its live children**:

| Module | File | Notes |
|---|---|---|
| `KpiStrip` | `KpiStrip.jsx` | Older KPI strip (posture, incidents, residual flags, trajectory, PPS spark). Not mounted. Uses `Stat`. |
| `FinancialExposureCard` | `FinancialExposureCard.jsx` | Standalone economic exposure card + residual ring. Logic overlapped by Overview Business impact via `computeFinancialExposure`. |
| `RiskMomentumCard` / `RiskMomentumReadout` | `RiskMomentumCard.jsx` | Card not mounted on Dashboard. `RiskMomentumReadout` **is** used by `InspectorPanel` (map inspector), not Dashboard. |
| `IncidentTimeline` | `IncidentTimeline.jsx` | Kind-based story timeline (`telemetry`/`detection`/…). **Different** from `HistoryIncidentTimeline`. No current importer found. |
| `CommanderHeader` | `src/features/commander/CommanderHeader.jsx` | Not imported by `CommanderPanel`. |
| `derivePosture` in `metrics.js` | — | Used by unmounted KpiStrip path historically; Overview uses `meshPosture` in `overviewView.js` instead. |

---

## DATA FLOW

### State synchronization (room)

```
Server DEMO room state
  → Socket.IO event state:sync
  → useGameRoom.roomFromState
  → GamePage props into DashboardPage
      nodes, edges, detection, phase, tick/simulationTick,
      cityContext, cityContextLocked, simHour,
      ingestionStatus, hackSimulator,
      commanderBriefing, cityPosture
```

Dashboard does **not** subscribe to Socket.IO itself.

### Telemetry

```
Telemetry generator → POST /ingest/snapshot → tele-ingestion → TimescaleDB
  → GET /rooms/:roomId/metrics (polled 1s by DashboardPage)
  → samples state
  → samplesForMatch(samples, tick)
  → seriesByTick / latestByEndpoint
  → rows[] (pps/http/files/logins, spark vs expected via cityContext + getNodeBaselineMetrics)
  → EndpointTable / Overview telemetry.reporting + pps
```

Catalog baseline: when no live PPS sample for a node, row shows catalog values and `catalogBaseline: true`.

### Graph state

```
state:sync nodes/edges
  → DashboardPage props
  → OverviewPanel (path labels, quarantine counts, finance graph inputs)
  → IncidentCard / path helpers (labelPath)
  → Commander / Response context (server-enriched; not React Flow canvas)
```

There is **no** React Flow graph on the Dashboard; paths are ordered text lists.

### Detection / risk / trust

```
Server detection engine (graph residual + gates + trust)
  → detection object on state:sync
      anomalyNodeIds, atRiskNodeIds, propagatedNodeIds, peerExposedNodeIds,
      primarySpreadNodeId, incidents[], riskMomentum, tgnnCalibrating, …
  → DashboardPage anomalyIds / incidents
  → Overview buildOverviewModel (posture, risk trajectory, path, lifecycle, signals)
  → EndpointTable anomaly flags
  → IncidentsPanel live stream
  → CommanderPanel intelSyncKey (refresh on flagged-set changes)
```

Trust scores appear on incidents / commander-context / response context — not as a separate Dashboard trust panel.

### Incidents

```
Detection promotion → detection.incidents on sync
  → IncidentsPanel live list + IncidentCard
  → Overview primary incident selection
  → Commander EvidenceCards / focus deep-links

Persisted history (SQLite/campaign store on server):
  → GET /rooms/:id/incidents/history
  → GET /rooms/:id/incidents/campaigns
  → HistoryIncidentTimeline + CampaignIntelligence
```

### Propagation

```
detection / incident: propagatedNodeIds, peerExposedNodeIds, atRiskNodeIds, primarySpreadNodeId
  → overviewView.attackPathView + primaryAttackPath(incident)
  → Overview Attack path + Active conditions
  → IncidentCard path + “Highest-risk next target”
  → Incidents QueueRow purple “Next target”
```

### Economic / financial exposure

```
computeFinancialExposure({ detection, nodes, edges })  [shared/financialExposure.js]
  → Overview Business impact + quick signal “Financial Exposure”
  → (unmounted FinancialExposureCard same helper)

Incident.financialContext / commander-context.financialExposure
  → IncidentCard Exposure
  → IncidentCommanderAgent Simulated exposure
  → ResponseConsole Exposure
```

Always labeled simulated / not a loss forecast in UI copy.

### Commander

```
Room briefing path:
  server commanderBriefing + cityPosture on state:sync
  → CommanderPanel briefing mode components

Incident focus path (?incident=):
  GET .../commander-context
  → IncidentCommanderAgent context
  POST .../commander/incident-intel { incidentId, mode }
  → intel merge → Investigate/Respond/Knowledge
  POST .../commander/ask
  → CommanderInput answers
```

### Response / containment

```
GET commander-context → ResponseConsole actions
POST /rooms/:id/commander/execute { incidentId, actionId }
  → local UI status → onRefreshContext
  → server mutates quarantine / actionsAlreadyTaken
  → state:sync updates nodes/detection
  → Overview responseLifecycle reflects quarantine + detection (not HTTP success alone)
```

### Simulation ticks

```
room.simulationTick (state:sync)
  → DashboardPage tick prop
  → metrics query toTick bound
  → samplesForMatch filter
  → expectedTelemetry alignment (sampleTickAligned + holdAlignedPct)
  → Overview riskMomentum series (server residual window)
```

Commander intentionally **does not** re-fetch RAG on every tick (`simulationTick` prop ignored for fetch; `intelSyncKey` from detection).

---

## COMPONENT DEPENDENCY MAP

```
state:sync room
 ├── DashboardPage props
 │   ├── detection
 │   │   ├── OverviewPanel (posture, risk, path, lifecycle, signals, primary incident)
 │   │   ├── EndpointTable rows.anomaly
 │   │   ├── IncidentsPanel live incidents + primarySpreadNodeId
 │   │   ├── CommanderPanel intelSyncKey + briefing mode EvidenceCards
 │   │   └── (indirect) Response after sync via refreshed context
 │   ├── nodes / edges
 │   │   ├── OverviewPanel (quarantine, path labels, finance)
 │   │   ├── EndpointTable / rows construction
 │   │   ├── IncidentCard labels / next target
 │   │   └── finance computeFinancialExposure
 │   ├── commanderBriefing / cityPosture
 │   │   └── CommanderPanel (briefing mode)
 │   ├── phase / tick / cityContext / hackSimulator
 │   │   └── DashboardPage row expected-load + banners
 │   └── ingestionStatus
 │       └── banners + Overview telemetry.feed

GET /rooms/:id/metrics (1s)
 └── DashboardPage samples → rows / pps → Overview + Fleet

GET history + campaigns (2s)
 └── IncidentsPanel → HistoryIncidentTimeline + CampaignIntelligence

GET commander-context
 ├── CommanderPanel → IncidentCommanderAgent
 └── ResponseConsolePanel → ResponseConsole

POST incident-intel
 └── CommanderPanel → intel → Investigate/Respond/Knowledge

POST commander/ask
 └── CommanderInput

POST commander/execute
 └── ResponseConsole → refresh context → eventually state:sync

URL search params
 ├── ?view=dashboard (GamePage)
 ├── ?panel= overview|commander|fleet|incidents|response
 └── ?incident= (commander + response focus; cleared when leaving those panels)
```

---

## CURRENT DASHBOARD INVENTORY TABLE

| Component | File | Parent | Purpose | Data Source | Interactive | Real-time |
|---|---|---|---|---|---|---|
| DashboardPage | `src/pages/DashboardPage.jsx` | GamePage | Shell, metrics, panel router | props + `/metrics` | Filter clear | sync + 1s poll |
| DashboardNav | `DashboardNav.jsx` | DashboardPage | Panel navigation | panel + incident count | Yes (links) | Count via sync |
| PageHeader | `src/ui/PageHeader.jsx` | DashboardPage | Title/subtitle/actions | panel meta | Via actions | — |
| Banner | `src/ui/Banner.jsx` | DashboardPage | Feed/phase alerts | feed/phase/error | No | Yes |
| EmptyState | `src/ui/EmptyState.jsx` | Multiple | Empty messaging | props | Optional CTA | — |
| OverviewPanel | `OverviewPanel.jsx` | DashboardPage | Command-center overview | overviewView model | Nav + select | Via props |
| MiniSpark / RiskBar / StageDot / SectionLabel | in OverviewPanel | OverviewPanel | Local viz/labels | model | Mostly no | Via props |
| EndpointTable | `EndpointTable.jsx` | DashboardPage | Fleet telemetry table | rows | Search + select | Via rows |
| Sparkline | in EndpointTable | EndpointTable | % vs expected spark | row.spark | No | Via rows |
| IncidentsPanel | `IncidentsPanel.jsx` | DashboardPage | Live + history incidents | incidents + history APIs | Filters/select | sync + 2s poll |
| QueueRow | in IncidentsPanel | IncidentsPanel | Stream row | incident | Yes | Via props |
| IncidentCard | `IncidentCard.jsx` | IncidentsPanel | Incident detail | incident + intel helpers | Links + select | Via props |
| HistoryIncidentTimeline | `HistoryIncidentTimeline.jsx` | IncidentsPanel | Persisted chronology | history API | Select | 2s poll |
| CampaignIntelligence | `CampaignIntelligence.jsx` | IncidentsPanel | Correlated campaigns | campaigns API | No | 2s poll |
| CommanderPanel | `CommanderPanel.jsx` | DashboardPage | AI Commander host | briefing/posture + APIs | Tabs/modes | sync + fetch |
| ThreatSummary | `ThreatSummary.jsx` | CommanderPanel | Briefing assessment | briefing | No | sync |
| RiskBreakdown | `RiskBreakdown.jsx` | CommanderPanel | Risk decomposition | briefing/posture risk | No | sync |
| EvidenceCards | `EvidenceCards.jsx` | CommanderPanel | Level-1 evidence | incidents | No | sync |
| MitreCandidateCard | `MitreCandidateCard.jsx` | CommanderPanel | MITRE candidates | briefing | No | sync |
| GraphImpactPanel | `GraphImpactPanel.jsx` | CommanderPanel | Local risk blurb | localBlurb (graphContext unused) | No | — |
| ResponsePlan | `ResponsePlan.jsx` | CommanderPanel | Advisory plan | briefing | No | sync |
| ResponseStep | `ResponseStep.jsx` | ResponsePlan | Plan step | step | No | — |
| SafetyStatus | `SafetyStatus.jsx` | ResponseStep | Safety badge | status | No | — |
| InvestigationQueue | `InvestigationQueue.jsx` | CommanderPanel | Investigation steps | briefing | No | sync |
| KnowledgeCitation | `KnowledgeCitation.jsx` | CommanderPanel | Citations | briefing | No | sync |
| IncidentCommanderAgent | `IncidentCommanderAgent.jsx` | CommanderPanel | Per-incident agent UI | context + intel | Mode chips | fetch |
| InvestigateView / RespondView / KnowledgeSection / GraphImpactBlock | in IncidentCommanderAgent | Agent | Section bodies | intel | No | fetch |
| CommanderInput | `CommanderInput.jsx` | CommanderPanel | Ask / follow-up | `/commander/ask` | Yes | On ask |
| ResponseConsolePanel | `ResponseConsolePanel.jsx` | DashboardPage | Response host | commander-context | Nav empty | On focus |
| ResponseConsole | `ResponseConsole.jsx` | ResponseConsolePanel | Execute containment | context + execute API | Execute | After execute |
| StatusBadge | `src/ui/StatusBadge.jsx` | Many | Tone chips | props | No | — |
| Toolbar / FilterChip | `src/ui/Toolbar.jsx` | Fleet/Incidents/Commander | Filters | props | Yes | — |

**Unmounted (not in live hierarchy):** `KpiStrip`, `FinancialExposureCard`, `RiskMomentumCard` (card), `IncidentTimeline`, `CommanderHeader`.

---

## VISUAL RESPONSIBILITY

| Surface | Communicates to the user |
|---|---|
| GamePage Map/Dashboard toggle | Switch between graph map and SOC dashboard |
| DashboardNav | Which SOC workspace page is active |
| PageHeader | What the current panel is for |
| Status banners | Whether telemetry ingest / match is healthy enough to trust fleet numbers |
| Overview — Mesh posture | City-wide threat posture label + incident/anomaly/at-risk/quarantine counts |
| Overview — Active threat | Highest-priority open incident and Level-1 metric evidence |
| Overview — Risk trajectory | Peak residual risk score, momentum, narrative |
| Overview — Attack path | Observed/propagated path labels and hop counts (assessment context) |
| Overview — Business impact | Simulated economic exposure and blast/services counts |
| Overview — Response status | Detection → investigation → containment → recovery lifecycle (not execute) |
| Overview — Telemetry health | Feed LIVE/DOWN, reporting devices, pipeline calibrating/healthy |
| Overview — Active conditions | Drift / spike / propagation / finance / telemetry quick flags |
| Fleet table | Per-endpoint live metrics vs expected and residual flags |
| Incidents stream | Promoted detections this tick needing attention |
| IncidentCard | Why one incident matters, path, next target, exposure, deep links |
| History timeline | Chronology of persisted detections this match |
| Campaign intelligence | Backend-correlated multi-incident campaigns |
| Commander (briefing) | Room-level assessment, risk parts, evidence, MITRE candidates, plan, sources |
| Commander (incident) | Structured investigate/respond + knowledge for one incident |
| CommanderInput | Grounded Q&A (advisory) |
| Response Console | Registered containment actions and execution status for one incident |

---

## REDESIGN BOUNDARIES

### Safe to visually redesign without backend changes

- Layout, spacing, typography, section chrome of Overview sections (same `buildOverviewModel` inputs).
- `DashboardNav` presentation (keep URL contract `panel` / `incident`).
- `PageHeader` / `Banner` / `EmptyState` / `StatusBadge` / `Toolbar` styling.
- Fleet table visual density / spark presentation (keep row semantics: catalog baseline vs live).
- Incidents stream / timeline / campaign **presentation** (keep history API fields).
- Commander briefing section chrome and tab UI.
- IncidentCommanderAgent section layout (keep context/intel field meanings).
- Response Console layout (keep execute contract).

### Tightly coupled to data/state

- `DashboardPage` metrics polling + row construction (tick alignment, expected load, holdAlignedPct).
- `overviewView.buildOverviewModel` and shared `computeFinancialExposure` / `riskMomentum`.
- `IncidentsPanel` history/campaign polling and selection sync with live stream.
- `CommanderPanel` dual-path focusIncidentId + intel sync key behavior.
- `ResponseConsole` execute + `actionsAlreadyTaken` / quarantine semantics.
- URL contracts: `view`, `panel`, `incident` and href helpers in `dashboardPanels.js`.

### Functionality that must remain unchanged (product contracts)

- Overview does **not** execute containment (links only).
- Response Console is the execute surface for registered actions.
- Commander remains decision-support (no fabricated telemetry; MITRE as candidates).
- Catalog baseline vs live PPS labeling.
- Simulated exposure labeling (not real loss).
- Propagation / next-target language as assessment, not confirmed kill-chain.
- Level-1 evidence remains numeric upstream facts.
- Trust model weights / detector math are out of scope for UI-only redesign.

### Can be rearranged freely (within Dashboard)

- Order of Overview sections.
- Placement of Fleet vs Incidents vs Overview blocks relative to each other (panel split already URL-based).
- History timeline vs campaign side-by-side vs stacked.
- Commander sticky input chrome.
- Which Overview KPIs are emphasized (if derived from same model).

### Should probably remain structurally intact

- Five-panel information architecture (Overview / Commander / Fleet / Incidents / Response) unless redesign explicitly merges panels.
- Separation of live stream vs persisted history vs campaigns.
- Separation of Commander advisory vs Response execute.
- `DashboardPage` as single metrics owner feeding Fleet + Overview.
- `state:sync` as source of detection/incidents/briefing (do not invent a parallel poll for those).

### Shared components used outside Dashboard

| Component | Also used outside Dashboard |
|---|---|
| `PageHeader`, `Banner`, `EmptyState`, `StatusBadge`, `Toolbar`/`FilterChip`, `Stat` | Shared UI kit (other pages/features) |
| `RiskMomentumReadout` | `InspectorPanel` (map) |
| Commander / Response feature modules | Mounted via Dashboard panels today; files are feature packages |
| `getNodeBaselineMetrics` / shared intel & finance | Graph, inspector, server-facing shared |

Changing shared UI primitives affects non-Dashboard surfaces — prefer local wrappers for Dashboard-only visual experiments.

---

## Verification checklist (source)

Audited against:

- `src/pages/DashboardPage.jsx`, `src/pages/GamePage.jsx`, `src/App.jsx`
- All of `src/features/dashboard/*.{jsx,js}` (including unmounted)
- `src/features/commander/*` components reachable from `CommanderPanel`
- `src/features/response/ResponseConsolePanel.jsx`, `ResponseConsole.jsx`
- `src/ui/*` used by the above
- `src/multiplayer/useGameRoom.js` for `state:sync` fields

Confirmed: live hierarchy starts at `DashboardPage`; five panels; Overview is the densest composite; Fleet/Incidents/Commander/Response are panel swaps; orphans listed separately so they are not mistaken for live UI.
)
