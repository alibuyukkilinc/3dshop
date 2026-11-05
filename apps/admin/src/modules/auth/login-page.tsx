import type { AdminLoginResult, AdminSessionStage } from '@dtd/contracts';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { Alert, AuthCard, Button, Field } from '../../shared/ui';

export function LoginPage({
  onStage,
  notice,
}: {
  onStage: (stage: AdminSessionStage) => void;
  /** Önceki adımdan gelen bilgi (örn. doğrulama süresi doldu) */
  notice?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<AdminLoginResult>('/admin/v1/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      onStage(res.stage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Giriş yapılamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Yönetim paneline giriş" subtitle="Hesabınız yöneticiler tarafından açılır.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field
          label="E-posta"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Parola"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" busy={busy} disabled={!email || !password}>
          Devam
        </Button>
      </form>
    </AuthCard>
  );
}
