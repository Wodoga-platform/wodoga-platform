'use client';
/**
 * Wodoga Platform — Forgot Password
 * Asks for an email, calls the backend to send a reset link.
 * The backend always responds the same way (whether or not the email
 * exists) so attackers can't discover which emails are registered.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Shield, ArrowLeft, MailCheck } from 'lucide-react';
import { Button, Alert } from '@/components/ui';
import { authService } from '@/services';

export default function ForgotPasswordPage() {
  const { register, handleSubmit, formState: { errors } } =
    useForm<{ email: string }>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (data: { email: string }) => {
    setError('');
    setLoading(true);
    try {
      await authService.forgotPassword(data.email);
      setSent(true);
    } catch (err: any) {
      // Even on error we show the same neutral success message,
      // to avoid revealing whether an email is registered.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Shield className="text-forest" size={26} />
          <span className="text-xl font-extrabold text-ink">Wodoga</span>
        </div>

        <div className="card">
          <div className="card-body space-y-4">
            {sent ? (
              <div className="text-center space-y-3 py-2">
                <div className="w-12 h-12 rounded-full bg-forest-ghost flex items-center justify-center mx-auto">
                  <MailCheck className="text-forest" size={22} />
                </div>
                <h1 className="text-lg font-bold text-ink">Check your email</h1>
                <p className="text-sm text-ink-2">
                  If an account exists for that address, we've sent a link to reset
                  your password. The link expires in 1 hour.
                </p>
                <p className="text-xs text-ink-4">
                  Don't see it? Check your spam folder.
                </p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <h1 className="text-lg font-bold text-ink">Forgot your password?</h1>
                  <p className="text-sm text-ink-2 mt-1">
                    Enter your email and we'll send you a reset link.
                  </p>
                </div>
                {error && <Alert type="error">{error}</Alert>}
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" className="form-input" autoComplete="email"
                    placeholder="you@example.com"
                    {...register('email', {
                      required: 'Email is required.',
                      pattern: { value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: 'Enter a valid email.' },
                    })} />
                  {errors.email && <p className="text-xs text-red mt-1">{errors.email.message}</p>}
                </div>
                <Button variant="primary" className="w-full justify-center" loading={loading}
                  onClick={handleSubmit(onSubmit)}>
                  Send Reset Link
                </Button>
              </>
            )}

            <Link href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-ink-3 hover:text-ink transition-colors pt-1">
              <ArrowLeft size={14} /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
