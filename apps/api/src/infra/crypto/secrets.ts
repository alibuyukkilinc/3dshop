import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Veritabanında saklanan gizli değerler (TOTP sırrı, ileride adaptör anahtarları) AES-256-GCM ile şifrelenir.
 * Biçim: v1.<iv>.<tag>.<şifreli> (base64url). Anahtar SECRETS_KEY'den gelir, asla loglanmaz.
 */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(sealed: string, keyB64: string): string {
  const [version, iv, tag, enc] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Şifreli değer biçimi tanınmadı');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** URL'de ve çerezde taşınabilir rastgele belirteç. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
