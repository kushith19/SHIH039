/** Display filter only. Correlation is computed on the server. */
export function visibleHistoryCampaigns(campaigns) {
  return (campaigns ?? []).filter((c) => (c.sequence?.length ?? c.incidentCount ?? 0) >= 2)
}
