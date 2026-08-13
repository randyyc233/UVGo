const apiBase = 'http://localhost:4000/api';

const loginResponse = await fetch(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'maria.santos@uvgo.demo', password: 'UVGoDemo123!' }),
});
if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Session cookie was not returned.');

const seatsResponse = await fetch(`${apiBase}/passenger/trips/seed_trip_goa_day_three/seats`, { headers: { Cookie: cookie } });
const seatData = await seatsResponse.json() as { seats: Array<{ number: number; available: boolean }> };
const seat = seatData.seats.find((candidate) => candidate.available)?.number;
if (!seat) throw new Error('No seat is available for the GCash smoke test.');

const form = new FormData();
form.set('tripId', 'seed_trip_goa_day_three');
form.set('seats', JSON.stringify([seat]));
form.set('contact', '09170000002');
form.set('gcashReference', 'GCASH-PHASE5-QA');
form.set('receipt', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'smoke-receipt.png');

const bookingResponse = await fetch(`${apiBase}/passenger/reservations/gcash`, {
  method: 'POST',
  headers: { Cookie: cookie },
  body: form,
});
const payload = await bookingResponse.json() as { booking?: { reference: string; status: string; payment: { status: string } }; error?: unknown };
if (!bookingResponse.ok || !payload.booking) throw new Error(`GCash booking failed: ${JSON.stringify(payload)}`);

console.log(JSON.stringify({
  httpStatus: bookingResponse.status,
  bookingStatus: payload.booking.status,
  paymentStatus: payload.booking.payment.status,
  reference: payload.booking.reference,
}, null, 2));
