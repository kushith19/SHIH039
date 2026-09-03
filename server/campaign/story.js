import { formatStoryClock } from '../../shared/cityContext.js'
import {
  chapterOf,
  emptyAttackStory,
  fallbackStoryExplanation,
  impactLabel,
  isSensitiveExposure,
  originCaptionFromEvidence,
  originCaptionFromPreset,
  storyPathFingerprint,
} from '../../shared/attackStory.js'
import { activeCampaign, appliedPresetSequence, playbookTitle } from '../../shared/campaigns.js'
import { detectionTypeLabel, SEVERITY_LEVELS } from '../../shared/incidents.js'

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
  return campaigns.find((c) => c.status === 'contained' || c.status === 'completed') ?? null
}

function pickOriginId(room, detection, campaign) {
  const anomalies = Array.isArray(detection?.anomalyNodeIds) ? detection.anomalyNodeIds : []
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  if (campaign?.seedNodeId && anomalies.includes(campaign.seedNodeId)) return campaign.seedNodeId
  if (anomalies[0]) return anomalies[0]
  if (campaign?.seedNodeId && incidents.some((i) => i.endpointId === campaign.seedNodeId)) {
    return campaign.seedNodeId
  }
  return incidents[0]?.endpointId ?? campaign?.seedNodeId ?? null
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

function hopNodes(room, detection, originId, campaign) {
  const ids = []
  const seen = new Set()
  function push(id) {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  push(originId)
  push(detection?.primarySpreadNodeId)
  for (const stage of campaign?.stages ?? []) {
    if (stage.status === 'applied' && stage.targetNodeId && stage.targetNodeId !== originId) {
      push(stage.targetNodeId)
    }
  }
  const sensitive = []
  for (const id of detection?.atRiskNodeIds ?? []) {
    const meta = nodeMeta(room, id)
    if (isSensitiveExposure(meta.sector, meta.type)) sensitive.push(id)
  }
  for (const id of sensitive) {
    if (ids.length >= 4) break
    push(id)
  }
  for (const id of detection?.atRiskNodeIds ?? []) {
    if (ids.length >= 4) break
    push(id)
  }
  return ids.slice(0, 4)
}

function storyStatus(campaign) {
  if (campaign?.status === 'contained') return 'contained'
  if (campaign?.status === 'completed') return 'completed'
  if (campaign?.status === 'aborted') return 'completed'
  return 'live'
}

function momentumFromHops(prevCount, hopCount, first) {
  if (first) {
    if (hopCount >= 4) return '↑↑'
    if (hopCount >= 3) return '↑'
    return '→'
  }
  if (hopCount >= prevCount + 2) return '↑↑'
  if (hopCount > prevCount) return '↑'
  return '→'
}

function ensureStory(room, campaign) {
  let story = room.attackStory
  if (!story || typeof story !== 'object') story = emptyAttackStory()
  if (campaign?.id && story.campaignId && story.campaignId !== campaign.id) {
    story = emptyAttackStory()
  }
  if (campaign?.id) story.campaignId = campaign.id
  story.title = campaign?.title || playbookTitle(campaign?.playbookId) || 'Live detection'
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
 * Append origin / detect / lateral; mutate risk + commander. Persists on the room.
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
    const preset = appliedPresetSequence(campaign)[0]
    const caption =
      originCaptionFromPreset(preset) || originCaptionFromEvidence(inc?.evidence) || 'abnormal traffic'
    appendChapter(story, {
      id: 'origin',
      kind: 'origin',
      tick,
      clock: clockAt(tick),
      title: 'Attack begins',
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
      title: 'Graph detects it',
      nodeId: origin,
      detectionType: originInc.detectionType,
      detectionLabel: detectionTypeLabel(originInc.detectionType),
      tgnn,
      trust: Number(originInc.trustScore) || 0,
    })
  }

  const pathIds = hopNodes(room, detection, origin, campaign)
  const hop = detection?.primarySpreadNodeId
  const stageHop = (campaign?.stages ?? []).find(
    (s) => s.status === 'applied' && s.targetNodeId && s.targetNodeId !== origin
  )
  const shouldLateral = Boolean((hop && hop !== origin) || stageHop) && pathIds.length >= 2
  if (shouldLateral && !chapterOf(story, 'lateral')) {
    appendChapter(story, {
      id: 'lateral',
      kind: 'lateral',
      tick,
      clock: clockAt(tick),
      title: 'Attack moves',
      path: pathIds.map((id) => ({ id, label: nodeLabel(room, id) })),
    })
  }

  const exposedIds = [
    ...new Set(
      [
        origin,
        ...(detection?.compromisedNodeIds ?? []),
        ...(detection?.atRiskNodeIds ?? []),
        detection?.primarySpreadNodeId,
        ...pathIds,
      ].filter(Boolean)
    ),
  ]
  const hopCount = exposedIds.length
  const financialIds = exposedIds.filter((id) => {
    const meta = nodeMeta(room, id)
    return isSensitiveExposure(meta.sector, meta.type)
  })
  const severity = maxSeverity(detection?.incidents)
  const firstRisk = !chapterOf(story, 'risk')
  const momentum = momentumFromHops(story.lastHopCount || 0, hopCount, firstRisk)
  story.lastHopCount = hopCount
  const riskPayload = {
    id: 'risk',
    kind: 'risk',
    tick,
    clock: firstRisk ? clockAt(tick) : chapterOf(story, 'risk')?.clock ?? clockAt(tick),
    title: 'Risk grows',
    momentum,
    impact: impactLabel(severity),
    financialExposed: financialIds.length,
    hopCount,
  }
  const existingRisk = chapterOf(story, 'risk')
  if (existingRisk) Object.assign(existingRisk, riskPayload, { clock: existingRisk.clock, tick: existingRisk.tick })
  else if (chapterOf(story, 'origin')) appendChapter(story, riskPayload)

  const detectCh = chapterOf(story, 'detect')
  if (detectCh) {
    const path = (chapterOf(story, 'lateral')?.path ?? chapterOf(story, 'origin')?.path ?? []).map(
      (p) => p.label
    )
    const fp = storyPathFingerprint(pathIds.length ? pathIds : [origin])
    const originLabel = nodeLabel(room, origin)
    const nextLabel = path[1] || ''
    const tailLabel = path.length > 2 ? path[path.length - 1] : nextLabel
    const text = fallbackStoryExplanation({
      origin: originLabel,
      next: nextLabel,
      tail: tailLabel,
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
        title: 'AI Commander',
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
  const lateral = chapterOf(story, 'lateral')
  const risk = chapterOf(story, 'risk')
  const commander = chapterOf(story, 'commander')
  if (!story || !detect || !origin || !commander) return null
  const path = (lateral?.path ?? origin.path ?? []).map((p) => p.label)
  const originLabel = origin.nodeLabel
  const nextLabel = path[1] || ''
  const tailLabel = path.length > 2 ? path[path.length - 1] : nextLabel
  const pathIds = (lateral?.path ?? origin.path ?? []).map((p) => p.id)
  const deps = []
  for (let i = 0; i < pathIds.length - 1; i += 1) {
    deps.push({
      id: `story-dep-${pathIds[i]}-${pathIds[i + 1]}`,
      source: pathIds[i],
      target: pathIds[i + 1],
      role: 'spread',
    })
  }
  return {
    id: `story-${story.campaignId || 'ungrouped'}`,
    endpointId: origin.nodeId,
    endpointLabel: originLabel,
    severity: risk?.impact === 'HIGH' ? 'high' : risk?.impact === 'MEDIUM' ? 'medium' : 'low',
    confidence: 0.8,
    anomalyScore: detect.tgnn,
    trustScore: detect.trust,
    detectionType: detect.detectionType || 'graph_propagation',
    evidence: [
      {
        code: 'origin_spread',
        kind: 'graph_propagation',
        detail: `path ${path.join(' → ') || originLabel}`,
      },
      {
        code: 'tgnn_embed',
        kind: 'structural_anomaly',
        score: detect.tgnn,
        detail: `TGNN ${detect.tgnn}`,
      },
    ],
    affectedDependencies: deps,
    campaignId: story.campaignId,
    explanation: commander.text,
    explanationStatus: commander.status,
    _story: {
      origin: originLabel,
      next: nextLabel,
      tail: tailLabel,
      pathFingerprint: story.pathFingerprint,
    },
  }
}
