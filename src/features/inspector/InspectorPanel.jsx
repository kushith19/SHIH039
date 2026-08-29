import { TRUST_CONFIG } from '@shared/trustConfig.js'
import { useEffect, useMemo, useRef } from 'react'
import {
  computeDeviationMetrics,
  hasScenarioDrift,
  isAnomalyDetected,
  isScenarioCritical,
} from '../graph/peerTrust'
import { maxMetricDeviation } from '@shared/trustModel.js'
import { runtimeStateOf, telemetryOf } from '../graph/infrastructureNode'
import { inspectorMetricKeys, isGameMetricKey } from '@shared/telemetryKeys.js'

const FUSED_THRESHOLD = TRUST_CONFIG.fusion.threshold
const TGNN_FLAG_THRESHOLD = TRUST_CONFIG.tgnn.anomalyScoreThreshold

function formatMetric(n) {
  if (n == null || !Number.isFinite(Number(n))) return ''
  return Number(n).toFixed(2)
}

function commitNumberInput(e, fallback, onCommit) {
  const raw = e.target.value.trim()
  const next = raw === '' ? fallback : Math.max(0, Number(raw) || 0)
  if (next !== fallback) onCommit(next)
}

/** Uncontrolled field — commits on blur so multiplayer sync does not steal focus each keystroke. */
function InspectorNumberField({
  inputKey,
  defaultValue,
  step,
  readOnly,
  disabled,
  onCommit,
  compact = false,
}) {
  const inputRef = useRef(null)

  const display = formatMetric(defaultValue) || '0.00'

  useEffect(() => {
    const el = inputRef.current
    if (!el || document.activeElement === el) return
    el.value = display
  }, [inputKey, display])

  return (
    <input
      ref={inputRef}
      key={inputKey}
      type="number"
      min={0}
      step={step}
      readOnly={readOnly}
      disabled={disabled}
      defaultValue={display}
      onBlur={(e) => {
        if (readOnly || disabled) return
        commitNumberInput(e, defaultValue, onCommit)
      }}
      onKeyDown={(e) => {
        if (readOnly || disabled) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={compact ? compactInputClass : 'mt-1 w-full rounded-lg border border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-slate-950/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60'}
    />
  )
}

const METRIC_FIELDS = [
  {
    key: 'packetsPerSecond',
    label: 'Packets per second',
    step: 100,
    attackLabel: 'PPS',
  },
  {
    key: 'httpRequestsPerMin',
    label: 'HTTP requests / min',
    step: 10,
    attackLabel: 'HTTP/min',
  },
  {
    key: 'filesDownloaded',
    label: 'Files downloaded',
    step: 1,
    attackLabel: 'Files',
  },
  {
    key: 'failedLoginsPerMin',
    label: 'Failed logins / min',
    step: 5,
    attackLabel: 'Failed/min',
  },
]

const compactInputClass =
  'mt-0.5 w-full rounded-md border border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-slate-950/40 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60'

export default function InspectorPanel({
  hackModeActive = false,
  hackSimulator = null,
  selectedNode,
  selectedEdge,
  onUpdateNodeData,
  onUpdateEdgeData,
  onDeleteNodeById,
  onDeleteEdgeById,
  readOnly = false,
  gameRole = null,
  gamePhase = null,
  onQuarantine,
}) {
  const sim = hackSimulator ?? { active: false }
  const isAttackerPlaying = gameRole === 'attacker' && gamePhase === 'playing'
  const canEditAttackMetrics = isAttackerPlaying && !readOnly
  const canEditScenarioMetrics =
    Boolean(onUpdateNodeData) &&
    ((gameRole === 'defender' && (gamePhase === 'lobby' || gamePhase === 'playing')) ||
      (hackModeActive && gamePhase === 'playing'))

  const baselineMetrics = useMemo(() => {
    if (!selectedNode) return null
    return (
      selectedNode.inspectorExpectedMetrics ??
      selectedNode.inspectorBaselineMetrics ??
      telemetryOf(selectedNode.data)
    )
  }, [selectedNode])

  const nodeTrust = useMemo(() => {
    if (!selectedNode?.id || !baselineMetrics) return null
    const effective = telemetryOf(selectedNode.data)
    const row = sim.trustByNodeId?.[selectedNode.id]
    if (!row) return null
    const maxDeviation = maxMetricDeviation(baselineMetrics, effective)
    const flagged =
      sim?.active === true && (sim.anomalyNodeIds ?? []).includes(selectedNode.id)
    return {
      ...row,
      peerTrust: row.peerTrust ?? row.peerTrustStructural,
      deviationRatio: maxDeviation,
      deviationPercent: maxDeviation * 100,
      isolationScore: sim.isolationScoresByNodeId?.[selectedNode.id] ?? 0.5,
      isAnomaly: flagged,
      trustAnomaly: flagged,
      attackOrigin: flagged,
      spreadReached: sim.primarySpreadNodeId === selectedNode.id,
      atRisk:
        (sim.atRiskNodeIds ?? []).includes(selectedNode.id) &&
        !flagged &&
        sim.primarySpreadNodeId !== selectedNode.id,
    }
  }, [selectedNode, sim, baselineMetrics])

  const nodeScenarioUi = useMemo(() => {
    if (!nodeTrust || !selectedNode || !baselineMetrics) return null
    const effective = telemetryOf(selectedNode.data)
    const drift = hasScenarioDrift({ baselineMetrics, effectiveMetrics: effective })
    const anomalyFromScan =
      hackModeActive && (sim.anomalyNodeIds ?? []).includes(selectedNode.id)
    const anomalyDetected = anomalyFromScan || isAnomalyDetected(nodeTrust)
    const critical = isScenarioCritical({
      isAnomaly: anomalyDetected,
      trustAnomaly: anomalyDetected,
    })
    return { drift, critical, anomalyDetected }
  }, [nodeTrust, selectedNode, hackModeActive, sim.anomalyNodeIds, baselineMetrics])

  const threatLabel = useMemo(() => {
    if (!hackModeActive || !nodeTrust) return null
    if (nodeTrust.attackOrigin) return 'Attack origin'
    if (nodeTrust.spreadReached) return 'Spread target'
    if (nodeTrust.atRisk) return 'At risk'
    if (nodeScenarioUi?.anomalyDetected) return 'Anomaly'
    if (nodeScenarioUi?.drift && !nodeScenarioUi?.critical) return 'Drift'
    return null
  }, [hackModeActive, nodeTrust, nodeScenarioUi])

  const fusionUi = useMemo(() => {
    if (!hackModeActive || !selectedNode?.id) return null
    const id = selectedNode.id
    const mode = sim.detectionMode === 'tgnn' ? 'tgnn' : 'fusion'
    const fused = sim.fusedScoresByNodeId?.[id]
    const isolation = sim.isolationScoresByNodeId?.[id]
    const reasons = sim.reasonsByNodeId?.[id] ?? []
    return { mode, fused, isolation, reasons }
  }, [
    hackModeActive,
    selectedNode,
    sim.detectionMode,
    sim.fusedScoresByNodeId,
    sim.isolationScoresByNodeId,
    sim.reasonsByNodeId,
  ])
  const compactLayout = gameRole === 'attacker' || gameRole === 'defender'
  const isDefender = gameRole === 'defender'

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide shrink-0">
        {isAttackerPlaying ? 'Target' : isDefender ? 'Node' : 'Inspector'}
      </div>

      {!selectedNode && !selectedEdge ? (
        <div className="mt-3 rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/20 p-3 text-[11px] leading-snug text-slate-600 dark:text-slate-300 shrink-0">
          {isAttackerPlaying
            ? 'Select a node to edit attack telemetry. Use the left panel for rogue devices and presets.'
            : isDefender && gamePhase === 'lobby'
              ? 'Select a node to set baseline telemetry before the match.'
              : isDefender
                ? 'Select a node to inspect trust and quarantine, or an edge to view link traffic.'
                : 'Select a node or an edge on the map.'}
        </div>
      ) : null}

      {selectedNode ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                {selectedNode.data?.label ?? 'Node'}
              </div>
              {selectedNode.data?.sector || selectedNode.data?.type || selectedNode.data?.criticality ? (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {[selectedNode.data?.sector, selectedNode.data?.type, selectedNode.data?.criticality]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {compactLayout ? (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAttackerPlaying
                    ? 'vs defender baseline · Enter to apply'
                    : gamePhase === 'lobby'
                      ? 'Lobby baseline · Enter to save'
                      : readOnly
                        ? 'Live monitoring'
                        : 'Telemetry · Enter to save'}
                </p>
              ) : null}
            </div>
            {compactLayout && nodeTrust && (hackModeActive || gamePhase === 'lobby') ? (
              <div className="flex flex-wrap justify-end gap-1 shrink-0 max-w-[55%]">
                <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums font-medium text-slate-700 dark:text-slate-200">
                  Trust {Math.round(nodeTrust.trustScore)}%
                </span>
                <span
                  className={[
                    'rounded-md px-1.5 py-0.5 text-[10px] tabular-nums font-medium',
                    nodeScenarioUi?.anomalyDetected
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
                      : nodeScenarioUi?.drift
                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  ].join(' ')}
                >
                  {threatLabel ??
                    (nodeScenarioUi?.anomalyDetected
                      ? 'Anomaly'
                      : nodeScenarioUi?.drift
                        ? `Drift ${nodeTrust.deviationPercent.toFixed(0)}%`
                        : 'Stable')}
                </span>
              </div>
            ) : null}
          </div>

          <div
            className={[
              'mt-2 rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/20 space-y-3',
              compactLayout ? 'p-3' : 'p-4',
            ].join(' ')}
          >
            <div className={compactLayout ? 'space-y-2' : 'space-y-3'}>
              <div
                className={
                  compactLayout ? 'grid grid-cols-2 gap-x-2 gap-y-2' : 'space-y-3'
                }
              >
              {METRIC_FIELDS.map((field) => {
                const baseline = baselineMetrics?.[field.key] ?? 0
                const value = Number.isFinite(Number(telemetryOf(selectedNode.data)[field.key]))
                  ? Number(telemetryOf(selectedNode.data)[field.key])
                  : 0
                const fieldDriftPct =
                  hackModeActive && baseline !== value
                    ? computeDeviationMetrics({
                        baselinePps: baseline,
                        effectivePps: value,
                      }).deviationPercent
                    : null
                return (
                  <div key={field.key}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                        {compactLayout ? field.attackLabel : field.label}
                      </span>
                      {hackModeActive && baseline !== value ? (
                        <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                          {formatMetric(baseline)}
                          {hackModeActive &&
                          !isDefender &&
                          fieldDriftPct != null
                            ? ` +${fieldDriftPct.toFixed(0)}%`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                    {readOnly && !canEditAttackMetrics && !canEditScenarioMetrics ? (
                      <input
                        type="number"
                        readOnly
                        value={formatMetric(value) || '0.00'}
                        className={compactInputClass}
                      />
                    ) : (
                      <InspectorNumberField
                        inputKey={`node-metric:${selectedNode.id}:${field.key}`}
                        defaultValue={value}
                        step={field.step}
                        readOnly={false}
                        disabled={false}
                        compact={compactLayout}
                        onCommit={(n) =>
                          onUpdateNodeData?.(selectedNode.id, { [field.key]: n })
                        }
                      />
                    )}
                  </div>
                )
              })}
              {inspectorMetricKeys(baselineMetrics, telemetryOf(selectedNode.data))
                .filter((key) => !isGameMetricKey(key))
                .map((key) => {
                  const baseline = baselineMetrics?.[key]
                  const live = telemetryOf(selectedNode.data)[key]
                  const value = Number.isFinite(Number(live)) ? Number(live) : null
                  const expected = Number.isFinite(Number(baseline)) ? Number(baseline) : null
                  const display = value ?? expected
                  const fieldDriftPct =
                    hackModeActive && expected != null && value != null && expected !== value
                      ? computeDeviationMetrics({
                          baselinePps: expected,
                          effectivePps: value,
                        }).deviationPercent
                      : null
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                          {key.replace(/_/g, ' ')}
                        </span>
                        {hackModeActive && expected != null && value != null && expected !== value ? (
                          <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                            {formatMetric(expected)}
                            {fieldDriftPct != null ? ` +${fieldDriftPct.toFixed(0)}%` : ''}
                          </span>
                        ) : expected != null && value != null ? (
                          <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">
                            exp {formatMetric(expected)}
                          </span>
                        ) : null}
                      </div>
                      <input
                        type="number"
                        readOnly
                        value={display != null ? formatMetric(display) : ''}
                        className={compactInputClass}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {nodeTrust ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300">
                  <span>
                    Expected activity:{' '}
                    <span className="font-medium capitalize">
                      {nodeTrust.expectedActivity ?? 'normal'}
                    </span>
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>
                    Observed:{' '}
                    <span
                      className={[
                        'font-medium capitalize',
                        nodeTrust.observedActivity === 'extreme'
                          ? 'text-rose-700 dark:text-rose-300'
                          : nodeTrust.observedActivity === 'elevated'
                            ? 'text-amber-800 dark:text-amber-200'
                            : '',
                      ].join(' ')}
                    >
                      {nodeTrust.observedActivity ?? 'normal'}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] tabular-nums text-slate-600 dark:text-slate-300">
                  <span>Intrinsic {Math.round(nodeTrust.intrinsicTrust)}%</span>
                  <span>Peer {Math.round(nodeTrust.peerTrust)}%</span>
                  <span>Behavioural {Math.round(nodeTrust.behavioralComponent)}%</span>
                  <span>Interaction {Math.round(nodeTrust.interactionComponent)}%</span>
                </div>
              </div>
            ) : null}

            {fusionUi ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/25 px-2 py-1.5 text-[10px] text-indigo-950 dark:text-indigo-100/90">
                  <span className="font-medium">
                    {fusionUi.mode === 'tgnn' ? 'TGNN' : 'Fused'}
                  </span>
                  <span className="tabular-nums">
                    {fusionUi.mode === 'tgnn'
                      ? fusionUi.isolation == null
                        ? '—'
                        : `${Math.round(fusionUi.isolation * 100)}%`
                      : fusionUi.fused == null
                        ? '—'
                        : `${Math.round(fusionUi.fused * 100)}%`}
                  </span>
                  <span className="text-indigo-700/70 dark:text-indigo-300/70">
                    {fusionUi.mode === 'tgnn'
                      ? `/ ${Math.round(TGNN_FLAG_THRESHOLD * 100)}% to flag`
                      : `/ ${(FUSED_THRESHOLD * 100).toFixed(0)}% to flag`}
                  </span>
                  {fusionUi.mode === 'fusion' && fusionUi.isolation != null ? (
                    <span className="text-indigo-700/70 dark:text-indigo-300/70 tabular-nums">
                      TGNN {Math.round(fusionUi.isolation * 100)}%
                    </span>
                  ) : null}
                </div>
                {fusionUi.mode === 'fusion' && fusionUi.reasons.length ? (
                  <div className="flex flex-wrap gap-1">
                    {fusionUi.reasons.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-slate-100 px-1 py-px text-[9px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {tag.replace('telemetry_', '').replace(':', ' ')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {runtimeStateOf(selectedNode.data).provenance === 'injected' ? (
              <div className="text-xs text-rose-700 dark:text-rose-400 font-medium">
                Unknown / injected node
              </div>
            ) : null}

            {onQuarantine &&
            gameRole === 'defender' &&
            gamePhase === 'playing' &&
            !runtimeStateOf(selectedNode.data).quarantined ? (
              <button
                type="button"
                onClick={() => onQuarantine(selectedNode.id)}
                className="w-full rounded-md bg-indigo-600 text-white text-xs font-semibold py-2 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              >
                Quarantine node
              </button>
            ) : null}
            {runtimeStateOf(selectedNode.data).quarantined ? (
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                This node is quarantined.
              </div>
            ) : null}
            {onDeleteNodeById ? (
              <button
                type="button"
                onClick={() => onDeleteNodeById(selectedNode.id)}
                className={
                  compactLayout
                    ? isDefender
                      ? 'w-full rounded-md border border-slate-300/80 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900/40'
                      : 'w-full rounded-md border border-rose-200/80 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                    : 'w-full rounded-lg bg-rose-600 text-white text-sm py-2 hover:bg-rose-700'
                }
              >
                Delete node
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedEdge ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
            {selectedEdge.data?.label ?? 'Edge'}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Link telemetry
          </p>

          <div
            className={[
              'mt-2 rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/20 space-y-2',
              compactLayout ? 'p-3' : 'p-4 space-y-3',
            ].join(' ')}
          >
            <div>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                PPS
              </span>
              {readOnly && !canEditScenarioMetrics ? (
                <input
                  type="number"
                  readOnly
                  value={
                    Number.isFinite(Number(selectedEdge.data?.packetsPerSecond))
                      ? Number(selectedEdge.data.packetsPerSecond)
                      : 0
                  }
                  className={compactInputClass}
                />
              ) : (
                <InspectorNumberField
                  inputKey={`edge-pps:${selectedEdge.id}`}
                  defaultValue={
                    Number.isFinite(Number(selectedEdge.data?.packetsPerSecond))
                      ? Number(selectedEdge.data.packetsPerSecond)
                      : 0
                  }
                  step={100}
                  readOnly={false}
                  disabled={false}
                  compact={compactLayout}
                  onCommit={(n) =>
                    onUpdateEdgeData?.(selectedEdge.id, { packetsPerSecond: n })
                  }
                />
              )}
            </div>

            {hackModeActive ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-slate-500 dark:text-slate-400">Role</span>
                <span
                  className={
                    hackSimulator?.primarySpreadEdgeId === selectedEdge.id
                      ? 'font-semibold text-rose-700 dark:text-rose-400'
                      : (hackSimulator?.atRiskEdgeIds ?? []).includes(selectedEdge.id)
                        ? 'font-semibold text-violet-700 dark:text-violet-400'
                        : 'text-slate-800 dark:text-slate-200'
                  }
                >
                  {hackSimulator?.primarySpreadEdgeId === selectedEdge.id
                    ? 'Propagation'
                    : (hackSimulator?.atRiskEdgeIds ?? []).includes(selectedEdge.id)
                      ? 'Spread path'
                      : 'Normal'}
                </span>
              </div>
            ) : null}

            {onDeleteEdgeById ? (
              <button
                type="button"
                onClick={() => onDeleteEdgeById(selectedEdge.id)}
                className={
                  compactLayout
                    ? 'w-full rounded-md border border-slate-300/80 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900/40'
                    : 'w-full rounded-lg bg-rose-600 text-white text-sm py-2 hover:bg-rose-700'
                }
              >
                Delete edge
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
