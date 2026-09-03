import { chapterOf, fallbackStoryExplanation } from './attackStory.js'

export const STORY_ACT_IDS = Object.freeze(['origin', 'detect', 'risk', 'commander'])

export const STORY_ACT_META = Object.freeze({
  origin: { n: '01', title: 'Attack begins', kicker: 'Observed origin' },
  detect: { n: '02', title: 'Residual detects', kicker: 'Graph residual detector' },
  risk: { n: '03', title: 'Risk escalates', kicker: 'Severity assessment' },
  commander: { n: '04', title: 'Commander responds', kicker: 'Security assessment' },
})

/** Play timeline in ms. Total 8s. */
export const STORY_ACT_DURATIONS_MS = Object.freeze([2000, 2000, 2000, 2000])

export const ILLUSTRATIVE_BANNER =
  'Not live telemetry. Press Play to rehearse the investigation.'

const ILLUSTRATIVE_TYPES = ['citizen_services', 'identity_access', 'banking_financial']

const ILLUSTRATIVE_LABELS = [
  'Citizen Services',
  'Identity & Access Infrastructure',
  'Banking & Financial Services',
]

export function residualToPct(tgnn) {
  if (tgnn == null || tgnn === '') return null
  const n = Number(tgnn)
  if (!Number.isFinite(n)) return null
  if (n <= 1) return Math.round(n * 100)
  return Math.round(Math.min(100, n))
}

export function bindIllustrativePath(nodes = []) {
  const list = Array.isArray(nodes) ? nodes : []
  const path = []
  for (let i = 0; i < ILLUSTRATIVE_TYPES.length; i += 1) {
    const type = ILLUSTRATIVE_TYPES[i]
    const hit = list.find((n) => {
      const t = n?.data?.type ?? n?.data?.assetType ?? n?.type
      return t === type
    })
    path.push({
      id: hit?.id ?? null,
      label: hit?.data?.label ?? hit?.label ?? ILLUSTRATIVE_LABELS[i],
      type,
    })
  }
  return path.slice(0, 1)
}

function originFromChapters(story) {
  const origin = chapterOf(story, 'origin')
  if (origin?.nodeId || origin?.nodeLabel) {
    return [{ id: origin.nodeId ?? origin.path?.[0]?.id ?? null, label: origin.nodeLabel || origin.path?.[0]?.label }]
  }
  return []
}

export function splitCommanderBriefing(text, commanderBriefing = null) {
  const raw = String(text ?? '').trim()
  const sentences = raw
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const what = sentences[0] || raw || 'Waiting for a composed assessment from detections and catalog correlation.'
  const why =
    sentences.slice(1).join(' ') ||
    'Numeric residual, trust, and telemetry evidence remain Level-1. This is not a confirmed attack.'
  const plan = commanderBriefing?.responsePlan || commanderBriefing?.response_plan || []
  const first = Array.isArray(plan) ? plan[0] : null
  const action =
    first?.action ||
    'Isolate the affected network segment, preserve monitoring, and investigate with the operator team. Advisory only — Commander does not actuate infrastructure.'
  return { what, why, action }
}

function liveActs(story, path, briefing) {
  const origin = chapterOf(story, 'origin')
  const detect = chapterOf(story, 'detect')
  const risk = chapterOf(story, 'risk')
  const commander = chapterOf(story, 'commander')
  const originLabel = origin?.nodeLabel || path[0]?.label || 'Flagged endpoint'
  const caption = origin?.caption || 'abnormal traffic'
  const residualPct = residualToPct(detect?.tgnn)
  const trust = detect?.trust != null && Number.isFinite(Number(detect.trust)) ? Math.round(Number(detect.trust)) : null
  const commanderText =
    commander?.text ||
    fallbackStoryExplanation({ origin: originLabel })
  const brief = splitCommanderBriefing(commanderText, briefing)

  return [
    {
      id: 'origin',
      clock: origin?.clock || '—',
      title: STORY_ACT_META.origin.title,
      kicker: STORY_ACT_META.origin.kicker,
      body: `A suspicious behavioral deviation was assessed at ${originLabel}. Caption: ${caption}. This is the observed starting point for the investigation, not a confirmed intrusion.`,
      entity: originLabel,
      caption,
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'detect',
      clock: detect?.clock || origin?.clock || '—',
      title: STORY_ACT_META.detect.title,
      kicker: STORY_ACT_META.detect.kicker,
      body: 'The graph residual detector compared this node to an idle-window embedding baseline (behavior, neighbors, and recent ticks). A high residual is a flag for investigation, not proof of an attack.',
      residualPct,
      trust,
      detectionLabel: detect?.detectionLabel || 'Behavioral anomaly',
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'risk',
      clock: risk?.clock || '—',
      title: STORY_ACT_META.risk.title,
      kicker: STORY_ACT_META.risk.kicker,
      body: `The finding is treated as an operator priority. Potential impact (from promoted severity): ${risk?.impact || 'LOW'}. Finance-tagged count is illustrative.`,
      impact: risk?.impact || 'LOW',
      financialExposed: risk?.financialExposed ?? 0,
      scoreLabel: risk?.scoreLabel,
      momentum: risk?.momentum,
      trajectoryLabel: risk?.trajectoryLabel,
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'commander',
      clock: commander?.clock || '—',
      title: STORY_ACT_META.commander.title,
      kicker: STORY_ACT_META.commander.kicker,
      body: commanderText,
      briefing: brief,
      commanderStatus: commander?.status,
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
  ]
}

function illustrativeActs(path) {
  const originLabel = path[0]?.label || ILLUSTRATIVE_LABELS[0]
  const text = fallbackStoryExplanation({ origin: originLabel })
  const brief = splitCommanderBriefing(text, null)
  const clocks = ['09:41:02', '09:41:03', '09:41:05', '09:41:06']
  return [
    {
      id: 'origin',
      clock: clocks[0],
      title: STORY_ACT_META.origin.title,
      kicker: STORY_ACT_META.origin.kicker,
      body: `Illustrative: abnormal API traffic at ${originLabel}. This walkthrough is not a live detection.`,
      entity: originLabel,
      caption: 'abnormal API traffic',
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'detect',
      clock: clocks[1],
      title: STORY_ACT_META.detect.title,
      kicker: STORY_ACT_META.detect.kicker,
      body: 'Illustrative residual vs idle baseline. Real matches use the live graph residual detector after the 15-tick calibrator.',
      residualPct: 81,
      trust: 63,
      detectionLabel: 'Behavioral anomaly',
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'risk',
      clock: clocks[2],
      title: STORY_ACT_META.risk.title,
      kicker: STORY_ACT_META.risk.kicker,
      body: 'Illustrative: residual flag and promoted severity. Not a hop-path simulation.',
      impact: 'HIGH',
      financialExposed: 1,
      scoreLabel: '81 / 100',
      momentum: '↑↑',
      trajectoryLabel: 'Rising',
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
    {
      id: 'commander',
      clock: clocks[3],
      title: STORY_ACT_META.commander.title,
      kicker: STORY_ACT_META.commander.kicker,
      body: text,
      briefing: brief,
      commanderStatus: 'ready',
      pathIds: path[0]?.id ? [path[0].id] : [],
    },
  ]
}

/**
 * @param {{
 *   attackStory?: object | null
 *   nodes?: object[]
 *   commanderBriefing?: object | null
 * }} args
 */
export function buildStoryExperience({ attackStory = null, nodes = [], commanderBriefing = null } = {}) {
  const origin = chapterOf(attackStory, 'origin')
  if (origin) {
    const path = originFromChapters(attackStory)
    const detect = chapterOf(attackStory, 'detect')
    const acts = liveActs(attackStory, path, commanderBriefing)
    const residualPct = residualToPct(detect?.tgnn)
    return {
      source: 'live',
      title: attackStory?.title || 'Live detection',
      status: attackStory?.status || 'live',
      clock: acts[acts.length - 1]?.clock || origin.clock,
      logline: `A behavioral deviation was assessed at ${origin.nodeLabel || path[0]?.label || 'the origin'}.`,
      originLabel: origin.nodeLabel || path[0]?.label,
      severity: chapterOf(attackStory, 'risk')?.impact || 'LOW',
      residualPct,
      trust:
        detect?.trust != null && Number.isFinite(Number(detect.trust))
          ? Math.round(Number(detect.trust))
          : null,
      affectedCount: 1,
      acts,
      path,
      banner: null,
    }
  }

  const path = bindIllustrativePath(nodes)
  const acts = illustrativeActs(path)
  return {
    source: 'illustrative',
    title: 'Municipal digital path',
    status: 'walkthrough',
    clock: '09:41:06',
    logline: 'Rehearsal of origin → residual flag → severity → Commander. Not live telemetry.',
    originLabel: path[0]?.label,
    severity: 'HIGH',
    residualPct: 81,
    trust: 63,
    affectedCount: 1,
    acts,
    path,
    banner: ILLUSTRATIVE_BANNER,
  }
}
