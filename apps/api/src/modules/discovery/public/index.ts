// discovery modülünün dışa açık yüzü (K50): vitrin okuma, arama (F2.4), AI rehber araçları (F5).
export { DiscoveryModule } from '../discovery.module.js';
export { StorefrontService, PAGE_SIZE } from '../application/storefront.service.js';
export { GuideService, type FallbackReason } from '../application/guide.service.js';
export { GUIDE_LLM, type GuideLlm, type GuideMessage, type GuideRequest } from '../application/guide-llm.js';
