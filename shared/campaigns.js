import { catalogTitle, patternMatchCopy } from './campaignCatalog.js'

/** @typedef {'suspected' | 'correlated' | 'escalating' | 'expired'} RecognizedCampaignStatus */

export const CAMPAIGN_STATUSES = Object.freeze([
  'suspected',
  'correlated',
  'escalating',
  'expired',
])

export const LIVE_CAMPAIGN_STATUSES = Object.freeze(['suspected', 'correlated', 'escalating'])

export function isLiveCampaignStatus(status) {
  return LIVE_CAMPAIGN_STATUSES.includes(status)
}

export function campaignTitle(campaign) {
  return campaign?.title || catalogTitle(campaign?.campaignType) || 'Recognized pattern'
}

export function campaignHeadline(campaign) {
  return patternMatchCopy(campaignTitle(campaign))
}

export function activeCampaign(campaigns) {
  return (campaigns ?? []).find((c) => isLiveCampaignStatus(c.status)) ?? null
}

export function emptyCampaign() {
  return {
    id: '',
    roomId: '',
    campaignType: '',
    title: '',
    status: 'suspected',
    originEndpointId: '',
    startedTick: 0,
    lastSeenTick: 0,
    completedTick: null,
    incidentIds: [],
    endpointIds: [],
    fingerprint: '',
  }
}
