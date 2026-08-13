import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ToastContext, type ToastApi, type ToastTone } from './toastContext';

interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

const toastStyles: Record<ToastTone, string> = {
  success: 'border-success/25 bg-success-soft text-success',
  info: 'border-info/25 bg-info-soft text-info',
  danger: 'border-danger/25 bg-danger-soft text-danger',
};

const toastIcons = {
  success: CheckCircle2,
  info: Info,
  danger: TriangleAlert,
};

function ToastItem({ toast, dismiss }: { toast: ToastMessage; dismiss: (id: string) => void }) {
  const Icon = toastIcons[toast.tone];
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 4_500);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id]);

  return (
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      className={cn('pointer-events-auto flex w-full items-start gap-3 rounded-card border p-4 shadow-floating sm:w-[22rem]', toastStyles[toast.tone])}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-semibold leading-5">{toast.message}</p>
      <button type="button" onClick={() => dismiss(toast.id)} className="-m-2 inline-flex min-h-touch min-w-touch items-center justify-center rounded-full" aria-label="Dismiss notification">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    setToasts((current) => [...current.slice(-2), { id: crypto.randomUUID(), message, tone }]);
  }, []);
  const value = useMemo<ToastApi>(() => ({
    show,
    success: (message) => show(message, 'success'),
    info: (message) => show(message, 'info'),
    error: (message) => show(message, 'danger'),
  }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-20 z-[70] flex flex-col items-end gap-3 sm:left-auto sm:right-5" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}
