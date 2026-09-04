# Dashboard Redesign Architecture

**Status:** Approved and implemented (UI-only). See live Dashboard panels.  
**Scope:** LIVE Dashboard panels only (`Overview`, `Commander`, `Fleet`, `Incidents`, `Response`).  
**Hard constraints:** Preserve backend, detection math, finance calculations, RAG semantics, Commander reliability fixes, response execution, Socket.IO/`state:sync`, URL contracts (`?view=dashboard`, `?panel=`, `?incident=`), and Follow-up chat as **Investigate-only**.

**Baseline:** [`docs/DASHBOARD_UI_INVENTORY.md`](./DASHBOARD_UI_INVENTORY.md) + current sources under `src/pages/DashboardPage.jsx`, `src/features/dashboard/*`, `src/features/commander/*`, `src/features/response/*`.

---

## 1. Design philosophy

The Dashboard is a **cyber-defense command center** for one live match, not a KPI collage.

Operators should move through a single SOC narrative without re-learning the same facts in five places:

```
SITUATIONAL AWARENESS
  → DETECTION
  → INVESTIGATION
  → AI ANALYSIS / KNOWLEDGE
  → RESPONSE DECISION (advisory)
  → CONTAINMENT (execution)
  → RECOVERY / POSTURE
```

**Panel ownership (canonical):**

| Workflow stage | Canonical panel | Role |
|---|---|---|
| Situational awareness + severity + blast | **Overview** | “What is happening / how bad / what is exposed?” |
| Telemetry inspection | **Fleet** | “Which endpoints deviate from expected?” |
| Detection queue + evidence browse | **Incidents** | “What was promoted? Inspect Level-1 facts.” |
| AI analysis + knowledge + advisory plan | **Commander** | “Why / what does AI recommend? (no execute)” |
| Containment + recovery actions | **Response** | “What can I safely execute?” |

**Principles**

1. Keep the **five-panel architecture** and URL contracts.
2. Prefer **information zones** over stacks of equal cards.
3. One **primary incident focus** drives the story; secondary panels go compact.
4. **Progressive disclosure:** summary first, detail on demand or deeper panel.
5. **Severity hierarchy** via color restraint (crit/warn/ok/muted tokens only).
6. **Advisory vs Execution** must be visually unmistakable.
7. Do not remount orphans (`KpiStrip`, `FinancialExposureCard`, `RiskMomentumCard`, `IncidentTimeline`, `CommanderHeader`) unless a concept is reused as layout language only.
8. Prefer Dashboard-local visual wrappers over rewriting shared map UI primitives in ways that break GamePage/Inspector.

**UX answer chain (must be readable in ≤10 seconds on Overview):**

1. What is happening?  
2. How serious is it?  
3. What is affected?  
4. Why flagged? → Incidents / evidence  
5. What does Commander recommend? → Commander  
6. What knowledge supports it? → Commander Knowledge  
7. What can I safely do? → Response  
8. What happened after containment? → Overview lifecycle + Response status  

---

## 2. Global dashboard layout

### Shell (unchanged functionally)

```
GamePage header (Map | Dashboard | tick/pips)
└── DashboardPage
    ├── DashboardNav (workflow rail)
    └── Content column
        ├── PageHeader (compact mission bar)
        └── Panel body
```

### Navigation (`DashboardNav`) — REDESIGN

- Keep five links and href helpers.
- Reorder **visual labels** to match SOC workflow (IDs unchanged):

  | Order | `panel` id | Nav label | Workflow cue |
  |---|---|---|---|
  | 1 | `overview` | Overview | Awareness |
  | 2 | `incidents` | Incidents | Detection |
  | 3 | `fleet` | Fleet | Telemetry |
  | 4 | `commander` | Commander | AI / advisory |
  | 5 | `response` | Response | Execution |

- Add subtle **stage grouping** in the rail (non-interactive section labels: “Monitor” / “Analyze” / “Act”) — CSS/layout only; no new routes.
- Incident count badge stays on Incidents.
- Optional: small “focused” pip on Commander/Response when `?incident=` is present (read URL only).

### PageHeader — SIMPLIFY

- Keep title; shorten subtitle to one line (panel blurb).
- Actions slot retains endpoint filter clear chip.
- On Commander/Response with `?incident=`, show a compact **incident focus chip** (id/label if already available from parent props — no new API): “Focused · {endpoint}” + clear via navigating without inventing new URL keys (clearing means leaving focus by existing incident-less hrefs / panel switches).

### Content width

- Overview: max ~80rem (wider command strip), full-bleed zones inside.
- Incidents / Commander / Response: master/detail fill height (`min-h-0 flex`), less “card stack scroll marathon”.
- Fleet: full content width table.
- Desktop: nav `md:w-52`–`56`, content flexible.
- Mobile: keep horizontal nav; stack master/detail vertically.

### Information hierarchy (global)

1. **Severity / posture** (largest type, left accent).  
2. **Primary incident / action** (primary buttons).  
3. **Supporting metrics** (mono tabular).  
4. **Secondary chronology / campaigns / feed health** (compact, muted).  

### Banners — REPOSITION / COMPACT

- Keep banner *logic* on Overview (ingest/phase/error).
- Collapse to a single **feed strip** under the header when non-critical; expand full `Banner` only for `crit` / down / fetchError.
- Do not repeat the same feed story inside Telemetry Health at full size (see Overview).

---

## 3. Overview redesign

**Goal:** One command composition answering awareness → severity → impact → next step.  
**Data:** Keep `buildOverviewModel` / existing props. No new risk engine.

### Proposed structure (top → bottom)

```
┌─ ZONE A: SITUATION BAR ─────────────────────────────────────┐
│ Posture label + tone accent │ ACTIVE THREAT / SYSTEM CLEAR  │
│ Compact stats: Incidents · Anomalies · At-risk · Quarantined│
│ Lifecycle stages (StageDot) as a horizontal strip (compact) │
└─────────────────────────────────────────────────────────────┘

┌─ ZONE B: PRIMARY INCIDENT (master) ──────────┬─ ZONE C: RISK ─┐
│ Endpoint · severity · detection tags           │ Score /100     │
│ Observed / Expected / Deviation                │ Spark+bar      │
│ Path (confirmed → exposed) compact             │ Δ window·peak  │
│ Simulated exposure (one line, labeled)         │ Narrative short │
│ [Open Incidents] [Commander] [Response]        │                │
└────────────────────────────────────────────────┴────────────────┘

┌─ ZONE D: IMPACT & CONDITIONS (one band) ────────────────────┐
│ Blast · services · critical deps │ Quick signals (5 chips)  │
│ Highest-risk next target (assessment) │ Feed · pipeline pip │
└─────────────────────────────────────────────────────────────────┘
```

### Zone roles

| Zone | Emphasize | De-emphasize |
|---|---|---|
| A Situation | Posture, counts, lifecycle | Long prose |
| B Primary incident | Who/what/why metric, CTAs | Duplicate finance essay |
| C Risk | Score, trajectory, spark | Multi-paragraph tech essay (keep as tooltip/`title`) |
| D Impact band | Exposure number + blast + next target + feed pip | Separate full Telemetry Health card |

### Component actions (Overview)

| Component | Action |
|---|---|
| OverviewPanel | **REDESIGN** as 3–4 zones (not 8 equal `tn-surface` cards) |
| SectionLabel | **KEEP** pattern; tighten tracking |
| MiniSpark | **KEEP** in Risk zone |
| RiskBar | **KEEP** under score |
| StageDot | **REPOSITION** into Situation Bar lifecycle strip |
| StatusBadge | **KEEP** for threat/system-clear |
| Active conditions | **MERGE VISUALLY** into Zone D (chip row, not fifth card) |
| Telemetry health | **SIMPLIFY** → feed/pipeline pips in Zone D; detail only if degraded |
| Business impact | **MERGE VISUALLY** into Zone B/D (one exposure number + micro stats) |
| Attack path | **MERGE VISUALLY** into Zone B (compact path) |
| Response status | **REPOSITION** lifecycle to Zone A; remove duplicate CTA clutter (keep one CTA cluster in Zone B) |

### Functional unchanged

- Navigation only; no execute.
- Assessment language for path / next target.
- Simulated exposure labeling.
- Same model fields from `overviewView.js`.

---

## 4. Fleet redesign

**Goal:** Dense telemetry workbench for “what drifted?”, supporting detection — not a second Overview.

### Layout

```
┌ Toolbar: search · count · legend (Ok / Drift / Flag / Hold / Catalog) ┐
└──────────────────────────────────────────────────────────────────────┘
┌ Table (sticky header) — anomaly/quarantine sorted as today            ┐
│ Rail · Node · Type · PPS · HTTP · Files · Logins · Trend · State     │
└──────────────────────────────────────────────────────────────────────┘
```

### Actions

| Component | Action |
|---|---|
| EndpointTable | **REDESIGN** density (tighter rows, clearer rail, stronger selected state) |
| Sparkline | **KEEP** SVG approach (lighter than Recharts); optional shared domain legend |
| Toolbar | **KEEP**; add compact state legend |
| StatusBadge | **KEEP** state column |
| EmptyState | **KEEP** |

### Emphasize / de-emphasize

- Emphasize: Flag/Drift rows, % vs expected, catalog baseline honesty.
- De-emphasize: Competing with Overview KPIs (no posture hero here).

### Functional unchanged

- Row construction stays in `DashboardPage`.
- Click still toggles `filterId`.
- Catalog baseline shows `—` for live metrics.

---

## 5. Incidents redesign

**Goal:** Detection queue with **master/detail** — live stream is primary; history/campaigns are secondary drawers/panels.

### Proposed layout (desktop)

```
┌ Filters (All + detection types) · live count ───────────────────────┐
├──────────────┬──────────────────────────────────────────────────────┤
│ LIVE QUEUE   │ DETAIL (IncidentCard)                                │
│ QueueRow list│  Evidence-forward: why · metrics · path · signals    │
│ (scroll)     │  CTAs: Commander (advisory) · Response (execute)     │
│              │                                                      │
├──────────────┴──────────────────────────────────────────────────────┤
│ SECONDARY TABS or collapsed split: Timeline | Campaigns             │
└─────────────────────────────────────────────────────────────────────┘
```

Mobile: queue → detail stack; secondary accordion below.

### Actions

| Component | Action |
|---|---|
| IncidentsPanel | **REDESIGN** to side-by-side master/detail; secondary chronology compact |
| QueueRow | **REDESIGN** denser; severity rail + next-target pip |
| IncidentCard | **REDESIGN** as investigation worksheet (less essay chrome) |
| HistoryIncidentTimeline | **REPOSITION** + **MAKE MORE COMPACT** (secondary) |
| CampaignIntelligence | **REPOSITION** + **MAKE MORE COMPACT** (secondary) |
| FilterChip / Toolbar | **KEEP** |

### Emphasize

- Live promoted detections.
- Level-1 evidence / why it matters.
- Clear handoff: Commander (analyze) vs Response (act).

### De-emphasize

- Full duplication of Overview finance/risk blocks (show compact risk/trust/exposure strip only).
- Campaign chrome competing with live queue height.

### Functional unchanged

- History/campaign polls and selection sync.
- `primarySpreadNodeId` next-target marking.
- Links via `dashboardCommanderIncidentHref` / `dashboardResponseIncidentHref`.

---

## 6. Commander redesign

**Goal:** Decision-support workbench. Two modes remain: **room briefing** (no `?incident=`) and **incident agent** (`?incident=`).  
**Hard rule:** Follow-up / `CommanderInput` remains **Investigate-only** (existing `shouldShowCommanderFollowUp`).

### 6.1 Incident-focused path (primary demo path)

```
┌ CONTEXT STRIP (sticky) ─────────────────────────────────────────────┐
│ Asset · severity · status · Risk · Trust · Simulated exposure       │
│ Mode: [Investigate] [Respond]     badge: ADVISORY — does not execute│
└─────────────────────────────────────────────────────────────────────┘

INVESTIGATE layout (two columns on lg):
┌ MAIN ANALYSIS ─────────────────────┬ KNOWLEDGE / EVIDENCE ──────────┐
│ Incident summary / why suspicious  │ KnowledgeSection               │
│ Current state                      │ (retrieved vs unavailable)     │
│ Graph impact (path)                │ Sources                        │
│ Financial impact (simulated)       │ MITRE candidates (compact)     │
│ Related incidents                  │                                │
└────────────────────────────────────┴────────────────────────────────┘
┌ STICKY FOLLOW-UP (Investigate only) ────────────────────────────────┐
│ Suggestions · transcript · ask                                      │
└─────────────────────────────────────────────────────────────────────┘

RESPOND layout:
┌ ADVISORY RESPONSE PLAN ─────────────────────────────────────────────┐
│ Priority · steps · “Recommended — not executed” on every step       │
│ Primary CTA: Open Response Console → (execution panel)              │
│ No CommanderInput                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Room briefing path (no incident)

- Compress into: Threat summary + risk decomposition + section tabs.
- Tabs become a **single segmented control**: Evidence · Graph · Plan · Sources (same data).
- Mark GraphImpactPanel as low priority until `localBlurb`/`graphContext` wiring is cleaned **visually** (still no backend change; may pass a derived blurb from existing briefing fields in UI only if already present — otherwise keep placeholder honest).
- Unfocused `CommanderInput` (“Ask Commander” on room snapshot): **MAKE MORE COMPACT** / secondary; do not compete with incident follow-up. Prefer de-emphasizing room chat vs incident Investigate chat for demo clarity (behavior kept).

### Component actions (Commander)

| Component | Action |
|---|---|
| CommanderPanel | **REDESIGN** shell: sticky context, advisory badge, clearer mode split |
| IncidentCommanderAgent | **REDESIGN** Investigate 2-col; Respond plan-forward |
| InvestigateView | **REDESIGN** / merge blocks into zones |
| RespondView | **REDESIGN**; strong link to Response panel |
| KnowledgeSection | **MAKE MORE PROMINENT** in Investigate (knowledge is a product differentiator) |
| GraphImpactBlock | **KEEP** content; tighten path styling |
| ThreatSummary | **SIMPLIFY** for briefing mode |
| HeroStat | **MERGE VISUALLY** into ThreatSummary strip or drop as separate grid |
| RiskBreakdown | **KEEP** as compact decomposition strip |
| EvidenceCards | **SIMPLIFY** (list, not 3 equal cards) |
| MitreCandidateCard | **KEEP**; candidate language unchanged |
| GraphImpactPanel | **SIMPLIFY** / fix prop mismatch visually; do not invent topology |
| ResponsePlan / ResponseStep / SafetyStatus | **REDESIGN** chrome; keep safety badges |
| InvestigationQueue | **MERGE VISUALLY** into Plan/Investigate as checklist |
| KnowledgeCitation | **KEEP** in Sources |
| CommanderInput / FollowUp* | **KEEP** behavior; **REDESIGN** sticky dock; Investigate-only |
| CommanderHeader (unmounted) | **DEPRECATE VISUALLY** — do not remount |

### Emphasize

- Observed vs knowledge separation.
- Advisory plan ≠ execution.
- Knowledge retrieved status honesty.

### De-emphasize

- Duplicate city posture KPIs already on Overview.
- Decorative “Operational” badges without state meaning.

### Functional unchanged

- `commander-context` + `incident-intel` fetch / `intelSyncKey`.
- No per-tick RAG.
- Modes Investigate / Respond.
- Ask endpoint contract.
- MITRE as candidates.

---

## 7. Response redesign

**Goal:** The only place that feels like an **operations console** with Execute.

### Visual distinction (mandatory)

| Surface | Label treatment | Color / chrome |
|---|---|---|
| Commander Respond | Banner: **ADVISORY** · “Does not execute infrastructure actions” | Neutral / info accent |
| Response Console | Banner: **EXECUTION** · “Registered containment actions” | Stronger ink border / warn-ok for execute controls |

### Proposed layout

```
┌ EXECUTION BANNER + asset identity + severity/status ────────────────┐
├ Current state (compact metrics) ─┬ Action list (primary) ───────────┤
│ Risk Trust Blast Exposure …      │ Action cards + Execute buttons   │
│ Simulated exposure disclaimer    │ Target · type · uiStatus         │
├──────────────────────────────────┴──────────────────────────────────┤
│ Response status footer (post-execute / already executed / empty)    │
└─────────────────────────────────────────────────────────────────────┘
```

Empty (no `?incident=`): keep EmptyState CTA to Incidents — copy: “Select an incident to open the execution console.”

### Component actions

| Component | Action |
|---|---|
| ResponseConsolePanel | **KEEP** load/refresh wiring; **REDESIGN** empty state copy |
| ResponseConsole | **REDESIGN** execution-first layout; metrics secondary |
| StatusBadge | **KEEP** for severity / action uiStatus |

### Functional unchanged

- `POST .../commander/execute`.
- Disabled states / already-executed.
- Context refresh after success.
- No frontend invention of recovery beyond server fields.

---

## 8. Shared component design system

Use existing CSS tokens (`--tn-*`, IBM Plex Sans/Mono). Prefer **Dashboard-scoped** class prefixes (e.g. `.soc-*`) for new zone layouts so Map/Inspector are not destabilized.

### Typography

| Role | Spec |
|---|---|
| Panel title | `.tn-page-title` (~1.25–1.5rem), weight 500 |
| Zone title | 11–12px uppercase label / muted (SectionLabel) |
| Hero posture / score | Mono 2–2.5rem tabular |
| Body | 14px / 1.45 |
| Meta | `.tn-meta` 13px muted |
| Numbers | Mono tabular always |

### Surfaces

- **Zone** (primary): one outlined surface spanning a workflow block — not 6 sibling cards.
- **Inset well**: elevated background for nested lists.
- Radius: keep `--radius-lg` (8px). Avoid heavy shadows.
- Left severity accent (3px) for posture / execution / advisory banners.

### Badges & severity

- Reuse `StatusBadge` tones: `crit` / `warn` / `ok` / `muted`.
- Add Dashboard-only **role chips**: `ADVISORY` (muted/info), `EXECUTION` (ink), `SIMULATED` (muted) — visual only.
- Purple “next target” accent may remain for propagation assessment (already in product); keep labeled “assessment only”.

### Spacing

- Zone gap: 16–20px.
- Inner padding: 16–20px (not 24 everywhere).
- Dense tables: row py ~8–10px.

### Buttons

- Primary (`tn-btn-primary`): one per zone max (e.g. Open Response, Execute).
- Secondary (`tn-btn`): navigation siblings.
- Execute buttons only on Response.

### Inputs / tabs / filters

- Keep `FilterChip` visual language; use as mode switch for Investigate/Respond and Commander sections.
- Search: `tn-input` compact.

### Tables

- Sticky header, rail severity, selected row using `--tn-select-bg`.
- No zebra noise beyond anomaly/drift tint.

### Empty / loading / error

- EmptyState centered, short body, one CTA.
- Loading: single muted line in surface (Commander/Response already).
- Error: Banner tone crit or inline crit text — no fake data.

### Motion

- Optional 150–200ms width/opacity on risk bar / selection only.
- No continuous glow/pulse except existing “current” cues if retained.

---

## 9. Information duplication cleanup

| Information | Appears today | Canonical home | Elsewhere |
|---|---|---|---|
| Mesh posture / severity | Overview hero, Commander HeroStat/posture | **Overview Zone A** | Commander: omit or one-line reference |
| Active incident identity | Overview, Incidents, Commander, Response | **Incidents detail** + Overview summary | Commander/Response: context strip only |
| Level-1 metric evidence | Overview + IncidentCard + EvidenceCards | **Incidents IncidentCard** (full) | Overview: 3 numbers; Commander: compact evidence |
| Risk score / momentum | Overview Risk + unmounted RiskMomentumCard + IncidentCard risk | **Overview Zone C** | Incident/Commander: single number only |
| Attack / propagation path | Overview + IncidentCard + GraphImpactBlock | **Incidents** (investigate path) | Overview: compact; Commander: graph impact section |
| Next-target assessment | Overview footer + IncidentCard + QueueRow | **Incidents** (card + queue pip) | Overview: one line in Zone D |
| Simulated exposure | Overview + IncidentCard + Commander + Response + unmounted FinancialExposureCard | **Overview** (city-wide) + **incident context strip** (per-incident) | Do not remount FinancialExposureCard; keep disclaimer everywhere shown |
| Response lifecycle | Overview stages + Response status footer | **Overview Zone A** (match posture) + **Response footer** (action outcome) | Commander: no fake lifecycle |
| Telemetry feed health | Banners + Telemetry Health + signals | **Overview Zone D pips** + **crit Banner** | Fleet: catalog baseline note only |
| Advisory plan | Commander Respond/Plan | **Commander Respond** | Response: actions only (registered), not plan essay |
| Execute actions | Response only | **Response** | Overview/Commander: links only |
| Knowledge / RAG | Commander Knowledge/Sources | **Commander Investigate** | Nowhere else |
| Campaign correlation | CampaignIntelligence + incident campaignId lines | **Incidents secondary** | Commander: id line if present |
| History chronology | HistoryIncidentTimeline | **Incidents secondary** | Do not remount story `IncidentTimeline` |

**Rule:** Do not delete facts; demote repeats to compact strips or deep-links.

---

## 10. Component migration map

| CURRENT COMPONENT | NEW ROLE | ACTION |
|---|---|---|
| DashboardPage | Shell / metrics owner / panel router | **KEEP** (layout classes only) |
| DashboardNav | Workflow rail | **REDESIGN** + **REPOSITION** order labels |
| PageHeader | Mission bar | **SIMPLIFY** |
| Banner | Critical feed alerts | **REPOSITION** / compact non-crit |
| EmptyState | Empty/CTA | **KEEP** |
| OverviewPanel | Situational command composition | **REDESIGN** |
| MiniSpark | Risk spark | **KEEP** |
| SectionLabel | Zone eyebrow | **KEEP** |
| RiskBar | Risk meter | **KEEP** |
| StageDot | Lifecycle pip | **REPOSITION** into Situation Bar |
| EndpointTable | Fleet workbench | **REDESIGN** (density) |
| Sparkline | Trend glyph | **KEEP** |
| IncidentsPanel | Detection master/detail | **REDESIGN** |
| QueueRow | Live queue item | **REDESIGN** |
| IncidentCard | Investigation worksheet | **REDESIGN** |
| HistoryIncidentTimeline | Secondary chronology | **REPOSITION** + **SIMPLIFY** |
| CampaignIntelligence | Secondary correlation | **REPOSITION** + **SIMPLIFY** |
| CommanderPanel | Advisory workbench host | **REDESIGN** |
| ThreatSummary | Briefing headline | **SIMPLIFY** |
| HeroStat | Posture crumbs | **MERGE VISUALLY** into briefing header |
| RiskBreakdown | Risk parts | **SIMPLIFY** |
| EvidenceCards | Evidence list | **SIMPLIFY** |
| MitreCandidateCard | Candidates | **KEEP** (chrome polish) |
| GraphImpactPanel | Briefing graph note | **SIMPLIFY** |
| ResponsePlan | Advisory plan | **REDESIGN** chrome |
| ResponseStep | Plan step | **KEEP**/polish |
| SafetyStatus | Safety chip | **KEEP** |
| InvestigationQueue | Checklist | **MERGE VISUALLY** |
| KnowledgeCitation | Sources | **KEEP** |
| IncidentCommanderAgent | Incident advisory UI | **REDESIGN** |
| InvestigateView | Investigate zones | **REDESIGN** |
| RespondView | Advisory plan + handoff | **REDESIGN** |
| KnowledgeSection | Knowledge column | **MAKE MORE PROMINENT** |
| GraphImpactBlock | Path/impact | **KEEP**/tighten |
| CommanderInput | Investigate follow-up | **REDESIGN** dock; **KEEP** gate |
| FollowUpInline / FollowUpAnswer | Answer formatting | **KEEP** |
| ResponseConsolePanel | Execution host | **KEEP** wiring; empty copy polish |
| ResponseConsole | Execution console | **REDESIGN** |
| StatusBadge | Severity/state | **KEEP** |
| Toolbar / FilterChip | Filters/modes | **KEEP** |
| **KpiStrip** (unmounted) | — | **DEPRECATE VISUALLY** (concepts absorbed by Overview A/C) |
| **FinancialExposureCard** (unmounted) | — | **DEPRECATE VISUALLY** (Overview + context strips) |
| **RiskMomentumCard** (unmounted) | — | **DEPRECATE VISUALLY** (Overview Zone C); keep `RiskMomentumReadout` for Inspector |
| **IncidentTimeline** (unmounted) | — | **DEPRECATE VISUALLY** (do not remount; History timeline covers chronology) |
| **CommanderHeader** (unmounted) | — | **DEPRECATE VISUALLY** |

---

## 11. Implementation order

Safe sequence — UI-only, panel-by-panel, preserve contracts:

1. **Design tokens / SOC zone utilities** (Dashboard-scoped CSS) — no behavior.  
2. **DashboardNav + PageHeader + Banner compaction** — URL contracts verified by existing tests.  
3. **OverviewPanel zone redesign** — still driven by `buildOverviewModel`; snapshot UX manually with healthy / threat / calibrating / feed-down.  
4. **IncidentsPanel master/detail + IncidentCard/QueueRow** — history/campaign APIs untouched.  
5. **EndpointTable density pass**.  
6. **CommanderPanel + IncidentCommanderAgent** Investigate/Respond layout — verify Investigate-only follow-up; no fetch timing changes.  
7. **Briefing-mode Commander** simplification (ThreatSummary/Evidence/Plan).  
8. **ResponseConsole** execution-first chrome + advisory/execution banners.  
9. **Duplication pass** — remove leftover full-size repeats; keep compact strips.  
10. **Regression checklist:** panel URLs, `?incident=` focus retention on Commander/Response, metrics poll, execute, intel sync key behavior, simulated exposure labels, catalog baseline labels.

**Do not** in this redesign phase: remount orphans, change shared finance/detection modules, alter Socket handlers, or widen RAG refresh.

---

## Approval gate

This document is the redesign contract. Implementation should not start until explicitly approved.

**Out of scope for the redesign phase:** Map/`GraphCanvas`, Inspector (except not breaking `RiskMomentumReadout`), attacker UI, backend services, shared scoring math.
)
