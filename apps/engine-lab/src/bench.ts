import { BENCH_DURATION_S, type Vec3, cameraAt } from '@dtd/scene-runtime';

/** Ortak ölçüm düzeneği (K20): iki motor aynı rotada, aynı sürede, aynı ölçütlerle ölçülür. */
export const WARMUP_S = 2;

export interface LabOptions {
  shadows: boolean;
  dpr: number;
}

export function readOptions(): LabOptions {
  const q = new URLSearchParams(location.search);
  const dprParam = Number(q.get('dpr'));
  return {
    shadows: q.get('shadows') !== '0',
    dpr: dprParam > 0 ? dprParam : Math.min(window.devicePixelRatio || 1, 2),
  };
}

export interface FrameStats {
  drawCalls: number;
  triangles: number;
}

export interface EngineHooks {
  engine: string;
  version: string;
  /** Kamerayı konuma ve hedefe koyar, sahneyi t saniyesine göre günceller (tramvay) */
  setFrame(t: number, cam: { pos: Vec3; target: Vec3 }): void;
  /** Son karenin çizim istatistikleri */
  stats(): FrameStats;
  gl(): WebGLRenderingContext | WebGL2RenderingContext | null;
}

export interface BenchResult {
  engine: string;
  version: string;
  fps_avg: number;
  fps_p5: number;
  frame_ms_p50: number;
  frame_ms_p95: number;
  frame_ms_max: number;
  frames: number;
  first_frame_ms: number;
  scene_build_ms: number;
  draw_calls: number;
  triangles: number;
  js_heap_mb: number | null;
  shadows: boolean;
  dpr: number;
  viewport: string;
  gpu: string;
  user_agent: string;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string {
  if (!gl) return 'bilinmiyor';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

/**
 * Motorun her karesinde çağrılır. İlk WARMUP_S saniye ölçülmez (gölge haritası, gölgelendirici derleme);
 * sonra BENCH_DURATION_S boyunca kare süreleri toplanır.
 */
export class Bench {
  private readonly hud = document.createElement('div');
  private start = -1;
  private last = -1;
  private readonly frameMs: number[] = [];
  private drawCalls = 0;
  private triangles = 0;
  private firstFrameMs = -1;
  private done = false;

  constructor(
    private readonly hooks: EngineHooks,
    private readonly opts: LabOptions,
    private readonly sceneBuildMs: number,
  ) {
    this.hud.id = 'hud';
    document.body.append(this.hud);
  }

  /** Motorun render döngüsünden, çizimden ÖNCE çağrılır. */
  beforeRender(now: number): void {
    // ?freeze=<sn>: kamera ve tramvay o anda sabit; ölçüm yapılmaz (iki motorun görüntüsünü karşılaştırmak için)
    const freeze = new URLSearchParams(location.search).get('freeze');
    if (freeze !== null) {
      const ft = Number(freeze) || 0;
      this.hooks.setFrame(ft + WARMUP_S, cameraAt(ft));
      this.hud.textContent = `${this.hooks.engine} · dondurulmuş t=${ft} sn`;
      return;
    }
    if (this.firstFrameMs < 0) this.firstFrameMs = now;
    if (this.start < 0) this.start = now;
    const t = (now - this.start) / 1000;
    const benchT = Math.max(0, t - WARMUP_S);
    this.hooks.setFrame(t, cameraAt(benchT));
    if (this.done) return;
    if (t >= WARMUP_S && this.last >= 0) {
      this.frameMs.push(now - this.last);
      const s = this.hooks.stats();
      this.drawCalls = Math.max(this.drawCalls, s.drawCalls);
      this.triangles = Math.max(this.triangles, s.triangles);
    }
    this.last = now;
    if (benchT >= BENCH_DURATION_S) this.finish();
    else if (this.frameMs.length % 15 === 0) {
      const recent = this.frameMs.slice(-30);
      const fps = recent.length ? 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
      this.hud.textContent = `${this.hooks.engine} · ${t < WARMUP_S ? 'ısınma' : `ölçüm ${benchT.toFixed(0)}/${BENCH_DURATION_S} sn`} · ${fps.toFixed(0)} FPS`;
    }
  }

  private finish(): void {
    this.done = true;
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    const total = this.frameMs.reduce((a, b) => a + b, 0);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const r: BenchResult = {
      engine: this.hooks.engine,
      version: this.hooks.version,
      fps_avg: round((this.frameMs.length * 1000) / total),
      fps_p5: round(1000 / pct(sorted, 95)),
      frame_ms_p50: round(pct(sorted, 50)),
      frame_ms_p95: round(pct(sorted, 95)),
      frame_ms_max: round(sorted[sorted.length - 1] ?? 0),
      frames: this.frameMs.length,
      first_frame_ms: Math.round(this.firstFrameMs),
      scene_build_ms: Math.round(this.sceneBuildMs),
      draw_calls: this.drawCalls,
      triangles: this.triangles,
      js_heap_mb: mem ? round(mem.usedJSHeapSize / 1048576) : null,
      shadows: this.opts.shadows,
      dpr: this.opts.dpr,
      viewport: `${innerWidth}x${innerHeight}`,
      gpu: gpuName(this.hooks.gl()),
      user_agent: navigator.userAgent,
    };
    (window as unknown as { __benchResult: BenchResult }).__benchResult = r;
    this.hud.textContent = `${r.engine} · bitti · ${r.fps_avg} FPS`;
    this.showResult(r);
  }

  private showResult(r: BenchResult): void {
    const box = document.createElement('div');
    box.id = 'result';
    const text = [
      `Motor: ${r.engine} ${r.version}`,
      `Ortalama FPS: ${r.fps_avg}   En kötü %5: ${r.fps_p5} FPS`,
      `Kare süresi ms: p50 ${r.frame_ms_p50} · p95 ${r.frame_ms_p95} · en uzun ${r.frame_ms_max}`,
      `İlk kare: ${r.first_frame_ms} ms (sahne kurulumu ${r.scene_build_ms} ms)`,
      `Çizim çağrısı: ${r.draw_calls} · üçgen: ${r.triangles.toLocaleString('tr-TR')}`,
      `JS bellek: ${r.js_heap_mb ?? 'ölçülemedi'} MB`,
      `Gölge: ${r.shadows ? 'açık' : 'kapalı'} · DPR ${r.dpr} · ekran ${r.viewport}`,
      `GPU: ${r.gpu}`,
    ].join('\n');
    box.innerHTML = '<strong>Ölçüm tamam</strong><pre></pre>';
    box.querySelector('pre')!.textContent = text;
    const copy = Object.assign(document.createElement('button'), { textContent: 'Sonucu kopyala' });
    copy.onclick = async () => {
      await navigator.clipboard.writeText(`${text}\n\n${JSON.stringify(r)}`);
      copy.textContent = 'Kopyalandı';
    };
    const again = Object.assign(document.createElement('a'), { textContent: 'Tekrarla', href: location.href });
    const back = Object.assign(document.createElement('a'), { textContent: 'Diğer motor', href: './' });
    box.append(copy, again, back);
    document.body.append(box);
  }
}
