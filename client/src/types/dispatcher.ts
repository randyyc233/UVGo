export interface DispatcherDashboard {
  route: string;
  routeCode: 'goa' | 'legazpi';
  metrics: {
    vansAtTerminal: number;
    incomingVans: number;
    activeRoutes: number;
    passengersWaiting: number;
    pendingPayments: number;
    tripsDispatchedToday: number;
  };
  alerts: Array<{ id: string; tone: string; title: string; message: string; timestamp: string; isRead: boolean }>;
  departureReviews: Array<{
    id: string;
    vehicleId: string;
    tripId: string | null;
    vanId: string;
    driver: string;
    kind: 'pending' | 'review';
    reason: string;
    canConfirm: boolean;
    authorizedAt: string | null;
    updatedAt: string;
    latestAccuracyMeters: number | null;
    latestDistanceKm: number | null;
    exitSamples: number;
  }>;
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
  insideTerminalZone: boolean;
  departureReviewRequired: boolean;
  queuePosition: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  updatedAt: string;
}

export interface FleetSnapshot {
  route: string;
  routeCode: 'goa' | 'legazpi';
  terminal: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    activeZoneRadiusKm: number;
    terminalArrivalRadiusKm: number;
  };
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
  scheduledLoadingTime: string | null;
  lateAt: string | null;
  isLate: boolean;
  occupancy: number;
  capacity: number;
  status: string;
  vehicleStatus: string;
  tripId: string | null;
  departureTime: string | null;
  assignment: null | { id: string; driver: string; status: string; responseDeadline: string };
}

export interface DispatcherPendingArrival {
  vanId: string;
  driver: string;
  message: string;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  terminalEntrySamples: number;
  requiredSamples: number;
  observedAt: string | null;
}

export interface DepartureHistoryEntry {
  id: string;
  routeCode: string;
  vanId: string;
  driver: string;
  departedAt: string;
  scheduledDepartureTime: string | null;
  passengerCount: number | null;
}

export interface DispatcherPayment {
  id: string;
  method: 'paypal' | 'gcash';
  status: string;
  amount: number;
  paypalOrderId: string | null;
  gcashReference: string | null;
  /** PayPal transaction/order ID or the GCash receipt reference. */
  transactionReference: string | null;
  receiptAvailable: boolean;
  receiptUrl: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  reservation: {
    reference: string;
    passengerName: string;
    studentPassengers?: number;
    seniorPassengers?: number;
    discountAmount?: number;
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

export interface ManagedDriver {
  id: string;
  name: string;
  contact: string | null;
  email: string;
  isActive: boolean;
  createdAt: string;
  vehicle: null | {
    id: string;
    vanId: string;
    plateNo: string;
    capacity: number;
    status: string;
    route: string;
    routeCode: string;
    protocol: string;
  };
}

export interface DriverManagement {
  route: string;
  routeCode: 'goa' | 'legazpi';
  drivers: ManagedDriver[];
}

export interface ManagedDispatcher {
  id: string;
  name: string;
  contact: string | null;
  email: string;
  isActive: boolean;
  isCurrentAccount: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface DispatcherAccountManagement {
  route: string;
  routeCode: 'goa' | 'legazpi';
  dispatchers: ManagedDispatcher[];
}

export interface DriverAnnouncementResult {
  recipientCount: number;
  recipients: Array<{ id: string; name: string }>;
  message: string;
  sentAt: string;
}

export interface ManagedSchedule {
  id: string;
  weeklyScheduleId: string | null;
  /** When passengers may begin boarding. */
  boardingStartTime: string;
  departureTime: string;
  fareAmount: number;
  status: string;
  reservationCount: number;
  assignmentCount: number;
  assignment: null | { id: string; driver: string; status: string };
  vehicle: { id: string; vanId: string; capacity: number; driverId: string | null; driver: string };
}

export interface WeeklyScheduleTemplate {
  id: string;
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: number;
  weekdayLabel: string;
  boardingTime: string;
  departureTime: string;
  fareAmount: number;
  isActive: boolean;
  generatedCount: number;
  nextDeparture: string | null;
  vehicle: { id: string; vanId: string; capacity: number; driverId: string | null; driver: string };
}

export interface ScheduleManagement {
  route: 'Goa';
  routeCode: 'goa';
  /** Server-side default fare, so the create form cannot prefill a stale price. */
  defaultFare: number;
  assignmentResponseWeek: { start: string; endExclusive: string; startDate: string; endDate: string };
  weeklySchedules: WeeklyScheduleTemplate[];
  schedules: ManagedSchedule[];
  vehicles: Array<{ id: string; vanId: string; capacity: number; driverId: string | null; driver: string }>;
}

export interface TayaWeeklyScheduleEntry {
  id: string;
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: number;
  weekdayLabel: string;
  position: number;
  vehicle: { id: string; vanId: string; capacity: number; driverId: string | null; driver: string };
}

export interface TayaWeeklyScheduleManagement {
  route: 'Legazpi';
  routeCode: 'legazpi';
  currentWeekday: number;
  entries: TayaWeeklyScheduleEntry[];
  vehicles: Array<{ id: string; vanId: string; capacity: number; driverId: string | null; driver: string }>;
}
