import { attackPresetTitle } from './attackPresets.js'

/** @typedef {'seed' | 'primarySpread' | 'injected' | 'highFileNeighbor' | 'explicit'} CampaignStageTarget */
/** @typedef {'active' | 'contained' | 'completed' | 'aborted'} CampaignStatus */

export const CAMPAIGN_STATUSES = Object.freeze([
  'active',
  'contained',
  'completed',
  'aborted',
])

export const MANUAL_PLAYBOOK_ID = 'manual'

export const CAMPAIGN_PLAYBOOKS = Object.freeze([
  {
    id: 'payments_disruption',
    title: 'Payments disruption',
    description: 'Spray credentials, abuse APIs, then flood the primary spread hop.',
    stages: [
      { id: 'recon', presetId: 'credential_spray', delayTicks: 0, target: 'seed' },
      { id: 'foothold', presetId: 'api_abuse', delayTicks: 4, target: 'seed' },
      { id: 'lateral', presetId: 'traffic_flood', delayTicks: 4, target: 'primarySpread' },
    ],
  },
  {
    id: 'data_theft',
    title: 'Data theft',
    description: 'API abuse, then exfiltrate, then flood a high-file neighbor.',
    stages: [
      { id: 'probe', presetId: 'api_abuse', delayTicks: 0, target: 'seed' },
      { id: 'exfil', presetId: 'data_exfiltration', delayTicks: 4, target: 'seed' },
      { id: 'cover', presetId: 'traffic_flood', delayTicks: 4, target: 'highFileNeighbor' },
    ],
  },
  {
    id: 'access_then_flood',
    title: 'Access then flood',
    description: 'Credential spray on the seed, then a traffic flood on the same node.',
    stages: [
      { id: 'access', presetId: 'credential_spray', delayTicks: 0, target: 'seed' },
      { id: 'flood', presetId: 'traffic_flood', delayTicks: 5, target: 'seed' },
    ],
  },
])

export function getPlaybook(playbookId) {
  return CAMPAIGN_PLAYBOOKS.find((p) => p.id === playbookId) ?? null
}

export function playbookTitle(playbookId) {
  if (playbookId === MANUAL_PLAYBOOK_ID) return 'Manual campaign'
  return getPlaybook(playbookId)?.title ?? String(playbookId ?? 'Campaign')
}

export function clonePlaybookStages(playbookId) {
  const book = getPlaybook(playbookId)
  if (!book) return []
  return book.stages.map((s) => ({
    id: s.id,
    presetId: s.presetId,
    delayTicks: s.delayTicks,
    target: s.target,
    explicitNodeId: null,
    status: 'pending',
    appliedTick: null,
    targetNodeId: null,
  }))
}

export function emptyCampaign() {
  return {
    id: '',
    roomId: '',
    playbookId: MANUAL_PLAYBOOK_ID,
    title: playbookTitle(MANUAL_PLAYBOOK_ID),
    status: 'active',
    seedNodeId: '',
    stageIndex: 0,
    startedTick: 0,
    completedTick: null,
    incidentIds: [],
    fingerprint: '',
    stages: [],
    overrideNodeIds: [],
    patternStored: false,
  }
}

export function appliedPresetSequence(campaign) {
  return (campaign?.stages ?? [])
    .filter((s) => s.status === 'applied')
    .map((s) => s.presetId)
}

export function distinctAppliedPresets(campaign) {
  return [...new Set(appliedPresetSequence(campaign))]
}

export function campaignFingerprint(campaign) {
  const seq = appliedPresetSequence(campaign)
  const playbookId = campaign?.playbookId || MANUAL_PLAYBOOK_ID
  if (playbookId !== MANUAL_PLAYBOOK_ID) {
    return `${playbookId}|${seq.join('>')}`
  }
  const types = [...new Set((campaign?.detectionTypes ?? []).filter(Boolean))].sort()
  const metrics = [...new Set((campaign?.metricKeys ?? []).filter(Boolean))].sort()
  const presets = [...seq].sort()
  const parts = [`manual`, presets.join('+')]
  if (types.length) parts.push(`t:${types.join(',')}`)
  if (metrics.length) parts.push(`m:${metrics.join(',')}`)
  return parts.join('|')
}

export function patternTitleFor(campaign) {
  const book = getPlaybook(campaign?.playbookId)
  if (book) return book.title
  const presets = distinctAppliedPresets(campaign)
  if (presets.length === 0) return 'Manual campaign'
  return `Manual: ${presets.map(attackPresetTitle).join(' + ')}`
}

export function nextPendingStage(campaign) {
  return (campaign?.stages ?? []).find((s) => s.status === 'pending') ?? null
}

export function activeCampaign(campaigns) {
  return (campaigns ?? []).find((c) => c.status === 'active') ?? null
}

export function stageProgressLabel(campaign) {
  const stages = campaign?.stages ?? []
  if (stages.length === 0) return 'No stages'
  const applied = stages.filter((s) => s.status === 'applied').length
  const skipped = stages.filter((s) => s.status === 'skipped').length
  return `${applied + skipped}/${stages.length} stages`
}
