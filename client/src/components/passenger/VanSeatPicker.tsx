import { Armchair } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { TripSeat } from '../../types/passenger';

interface VanSeatPickerProps {
  seats: TripSeat[];
  selected: number[];
  limit: number;
  onChange: (seats: number[]) => void;
}

const layout: Array<Array<number | null>> = [
  [1, 2, null], [3, 4, null], [5, 6, null], [7, 8, 9],
  [10, 11, 12], [13, 14, 15], [16, 17, null],
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
    if (selected.length < limit) onChange([...selected, number].sort((a, b) => a - b));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-text-secondary" aria-label="Seat legend">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-primary bg-white" />Available</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary" />Selected</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-unavailable" />Unavailable</span>
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-[31rem] overflow-hidden rounded-card bg-white">
        <img
          src="/assets/vehicles/top view of van for seat selection overlay.png"
          alt="Top view of the UV Express van"
          className="absolute inset-0 h-full w-full object-contain"
        />
        <div className="absolute bottom-[8%] left-[35%] right-[30%] top-[37%] grid grid-rows-7 gap-[2%]" aria-label="Van seats">
          {layout.map((row, rowIndex) => (
            <div key={rowIndex} className="grid min-h-0 grid-cols-3 gap-[5%]">
              {row.map((number, columnIndex) => {
                if (!number) return <span key={`empty-${columnIndex}`} />;
                const seat = seatMap.get(number);
                const isSelected = selected.includes(number);
                const available = seat?.available ?? false;
                return (
                  <button
                    key={number}
                    type="button"
                    disabled={!available}
                    aria-pressed={isSelected}
                    aria-label={`Seat ${number}, ${!available ? 'unavailable' : isSelected ? 'selected' : 'available'}`}
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
      <p className="mt-3 flex items-center justify-center gap-2 text-xs text-text-secondary"><Armchair className="h-4 w-4 text-primary" />Seats 1–3 offer extra legroom. Select exactly {limit}.</p>
    </div>
  );
}
