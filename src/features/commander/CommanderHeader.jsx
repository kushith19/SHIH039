export default function CommanderHeader({ briefing, posture }) {
  const camp = briefing?.campaignId
  return (
    <div>
      <div className="tn-label">AI Commander</div>
      <p className="tn-meta mt-1">
        {camp ? `Active pattern: ${camp}` : 'No correlated pattern yet'}
        {posture?.overallRisk ? ` · city ${posture.overallRisk}` : ''}
      </p>
    </div>
  )
}
