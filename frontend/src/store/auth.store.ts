/**
 * Wodoga Platform — Authentication Store
 * Zustand store with localStorage persistence.
 * Holds the current user, tokens, and permission checker.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthUser, Permission } from '@/types';

interface AuthState {
  user:         AuthUser | null;
  accessToken:  string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  // Actions
  setAuth:     (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens:   (accessToken: string, refreshToken: string) => void;
  signOut:     () => void;

  // Permission helper — checks against the token payload permissions
  hasPermission:    (permission: Permission) => boolean;
  hasAnyPermission: (...permissions: Permission[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user:            null,
      accessToken:     null,
      refreshToken:    null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      signOut: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),

      hasPermission: (permission) => {
        const user = get().user;
        if (!user) return false;
        return user.permissions.includes(permission);
      },

      hasAnyPermission: (...permissions) => {
        const user = get().user;
        if (!user) return false;
        return permissions.some((p) => user.permissions.includes(p));
      },
    }),
    {
      name:    'wodoga-auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist what's needed — never store sensitive data beyond tokens
      partialize: (state) => ({
        user:         state.user,
        accessToken:  state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
