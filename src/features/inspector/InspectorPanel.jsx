import { TRUST_CONFIG } from '@shared/trustConfig.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  computeDeviationMetrics,
  hasScenarioDrift,
  isAnomalyDetected,
  isScenarioCritical,
  nodeIsAttackSeed,
} from '../graph/peerTrust'
import { maxMetricDeviation } from '@shared/trustModel.js'
import { runtimeStateOf, telemetryOf } from '../graph/infrastructureNode'
import { inspectorMetricKeys, isGameMetricKey } from '@shared/telemetryKeys.js'
import {
  appendRiskSample,
  momentumFromHistory,
  residualToScore,
} from '@shared/riskMomentum.js'
import { RiskMomentumReadout } from '../dashboard/RiskMomentumCard'

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
      className={compact ? compactInputClass : 'tn-input mt-1 px-3 py-2 text-sm disabled:opacity-60'}
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
  'tn-input mt-0.5 px-2 py-1.5 text-sm disabled:opacity-60'

function useNodeRiskMomentum(nodeId, isolationScore, tick, calibrating) {
  const [samples, setSamples] = useState([])
  const lastTickRef = useRef(null)

  useEffect(() => {
    setSamples([])
    lastTickRef.current = null
  }, [nodeId])

  useEffect(() => {
    if (!nodeId) return
    const t = Number(tick)
    if (!Number.isFinite(t)) return
    if (lastTickRef.current === t) return
    if (lastTickRef.current != null && t < lastTickRef.current) {
      lastTickRef.current = t
      const score = calibrating ? null : residualToScore(isolationScore)
      setSamples([{ tick: t, score, exposedCount: 0 }])
      return
    }
    lastTickRef.current = t
    const score = calibrating ? null : residualToScore(isolationScore)
    setSamples((prev) => appendRiskSample(prev, { tick: t, score, exposedCount: 0 }))
  }, [nodeId, tick, isolationScore, calibrating])

  return useMemo(() => momentumFromHistory(samples), [samples])
}

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
  const calibrating = sim.tgnnCalibrating === true
  const lockAttackTelemetry = isAttackerPlaying && calibrating
  const canEditAttackMetrics = isAttackerPlaying && !readOnly && !lockAttackTelemetry
  const canEditScenarioMetrics =
    Boolean(onUpdateNodeData) &&
    ((gameRole === 'defender' && (gamePhase === 'lobby' || gamePhase === 'playing')) ||
      (hackModeActive && gamePhase === 'playing' && !lockAttackTelemetry))

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
      isolationScore: sim.isolationScoresByNodeId?.[selectedNode.id] ?? 0,
      isAnomaly: flagged,
      trustAnomaly: flagged,
      attackOrigin: nodeIsAttackSeed(selectedNode.id, [selectedNode], sim),
      spreadReached: false,
      atRisk: false,
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
    if (nodeTrust.attackOrigin) return 'Attack seed'
    if (nodeScenarioUi?.anomalyDetected) return 'Flagged'
    if (nodeScenarioUi?.drift && !nodeScenarioUi?.critical) {
      return calibrating ? 'Drift · idle window' : 'Drift'
    }
    return null
  }, [hackModeActive, nodeTrust, nodeScenarioUi, calibrating])

  const tgnnUi = useMemo(() => {
    if (!hackModeActive || !selectedNode?.id) return null
    const id = selectedNode.id
    const isolation = sim.isolationScoresByNodeId?.[id]
    return {
      isolation,
      calibrating: sim.tgnnCalibrating === true,
      collected: sim.tgnnWarmupCollected ?? 0,
      warmupTicks: sim.tgnnWarmupTicks ?? 15,
    }
  }, [
    hackModeActive,
    selectedNode,
    sim.isolationScoresByNodeId,
    sim.tgnnCalibrating,
    sim.tgnnWarmupCollected,
    sim.tgnnWarmupTicks,
  ])
  const nodeRiskMomentum = useNodeRiskMomentum(
    selectedNode?.id,
    tgnnUi?.isolation,
    sim.simulationTick ?? 0,
    tgnnUi?.calibrating === true
  )
  const compactLayout = gameRole === 'attacker' || gameRole === 'defender'
  const isDefender = gameRole === 'defender'

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="tn-label shrink-0">
        {isAttackerPlaying ? 'Target' : isDefender ? 'Node' : 'Inspector'}
      </div>

      {!selectedNode && !selectedEdge ? (
        <div className="tn-surface mt-4 shrink-0 p-4 text-sm leading-relaxed text-[var(--tn-muted)]">
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
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {selectedNode.data?.label ?? 'Node'}
              </div>
              {selectedNode.data?.sector || selectedNode.data?.type || selectedNode.data?.criticality ? (
                <p className="mt-0.5 truncate text-xs text-[var(--tn-muted)]">
                  {[selectedNode.data?.sector, selectedNode.data?.type, selectedNode.data?.criticality]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {(String(selectedNode.data?.sector ?? '').toLowerCase().includes('finance') ||
                String(selectedNode.data?.type ?? '').toLowerCase().includes('bank') ||
                String(selectedNode.data?.type ?? '').toLowerCase().includes('payment')) ? (
                <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
                  Failed logins and HTTP are simulated auth / API-abuse proxies, not live payment YAML metrics.
                </p>
              ) : null}
              {compactLayout ? (
                <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
                  {isAttackerPlaying
                    ? lockAttackTelemetry
                      ? 'Idle window — wait 15/15 or clear attacks to edit telemetry'
                      : 'vs defender baseline · Enter to apply'
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
                <span className="tn-badge">
                  Trust {Math.round(nodeTrust.trustScore)}%
                </span>
                <span
                  className={[
                    'tn-badge',
                    nodeScenarioUi?.anomalyDetected
                      ? 'text-[var(--tn-crit)]'
                      : nodeScenarioUi?.drift
                        ? 'text-[var(--tn-warn)]'
                        : '',
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
              'tn-surface mt-3 space-y-4',
              compactLayout ? 'p-4' : 'p-5',
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
                      <span className="text-xs font-medium text-[var(--tn-muted)]">
                        {compactLayout ? field.attackLabel : field.label}
                      </span>
                      {hackModeActive && baseline !== value ? (
                        <span className="text-xs tabular-nums text-[var(--tn-muted)]">
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
                        disabled={lockAttackTelemetry}
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
                        <span className="text-xs font-medium text-[var(--tn-muted)]">
                          {key.replace(/_/g, ' ')}
                        </span>
                        {hackModeActive && expected != null && value != null && expected !== value ? (
                          <span className="text-xs tabular-nums text-[var(--tn-muted)]">
                            {formatMetric(expected)}
                            {fieldDriftPct != null ? ` +${fieldDriftPct.toFixed(0)}%` : ''}
                          </span>
                        ) : expected != null && value != null ? (
                          <span className="text-xs tabular-nums text-[var(--tn-muted)]">
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
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--tn-muted)]">
                  <span>
                    Expected activity:{' '}
                    <span className="font-medium capitalize">
                      {nodeTrust.expectedActivity ?? 'normal'}
                    </span>
                  </span>
                  <span className="text-[var(--tn-line)]">·</span>
                  <span>
                    Observed:{' '}
                    <span
                      className={[
                        'font-medium capitalize',
                        nodeTrust.observedActivity === 'extreme'
                          ? 'text-[var(--tn-crit)]'
                          : nodeTrust.observedActivity === 'elevated'
                            ? 'text-[var(--tn-warn)]'
                            : '',
                      ].join(' ')}
                    >
                      {nodeTrust.observedActivity ?? 'normal'}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs tabular-nums text-[var(--tn-muted)]">
                  <span>Intrinsic {Math.round(nodeTrust.intrinsicTrust)}%</span>
                  <span>Peer {Math.round(nodeTrust.peerTrust)}%</span>
                  <span>Behavioural {Math.round(nodeTrust.behavioralComponent)}%</span>
                  <span>Interaction {Math.round(nodeTrust.interactionComponent)}%</span>
                </div>
              </div>
            ) : null}

            {tgnnUi ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium">Residual score</span>
                  {tgnnUi.calibrating ? (
                    <span className="text-[var(--tn-muted)]">
                      idle window {tgnnUi.collected}/{tgnnUi.warmupTicks}
                    </span>
                  ) : (
                    <>
                      <span className="tabular-nums">
                        {tgnnUi.isolation == null
                          ? '—'
                          : `${Math.round(tgnnUi.isolation * 100)}%`}
                      </span>
                      <span className="text-[var(--tn-muted)]">
                        vs idle embeddings · {Math.round(TGNN_FLAG_THRESHOLD * 100)}% to flag
                      </span>
                      <span className="tn-meta">
                        Directed GNN residual, not Isolation Forest. Node residual below is not city risk.
                      </span>
                    </>
                  )}
                </div>
                {!tgnnUi.calibrating ? (
                  <RiskMomentumReadout
                    compact
                    riskMomentum={nodeRiskMomentum}
                    scoreCaption="This node's residual × 100, not city mesh risk."
                  />
                ) : null}
              </div>
            ) : null}

            {runtimeStateOf(selectedNode.data).provenance === 'injected' ? (
              <div className="text-xs font-medium text-[var(--tn-crit)]">
                Unknown / injected node
              </div>
            ) : null}

            {onQuarantine &&
            gameRole === 'defender' &&
            gamePhase === 'playing' &&
            !runtimeStateOf(selectedNode.data).quarantined ? (
              <button
                type="button"
                onClick={() => onQuarantine(selectedNode.id, true)}
                className="tn-btn-primary w-full py-2 text-sm"
              >
                Quarantine node
              </button>
            ) : null}
            {onQuarantine &&
            gameRole === 'defender' &&
            gamePhase === 'playing' &&
            runtimeStateOf(selectedNode.data).quarantined ? (
              <button
                type="button"
                onClick={() => onQuarantine(selectedNode.id, false)}
                className="tn-btn w-full py-2 text-sm"
              >
                Unquarantine
              </button>
            ) : null}
            {runtimeStateOf(selectedNode.data).quarantined ? (
              <div className="text-xs font-medium text-[var(--tn-muted)]">
                Segmented from spread (trust cutoff). Not a physical shutdown.
              </div>
            ) : null}
            {onDeleteNodeById ? (
              <button
                type="button"
                onClick={() => onDeleteNodeById(selectedNode.id)}
                className={
                  compactLayout
                    ? isDefender
                    ? 'tn-btn w-full py-2 text-sm'
                      : 'tn-btn w-full py-2 text-sm text-[var(--tn-crit)]'
                    : 'tn-btn w-full py-2 text-sm text-[var(--tn-crit)]'
                }
              >
                Delete node
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedEdge ? (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="truncate text-sm font-medium">
            {selectedEdge.data?.label ?? 'Edge'}
          </div>
          <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
            Link telemetry
          </p>

          <div
            className={[
              'tn-surface mt-3 space-y-3',
              compactLayout ? 'p-4' : 'p-5 space-y-4',
            ].join(' ')}
          >
            <div>
              <span className="text-xs font-medium text-[var(--tn-muted)]">
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
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[var(--tn-muted)]">Role</span>
                <span>Normal</span>
              </div>
            ) : null}

            {onDeleteEdgeById ? (
              <button
                type="button"
                onClick={() => onDeleteEdgeById(selectedEdge.id)}
                className={
                  compactLayout
                    ? 'tn-btn w-full py-1.5 text-xs'
                    : 'tn-btn w-full py-2 text-sm text-[var(--tn-crit)]'
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
