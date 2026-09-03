import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')

test('attacker sidebar has no playbook or campaign selector', () => {
  const src = fs.readFileSync(path.join(root, 'src/features/assets/SidebarAssets.jsx'), 'utf8')
  assert.doesNotMatch(src, /CAMPAIGN_PLAYBOOKS/)
  assert.doesNotMatch(src, /Playbooks/)
  assert.doesNotMatch(src, /onStartCampaign/)
  assert.doesNotMatch(src, /campaign:start/)
  assert.doesNotMatch(src, />Campaigns</)
  const campaigns = fs.readFileSync(path.join(root, 'shared/campaigns.js'), 'utf8')
  assert.doesNotMatch(campaigns, /CAMPAIGN_PLAYBOOKS/)
  assert.doesNotMatch(campaigns, /payments_disruption/)
})
