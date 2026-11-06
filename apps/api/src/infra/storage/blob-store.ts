import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * İçerik adresli dosya deposu (K38): anahtar = sha256 + uzantı. Aynı içerik bir kez yazılır, dosya hiç
 * değişmez; bu yüzden uzun önbellek (immutable) güvenli. Pilotta sunucu diski; CDN (cdn.firmaxi.com) önüne
 * çekme bölgesi olarak konur. Kök ASSETS_DIR (yoksa depo kökünde var/assets).
 */
export const KEY_RE = /^[0-9a-f]{64}\.(glb|webp|png|jpg|json)$/;

export const MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  json: 'application/json; charset=utf-8',
};

export class BlobStore {
  constructor(private readonly root: string) {}

  static fromEnv(): BlobStore {
    return new BlobStore(resolve(process.env.ASSETS_DIR ?? join(process.cwd(), '..', '..', 'var', 'assets')));
  }

  async put(data: Buffer, ext: keyof typeof MIME): Promise<{ key: string; sha256: string; bytes: number }> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    const key = `${sha256}.${ext}`;
    const path = this.path(key);
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      // Önce geçici ada yaz, sonra taşı: yarım dosya hiçbir zaman anahtarla görünmez
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, data, { mode: 0o640 });
      await rename(tmp, path);
    }
    return { key, sha256, bytes: data.length };
  }

  exists(key: string): boolean {
    return KEY_RE.test(key) && existsSync(this.path(key));
  }

  stream(key: string): Readable {
    if (!KEY_RE.test(key)) throw new Error('Geçersiz dosya anahtarı');
    return createReadStream(this.path(key));
  }

  /** İki seviyeli dizin: ab/cd/abcd….glb (tek klasörde on binlerce dosya olmasın) */
  private path(key: string): string {
    if (!KEY_RE.test(key)) throw new Error('Geçersiz dosya anahtarı');
    return join(this.root, key.slice(0, 2), key.slice(2, 4), key);
  }
}
