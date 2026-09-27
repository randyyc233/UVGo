export interface DriverManifestEntry {
  reference: string;
  passengerName: string;
  contact: string | null;
  seats: number[];
  status: string;
}

export interface DriverScheduleAssignment {
  id: string;
  status: string;
  assignedAt: string;
  responseDeadline: string;
  trip: {
    id: string;
    boardingStartTime: string;
    departureTime: string;
    loadingOpen: boolean;
    status: string;
    occupancy: number;
    reservations: number;
  };
}

export interface DriverNotification {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface DriverOverview {
  driver: { name: string; contact: string | null };
  vehicle: {
    id: string;
    vanId: string;
    plateNo: string;
    route: string;
    routeCode: string;
    protocol: string;
    capacity: number;
    status: string;
    goOnTripEnabled: boolean;
    insideActiveZone: boolean;
    insideTerminalZone: boolean;
    locationTrackingActive: boolean;
  };
  queue: null | { id: string; position: number; status: string; arrivalTimestamp: string };
  trip: null | {
    id: string;
    /** When passenger boarding opens. */
    boardingStartTime: string;
    departureTime: string;
    loadingOpen: boolean;
    status: string;
    estimatedTravelMinutes: number;
    occupancy: number;
    reservations: number;
    manifest: DriverManifestEntry[];
  };
  assignment: null | {
    id: string;
    status: string;
    assignedAt: string;
    responseDeadline: string;
  };
  /** Every active or upcoming schedule assigned to this driver, ordered by departure. */
  assignments: DriverScheduleAssignment[];
  dispatcher: null | { name: string; contact: string | null };
  queueSummary: { total: number; atTerminal: number; incoming: number; ready: number };
  startEligibility: { allowed: boolean; reason: string };
  departureConfirmation: {
    authorized: boolean;
    authorizedAt: string | null;
    reviewRequired: boolean;
    reviewReason: string | null;
    terminalEntrySamples: number;
    terminalExitSamples: number;
    requiredSamples: number;
    latestAccuracyMeters: number | null;
    latestDistanceKm: number | null;
    latestObservedAt: string | null;
  };
  occupancyEligibility: { allowed: boolean; reason: string };
  todayQueueStatus: {
    policy: 'GOSO' | 'TAYA';
    queuePosition: number | null;
    scheduledLoadingTime: string | null;
    scheduledDepartureTime: string | null;
    status: string;
    terminalStatus: 'inside_100m_geofence' | 'outside_100m_geofence';
    passengerCount: number;
    capacity: number;
  };
  notifications: DriverNotification[];
}
