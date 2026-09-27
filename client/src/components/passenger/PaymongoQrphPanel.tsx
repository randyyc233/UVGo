import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, QrCode, RefreshCw } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/http';
import { formatDateTime12 } from '../../lib/dateTime';
import type { PassengerBooking, PaymongoQrphCheckout } from '../../types/passenger';
import { Button, LoadingSkeleton } from '../ui';

interface PaymongoQrphPanelProps {
  booking: PassengerBooking;
  initialCheckout?: PaymongoQrphCheckout | null;
  onBookingChange: (booking: PassengerBooking) => void;
}

function expiryLabel(value: string) {
  return formatDateTime12(value);
}

export function PaymongoQrphPanel({ booking, initialCheckout = null, onBookingChange }: PaymongoQrphPanelProps) {
  const [checkout, setCheckout] = useState<PaymongoQrphCheckout | null>(initialCheckout);
  const [loading, setLoading] = useState(!initialCheckout);
  const [error, setError] = useState<string | null>(null);
  const paymentPending = booking.payment?.method === 'paymongo_qrph' && booking.payment.status === 'pending';

  async function refresh() {
    if (!paymentPending) return;
    try {
      const result = await apiRequest<{ booking: PassengerBooking; checkout: PaymongoQrphCheckout | null }>(
        `/passenger/bookings/${encodeURIComponent(booking.reference)}/paymongo/qrph`,
      );
      onBookingChange(result.booking);
      if (result.checkout) setCheckout(result.checkout);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The QR Ph payment status could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!paymentPending) return;
    let active = true;
    const poll = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      await refresh();
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 3_000);
    const focus = () => void poll();
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
    };
    // The booking reference identifies this checkout; status stops the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.reference, paymentPending]);

  if (booking.status === 'confirmed' || booking.payment?.status === 'captured') {
    return (
      <div className="rounded-card border border-primary/25 bg-success-soft p-5 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
        <p className="mt-3 font-extrabold text-primary-dark">QR Ph payment received</p>
        <p className="mt-1 text-sm text-text-secondary">Your reservation is confirmed. You do not need to pay again.</p>
      </div>
    );
  }

  if (booking.payment?.status === 'failed' || booking.status === 'forfeited') {
    return (
      <div role="alert" className="rounded-card border border-danger/25 bg-danger-soft p-4 text-danger">
        <p className="font-extrabold">QR Ph payment expired or failed</p>
        <p className="mt-1 text-sm">{booking.payment?.rejectionReason ?? 'The held seats were released. Start a new booking to try again.'}</p>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-primary/25 bg-white p-5" aria-labelledby="qrph-heading">
      <div className="flex items-start gap-3">
        <QrCode className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 id="qrph-heading" className="font-extrabold text-primary-dark">Scan to pay with QR Ph</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">Use a participating bank or e-wallet app. The encoded total is ₱{booking.totalAmount.toFixed(2)}.</p>
        </div>
      </div>

      {loading && !checkout ? <div className="mt-5"><LoadingSkeleton lines={4} /></div> : null}
      {checkout ? (
        <div className="mt-5 text-center">
          {!checkout.livemode ? (
            <p className="mb-4 rounded-control bg-warning-soft p-3 text-sm leading-6 text-text-primary">
              Test mode: do not scan this QR with a real bank or wallet app. Use PayMongo’s test link below.
            </p>
          ) : null}
          <img src={checkout.qrImageUrl} alt={`QR Ph payment code for reservation ${booking.reference}`} className="mx-auto aspect-square w-full max-w-72 rounded-control border border-border bg-white p-3" />
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-text-secondary"><Clock3 className="h-4 w-4" />Expires {expiryLabel(checkout.expiresAt)}</p>
          {checkout.testUrl && !checkout.livemode ? <a href={checkout.testUrl} target="_blank" rel="noreferrer" className="mt-4 flex min-h-touch w-full items-center justify-center rounded-control bg-primary px-4 text-sm font-bold text-white">Open PayMongo test payment</a> : null}
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger"><p>{error}</p><Button className="mt-2" size="sm" variant="outline" onClick={() => void refresh()} leadingIcon={<RefreshCw className="h-4 w-4" />}>Try again</Button></div> : null}
    </section>
  );
}
