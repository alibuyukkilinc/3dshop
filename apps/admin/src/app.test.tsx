import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('yönetim paneli oturum akışı', () => {
  it('oturum yoksa giriş ekranı; hatalı girişte sunucu mesajı gösterilir', async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(respond(401, { error: 'unauthenticated', message: 'Oturum açın.' }))
      .mockReturnValueOnce(respond(401, { error: 'invalid_credentials', message: 'E-posta veya parola hatalı.' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByText('Yönetim paneline giriş');
    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Parola'), { target: { value: 'yanlis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devam' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'E-posta veya parola hatalı.');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/v1/auth/login');
  });

  it('2FA bekleyen oturum yenilenince doğrulama ekranı açılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(respond(401, { error: 'mfa_required', stage: 'mfa_verify', message: '' })),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('Doğrulama kodu')).toBeTruthy());
  });

  it('2FA adımında ara oturum dolarsa uyarıyla giriş ekranına dönülür', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(respond(401, { error: 'mfa_required', stage: 'mfa_verify', message: '' }))
        .mockReturnValueOnce(respond(401, { error: 'unauthenticated', message: 'Oturum açın.' })),
    );
    render(<App />);
    await screen.findByText('Doğrulama kodu');
    fireEvent.change(screen.getByLabelText('Kod'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Giriş yap' }));
    await screen.findByText('Yönetim paneline giriş');
    expect(screen.getByRole('alert').textContent).toContain('Doğrulama süresi doldu');
  });

  it('tam oturumda pano gösterilir', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(respond(200, { id: '1', email: 'a@example.com', display_name: 'Ali', roles: ['platform_admin'] })),
    );
    render(<App />);
    expect(await screen.findByText('Hoş geldiniz, Ali')).toBeTruthy();
  });
});
