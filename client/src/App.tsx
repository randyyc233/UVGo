import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppShell, PublicShell, type AppRole } from './components/layout';
import { PublicLandingPage } from './pages/public/PublicLandingPage';
import { ProtectedRoute, RoleRedirect } from './auth/ProtectedRoute';
import { useAuth } from './auth/authContext';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { PassengerBookingPage } from './pages/passenger/PassengerBookingPage';
import { PassengerProfilePage } from './pages/passenger/PassengerProfilePage';
import {
  BookingDetailsPage,
  MyBookingsPage,
  PassengerHomePage,
  PassengerNotificationsPage,
} from './pages/passenger/PassengerPortalPages';
import {
  DriverAssignmentPage,
  DriverDashboardPage,
  DriverMorePage,
  DriverNotificationsPage,
  DriverQueuePage,
  DriverSetupPage,
  DriverTripPage,
} from './pages/driver/DriverPages';
import { useDriverLocationTracking } from './hooks/useDriverLocationTracking';

const DriverProfilePage = lazy(async () => ({ default: (await import('./pages/driver/DriverProfilePage')).DriverProfilePage }));

const dispatcherPages = () => import('./pages/dispatcher/DispatcherPages');
const DispatcherDashboardPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherDashboardPage }));
const DispatcherFleetPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherFleetPage }));
const DispatcherQueuePage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherQueuePage }));
const DispatcherDepartureHistoryPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherDepartureHistoryPage }));
const DispatcherPaymentsPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherPaymentsPage }));
const DispatcherAlertsPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherAlertsPage }));
const DispatcherLogsPage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherLogsPage }));
const DispatcherMorePage = lazy(async () => ({ default: (await dispatcherPages()).DispatcherMorePage }));
const DispatcherProfilePage = lazy(async () => ({ default: (await import('./pages/dispatcher/DispatcherProfilePage')).DispatcherProfilePage }));
const dispatcherManagementPages = () => import('./pages/dispatcher/DispatcherManagementPages');
const DispatcherDriversPage = lazy(async () => ({ default: (await dispatcherManagementPages()).DispatcherDriversPage }));
const DispatcherSchedulesPage = lazy(async () => ({ default: (await dispatcherManagementPages()).DispatcherSchedulesPage }));

const userNames: Record<AppRole, string> = {
  passenger: 'Ana Reyes',
  driver: 'Rodel Reyes',
  dispatcher: 'Juan Dela Cruz',
};

function PassengerPortalRoute({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return <AppShell role="passenger" title={title} userName={user?.name ?? userNames.passenger}>{children}</AppShell>;
}

function DriverPortalRoute({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  useDriverLocationTracking();
  return <AppShell role="driver" title={title} userName={user?.name ?? userNames.driver}>{children}</AppShell>;
}

function DispatcherPortalRoute({ title, children, hideMobileHeading = false }: { title: string; children: ReactNode; hideMobileHeading?: boolean }) {
  const { user } = useAuth();
  const routeName = user?.dispatcherRoute === 'legazpi' ? 'Legazpi' : 'Goa';
  return <AppShell role="dispatcher" title={`${routeName} ${title}`} userName={user?.name ?? userNames.dispatcher} hideMobileHeading={hideMobileHeading}>{children}</AppShell>;
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
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/app" element={<RoleRedirect />} />
      <Route path="/passenger/book" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Book a Ride"><PassengerBookingPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/home" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Passenger Home"><PassengerHomePage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/bookings" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="My Bookings"><MyBookingsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/bookings/:reference" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Booking Details"><BookingDetailsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/status" element={<ProtectedRoute role="passenger"><Navigate to="/passenger/bookings" replace /></ProtectedRoute>} />
      <Route path="/passenger/notifications" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Notifications"><PassengerNotificationsPage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/profile" element={<ProtectedRoute role="passenger"><PassengerPortalRoute title="Profile"><PassengerProfilePage /></PassengerPortalRoute></ProtectedRoute>} />
      <Route path="/passenger/*" element={<Navigate to="/passenger/home" replace />} />
      <Route path="/driver/setup" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Setup"><DriverSetupPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/dashboard" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Dashboard"><DriverDashboardPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/notifications" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Notifications"><DriverNotificationsPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/assignment" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Trip Assignment"><DriverAssignmentPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/queue" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Driver Queue"><DriverQueuePage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/trip" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Trip Progress"><DriverTripPage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/profile" element={<ProtectedRoute role="driver"><DriverPortalRoute title="Profile"><DriverProfilePage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/more" element={<ProtectedRoute role="driver"><DriverPortalRoute title="More"><DriverMorePage /></DriverPortalRoute></ProtectedRoute>} />
      <Route path="/driver/*" element={<Navigate to="/driver/dashboard" replace />} />
      <Route path="/dispatcher/dashboard" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Dispatcher Dashboard"><DispatcherDashboardPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/fleet" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Fleet Map" hideMobileHeading><DispatcherFleetPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/queue" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Queue Management"><DispatcherQueuePage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/departure-history" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Departure History"><DispatcherDepartureHistoryPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/payments" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Payment Verification"><DispatcherPaymentsPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/logs" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Reports & Logs"><DispatcherLogsPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/drivers" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Drivers & Vehicles"><DispatcherDriversPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/schedules" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Schedule Management"><DispatcherSchedulesPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/profile" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Profile"><DispatcherProfilePage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/more" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="More"><DispatcherMorePage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/dispatch" element={<Navigate to="/dispatcher/queue" replace />} />
      <Route path="/dispatcher/alerts" element={<ProtectedRoute role="dispatcher"><DispatcherPortalRoute title="Alerts"><DispatcherAlertsPage /></DispatcherPortalRoute></ProtectedRoute>} />
      <Route path="/dispatcher/settings" element={<Navigate to="/dispatcher/profile" replace />} />
      <Route path="/dispatcher/*" element={<Navigate to="/dispatcher/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
