import { describe, expect, it } from 'vitest';
import { cleanDescription } from './catalog-query.js';

describe('kaynak açıklama temizliği (XSS)', () => {
  it('betik, olay öznitelikleri, bağlantı ve görseller atılır; temel biçim kalır', () => {
    const html =
      '<h1>Başlık</h1><p onclick="x()">Metin <strong>kalın</strong><script>alert(1)</script></p>' +
      '<img src=x onerror=alert(1)><a href="javascript:alert(1)">bağ</a><iframe src="//evil"></iframe><p> </p>' +
      '<table><tr><td style="color:red">h</td></tr></table>';
    const out = cleanDescription(html);
    expect(out).not.toMatch(/script|onclick|onerror|javascript|iframe|<img|<a |style=/i);
    expect(out).toContain('<h2>Başlık</h2>');
    expect(out).toContain('<strong>kalın</strong>');
    expect(out).toContain('bağ');
    expect(out).toContain('<td>h</td>');
    expect(out).not.toContain('<p> </p>');
  });
});
