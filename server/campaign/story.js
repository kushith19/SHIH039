import { formatStoryClock } from '../../shared/cityContext.js'
import {
  chapterOf,
  emptyAttackStory,
  fallbackStoryExplanation,
  impactLabel,
  isSensitiveExposure,
  originCaptionFromEvidence,
  storyPathFingerprint,
} from '../../shared/attackStory.js'
import { activeCampaign, campaignTitle } from '../../shared/campaigns.js'
import { detectionTypeLabel, SEVERITY_LEVELS } from '../../shared/incidents.js'
import {
  formatMomentumLine,
  formatScoreOver100,
  trajectoryLabel,
} from '../../shared/riskMomentum.js'

function nodeById(room, id) {
  return (room?.nodes ?? []).find((n) => n.id === id) ?? null
}

function nodeLabel(room, id) {
  if (!id) return ''
  const n = nodeById(room, id)
  return n?.data?.label ?? n?.label ?? String(id)
}

function nodeMeta(room, id) {
  const n = nodeById(room, id)
  return {
    id,
    label: nodeLabel(room, id),
    sector: n?.data?.sector ?? '',
    type: n?.data?.type ?? n?.data?.assetType ?? '',
  }
}

function chooseCampaign(room, detection) {
  const campaigns = Array.isArray(room?.campaigns) ? room.campaigns : []
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const linkedId = incidents.find((i) => i.campaignId)?.campaignId
  if (linkedId) {
    const linked = campaigns.find((c) => c.id === linkedId)
    if (linked && linked.status !== 'aborted') return linked
  }
  const active = activeCampaign(campaigns)
  if (active) return active
  return (
    campaigns.find((c) => c.status === 'contained' || c.status === 'completed' || c.status === 'expired') ??
    null
  )
}

function pickOriginId(room, detection, campaign) {
  const anomalies = Array.isArray(detection?.anomalyNodeIds) ? detection.anomalyNodeIds : []
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const origin = campaign?.originEndpointId || campaign?.seedNodeId
  if (origin && anomalies.includes(origin)) return origin
  if (anomalies[0]) return anomalies[0]
  if (origin && incidents.some((i) => i.endpointId === origin)) return origin
  return incidents[0]?.endpointId ?? origin ?? null
}

function incidentFor(detection, endpointId) {
  return (detection?.incidents ?? []).find((i) => i.endpointId === endpointId) ?? null
}

function maxSeverity(incidents) {
  let best = 'low'
  let bestIdx = 0
  for (const inc of incidents ?? []) {
    const idx = SEVERITY_LEVELS.indexOf(inc.severity)
    if (idx > bestIdx) {
      bestIdx = idx
      best = inc.severity
    }
  }
  return best
}

function hopNodes(_room, _detection, originId, _campaign) {
  return originId ? [originId] : []
}

function storyStatus(campaign) {
  if (campaign?.status === 'expired' || campaign?.status === 'completed' || campaign?.status === 'aborted') {
    return 'completed'
  }
  if (campaign?.status === 'contained') return 'contained'
  return 'live'
}

function riskChapterFromDetection(detection) {
  const rm = detection?.riskMomentum
  const windowTicks = Number(rm?.windowTicks) || 10
  return {
    score: rm?.score ?? null,
    delta: rm?.delta ?? null,
    trajectory: rm?.trajectory ?? 'stable',
    windowTicks,
    momentum: formatMomentumLine(rm?.delta, windowTicks),
    scoreLabel: formatScoreOver100(rm?.score),
    trajectoryLabel: trajectoryLabel(rm?.trajectory),
  }
}

function ensureStory(room, campaign) {
  let story = room.attackStory
  if (!story || typeof story !== 'object') story = emptyAttackStory()
  if (campaign?.id && story.campaignId && story.campaignId !== campaign.id) {
    story = emptyAttackStory()
  }
  if (campaign?.id) story.campaignId = campaign.id
  story.title = campaign ? campaignTitle(campaign) : story.title || 'Live detection'
  if (!campaign) story.title = story.title || 'Live detection'
  if (!story.chapters) story.chapters = []
  room.attackStory = story
  return story
}

function appendChapter(story, chapter) {
  story.chapters.push(chapter)
  return chapter
}

function clockAt(tick) {
  return formatStoryClock(tick)
}

/**
 * Append origin / detect; mutate risk + commander. Persists on the room.
 */
export function updateAttackStory(room, detection) {
  if (!room) return emptyAttackStory()
  const tick = Number(detection?.simulationTick ?? room.simulationTick) || 0
  const campaign = chooseCampaign(room, detection)
  const originId = pickOriginId(room, detection, campaign)
  const hasSignal =
    Boolean(originId) &&
    ((detection?.anomalyNodeIds ?? []).length > 0 ||
      (detection?.incidents ?? []).length > 0 ||
      (detection?.compromisedNodeIds ?? []).length > 0)

  if (!hasSignal && !chapterOf(room.attackStory, 'origin')) {
    if (!room.attackStory) room.attackStory = emptyAttackStory()
    return room.attackStory
  }

  const story = ensureStory(room, campaign)
  if (campaign) story.status = storyStatus(campaign)
  else if (chapterOf(story, 'origin')) story.status = hasSignal ? 'live' : story.status

  if (!originId && !chapterOf(story, 'origin')) return story

  const origin = originId || chapterOf(story, 'origin')?.nodeId
  if (!origin) return story

  if (!chapterOf(story, 'origin')) {
    const inc = incidentFor(detection, origin)
    const caption = originCaptionFromEvidence(inc?.evidence) || 'abnormal traffic'
    appendChapter(story, {
      id: 'origin',
      kind: 'origin',
      tick,
      clock: clockAt(tick),
      title: 'Observed origin',
      nodeId: origin,
      nodeLabel: nodeLabel(room, origin),
      path: [{ id: origin, label: nodeLabel(room, origin) }],
      caption,
    })
  }

  const originInc = incidentFor(detection, origin)
  if (originInc && !chapterOf(story, 'detect')) {
    const tgnn = Number(detection?.isolationScoresByNodeId?.[origin] ?? originInc.anomalyScore) || 0
    appendChapter(story, {
      id: 'detect',
      kind: 'detect',
      tick,
      clock: clockAt(tick),
      title: 'Residual detector',
      nodeId: origin,
      detectionType: originInc.detectionType,
      detectionLabel: detectionTypeLabel(originInc.detectionType),
      tgnn,
      trust: Number(originInc.trustScore) || 0,
    })
  }

  const pathIds = hopNodes(room, detection, origin, campaign)
  const exposedIds = [...new Set([origin].filter(Boolean))]
  const hopCount = 1
  const financialIds = exposedIds.filter((id) => {
    const meta = nodeMeta(room, id)
    return isSensitiveExposure(meta.sector, meta.type)
  })
  const severity = maxSeverity(detection?.incidents)
  const firstRisk = !chapterOf(story, 'risk')
  story.lastHopCount = hopCount
  const fromRm = riskChapterFromDetection(detection)
  const riskPayload = {
    id: 'risk',
    kind: 'risk',
    tick,
    clock: firstRisk ? clockAt(tick) : chapterOf(story, 'risk')?.clock ?? clockAt(tick),
    title: 'Severity assessment',
    ...fromRm,
    impact: impactLabel(severity),
    financialExposed: financialIds.length,
    hopCount,
  }
  const existingRisk = chapterOf(story, 'risk')
  if (existingRisk) Object.assign(existingRisk, riskPayload, { clock: existingRisk.clock, tick: existingRisk.tick })
  else if (chapterOf(story, 'origin')) appendChapter(story, riskPayload)

  const detectCh = chapterOf(story, 'detect')
  if (detectCh) {
    const path = (chapterOf(story, 'origin')?.path ?? []).map((p) => p.label)
    const fp = storyPathFingerprint(pathIds.length ? pathIds : [origin])
    const originLabel = nodeLabel(room, origin)
    const text = fallbackStoryExplanation({
      origin: originLabel,
    })
    const existing = chapterOf(story, 'commander')
    const pathChanged = story.pathFingerprint && story.pathFingerprint !== fp
    story.pathFingerprint = fp
    if (!existing) {
      appendChapter(story, {
        id: 'commander',
        kind: 'commander',
        tick,
        clock: clockAt(tick),
        title: 'Commander assessment',
        text,
        status: 'pending',
        pathFingerprint: fp,
      })
    } else if (pathChanged) {
      existing.text = text
      existing.status = 'pending'
      existing.pathFingerprint = fp
      existing.tick = tick
      existing.clock = clockAt(tick)
    }
  }

  return story
}

export function storyExplainPayload(room) {
  const story = room?.attackStory
  const detect = chapterOf(story, 'detect')
  const origin = chapterOf(story, 'origin')
  const risk = chapterOf(story, 'risk')
  const commander = chapterOf(story, 'commander')
  if (!story || !detect || !origin || !commander) return null
  const originLabel = origin.nodeLabel
  const originInc = (room?.detection?.incidents ?? []).find((i) => i.endpointId === origin.nodeId)
  return {
    id: `story-${story.campaignId || 'ungrouped'}`,
    endpointId: origin.nodeId,
    endpointLabel: origin.nodeId,
    severity: risk?.impact === 'HIGH' ? 'high' : risk?.impact === 'MEDIUM' ? 'medium' : 'low',
    confidence: 0.8,
    anomalyScore: detect.tgnn,
    trustScore: detect.trust,
    detectionType: detect.detectionType || 'behavioural_anomaly',
    evidence: Array.isArray(originInc?.evidence) && originInc.evidence.length
      ? originInc.evidence
      : [
          {
            code: 'origin_residual',
            kind: 'behavioural_anomaly',
            detail: origin.nodeId,
          },
        ],
    affectedDependencies: [],
    campaignId: story.campaignId,
    explanation: commander.text,
    explanationStatus: commander.status,
    _story: {
      origin: originLabel,
      pathFingerprint: story.pathFingerprint,
    },
  }
}
