import { Armchair, UserRound } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { TripSeat } from '../../types/passenger';

interface VanSeatPickerProps {
  seats: TripSeat[];
  selected: number[];
  limit: number;
  onChange: (seats: number[]) => void;
}

type SeatCell = number | 'driver' | null;

// Front to back: one driver + one front passenger, two 3-seat rows,
// then a 4-seat rear row. Passenger seats are always numbered 1-11.
const layout: SeatCell[][] = [
  ['driver', null, null, 1],
  [2, 3, null, 4],
  [5, 6, null, 7],
  [8, 9, 10, 11],
];

export function VanSeatPicker({ seats, selected, limit, onChange }: VanSeatPickerProps) {
  const seatMap = new Map(seats.map((seat) => [seat.number, seat]));

  function toggleSeat(number: number) {
    const seat = seatMap.get(number);
    if (!seat?.available) return;
    if (selected.includes(number)) {
      onChange(selected.filter((value) => value !== number));
      return;
    }
    if (selected.length < limit) {
      onChange([...selected, number]);
      return;
    }

    // Once the requested number of seats is selected, choosing another
    // available seat should replace the most recent choice instead of doing
    // nothing. This makes changing a selection a single, predictable action.
    onChange([...selected.slice(0, -1), number]);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-text-secondary" aria-label="Seat legend">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-text-primary" />Driver</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-primary bg-white" />Available</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary" />Selected</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-unavailable" />Unavailable</span>
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-[31rem] overflow-hidden rounded-card bg-white">
        <img
          src="/assets/vehicles/top view of van for seat selection overlay.png"
          alt="Top view of the UV Express van"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
        <div className="absolute bottom-[10%] left-[31%] right-[27%] top-[15%] grid grid-rows-4 gap-[5%]" aria-label="Van seating: one driver and 11 passenger seats">
          {layout.map((row, rowIndex) => (
            <div key={rowIndex} className="grid min-h-0 grid-cols-4 gap-[5%]">
              {row.map((number, columnIndex) => {
                if (!number) return <span key={`empty-${columnIndex}`} />;
                if (number === 'driver') {
                  return (
                    <span
                      key="driver"
                      role="img"
                      aria-label="Driver seat, not selectable"
                      className="flex min-h-0 flex-col items-center justify-center rounded-md border border-text-primary bg-text-primary/95 text-[0.5rem] font-extrabold text-white shadow-sm sm:text-[0.65rem]"
                    >
                      <UserRound className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span>Driver</span>
                    </span>
                  );
                }
                const seat = seatMap.get(number);
                const isSelected = selected.includes(number);
                const available = seat?.available ?? false;
                return (
                  <button
                    key={number}
                    type="button"
                    disabled={!available}
                    aria-pressed={isSelected}
                    aria-label={`${number === 1 ? 'Front passenger seat' : 'Passenger seat'} ${number}, ${!available ? 'unavailable' : isSelected ? 'selected' : 'available'}`}
                    onClick={() => toggleSeat(number)}
                    className={cn(
                      'flex min-h-0 items-center justify-center rounded-md border text-[0.6rem] font-extrabold shadow-sm transition sm:text-xs',
                      available && !isSelected && 'border-primary bg-white/95 text-primary-dark hover:bg-primary-soft',
                      isSelected && 'border-primary bg-primary text-white',
                      !available && 'cursor-not-allowed border-unavailable bg-unavailable/90 text-text-muted line-through',
                    )}
                  >
                    {number}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 flex items-start justify-center gap-2 text-center text-xs leading-5 text-text-secondary"><Armchair className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Seat 1 is the only passenger seat beside the driver. Seats 1–11 are for passengers, for 12 total occupants including the driver. Select exactly {limit}; choose another seat to replace your latest selection.</p>
    </div>
  );
}
