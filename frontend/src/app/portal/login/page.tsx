'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { Button, Alert } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { authService } from '@/services';
import type { AuthTokens } from '@/types';

const schema = z.object({
  email:    z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
type Form = z.infer<typeof schema>;

export default function PortalLoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated, user } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [step, setStep]         = useState<'credentials'|'mfa'>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [mfaCode, setMfaCode]   = useState(['','','','','','']);
  const mfaRefs = Array.from({ length: 6 }, () => useRef<HTMLInputElement>(null));

  useEffect(() => {
    if (isAuthenticated && user?.role === 'patient') router.replace('/portal/dashboard');
  }, [isAuthenticated, user, router]);

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: Form) => {
    setLoading(true); setError('');
    try {
      const res = await authService.login(data.email, data.password);
      if ('mfa_required' in res && res.mfa_required) {
        setTempToken(res.temp_token); setStep('mfa');
        setTimeout(() => mfaRefs[0].current?.focus(), 100);
        return;
      }
      const tokens = res as AuthTokens;
      if (tokens.user.role !== 'patient') {
        setError('This portal is for patients only. Please use the staff login.');
        return;
      }
      setAuth(tokens.user, tokens.access_token, tokens.refresh_token);
      toast.success(`Welcome, ${tokens.user.first_name}!`);
      router.replace('/portal/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Invalid email or password.');
    } finally { setLoading(false); }
  };

  const onMFAInput = (idx: number, val: string) => {
    const digit = val.replace(/\D/,'').slice(-1);
    const next = [...mfaCode]; next[idx] = digit; setMfaCode(next);
    if (digit && idx < 5) mfaRefs[idx+1].current?.focus();
    if (next.every(d => d !== '')) submitMFA(next.join(''));
  };

  const submitMFA = async (code: string) => {
    setLoading(true); setError('');
    try {
      const tokens = await authService.verifyMFA(tempToken, code);
      setAuth(tokens.user, tokens.access_token, tokens.refresh_token);
      toast.success(`Welcome, ${tokens.user.first_name}!`);
      router.replace('/portal/dashboard');
    } catch {
      setError('Invalid code. Please try again.');
      setMfaCode(['','','','','','']);
      setTimeout(() => mfaRefs[0].current?.focus(), 100);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-forest flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse 80% 60% at 10% 10%, rgba(64,145,108,0.18) 0%, transparent 60%), #1B4332' }}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-8 pb-6 bg-forest text-center">
          <div className="w-14 h-14 bg-forest-light rounded-xl flex items-center justify-center text-2xl mx-auto mb-3">🌿</div>
          <div className="font-display text-2xl font-bold text-white">Wodoga</div>
          <div className="text-xs text-white/50 uppercase tracking-widest mt-1">Patient Portal</div>
        </div>
        <div className="p-8">
          {step === 'credentials' && (
            <>
              <h1 className="font-display text-xl font-semibold text-ink mb-1">Patient Sign In</h1>
              <p className="text-sm text-ink-3 mb-6">Access your care plan, visits, and messages</p>
              {error && <Alert type="error" className="mb-4">{error}</Alert>}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="form-label">Email Address</label>
                  <input type="email" className="form-input" placeholder="your@email.com" autoComplete="email" {...register('email')} />
                  {errors.email && <p className="text-xs text-red mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} className="form-input pr-10" placeholder="••••••••" autoComplete="current-password" {...register('password')} />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink">
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <Button type="submit" variant="primary" loading={loading} className="w-full justify-center py-3">Sign In →</Button>
              </form>
              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-ink-4">
                <Shield size={11} /> Your health information is encrypted and private
              </div>
            </>
          )}
          {step === 'mfa' && (
            <>
              <div className="text-3xl mb-4 text-center">🔐</div>
              <h1 className="font-display text-xl font-semibold text-ink mb-1 text-center">Verify your identity</h1>
              <p className="text-sm text-ink-3 mb-6 text-center">Enter the 6-digit code from your authenticator app</p>
              {error && <Alert type="error" className="mb-4">{error}</Alert>}
              <div className="flex gap-2 justify-center mb-5">
                {mfaCode.map((digit, i) => (
                  <input key={i} ref={mfaRefs[i]} type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={e => onMFAInput(i, e.target.value)}
                    onKeyDown={e => e.key==='Backspace'&&!mfaCode[i]&&i>0&&mfaRefs[i-1].current?.focus()}
                    className="w-11 h-14 text-center text-2xl font-mono font-medium border border-surface-border rounded bg-bg text-ink focus:outline-none focus:border-forest-light focus:ring-2 focus:ring-forest-light/10 transition-colors" />
                ))}
              </div>
              <button onClick={() => { setStep('credentials'); setError(''); }} className="text-sm text-ink-3 hover:text-ink text-center w-full transition-colors">← Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
