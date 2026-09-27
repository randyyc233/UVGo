const MANILA_TIME_ZONE = 'Asia/Manila';

type DateValue = string | number | Date;

/** Formats an instant as a Manila 12-hour clock value such as `9:45 PM`. */
export function formatTime12(value: DateValue, includeSeconds = false) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: MANILA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {}),
    hour12: true,
  }).format(new Date(value));
}

/** Formats an instant with caller-selected date fields and a 12-hour Manila time. */
export function formatDateTime12(
  value: DateValue,
  dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) {
  return new Intl.DateTimeFormat('en-PH', {
    ...dateOptions,
    timeZone: MANILA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

/** Converts an API/HTML clock value such as `20:10` into `8:10 PM`. */
export function formatClockTime12(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return value;
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}
