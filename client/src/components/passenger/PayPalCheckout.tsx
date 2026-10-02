import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../../api/http';
import type { PassengerBooking } from '../../types/passenger';
import { Button } from '../ui';

interface PayPalButtons {
  render: (target: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
}
interface PayPalSdk {
  Buttons: (options: {
    fundingSource: string;
    style: { layout: string; color: string; shape: string; label: string; height: number; tagline: boolean };
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel: () => Promise<void>;
    onError: () => void;
  }) => PayPalButtons;
}
interface PayPalOrder { reference: string; orderId: string }
interface PayPalCheckoutProps {
  tripId: string;
  seats: number[];
  contact: string;
  studentPassengers?: number;
  seniorPassengers?: number;
  discountIdAcknowledged?: boolean;
  existingOrder?: PayPalOrder;
  onReleased?: () => void;
  onConfirmed: (booking: PassengerBooking) => void;
  onSeatUnavailable: (message: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

let sdkPromise: Promise<PayPalSdk> | null = null;
function loadSdk(clientId: string) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement('script');
    const parameters = new URLSearchParams({ 'client-id': clientId, currency: 'PHP', intent: 'capture', components: 'buttons', 'disable-funding': 'card,credit,paylater,venmo' });
    script.src = `https://www.paypal.com/sdk/js?${parameters.toString()}`;
    script.async = true;
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
    if (nonce) { script.nonce = nonce; script.dataset.cspNonce = nonce; }
    script.onload = () => {
      const sdk = (window as Window & { paypal?: PayPalSdk }).paypal;
      if (sdk) resolve(sdk);
      else { script.remove(); reject(new Error('PayPal checkout did not load.')); }
    };
    script.onerror = () => { script.remove(); reject(new Error('PayPal checkout could not be loaded. Check your connection and try again.')); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  return sdkPromise;
}

/** PayPal owns the approval UI; UVGo's server creates and verifies the payment. */
export function PayPalCheckout(props: PayPalCheckoutProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const order = useRef<PayPalOrder | null>(props.existingOrder ?? null);
  const creation = useRef<Promise<PayPalOrder> | null>(null);
  const active = useRef(true);
  const [stage, setStage] = useState<'loading' | 'ready' | 'creating' | 'capturing' | 'recovery' | 'unavailable'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hasOrder, setHasOrder] = useState(Boolean(props.existingOrder));
  const busy = stage === 'creating' || stage === 'capturing';
  const { onBusyChange } = props;

  useEffect(() => { callbacks.current = props; }, [props]);
  useEffect(() => {
    onBusyChange?.(busy || hasOrder);
    return () => onBusyChange?.(false);
  }, [busy, hasOrder, onBusyChange]);

  async function checkPayment() {
    const current = order.current;
    if (!current) return;
    setStage('capturing'); setMessage(null);
    try {
      const result = await apiRequest<{ booking: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(current.reference)}/paypal/capture`, { method: 'POST' });
      if (result.booking.status !== 'confirmed' || result.booking.payment?.status !== 'captured') throw new Error('PayPal payment is still pending. Check again; do not pay again.');
      order.current = null; setHasOrder(false);
      callbacks.current.onConfirmed(result.booking);
    } catch (error) {
      if (!active.current) return;
      setStage('recovery');
      setMessage(error instanceof Error ? error.message : 'Payment could not be verified. Check again; do not pay again.');
    }
  }

  async function cancelCheckout() {
    const current = order.current;
    if (!current) return;
    setStage('capturing'); setMessage(null);
    try {
      const result = await apiRequest<{ released: boolean; booking?: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(current.reference)}/paypal/release`, { method: 'POST' });
      if (result.booking?.payment?.status === 'captured') {
        order.current = null; setHasOrder(false);
        callbacks.current.onConfirmed(result.booking);
      } else if (result.released) {
        order.current = null; setHasOrder(false); setStage('ready');
        setMessage('Checkout cancelled. The seat hold has been released.');
        callbacks.current.onReleased?.();
      } else {
        setStage('recovery'); setMessage('PayPal approval or payment is pending. Check payment status; do not pay again.');
      }
    } catch (error) {
      if (!active.current) return;
      setStage('recovery'); setMessage(error instanceof Error ? error.message : 'Checkout could not be cancelled. Check payment status.');
    }
  }

  const actions = useRef({ checkPayment, cancelCheckout });
  useEffect(() => { actions.current = { checkPayment, cancelCheckout }; });

  useEffect(() => {
    active.current = true;
    let disposed = false;
    let buttons: PayPalButtons | undefined;
    const target = container.current;
    async function initialize() {
      try {
        const config = await apiRequest<{ clientId: string; environment: string }>('/passenger/paypal/config');
        if (config.environment !== 'sandbox') throw new Error('Sandbox checkout is not configured.');
        const sdk = await loadSdk(config.clientId);
        if (disposed || !target) return;
        buttons = sdk.Buttons({
          fundingSource: 'paypal',
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay', height: 48, tagline: false },
          createOrder: async () => {
            if (order.current) return order.current.orderId;
            setStage('creating'); setMessage(null);
            try {
              const details = callbacks.current;
              creation.current ??= apiRequest<PayPalOrder>('/passenger/reservations/paypal', {
                method: 'POST', body: JSON.stringify({ tripId: details.tripId, seats: details.seats, contact: details.contact,
                  ...(details.studentPassengers || details.seniorPassengers ? { studentPassengers: details.studentPassengers ?? 0, seniorPassengers: details.seniorPassengers ?? 0, discountIdAcknowledged: details.discountIdAcknowledged } : {}),
                }),
              });
              const created = await creation.current;
              if (!created.reference || !created.orderId) throw new Error('PayPal did not return a checkout order.');
              order.current = created; setHasOrder(true); setStage('ready');
              return created.orderId;
            } catch (error) {
              if (!disposed) {
                setStage('ready');
                setMessage(error instanceof Error ? error.message : 'Checkout could not be started.');
                if (error instanceof ApiError && ['SEAT_UNAVAILABLE', 'TRIP_CLOSED'].includes(error.code)) {
                  await callbacks.current.onSeatUnavailable(error.message);
                }
              }
              throw error;
            } finally {
              creation.current = null;
            }
          },
          onApprove: async (data) => {
            if (!order.current || data.orderID !== order.current.orderId) {
              setStage('recovery'); setMessage('The checkout order could not be matched. Check My Bookings before paying again.');
              return;
            }
            await actions.current.checkPayment();
          },
          onCancel: async () => { await actions.current.cancelCheckout(); },
          onError: () => {
            if (disposed) return;
            setStage(order.current ? 'recovery' : 'ready');
            setMessage((previous) => previous ?? 'PayPal checkout could not finish. If you approved payment, check its status before trying again.');
          },
        });
        await buttons.render(target);
        if (!disposed) setStage((current) => current === 'loading' ? 'ready' : current);
      } catch (error) {
        if (!disposed) {
          setStage((current) => current === 'loading' ? 'unavailable' : current);
          setMessage(error instanceof Error ? error.message : 'PayPal checkout is unavailable.');
        }
      }
    }
    void initialize();
    return () => { disposed = true; active.current = false; void buttons?.close().catch(() => undefined); };
  }, [attempt]);

  return <div className="min-w-0 space-y-2">
    {message ? <p role="status" className="text-sm leading-5 text-text-primary">{message}</p> : null}
    {stage === 'loading' ? <p role="status" className="py-3 text-sm">Loading PayPal checkout…</p> : null}
    {busy ? <p role="status" className="py-2 text-sm font-semibold">{stage === 'creating' ? 'Holding your seats…' : 'Checking payment with PayPal…'}</p> : null}
    <div ref={container} className={['loading', 'ready', 'creating'].includes(stage) ? 'min-h-12 w-full' : 'hidden'} />
    {stage === 'unavailable' ? <Button fullWidth onClick={() => { setMessage(null); setStage('loading'); setAttempt((current) => current + 1); }}>Retry PayPal checkout</Button> : null}
    {hasOrder && !busy && (stage === 'recovery' || stage === 'unavailable' || props.existingOrder) ? <Button fullWidth onClick={() => void checkPayment()}>Check payment status</Button> : null}
    {hasOrder && !busy ? <Button fullWidth variant="ghost" onClick={() => void cancelCheckout()}>Cancel unpaid checkout</Button> : null}
  </div>;
}
