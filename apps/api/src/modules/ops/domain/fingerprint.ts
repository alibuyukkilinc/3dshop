import { createHash } from 'node:crypto';

/** Mesajdaki değişken kısımları (kimlik, sayı, tırnaklı değer) atar: aynı tür hata aynı parmak izini alır. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '<str>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .slice(0, 300);
}

/** Yığın izinin proje kodundaki ilk çerçevesi (satır/sütun numarası olmadan: küçük düzenlemelerde değişmesin). */
export function firstAppFrame(stack: string | undefined): string {
  const frames = (stack ?? '').split('\n').slice(1);
  const own = frames.find((f) => !f.includes('node_modules') && !f.includes('node:')) ?? frames[0] ?? '';
  return own
    .trim()
    .replace(/:\d+:\d+\)?$/, '')
    .replace(/^at\s+/, '')
    .replace(/\\/g, '/')
    // Makineye özgü kök yol atılır; işlev adı ve "(" korunur
    .replace(/(^|\()[^()]*?\/(apps|packages)\//, '$1$2/');
}

export function fingerprint(source: string, name: string, message: string, stack?: string): string {
  return createHash('sha256')
    .update([source, name, normalizeMessage(message), firstAppFrame(stack)].join('|'))
    .digest('hex')
    .slice(0, 32);
}
