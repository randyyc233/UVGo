export type UserRole = 'dispatcher' | 'driver' | 'passenger';

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
  contact: string | null;
  email: string;
  redirectTo: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

