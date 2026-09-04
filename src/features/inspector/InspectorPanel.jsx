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

/** Interactive numeric input — commits on blur / Enter. */
const editableInputClass =
  'tn-input mt-1.5 px-3 text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-55'

/** Observational / locked display — not mutatable. */
const readOnlyInputClass =
  'mt-1.5 h-[var(--tn-control-h)] w-full cursor-not-allowed rounded-[var(--radius-md)] border border-[var(--tn-line)] bg-[color-mix(in_srgb,var(--tn-muted)_12%,var(--tn-surface))] px-3 text-sm tabular-nums text-[var(--tn-text)] opacity-90 outline-none focus:border-[var(--tn-line)] focus:shadow-none'

/** Uncontrolled field — commits on blur so multiplayer sync does not steal focus each keystroke. */
function InspectorNumberField({
  inputKey,
  defaultValue,
  step,
  readOnly,
  disabled,
  onCommit,
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
      className={readOnly ? readOnlyInputClass : editableInputClass}
    />
  )
}

function MetricMetaRow({ expectedLabel, driftPct }) {
  if (expectedLabel == null && driftPct == null) return null
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums text-[var(--tn-muted)]">
      {expectedLabel != null ? <span>{expectedLabel}</span> : null}
      {driftPct != null ? (
        <span className="text-[var(--tn-warn)]">+{driftPct.toFixed(0)}%</span>
      ) : null}
    </div>
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
    const peerExposed =
      sim?.active === true &&
      !flagged &&
      (sim.atRiskNodeIds ?? []).includes(selectedNode.id)
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
      atRisk: peerExposed,
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
    if (nodeTrust.atRisk) return 'Peer exposed'
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
  const gameMetricsLocked = readOnly && !canEditAttackMetrics && !canEditScenarioMetrics

  const cityModelKeys = useMemo(() => {
    if (!selectedNode || !baselineMetrics) return []
    return inspectorMetricKeys(baselineMetrics, telemetryOf(selectedNode.data)).filter(
      (key) => !isGameMetricKey(key)
    )
  }, [selectedNode, baselineMetrics])

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
        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
          <div className="space-y-2">
            <div className="min-w-0">
              <div className="truncate text-base font-medium leading-snug tracking-tight">
                {selectedNode.data?.label ?? 'Node'}
              </div>
              {selectedNode.data?.sector ||
              selectedNode.data?.type ||
              selectedNode.data?.criticality ? (
                <p className="mt-1 break-words text-xs leading-relaxed text-[var(--tn-muted)]">
                  {[selectedNode.data?.sector, selectedNode.data?.type, selectedNode.data?.criticality]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              {(String(selectedNode.data?.sector ?? '').toLowerCase().includes('finance') ||
                String(selectedNode.data?.type ?? '').toLowerCase().includes('bank') ||
                String(selectedNode.data?.type ?? '').toLowerCase().includes('payment')) ? (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--tn-muted)]">
                  Failed logins and HTTP are simulated auth / API-abuse proxies, not live payment YAML
                  metrics.
                </p>
              ) : null}
              {compactLayout ? (
                <p className="mt-1.5 text-xs text-[var(--tn-muted)]">
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
              <div className="flex flex-wrap gap-1.5">
                <span className="tn-badge">Trust {Math.round(nodeTrust.trustScore)}%</span>
                <span className="tn-badge">Peer {Math.round(nodeTrust.peerTrust)}%</span>
                {hackModeActive && !calibrating ? (
                  <span className="tn-badge">
                    Residual{' '}
                    {tgnnUi?.isolation == null
                      ? '—'
                      : `${Math.round(tgnnUi.isolation * 100)}%`}
                  </span>
                ) : null}
                <span
                  className={[
                    'tn-badge',
                    nodeScenarioUi?.anomalyDetected
                      ? 'text-[var(--tn-crit)]'
                      : nodeTrust.atRisk || nodeScenarioUi?.drift
                        ? 'text-[var(--tn-warn)]'
                        : '',
                  ].join(' ')}
                >
                  {threatLabel ??
                    (nodeScenarioUi?.anomalyDetected
                      ? 'Anomaly'
                      : nodeTrust.atRisk
                        ? 'Peer exposed'
                        : nodeScenarioUi?.drift
                          ? `Drift ${nodeTrust.deviationPercent.toFixed(0)}%`
                          : 'Stable')}
                </span>
              </div>
            ) : null}
          </div>

          <div className="tn-surface space-y-5 p-4">
            <section className="space-y-3">
              <div className="space-y-0.5">
                <div className="tn-label">Controllable telemetry</div>
                <p className="text-xs text-[var(--tn-muted)]">
                  {isAttackerPlaying
                    ? 'Attack overrides for this node'
                    : isDefender
                      ? 'Scenario baseline for this node'
                      : 'Editable game metrics'}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  const showExpected = hackModeActive && baseline !== value
                  const showAttackerDrift =
                    hackModeActive && !isDefender && fieldDriftPct != null
                  return (
                    <div key={field.key} className="min-w-0">
                      <div className="text-xs font-medium text-[var(--tn-text)]">
                        {compactLayout ? field.attackLabel : field.label}
                      </div>
                      <MetricMetaRow
                        expectedLabel={showExpected ? formatMetric(baseline) : null}
                        driftPct={showAttackerDrift ? fieldDriftPct : null}
                      />
                      {gameMetricsLocked ? (
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={formatMetric(value) || '0.00'}
                          className={readOnlyInputClass}
                        />
                      ) : (
                        <InspectorNumberField
                          inputKey={`node-metric:${selectedNode.id}:${field.key}`}
                          defaultValue={value}
                          step={field.step}
                          readOnly={false}
                          disabled={lockAttackTelemetry}
                          onCommit={(n) =>
                            onUpdateNodeData?.(selectedNode.id, { [field.key]: n })
                          }
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {cityModelKeys.length > 0 ? (
              <section className="space-y-3 border-t border-[var(--tn-line)] pt-4">
                <div className="space-y-0.5">
                  <div className="tn-label">City-model telemetry</div>
                  <p className="text-xs text-[var(--tn-muted)]">Observational · read-only</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {cityModelKeys.map((key) => {
                    const baseline = baselineMetrics?.[key]
                    const live = telemetryOf(selectedNode.data)[key]
                    const value = Number.isFinite(Number(live)) ? Number(live) : null
                    const expected = Number.isFinite(Number(baseline)) ? Number(baseline) : null
                    const display = value ?? expected
                    const fieldDriftPct =
                      hackModeActive &&
                      expected != null &&
                      value != null &&
                      expected !== value
                        ? computeDeviationMetrics({
                            baselinePps: expected,
                            effectivePps: value,
                          }).deviationPercent
                        : null
                    const showDrift =
                      hackModeActive &&
                      expected != null &&
                      value != null &&
                      expected !== value
                    const showExpEqual =
                      !showDrift && expected != null && value != null
                    return (
                      <div key={key} className="min-w-0">
                        <div className="break-words text-xs font-medium capitalize text-[var(--tn-muted)]">
                          {key.replace(/_/g, ' ')}
                        </div>
                        <MetricMetaRow
                          expectedLabel={
                            showDrift
                              ? formatMetric(expected)
                              : showExpEqual
                                ? `exp ${formatMetric(expected)}`
                                : null
                          }
                          driftPct={showDrift ? fieldDriftPct : null}
                        />
                        <input
                          type="number"
                          readOnly
                          tabIndex={-1}
                          value={display != null ? formatMetric(display) : ''}
                          className={readOnlyInputClass}
                        />
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {nodeTrust ? (
              <section className="space-y-2 border-t border-[var(--tn-line)] pt-4">
                <div className="tn-label">Trust breakdown</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--tn-muted)]">
                  <span>
                    Expected activity:{' '}
                    <span className="font-medium capitalize text-[var(--tn-text)]">
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
                            : 'text-[var(--tn-text)]',
                      ].join(' ')}
                    >
                      {nodeTrust.observedActivity ?? 'normal'}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums text-[var(--tn-muted)]">
                  <span>Intrinsic {Math.round(nodeTrust.intrinsicTrust)}%</span>
                  <span>Peer {Math.round(nodeTrust.peerTrust)}%</span>
                  <span>Behavioural {Math.round(nodeTrust.behavioralComponent)}%</span>
                  <span>Interaction {Math.round(nodeTrust.interactionComponent)}%</span>
                </div>
                {nodeTrust.atRisk ? (
                  <p className="text-xs leading-relaxed text-[var(--tn-muted)]">
                    Peer dropped because a graph neighbor is flagged. Assessment, not a confirmed
                    kill-chain.
                  </p>
                ) : null}
              </section>
            ) : null}

            {tgnnUi ? (
              <section className="space-y-3 border-t border-[var(--tn-line)] pt-4">
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
                        Directed GNN residual, not Isolation Forest. Node residual below is not city
                        risk.
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
              </section>
            ) : null}

            {runtimeStateOf(selectedNode.data).provenance === 'injected' ? (
              <div className="text-xs font-medium text-[var(--tn-crit)]">
                Unknown / injected node
              </div>
            ) : null}

            <div className="space-y-2 border-t border-[var(--tn-line)] pt-4">
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
                <div className="space-y-1 text-xs font-medium text-[var(--tn-muted)]">
                  <div>Segmented from spread (trust cutoff). Not a physical shutdown.</div>
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
        </div>
      ) : null}

      {selectedEdge ? (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="truncate text-base font-medium tracking-tight">
            {selectedEdge.data?.label ?? 'Edge'}
          </div>
          <p className="mt-1 text-xs text-[var(--tn-muted)]">Link telemetry</p>

          <div className="tn-surface mt-3 space-y-3 p-4">
            <div className="min-w-0">
              <span className="text-xs font-medium text-[var(--tn-text)]">PPS</span>
              {readOnly && !canEditScenarioMetrics ? (
                <input
                  type="number"
                  readOnly
                  tabIndex={-1}
                  value={
                    Number.isFinite(Number(selectedEdge.data?.packetsPerSecond))
                      ? Number(selectedEdge.data.packetsPerSecond)
                      : 0
                  }
                  className={readOnlyInputClass}
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
