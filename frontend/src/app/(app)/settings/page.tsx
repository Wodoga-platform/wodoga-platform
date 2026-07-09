'use client';
/**
 * Wodoga Platform — Account Settings (corrected)
 * - Change password
 * - Two-factor: shows SET UP when off, DISABLE when on (reads real mfa_enabled)
 *
 * Backend endpoints used (all already exist):
 *   authService.changePassword(current, new)
 *   authService.enableMFA()           -> { secret, qr_uri, backup_codes }
 *   authService.confirmMFA(code)      -> turns MFA on
 *   authService.disableMFA(code, pw)  -> turns MFA off
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Shield, Lock, KeyRound, Check, ShieldOff } from 'lucide-react';
import { Button, Alert, Avatar } from '@/components/ui';
import { useAuthStore } from '@/store/auth.store';
import { authService } from '@/services';
import { ROLE_DISPLAY } from '@/utils';

export default function SettingsPage() {
  const { user, setAuth, accessToken, refreshToken } = useAuthStore();

  // ── Change Password ────────────────────────────────────────
  const {
    register: registerPw,
    handleSubmit: handlePwSubmit,
    reset: resetPw,
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

  // ── MFA status comes from the logged-in user ───────────────
  // After enabling/disabling we update the stored user so the UI
  // reflects reality without needing a re-login.
  const mfaOn = !!(user as any)?.mfa_enabled;

  const refreshStoredMfa = (value: boolean) => {
    if (user && accessToken && refreshToken) {
      setAuth({ ...(user as any), mfa_enabled: value }, accessToken, refreshToken);
    }
  };

  // ── Enable flow ────────────────────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirmCode, setConfirmCode] = useState('');

  const startSetup = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      const res: any = await authService.enableMFA();
      setSecret(res.secret);
      setQrUri(res.qr_uri);
      setBackupCodes(res.backup_codes || []);
      setSetupOpen(true);
    } catch (err: any) {
      setMfaError(err?.message || 'Could not start setup. Please try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  const confirmSetup = async () => {
    setMfaError('');
    if (confirmCode.length !== 6) {
      setMfaError('Enter the full 6-digit code from your authenticator app.');
      return;
    }
    setMfaLoading(true);
    try {
      await authService.confirmMFA(confirmCode);
      toast.success('Two-factor authentication is on.');
      setSetupOpen(false);
      setConfirmCode('');
      refreshStoredMfa(true);
    } catch (err: any) {
      setMfaError(
        err?.response?.data?.detail?.message ||
        'That code did not match. Check your app and try again.'
      );
    } finally {
      setMfaLoading(false);
    }
  };

  // ── Disable flow ───────────────────────────────────────────
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disablePw, setDisablePw] = useState('');

  const confirmDisable = async () => {
    setMfaError('');
    if (disableCode.length !== 6 || !disablePw) {
      setMfaError('Enter your current password and a 6-digit code to turn off two-factor.');
      return;
    }
    setMfaLoading(true);
    try {
      await authService.disableMFA(disableCode, disablePw);
      toast.success('Two-factor authentication turned off.');
      setDisableOpen(false);
      setDisableCode('');
      setDisablePw('');
      refreshStoredMfa(false);
    } catch (err: any) {
      setMfaError(
        err?.response?.data?.detail?.message ||
        'Could not turn off two-factor. Check your password and code.'
      );
    } finally {
      setMfaLoading(false);
    }
  };

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

      {/* Account overview */}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Change Password */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2 text-sm font-bold"><Lock size={15} /> Change Password</div>
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
              At least 10 characters, with upper and lower case, a number, and a symbol.
            </p>
            <Button variant="primary" className="w-full justify-center" loading={pwLoading}
              onClick={handlePwSubmit(onChangePassword)}>
              Change Password
            </Button>
          </div>
        </div>

        {/* Two-Factor */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2 text-sm font-bold"><Shield size={15} /> Two-Factor Authentication</div>
            {mfaOn && (
              <span className="flex items-center gap-1 text-xs font-semibold text-forest">
                <Check size={13} /> On
              </span>
            )}
          </div>
          <div className="card-body space-y-3">
            {mfaError && <Alert type="error">{mfaError}</Alert>}

            {/* ON, not editing → show status + Disable */}
            {mfaOn && !disableOpen && (
              <>
                <div className="flex items-start gap-3 py-1">
                  <div className="w-9 h-9 rounded-full bg-forest-ghost flex items-center justify-center shrink-0">
                    <Shield size={16} className="text-forest" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink">Your account is protected</p>
                    <p className="text-xs text-ink-3 mt-0.5">
                      You're asked for a code from your authenticator app each time you sign in.
                    </p>
                  </div>
                </div>
                <Button variant="secondary" className="w-full justify-center"
                  onClick={() => { setDisableOpen(true); setMfaError(''); }}>
                  <ShieldOff size={14} className="mr-1.5" /> Turn Off Two-Factor
                </Button>
              </>
            )}

            {/* ON, confirming disable */}
            {mfaOn && disableOpen && (
              <>
                <p className="text-sm text-ink-2">
                  To turn off two-factor, confirm your password and a current 6-digit code.
                </p>
                <div>
                  <label className="form-label">Current Password</label>
                  <input type="password" className="form-input" value={disablePw}
                    onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" />
                </div>
                <input inputMode="numeric" maxLength={6} value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="form-input text-center text-2xl font-mono tracking-[0.3em]" />
                <Button variant="danger" className="w-full justify-center" loading={mfaLoading}
                  onClick={confirmDisable}>
                  Turn Off Two-Factor
                </Button>
                <button onClick={() => { setDisableOpen(false); setMfaError(''); setDisableCode(''); setDisablePw(''); }}
                  className="text-xs text-ink-3 hover:text-ink w-full text-center transition-colors">
                  Cancel
                </button>
              </>
            )}

            {/* OFF, not setting up → show Set Up */}
            {!mfaOn && !setupOpen && (
              <>
                <p className="text-sm text-ink-2">
                  Add a second layer of security. After your password you'll enter a 6-digit code
                  from an app on your phone, so a stolen password isn't enough to get in.
                </p>
                <p className="text-xs text-ink-4">
                  You'll need a free authenticator app: Google Authenticator, Authy, or Microsoft Authenticator.
                </p>
                <Button variant="primary" className="w-full justify-center" loading={mfaLoading}
                  onClick={startSetup}>
                  Set Up Two-Factor Authentication
                </Button>
              </>
            )}

            {/* OFF, setting up */}
            {!mfaOn && setupOpen && (
              <>
                <p className="text-sm text-ink-2">1. Scan this with your authenticator app:</p>
                <div className="flex justify-center py-2">
                  {qrImageSrc && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrImageSrc} alt="MFA QR code"
                      className="rounded border border-surface-border" width={200} height={200} />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-ink-4 mb-1">Can't scan? Enter this key manually:</p>
                  <code className="text-xs bg-bg px-2 py-1 rounded border border-surface-border break-all">{secret}</code>
                </div>

                {backupCodes.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 mb-1.5">
                      <KeyRound size={12} /> Save your backup codes
                    </div>
                    <p className="text-[11px] text-amber-700 mb-2">
                      Keep these safe. Each lets you log in once if you lose your phone.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-xs text-amber-900">
                      {backupCodes.map((c) => <div key={c}>{c}</div>)}
                    </div>
                  </div>
                )}

                <p className="text-sm text-ink-2 pt-1">2. Enter the 6-digit code your app shows:</p>
                <input inputMode="numeric" maxLength={6} value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="form-input text-center text-2xl font-mono tracking-[0.3em]" />
                <Button variant="primary" className="w-full justify-center" loading={mfaLoading}
                  onClick={confirmSetup}>
                  Turn On Two-Factor
                </Button>
                <button onClick={() => { setSetupOpen(false); setMfaError(''); setConfirmCode(''); }}
                  className="text-xs text-ink-3 hover:text-ink w-full text-center transition-colors">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
