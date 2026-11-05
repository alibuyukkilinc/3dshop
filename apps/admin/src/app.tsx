import type { AdminMe, AdminSessionStage } from '@dtd/contracts';
import { useCallback, useEffect, useState } from 'react';
import { LoginPage } from './modules/auth/login-page';
import { MfaSetupPage, MfaVerifyPage, RecoveryCodesPage } from './modules/auth/mfa-pages';
import { AdminShell } from './modules/shell/admin-shell';
import { ApiError, api } from './shared/api';

type View =
  | { kind: 'loading' }
  | { kind: 'login'; notice?: string }
  | { kind: 'mfa_setup' }
  | { kind: 'mfa_verify' }
  | { kind: 'recovery'; codes: string[] }
  | { kind: 'home'; me: AdminMe };

/** Oturum durumuna göre ekran seçer. Sayfa yenilense de sunucudaki oturum aşaması korunur. */
export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      setView({ kind: 'home', me: await api<AdminMe>('/admin/v1/auth/me') });
    } catch (err) {
      const stage =
        err instanceof ApiError ? (err.body.stage as AdminSessionStage | undefined) : undefined;
      setView(
        stage === 'mfa_setup' || stage === 'mfa_verify' ? { kind: stage } : { kind: 'login' },
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const expired = useCallback(
    () =>
      setView({
        kind: 'login',
        notice: 'Doğrulama süresi doldu (10 dakika). Lütfen yeniden giriş yapın.',
      }),
    [],
  );

  switch (view.kind) {
    case 'loading':
      return <p className="p-8 text-sm text-muted">Yükleniyor…</p>;
    case 'login':
      return (
        <LoginPage
          key={view.notice ?? 'login'}
          notice={view.notice}
          onStage={(s) => (s === 'full' ? void refresh() : setView({ kind: s }))}
        />
      );
    case 'mfa_setup':
      return (
        <MfaSetupPage
          onExpired={expired}
          onVerified={(r) =>
            r.recovery_codes
              ? setView({ kind: 'recovery', codes: r.recovery_codes })
              : void refresh()
          }
        />
      );
    case 'mfa_verify':
      return <MfaVerifyPage onExpired={expired} onVerified={() => void refresh()} />;
    case 'recovery':
      return <RecoveryCodesPage codes={view.codes} onContinue={() => void refresh()} />;
    case 'home':
      return <AdminShell me={view.me} onLoggedOut={() => setView({ kind: 'login' })} />;
  }
}
