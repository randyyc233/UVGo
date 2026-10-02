import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  BusFront,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  KeyRound,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/authContext';
import { ApiError, apiRequest } from '../../api/http';
import { formatClockTime12, formatDateTime12 } from '../../lib/dateTime';
import {
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  Input,
  LoadingSkeleton,
  Modal,
  Select,
  StatusBadge,
  useToast,
} from '../../components/ui';
import type {
  DispatcherAccountManagement,
  DriverManagement,
  ManagedDriver,
  ManagedSchedule,
  ScheduleManagement,
  TayaWeeklyScheduleManagement,
  WeeklyScheduleTemplate,
} from '../../types/dispatcher';

// Seat capacity is per-vehicle and dispatcher-adjustable. These mirror the
// server bounds in `server/src/config/vehicle.ts`.
const DEFAULT_PASSENGER_CAPACITY = 11;
const MIN_PASSENGER_CAPACITY = 1;
const MAX_PASSENGER_CAPACITY = 30;

interface DriverForm {
  name: string;
  contact: string;
  email: string;
  password: string;
  vanId: string;
  plateNo: string;
  capacity: string;
  isActive: boolean;
}

type DriverTextField = Exclude<keyof DriverForm, 'isActive'>;
type DriverFormErrors = Partial<Record<DriverTextField, string>>;

const driverFieldIds: Record<DriverTextField, string> = {
  name: 'managed-driver-name',
  contact: 'managed-driver-contact',
  email: 'managed-driver-email',
  password: 'managed-driver-password',
  vanId: 'managed-driver-van-id',
  plateNo: 'managed-driver-plate-number',
  capacity: 'managed-driver-seat-capacity',
};

const driverApiFields: Record<string, DriverTextField> = {
  name: 'name',
  contact: 'contact',
  email: 'email',
  password: 'password',
  'vehicle.vanId': 'vanId',
  'vehicle.plateNo': 'plateNo',
  'vehicle.capacity': 'capacity',
};

const emptyDriver: DriverForm = {
  name: '',
  contact: '',
  email: '',
  password: '',
  vanId: '',
  plateNo: '',
  capacity: String(DEFAULT_PASSENGER_CAPACITY),
  isActive: true,
};

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function validateDriverForm(form: DriverForm, editing: boolean): DriverFormErrors {
  const errors: DriverFormErrors = {};
  const name = form.name.trim();
  const contact = form.contact.trim();
  const email = form.email.trim();
  const vanId = form.vanId.trim();
  const plateNo = form.plateNo.trim();
  const capacity = Number(form.capacity);

  if (name.length < 2) errors.name = 'Enter the driver’s full name (at least 2 characters).';
  else if (name.length > 120) errors.name = 'Driver name must be 120 characters or fewer.';
  if (contact.length < 7) errors.contact = 'Enter a valid contact number with at least 7 characters.';
  else if (contact.length > 32) errors.contact = 'Contact number must be 32 characters or fewer.';
  if (!email) errors.email = 'Enter the driver’s email address.';
  else if (email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!editing && form.password.length < 8) errors.password = 'Temporary password must be at least 8 characters.';
  else if (!editing && form.password.length > 128) errors.password = 'Temporary password must be 128 characters or fewer.';
  if (vanId.length < 2) errors.vanId = 'Enter a Van ID with at least 2 characters.';
  else if (vanId.length > 32) errors.vanId = 'Van ID must be 32 characters or fewer.';
  if (plateNo.length < 3) errors.plateNo = 'Enter a plate number with at least 3 characters.';
  else if (plateNo.length > 32) errors.plateNo = 'Plate number must be 32 characters or fewer.';
  if (!Number.isInteger(capacity) || capacity < MIN_PASSENGER_CAPACITY || capacity > MAX_PASSENGER_CAPACITY) {
    errors.capacity = `Enter a whole number of seats between ${MIN_PASSENGER_CAPACITY} and ${MAX_PASSENGER_CAPACITY}.`;
  }

  return errors;
}

function apiDriverFormErrors(error: unknown): DriverFormErrors {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) return {};
  const errors: DriverFormErrors = {};
  for (const [apiField, value] of Object.entries(error.details as Record<string, unknown>)) {
    const formField = driverApiFields[apiField];
    const firstMessage = Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
    if (formField && firstMessage) errors[formField] = firstMessage;
  }
  return errors;
}

function focusFirstDriverError(errors: DriverFormErrors) {
  const field = (Object.keys(driverFieldIds) as DriverTextField[]).find((candidate) => errors[candidate]);
  if (field) requestAnimationFrame(() => document.getElementById(driverFieldIds[field])?.focus());
}

function DriverFormFields({ form, editing, errors, onChange }: { form: DriverForm; editing: boolean; errors: DriverFormErrors; onChange: (next: DriverForm, field?: DriverTextField) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input id={driverFieldIds.name} label="Driver name" value={form.name} error={errors.name} onChange={(event) => onChange({ ...form, name: event.target.value }, 'name')} required />
      <Input id={driverFieldIds.contact} label="Contact number" value={form.contact} error={errors.contact} onChange={(event) => onChange({ ...form, contact: event.target.value }, 'contact')} required />
      <Input id={driverFieldIds.email} label="Email address" type="email" value={form.email} error={errors.email} onChange={(event) => onChange({ ...form, email: event.target.value }, 'email')} required />
      {editing ? null : <Input id={driverFieldIds.password} label="Temporary password" type="password" minLength={8} value={form.password} error={errors.password} onChange={(event) => onChange({ ...form, password: event.target.value }, 'password')} hint="At least 8 characters. Share it securely with the driver." required />}
      <Input id={driverFieldIds.vanId} label="Van ID" value={form.vanId} error={errors.vanId} onChange={(event) => onChange({ ...form, vanId: event.target.value.toUpperCase() }, 'vanId')} required />
      <Input id={driverFieldIds.plateNo} label="Plate number" value={form.plateNo} error={errors.plateNo} onChange={(event) => onChange({ ...form, plateNo: event.target.value.toUpperCase() }, 'plateNo')} required />
      <Input id={driverFieldIds.capacity} label="Passenger seats" type="number" inputMode="numeric" min={MIN_PASSENGER_CAPACITY} max={MAX_PASSENGER_CAPACITY} value={form.capacity} error={errors.capacity} onChange={(event) => onChange({ ...form, capacity: event.target.value }, 'capacity')} hint={`Bookable passenger seats, ${MIN_PASSENGER_CAPACITY}–${MAX_PASSENGER_CAPACITY}. Defaults to ${DEFAULT_PASSENGER_CAPACITY}; the van carries one more with the driver.`} required />
      {editing ? (
        <Select label="Account status" value={form.isActive ? 'active' : 'inactive'} onChange={(event) => onChange({ ...form, isActive: event.target.value === 'active' })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      ) : null}
    </div>
  );
}

function MobileDriverActions({ driver, edit, resetPassword, remove }: {
  driver: ManagedDriver;
  edit: () => void;
  resetPassword: () => void;
  remove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const actionsId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function select(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  return (
    <div ref={container} className="relative shrink-0 sm:hidden" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={trigger} type="button" aria-label={`Actions for ${driver.name}`} aria-expanded={open} aria-controls={actionsId} className="flex min-h-touch w-11 items-center justify-center rounded-control border border-border text-text-secondary hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setOpen((value) => !value)}>
        <Ellipsis className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? (
        <div id={actionsId} className="absolute right-0 z-30 mt-1 w-48 rounded-control border border-border bg-surface p-1 shadow-floating">
          <button type="button" className="flex min-h-touch w-full items-center gap-2 rounded-control px-3 text-left text-sm font-semibold hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => select(edit)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>
          <button type="button" className="flex min-h-touch w-full items-center gap-2 rounded-control px-3 text-left text-sm font-semibold hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => select(resetPassword)}><KeyRound className="h-4 w-4" aria-hidden="true" />Reset password</button>
          <button type="button" className="flex min-h-touch w-full items-center gap-2 rounded-control px-3 text-left text-sm font-semibold text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger" onClick={() => select(remove)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</button>
        </div>
      ) : null}
    </div>
  );
}

export function DispatcherDriversPage() {
  const toast = useToast();
  const [data, setData] = useState<DriverManagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<DriverFormErrors>({});
  const [editing, setEditing] = useState<ManagedDriver | null>(null);
  const [form, setForm] = useState<DriverForm>(emptyDriver);
  const [passwordDriver, setPasswordDriver] = useState<ManagedDriver | null>(null);
  const [deletingDriver, setDeletingDriver] = useState<ManagedDriver | null>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ management: DriverManagement }>('/dispatcher/drivers');
      setData(response.management);
    } catch (caught) {
      setError(message(caught, 'Driver management could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<{ management: DriverManagement }>('/dispatcher/drivers')
      .then((response) => { if (active) setData(response.management); })
      .catch((caught) => { if (active) setError(message(caught, 'Driver management could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyDriver);
    setFormErrors({});
    setModalError(null);
    setModalOpen(true);
  }

  function openEdit(driver: ManagedDriver) {
    setEditing(driver);
    setForm({
      name: driver.name,
      contact: driver.contact ?? '',
      email: driver.email,
      password: '',
      vanId: driver.vehicle?.vanId ?? '',
      plateNo: driver.vehicle?.plateNo ?? '',
      capacity: String(driver.vehicle?.capacity ?? DEFAULT_PASSENGER_CAPACITY),
      isActive: driver.isActive,
    });
    setFormErrors({});
    setModalError(null);
    setModalOpen(true);
  }

  async function saveDriver() {
    const validationErrors = validateDriverForm(form, Boolean(editing));
    if (Object.keys(validationErrors).length) {
      setFormErrors(validationErrors);
      setModalError('Please correct the highlighted fields below.');
      focusFirstDriverError(validationErrors);
      return;
    }

    setSaving(true);
    setModalError(null);
    try {
      const body = {
        name: form.name,
        contact: form.contact,
        email: form.email,
        ...(editing ? { isActive: form.isActive } : { password: form.password }),
        vehicle: { vanId: form.vanId, plateNo: form.plateNo, capacity: Number(form.capacity) },
      };
      const response = await apiRequest<{ management: DriverManagement }>(editing ? `/dispatcher/drivers/${editing.id}` : '/dispatcher/drivers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setData(response.management);
      setModalOpen(false);
      setFormErrors({});
      toast.success(editing ? 'Driver and van updated.' : 'Driver account and van created.');
    } catch (caught) {
      const apiErrors = apiDriverFormErrors(caught);
      setFormErrors(apiErrors);
      setModalError(message(caught, 'The driver record could not be saved.'));
      focusFirstDriverError(apiErrors);
    } finally {
      setSaving(false);
    }
  }

  function updateDriverForm(next: DriverForm, field?: DriverTextField) {
    setForm(next);
    if (!field) return;
    setFormErrors((current) => {
      if (!current[field]) return current;
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async function resetPassword() {
    if (!passwordDriver) return;
    setSaving(true);
    try {
      await apiRequest(`/dispatcher/drivers/${passwordDriver.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
      setPasswordDriver(null);
      setPassword('');
      toast.success('Driver password reset. Existing driver sessions were invalidated.');
    } catch (caught) {
      setError(message(caught, 'The password could not be reset.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteDriver() {
    if (!deletingDriver) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ management: DriverManagement }>(`/dispatcher/drivers/${deletingDriver.id}`, { method: 'DELETE' });
      setData(response.management);
      setDeletingDriver(null);
      toast.success('Driver deleted. Access was revoked and operational history was retained.');
    } catch (caught) {
      setError(message(caught, 'The driver could not be deleted.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Card className="p-5"><LoadingSkeleton lines={8} /></Card>;
  if (!data) return <EmptyState icon={<UsersRound className="h-6 w-6" />} title="Driver management unavailable" description={error ?? 'No management data was returned.'} action={<Button variant="outline" onClick={() => void load()} leadingIcon={<RefreshCw className="h-4 w-4" />}>Try again</Button>} />;

  return (
    <div className="space-y-4">
      <div className="dashboard-page-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{data.route} operations</p><h2 className="mt-1 text-2xl font-black">Drivers & vehicles</h2></div>
        <Button onClick={openCreate} leadingIcon={<Plus className="h-4 w-4" />}>Add driver</Button>
      </div>
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {data.drivers.map((driver) => (
          <Card key={driver.id} className="min-w-0 p-3 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary sm:h-11 sm:w-11"><UserRoundCog className="h-5 w-5" /></span>
                <div className="min-w-0"><h3 className="break-words font-extrabold">{driver.name}</h3><p className="break-all text-sm text-text-secondary">{driver.email}</p><p className="text-xs text-text-muted">{driver.contact}</p><div className="mt-2 sm:hidden"><StatusBadge tone={driver.isActive ? 'success' : 'neutral'}>{driver.isActive ? 'Active' : 'Inactive'}</StatusBadge></div></div>
              </div>
              <div className="hidden shrink-0 sm:block"><StatusBadge tone={driver.isActive ? 'success' : 'neutral'}>{driver.isActive ? 'Active' : 'Inactive'}</StatusBadge></div>
              <MobileDriverActions driver={driver} edit={() => openEdit(driver)} resetPassword={() => { setPassword(''); setPasswordDriver(driver); }} remove={() => setDeletingDriver(driver)} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-control bg-cream p-3 text-sm"><div><p className="text-xs text-text-secondary">Van</p><p className="font-bold">{driver.vehicle?.vanId ?? 'Unassigned'}</p></div><div><p className="text-xs text-text-secondary">Plate</p><p className="font-bold">{driver.vehicle?.plateNo ?? '—'}</p></div><div><p className="text-xs text-text-secondary">Seat capacity</p><p className="font-bold">{driver.vehicle ? `${driver.vehicle.capacity} seats` : '—'}</p></div></div>
            <div className="hidden sm:block"><div className="dashboard-actions mt-4"><Button size="sm" variant="outline" onClick={() => openEdit(driver)} leadingIcon={<Pencil className="h-4 w-4" />}>Edit</Button><Button size="sm" variant="ghost" onClick={() => { setPassword(''); setPasswordDriver(driver); }} leadingIcon={<KeyRound className="h-4 w-4" />}>Reset password</Button><Button size="sm" variant="danger" onClick={() => setDeletingDriver(driver)} leadingIcon={<Trash2 className="h-4 w-4" />}>Delete</Button></div></div>
          </Card>
        ))}
      </div>
      {!data.drivers.length ? <EmptyState icon={<UsersRound className="h-6 w-6" />} title="No managed drivers" description="Create the first driver account and assign its van." action={<Button onClick={openCreate}>Add driver</Button>} /> : null}
      <Modal open={modalOpen} title={editing ? 'Edit driver & vehicle' : 'Create driver account'} description={`The route and ${data.routeCode === 'goa' ? 'Goso' : 'Taya'} protocol are assigned automatically.`} onClose={() => setModalOpen(false)} className="max-w-2xl" footer={<><Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button type="submit" form="managed-driver-form" loading={saving}>{editing ? 'Save changes' : 'Create account'}</Button></>}>
        <form id="managed-driver-form" noValidate onSubmit={(event) => { event.preventDefault(); void saveDriver(); }}>
          {modalError ? <p role="alert" className="mb-4 rounded-control border border-danger/30 bg-danger-soft p-3 text-sm font-semibold text-danger">{modalError}</p> : null}
          <DriverFormFields form={form} editing={Boolean(editing)} errors={formErrors} onChange={updateDriverForm} />
        </form>
      </Modal>
      <Modal open={Boolean(passwordDriver)} title="Reset driver password" description={`Set a new temporary password for ${passwordDriver?.name ?? 'this driver'}. Existing sessions will be signed out.`} onClose={() => setPasswordDriver(null)} footer={<><Button variant="ghost" onClick={() => setPasswordDriver(null)}>Cancel</Button><Button loading={saving} disabled={password.length < 8} onClick={() => void resetPassword()}>Reset password</Button></>}>
        <Input label="New temporary password" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} hint="At least 8 characters." />
      </Modal>
      <ConfirmationDialog
        open={Boolean(deletingDriver)}
        title="Delete this driver?"
        description={`${deletingDriver?.name ?? 'This driver'} will immediately lose access. Active assignments will be cancelled, the driver will be removed from the queue, and ${deletingDriver?.vehicle?.vanId ?? 'the assigned van'} will be permanently deleted. Its van ID and plate number can be reused. Historical trips, bookings, passenger counts, and audit logs will be retained through an anonymized history record.`}
        confirmLabel="Delete driver"
        destructive
        loading={saving}
        onClose={() => { if (!saving) setDeletingDriver(null); }}
        onConfirm={() => void deleteDriver()}
      />
    </div>
  );
}

interface DispatcherAccountForm {
  name: string;
  contact: string;
  email: string;
  password: string;
  confirmPassword: string;
}

type DispatcherAccountField = keyof DispatcherAccountForm;
type DispatcherAccountErrors = Partial<Record<DispatcherAccountField, string>>;

const emptyDispatcherAccount: DispatcherAccountForm = {
  name: '',
  contact: '',
  email: '',
  password: '',
  confirmPassword: '',
};

function validateDispatcherAccount(form: DispatcherAccountForm): DispatcherAccountErrors {
  const errors: DispatcherAccountErrors = {};
  if (form.name.trim().length < 2) errors.name = 'Enter the dispatcher’s full name.';
  if (form.contact.trim().length < 7) errors.contact = 'Enter a valid contact number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.password.length < 8 || !/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) {
    errors.password = 'Use at least 8 characters with uppercase, lowercase, and a number.';
  }
  if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match.';
  return errors;
}

export function DispatcherAccountsPage() {
  const toast = useToast();
  const [data, setData] = useState<DispatcherAccountManagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<DispatcherAccountForm>(emptyDispatcherAccount);
  const [formErrors, setFormErrors] = useState<DispatcherAccountErrors>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ management: DispatcherAccountManagement }>('/dispatcher/accounts');
      setData(response.management);
    } catch (caught) {
      setError(message(caught, 'Dispatcher accounts could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<{ management: DispatcherAccountManagement }>('/dispatcher/accounts')
      .then((response) => { if (active) setData(response.management); })
      .catch((caught) => { if (active) setError(message(caught, 'Dispatcher accounts could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function updateField(field: DispatcherAccountField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
  }

  async function createAccount() {
    const nextErrors = validateDispatcherAccount(form);
    if (Object.keys(nextErrors).length) {
      setFormErrors(nextErrors);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ management: DispatcherAccountManagement }>('/dispatcher/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          contact: form.contact.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });
      setData(response.management);
      setModalOpen(false);
      setForm(emptyDispatcherAccount);
      setFormErrors({});
      toast.success('Backup dispatcher account created.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.details && typeof caught.details === 'object' && !Array.isArray(caught.details)) {
        const details = caught.details as Record<string, unknown>;
        const next: DispatcherAccountErrors = {};
        for (const field of ['name', 'contact', 'email', 'password'] as const) {
          const values = details[field];
          if (Array.isArray(values) && typeof values[0] === 'string') next[field] = values[0];
        }
        setFormErrors(next);
      }
      setError(message(caught, 'The backup dispatcher account could not be created.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Card className="p-5"><LoadingSkeleton lines={7} /></Card>;
  if (!data) return <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Dispatcher accounts unavailable" description={error ?? 'No dispatcher data was returned.'} action={<Button variant="outline" onClick={() => void load()} leadingIcon={<RefreshCw className="h-4 w-4" />}>Try again</Button>} />;

  return (
    <div className="space-y-4">
      <div className="dashboard-page-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">{data.route} operations</p>
          <h2 className="mt-1 text-2xl font-black">Dispatcher accounts</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">Add a trusted backup dispatcher for your route. Backup accounts receive the same operational access as your account.</p>
        </div>
        <Button onClick={() => { setForm(emptyDispatcherAccount); setFormErrors({}); setError(null); setModalOpen(true); }} leadingIcon={<Plus className="h-4 w-4" />}>Add backup dispatcher</Button>
      </div>
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">{error}</p> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {data.dispatchers.map((dispatcher) => (
          <Card key={dispatcher.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><ShieldCheck className="h-5 w-5" /></span>
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{dispatcher.name}</h3>{dispatcher.isCurrentAccount ? <StatusBadge tone="info">You</StatusBadge> : null}</div>
                  <p className="text-sm text-text-secondary">{dispatcher.email}</p>
                  <p className="text-xs text-text-muted">{dispatcher.contact ?? 'No contact number'}</p>
                </div>
              </div>
              <StatusBadge tone={dispatcher.isActive ? 'success' : 'neutral'}>{dispatcher.isActive ? 'Active' : 'Inactive'}</StatusBadge>
            </div>
            <div className="mt-4 rounded-control bg-cream p-3 text-xs leading-5 text-text-secondary">
              <p><span className="font-semibold text-text-primary">Route:</span> {data.route}</p>
              <p><span className="font-semibold text-text-primary">Created by:</span> {dispatcher.createdBy ?? 'UVGo operations'}</p>
            </div>
          </Card>
        ))}
      </div>
      <Modal open={modalOpen} title="Add backup dispatcher" description={`This account will receive full Dispatcher access for the ${data.route} route only.`} onClose={() => setModalOpen(false)} footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button type="submit" form="backup-dispatcher-form" loading={saving}>Create account</Button></>}>
        <form id="backup-dispatcher-form" className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void createAccount(); }}>
          <p className="rounded-control bg-warning-soft p-3 text-sm leading-6 text-text-primary"><strong>Full operational access:</strong> only create this account for a trusted person responsible for the same route.</p>
          <Input label="Full name" value={form.name} error={formErrors.name} onChange={(event) => updateField('name', event.target.value)} required />
          <Input label="Contact number" type="tel" value={form.contact} error={formErrors.contact} onChange={(event) => updateField('contact', event.target.value)} required />
          <Input label="Email address" type="email" autoComplete="off" value={form.email} error={formErrors.email} onChange={(event) => updateField('email', event.target.value)} hint="Use a real, unique email so Forgot password can deliver a reset code." required />
          <Input label="Temporary password" type="password" autoComplete="new-password" value={form.password} error={formErrors.password} onChange={(event) => updateField('password', event.target.value)} hint="At least 8 characters with uppercase, lowercase, and a number." required />
          <Input label="Confirm temporary password" type="password" autoComplete="new-password" value={form.confirmPassword} error={formErrors.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} required />
        </form>
      </Modal>
    </div>
  );
}

interface WeeklyScheduleForm {
  weekday: string;
  boardingTime: string;
  departureTime: string;
  vehicleId: string;
  fareAmount: string;
  isActive: boolean;
}

const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

function manilaWeekday(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
  }).format(date);
  return WEEKDAYS.find((day) => day.label === label)?.value ?? null;
}

function currentManilaWeekday() {
  return manilaWeekday(new Date()) ?? 1;
}

/** Compact fare summary for the collapsed fare row. */
function fareLabel(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `₱${amount.toFixed(2)}` : 'Not set';
}

function manilaDateTime(value: string) {
  return formatDateTime12(value, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function DispatcherTayaSchedulesPage() {
  const toast = useToast();
  const [selectedWeeklyDay, setSelectedWeeklyDay] = useState<number>(currentManilaWeekday);
  const [data, setData] = useState<TayaWeeklyScheduleManagement | null>(null);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ tayaSchedule: TayaWeeklyScheduleManagement }>('/dispatcher/taya-schedules', { cache: 'no-store' });
      setData(response.tayaSchedule);
      setSelectedWeeklyDay(response.tayaSchedule.currentWeekday);
      setVehicleIds(response.tayaSchedule.entries.filter((entry) => entry.weekday === response.tayaSchedule.currentWeekday).map((entry) => entry.vehicle.id));
    } catch (caught) {
      setError(message(caught, 'The Taya weekly queue could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<{ tayaSchedule: TayaWeeklyScheduleManagement }>('/dispatcher/taya-schedules', { cache: 'no-store' })
      .then((response) => {
        if (!active) return;
        setData(response.tayaSchedule);
        setSelectedWeeklyDay(response.tayaSchedule.currentWeekday);
        setVehicleIds(response.tayaSchedule.entries.filter((entry) => entry.weekday === response.tayaSchedule.currentWeekday).map((entry) => entry.vehicle.id));
      })
      .catch((caught) => { if (active) setError(message(caught, 'The Taya weekly queue could not be loaded.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function selectWeekday(weekday: number) {
    setSelectedWeeklyDay(weekday);
    setVehicleIds(data?.entries.filter((entry) => entry.weekday === weekday).map((entry) => entry.vehicle.id) ?? []);
    setSelectedVehicleId('');
    setError(null);
  }

  const availableVehicles = data?.vehicles.filter((vehicle) => !vehicleIds.includes(vehicle.id)) ?? [];

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= vehicleIds.length) return;
    setVehicleIds((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination]!, next[index]!];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ tayaSchedule: TayaWeeklyScheduleManagement }>('/dispatcher/taya-schedules', {
        method: 'PUT',
        body: JSON.stringify({ weekday: selectedWeeklyDay, vehicleIds }),
      });
      setData(response.tayaSchedule);
      setVehicleIds(response.tayaSchedule.entries.filter((entry) => entry.weekday === selectedWeeklyDay).map((entry) => entry.vehicle.id));
      toast.success(`${WEEKDAYS[selectedWeeklyDay - 1]?.label ?? 'Weekly'} Taya queue saved.`);
    } catch (caught) {
      setError(message(caught, 'The Taya weekly queue could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Card className="p-5"><LoadingSkeleton lines={8} /></Card>;
  if (!data) return <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Taya schedules unavailable" description={error ?? 'No weekly schedule data was returned.'} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />;
  const selectedWeekday = WEEKDAYS.find((day) => day.value === selectedWeeklyDay) ?? WEEKDAYS[0];
  return (
    <div className="grid min-w-0 gap-4">
      <div className="hidden lg:block"><p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-primary sm:text-xs">Taya weekly operations</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Legazpi queue schedules</h2></div>
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <Card className="p-4 sm:p-5">
        <div className="border-b border-border pb-3 sm:pb-4">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-extrabold sm:text-lg">Weekly queue order</h3><StatusBadge tone="success">Repeats automatically</StatusBadge></div>
          <details className="group mt-2 sm:hidden">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">How to arrange the weekly queue<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <p className="pb-2 text-xs leading-5 text-text-secondary">Add drivers, use Up and Down to set their positions, then save the selected weekday. The saved order repeats every week.</p>
          </details>
          <p className="mt-1 hidden text-sm leading-6 text-text-secondary sm:block">Add drivers and arrange their positions, then save the selected weekday.</p>
        </div>
        <div className="-mx-1 mt-3 px-1 pb-2 sm:mt-4 sm:overflow-x-auto" role="tablist" aria-label="Taya weekly schedule days">
          <div className="grid grid-cols-7 gap-1 sm:flex sm:min-w-max sm:gap-2">
            {WEEKDAYS.map((day) => {
              const selected = day.value === selectedWeeklyDay;
              const count = data.entries.filter((entry) => entry.weekday === day.value).length;
              return (
                <button
                  key={day.value}
                  id={`taya-weekly-day-tab-${day.value}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="taya-weekly-day-panel"
                  aria-label={`${day.label}, ${count} driver${count === 1 ? '' : 's'}`}
                  onClick={() => selectWeekday(day.value)}
                  className={`min-h-touch min-w-0 rounded-control border px-0.5 py-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-w-[4.5rem] sm:shrink-0 sm:px-3 sm:text-left ${selected ? 'border-primary bg-primary text-text-inverse shadow-sm' : 'border-border bg-surface text-text-primary hover:border-primary/40 hover:bg-primary-soft'}`}
                >
                  <span className="block text-[0.65rem] font-extrabold sm:text-sm">{day.label.slice(0, 3)}</span>
                  <span className={`mt-0.5 block text-[0.7rem] font-semibold ${selected ? 'text-text-inverse/80' : 'text-text-muted'}`}>{count}<span className="hidden sm:inline"> rule{count === 1 ? '' : 's'}</span></span>
                </button>
              );
            })}
          </div>
        </div>
        <section id="taya-weekly-day-panel" role="tabpanel" aria-labelledby={`taya-weekly-day-tab-${selectedWeekday.value}`} className="mt-2 min-w-0 sm:rounded-control sm:border sm:border-border sm:bg-background/45 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="hidden text-xs font-bold uppercase tracking-[0.12em] text-primary sm:block">Selected day</p><h4 className="text-base font-extrabold text-text-primary sm:mt-0.5 sm:text-lg">{selectedWeekday.label}</h4></div>
            <StatusBadge tone="info">{`${vehicleIds.length} driver${vehicleIds.length === 1 ? '' : 's'}`}</StatusBadge>
          </div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:mt-4 [&>div]:min-w-0">
            <Select className="min-w-0" label="Add van and driver" value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              <option value="">Choose a van and driver</option>
              {availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vanId} · {vehicle.driver}</option>)}
            </Select>
            <Button className="gap-1 px-3 sm:gap-2 sm:px-5" aria-label="Add to queue" disabled={!selectedVehicleId} onClick={() => { setVehicleIds((current) => [...current, selectedVehicleId]); setSelectedVehicleId(''); }} leadingIcon={<Plus className="h-4 w-4" />}><span className="sm:hidden">Add</span><span className="hidden sm:inline">Add to queue</span></Button>
          </div>
          {vehicleIds.length ? <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-2">{vehicleIds.map((vehicleId, index) => {
            const vehicle = data.vehicles.find((candidate) => candidate.id === vehicleId);
            return <article key={vehicleId} className="min-w-0 rounded-control border border-border bg-surface p-3 shadow-sm sm:flex sm:items-center sm:gap-3 sm:shadow-none">
              <div className="flex min-w-0 items-start gap-2.5 sm:flex-1 sm:items-center">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-black text-white sm:h-9 sm:w-9 sm:rounded-full" aria-label={`Queue position ${index + 1}`}>{index + 1}</span>
                <div className="min-w-0 flex-1"><p className="break-words text-sm font-extrabold leading-5 sm:text-base">{vehicle?.driver ?? 'Driver'}</p><p className="mt-0.5 break-all text-[0.7rem] text-text-secondary sm:text-xs">{vehicle?.vanId ?? 'Van'}</p><p className="mt-1 text-xs text-text-secondary">{vehicle?.capacity ?? 0} passenger seats</p></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border pt-3 sm:mt-0 sm:flex sm:shrink-0 sm:gap-1 sm:border-0 sm:pt-0">
                <Button className="gap-1 px-1.5 text-xs sm:w-11 sm:shrink-0 sm:gap-0 sm:px-0" size="sm" variant="ghost" disabled={index === 0} aria-label="Move up" onClick={() => move(index, -1)} leadingIcon={<ChevronUp className="h-4 w-4" aria-hidden="true" />}><span className="sm:hidden">Up</span></Button>
                <Button className="gap-1 px-1.5 text-xs sm:w-11 sm:shrink-0 sm:gap-0 sm:px-0" size="sm" variant="ghost" disabled={index === vehicleIds.length - 1} aria-label="Move down" onClick={() => move(index, 1)} leadingIcon={<ChevronDown className="h-4 w-4" aria-hidden="true" />}><span className="sm:hidden">Down</span></Button>
                <Button className="gap-1 px-1.5 text-xs sm:w-11 sm:shrink-0 sm:gap-0 sm:px-0" size="sm" variant="danger" aria-label={`Remove ${vehicle?.driver ?? 'driver'}`} onClick={() => setVehicleIds((current) => current.filter((id) => id !== vehicleId))} leadingIcon={<X className="hidden h-4 w-4 sm:block" aria-hidden="true" />}><span className="sm:hidden">Remove</span></Button>
              </div>
            </article>;
          })}</div> : <p className="mt-4 rounded-control border border-dashed border-border bg-surface px-3 py-8 text-center text-sm text-text-muted">No drivers are scheduled for {selectedWeekday.label}.</p>}
          <Button className="mt-4" fullWidth loading={saving} onClick={() => void save()} leadingIcon={<ShieldCheck className="h-4 w-4" />}>Save {selectedWeekday.label} queue order</Button>
        </section>
      </Card>
    </div>
  );
}

export function DispatcherSchedulesPage() {
  const { user } = useAuth();
  if (user?.dispatcherRoute === 'legazpi') return <DispatcherTayaSchedulesPage />;
  return <DispatcherGosoSchedulesPage />;
}

function DispatcherGosoSchedulesPage() {
  const toast = useToast();
  const [data, setData] = useState<ScheduleManagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [weeklyModalError, setWeeklyModalError] = useState<string | null>(null);
  const [editingWeekly, setEditingWeekly] = useState<WeeklyScheduleTemplate | null>(null);
  const [removingWeekly, setRemovingWeekly] = useState<WeeklyScheduleTemplate | null>(null);
  const [additionalScheduleWarning, setAdditionalScheduleWarning] = useState<WeeklyScheduleTemplate[]>([]);
  const [cancellingSchedule, setCancellingSchedule] = useState<ManagedSchedule | null>(null);
  const [selectedWeeklyDay, setSelectedWeeklyDay] = useState<number>(() => currentManilaWeekday());
  const [weeklyForm, setWeeklyForm] = useState<WeeklyScheduleForm>({
    weekday: '1',
    boardingTime: '08:00',
    departureTime: '08:10',
    vehicleId: '',
    fareAmount: '',
    isActive: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>('/dispatcher/schedules');
      setData(response.scheduleManagement);
    } catch (caught) {
      setError(message(caught, 'Departure schedules could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshSchedules() {
      try {
        const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>('/dispatcher/schedules');
        if (active) {
          setData(response.scheduleManagement);
          setError(null);
        }
      } catch (caught) {
        if (active) setError(message(caught, 'Departure schedules could not be loaded.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refreshSchedules();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSchedules();
    }, 8_000);
    const refreshOnFocus = () => void refreshSchedules();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, []);

  const weeklyTimeError = !weeklyForm.boardingTime || !weeklyForm.departureTime
    ? 'Choose both loading and departure times.'
    : weeklyForm.boardingTime >= weeklyForm.departureTime
      ? 'Loading must start before departure on the same day.'
      : null;

  function openWeeklyCreate(weekday = selectedWeeklyDay) {
    setEditingWeekly(null);
    setWeeklyForm({
      weekday: String(weekday),
      boardingTime: '08:00',
      departureTime: '08:10',
      vehicleId: data?.vehicles[0]?.id ?? '',
      fareAmount: data ? String(data.defaultFare) : '',
      isActive: true,
    });
    setAdditionalScheduleWarning([]);
    setWeeklyModalError(null);
    setWeeklyModalOpen(true);
  }

  function openWeeklyEdit(template: WeeklyScheduleTemplate) {
    setSelectedWeeklyDay(template.weekday);
    setEditingWeekly(template);
    setWeeklyForm({
      weekday: String(template.weekday),
      boardingTime: template.boardingTime,
      departureTime: template.departureTime,
      vehicleId: template.vehicle.id,
      fareAmount: String(template.fareAmount),
      isActive: template.isActive,
    });
    setAdditionalScheduleWarning([]);
    setWeeklyModalError(null);
    setWeeklyModalOpen(true);
  }

  function sameDaySchedulesForSelectedDriver() {
    if (!data) return [];
    const selectedVehicle = data.vehicles.find((vehicle) => vehicle.id === weeklyForm.vehicleId);
    if (!selectedVehicle?.driverId) return [];
    return data.weeklySchedules.filter((template) => (
      template.id !== editingWeekly?.id
      && template.weekday === Number(weeklyForm.weekday)
      && template.vehicle.driverId === selectedVehicle.driverId
    ));
  }

  async function saveWeeklySchedule(addAnotherForDriver = false) {
    if (weeklyTimeError) {
      setWeeklyModalError(weeklyTimeError);
      return;
    }
    const existingDriverSchedules = sameDaySchedulesForSelectedDriver();
    if (!addAnotherForDriver && existingDriverSchedules.length) {
      setAdditionalScheduleWarning(existingDriverSchedules);
      return;
    }
    setAdditionalScheduleWarning([]);
    setSaving(true);
    setWeeklyModalError(null);
    try {
      const body = {
        weekday: Number(weeklyForm.weekday),
        boardingTime: weeklyForm.boardingTime,
        departureTime: weeklyForm.departureTime,
        vehicleId: weeklyForm.vehicleId,
        fareAmount: Number(weeklyForm.fareAmount),
        isActive: weeklyForm.isActive,
      };
      const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>(
        editingWeekly ? `/dispatcher/weekly-schedules/${editingWeekly.id}` : '/dispatcher/weekly-schedules',
        { method: editingWeekly ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      setData(response.scheduleManagement);
      setSelectedWeeklyDay(Number(weeklyForm.weekday));
      setWeeklyModalOpen(false);
      toast.success(editingWeekly ? 'Weekly schedule updated.' : 'Weekly schedule created. Future departures were generated automatically.');
    } catch (caught) {
      setWeeklyModalError(message(caught, 'The weekly schedule could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleWeeklySchedule(template: WeeklyScheduleTemplate) {
    setSaving(true);
    try {
      const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>(`/dispatcher/weekly-schedules/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          weekday: template.weekday,
          boardingTime: template.boardingTime,
          departureTime: template.departureTime,
          vehicleId: template.vehicle.id,
          fareAmount: template.fareAmount,
          isActive: !template.isActive,
        }),
      });
      setData(response.scheduleManagement);
      toast.success(template.isActive ? 'Weekly schedule paused. Future unbooked departures were removed.' : 'Weekly schedule resumed. Future departures were generated.');
    } catch (caught) {
      setError(message(caught, 'The weekly schedule could not be changed.'));
    } finally {
      setSaving(false);
    }
  }

  async function removeWeeklySchedule() {
    if (!removingWeekly) return;
    setSaving(true);
    try {
      const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>(`/dispatcher/weekly-schedules/${removingWeekly.id}`, { method: 'DELETE' });
      setData(response.scheduleManagement);
      setRemovingWeekly(null);
      toast.success('Weekly schedule removed. Booked departures were preserved.');
    } catch (caught) {
      setError(message(caught, 'The weekly schedule could not be removed.'));
      setRemovingWeekly(null);
    } finally {
      setSaving(false);
    }
  }

  async function cancelAssignment() {
    const assignment = cancellingSchedule?.assignment;
    if (!assignment || assignment.status !== 'accepted') return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ scheduleManagement: ScheduleManagement }>(`/dispatcher/assignments/${assignment.id}/cancel`, { method: 'POST' });
      setData(response.scheduleManagement);
      setCancellingSchedule(null);
      toast.success(`Assignment cancelled for ${assignment.driver}.`);
    } catch (caught) {
      setError(message(caught, 'The assignment could not be cancelled.'));
      setCancellingSchedule(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) return <Card className="p-5"><LoadingSkeleton lines={8} /></Card>;
  if (!data) return <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Schedule management unavailable" description={error ?? 'Only the Goa dispatcher can manage fixed schedules.'} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />;
  const selectedWeekday = WEEKDAYS.find((day) => day.value === selectedWeeklyDay) ?? WEEKDAYS[0];
  const selectedDayTemplates = data.weeklySchedules.filter((template) => template.weekday === selectedWeekday.value);
  const assignmentResponseSchedules = data.schedules.filter((schedule) => schedule.assignment);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="hidden min-w-0 lg:block"><p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-primary sm:text-xs">Goso fixed-time operations</p><h2 className="mt-1 text-lg font-black sm:text-2xl">Goa departure schedules</h2></div>
        <Button className="w-full sm:w-auto" onClick={() => openWeeklyCreate()} disabled={!data.vehicles.length} leadingIcon={<CalendarDays className="h-4 w-4" />}>Set weekly schedule</Button>
      </div>
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      {!data.vehicles.length ? <Card className="border-warning/30 bg-warning-soft p-4 text-sm">Create an active Goa driver and van before adding a departure.</Card> : null}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between sm:pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold sm:text-lg">Fixed weekly timetable</h3>
              <StatusBadge tone="success">Repeats automatically</StatusBadge>
            </div>
            <details className="group mt-2 sm:hidden">
              <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">How weekly schedules work<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
              <p className="pb-2 text-xs leading-5 text-text-secondary">Configure Monday–Sunday once. UVGo keeps eight weeks of bookable departures ready and extends them every week until a rule is edited, paused, or removed.</p>
            </details>
            <p className="mt-1 hidden max-w-3xl text-sm leading-6 text-text-secondary sm:block">
              Configure Monday–Sunday once. UVGo keeps eight weeks of bookable departures ready and extends them every week until a rule is edited, paused, or removed.
            </p>
          </div>
          <Button className="hidden sm:inline-flex" size="sm" onClick={() => openWeeklyCreate()} disabled={!data.vehicles.length} leadingIcon={<Plus className="h-4 w-4" />}>Add weekly rule</Button>
        </div>
        <div className="-mx-1 mt-3 px-1 pb-2 sm:mt-4 sm:overflow-x-auto" role="tablist" aria-label="Weekly schedule days">
          <div className="grid grid-cols-7 gap-1 sm:flex sm:min-w-max sm:gap-2">
            {WEEKDAYS.map((day) => {
              const selected = day.value === selectedWeekday.value;
              const count = data.weeklySchedules.filter((template) => template.weekday === day.value).length;
              return (
                <button
                  key={day.value}
                  id={`weekly-day-tab-${day.value}`}
                  type="button"
                  role="tab"
                  aria-label={`${day.label}, ${count} rule${count === 1 ? '' : 's'}`}
                  aria-selected={selected}
                  aria-controls="weekly-day-panel"
                  onClick={() => setSelectedWeeklyDay(day.value)}
                  className={`min-h-touch min-w-0 rounded-control border px-0.5 py-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-w-[4.5rem] sm:shrink-0 sm:px-3 sm:text-left ${selected ? 'border-primary bg-primary text-text-inverse shadow-sm' : 'border-border bg-surface text-text-primary hover:border-primary/40 hover:bg-primary-soft'}`}
                >
                  <span className="block text-[0.65rem] font-extrabold sm:text-sm">{day.label.slice(0, 3)}</span>
                  <span className={`mt-0.5 block text-[0.7rem] font-semibold ${selected ? 'text-text-inverse/80' : 'text-text-muted'}`}>
                    {count}<span className="hidden sm:inline"> rule{count === 1 ? '' : 's'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <section
          id="weekly-day-panel"
          role="tabpanel"
          aria-labelledby={`weekly-day-tab-${selectedWeekday.value}`}
          className="mt-2 min-w-0 sm:rounded-control sm:border sm:border-border sm:bg-background/45 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="hidden text-xs font-bold uppercase tracking-[0.12em] text-primary sm:block">Selected day</p>
              <h4 className="text-base font-extrabold text-text-primary sm:mt-0.5 sm:text-lg">{selectedWeekday.label}</h4>
            </div>
            <Button className="px-3 sm:px-4" size="sm" variant="outline" onClick={() => openWeeklyCreate(selectedWeekday.value)} disabled={!data.vehicles.length} leadingIcon={<Plus className="h-4 w-4" />}><span className="sm:hidden">Add rule</span><span className="hidden sm:inline">Add {selectedWeekday.label}</span></Button>
          </div>
          {selectedDayTemplates.length ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {selectedDayTemplates.map((template) => (
                <article key={template.id} className="min-w-0 overflow-hidden rounded-control border border-border bg-surface p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2 sm:hidden">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><BusFront className="h-4 w-4" aria-hidden="true" /></span>
                      <div className="min-w-0"><p className="break-words text-sm font-extrabold leading-5">{template.vehicle.driver}</p><p className="mt-0.5 break-all text-[0.7rem] text-text-secondary">{template.vehicle.vanId}</p></div>
                    </div>
                    <div className="hidden min-w-0 sm:block">
                      <p className="text-[0.65rem] font-semibold text-text-secondary">Departure</p>
                      <p className="text-lg font-extrabold text-primary-dark">{formatClockTime12(template.departureTime)}</p>
                      <p className="mt-0.5 text-xs text-text-secondary">Loading <span className="font-semibold text-text-primary">{formatClockTime12(template.boardingTime)}</span></p>
                    </div>
                    <StatusBadge tone={template.isActive ? 'success' : 'neutral'}>{template.isActive ? 'Active' : 'Paused'}</StatusBadge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
                    <div className="min-w-0 rounded-lg bg-cream p-2.5"><dt className="text-[0.7rem] font-semibold text-text-secondary">Loading</dt><dd className="mt-1 whitespace-nowrap text-base font-bold leading-tight">{formatClockTime12(template.boardingTime)}</dd></div>
                    <div className="min-w-0 rounded-lg bg-primary-soft p-2.5 text-primary-dark"><dt className="text-[0.7rem] font-semibold">Departure</dt><dd className="mt-1 whitespace-nowrap text-base font-extrabold leading-tight">{formatClockTime12(template.departureTime)}</dd></div>
                  </dl>
                  <p className="mt-2 hidden break-all text-sm font-semibold sm:block">{template.vehicle.vanId}</p>
                  <p className="mt-0.5 hidden break-words text-xs text-text-secondary sm:block">{template.vehicle.driver}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:mt-2">
                    <div><p className="text-[0.7rem] text-text-secondary sm:hidden">Fare</p><p className="text-base font-extrabold text-primary-dark sm:text-xs sm:font-bold">₱{template.fareAmount.toFixed(2)}</p></div>
                    <span className="rounded-pill border border-border bg-cream px-2 py-1 text-[0.7rem] font-semibold text-text-secondary sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:text-xs sm:font-normal">{template.generatedCount} upcoming</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border pt-3 sm:grid-cols-2 sm:gap-2">
                    <Button className="gap-1 px-2 text-xs sm:gap-2 sm:px-4 sm:text-sm" size="sm" variant="outline" onClick={() => openWeeklyEdit(template)} leadingIcon={<Pencil className="hidden h-4 w-4 sm:block" />}>Edit</Button>
                    <Button className="gap-1 px-2 text-xs sm:gap-2 sm:px-4 sm:text-sm" size="sm" variant="ghost" disabled={saving} onClick={() => void toggleWeeklySchedule(template)} leadingIcon={template.isActive ? <Pause className="hidden h-4 w-4 sm:block" /> : <Play className="hidden h-4 w-4 sm:block" />}>{template.isActive ? 'Pause' : 'Resume'}</Button>
                    <Button size="sm" variant="danger" className="gap-1 px-2 text-xs sm:col-span-2 sm:gap-2 sm:px-4 sm:text-sm" onClick={() => setRemovingWeekly(template)} leadingIcon={<Trash2 className="hidden h-4 w-4 sm:block" />} aria-label="Remove weekly rule"><span className="sm:hidden">Remove</span><span className="hidden sm:inline">Remove rule</span></Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-control border border-dashed border-border bg-surface px-3 py-5 text-center text-sm text-text-muted">No fixed departure for {selectedWeekday.label}.</p>
          )}
        </section>
      </Card>
      <Card className="p-4 sm:p-5">
        <div className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-extrabold sm:text-lg">Driver assignments</h3><StatusBadge tone="info">This week</StatusBadge></div>
        </div>
        {assignmentResponseSchedules.length ? (
          <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-0 sm:divide-y sm:divide-border">
            {assignmentResponseSchedules.map((schedule) => (
              <article key={schedule.id} className="flex min-w-0 flex-col gap-3 rounded-control bg-cream p-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-none sm:bg-transparent sm:px-0 sm:py-4 sm:first:pt-0 sm:last:pb-0">
                <div className="min-w-0">
                  <p className="break-all text-sm font-extrabold text-text-primary sm:text-base">{schedule.vehicle.vanId}</p>
                  <p className="mt-0.5 break-words text-xs text-text-secondary sm:text-sm">{schedule.assignment?.driver}</p>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary sm:text-sm"><div className="flex flex-wrap gap-x-1"><dt>Loading</dt><dd className="font-semibold text-text-primary">{manilaDateTime(schedule.boardingStartTime)}</dd></div><div className="flex flex-wrap gap-x-1"><dt>Departure</dt><dd className="font-semibold text-text-primary">{manilaDateTime(schedule.departureTime)}</dd></div></dl>
                </div>
                <div className="dashboard-actions justify-between sm:justify-start">
                  <StatusBadge tone="success">Assigned</StatusBadge>
                  <Button className="px-3 text-xs sm:px-4 sm:text-sm" size="sm" variant="danger" onClick={() => setCancellingSchedule(schedule)} leadingIcon={<X className="h-4 w-4" />}>Cancel assignment</Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-control border border-dashed border-border px-3 py-5 text-center text-sm text-text-muted">No active driver assignments.</p>
        )}
      </Card>
      <ConfirmationDialog
        open={Boolean(cancellingSchedule)}
        title="Cancel this driver assignment?"
        description={cancellingSchedule?.assignment ? `${cancellingSchedule.assignment.driver} will lose this assignment. If the assignment is currently accepted, ${cancellingSchedule.vehicle.vanId} will also be removed from the active dispatcher queue and the remaining positions will be renumbered.` : ''}
        confirmLabel="Cancel assignment"
        destructive
        loading={saving}
        onClose={() => { if (!saving) setCancellingSchedule(null); }}
        onConfirm={() => void cancelAssignment()}
      />
      <Modal
        open={weeklyModalOpen}
        title={editingWeekly ? 'Edit weekly schedule' : 'Set weekly schedule'}
        description="Repeats every week until changed · Asia/Manila time."
        onClose={() => { if (!saving) { setAdditionalScheduleWarning([]); setWeeklyModalOpen(false); } }}
        className="max-w-lg p-4 sm:p-6 [&>footer]:flex-row [&>footer>.ui-button:last-child]:flex-1 sm:[&>footer>.ui-button:last-child]:flex-none"
        footer={<><Button variant="ghost" disabled={saving} onClick={() => { setAdditionalScheduleWarning([]); setWeeklyModalOpen(false); }}>Cancel</Button><Button loading={saving} disabled={!weeklyForm.vehicleId || Boolean(weeklyTimeError)} onClick={() => void saveWeeklySchedule()}>{editingWeekly ? 'Save weekly rule' : 'Start weekly schedule'}</Button></>}
      >
        <div className="space-y-4">
          {weeklyModalError ? <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft p-3 text-sm font-semibold text-danger">{weeklyModalError}</p> : null}
          <Select label="Day of week" value={weeklyForm.weekday} onChange={(event) => { setWeeklyForm({ ...weeklyForm, weekday: event.target.value }); setAdditionalScheduleWarning([]); setWeeklyModalError(null); }}>
            {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3 [&>div]:min-w-0">
            <Input className="min-w-0 px-2 sm:px-3" label="Loading time" type="time" value={weeklyForm.boardingTime} onChange={(event) => { setWeeklyForm({ ...weeklyForm, boardingTime: event.target.value }); setWeeklyModalError(null); }} required />
            <Input className="min-w-0 px-2 sm:px-3" label="Departure time" type="time" value={weeklyForm.departureTime} onChange={(event) => { setWeeklyForm({ ...weeklyForm, departureTime: event.target.value }); setWeeklyModalError(null); }} required />
          </div>
          {weeklyTimeError ? <p className="rounded-control bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">{weeklyTimeError}</p> : null}
          <Select label="Van and driver" value={weeklyForm.vehicleId} onChange={(event) => { setWeeklyForm({ ...weeklyForm, vehicleId: event.target.value }); setAdditionalScheduleWarning([]); setWeeklyModalError(null); }} hint="A driver may have multiple departures on the same weekday at different times.">
            <option value="">Choose a van and driver</option>
            {data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vanId} · {vehicle.driver}</option>)}
          </Select>
          <label className="flex min-h-touch cursor-pointer items-center justify-between gap-4 rounded-control border border-border px-3 py-2.5">
            <span><span className="block text-sm font-semibold text-text-primary">Active weekly rule</span><span className="block text-xs text-text-secondary">Paused rules do not generate new departures.</span></span>
            <input type="checkbox" checked={weeklyForm.isActive} onChange={(event) => setWeeklyForm({ ...weeklyForm, isActive: event.target.checked })} className="h-5 w-5 accent-primary" />
          </label>
          <details className="group rounded-control border border-border">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span>Fare</span>
              <span className="flex items-center gap-2 font-normal text-text-secondary">{fareLabel(weeklyForm.fareAmount)}<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></span>
            </summary>
            <div className="border-t border-border p-3">
              <Input label="Fare amount" type="number" min={1} step="0.01" value={weeklyForm.fareAmount} onChange={(event) => setWeeklyForm({ ...weeklyForm, fareAmount: event.target.value })} />
            </div>
          </details>
        </div>
      </Modal>
      <ConfirmationDialog
        open={additionalScheduleWarning.length > 0}
        title={`${additionalScheduleWarning[0]?.vehicle.driver ?? 'This driver'} already has a ${WEEKDAYS[Number(weeklyForm.weekday) - 1]?.label ?? 'same-day'} schedule`}
        description={`Existing departure${additionalScheduleWarning.length === 1 ? '' : 's'}: ${additionalScheduleWarning.map((template) => formatClockTime12(template.departureTime)).join(', ')}. Do you want to add one more schedule for the same driver at ${formatClockTime12(weeklyForm.departureTime)}?`}
        confirmLabel="Add another schedule"
        loading={saving}
        onClose={() => { if (!saving) setAdditionalScheduleWarning([]); }}
        onConfirm={() => void saveWeeklySchedule(true)}
      />
      <ConfirmationDialog open={Boolean(removingWeekly)} title="Remove this weekly schedule?" description={`${removingWeekly?.weekdayLabel ?? 'This day'} at ${removingWeekly ? formatClockTime12(removingWeekly.departureTime) : ''} will stop repeating. Future unbooked occurrences are removed; already-booked departures remain unchanged.`} confirmLabel="Remove weekly rule" destructive loading={saving} onClose={() => { if (!saving) setRemovingWeekly(null); }} onConfirm={() => void removeWeeklySchedule()} />
    </div>
  );
}
