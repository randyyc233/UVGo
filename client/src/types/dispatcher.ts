export interface DispatcherDashboard {
  metrics: {
    vansAtTerminal: number;
    incomingVans: number;
    activeRoutes: number;
    passengersWaiting: number;
    pendingGcash: number;
    tripsDispatchedToday: number;
  };
  alerts: Array<{ id: string; tone: string; title: string; message: string; timestamp: string }>;
  departures: Array<{ id: string; route: string; vanId: string; departureTime: string; occupancy: number; capacity: number; status: string }>;
  activity: Array<{ id: string; type: string; title: string; detail: string; timestamp: string }>;
}

export interface FleetVehicle {
  id: string;
  vanId: string;
  driver: string;
  route: string;
  routeCode: string;
  status: string;
  insideActiveZone: boolean;
  queuePosition: number | null;
  latitude: number;
  longitude: number;
  updatedAt: string;
}

export interface FleetSnapshot {
  terminal: { name: string; address: string; latitude: number; longitude: number; activeZoneRadiusKm: number };
  vehicles: FleetVehicle[];
  events: Array<{ id: string; vanId: string; route: string; eventType: string; timestamp: string; distanceKm: number | null }>;
  updatedAt: string;
}

export interface DispatcherQueueEntry {
  id: string;
  route: string;
  routeCode: string;
  position: number;
  vanId: string;
  driver: string;
  arrivalTimestamp: string;
  occupancy: number;
  capacity: number;
  status: string;
  vehicleStatus: string;
  tripId: string | null;
  departureTime: string | null;
  assignment: null | { id: string; driver: string; status: string; responseDeadline: string };
}

export interface DispatcherPayment {
  id: string;
  method: 'paypal' | 'gcash';
  status: string;
  amount: number;
  paypalOrderId: string | null;
  gcashReference: string | null;
  receiptAvailable: boolean;
  receiptUrl: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  reservation: {
    reference: string;
    passengerName: string;
    contact: string | null;
    route: string;
    departureTime: string;
    seats: number[];
    status: string;
  };
}

export interface DispatchLogEntry {
  id: string;
  action: string;
  actor: string;
  actorRole: string;
  targetId: string;
  reason: string | null;
  metadata: unknown;
  timestamp: string;
}
