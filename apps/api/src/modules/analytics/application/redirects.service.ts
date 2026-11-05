import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@dtd/contracts';
import { PrismaService } from '../../../infra/db/prisma.service.js';

export type RedirectChannel = '2d' | '3d' | 'search' | 'ai';

export interface NewRedirect {
  productId: string;
  storeId: string;
  sourceSiteId: string | null;
  channel: RedirectChannel;
  /** Ürünün kaynak sitedeki adresi (catalog, K41). Çağıran doğrular; istemciden alınmaz. */
  targetUrl: string;
}

/**
 * Kaynak siteye yönlendirme (K53): her tıklama bir kayıt; kullanıcı kaynak URL'ye dtd_rid = kayıt kimliği ve
 * utm parametreleriyle gider. eticaret dtd_rid'i saklayıp sipariş olayında geri gönderir (F5 eşleme).
 * Kişisel veri (IP, çerez, kullanıcı) tutulmaz.
 */
@Injectable()
export class RedirectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(r: NewRedirect): Promise<{ id: string; url: string }> {
    const target = new URL(r.targetUrl);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Yönlendirme hedefi http(s) olmalı');
    const id = uuidv7();
    await this.prisma.redirect.create({
      data: { id, productId: r.productId, storeId: r.storeId, sourceSiteId: r.sourceSiteId, channel: r.channel, targetUrl: target.toString() },
    });
    target.searchParams.set('dtd_rid', id);
    target.searchParams.set('utm_source', 'dtd');
    target.searchParams.set('utm_medium', r.channel);
    target.searchParams.set('utm_campaign', 'dijital_ticaret_dunyasi');
    return { id, url: target.toString() };
  }
}
