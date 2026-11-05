import type { MetadataRoute } from 'next';
import { isIndexable, siteUrl } from '../lib/site';

export function buildRobots(env: Record<string, string | undefined>): MetadataRoute.Robots {
  if (!isIndexable(env)) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/r/'] },
    sitemap: `${siteUrl(env)}/sitemap.xml`,
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(process.env);
}
