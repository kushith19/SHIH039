import { useEffect, useState } from 'react'

/**
 * Persisted match incident chronology + history campaigns.
 * Used by Monitor Timeline. Does not create incidents.
 */
export default function useIncidentHistory(roomId, { order = 'newest-first', pollMs = 2000 } = {}) {
  const [campaigns, setCampaigns] = useState([])
  const [incidents, setIncidents] = useState([])
  const [resolvedOrder, setResolvedOrder] = useState(order)
  const [status, setStatus] = useState(roomId ? 'loading' : 'idle')

  useEffect(() => {
    if (!roomId) {
      setCampaigns([])
      setIncidents([])
      setStatus('idle')
      return undefined
    }
    let cancelled = false
    const load = async () => {
      try {
        const [campRes, histRes] = await Promise.all([
          fetch(`/rooms/${encodeURIComponent(roomId)}/incidents/campaigns`),
          fetch(
            `/rooms/${encodeURIComponent(roomId)}/incidents/history?order=${encodeURIComponent(order)}`
          ),
        ])
        const campJson = await campRes.json()
        const histJson = await histRes.json()
        if (cancelled) return
        setCampaigns(
          campRes.ok && campJson.ok !== false && Array.isArray(campJson.campaigns)
            ? campJson.campaigns
            : []
        )
        if (histRes.ok && histJson.ok !== false) {
          setIncidents(Array.isArray(histJson.incidents) ? histJson.incidents : [])
          if (histJson.order) setResolvedOrder(histJson.order)
          setStatus('ready')
        } else {
          setIncidents([])
          setStatus('error')
        }
      } catch {
        if (!cancelled) {
          setCampaigns([])
          setIncidents([])
          setStatus('error')
        }
      }
    }
    void load()
    const id = window.setInterval(() => void load(), pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [roomId, order, pollMs])

  return { campaigns, incidents, order: resolvedOrder, status }
}
