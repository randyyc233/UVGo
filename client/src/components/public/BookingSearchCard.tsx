import { useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, MapPin, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select } from '../ui';

function tomorrowForInput() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timezoneOffset = tomorrow.getTimezoneOffset() * 60_000;
  return new Date(tomorrow.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function BookingSearchCard() {
  const navigate = useNavigate();
  const [departureDate, setDepartureDate] = useState(tomorrowForInput());
  const [passengers, setPassengers] = useState('1');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({ date: departureDate, passengers });
    navigate(`/passenger/book?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="relative z-10 rounded-[1.25rem] border border-white/60 bg-surface/95 p-4 shadow-floating backdrop-blur sm:p-5 lg:p-6"
      aria-label="Search Goa trips"
    >
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-sm font-bold text-primary-dark">Reserve a Goa seat</p>
          <p className="mt-0.5 text-xs text-text-secondary">Terminal-to-terminal · One way</p>
        </div>
        <span className="rounded-pill bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">Goa only</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_0.85fr_0.72fr_auto] lg:items-end">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-primary">From</p>
          <div className="flex min-h-touch items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm">
            <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <span className="truncate">Naga City East Bound Terminal</span>
          </div>
        </div>
        <ArrowRight className="mx-1 mb-3 hidden h-5 w-5 text-text-muted lg:block" aria-hidden="true" />
        <div>
          <p className="mb-1.5 text-sm font-semibold text-text-primary">To</p>
          <div className="flex min-h-touch items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm">
            <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
            <span>Goa Terminal</span>
          </div>
        </div>
        <Input
          id="public-departure-date"
          label="Departure date"
          type="date"
          min={tomorrowForInput()}
          value={departureDate}
          onChange={(event) => setDepartureDate(event.target.value)}
          leadingIcon={<CalendarDays className="h-4 w-4" />}
          required
        />
        <Select
          label="Passengers"
          aria-label="Passengers"
          value={passengers}
          onChange={(event) => setPassengers(event.target.value)}
          leadingIcon={<UsersRound className="h-4 w-4" />}
        >
          <option value="1">1 Passenger</option>
          <option value="2">2 Passengers</option>
          <option value="3">3 Passengers</option>
          <option value="4">4 Passengers</option>
        </Select>
        <Button type="submit" size="lg" className="sm:col-span-2 lg:col-span-1 lg:min-w-44" trailingIcon={<ArrowRight className="h-4 w-4" />}>
          Search trips
        </Button>
      </div>
      <p className="mt-3 text-xs text-text-secondary">
        Legazpi operates through Taya loading and is available on the departure board as status-only.
      </p>
    </form>
  );
}

