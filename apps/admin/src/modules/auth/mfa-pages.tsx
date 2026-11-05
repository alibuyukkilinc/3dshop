import type { MfaSetupResult, MfaVerifyResult } from '@dtd/contracts';
import { Check, Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { Alert, AuthCard, Button, Field } from '../../shared/ui';

/** Parola sonrası ara oturum 10 dakikada dolar; dolunca sunucu "unauthenticated" döner. */
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && err.code === 'unauthenticated';
}

function useVerify(onVerified: (r: MfaVerifyResult) => void, onExpired: () => void) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onVerified(await api<MfaVerifyResult>('/admin/v1/auth/mfa/verify', { method: 'POST', body: { code } }));
    } catch (err) {
      if (isSessionExpired(err)) return onExpired();
      setError(err instanceof ApiError ? err.message : 'Doğrulama yapılamadı.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }
  return { code, setCode, error, busy, submit };
}

/** İlk giriş: 2FA kurulumu zorunlu. QR kod tarayıcıda üretilir; sır hiçbir dış servise gitmez. */
interface MfaPageProps {
  onVerified: (r: MfaVerifyResult) => void;
  /** Ara oturumun süresi doldu: giriş ekranına dönülür */
  onExpired: () => void;
}

export function MfaSetupPage({ onVerified, onExpired }: MfaPageProps) {
  const [setup, setSetup] = useState<MfaSetupResult | null>(null);
  const [qr, setQr] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const started = useRef(false);
  const v = useVerify(onVerified, onExpired);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<MfaSetupResult>('/admin/v1/auth/mfa/setup', { method: 'POST' })
      .then(async (s) => {
        setSetup(s);
        setQr(await QRCode.toString(s.otpauth_url, { type: 'svg', margin: 1, width: 192 }));
      })
      .catch((err) => {
        if (isSessionExpired(err)) return onExpired();
        setLoadError(err instanceof ApiError ? err.message : 'Kurulum başlatılamadı.');
      });
  }, [onExpired]);

  return (
    <AuthCard
      title="İki adımlı doğrulamayı kurun"
      subtitle="Authenticator uygulamanızla (Google Authenticator, Microsoft Authenticator, 1Password…) QR kodu okutun."
    >
      {loadError && <Alert>{loadError}</Alert>}
      {setup && (
        <form onSubmit={v.submit} className="space-y-4" noValidate>
          <div
            className="mx-auto w-48 rounded-md bg-white p-2"
            role="img"
            aria-label="İki adımlı doğrulama QR kodu"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">QR okutamıyorum, kodu elle gireceğim</summary>
            <code className="mt-2 block rounded bg-surface-2 p-2 font-mono text-xs break-all select-all">
              {setup.secret}
            </code>
          </details>
          {v.error && <Alert>{v.error}</Alert>}
          <Field
            label="Uygulamadaki 6 haneli kod"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={v.code}
            onChange={(e) => v.setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button type="submit" className="w-full" busy={v.busy} disabled={v.code.length !== 6}>
            Doğrula ve etkinleştir
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function MfaVerifyPage({ onVerified, onExpired }: MfaPageProps) {
  const v = useVerify(onVerified, onExpired);
  return (
    <AuthCard title="Doğrulama kodu" subtitle="Authenticator uygulamanızdaki 6 haneli kodu girin.">
      <form onSubmit={v.submit} className="space-y-4" noValidate>
        {v.error && <Alert>{v.error}</Alert>}
        <Field
          label="Kod"
          hint="Telefonunuz yanınızda değilse kurtarma kodlarınızdan birini girebilirsiniz."
          autoComplete="one-time-code"
          maxLength={14}
          value={v.code}
          onChange={(e) => v.setCode(e.target.value)}
        />
        <Button type="submit" className="w-full" busy={v.busy} disabled={v.code.trim().length < 6}>
          Giriş yap
        </Button>
      </form>
    </AuthCard>
  );
}

/** Kurtarma kodları yalnız bir kez gösterilir. */
export function RecoveryCodesPage({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'kurtarma-kodlari.txt' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AuthCard
      title="Kurtarma kodlarınızı saklayın"
      subtitle="Telefonunuza erişemezseniz bu kodlardan biriyle giriş yapabilirsiniz. Her kod bir kez kullanılır ve bir daha gösterilmez."
    >
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface-2 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button
          variant="ghost"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </Button>
        <Button variant="ghost" type="button" onClick={download}>
          <Download className="size-4" aria-hidden />
          İndir
        </Button>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Kodları güvenli bir yere kaydettim.
      </label>
      <Button className="mt-4 w-full" disabled={!saved} onClick={onContinue}>
        Panele geç
      </Button>
    </AuthCard>
  );
}
