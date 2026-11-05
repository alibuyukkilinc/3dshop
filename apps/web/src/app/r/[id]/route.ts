import { type NextRequest, NextResponse } from 'next/server';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3100';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHANNELS = new Set(['2d', '3d', 'search', 'ai']);

/**
 * /r/{ürün} — "Sitede satın al" (K53). API yönlendirme kaydını açıp kaynak adresi dtd_rid ile verir; burası
 * yalnız 302'yi iletir. Hedef API'den gelir (istemciden değil): açık yönlendirme yok. Önbelleğe alınmaz.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ch = req.nextUrl.searchParams.get('ch') ?? '2d';
  if (!UUID_RE.test(id) || !CHANNELS.has(ch)) return new NextResponse('Bulunamadı', { status: 404 });
  const res = await fetch(`${API}/api/v1/go/${id}?ch=${ch}`, { redirect: 'manual', cache: 'no-store' });
  const location = res.headers.get('location');
  if (res.status !== 302 || !location || !/^https?:\/\//.test(location)) {
    return NextResponse.redirect(new URL('/', req.url), 302);
  }
  const out = NextResponse.redirect(location, 302);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('Referrer-Policy', 'no-referrer-when-downgrade');
  return out;
}
