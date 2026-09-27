import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { Logo } from '../../components/brand/Logo';
import { Button, Card, Input } from '../../components/ui';

interface ResetLocationState {
  email?: string;
  developmentCode?: string;
  message?: string;
}

export function ResetPasswordPage() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const state = (location.state as ResetLocationState | null) ?? {};
  const [email, setEmail] = useState(state.email ?? '');
  const [code, setCode] = useState(state.developmentCode ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authLoading && user) return <Navigate to={user.redirectTo} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from your email.');
    if (newPassword.length < 8 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) return setError('Use at least 8 characters with uppercase, lowercase, and a number.');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      await apiRequest<{ message: string }>('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword, confirmPassword }),
      });
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Your password could not be reset right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card elevated className="w-full max-w-md rounded-[2rem] p-6 sm:p-8">
        <Logo />
        {success ? (
          <div className="mt-8 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-primary" />
            <h1 className="mt-5 text-3xl font-black">Password updated</h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">All previous UVGo sessions for this account have been invalidated. Sign in with your new password.</p>
            <Link to="/login" className="mt-6 flex min-h-touch items-center justify-center rounded-control bg-primary px-5 text-sm font-bold text-white">Continue to sign in</Link>
          </div>
        ) : (
          <>
            <div className="mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-dark"><KeyRound className="h-6 w-6" /></div>
            <h1 className="mt-5 text-3xl font-black">Reset password</h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{state.message ?? 'Enter the code sent to your email and choose a new password.'}</p>
            {state.developmentCode ? <p className="mt-4 rounded-control bg-warning-soft p-3 text-sm text-text-primary"><strong>Development mode:</strong> use code <span className="select-all font-black tracking-widest">{state.developmentCode}</span>.</p> : null}
            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <Input label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} required />
              <Input label="Reset code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }} required />
              <div className="relative">
                <Input label="New password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(null); }} hint="At least 8 characters with uppercase, lowercase, and a number." leadingIcon={<LockKeyhole className="h-4 w-4" />} className="pr-11" required />
                <button type="button" className="absolute right-1.5 top-[1.625rem] flex min-h-touch min-w-touch items-center justify-center rounded-full text-text-secondary" aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <Input label="Confirm new password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(null); }} leadingIcon={<LockKeyhole className="h-4 w-4" />} required />
              {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{error}</p> : null}
              <Button type="submit" size="lg" fullWidth loading={loading}>Reset password</Button>
            </form>
            <Link to="/forgot-password" className="mt-5 flex min-h-touch items-center justify-center gap-2 text-sm font-bold text-primary-dark"><ArrowLeft className="h-4 w-4" />Request another code</Link>
          </>
        )}
      </Card>
    </main>
  );
}
