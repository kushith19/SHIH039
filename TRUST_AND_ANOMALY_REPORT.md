# Trust Score and TGNN Anomaly Detection

This document explains how TrustNetAI computes a **trust score** for each device on the canvas, and how it uses a **Temporal Graph Neural Network (TGNN)** to detect anomalies during a compromise scenario. Both run entirely in the browser on the current graph—there is no separate server or training dataset.

---

## How the trust score works

Every IoT node on the canvas gets a single **trust score from 0 to 100**, shown on the node card and in the inspector. The score is meant to answer a practical question: *how reliable does this device look right now*, given what it is, who it talks to, and how its traffic behaves. It is **not** the same as anomaly detection; a device can have a middling trust score without being flagged as an attack origin.

The score is a **weighted blend of four components**, each also scaled to 0–100 before mixing:

**Intrinsic trust (25%)** comes from the device’s type in the asset catalog. Each asset class—environmental sensor, firewall, database server, and so on—has a fixed reputation value. A firewall might start around 94; a field sensor might be closer to 58. If the type is unknown, the app defaults to 50. This captures the idea that some classes of equipment are inherently more sensitive or better hardened than others, independent of the current graph.

**Structural peer trust (30%)** looks at the node’s **neighbors on the graph**. For each connected peer, the app takes that peer’s intrinsic trust and averages them. An isolated node with no edges uses only its own intrinsic trust. So a device surrounded by high-trust gateways and brokers gets a higher structural score than one sitting next to low-trust sensors. Degree (number of neighbors) is computed for other parts of the system but does not directly enter the trust formula—only the average neighbor reputation does.

**Behavioral trust (25%)** measures **stability of packets per second (PPS)**. The app compares a *baseline* PPS to an *effective* PPS. In normal mode those are the same (the value stored on the node). In compromise scenario mode, baseline is frozen when the scenario starts, and effective is whatever you set in the scenario (including overrides). Deviation is `|effective − baseline| / baseline`. Behavioral trust starts at 100 when there is no drift and falls linearly as deviation grows; at **35% relative change** or more, the behavioral component hits zero. So a large traffic spike or drop during a scenario pulls this part of the trust score down quickly.

**Interaction trust (20%)** checks whether **links match endpoint traffic**. For every edge incident on the node, the app compares the edge’s effective PPS to the smaller of the two endpoints’ effective PPS (the plausible capacity on that hop). If the edge rate is in line with what the endpoints could be sending, the link gets a high quality ratio; if the edge claims far more (or far less) traffic than the endpoints support, quality drops. The interaction score is the average of those ratios across incident edges, times 100. A node with no connections gets 100 here—neutral, not penalized.

The four weighted pieces are summed, clamped to 0–100, and rounded for display. In short: **class reputation + neighborhood reputation + traffic stability + link consistency**. The trust score updates whenever the graph, scenario overrides, or effective PPS values change, and it is always visible on nodes—even when compromise scenario mode is off.

---

## How TGNN works in this app

**Temporal Graph Neural Network (TGNN)** here means: each device is embedded using **two time steps**—the scenario **baseline** (when compromise mode started) and the **effective** state (after attacker edits)—and those embeddings are refined with **neighbor message passing** over the live topology. Unusual **contextual drift** (traffic + trust + degree, smoothed across neighbors) yields a higher anomaly score. The detector only runs when **compromise scenario mode is active**. With the scenario off, every node gets a neutral score (0.5) and is never marked anomalous.

The app treats the network at scenario start as **“normal.”** When you turn the scenario on, it snapshots each node’s metrics into **scenario baselines** and does not change those until you turn the scenario off. You then edit traffic in the inspector (or elsewhere) to simulate compromise; those edits become the **effective** state. TGNN compares each device’s temporal embedding at effective time against its own baseline embedding—not to a global model trained on historical telemetry.

**Feature construction.** For every node, the app builds **eleven normalized features** (each roughly 0–1): log-scaled traffic deviation, PPS delta, effective throughput, per-metric HTTP/file/login deviations, peer trust, graph degree, intrinsic trust, and behavioral and interaction trust components. Baseline and effective rows are concatenated into a **22-dimensional temporal input** per node.

**Graph forward pass.** Fixed-weight layers (no runtime training): input projection → two rounds of neighbor mean aggregation with message weights → final embedding. The **anomaly score** is a sigmoid of the L2 distance between the **current** embedding (baseline + effective) and the **reference** embedding (baseline + baseline), so isolated metric bumps are harder to flag unless they look odd in graph context.

**Who can actually be flagged.** Only nodes with **scenario drift** and at least **10%** relative metric change are candidates (or a **50%+** spike on any single metric, e.g. files 10→80). **Every** qualifying drift candidate with TGNN score ≥ **0.58** can be flagged, plus either score ≥ **0.50** or sufficient spread (**0.06**) and gap (**0.04**). Small graphs (&lt; 3 nodes) need score ≥ **0.55**. File/HTTP/login deviations use a linear feature scale so large single-metric jumps register strongly.

**What happens after detection.** Anomaly node IDs feed **attack spread** simulation: neighbors with lower trust resistance are explored to show propagation and “at risk” devices. The inspector and node badges reflect **attack origin**, **spread target**, and **at risk** roles.

**How to think about it in one sentence:** TGNN answers *which device’s post-change behavior is the strangest in graph context compared to its own baseline snapshot*, while the trust score answers *how trustworthy does this device look overall* using a transparent weighted formula.

---

## Trust score vs TGNN

| | Trust score | TGNN |
|---|-------------|------|
| **Purpose** | Continuous reliability indicator (0–100) | Flag likely compromise / outlier under scenario |
| **When it runs** | Always | Only when compromise scenario is on |
| **Method** | Fixed weighted formula | Temporal graph embeddings + reconstruction error |
| **Needs traffic change** | No (drift lowers behavioral part only) | Yes—≥10% drift or 50%+ metric spike; multiple nodes can flag |
| **Shown as** | Percent on every node | Anomaly badges, toast, spread coloring |

Together they give operators a readable **trust meter** on every device and a **graph-aware anomaly pick** when simulating an attack on the canvas, with headroom for attackers to experiment before crossing detection thresholds.
