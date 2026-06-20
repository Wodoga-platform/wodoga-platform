'use client';
/**
 * Wodoga Platform — Reset Password
 * Reached from the link in the password-reset email:
 *   /reset-password?token=XXXX
 *
 * Next.js requires useSearchParams() to be inside a <Suspense> boundary,
 * so the form lives in an inner component and the page wraps it.
 */

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Shield, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { Button, Alert } from '@/components/ui';
import { authService } from '@/services';

// ── Inner form (uses the URL token) ───────────────────────────
function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const { register, handleSubmit, formState: { errors } } =
    useForm<{ next: string; confirm: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const [missingToken, setMissingToken] = useState(false);
  useEffect(() => {
    if (!token) setMissingToken(true);
  }, [token]);

  const onSubmit = async (data: { next: string; confirm: string }) => {
    setError('');
    if (data.next !== data.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await authService.resetPassword(token, data.next);
      setDone(true);
      toast.success('Password reset.');
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      let msg: string;
      if (Array.isArray(detail)) {
        // 422 validation error from Pydantic — extract the actual message
        msg = detail[0]?.msg?.replace('Value error, ', '') || 'Password does not meet requirements.';
      } else if (detail?.message) {
        msg = detail.message;
      } else {
        msg = err?.message || 'This reset link is invalid or expired. Please request a new one.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="text-center space-y-3 py-2">
        <div className="w-12 h-12 rounded-full bg-forest-ghost flex items-center justify-center mx-auto">
          <CheckCircle2 className="text-forest" size={22} />
        </div>
        <h1 className="text-lg font-bold text-ink">Password reset</h1>
        <p className="text-sm text-ink-2">
          Your password has been changed. Taking you to sign in…
        </p>
      </div>
    );
  }

  if (missingToken) {
    return (
      <div className="text-center space-y-3 py-2">
        <h1 className="text-lg font-bold text-ink">Link not valid</h1>
        <p className="text-sm text-ink-2">
          This reset link is missing or incomplete. Please request a new one.
        </p>
        <Link href="/forgot-password"
          className="text-sm text-forest font-semibold hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-lg font-bold text-ink">Choose a new password</h1>
        <p className="text-sm text-ink-2 mt-1">Enter and confirm your new password.</p>
      </div>
      {error && <Alert type="error">{error}</Alert>}

      <div>
        <label className="form-label">New Password</label>
        <div className="relative">
          <input type={showPass ? 'text' : 'password'} className="form-input pr-10"
            autoComplete="new-password"
            {...register('next', {
              required: 'Password is required.',
              minLength: { value: 10, message: 'At least 10 characters.' },
            })} />
          <button type="button" onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.next && <p className="text-xs text-red mt-1">{errors.next.message}</p>}
      </div>

      <div>
        <label className="form-label">Confirm New Password</label>
        <input type="password" className="form-input" autoComplete="new-password"
          {...register('confirm', { required: 'Please confirm your password.' })} />
        {errors.confirm && <p className="text-xs text-red mt-1">{errors.confirm.message}</p>}
      </div>

      <p className="text-xs text-ink-4">
        Use at least 10 characters, with upper and lower case, a number, and a symbol.
      </p>

      <Button variant="primary" className="w-full justify-center" loading={loading}
        onClick={handleSubmit(onSubmit)}>
        Reset Password
      </Button>

      <Link href="/login"
        className="block text-center text-sm text-ink-3 hover:text-ink transition-colors pt-1">
        Back to sign in
      </Link>
    </>
  );
}

// ── Page shell (wraps the form in Suspense) ───────────────────
export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Shield className="text-forest" size={26} />
          <span className="text-xl font-extrabold text-ink">Wodoga</span>
        </div>
        <div className="card">
          <div className="card-body space-y-4">
            <Suspense fallback={<p className="text-sm text-ink-3 text-center py-4">Loading…</p>}>
              <ResetForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
