import { useCallback, useEffect, useState } from 'react'
import {
  fetchAnalyzeIncident,
  fetchAnalyzeIncidents,
  fetchAnalyzeOverview,
  fetchAnalyzeRecommendations,
  patchAnalyzeRecommendation,
} from './postAnalysisApi.js'

/**
 * Poll durable post-analysis data (survives match wipe / restart).
 */
export default function usePostAnalysis(roomId, { pollMs = 4000 } = {}) {
  const [overview, setOverview] = useState(null)
  const [incidents, setIncidents] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!roomId) return
    try {
      const [ov, inc, rec] = await Promise.all([
        fetchAnalyzeOverview(roomId),
        fetchAnalyzeIncidents(roomId, { order: 'desc', limit: 100 }),
        fetchAnalyzeRecommendations(roomId),
      ])
      if (!ov.ok && !inc.ok && !rec.ok) {
        setError(ov.message || inc.message || rec.message || 'Load failed')
        return
      }
      setError(null)
      if (ov.ok) setOverview(ov.overview)
      if (inc.ok) setIncidents(inc.incidents)
      if (rec.ok) setRecommendations(rec.recommendations)
    } catch (err) {
      setError(err?.message ?? 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) return undefined
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await refresh()
    }
    void tick()
    const id = window.setInterval(() => void tick(), pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [roomId, pollMs, refresh])

  const updateRecommendationStatus = useCallback(
    async (recommendationId, status) => {
      const result = await patchAnalyzeRecommendation(roomId, recommendationId, status)
      if (result.ok) await refresh()
      return result
    },
    [roomId, refresh]
  )

  const loadIncidentDetail = useCallback(
    async (archiveId) => fetchAnalyzeIncident(roomId, archiveId),
    [roomId]
  )

  return {
    overview,
    incidents,
    recommendations,
    error,
    loading,
    refresh,
    updateRecommendationStatus,
    loadIncidentDetail,
  }
}
