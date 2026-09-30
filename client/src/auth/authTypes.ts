export type UserRole = 'dispatcher' | 'driver' | 'passenger';
export type DispatcherRoute = 'goa' | 'legazpi';

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
  contact: string | null;
  email: string;
  emailVerified: boolean;
  dispatcherRoute: DispatcherRoute | null;
  redirectTo: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface GoogleLoginInput {
  credential: string;
}

export interface PassengerSignupInput {
  name: string;
  email: string;
  contact: string;
  password: string;
  confirmPassword: string;
}

export interface PassengerSignupResult {
  email: string;
  requiresEmailVerification: true;
  developmentCode?: string;
}

export interface EmailVerificationInput {
  email: string;
  code: string;
}

