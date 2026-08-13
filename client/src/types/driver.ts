export interface DriverManifestEntry {
  reference: string;
  passengerName: string;
  contact: string | null;
  seats: number[];
  status: string;
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
  };
  queue: null | { id: string; position: number; status: string; arrivalTimestamp: string };
  trip: null | {
    id: string;
    departureTime: string;
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
  dispatcher: null | { name: string; contact: string | null };
  queueSummary: { total: number; atTerminal: number; incoming: number; ready: number };
  startEligibility: { allowed: boolean; reason: string };
  notifications: Array<{ id: string; type: string; message: string; isRead: boolean; createdAt: string }>;
}
