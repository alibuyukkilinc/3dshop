import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '../../../infra/config/env.js';

export type GuideMessage = Anthropic.Beta.BetaMessage;
export type GuideRequest = Anthropic.Beta.MessageCreateParamsNonStreaming;

/** Rehberin model istemcisi: testlerde sahtesiyle değiştirilir. null = anahtar yok, rehber kapalı. */
export interface GuideLlm {
  create(params: GuideRequest, opts: { timeoutMs: number }): Promise<GuideMessage>;
}
export const GUIDE_LLM = Symbol('GUIDE_LLM');

/** Anthropic SDK; anahtar yalnız ortamdan okunur, asla loglanmaz. Yeniden deneme SDK'da (429/5xx, 2 kez). */
export function guideLlmFromEnv(): GuideLlm | null {
  const key = loadEnv().ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  return {
    create: (params, opts) => client.beta.messages.create(params, { timeout: opts.timeoutMs }),
  };
}

/** Sunucu tarafı ret yedeği ("default") yalnız destekleyen modellerde gönderilir. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
export const supportsServerFallback = (model: string) => FALLBACK_MODELS.has(model);

export const GuideApiError = Anthropic.APIError;
