import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Mail } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { Logo } from '../../components/brand/Logo';
import { Button, Card, Input } from '../../components/ui';

export function ForgotPasswordPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authLoading && user) return <Navigate to={user.redirectTo} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiRequest<{ message: string; developmentCode?: string }>('/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      navigate('/reset-password', {
        state: { email: email.trim(), developmentCode: response.developmentCode, message: response.message },
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'A reset code could not be requested right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card elevated className="w-full max-w-md rounded-[2rem] p-6 sm:p-8">
        <Logo />
        <div className="mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-dark"><KeyRound className="h-6 w-6" /></div>
        <h1 className="mt-5 text-3xl font-black">Forgot password?</h1>
        <p className="mt-2 text-sm leading-6 text-text-secondary">Passenger, driver, and dispatcher accounts can reset their password here. Enter your UVGo email and, if it belongs to an active account, we’ll send a 6-digit reset code.</p>
        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} leadingIcon={<Mail className="h-4 w-4" />} required />
          {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{error}</p> : null}
          <Button type="submit" size="lg" fullWidth loading={loading} trailingIcon={<ArrowRight className="h-4 w-4" />}>Send reset code</Button>
        </form>
        <Link to="/login" className="mt-5 flex min-h-touch items-center justify-center gap-2 text-sm font-bold text-primary-dark"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>
      </Card>
    </main>
  );
}
