import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest } from '../api/http';
import type { AuthUser, EmailVerificationInput, GoogleLoginInput, LoginInput, PassengerSignupInput, PassengerSignupResult } from './authTypes';
import { AuthContext } from './authContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest<{ user: AuthUser }>('/auth/me');
      setUser(response.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void apiRequest<{ user: AuthUser }>('/auth/me')
      .then((response) => {
        if (active) setUser(response.user);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const response = await apiRequest<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setUser(response.user);
    return response.user;
  }, []);

  const googleLogin = useCallback(async (input: GoogleLoginInput) => {
    const response = await apiRequest<{ user: AuthUser }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setUser(response.user);
    return response.user;
  }, []);

  const signupPassenger = useCallback(async (input: PassengerSignupInput) => {
    return apiRequest<PassengerSignupResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }, []);

  const verifyEmail = useCallback(async (input: EmailVerificationInput) => {
    const response = await apiRequest<{ user: AuthUser }>('/auth/verification/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setUser(response.user);
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ message: string }>('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, googleLogin, signupPassenger, verifyEmail, logout, refresh }),
    [googleLogin, loading, login, logout, refresh, signupPassenger, user, verifyEmail],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

