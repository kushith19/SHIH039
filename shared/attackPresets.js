/** @typedef {'traffic_flood' | 'data_exfiltration' | 'api_abuse' | 'credential_spray'} AttackPresetId */

export const ATTACK_PRESET_IDS = Object.freeze([
  'traffic_flood',
  'data_exfiltration',
  'api_abuse',
  'credential_spray',
])

export const ATTACK_PRESETS = Object.freeze([
  {
    id: 'traffic_flood',
    title: 'Traffic flood',
    description: 'Spike packet rate and modest HTTP noise',
  },
  {
    id: 'data_exfiltration',
    title: 'Data exfiltration',
    description: 'Bulk file pulls with elevated throughput',
  },
  {
    id: 'api_abuse',
    title: 'API abuse',
    description: 'Hammer HTTP/API request rate',
  },
  {
    id: 'credential_spray',
    title: 'Credential spray',
    description: 'Failed login burst',
  },
])

export function isAttackPresetId(id) {
  return ATTACK_PRESET_IDS.includes(id)
}

export function attackPresetTitle(presetId) {
  return ATTACK_PRESETS.find((p) => p.id === presetId)?.title ?? String(presetId ?? '')
}

/**
 * @param {AttackPresetId} presetId
 * @param {Record<string, number>} baseline
 */
export function computePresetOverrides(presetId, baseline) {
  const pps = baseline?.packetsPerSecond ?? 0
  const http = baseline?.httpRequestsPerMin ?? 0
  const files = baseline?.filesDownloaded ?? 0
  const logins = baseline?.failedLoginsPerMin ?? 0

  switch (presetId) {
    case 'traffic_flood':
      return {
        packetsPerSecond: Math.max(pps * 15, pps + 50_000, 80_000),
        httpRequestsPerMin: Math.max(http * 3, http + 120, 500),
      }
    case 'data_exfiltration':
      return {
        filesDownloaded: Math.max(files + 500, 800),
        packetsPerSecond: Math.max(pps * 4, pps + 8_000, 25_000),
        httpRequestsPerMin: Math.max(http * 2, http + 40, 200),
      }
    case 'api_abuse':
      return {
        httpRequestsPerMin: Math.max(http * 40, http + 2_000, 5_000),
        packetsPerSecond: Math.max(pps * 3, pps + 5_000, 18_000),
      }
    case 'credential_spray':
      return {
        failedLoginsPerMin: Math.max(logins * 50, logins + 200, 350),
        httpRequestsPerMin: Math.max(http * 8, http + 300, 800),
      }
    default:
      return {}
  }
}
