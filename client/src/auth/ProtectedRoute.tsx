import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingSkeleton } from '../components/ui';
import { useAuth } from './authContext';
import type { UserRole } from './authTypes';

interface ProtectedRouteProps {
  role: UserRole;
  children: ReactNode;
}

export function ProtectedRoute({ role, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-card">
          <LoadingSkeleton lines={4} />
        </div>
      </main>
    );
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={user.redirectTo} replace />;

  return children;
}

export function RoleRedirect() {
  const { user, loading } = useAuth();

  if (loading) return null;
  return <Navigate to={user?.redirectTo ?? '/login'} replace />;
}
