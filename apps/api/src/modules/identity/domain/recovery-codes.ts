import { createHash, randomInt } from 'node:crypto';

// Karışabilecek karakterler yok (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Biçim: XXXX-XXXX-XX (10 karakter, ~49 bit). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
  });
}

export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 10 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(`recovery:${code}`, 'utf8').digest('hex');
}
