'use client';
/**
 * Wodoga Platform — Account Settings
 * Lets the signed-in user view their account, change their password,
 * and set up two-factor authentication (MFA).
 *
 * Uses the existing backend endpoints through authService:
 *   - authService.changePassword(current, new)
 *   - authService.enableMFA()        → returns { secret, qr_uri, backup_codes }
 *   - authService.confirmMFA(code)   → turns MFA on after first code verified
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Shield, Lock, KeyRound, Check, Copy } from 'lucide-react';
import { Button, Alert, Avatar } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { authService } from '@/services';
import { ROLE_DISPLAY } from '@/utils';

export default function SettingsPage() {
  const { user } = useAuthStore();

  // ── Change Password state ──────────────────────────────────
  const {
    register: registerPw,
    handleSubmit: handlePwSubmit,
    reset: resetPw,
    watch: watchPw,
    formState: { errors: pwErrors },
  } = useForm<{ current: string; next: string; confirm: string }>();
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');

  const onChangePassword = async (data: { current: string; next: string; confirm: string }) => {
    setPwError('');
    if (data.next !== data.confirm) {
      setPwError('The new passwords do not match.');
      return;
    }
    setPwLoading(true);
    try {
      await authService.changePassword(data.current, data.next);
      toast.success('Password changed.');
      resetPw();
    } catch (err: any) {
      setPwError(
        err?.response?.data?.detail?.message ||
        err?.message ||
        'Could not change password. Check your current password and try again.'
      );
    } finally {
      setPwLoading(false);
    }
  };

  // ── MFA state ──────────────────────────────────────────────
  // Starts at 'idle' (the "set up" view). After the user completes setup
  // it moves to 'done'. We don't read mfa_enabled from the stored user
  // because that field isn't part of the login payload.
  const [mfaStep, setMfaStep] = useState<'idle' | 'setup' | 'done'>('idle');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirmCode, setConfirmCode] = useState('');

  const startMfaSetup = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      const res: any = await authService.enableMFA();
      setSecret(res.secret);
      setQrUri(res.qr_uri);
      setBackupCodes(res.backup_codes || []);
      setMfaStep('setup');
    } catch (err: any) {
      setMfaError(err?.message || 'Could not start MFA setup. Please try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  const confirmMfa = async () => {
    setMfaError('');
    if (confirmCode.length !== 6) {
      setMfaError('Enter the full 6-digit code from your authenticator app.');
      return;
    }
    setMfaLoading(true);
    try {
      await authService.confirmMFA(confirmCode);
      toast.success('Two-factor authentication is on.');
      setMfaStep('done');
      setConfirmCode('');
    } catch (err: any) {
      setMfaError(
        err?.response?.data?.detail?.message ||
        'That code did not match. Check your authenticator app and try again.'
      );
    } finally {
      setMfaLoading(false);
    }
  };

  // Builds a QR image URL from the otpauth URI the backend returns.
  const qrImageSrc = qrUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUri)}`
    : '';

  if (!user) return null;

  return (
    <>
      <div className="mb-6">
        <h1 className="page-title">Account Settings</h1>
        <p className="page-subtitle">Manage your password and account security</p>
      </div>

      {/* ── Account overview ── */}
      <div className="card mb-5">
        <div className="card-header"><div className="text-sm font-bold">Your Account</div></div>
        <div className="card-body">
          <div className="flex items-center gap-4">
            <Avatar firstName={user.first_name} lastName={user.last_name} size="lg" />
            <div>
              <div className="text-base font-bold text-ink">{user.first_name} {user.last_name}</div>
              <div className="text-sm text-ink-3">{user.email}</div>
              <div className="text-xs text-ink-4 uppercase tracking-wide mt-1">
                {ROLE_DISPLAY[user.role] || user.role}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* ── Change Password ── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Lock size={15} /> Change Password
            </div>
          </div>
          <div className="card-body space-y-3">
            {pwError && <Alert type="error">{pwError}</Alert>}
            <div>
              <label className="form-label">Current Password</label>
              <input type="password" className="form-input" autoComplete="current-password"
                {...registerPw('current', { required: true })} />
            </div>
            <div>
              <label className="form-label">New Password</label>
              <input type="password" className="form-input" autoComplete="new-password"
                {...registerPw('next', { required: true })} />
              {pwErrors.next && <p className="text-xs text-red mt-1">Required</p>}
            </div>
            <div>
              <label className="form-label">Confirm New Password</label>
              <input type="password" className="form-input" autoComplete="new-password"
                {...registerPw('confirm', { required: true })} />
            </div>
            <p className="text-xs text-ink-4">
              Use at least 10 characters, with a mix of upper and lower case,
              a number, and a symbol.
            </p>
            <Button variant="primary" className="w-full justify-center" loading={pwLoading}
              onClick={handlePwSubmit(onChangePassword)}>
              Change Password
            </Button>
          </div>
        </div>

        {/* ── Two-Factor Authentication ── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Shield size={15} /> Two-Factor Authentication
            </div>
            {mfaStep === 'done' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-forest">
                <Check size={13} /> On
              </span>
            )}
          </div>
          <div className="card-body space-y-3">
            {mfaError && <Alert type="error">{mfaError}</Alert>}

            {/* Idle — not set up yet */}
            {mfaStep === 'idle' && (
              <>
                <p className="text-sm text-ink-2">
                  Add a second layer of security. After your password, you'll
                  enter a 6-digit code from an app on your phone — so even if
                  your password is stolen, your account stays protected.
                </p>
                <p className="text-xs text-ink-4">
                  You'll need a free authenticator app: Google Authenticator,
                  Authy, or Microsoft Authenticator.
                </p>
                <Button variant="primary" className="w-full justify-center"
                  loading={mfaLoading} onClick={startMfaSetup}>
                  Set Up Two-Factor Authentication
                </Button>
              </>
            )}

            {/* Setup — show QR + confirm */}
            {mfaStep === 'setup' && (
              <>
                <p className="text-sm text-ink-2">
                  1. Open your authenticator app and scan this code:
                </p>
                <div className="flex justify-center py-2">
                  {qrImageSrc && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrImageSrc} alt="MFA QR code"
                      className="rounded border border-surface-border" width={200} height={200} />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-ink-4 mb-1">Can't scan? Enter this key manually:</p>
                  <code className="text-xs bg-bg px-2 py-1 rounded border border-surface-border break-all">
                    {secret}
                  </code>
                </div>

                {backupCodes.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 mb-1.5">
                      <KeyRound size={12} /> Save your backup codes
                    </div>
                    <p className="text-[11px] text-amber-700 mb-2">
                      Keep these somewhere safe. Each one lets you log in once
                      if you lose your phone.
                    </p>
                    <div className="grid grid-cols-2 gap-1 font-mono text-xs text-amber-900">
                      {backupCodes.map((c) => <div key={c}>{c}</div>)}
                    </div>
                  </div>
                )}

                <p className="text-sm text-ink-2 pt-1">
                  2. Enter the 6-digit code your app shows:
                </p>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="form-input text-center text-2xl font-mono tracking-[0.3em]"
                />
                <Button variant="primary" className="w-full justify-center"
                  loading={mfaLoading} onClick={confirmMfa}>
                  Turn On Two-Factor
                </Button>
                <button
                  onClick={() => { setMfaStep('idle'); setMfaError(''); setConfirmCode(''); }}
                  className="text-xs text-ink-3 hover:text-ink w-full text-center transition-colors">
                  Cancel
                </button>
              </>
            )}

            {/* Done */}
            {mfaStep === 'done' && (
              <div className="flex items-start gap-3 py-2">
                <div className="w-9 h-9 rounded-full bg-forest-ghost flex items-center justify-center shrink-0">
                  <Shield size={16} className="text-forest" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Your account is protected</p>
                  <p className="text-xs text-ink-3 mt-0.5">
                    You'll be asked for a code from your authenticator app each
                    time you sign in.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
