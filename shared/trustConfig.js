/** Single source of truth for TrustNetAI / Smart City trust and detection knobs. */

export const TRUST_CONFIG = Object.freeze({
  eps: 1,

  blend: Object.freeze({
    intrinsic: 0.25,
    peer: 0.3,
    behavioral: 0.25,
    interaction: 0.2,
  }),

  intrinsic: Object.freeze({
    criticalityMix: 0.2,
    fallbackTypeTrust: 50,
    caps: Object.freeze({
      injected: 28,
      quarantined: 15,
    }),
    criticalityBaseline: Object.freeze({
      critical: 92,
      high: 80,
      medium: 62,
      low: 45,
    }),
    fromTrust: Object.freeze([
      Object.freeze({ min: 90, level: 'critical' }),
      Object.freeze({ min: 75, level: 'high' }),
      Object.freeze({ min: 55, level: 'medium' }),
      Object.freeze({ min: 0, level: 'low' }),
    ]),
  }),

  behavioral: Object.freeze({
    fullPenaltyRatio: 0.35,
    activityBands: Object.freeze({
      normalMax: 0.12,
      elevatedMax: 0.35,
    }),
  }),

  peer: Object.freeze({
    aggregate: 'mean',
    isolatedUses: 'local',
  }),

  interaction: Object.freeze({
    upstreamWeight: 0.5,
    downstreamWeight: 0.5,
    contractPenaltyRatio: 0.35,
  }),

  tgnn: Object.freeze({
    anomalyScoreThreshold: 0.58,
    relativeMinScore: 0.5,
    minScoreGap: 0.04,
    minSpread: 0.06,
    minDeviationRatio: 0.1,
    metricSpikeDeviationRatio: 0.5,
    smallGraphMinScore: 0.55,
    minNodesForFullClassify: 3,
    scoreAlpha: 4.5,
    temporalWindow: 3,
    embedDim: 8,
    warmupTicks: 15,
    calibratorMinSigma: 0.05,
    scoreZOffset: 1.25,
  }),

  spread: Object.freeze({
    trustCutoff: 65,
  }),

  incident: Object.freeze({
    severity: Object.freeze({
      criticalMinScore: 0.85,
      highMinScore: 0.7,
      mediumMinScore: 0.55,
    }),
    confidence: Object.freeze({
      temporal: 0.35,
      tgnn: 0.35,
      drift: 0.15,
      extraReason: 0.05,
      extraReasonCap: 0.15,
    }),
    typePriority: Object.freeze([
      'temporal_anomaly',
      'behavioural_anomaly',
      'communication_anomaly',
      'dependency_anomaly',
      'structural_anomaly',
      'graph_propagation',
    ]),
    communicationDeviationRatio: 0.35,
    dependencyTrustBelow: 50,
    tgnnSignalMin: 0.5,
    temporalSignalMin: 0.35,
  }),

  cityContext: Object.freeze({
    ticksPerHour: 8,
    hoursPerDay: 24,
    startHour: 10,
    startDayOfWeek: 4,
    rainEveryDays: 3,
    rainHourStart: 13,
    rainHourEnd: 16,
    eventEveryDays: 5,
    eventHourStart: 18,
    eventHourEnd: 21,
    rushHours: Object.freeze([7, 8, 9, 17, 18, 19]),
    nightHours: Object.freeze([22, 23, 0, 1, 2, 3, 4, 5]),
    fallback: 'normal_day',
    activityBandsByContext: Object.freeze({
      normal_day: Object.freeze({ normalMax: 0.12, elevatedMax: 0.35 }),
      rush_hour: Object.freeze({ normalMax: 0.18, elevatedMax: 0.45 }),
      night: Object.freeze({ normalMax: 0.08, elevatedMax: 0.25 }),
      weekend: Object.freeze({ normalMax: 0.14, elevatedMax: 0.38 }),
      heavy_rain: Object.freeze({ normalMax: 0.16, elevatedMax: 0.42 }),
      major_event: Object.freeze({ normalMax: 0.2, elevatedMax: 0.5 }),
    }),
    multipliers: Object.freeze({
      normal_day: Object.freeze({
        default: Object.freeze({
          packetsPerSecond: 1,
          httpRequestsPerMin: 1,
          filesDownloaded: 1,
          failedLoginsPerMin: 1,
        }),
      }),
      rush_hour: Object.freeze({
        transport: Object.freeze({
          packetsPerSecond: 1.45,
          httpRequestsPerMin: 1.4,
          filesDownloaded: 1.15,
          failedLoginsPerMin: 1.05,
        }),
        lighting: Object.freeze({
          packetsPerSecond: 0.95,
          httpRequestsPerMin: 0.95,
          filesDownloaded: 1,
          failedLoginsPerMin: 1.02,
        }),
        civic: Object.freeze({
          packetsPerSecond: 1.1,
          httpRequestsPerMin: 1.15,
          filesDownloaded: 1.08,
          failedLoginsPerMin: 1.04,
        }),
        healthcare: Object.freeze({
          packetsPerSecond: 1.08,
          httpRequestsPerMin: 1.1,
          filesDownloaded: 1.05,
          failedLoginsPerMin: 1.03,
        }),
        emergency: Object.freeze({
          packetsPerSecond: 1.08,
          httpRequestsPerMin: 1.1,
          filesDownloaded: 1.05,
          failedLoginsPerMin: 1.06,
        }),
        weatherWater: Object.freeze({
          packetsPerSecond: 1.05,
          httpRequestsPerMin: 1.05,
          filesDownloaded: 1,
          failedLoginsPerMin: 1.02,
        }),
        default: Object.freeze({
          packetsPerSecond: 1.12,
          httpRequestsPerMin: 1.1,
          filesDownloaded: 1.05,
          failedLoginsPerMin: 1.02,
        }),
      }),
      night: Object.freeze({
        transport: Object.freeze({
          packetsPerSecond: 0.35,
          httpRequestsPerMin: 0.4,
          filesDownloaded: 0.5,
          failedLoginsPerMin: 0.85,
        }),
        lighting: Object.freeze({
          packetsPerSecond: 1.4,
          httpRequestsPerMin: 1.2,
          filesDownloaded: 1.05,
          failedLoginsPerMin: 0.9,
        }),
        civic: Object.freeze({
          packetsPerSecond: 0.25,
          httpRequestsPerMin: 0.22,
          filesDownloaded: 0.3,
          failedLoginsPerMin: 0.8,
        }),
        healthcare: Object.freeze({
          packetsPerSecond: 0.85,
          httpRequestsPerMin: 0.8,
          filesDownloaded: 0.85,
          failedLoginsPerMin: 0.9,
        }),
        emergency: Object.freeze({
          packetsPerSecond: 1.1,
          httpRequestsPerMin: 1.05,
          filesDownloaded: 1,
          failedLoginsPerMin: 0.95,
        }),
        weatherWater: Object.freeze({
          packetsPerSecond: 0.7,
          httpRequestsPerMin: 0.7,
          filesDownloaded: 0.75,
          failedLoginsPerMin: 0.85,
        }),
        default: Object.freeze({
          packetsPerSecond: 0.55,
          httpRequestsPerMin: 0.5,
          filesDownloaded: 0.55,
          failedLoginsPerMin: 0.85,
        }),
      }),
      weekend: Object.freeze({
        transport: Object.freeze({
          packetsPerSecond: 0.7,
          httpRequestsPerMin: 0.72,
          filesDownloaded: 0.8,
          failedLoginsPerMin: 0.95,
        }),
        lighting: Object.freeze({
          packetsPerSecond: 1,
          httpRequestsPerMin: 1,
          filesDownloaded: 1,
          failedLoginsPerMin: 0.95,
        }),
        civic: Object.freeze({
          packetsPerSecond: 0.3,
          httpRequestsPerMin: 0.28,
          filesDownloaded: 0.4,
          failedLoginsPerMin: 0.9,
        }),
        healthcare: Object.freeze({
          packetsPerSecond: 0.95,
          httpRequestsPerMin: 0.92,
          filesDownloaded: 0.95,
          failedLoginsPerMin: 0.95,
        }),
        emergency: Object.freeze({
          packetsPerSecond: 0.9,
          httpRequestsPerMin: 0.9,
          filesDownloaded: 0.95,
          failedLoginsPerMin: 0.95,
        }),
        weatherWater: Object.freeze({
          packetsPerSecond: 0.9,
          httpRequestsPerMin: 0.9,
          filesDownloaded: 0.95,
          failedLoginsPerMin: 0.95,
        }),
        default: Object.freeze({
          packetsPerSecond: 0.75,
          httpRequestsPerMin: 0.72,
          filesDownloaded: 0.8,
          failedLoginsPerMin: 0.95,
        }),
      }),
      heavy_rain: Object.freeze({
        transport: Object.freeze({
          packetsPerSecond: 0.85,
          httpRequestsPerMin: 0.88,
          filesDownloaded: 0.9,
          failedLoginsPerMin: 1.02,
        }),
        lighting: Object.freeze({
          packetsPerSecond: 1.15,
          httpRequestsPerMin: 1.08,
          filesDownloaded: 1,
          failedLoginsPerMin: 1,
        }),
        civic: Object.freeze({
          packetsPerSecond: 0.8,
          httpRequestsPerMin: 0.78,
          filesDownloaded: 0.85,
          failedLoginsPerMin: 1,
        }),
        healthcare: Object.freeze({
          packetsPerSecond: 1.05,
          httpRequestsPerMin: 1.08,
          filesDownloaded: 1.02,
          failedLoginsPerMin: 1.02,
        }),
        emergency: Object.freeze({
          packetsPerSecond: 1.25,
          httpRequestsPerMin: 1.2,
          filesDownloaded: 1.1,
          failedLoginsPerMin: 1.05,
        }),
        weatherWater: Object.freeze({
          packetsPerSecond: 1.8,
          httpRequestsPerMin: 1.6,
          filesDownloaded: 1.2,
          failedLoginsPerMin: 1.02,
        }),
        default: Object.freeze({
          packetsPerSecond: 0.95,
          httpRequestsPerMin: 0.95,
          filesDownloaded: 0.98,
          failedLoginsPerMin: 1.02,
        }),
      }),
      major_event: Object.freeze({
        transport: Object.freeze({
          packetsPerSecond: 1.6,
          httpRequestsPerMin: 1.5,
          filesDownloaded: 1.25,
          failedLoginsPerMin: 1.1,
        }),
        lighting: Object.freeze({
          packetsPerSecond: 1.2,
          httpRequestsPerMin: 1.1,
          filesDownloaded: 1.05,
          failedLoginsPerMin: 1.05,
        }),
        civic: Object.freeze({
          packetsPerSecond: 1.35,
          httpRequestsPerMin: 1.4,
          filesDownloaded: 1.2,
          failedLoginsPerMin: 1.08,
        }),
        healthcare: Object.freeze({
          packetsPerSecond: 1.2,
          httpRequestsPerMin: 1.15,
          filesDownloaded: 1.1,
          failedLoginsPerMin: 1.05,
        }),
        emergency: Object.freeze({
          packetsPerSecond: 1.5,
          httpRequestsPerMin: 1.45,
          filesDownloaded: 1.2,
          failedLoginsPerMin: 1.12,
        }),
        weatherWater: Object.freeze({
          packetsPerSecond: 1,
          httpRequestsPerMin: 1,
          filesDownloaded: 1,
          failedLoginsPerMin: 1.05,
        }),
        default: Object.freeze({
          packetsPerSecond: 1.25,
          httpRequestsPerMin: 1.2,
          filesDownloaded: 1.1,
          failedLoginsPerMin: 1.08,
        }),
      }),
    }),
  }),
})
