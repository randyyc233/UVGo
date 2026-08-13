export interface GoaTrip {
  id: string;
  route: 'Goa';
  origin: string;
  destination: string;
  departureTime: string;
  fare: number;
  serviceFee: number;
  vanId: string;
  capacity: number;
  availableSeats: number;
  canFitParty: boolean;
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
  departureTime: string;
  vanId: string;
  seats: number[];
  seatCount: number;
  fareAmount: number;
  serviceFee: number;
  totalAmount: number;
  status: string;
  payment: null | {
    method: 'paypal' | 'gcash';
    status: string;
    gcashReference: string | null;
  };
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
