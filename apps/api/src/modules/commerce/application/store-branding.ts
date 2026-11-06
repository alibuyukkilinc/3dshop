import { Injectable, Logger } from '@nestjs/common';
import { type AdminContext, conflict, notFound } from '../../../infra/http/admin-request.js';
import { PrismaService } from '../../../infra/db/prisma.service.js';
import { AuditWriter } from '../../audit/public/index.js';
import { OutboxWriter } from '../../platform/public/index.js';

/**
 * Mağaza logosu ve ikonu (3D mağaza deneyimi). Kaynak e-ticaret sitesi doğrudur (K06): logo, firmanın web
 * sitesinin ana sayfasından okunur (tema logosu `img.logo`, yoksa og:image; ikon: PNG/SVG `rel=icon`, yoksa
 * favicon.ico). Yalnız https adresler saklanır; görsel indirilmez, kaynak CDN'den gösterilir (K41).
 */

export interface Branding {
  logo: string | null;
  icon: string | null;
}

const MAX_HTML = 2_000_000;
const TIMEOUT_MS = 8000;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}

function absolute(url: string | null, base: string): string | null {
  if (!url || url.startsWith('data:')) return null;
  try {
    const u = new URL(url.replace(/&amp;/g, '&'), base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Ana sayfa HTML'inden logo ve ikon adresi (saf; test edilir) */
export function extractBranding(html: string, baseUrl: string): Branding {
  const head = html.slice(0, MAX_HTML);
  let logo: string | null = null;
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const cls = attr(tag, 'class') ?? '';
    const alt = attr(tag, 'alt') ?? '';
    const src = attr(tag, 'data-src') ?? attr(tag, 'src');
    if (!src || /load(ing)?\.gif$/i.test(src)) continue;
    if (/\blogo\b/i.test(cls) || /logo/i.test(src.split('/').pop() ?? '') || (/\blogo\b/i.test(alt) && !logo)) {
      logo = absolute(src, baseUrl);
      if (logo) break;
    }
  }
  if (!logo) {
    const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(head);
    logo = og ? absolute(attr(og[0], 'content'), baseUrl) : null;
  }
  // İkon: PNG/SVG tercih (keskin), yoksa ilk ikon
  const icons: { href: string; score: number }[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    if (!/(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    const href = absolute(attr(m[0], 'href'), baseUrl);
    if (!href) continue;
    const score = (/\.(png|svg|webp)(\?|$)/i.test(href) ? 2 : 0) + (rel.includes('apple-touch-icon') ? 1 : 0);
    icons.push({ href, score });
  }
  icons.sort((a, b) => b.score - a.score);
  return { logo, icon: icons[0]?.href ?? null };
}

@Injectable()
export class StoreBrandingService {
  private readonly log = new Logger(StoreBrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /** Firmanın web sitesinden logo/ikon okur ve mağazaya yazar (denetim kaydı + olay aynı transaction'da) */
  async refresh(storeId: string, ctx: AdminContext): Promise<Branding & { changed: boolean }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, include: { company: { select: { website: true } } } });
    if (!store) throw notFound('Mağaza bulunamadı.');
    const site = store.company.website;
    if (!site || !/^https:\/\//i.test(site)) throw conflict('Firmanın https web sitesi kayıtlı değil.');
    const html = await this.fetchHtml(site);
    const b = extractBranding(html, site);
    if (!b.logo && !b.icon) throw conflict('Sitede logo ya da ikon bulunamadı.');
    return { ...b, changed: await this.write(storeId, { logo: b.logo ?? store.logoUrl, icon: b.icon ?? store.iconUrl }, ctx) };
  }

  /** Elle girilen adres (yönetim paneli) */
  async set(storeId: string, b: Partial<Branding>, ctx: AdminContext): Promise<boolean> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw notFound('Mağaza bulunamadı.');
    for (const u of [b.logo, b.icon]) if (u && !/^https:\/\//i.test(u)) throw conflict('Adres https ile başlamalı.');
    return this.write(storeId, { logo: b.logo === undefined ? store.logoUrl : b.logo, icon: b.icon === undefined ? store.iconUrl : b.icon }, ctx);
  }

  private async write(storeId: string, b: Branding, ctx: AdminContext): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({ where: { id: storeId }, select: { logoUrl: true, iconUrl: true } });
      if (!before) throw notFound('Mağaza bulunamadı.');
      if (before.logoUrl === b.logo && before.iconUrl === b.icon) return false;
      await tx.store.update({ where: { id: storeId }, data: { logoUrl: b.logo, iconUrl: b.icon, version: { increment: 1 } } });
      const data = { logoUrl: b.logo, iconUrl: b.icon };
      await this.audit.write(tx, {
        actor: ctx.actor,
        action: 'commerce.store.branding_updated',
        entity: { type: 'store', id: storeId },
        diff: { before, after: data },
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
      });
      await this.outbox.append(tx, {
        type: 'commerce.store.updated',
        sourceModule: 'commerce',
        aggregate: { type: 'store', id: storeId },
        actor: ctx.actor,
        data: { store_id: storeId, fields: ['logoUrl', 'iconUrl'] },
      });
      return true;
    });
  }

  private async fetchHtml(url: string): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { Accept: 'text/html', 'User-Agent': 'DTD-Branding/1.0' } });
      if (!res.ok) throw conflict(`Site yanıt vermedi (${res.status}).`);
      if (!res.url.startsWith('https://')) throw conflict('Site https dışına yönlendirdi.');
      const text = await res.text();
      return text.slice(0, MAX_HTML);
    } catch (e) {
      this.log.warn(`Logo okunamadı: ${url} — ${(e as Error).message}`);
      throw e instanceof Error && 'getStatus' in e ? e : conflict('Siteye ulaşılamadı.');
    } finally {
      clearTimeout(t);
    }
  }
}
