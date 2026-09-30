// PayPal's single-button HTML integration, supplied by the merchant.
// Intentionally no SDK, iframe, client ID, effects, or order-creation API.
// Opening checkout is NOT proof of payment; UVGo verifies the report separately.
export const PAYPAL_PAYMENT_URL = 'https://www.paypal.com/ncp/payment/GSVS6T37CPCJG';

export function PayPalHostedButton() {
  return (
    <div className="space-y-3">
      <form
        action={PAYPAL_PAYMENT_URL}
        method="post"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Pay on PayPal"
        className="w-full max-w-md"
      >
        <input
          type="submit"
          value="Pay Now"
          aria-describedby="paypal-new-tab"
          className="min-h-14 w-full cursor-pointer rounded-control border-0 bg-paypal-gold px-8 text-center font-paypal text-lg font-bold leading-5 text-paypal-ink shadow-sm transition hover:brightness-95"
        />
      </form>
      <p id="paypal-new-tab" className="text-xs leading-5 text-text-secondary">
        This is the merchant-supplied PayPal button. It opens the real payment page in a new tab.
        Return here after payment to upload your receipt.
      </p>
    </div>
  );
}
