/** Manila has a fixed UTC+08:00 offset, so a service day is exactly 24 hours. */
export function manilaServiceDay(value: Date) {
  const date = new Date(value.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00.000+08:00`);
  return { date, start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}

/** Monday 00:00 through the following Monday 00:00 in Asia/Manila. */
export function manilaServiceWeek(value: Date) {
  const day = manilaServiceDay(value);
  const manilaClock = new Date(value.getTime() + 8 * 60 * 60_000);
  const isoWeekday = manilaClock.getUTCDay() || 7;
  const start = new Date(day.start.getTime() - (isoWeekday - 1) * 24 * 60 * 60_000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
  return {
    start,
    end,
    startDate: new Date(start.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10),
    endDate: new Date(end.getTime() - 1 + 8 * 60 * 60_000).toISOString().slice(0, 10),
  };
}
