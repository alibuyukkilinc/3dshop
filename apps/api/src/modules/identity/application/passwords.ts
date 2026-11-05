import { hash, verify } from '@node-rs/argon2';

/** argon2id, kütüphane varsayılanları (OWASP önerisiyle uyumlu). */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/** Kullanıcı yokken de aynı sürede yanıt vermek için sabit bir hash (zamanlama ile e-posta tahmini engellenir). */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummy ??= hash('dtd-olmayan-kullanici-parolasi');
  await verifyPassword(await dummy, plain);
}

export const MIN_PASSWORD_LENGTH = 12;
