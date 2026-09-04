/**
 * Session UI latch for Analyze → LLM ResponsePlan.
 * Survives dashboard panel unmount so Response cannot keep showing a stale
 * socket plan while Analyze is in flight (server does not broadcast ANALYZING).
 */

const listeners = new Set()

function emptySnapshot() {
  return {
    generation: 0,
    waiting: false,
    failed: false,
    error: null,
    startedPlanId: null,
    resultOk: null,
    resultPlan: null,
  }
}

let snapshot = emptySnapshot()

export function getResponseAnalyzeUi() {
  return snapshot
}

export function subscribeResponseAnalyzeUi(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function resetResponseAnalyzeUi() {
  snapshot = emptySnapshot()
  emit()
}

export function notifyResponseAnalyzeStarted(previousPlan = null) {
  snapshot = {
    generation: snapshot.generation + 1,
    waiting: true,
    failed: false,
    error: null,
    startedPlanId: previousPlan?.planId ?? null,
    resultOk: null,
    resultPlan: null,
  }
  console.info('[RESPONSE UI] ANALYZE_STARTED')
  emit()
  return snapshot
}

export function notifyResponseAnalyzeFinished({
  ok = false,
  message = null,
  orchestration = null,
} = {}) {
  snapshot = {
    ...snapshot,
    waiting: false,
    failed: ok !== true,
    error: ok === true ? null : String(message || 'Analyze failed'),
    resultOk: ok === true,
    resultPlan: orchestration?.plan ?? null,
  }
  emit()
  return snapshot
}
