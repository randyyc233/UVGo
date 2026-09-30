export interface GcashRecipient {
  dispatcherName: string;
  mobileNumber: string;
}

export interface GoaTrip {
  id: string;
  route: 'Goa';
  origin: string;
  destination: string;
  /** When passengers may begin loading into the van. */
  boardingStartTime: string;
  departureTime: string;
  fare: number;
  vanId: string;
  capacity: number;
  availableSeats: number;
  canFitParty: boolean;
  /** Route dispatcher's GCash account for this reservation. */
  gcashRecipient: GcashRecipient | null;
}

export interface TripSeat {
  number: number;
  available: boolean;
}

export interface PassengerBooking {
  id: string;
  tripId: string;
  reference: string;
  route: 'Goa';
  origin: string;
  destination: string;
  /** When passengers may begin loading into the van. */
  boardingStartTime: string;
  departureTime: string;
  vanId: string;
  seats: number[];
  seatCount: number;
  fareAmount: number;
  totalAmount: number;
  status: string;
  payment: null | {
    method: 'paypal' | 'gcash' | 'legacy';
    status: string;
    /** PayPal transaction/order ID or the GCash receipt reference. */
    transactionReference: string | null;
    gcashReference: string | null;
    rejectionReason: string | null;
  };
  /** Route dispatcher's GCash account used for this reservation. */
  gcashRecipient: GcashRecipient | null;
  canReschedule: boolean;
  rescheduleMessage: string;
  createdAt: string;
}

export interface PassengerNotification {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}
