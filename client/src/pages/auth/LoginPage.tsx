import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, House, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/brand/Logo';
import { HeroBackgroundSlideshow } from '../../components/public/HeroBackgroundSlideshow';
import { Button, Card, Input } from '../../components/ui';
import { ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';

const demoAccounts = [
  { label: 'Dispatcher', email: 'dispatcher@uvgo.demo' },
  { label: 'Driver', email: 'driver.rodel@uvgo.demo' },
  { label: 'Passenger', email: 'passenger@uvgo.demo' },
];

export function LoginPage() {
  const { user, loading: authLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedPath = (location.state as { from?: string } | null)?.from;

  if (!authLoading && user) {
    const destination = requestedPath?.startsWith(`/${user.role}/`) ? requestedPath : user.redirectTo;
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const authenticatedUser = await login({ email, password });
      const canResumeRequestedPath = Boolean(requestedPath?.startsWith(`/${authenticatedUser.role}/`));
      navigate(canResumeRequestedPath && requestedPath ? requestedPath : authenticatedUser.redirectTo, { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to sign in right now.');
    } finally {
      setSubmitting(false);
    }
  }

  function selectDemoAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword('UVGoDemo123!');
    setError(null);
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

            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                leadingIcon={<Mail className="h-4 w-4" />}
                required
              />
              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  leadingIcon={<LockKeyhole className="h-4 w-4" />}
                  required
                />
                <button
                  type="button"
                  className="absolute right-1 top-[1.8rem] flex min-h-touch min-w-touch items-center justify-center rounded-full text-text-secondary hover:bg-cream"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error ? (
                <p role="alert" className="rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</p>
              ) : null}
              <Button type="submit" size="lg" fullWidth loading={submitting} trailingIcon={<ArrowRight className="h-4 w-4" />}>
                Sign in
              </Button>
            </form>

            {import.meta.env.DEV ? (
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">Demo accounts</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
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
