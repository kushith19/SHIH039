/**
 * Demo seed for Post-Analysis Analyze dashboard.
 * Clearly labeled source=demo_seed — not LLM output.
 * Idempotent: skips if room already has demo_seed archive rows.
 */

import {
  POST_ANALYSIS_SOURCE,
  POST_ANALYSIS_STATUS,
  RECOMMENDATION_STATUS,
  RECOMMENDATION_PRIORITY,
  RECOMMENDATION_CATEGORY,
} from '../../shared/postAnalysis/schema.js'
import { buildRecommendationFingerprint } from '../../shared/postAnalysis/fingerprint.js'
import {
  listArchiveIncidents,
  upsertArchiveIncident,
  upsertRecommendationFromValidated,
  patchRecommendationStatus,
  getRecommendation,
  linkRecommendationIncident,
} from './store.js'

const DAY = 24 * 60 * 60 * 1000

function daysAgo(n, nowMs) {
  return nowMs - n * DAY
}

/**
 * @param {string} roomId
 * @returns {{ seeded: boolean, incidents: number, recommendations: number }}
 */
export function seedPostAnalysisDemo(roomId, { nowMs = Date.now(), force = false } = {}) {
  const id = String(roomId ?? 'DEMO').toUpperCase()
  const existing = listArchiveIncidents(id, { limit: 5 })
  if (!force && existing.some((i) => i.source === POST_ANALYSIS_SOURCE.DEMO_SEED || i.source === 'demo_seed')) {
    return { seeded: false, incidents: 0, recommendations: 0, reason: 'already_seeded' }
  }

  const episodes = [
    {
      liveIncidentId: 'inc-api-gw',
      attackType: 'communication_anomaly',
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedLabel: 'City API Gateway',
      severity: 'high',
      firstOffsetDays: 4,
      evidence: [
        {
          metric: 'httpRequestsPerMin',
          observed: 4200,
          expected: 180,
          deviationPct: 2233,
        },
      ],
      trustScore: 0.41,
      anomalyScore: 0.88,
    },
    {
      liveIncidentId: 'inc-api-gw',
      attackType: 'communication_anomaly',
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedLabel: 'City API Gateway',
      severity: 'high',
      firstOffsetDays: 3,
      evidence: [
        {
          metric: 'httpRequestsPerMin',
          observed: 3900,
          expected: 175,
          deviationPct: 2128,
        },
      ],
      trustScore: 0.38,
      anomalyScore: 0.91,
    },
    {
      liveIncidentId: 'inc-api-gw',
      attackType: 'communication_anomaly',
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedLabel: 'City API Gateway',
      severity: 'critical',
      firstOffsetDays: 1,
      evidence: [
        {
          metric: 'httpRequestsPerMin',
          observed: 5100,
          expected: 190,
          deviationPct: 2584,
        },
      ],
      trustScore: 0.32,
      anomalyScore: 0.94,
    },
    {
      liveIncidentId: 'inc-api-gw',
      attackType: 'communication_anomaly',
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedLabel: 'City API Gateway',
      severity: 'high',
      firstOffsetDays: 0,
      evidence: [
        {
          metric: 'httpRequestsPerMin',
          observed: 4600,
          expected: 185,
          deviationPct: 2386,
        },
      ],
      trustScore: 0.35,
      anomalyScore: 0.9,
      hoursAgo: 0.3,
    },
    {
      liveIncidentId: 'inc-id-auth',
      attackType: 'behavioural_anomaly',
      attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
      affectedAssetId: 'identity_access',
      affectedLabel: 'Identity & Access Service',
      severity: 'high',
      firstOffsetDays: 5,
      evidence: [
        {
          metric: 'failedLoginsPerMin',
          observed: 95,
          expected: 2,
          deviationPct: 4650,
        },
      ],
      trustScore: 0.44,
      anomalyScore: 0.86,
    },
    {
      liveIncidentId: 'inc-id-auth',
      attackType: 'behavioural_anomaly',
      attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
      affectedAssetId: 'identity_access',
      affectedLabel: 'Identity & Access Service',
      severity: 'medium',
      firstOffsetDays: 2,
      evidence: [
        {
          metric: 'failedLoginsPerMin',
          observed: 72,
          expected: 2,
          deviationPct: 3500,
        },
      ],
      trustScore: 0.48,
      anomalyScore: 0.79,
    },
    {
      liveIncidentId: 'inc-traffic',
      attackType: 'temporal_anomaly',
      attackCategory: 'NETWORK_TRAFFIC_FLOOD',
      affectedAssetId: 'traffic_control',
      affectedLabel: 'Traffic Control Core',
      severity: 'medium',
      firstOffsetDays: 6,
      evidence: [
        {
          metric: 'packetsPerSecond',
          observed: 18000,
          expected: 1200,
          deviationPct: 1400,
        },
      ],
      trustScore: 0.52,
      anomalyScore: 0.77,
    },
    {
      liveIncidentId: 'inc-traffic',
      attackType: 'temporal_anomaly',
      attackCategory: 'NETWORK_TRAFFIC_FLOOD',
      affectedAssetId: 'traffic_control',
      affectedLabel: 'Traffic Control Core',
      severity: 'medium',
      firstOffsetDays: 1,
      evidence: [
        {
          metric: 'packetsPerSecond',
          observed: 15000,
          expected: 1100,
          deviationPct: 1263,
        },
      ],
      trustScore: 0.55,
      anomalyScore: 0.74,
    },
    {
      liveIncidentId: 'inc-pay',
      attackType: 'behavioural_anomaly',
      attackCategory: 'DATA_EXFILTRATION',
      affectedAssetId: 'payment_processing_system',
      affectedLabel: 'Payment Processing',
      severity: 'critical',
      firstOffsetDays: 3,
      evidence: [
        {
          metric: 'filesDownloaded',
          observed: 840,
          expected: 12,
          deviationPct: 6900,
        },
      ],
      trustScore: 0.28,
      anomalyScore: 0.96,
    },
    {
      liveIncidentId: 'inc-iot',
      attackType: 'structural_anomaly',
      attackCategory: 'GENERAL_RESIDUAL_ANOMALY',
      affectedAssetId: 'smart_actuator',
      affectedLabel: 'Smart Actuator Cluster',
      severity: 'low',
      firstOffsetDays: 2,
      evidence: [
        {
          metric: 'packetsPerSecond',
          observed: 900,
          expected: 400,
          deviationPct: 125,
        },
      ],
      trustScore: 0.61,
      anomalyScore: 0.62,
    },
  ]

  const archiveIds = []
  for (let i = 0; i < episodes.length; i += 1) {
    const ep = episodes[i]
    const first = ep.hoursAgo != null
      ? nowMs - ep.hoursAgo * 60 * 60 * 1000
      : daysAgo(ep.firstOffsetDays, nowMs)
    // Force distinct episodes: unique persistent ids + spaced timestamps outside 2h window
    const archived = upsertArchiveIncident({
      archiveId: `demo-pa-inc-${id.toLowerCase()}-${i + 1}`,
      persistentIncidentId: `demo-${ep.liveIncidentId}:${first}`,
      liveIncidentId: ep.liveIncidentId,
      roomId: id,
      firstDetectedAtMs: first,
      updatedAtMs: first,
      attackType: ep.attackType,
      attackCategory: ep.attackCategory,
      affectedAssetId: ep.affectedAssetId,
      affectedNodeId: ep.affectedAssetId,
      affectedLabel: ep.affectedLabel,
      severity: ep.severity,
      status: 'cleared',
      detectionSignals: [ep.attackType],
      evidence: ep.evidence,
      telemetrySummary: Object.fromEntries(
        ep.evidence.map((e) => [
          e.metric,
          { observed: e.observed, expected: e.expected, deviationPct: e.deviationPct },
        ])
      ),
      trustScore: ep.trustScore,
      anomalyScore: ep.anomalyScore,
      graphContext: { peerExposedNodeIds: [], propagatedNodeIds: [] },
      orchestrationPerformed: true,
      responseActions: [{ actionId: 'isolate-node', atMs: first + 60_000 }],
      recoveryStatus: 'recovered',
      postAnalysisStatus: POST_ANALYSIS_STATUS.COMPLETE,
      postAnalysisAtMs: first + 120_000,
      source: POST_ANALYSIS_SOURCE.DEMO_SEED,
      payload: { demo: true },
    })
    if (archived) archiveIds.push(archived.archiveId)
  }

  // --- Recommendations (demo_seed, not LLM) ---

  // 1) API key rotation — completed historically, then recurred (latest API abuse)
  const rotateValidated = {
    title: 'Rotate exposed API credentials',
    problem: 'Repeated API abuse indicates possible credential exposure on the city API gateway.',
    recommendation: 'Revoke the affected API key and rotate all associated credentials.',
    reason: 'The same API abuse pattern appeared repeatedly against the API gateway.',
    priority: RECOMMENDATION_PRIORITY.HIGH,
    category: RECOMMENDATION_CATEGORY.CREDENTIAL_SECURITY,
    softwareOnly: true,
  }
  const rotateFp = buildRecommendationFingerprint({
    attackCategory: 'SERVICE_API_ABUSE',
    affectedAssetId: 'api_gateway',
    recommendation: rotateValidated.recommendation,
  })

  // Historical completed instance (older)
  const completedRotate = upsertRecommendationFromValidated(id, rotateValidated, {
    fingerprint: rotateFp,
    archiveId: archiveIds[0],
    attackCategory: 'SERVICE_API_ABUSE',
    affectedAssetId: 'api_gateway',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(3, nowMs),
  })
  patchRecommendationStatus(completedRotate.recommendation.recommendationId, RECOMMENDATION_STATUS.COMPLETED, {
    nowMs: daysAgo(3, nowMs),
  })

  // Recurrence after completion (links newer API incidents)
  const recurredRotate = upsertRecommendationFromValidated(id, rotateValidated, {
    fingerprint: rotateFp,
    archiveId: archiveIds[3],
    attackCategory: 'SERVICE_API_ABUSE',
    affectedAssetId: 'api_gateway',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(0, nowMs),
  })
  for (const aid of [archiveIds[1], archiveIds[2]]) {
    if (aid && recurredRotate.recommendation) {
      linkRecommendationIncident(recurredRotate.recommendation.recommendationId, aid, nowMs)
    }
  }

  // 2) Auth policy — open
  const authValidated = {
    title: 'Tighten authentication policy',
    problem: 'Credential-spray activity detected against the identity service.',
    recommendation: 'Enforce MFA, increase lockout thresholds, and shorten session token lifetime.',
    reason: 'Failed-login spikes were observed twice on the same authentication service.',
    priority: RECOMMENDATION_PRIORITY.MEDIUM,
    category: RECOMMENDATION_CATEGORY.AUTHENTICATION,
    softwareOnly: true,
  }
  const auth = upsertRecommendationFromValidated(id, authValidated, {
    fingerprint: buildRecommendationFingerprint({
      attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
      affectedAssetId: 'identity_access',
      recommendation: authValidated.recommendation,
    }),
    archiveId: archiveIds[4],
    attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
    affectedAssetId: 'identity_access',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(2, nowMs),
  })
  if (archiveIds[5]) {
    linkRecommendationIncident(auth.recommendation.recommendationId, archiveIds[5], nowMs)
  }

  // 3) Firewall ACL — in progress
  const fwValidated = {
    title: 'Update firewall ACL for flood sources',
    problem: 'Network traffic flood observed against traffic control.',
    recommendation: 'Tighten existing firewall rules and block the observed malicious IP ranges.',
    reason: 'Packet-rate floods repeated against the same traffic control core.',
    priority: RECOMMENDATION_PRIORITY.MEDIUM,
    category: RECOMMENDATION_CATEGORY.NETWORK_SECURITY,
    softwareOnly: true,
  }
  const fw = upsertRecommendationFromValidated(id, fwValidated, {
    fingerprint: buildRecommendationFingerprint({
      attackCategory: 'NETWORK_TRAFFIC_FLOOD',
      affectedAssetId: 'traffic_control',
      recommendation: fwValidated.recommendation,
    }),
    archiveId: archiveIds[6],
    attackCategory: 'NETWORK_TRAFFIC_FLOOD',
    affectedAssetId: 'traffic_control',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(1, nowMs),
  })
  patchRecommendationStatus(fw.recommendation.recommendationId, RECOMMENDATION_STATUS.IN_PROGRESS, {
    nowMs: daysAgo(1, nowMs),
  })
  if (archiveIds[7]) {
    linkRecommendationIncident(fw.recommendation.recommendationId, archiveIds[7], nowMs)
  }

  // 4) Exfil — open high
  const exfilValidated = {
    title: 'Revoke sessions and restrict file-transfer scope',
    problem: 'Elevated file-download volume on payment processing suggests possible data exfiltration.',
    recommendation: 'Revoke active sessions, rotate service credentials, and tighten application file-access controls.',
    reason: 'Files-downloaded deviation was extreme on a finance-critical service.',
    priority: RECOMMENDATION_PRIORITY.CRITICAL,
    category: RECOMMENDATION_CATEGORY.APPLICATION_SECURITY,
    softwareOnly: true,
  }
  upsertRecommendationFromValidated(id, exfilValidated, {
    fingerprint: buildRecommendationFingerprint({
      attackCategory: 'DATA_EXFILTRATION',
      affectedAssetId: 'payment_processing_system',
      recommendation: exfilValidated.recommendation,
    }),
    archiveId: archiveIds[8],
    attackCategory: 'DATA_EXFILTRATION',
    affectedAssetId: 'payment_processing_system',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(3, nowMs),
  })

  // 5) Completed monitoring improvement (no recurrence)
  const monValidated = {
    title: 'Increase failed-login alert sensitivity',
    problem: 'Credential attacks were detected late relative to volume spikes.',
    recommendation: 'Lower the failed-login alert threshold on the existing detection rules.',
    reason: 'Earlier alerting would have shortened mean time to detect spray activity.',
    priority: RECOMMENDATION_PRIORITY.LOW,
    category: RECOMMENDATION_CATEGORY.MONITORING_DETECTION,
    softwareOnly: true,
  }
  const mon = upsertRecommendationFromValidated(id, monValidated, {
    fingerprint: buildRecommendationFingerprint({
      attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
      affectedAssetId: 'identity_access',
      recommendation: monValidated.recommendation,
      title: monValidated.title,
    }),
    archiveId: archiveIds[4],
    attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
    affectedAssetId: 'identity_access',
    source: POST_ANALYSIS_SOURCE.DEMO_SEED,
    nowMs: daysAgo(4, nowMs),
  })
  patchRecommendationStatus(mon.recommendation.recommendationId, RECOMMENDATION_STATUS.COMPLETED, {
    nowMs: daysAgo(4, nowMs),
  })

  // bump occurrence on recurred rotate for demo clarity
  const finalRecur = getRecommendation(recurredRotate.recommendation.recommendationId)

  console.log(
    `[POST-ANALYSIS] demo seed room=${id} incidents=${archiveIds.length} recommendations seeded (incl. completed + recurred)`
  )

  return {
    seeded: true,
    incidents: archiveIds.length,
    recommendations: 5,
    recurredId: finalRecur?.recommendationId ?? null,
  }
}
