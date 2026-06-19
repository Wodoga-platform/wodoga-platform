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

// ════════════════════════════════════════════════════════════
// LOGIN PAGE
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
      const msg = err?.message || 'Invalid email or password.';
      if (err?.error === 'account_locked') {
        setError(msg);
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
    <div className="min-h-screen bg-forest flex items-center justify-center p-4"
         style={{
           background: 'radial-gradient(ellipse 80% 60% at 10% 10%, rgba(64,145,108,0.18) 0%, transparent 60%), #1B4332',
         }}>

      {/* Split card */}
      <div className="w-full max-w-[860px] min-h-[540px] flex rounded-xl overflow-hidden shadow-xl">

        {/* ── Brand Panel ── */}
        <div className="flex-1 p-12 flex flex-col justify-between"
             style={{ background: 'rgba(255,255,255,0.05)', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            {/* Logo */}
            <div className="flex items-center gap-3 mb-10">
              <div className="w-12 h-12 bg-gradient-to-br from-forest-light to-forest-mid
                              rounded-xl flex items-center justify-center text-2xl shadow-lg">
                🌿
              </div>
              <div>
                <div className="font-display text-3xl font-bold text-white tracking-tight">Wodoga</div>
                <div className="text-[11px] text-white/50 uppercase tracking-[2px] mt-0.5">Clinical Platform</div>
              </div>
            </div>

            <h2 className="font-display text-[34px] font-semibold text-white leading-tight mb-4">
              Enterprise care,<br />
              <em className="text-forest-light not-italic">accessible pricing.</em>
            </h2>
            <p className="text-white/55 text-sm leading-relaxed max-w-[320px]">
              The complete home health &amp; pharmaceutical management platform
              built for clinics that deserve enterprise tools — without the price tag.
            </p>

            <div className="mt-8 flex flex-col gap-2.5">
              {[
                'HIPAA-conscious patient records',
                'Full care plan & SOAP documentation',
                'Medication reconciliation & eligibility',
                'Insurance claim management',
                'OASIS-E compliance reporting',
              ].map(f => (
                <div key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                  <div className="w-1.5 h-1.5 rounded-full bg-forest-light flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div className="text-[10px] text-white/25 uppercase tracking-wider">
            WODOGA © 2025 · HIPAA CONSCIOUS · SOC 2 READY
          </div>
        </div>

        {/* ── Form Panel ── */}
        <div className="w-[420px] bg-white p-12 flex flex-col justify-center">

          {/* ── Step 1: Credentials ── */}
          {step === 'credentials' && (
            <>
              <h1 className="font-display text-2xl font-semibold text-ink mb-1 tracking-tight">Sign in</h1>
              <p className="text-sm text-ink-3 mb-7">Secure access to your organization</p>

              {error && <Alert type="error" className="mb-4">{error}</Alert>}

              <form onSubmit={handleSubmit(onSubmitCredentials)} className="space-y-4">
                <div>
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@organization.com"
                    className="form-input"
                    {...register('email')}
                  />
                  {errors.email && <p className="text-xs text-red mt-1">{errors.email.message}</p>}
                </div>

                <div>
                  <label className="form-label">Password</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="form-input pr-10"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-red mt-1">{errors.password.message}</p>}
                </div>

                <div className="flex justify-end -mt-1">
                  <a href="/forgot-password" className="text-xs text-forest hover:underline font-medium">
                    Forgot password?
                  </a>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={loading}
                  className="w-full justify-center py-3 text-sm"
                >
                  Continue →
                </Button>
              </form>

              <div className="mt-6 flex items-center gap-2 justify-center text-xs text-ink-4">
                <Shield size={11} />
                Protected by two-factor authentication
              </div>
            </>
          )}

          {/* ── Step 2: MFA ── */}
          {step === 'mfa' && (
            <>
              <div className="w-12 h-12 bg-forest-ghost rounded-xl flex items-center justify-center
                              text-2xl mb-5">
                🔐
              </div>
              <h1 className="font-display text-2xl font-semibold text-ink mb-1 tracking-tight">
                Verify your identity
              </h1>
              <p className="text-sm text-ink-3 mb-7">
                Enter the 6-digit code from your authenticator app
              </p>

              {error && <Alert type="error" className="mb-4">{error}</Alert>}

              {/* 6-digit input */}
              <div className="flex gap-2 justify-center mb-6">
                {mfaCode.map((digit, i) => (
                  <input
                    key={i}
                    ref={mfaRefs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => onMFAInput(i, e.target.value)}
                    onKeyDown={e => onMFAKeyDown(i, e)}
                    className="w-11 h-14 text-center text-2xl font-mono font-medium
                               border border-surface-border rounded bg-bg text-ink
                               focus:outline-none focus:border-forest-light focus:ring-2 focus:ring-forest-light/10
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
