import { createContext, useContext } from 'react';
import type { AuthUser, EmailVerificationInput, GoogleLoginInput, LoginInput, PassengerSignupInput, PassengerSignupResult } from './authTypes';

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  googleLogin: (input: GoogleLoginInput) => Promise<AuthUser>;
  signupPassenger: (input: PassengerSignupInput) => Promise<PassengerSignupResult>;
  verifyEmail: (input: EmailVerificationInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}

