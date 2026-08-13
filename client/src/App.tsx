import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppShell, PublicShell, type AppRole } from './components/layout';
import { PublicLandingPage } from './pages/public/PublicLandingPage';
import { RoleFoundationPage } from './pages/phase2/RoleFoundationPage';
import { ProtectedRoute, RoleRedirect } from './auth/ProtectedRoute';
import { useAuth } from './auth/authContext';
import { LoginPage } from './pages/auth/LoginPage';
import { PassengerBookingPage } from './pages/passenger/PassengerBookingPage';
import {
  BookingDetailsPage,
  MyBookingsPage,
  PassengerHomePage,
  PassengerNotificationsPage,
  PassengerStatusPage,
} from './pages/passenger/PassengerPortalPages';
import {
  DriverAssignmentPage,
  DriverDashboardPage,
  DriverMorePage,
  DriverQueuePage,
  DriverSetupPage,
  DriverTripPage,
} from './pages/driver/DriverPages';

const dispatcherPages = () => import('./pages/dispatcher/DispatcherPages');
const DispatcherDashboardPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherDashboardPage }));
const DispatcherFleetPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherFleetPage }));
const DispatcherQueuePage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherQueuePage }));
const DispatcherPaymentsPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherPaymentsPage }));
const DispatcherLogsPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherLogsPage }));
const DispatcherMorePage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherMorePage }));

const userNames: Record<AppRole, string> = {
  passenger: 'Ana Reyes',
  driver: 'Rodel Reyes',
  dispatcher: 'Juan Dela Cruz',
};

const roleTitles: Record<AppRole, string> = {
  passenger: 'Passenger Home',
  driver: 'Driver Dashboard',
  dispatcher: 'Dispatcher Dashboard',
};

function RolePreviewRoute({ role }: { role: AppRole }) {
  const { user } = useAuth();
  return (
    <AppShell role={role} title={roleTitles[role]} userName={user?.name ?? userNames[role]}>
      <RoleFoundationPage role={role} />
    </AppShell>
  );
}

function PassengerPortalRoute({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return <AppShell role="passenger" title={title} userName={user?.name ?? userNames.passenger}>{children}</AppShell>;
}

function DriverPortalRoute({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return <AppShell role="driver" title={title} userName={user?.name ?? userNames.driver}>{children}</AppShell>;
}

function DispatcherPortalRoute({ title, children, hideMobileHeading = false }: { title: string; children: ReactNode; hideMobileHeading?: boolean }) {
  const { user } = useAuth();
  return <AppShell role="dispatcher" title={title} userName={user?.name ?? userNames.dispatcher} hideMobileHeading={hideMobileHeading}>{children}</AppShell>;
}

export function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background font-bold text-primary">Loading UVGo…</div>}>
      <Routes>
      <Route
        path="/"
        element={
          <PublicShell>
            <PublicLandingPage />
          </PublicShell>
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<RoleRedirect />} />
      <Route path="/passenger/book" element={<ProtectedRoute role="passenger"><PublicShell><PassengerBookingPage /></PublicShell></ProtectedRoute>} />
      <Route path="/passenger/home" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Passenger Home"><PassengerHomePage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/bookings" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="My Bookings"><MyBookingsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/bookings/:reference" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Booking Details"><BookingDetailsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/status" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Booking Status"><PassengerStatusPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/notifications" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Notifications"><PassengerNotificationsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/profile" element={<ProtectedRoute role="passenger"><RolePreviewRoute role="passenger" /></ProtectedRoute>} />
      <Route path="/passenger/*" element={<Navigate to="/passenger/home" replace />} />
      <Route path="/driver/setup" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Setup"><DriverSetupPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/dashboard" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Dashboard"><DriverDashboardPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/assignment" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Trip Assignment"><DriverAssignmentPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/queue" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Queue"><DriverQueuePage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/trip" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Trip Progress"><DriverTripPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/more" element={<ProtectedRoute role="driver"><DriverPortalRoute title="More"><DriverMorePage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/*" element={<Navigate to="/driver/dashboard" replace />} />
      <Route path="/dispatcher/dashboard" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Dispatcher Dashboard"><DispatcherDashboardPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/fleet" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Fleet Map" hideMobileHeading><DispatcherFleetPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/queue" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Queue Management"><DispatcherQueuePage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/payments" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Payment Verification"><DispatcherPaymentsPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/logs" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Reports & Logs"><DispatcherLogsPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/more" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="More"><DispatcherMorePage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/dispatch" element={<Navigate to="/dispatcher/queue" replace />} />
      <Route path="/dispatcher/alerts" element={<Navigate to="/dispatcher/dashboard" replace />} />
      <Route path="/dispatcher/settings" element={<Navigate to="/dispatcher/more" replace />} />
      <Route path="/dispatcher/*" element={<Navigate to="/dispatcher/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
