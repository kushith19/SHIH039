export default function CommanderHeader({ briefing, posture }) {
  const camp = briefing?.campaignId
  return (
    <div>
      <div className="tn-label">AI Commander</div>
      <p className="tn-meta mt-1">
        {camp ? `History campaign: ${camp}` : 'No history campaign link'}
        {posture?.overallRisk ? ` · city ${posture.overallRisk}` : ''}
      </p>
    </div>
  )
}
