'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { Button, Spinner, Alert } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { authService } from '@/services';
import type { AuthTokens } from '@/types';

// ── Schemas ───────────────────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

type LoginForm = z.infer<typeof loginSchema>;

// ── Brand mark: "The Care Thread" ─────────────────────────────
// One continuous stroke — the caregiver's path between homes.
// Inlined so the login screen has zero asset dependencies.
function WodogaMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#0D5C46" />
      <path
        d="M10 15 L15.6 31.4 Q16.6 34.2 17.8 31.5 L22.9 20.1 Q24 17.8 25.1 20.1 L30.2 31.5 Q31.4 34.2 32.4 31.4 L38 15"
        stroke="#FFFFFF" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════
// LOGIN PAGE — Design System v2 "The Care Thread"
// All auth logic (MFA flow, rate-limit / lockout / generic error
// modes) is preserved verbatim from the hardened implementation.
// ════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router    = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [step,      setStep]      = useState<'credentials' | 'mfa'>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [mfaCode,   setMfaCode]   = useState(['', '', '', '', '', '']);
  const [showPass,  setShowPass]  = useState(false);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);

  const mfaRefs = Array.from({ length: 6 }, () => useRef<HTMLInputElement>(null));

  // Already authenticated — redirect
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  // ── Step 1: Credentials ───────────────────────────────────
  const onSubmitCredentials = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    try {
      const res = await authService.login(data.email, data.password);

      if ('mfa_required' in res && res.mfa_required) {
        setTempToken(res.temp_token);
        setStep('mfa');
        setTimeout(() => mfaRefs[0].current?.focus(), 100);
        return;
      }

      // No MFA — full login
      const tokens = res as AuthTokens;
      if (tokens.user.role === 'patient') {
        setError('Patient accounts must use the patient portal to sign in.');
        return;
      }
      setAuth(tokens.user, tokens.access_token, tokens.refresh_token);
      toast.success(`Welcome back, ${tokens.user.first_name}!`);
      router.replace('/dashboard');
    } catch (err: any) {
      // Three distinct failure modes with distinct user actions:
      //   - rate_limited: too many attempts from this IP, wait and retry
      //   - account_locked: this specific account is locked, wait or use "Forgot password"
      //   - anything else: assume wrong credentials (don't leak whether email exists)
      if (err?.error === 'rate_limited') {
        setError('Too many login attempts from your network. Please wait a minute and try again.');
      } else if (err?.error === 'account_locked') {
        setError(err.message || 'This account is temporarily locked due to repeated failed attempts. Please wait a few minutes or use "Forgot password" to reset.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: MFA ───────────────────────────────────────────
  const onMFAInput = (idx: number, val: string) => {
    const digit = val.replace(/\D/, '').slice(-1);
    const next  = [...mfaCode];
    next[idx]   = digit;
    setMfaCode(next);
    if (digit && idx < 5) mfaRefs[idx + 1].current?.focus();
    if (next.every(d => d !== '')) submitMFA(next.join(''));
  };

  const onMFAKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !mfaCode[idx] && idx > 0) {
      mfaRefs[idx - 1].current?.focus();
    }
  };

  const submitMFA = async (code: string) => {
    setLoading(true);
    setError('');
    try {
      const tokens = await authService.verifyMFA(tempToken, code);
      if (tokens.user.role === 'patient') {
        setError('Patient accounts must use the patient portal to sign in.');
        return;
      }
      setAuth(tokens.user, tokens.access_token, tokens.refresh_token);
      toast.success(`Welcome back, ${tokens.user.first_name}!`);
      router.replace('/dashboard');
    } catch {
      setError('Invalid verification code. Please try again.');
      setMfaCode(['', '', '', '', '', '']);
      setTimeout(() => mfaRefs[0].current?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse 90% 70% at 12% 8%, rgba(43,163,126,0.14) 0%, transparent 55%), linear-gradient(160deg, #0A3D2F 0%, #0D5C46 100%)',
      }}
    >
      {/* Ambient care-thread — the signature element. Decorative only. */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-1/2 -translate-y-1/2 w-[140%] max-w-none opacity-[0.07]"
        viewBox="0 0 1200 400" fill="none"
      >
        <path
          d="M-40 120 L200 330 Q235 365 268 332 L430 170 Q460 140 490 170 L650 332 Q683 365 718 330 L960 120"
          stroke="#FFFFFF" strokeWidth="56" strokeLinecap="round" strokeLinejoin="round" fill="none"
        />
      </svg>

      {/* Split card */}
      <div className="relative w-full max-w-[880px] min-h-[560px] flex rounded-xl overflow-hidden shadow-xl">

        {/* ── Brand panel ── */}
        <div
          className="hidden md:flex flex-1 p-12 flex-col justify-between"
          style={{ background: 'rgba(255,255,255,0.045)', borderRight: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div>
            <div className="flex items-center gap-3.5 mb-12">
              <WodogaMark size={44} />
              <div>
                <div className="font-display text-[26px] font-bold text-white tracking-tight leading-none">Wodoga</div>
                <div className="text-[10px] text-white/45 uppercase tracking-[2.5px] mt-1.5">Clinical Platform</div>
              </div>
            </div>

            <h2 className="font-display text-[30px] font-semibold text-white leading-[1.2] tracking-tight mb-4">
              Built for care that happens
              <br />
              <span className="text-[#7FD4B5]">at the kitchen table.</span>
            </h2>
            <p className="text-white/55 text-sm leading-relaxed max-w-[340px]">
              The clinical platform for home health and pharmacy agencies —
              documentation, medications, and billing that fit the way your
              team actually works.
            </p>

            <div className="mt-9 flex flex-col gap-3">
              {[
                'Visit documentation in minutes, not evenings',
                'Allergy-checked prescribing with documented overrides',
                'Medication reconciliation & insurance eligibility',
                'OASIS-E assessments & claims in one place',
                'Role-based access with a full audit trail',
              ].map(f => (
                <div key={f} className="flex items-center gap-3 text-sm text-white/65">
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true" className="flex-shrink-0">
                    <path d="M1 2 L4.4 8 L7 3.5 L9.6 8 L13 2" stroke="#7FD4B5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-white/30 uppercase tracking-[1.5px]">
            Wodoga © 2026 · HIPAA-conscious by design
          </div>
        </div>

        {/* ── Form panel ── */}
        <div className="w-full md:w-[420px] bg-surface p-10 md:p-12 flex flex-col justify-center">

          {/* Mobile-only compact brand */}
          <div className="md:hidden flex items-center gap-3 mb-8">
            <WodogaMark size={36} />
            <span className="font-display text-xl font-bold text-ink tracking-tight">Wodoga</span>
          </div>

          {/* ── Step 1: Credentials ── */}
          {step === 'credentials' && (
            <>
              <h1 className="font-display text-[24px] font-semibold text-ink mb-1 tracking-tight">Sign in</h1>
              <p className="text-sm text-ink-3 mb-7">Secure access to your organization</p>

              {error && <Alert type="error" className="mb-4">{error}</Alert>}

              <form onSubmit={handleSubmit(onSubmitCredentials)} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="login-email" className="form-label">Email address</label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@organization.com"
                    className="form-input"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && <p className="text-xs text-red mt-1" role="alert">{errors.email.message}</p>}
                </div>

                <div>
                  <label htmlFor="login-password" className="form-label">Password</label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="form-input pr-10"
                      aria-invalid={!!errors.password}
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-red mt-1" role="alert">{errors.password.message}</p>}
                </div>

                <div className="flex justify-end -mt-1">
                  <a href="/forgot-password" className="text-xs text-forest hover:text-forest-mid hover:underline font-medium transition-colors">
                    Forgot password?
                  </a>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={loading}
                  className="w-full justify-center py-3 text-sm"
                >
                  Sign in
                </Button>
              </form>

              <div className="mt-7 flex items-center gap-2 justify-center text-xs text-ink-4">
                <Shield size={11} aria-hidden="true" />
                Protected by two-factor authentication
              </div>
            </>
          )}

          {/* ── Step 2: MFA ── */}
          {step === 'mfa' && (
            <>
              <div className="w-12 h-12 bg-forest-ghost border border-forest-pale rounded-lg flex items-center justify-center mb-5">
                <Shield size={20} className="text-forest" aria-hidden="true" />
              </div>
              <h1 className="font-display text-[24px] font-semibold text-ink mb-1 tracking-tight">
                Verify your identity
              </h1>
              <p className="text-sm text-ink-3 mb-7">
                Enter the 6-digit code from your authenticator app
              </p>

              {error && <Alert type="error" className="mb-4">{error}</Alert>}

              <div className="flex gap-2 justify-center mb-6" role="group" aria-label="6-digit verification code">
                {mfaCode.map((digit, i) => (
                  <input
                    key={i}
                    ref={mfaRefs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    aria-label={`Digit ${i + 1} of 6`}
                    onChange={e => onMFAInput(i, e.target.value)}
                    onKeyDown={e => onMFAKeyDown(i, e)}
                    className="w-11 h-14 text-center text-2xl font-mono font-medium
                               border border-surface-border rounded bg-surface text-ink
                               focus:outline-none focus:border-forest-mid focus:ring-2 focus:ring-forest-light/15
                               transition-colors"
                  />
                ))}
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-2 text-sm text-ink-3">
                  <Spinner size="sm" className="text-forest" />
                  Verifying...
                </div>
              )}

              <button
                onClick={() => { setStep('credentials'); setError(''); }}
                className="mt-4 text-sm text-ink-3 hover:text-ink text-center w-full transition-colors"
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
