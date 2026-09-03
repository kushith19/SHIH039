import AttackStoryExperience from './AttackStoryExperience'

export default function AttackStoryPanel({
  story,
  onSelectEndpoint,
  hideHeader: _hideHeader = false,
  nodes = [],
  edges = [],
  detection = null,
  commanderBriefing = null,
}) {
  return (
    <AttackStoryExperience
      story={story}
      nodes={nodes}
      edges={edges}
      detection={detection}
      commanderBriefing={commanderBriefing}
      onSelectEndpoint={onSelectEndpoint}
    />
  )
}
