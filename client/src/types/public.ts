export interface PublicDeparture {
  id: string;
  route: 'Goa' | 'Legazpi';
  routeCode: 'goa' | 'legazpi';
  origin: string;
  destination: string;
  vanId: string;
  protocol: 'Goso' | 'Taya';
  departureTime: string | null;
  queuePosition: number;
  occupancy: {
    count: number;
    capacity: number;
    percent: number;
  };
  availableSeats: number | null;
  reservable: boolean;
}

export interface PublicDeparturesResponse {
  terminal: {
    name: string;
    address: string;
  };
  departures: PublicDeparture[];
  updatedAt: string;
}

export interface PublicRoute {
  code: 'goa' | 'legazpi';
  name: 'Goa' | 'Legazpi';
  destination: string;
  protocol: 'Goso' | 'Taya';
  reservable: boolean;
  fare: number | null;
  nextDeparture: string | null;
  summary: string;
}

export interface PublicRoutesResponse {
  origin: string;
  routes: PublicRoute[];
}

