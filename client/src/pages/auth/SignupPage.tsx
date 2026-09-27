import { useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { Logo } from '../../components/brand/Logo';
import { HeroBackgroundSlideshow } from '../../components/public/HeroBackgroundSlideshow';
import { Button, Card, Input } from '../../components/ui';

type SignupField = 'name' | 'email' | 'contact' | 'password' | 'confirmPassword';
type SignupErrors = Partial<Record<SignupField, string>>;

const fieldOrder: SignupField[] = ['name', 'email', 'contact', 'password', 'confirmPassword'];

function firstApiDetail(details: Record<string, unknown>, field: SignupField) {
  const messages = details[field];
  return Array.isArray(messages) && typeof messages[0] === 'string' ? messages[0] : undefined;
}

export function SignupPage() {
  const { user, loading: authLoading, signupPassenger } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SignupErrors>({});
  const refs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>({});

  if (!authLoading && user) return <Navigate to={user.redirectTo} replace />;

  function clearFieldError(field: SignupField) {
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
    if (error) setError(null);
  }

  function showFieldErrors(nextErrors: SignupErrors) {
    setFieldErrors(nextErrors);
    setError(null);
    const firstInvalidField = fieldOrder.find((field) => nextErrors[field]);
    if (firstInvalidField) refs.current[firstInvalidField]?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const nextErrors: SignupErrors = {};
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedContact = contact.trim();

    if (normalizedName.length < 2) nextErrors.name = 'Full name must be at least 2 characters.';
    if (!normalizedEmail) {
      nextErrors.email = 'Please enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = 'Please enter a valid email address.';
    }
    if (normalizedContact.length < 7) nextErrors.contact = 'Contact number must be at least 7 characters.';
    if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    } else if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      nextErrors.password = 'Use an uppercase letter, lowercase letter, and number.';
    }
    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    if (fieldOrder.some((field) => nextErrors[field])) {
      showFieldErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await signupPassenger({
        name: normalizedName,
        email: normalizedEmail,
        contact: normalizedContact,
        password,
        confirmPassword,
      });
      navigate('/verify-email', {
        replace: true,
        state: { email: result.email, developmentCode: result.developmentCode },
      });
    } catch (caughtError) {
      if (caughtError instanceof ApiError) {
        if (caughtError.code === 'EMAIL_ALREADY_IN_USE') {
          showFieldErrors({ email: caughtError.message });
        } else if (caughtError.code === 'VALIDATION_ERROR' && caughtError.details && typeof caughtError.details === 'object') {
          const details = caughtError.details as Record<string, unknown>;
          const apiErrors = Object.fromEntries(
            fieldOrder.map((field) => [field, firstApiDetail(details, field)]),
          ) as SignupErrors;
          if (fieldOrder.some((field) => apiErrors[field])) showFieldErrors(apiErrors);
          else setError(caughtError.message);
        } else {
          setError(caughtError.message);
        }
      } else {
        setError('Unable to create your account right now.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(32rem,1.05fr)]">
      <section className="relative h-48 overflow-hidden bg-primary-deeper text-text-inverse sm:h-56 lg:sticky lg:top-0 lg:h-screen">
        <HeroBackgroundSlideshow />
        <div className="absolute inset-0 bg-gradient-to-t from-primary-deeper/95 via-primary-deeper/55 to-primary-deeper/10 lg:bg-gradient-to-r" />
        <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-8 lg:p-12 xl:p-16">
          <Logo className="[&_span]:text-white" />
          <div className="hidden max-w-xl lg:block">
            <span className="inline-flex items-center gap-2 rounded-pill border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Passenger registration
            </span>
            <h1 className="mt-6 text-5xl font-black tracking-tight text-white xl:text-6xl">Reserve your next ride.</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/85">
              Create one passenger account to book seats, follow departures, and manage every reservation.
            </p>
          </div>
          <p className="hidden text-xs text-white/75 lg:block">Driver and dispatcher accounts are issued by UVGo operations.</p>
        </div>
      </section>

      <section className="relative z-20 -mt-6 flex items-start justify-center px-4 pb-8 sm:-mt-8 sm:px-8 lg:mt-0 lg:min-h-screen lg:px-12 lg:py-12">
        <div className="w-full max-w-lg">
          <Card elevated className="rounded-[2rem] p-6 sm:p-8">
            <Link
              to="/login"
              className="mb-6 inline-flex min-h-touch items-center gap-2 rounded-control px-2 text-sm font-bold text-text-secondary hover:bg-cream hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to sign in
            </Link>
            <h2 className="text-3xl font-extrabold tracking-tight">Create passenger account</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">Enter your details to start booking with UVGo.</p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              <Input
                ref={(element) => { refs.current.name = element; }}
                label="Full name"
                autoComplete="name"
                value={name}
                maxLength={120}
                error={fieldErrors.name}
                onChange={(event) => { setName(event.target.value); clearFieldError('name'); }}
                leadingIcon={<UserRound className="h-4 w-4" />}
                required
              />
              <Input
                ref={(element) => { refs.current.email = element; }}
                label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                maxLength={191}
                error={fieldErrors.email}
                onChange={(event) => { setEmail(event.target.value); clearFieldError('email'); }}
                leadingIcon={<Mail className="h-4 w-4" />}
                required
              />
              <Input
                ref={(element) => { refs.current.contact = element; }}
                label="Contact number"
                type="tel"
                autoComplete="tel"
                value={contact}
                maxLength={32}
                error={fieldErrors.contact}
                onChange={(event) => { setContact(event.target.value); clearFieldError('contact'); }}
                leadingIcon={<Phone className="h-4 w-4" />}
                required
              />
              <div className="relative">
                <Input
                  ref={(element) => { refs.current.password = element; }}
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  maxLength={128}
                  hint="At least 8 characters with uppercase, lowercase, and a number."
                  error={fieldErrors.password}
                  onChange={(event) => { setPassword(event.target.value); clearFieldError('password'); }}
                  className="pr-11"
                  leadingIcon={<LockKeyhole className="h-4 w-4" />}
                  required
                />
                <button
                  type="button"
                  className="group absolute right-1.5 top-[1.625rem] flex min-h-touch min-w-touch items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors group-hover:bg-cream group-hover:text-text-primary">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </span>
                </button>
              </div>
              <Input
                ref={(element) => { refs.current.confirmPassword = element; }}
                label="Confirm password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                maxLength={128}
                error={fieldErrors.confirmPassword}
                onChange={(event) => { setConfirmPassword(event.target.value); clearFieldError('confirmPassword'); }}
                leadingIcon={<LockKeyhole className="h-4 w-4" />}
                required
              />

              {error ? (
                <div role="alert" className="flex items-start gap-2.5 rounded-control border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button type="submit" size="lg" fullWidth loading={submitting} trailingIcon={<ArrowRight className="h-4 w-4" />}>
                Create account
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-text-secondary">
              Already have an account?{' '}
              <Link to="/login" className="font-bold text-primary-dark underline-offset-4 hover:underline">Sign in</Link>
            </p>
          </Card>
          <p className="mt-5 text-center text-xs text-text-secondary">Passenger signup only · Naga City East Bound Terminal</p>
        </div>
      </section>
    </main>
  );
}
