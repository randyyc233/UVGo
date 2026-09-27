import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { Logo } from '../../components/brand/Logo';
import { Button, Card, Input } from '../../components/ui';

interface VerificationLocationState {
  email?: string;
  developmentCode?: string;
}

export function VerifyEmailPage() {
  const { user, loading: authLoading, verifyEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as VerificationLocationState | null) ?? {};
  const [email, setEmail] = useState(state.email ?? '');
  const [code, setCode] = useState(state.developmentCode ?? '');
  const [developmentCode, setDevelopmentCode] = useState(state.developmentCode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('Enter the 6-digit code sent to your email address.');
  const [error, setError] = useState<string | null>(null);

  if (!authLoading && user) return <Navigate to={user.redirectTo} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setSubmitting(true);
    try {
      const authenticatedUser = await verifyEmail({ email: email.trim(), code: code.trim() });
      navigate(authenticatedUser.redirectTo, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The email could not be verified right now.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setError(null);
    setResending(true);
    try {
      const response = await apiRequest<{ message: string; developmentCode?: string }>('/auth/verification/resend', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(response.message);
      if (response.developmentCode) {
        setDevelopmentCode(response.developmentCode);
        setCode(response.developmentCode);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'A new code could not be requested right now.');
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card elevated className="w-full max-w-md rounded-[2rem] p-6 sm:p-8">
        <Logo />
        <div className="mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-dark"><MailCheck className="h-6 w-6" /></div>
        <h1 className="mt-5 text-3xl font-black">Verify your email</h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{message}</p>
        {developmentCode ? <p className="mt-4 rounded-control bg-warning-soft p-3 text-sm text-text-primary"><strong>Development mode:</strong> use code <span className="select-all font-black tracking-widest">{developmentCode}</span>. Production never displays codes here.</p> : null}
        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} required />
          <Input label="Verification code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }} hint="Use the latest code; it expires shortly." required />
          {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth loading={submitting} leadingIcon={<ShieldCheck className="h-4 w-4" />} trailingIcon={<ArrowRight className="h-4 w-4" />}>Verify and continue</Button>
        </form>
        <Button className="mt-3" type="button" variant="ghost" fullWidth loading={resending} onClick={() => void resend()} leadingIcon={<RefreshCw className="h-4 w-4" />}>Send a new code</Button>
        <Link to="/login" className="mt-4 flex min-h-touch items-center justify-center gap-2 text-sm font-bold text-primary-dark"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
      </Card>
    </main>
  );
}
