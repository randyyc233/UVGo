import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'info' | 'danger';

export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider.');
  return context;
}
