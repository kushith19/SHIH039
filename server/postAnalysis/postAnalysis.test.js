import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { resetMetricsDbForTests } from '../metrics/store.js'
import {
  clearPostAnalysisForTests,
  buildAnalyzeOverview,
  getArchiveIncident,
  getRecommendation,
  listArchiveIncidents,
  listRecommendations,
  listRecommendationsForArchive,
  patchRecommendationStatus,
  upsertArchiveIncident,
  upsertRecommendationFromValidated,
} from './store.js'
import { archiveDetectionIncidents } from './archive.js'
import { runPostAnalysisForArchive } from './pipeline.js'
import {
  clearPostAnalysisLlmTestCaller,
  setPostAnalysisLlmTestCaller,
} from './llmClient.js'
import { seedPostAnalysisDemo } from './seed.js'
import { buildRecommendationFingerprint } from '../../shared/postAnalysis/fingerprint.js'
import {
  POST_ANALYSIS_STATUS,
  RECOMMENDATION_STATUS,
} from '../../shared/postAnalysis/schema.js'
import { deleteRoomIncidents } from '../metrics/store.js'

const ROOM = 'DEMO-PA'

beforeEach(() => {
  resetMetricsDbForTests()
  clearPostAnalysisLlmTestCaller()
})

afterEach(() => {
  clearPostAnalysisLlmTestCaller()
})

describe('post-analysis persistence', () => {
  it('archives incidents and survives match incident wipe', () => {
    const archived = upsertArchiveIncident({
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      firstDetectedAtMs: Date.now() - 1000,
      attackType: 'communication_anomaly',
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedNodeId: 'api_gateway',
      affectedLabel: 'API Gateway',
      severity: 'high',
      evidence: [{ metric: 'httpRequestsPerMin', observed: 1000, expected: 100, deviationPct: 900 }],
      trustScore: 0.4,
      anomalyScore: 0.9,
    })
    assert.ok(archived?.archiveId)

    // Match-scoped wipe must NOT clear post-analysis archive
    deleteRoomIncidents(ROOM)
    const still = getArchiveIncident(archived.archiveId)
    assert.ok(still)
    assert.equal(still.affectedAssetId, 'api_gateway')
  })

  it('archives from live detection projection', () => {
    const room = { id: ROOM, nodes: [], edges: [] }
    const detection = {
      incidents: [
        {
          id: 'inc-pay',
          endpointId: 'payment_processing_system',
          endpointLabel: 'Payments',
          detectionType: 'behavioural_anomaly',
          severity: 'high',
          trustScore: 0.5,
          anomalyScore: 0.8,
          evidence: [{ metric: 'filesDownloaded', observed: 50, expected: 5, deviationPct: 900 }],
          persistentId: 'inc-pay:1',
        },
      ],
    }
    const out = archiveDetectionIncidents(room, detection)
    assert.equal(out.length, 1)
    assert.equal(detection.incidents[0].archiveId, out[0].archiveId)
    assert.equal(listArchiveIncidents(ROOM).length, 1)
  })
})

describe('recommendation dedup and recurrence', () => {
  const validated = {
    title: 'Rotate exposed API credentials',
    problem: 'API abuse',
    recommendation: 'Revoke the affected API key and rotate credentials.',
    reason: 'Repeated',
    priority: 'high',
    category: 'credential_security',
    softwareOnly: true,
  }

  it('deduplicates unresolved recommendations and increments occurrence', () => {
    const fp = buildRecommendationFingerprint({
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      recommendation: validated.recommendation,
    })
    const a = upsertArchiveIncident({
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      severity: 'high',
    })
    const first = upsertRecommendationFromValidated(ROOM, validated, {
      fingerprint: fp,
      archiveId: a.archiveId,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      source: 'llm',
    })
    assert.equal(first.action, 'created')

    const b = upsertArchiveIncident({
      archiveId: 'pa-other',
      persistentIncidentId: 'inc-api:2',
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      firstDetectedAtMs: Date.now() - 3 * 60 * 60 * 1000,
      updatedAtMs: Date.now() - 3 * 60 * 60 * 1000,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      severity: 'high',
    })
    const second = upsertRecommendationFromValidated(ROOM, validated, {
      fingerprint: fp,
      archiveId: b.archiveId,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      source: 'llm',
    })
    assert.equal(second.action, 'duplicate')
    assert.equal(second.recommendation.recommendationId, first.recommendation.recommendationId)
    assert.equal(second.recommendation.occurrenceCount, 2)
    assert.equal(listRecommendations(ROOM).length, 1)
  })

  it('marks recurrence after completed remediation', () => {
    const fp = buildRecommendationFingerprint({
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      recommendation: validated.recommendation,
    })
    const a = upsertArchiveIncident({
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
    })
    const first = upsertRecommendationFromValidated(ROOM, validated, {
      fingerprint: fp,
      archiveId: a.archiveId,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
    })
    const done = patchRecommendationStatus(
      first.recommendation.recommendationId,
      RECOMMENDATION_STATUS.COMPLETED
    )
    assert.equal(done.ok, true)

    const b = upsertArchiveIncident({
      archiveId: 'pa-later',
      persistentIncidentId: 'inc-api:later',
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      firstDetectedAtMs: Date.now(),
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
    })
    const again = upsertRecommendationFromValidated(ROOM, validated, {
      fingerprint: fp,
      archiveId: b.archiveId,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
    })
    assert.equal(again.action, 'recurred')
    assert.equal(again.recommendation.status, RECOMMENDATION_STATUS.RECURRED)
    assert.ok(again.recommendation.priorCompletionNote)
    assert.notEqual(
      again.recommendation.recommendationId,
      first.recommendation.recommendationId
    )
  })

  it('persists mark completed and associates incidents', () => {
    const a = upsertArchiveIncident({
      liveIncidentId: 'inc-id',
      roomId: ROOM,
      attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
      affectedAssetId: 'identity_access',
    })
    const created = upsertRecommendationFromValidated(
      ROOM,
      {
        title: 'Enforce MFA',
        recommendation: 'Enable MFA and shorten session lifetime on the auth service.',
        priority: 'medium',
        category: 'authentication',
        softwareOnly: true,
      },
      {
        archiveId: a.archiveId,
        attackCategory: 'IDENTITY_CREDENTIAL_ATTACK',
        affectedAssetId: 'identity_access',
      }
    )
    const patched = patchRecommendationStatus(
      created.recommendation.recommendationId,
      'completed'
    )
    assert.equal(patched.recommendation.status, 'completed')
    const linked = listRecommendationsForArchive(a.archiveId)
    assert.equal(linked.length, 1)
  })
})

describe('post-analysis LLM pipeline', () => {
  it('creates validated recommendations from LLM JSON', async () => {
    const archived = upsertArchiveIncident({
      liveIncidentId: 'inc-api',
      roomId: ROOM,
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      affectedLabel: 'API GW',
      severity: 'high',
      evidence: [{ metric: 'httpRequestsPerMin', observed: 2000, expected: 100, deviationPct: 1900 }],
      postAnalysisStatus: POST_ANALYSIS_STATUS.PENDING,
    })

    setPostAnalysisLlmTestCaller(async () => ({
      httpStatus: 200,
      content: JSON.stringify({
        recommendations: [
          {
            title: 'Rotate API credentials',
            problem: 'Abuse',
            recommendation: 'Revoke and rotate the API key',
            reason: 'Repeated spikes',
            priority: 'high',
            category: 'api_security',
            softwareOnly: true,
          },
          {
            title: 'Add hardware',
            problem: 'Capacity',
            recommendation: 'Install a new device and add another server',
            reason: 'Scale out',
            priority: 'high',
            category: 'network_security',
            softwareOnly: true,
          },
        ],
      }),
    }))

    const result = await runPostAnalysisForArchive(archived.archiveId)
    assert.equal(result.ok, true)
    assert.equal(result.results.length, 1)
    assert.equal(result.rejected.length, 1)
    const updated = getArchiveIncident(archived.archiveId)
    assert.equal(updated.postAnalysisStatus, POST_ANALYSIS_STATUS.COMPLETE)
  })

  it('marks unavailable when LLM fails', async () => {
    const archived = upsertArchiveIncident({
      liveIncidentId: 'inc-x',
      roomId: ROOM,
      attackCategory: 'GENERAL_RESIDUAL_ANOMALY',
      affectedAssetId: 'node-x',
    })
    setPostAnalysisLlmTestCaller(async () => {
      throw new Error('ollama down')
    })
    const result = await runPostAnalysisForArchive(archived.archiveId)
    assert.equal(result.ok, false)
    assert.equal(getArchiveIncident(archived.archiveId).postAnalysisStatus, 'unavailable')
  })

  it('handles invalid LLM response without fabricating recommendations', async () => {
    const archived = upsertArchiveIncident({
      liveIncidentId: 'inc-y',
      roomId: ROOM,
      attackCategory: 'NETWORK_TRAFFIC_FLOOD',
      affectedAssetId: 'traffic',
    })
    setPostAnalysisLlmTestCaller(async () => ({
      httpStatus: 200,
      content: 'sorry I cannot help',
    }))
    const result = await runPostAnalysisForArchive(archived.archiveId)
    assert.equal(result.ok, false)
    assert.equal(listRecommendations(ROOM).length, 0)
  })
})

describe('demo seed and overview', () => {
  it('seeds demo data and builds overview metrics', () => {
    const seeded = seedPostAnalysisDemo(ROOM, { force: true })
    assert.equal(seeded.seeded, true)
    assert.ok(seeded.incidents >= 8)
    const overview = buildAnalyzeOverview(ROOM)
    assert.ok(overview.totals.incidents >= 8)
    assert.ok(overview.totals.recommendations >= 4)
    assert.ok(overview.totals.recurringIssues >= 1)
    assert.ok(overview.recurringPatterns.length >= 1)
    const again = seedPostAnalysisDemo(ROOM)
    assert.equal(again.seeded, false)
  })
})

describe('clearPostAnalysisForTests', () => {
  it('clears room archive', () => {
    upsertArchiveIncident({ liveIncidentId: 'inc-z', roomId: ROOM, affectedAssetId: 'z' })
    clearPostAnalysisForTests(ROOM)
    assert.equal(listArchiveIncidents(ROOM).length, 0)
  })
})
