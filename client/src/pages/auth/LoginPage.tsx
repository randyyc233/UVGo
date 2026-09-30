import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, House, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/brand/Logo';
import { GoogleSignInButton } from '../../components/auth/GoogleSignInButton';
import { HeroBackgroundSlideshow } from '../../components/public/HeroBackgroundSlideshow';
import { Button, Card, Input } from '../../components/ui';
import { ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';

const demoAccounts = [
  { label: 'Goa dispatcher', email: 'dispatcher@uvgo.demo' },
  { label: 'Legazpi dispatcher', email: 'dispatcher.legazpi@uvgo.demo' },
  { label: 'Driver', email: 'driver.rodel@uvgo.demo' },
  { label: 'Passenger', email: 'passenger@uvgo.demo' },
];

export function LoginPage() {
  const { user, loading: authLoading, login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const requestedPath = (location.state as { from?: string } | null)?.from;
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  if (!authLoading && user) {
    const destination = requestedPath?.startsWith(`/${user.role}/`) ? requestedPath : user.redirectTo;
    return <Navigate to={destination} replace />;
  }

  // Field-level errors are shown inline on the inputs, so the summary banner is
  // reserved for errors that concern the whole form. This keeps a single red
  // surface on screen instead of stacking a banner on top of a highlighted field.
  function showFieldErrors(nextErrors: { email?: string; password?: string }) {
    setFieldErrors(nextErrors);
    setError(null);
    if (nextErrors.email) {
      emailRef.current?.focus();
    } else if (nextErrors.password) {
      passwordRef.current?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const nextErrors: { email?: string; password?: string } = {};
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      nextErrors.email = 'Please enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Please enter your password.';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }

    if (nextErrors.email || nextErrors.password) {
      showFieldErrors(nextErrors);
      return;
    }

    setSubmitting(true);

    try {
      const authenticatedUser = await login({ email, password });
      const canResumeRequestedPath = Boolean(requestedPath?.startsWith(`/${authenticatedUser.role}/`));
      navigate(canResumeRequestedPath && requestedPath ? requestedPath : authenticatedUser.redirectTo, { replace: true });
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        const details = caughtError.code === 'VALIDATION_ERROR' && caughtError.details && typeof caughtError.details === 'object'
          ? (caughtError.details as Record<string, unknown>)
          : null;
        const apiErrors: { email?: string; password?: string } = {};
        if (details) {
          if (Array.isArray(details.email) && typeof details.email[0] === 'string') {
            apiErrors.email = details.email[0];
          }
          if (Array.isArray(details.password) && typeof details.password[0] === 'string') {
            apiErrors.password = details.password[0];
          }
        }

        if (apiErrors.email || apiErrors.password) {
          showFieldErrors(apiErrors);
        } else {
          // Covers INVALID_CREDENTIALS and other form-wide failures: the message
          // applies to both fields, so it is reported once, as a banner.
          setFieldErrors({});
          setError(caughtError.message);
        }
      } else {
        setFieldErrors({});
        setError('Unable to sign in right now.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    if (googleSubmitting) return;
    setGoogleSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const authenticatedUser = await googleLogin({ credential });
      const canResumeRequestedPath = Boolean(requestedPath?.startsWith(`/${authenticatedUser.role}/`));
      navigate(canResumeRequestedPath && requestedPath ? requestedPath : authenticatedUser.redirectTo, { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to sign in with Google right now.');
    } finally {
      setGoogleSubmitting(false);
    }
  }

  function selectDemoAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword('UVGoDemo123!');
    setError(null);
    setFieldErrors({});
  }

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(30rem,0.92fr)]">
      <section className="relative h-52 overflow-hidden bg-primary-deeper text-text-inverse sm:h-64 lg:h-auto lg:min-h-screen">
        <HeroBackgroundSlideshow />
        <div className="absolute inset-0 bg-gradient-to-t from-primary-deeper/95 via-primary-deeper/55 to-primary-deeper/10 lg:bg-gradient-to-r" />
        <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-8 lg:min-h-screen lg:p-12 xl:p-16">
          <Logo className="[&_span]:text-white" />
          <div className="hidden max-w-xl lg:block">
            <span className="inline-flex items-center gap-2 rounded-pill border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Secure role-based access
            </span>
            <h1 className="mt-6 text-5xl font-black tracking-tight text-white xl:text-6xl">
              Mas Marhay an Biyahe Pag Ready Ka.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/85">
              Check your trip, reserve your seat, asin stay updated before you go.
            </p>
          </div>
          <div className="hidden grid-cols-3 gap-3 text-xs text-white/85 lg:grid">
            <p className="rounded-card border border-white/20 bg-primary-deeper/55 p-4 backdrop-blur-sm">Goa reservations</p>
            <p className="rounded-card border border-white/20 bg-primary-deeper/55 p-4 backdrop-blur-sm">Driver queues</p>
            <p className="rounded-card border border-white/20 bg-primary-deeper/55 p-4 backdrop-blur-sm">Fleet oversight</p>
          </div>
        </div>
      </section>

      <section className="relative z-20 -mt-7 flex items-start justify-center px-4 pb-8 sm:-mt-10 sm:px-8 lg:mt-0 lg:min-h-screen lg:items-center lg:px-12 lg:py-12">
        <div className="w-full max-w-md">
          <Card elevated className="rounded-[2rem] p-6 sm:p-8">
            <Link
              to="/#top"
              className="mb-7 inline-flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-border bg-white text-text-secondary shadow-[0_14px_20px_-10px_rgba(19,39,27,0.45)] transition duration-200 hover:-translate-y-1 hover:border-border-strong hover:text-primary-dark hover:shadow-floating focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
              aria-label="Return to the UVGo home hero section"
            >
              <House className="h-8 w-8" strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Home</span>
            </Link>
            <h2 className="text-3xl font-extrabold tracking-tight">Welcome back</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">Enter your UVGo account details to continue.</p>

            {/* LOGIN FORM */}
            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              {/* Email Input */}
              <Input
                ref={emailRef}
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                error={fieldErrors.email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  if (error) setError(null);
                }}
                leadingIcon={<Mail className="h-4 w-4" />}
                required
              />
              {/* Password Input & toggle*/}
              <div className="relative">
                <Input
                  ref={passwordRef}
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  error={fieldErrors.password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  if (error) setError(null);
                  }}
                  className="pr-11"
                  leadingIcon={<LockKeyhole className="h-4 w-4" />}
                  required
                />
                <button
                  type="button"
                  className="group absolute right-1.5 top-[1.625rem] flex min-h-touch min-w-touch items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors group-hover:bg-cream group-hover:text-text-primary">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </span>
                </button>
              </div>
              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-control border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger"
                >
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}
              <Button type="submit" size="lg" fullWidth loading={submitting} trailingIcon={<ArrowRight className="h-4 w-4" />}>
                Sign in
              </Button>
            </form>

            {googleClientId ? (
              <>
                <div className="my-5 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">or use email</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div aria-busy={googleSubmitting}>
                  <GoogleSignInButton
                    clientId={googleClientId}
                    onCredential={(credential) => void handleGoogleCredential(credential)}
                    onError={setError}
                  />
                  {googleSubmitting ? <p role="status" className="mt-2 text-center text-xs font-medium text-text-secondary">Signing in securely…</p> : null}
                </div>
              </>
            ) : null}

            <p className="mt-4 text-center text-sm">
              <Link to="/forgot-password" className="font-bold text-primary-dark underline-offset-4 hover:underline">Forgot password?</Link>
            </p>

            <p className="mt-5 text-center text-sm text-text-secondary">
              New passenger?{' '}
              <Link to="/signup" className="font-bold text-primary-dark underline-offset-4 hover:underline">
                Create an account
              </Link>
            </p>

            {import.meta.env.DEV ? (
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Demo accounts</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {demoAccounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      className="min-h-touch rounded-control border border-border px-2 text-xs font-semibold text-primary-dark hover:border-primary hover:bg-primary-soft"
                      onClick={() => selectDemoAccount(account.email)}
                    >
                      {account.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-text-muted">Select a role to fill its development credentials.</p>
              </div>
            ) : null}
          </Card>
          <p className="mt-5 text-center text-xs text-text-secondary">Naga City East Bound Terminal · In-app access only</p>
        </div>
      </section>
    </main>
  );
}
