/**
 * Wodoga Platform — API Client
 * Axios instance with automatic JWT injection,
 * token refresh on 401, and structured error handling.
 */

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { useAuthStore } from '@/store/auth.store';
import type { ApiError } from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ── Axios Instance ────────────────────────────────────────────
export const apiClient: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// ── Request Interceptor: Inject Bearer Token ──────────────────
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Add a unique request ID for correlation
    config.headers['X-Request-ID'] = crypto.randomUUID();
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response Interceptor: Handle 401 & Refresh ───────────────
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // ── Token expired — attempt refresh ──────────────────────
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      useAuthStore.getState().refreshToken
    ) {
      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        const response = await axios.post(`${BASE_URL}/api/v1/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token: newRefreshToken } = response.data;
        useAuthStore.getState().setTokens(access_token, newRefreshToken);
        onTokenRefreshed(access_token);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed — sign out
        useAuthStore.getState().signOut();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // ── Structure the error for consistent handling ───────────
    // 429 responses from slowapi come as plain text, not JSON, so detect
    // them by status code and synthesize the structured shape.
    if (error.response?.status === 429) {
      return Promise.reject({
        error: 'rate_limited',
        message: 'Too many login attempts from your network. Please wait a minute and try again.',
      } as ApiError);
    }
    const apiError: ApiError = error.response?.data || {
      error: 'network_error',
      message: 'Network error. Please check your connection.',
    };
    return Promise.reject(apiError);
  },
);

// ── Typed Request Helpers ─────────────────────────────────────
export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await apiClient.get<{ data: T }>(url, { params });
  return res.data.data ?? (res.data as unknown as T);
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<{ data: T }>(url, body);
  return res.data.data ?? (res.data as unknown as T);
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiClient.patch<{ data: T }>(url, body);
  return res.data.data ?? (res.data as unknown as T);
}

export async function del(url: string): Promise<void> {
  await apiClient.delete(url);
}

export default apiClient;
