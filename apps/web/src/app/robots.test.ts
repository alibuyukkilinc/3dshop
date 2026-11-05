import { describe, expect, it } from 'vitest';
import { buildRobots } from './robots';

describe('robots.txt (K55, staging noindex)', () => {
  it('varsayılan olarak her şeyi kapatır', () => {
    expect(buildRobots({})).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    expect(buildRobots({ SITE_INDEXABLE: 'false' }).rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('yalnız SITE_INDEXABLE=true iken açar; API ve yönlendirmeyi kapalı tutar', () => {
    const r = buildRobots({ SITE_INDEXABLE: 'true', SITE_URL: 'https://firmaxi.com' });
    expect(r.rules).toEqual({ userAgent: '*', allow: '/', disallow: ['/api/', '/r/'] });
    expect(r.sitemap).toBe('https://firmaxi.com/sitemap.xml');
  });
});
