import { useMemo, useState, type FormEvent } from 'react';
import { BusFront, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, Phone, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import type { AuthUser } from '../../auth/authTypes';
import { Button, Card, Input, useToast } from '../../components/ui';
import { useDriverOverview } from '../../hooks/useDriverOverview';

type AccountErrors = { name?: string; email?: string; contact?: string };
type PasswordErrors = { currentPassword?: string; newPassword?: string; confirmPassword?: string };

function validationDetails(error: ApiError) {
  return error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object'
    ? error.details as Record<string, unknown>
    : null;
}

function firstDetail(details: Record<string, unknown> | null, field: string) {
  const messages = details?.[field];
  return Array.isArray(messages) && typeof messages[0] === 'string' ? messages[0] : undefined;
}

export function DriverProfilePage() {
  const { user, refresh, logout } = useAuth();
  const { overview } = useDriverOverview();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [contact, setContact] = useState(user?.contact ?? '');
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const initials = useMemo(() => (user?.name ?? 'Driver')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(), [user?.name]);
  const accountChanged = Boolean(user && (
    name.trim() !== user.name
    || email.trim().toLowerCase() !== user.email.toLowerCase()
    || contact.trim() !== (user.contact ?? '')
  ));

  function resetAccountForm() {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setContact(user?.contact ?? '');
    setAccountErrors({});
    setAccountError(null);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: AccountErrors = {};
    if (name.trim().length < 2) nextErrors.name = 'Full name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) nextErrors.email = 'Enter a valid email address.';
    if (contact.trim().length < 7) nextErrors.contact = 'Phone number must be at least 7 characters.';
    setAccountErrors(nextErrors);
    setAccountError(null);
    if (Object.keys(nextErrors).length) return;

    setAccountSaving(true);
    try {
      const response = await apiRequest<{ user: AuthUser }>('/driver/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), email: normalizedEmail, contact: contact.trim() }),
      });
      setName(response.user.name);
      setEmail(response.user.email);
      setContact(response.user.contact ?? '');
      await refresh();
      toast.success('Driver profile updated.');
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = validationDetails(caught);
        const nextApiErrors = {
          name: firstDetail(details, 'name'),
          email: caught.code === 'EMAIL_ALREADY_IN_USE' ? caught.message : firstDetail(details, 'email'),
          contact: firstDetail(details, 'contact'),
        };
        if (nextApiErrors.name || nextApiErrors.email || nextApiErrors.contact) setAccountErrors(nextApiErrors);
        else setAccountError(caught.message);
      } else setAccountError('Your profile could not be updated.');
    } finally {
      setAccountSaving(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: PasswordErrors = {};
    if (!currentPassword) nextErrors.currentPassword = 'Enter your current password.';
    if (newPassword.length < 8) nextErrors.newPassword = 'New password must be at least 8 characters.';
    else if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) nextErrors.newPassword = 'Use uppercase, lowercase, and a number.';
    if (!confirmPassword) nextErrors.confirmPassword = 'Confirm your new password.';
    else if (newPassword !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    if (currentPassword && currentPassword === newPassword) nextErrors.newPassword = 'Choose a password different from your current password.';
    setPasswordErrors(nextErrors);
    setPasswordError(null);
    if (Object.keys(nextErrors).length) return;

    setPasswordSaving(true);
    try {
      await apiRequest<{ message: string }>('/driver/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      toast.success('Password changed. Sign in with your new password.');
      await logout();
      navigate('/login', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = validationDetails(caught);
        const nextApiErrors = {
          currentPassword: caught.code === 'CURRENT_PASSWORD_INCORRECT' ? caught.message : firstDetail(details, 'currentPassword'),
          newPassword: firstDetail(details, 'newPassword'),
        };
        if (nextApiErrors.currentPassword || nextApiErrors.newPassword) setPasswordErrors(nextApiErrors);
        else setPasswordError(caught.message);
      } else setPasswordError('Your password could not be changed.');
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card className="overflow-hidden p-0" padded={false}>
        <div className="bg-gradient-to-r from-primary-deeper to-primary p-6 text-white sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white/25 bg-white text-2xl font-black text-primary-dark">{initials}</span>
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Driver account</p><h2 className="mt-1 text-3xl font-black text-white">{user.name}</h2><p className="mt-1 text-sm text-white/80">Manage your personal contact details and account security.</p></div>
          </div>
        </div>
        <div className="grid gap-3 p-5 text-sm sm:grid-cols-3 sm:p-6">
          <p className="flex items-center gap-3 rounded-control bg-cream p-3"><Mail className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 break-all">{user.email}</span></p>
          <p className="flex items-center gap-3 rounded-control bg-cream p-3"><Phone className="h-4 w-4 shrink-0 text-primary" /><span>{user.contact ?? 'No phone number'}</span></p>
          <p className="flex items-center gap-3 rounded-control bg-cream p-3"><BusFront className="h-4 w-4 shrink-0 text-primary" /><span>{overview ? `${overview.vehicle.vanId} · ${overview.vehicle.route}` : 'Assigned vehicle'}</span></p>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><UserRound className="h-5 w-5" /></span><div><h2 className="text-lg font-extrabold">Personal information</h2><p className="mt-1 text-sm text-text-secondary">Update the name, email, and phone number associated with your driver account.</p></div></div>
          <form className="mt-6 space-y-4" onSubmit={saveAccount} noValidate>
            <Input label="Full name" value={name} maxLength={120} autoComplete="name" error={accountErrors.name} onChange={(event) => { setName(event.target.value); setAccountErrors((current) => ({ ...current, name: undefined })); setAccountError(null); }} leadingIcon={<UserRound className="h-4 w-4" />} />
            <Input label="Email address" type="email" value={email} maxLength={191} autoComplete="email" error={accountErrors.email} onChange={(event) => { setEmail(event.target.value); setAccountErrors((current) => ({ ...current, email: undefined })); setAccountError(null); }} leadingIcon={<Mail className="h-4 w-4" />} hint="This is the email you use to sign in." />
            <Input label="Phone number" type="tel" value={contact} maxLength={32} autoComplete="tel" error={accountErrors.contact} onChange={(event) => { setContact(event.target.value); setAccountErrors((current) => ({ ...current, contact: undefined })); setAccountError(null); }} leadingIcon={<Phone className="h-4 w-4" />} />
            {accountError ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{accountError}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" disabled={!accountChanged || accountSaving} onClick={resetAccountForm}>Discard changes</Button><Button type="submit" loading={accountSaving} disabled={!accountChanged} leadingIcon={<Save className="h-4 w-4" />}>Save profile</Button></div>
          </form>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><ShieldCheck className="h-5 w-5" /></span><div><h2 className="text-lg font-extrabold">Password and security</h2><p className="mt-1 text-sm text-text-secondary">Confirm your current password before choosing a new one.</p></div></div><button type="button" className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-cream" aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'} onClick={() => setShowPasswords((visible) => !visible)}>{showPasswords ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div>
          <form className="mt-6 space-y-4" onSubmit={savePassword} noValidate>
            <Input label="Current password" type={showPasswords ? 'text' : 'password'} value={currentPassword} maxLength={128} autoComplete="current-password" error={passwordErrors.currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordErrors((current) => ({ ...current, currentPassword: undefined })); setPasswordError(null); }} leadingIcon={<LockKeyhole className="h-4 w-4" />} />
            <Input label="New password" type={showPasswords ? 'text' : 'password'} value={newPassword} maxLength={128} autoComplete="new-password" error={passwordErrors.newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordErrors((current) => ({ ...current, newPassword: undefined })); setPasswordError(null); }} leadingIcon={<LockKeyhole className="h-4 w-4" />} hint="At least 8 characters with uppercase, lowercase, and a number." />
            <Input label="Confirm new password" type={showPasswords ? 'text' : 'password'} value={confirmPassword} maxLength={128} autoComplete="new-password" error={passwordErrors.confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordErrors((current) => ({ ...current, confirmPassword: undefined })); setPasswordError(null); }} leadingIcon={<CheckCircle2 className="h-4 w-4" />} />
            {passwordError ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{passwordError}</p> : null}
            <p className="rounded-control bg-warning-soft p-3 text-xs leading-5 text-text-secondary">Changing your password signs out every active session, including this one. Sign in again using the new password.</p>
            <Button type="submit" fullWidth loading={passwordSaving} leadingIcon={<ShieldCheck className="h-4 w-4" />}>Change password</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
