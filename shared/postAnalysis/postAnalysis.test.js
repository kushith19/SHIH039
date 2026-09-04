import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRecommendationFingerprint } from './fingerprint.js'
import { parseAndValidateLlmRecommendations } from './parseLlmRecommendations.js'
import { validateSoftwareOnlyRecommendation } from './validateRecommendation.js'

describe('post-analysis software-only validation', () => {
  it('accepts credential rotation recommendation', () => {
    const result = validateSoftwareOnlyRecommendation({
      title: 'Rotate exposed API credentials',
      problem: 'API abuse',
      recommendation: 'Revoke the affected API key and rotate credentials.',
      reason: 'Repeated abuse',
      priority: 'high',
      category: 'credential_security',
      softwareOnly: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.recommendation.softwareOnly, true)
  })

  it('rejects infrastructure / new hardware recommendations', () => {
    const result = validateSoftwareOnlyRecommendation({
      title: 'Add a new firewall appliance',
      problem: 'Flood',
      recommendation: 'Deploy a new hardware firewall appliance at the edge.',
      reason: 'Need more capacity',
      priority: 'high',
      category: 'network_security',
      softwareOnly: true,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INFRASTRUCTURE_RECOMMENDATION')
  })

  it('rejects softwareOnly=false', () => {
    const result = validateSoftwareOnlyRecommendation({
      title: 'Something',
      recommendation: 'Rotate keys',
      softwareOnly: false,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'SOFTWARE_ONLY_FALSE')
  })
})

describe('parse LLM recommendations', () => {
  it('parses recommendations array and filters invalid', () => {
    const raw = JSON.stringify({
      recommendations: [
        {
          title: 'Rotate API key',
          recommendation: 'Revoke and rotate the API key',
          priority: 'high',
          category: 'api_security',
          softwareOnly: true,
        },
        {
          title: 'Buy servers',
          recommendation: 'Purchase equipment and add another server',
          priority: 'high',
          category: 'other_software',
          softwareOnly: true,
        },
      ],
    })
    const parsed = parseAndValidateLlmRecommendations(raw)
    assert.equal(parsed.validated.length, 1)
    assert.equal(parsed.rejected.length, 1)
    assert.equal(parsed.rejected[0].code, 'INFRASTRUCTURE_RECOMMENDATION')
  })

  it('handles invalid JSON', () => {
    const parsed = parseAndValidateLlmRecommendations('not json at all')
    assert.equal(parsed.ok, false)
    assert.ok(parsed.parseError)
  })
})

describe('recommendation fingerprint', () => {
  it('normalizes equivalent recommendations', () => {
    const a = buildRecommendationFingerprint({
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      recommendation: 'Revoke the affected API key and rotate credentials',
    })
    const b = buildRecommendationFingerprint({
      attackCategory: 'service_api_abuse',
      affectedAssetId: 'api_gateway',
      recommendation: 'Revoke affected API key and rotate all associated credentials',
    })
    assert.equal(a, b)
  })

  it('differs across assets', () => {
    const a = buildRecommendationFingerprint({
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'api_gateway',
      recommendation: 'Rotate API key',
    })
    const b = buildRecommendationFingerprint({
      attackCategory: 'SERVICE_API_ABUSE',
      affectedAssetId: 'other_gw',
      recommendation: 'Rotate API key',
    })
    assert.notEqual(a, b)
  })
})
