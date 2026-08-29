export interface TelemetryRow {
  time: string;
  endpointId: string;
  simulationTick: number;
  metricName: string;
  value: number;
  unit: string;
}

export interface InfrastructureRow {
  id: string;
  name: string;
  type: string;
  sector?: string;
  criticality?: string;
}
