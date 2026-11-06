import { apiGet } from './api';

/** Rehber açık mı (API'de ANTHROPIC_API_KEY var mı). API'ye ulaşılamazsa kapalı sayılır. */
export async function guideEnabled(): Promise<boolean> {
  try {
    return (await apiGet<{ enabled: boolean }>('/guide/status', 60)).enabled;
  } catch {
    return false;
  }
}
