import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Category, flattenTree } from './catalog/categories-page';
import { SourcesPage } from './integration/sources-page';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const source = {
  id: 's1',
  code: 'esensolarmarket',
  base_url: 'https://esensolarmarket.com',
  status: 'active',
  health: 'no_token',
  has_token: false,
  watermark: null,
  last_full_sync_at: null,
  last_delta_sync_at: null,
  reconciled_in_window: false,
  consecutive_failures: 0,
  circuit_open_until: null,
  last_error: null,
  catalog: { total: 347, active: 151, priced: 347, unmapped_categories: 12 },
};

describe('Kaynak siteler sayfası', () => {
  it('durumu ve sayıları gösterir; token formu PUT gönderir ve token ekranda kalmaz', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return json(null, 204);
      return json(url.includes('/runs') ? { items: [] } : { items: [source], delta_interval_minutes: 5 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SourcesPage canWrite />);
    const row = (await screen.findByText('esensolarmarket')).closest('tr')!;
    expect(within(row).getByText('Token yok')).toBeTruthy();
    expect(within(row).getByText('151 / 347')).toBeTruthy();
    expect(within(row).getByText('12').getAttribute('href')).toBe('#/categories');

    fireEvent.click(within(row).getByTitle('Token gir'));
    const input = screen.getByLabelText("esensolarmarket API token'ı") as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'abcdefghijklmnopqrstuvwxyz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await screen.findByText(/token kaydedildi/);
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(put[0]).toBe('/api/admin/v1/integration/sources/esensolarmarket/token');
    await waitFor(() => expect(screen.queryByLabelText("esensolarmarket API token'ı")).toBeNull());
  });

  it('salt okuyucu yazma düğmelerini görmez', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ items: [source], delta_interval_minutes: 5 })));
    render(<SourcesPage canWrite={false} />);
    await screen.findByText('esensolarmarket');
    expect(screen.queryByTitle('Token gir')).toBeNull();
    expect(screen.queryByText('Tam eşitle')).toBeNull();
  });
});

describe('kategori ağacı düzleştirme', () => {
  it('üst › alt yolunu ve derinliği kurar, sıraya uyar', () => {
    const c = (id: string, parent: string | null, name: string, sort = 0): Category => ({
      id,
      parent_id: parent,
      slug: id,
      name,
      sort,
      status: 'active',
      version: 1,
      product_count: 0,
    });
    const flat = flattenTree([c('b', null, 'Eğitim', 2), c('a', null, 'Enerji', 1), c('a1', 'a', 'İnverterler'), c('a2', 'a', 'Aküler')]);
    expect(flat.map((x) => [x.path, x.depth])).toEqual([
      ['Enerji', 0],
      ['Enerji › Aküler', 1],
      ['Enerji › İnverterler', 1],
      ['Eğitim', 0],
    ]);
  });
});
