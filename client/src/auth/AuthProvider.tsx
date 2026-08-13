import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest } from '../api/http';
import type { AuthUser, LoginInput } from './authTypes';
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

  const logout = useCallback(async () => {
    try {
      await apiRequest<{ message: string }>('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [loading, login, logout, refresh, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

