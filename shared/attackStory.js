export const STORY_STATUSES = Object.freeze(['live', 'contained', 'completed'])

export const PRESET_ORIGIN_CAPTIONS = Object.freeze({
  api_abuse: 'abnormal API traffic',
  credential_spray: 'failed login spike',
  traffic_flood: 'abnormal packet rate',
  data_exfiltration: 'elevated file transfer',
})

export function emptyAttackStory() {
  return {
    campaignId: null,
    title: '',
    status: 'live',
    chapters: [],
    pathFingerprint: '',
    lastHopCount: 0,
  }
}

export function chapterOf(story, kind) {
  return (story?.chapters ?? []).find((c) => c.kind === kind) ?? null
}

export function originCaptionFromPreset(presetId) {
  return PRESET_ORIGIN_CAPTIONS[presetId] ?? null
}

export function originCaptionFromEvidence(evidence) {
  const items = Array.isArray(evidence) ? evidence : []
  const metrics = items.map((ev) => String(ev?.metric ?? ev?.code ?? ''))
  if (metrics.some((m) => m.includes('http') || m.includes('api'))) return PRESET_ORIGIN_CAPTIONS.api_abuse
  if (metrics.some((m) => m.includes('login') || m.includes('credential'))) {
    return PRESET_ORIGIN_CAPTIONS.credential_spray
  }
  if (metrics.some((m) => m.includes('file'))) return PRESET_ORIGIN_CAPTIONS.data_exfiltration
  if (metrics.some((m) => m.includes('packet') || m.includes('pps'))) {
    return PRESET_ORIGIN_CAPTIONS.traffic_flood
  }
  return 'abnormal traffic'
}

export function isSensitiveExposure(sector, type) {
  const s = String(sector ?? '').toLowerCase()
  const t = String(type ?? '').toLowerCase()
  return (
    s.includes('finance') ||
    s.includes('payment') ||
    s.includes('bank') ||
    s.includes('government') ||
    s.includes('municipal') ||
    t.includes('payment') ||
    t.includes('finance') ||
    t.includes('identity') ||
    t.includes('banking')
  )
}

export function impactLabel(severity) {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'critical' || s === 'high') return 'HIGH'
  if (s === 'medium') return 'MEDIUM'
  return 'LOW'
}

export function fallbackStoryExplanation({ origin, next, tail } = {}) {
  const originLabel = String(origin || 'the flagged endpoint').trim() || 'the flagged endpoint'
  const hop = String(next ?? '').trim()
  const end = String(tail ?? '').trim()
  if (!hop) {
    return `The observed traffic anomaly originated at ${originLabel}. Graph topology around this node is being watched for dependency-path exposure.`
  }
  if (!end || end === hop) {
    return `The observed traffic anomaly originated at ${originLabel} and subsequently altered communication behavior with ${hop}. The topology indicates a potentially dangerous dependency path.`
  }
  return `The observed traffic anomaly originated at ${originLabel} and subsequently altered communication behavior with ${hop}. The topology indicates a potentially dangerous dependency path toward ${end}.`
}

export function storyPathFingerprint(nodeIds) {
  return (Array.isArray(nodeIds) ? nodeIds : []).filter(Boolean).join('>')
}
