import { type Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, reorder, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * GLB doğrulama ve optimizasyon (K38, K46). Bozuk ya da zararlı dosya hiç işlenmez: yalnız GLB 2.0, boyut
 * sınırı, dış kaynak (uri) yok, bilinmeyen zorunlu eklenti yok, makul üçgen ve doku boyutu.
 */
export const LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxTriangles: 500_000,
  maxTexturePx: 4096,
} as const;

/** Desteklenen zorunlu eklentiler: istemci (Three.js GLTFLoader + meshopt) bunları okur */
const ALLOWED_REQUIRED = new Set([
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'EXT_meshopt_compression',
  'EXT_texture_webp',
  'KHR_texture_basisu',
]);

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  triangles: number;
  bounds: { min: number[]; max: number[] } | null;
  textures: { width: number; height: number; mime: string }[];
}

function io(): NodeIO {
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

/** GLB kapsayıcısının JSON bölümünü okur (ayrıştırıcıya vermeden önce yapısal denetim için). */
function glbJson(buf: Buffer): Record<string, unknown> {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB değil (sihirli sayı yok)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('Yalnız glTF 2.0 desteklenir');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('GLB boyutu başlıkla uyuşmuyor (kesik dosya)');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a || 20 + len > buf.length) throw new Error('GLB JSON bölümü bozuk');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Record<string, unknown>;
}

export async function validateGlb(buf: Buffer): Promise<{ report: ValidationReport; doc: Document | null }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (e: string) => ({
    report: { ok: false, errors: [...errors, e], warnings, triangles: 0, bounds: null, textures: [] },
    doc: null,
  });
  if (buf.length > LIMITS.maxBytes) return fail(`Dosya ${Math.round(buf.length / 1048576)} MB; sınır ${LIMITS.maxBytes / 1048576} MB.`);
  let json: Record<string, unknown>;
  try {
    json = glbJson(buf);
  } catch (e) {
    return fail((e as Error).message);
  }
  // Dış kaynak yok: ziyaretçinin tarayıcısı başka adrese istek atmasın (izleme/zararlı içerik)
  for (const k of ['buffers', 'images'] as const) {
    for (const item of (json[k] as { uri?: string }[] | undefined) ?? []) {
      if (item.uri !== undefined) errors.push(`${k}: dış ya da gömülü uri kabul edilmez (${String(item.uri).slice(0, 40)})`);
    }
  }
  for (const ext of (json.extensionsRequired as string[] | undefined) ?? []) {
    if (!ALLOWED_REQUIRED.has(ext)) errors.push(`Desteklenmeyen zorunlu eklenti: ${ext}`);
  }
  if (errors.length) return fail('Dosya güvenlik denetimini geçmedi.');

  let doc: Document;
  await MeshoptDecoder.ready;
  try {
    doc = await io().readBinary(new Uint8Array(buf));
  } catch (e) {
    return fail(`Ayrıştırılamadı: ${(e as Error).message.slice(0, 200)}`);
  }
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (!pos) {
        warnings.push(`${mesh.getName() || 'mesh'}: konumsuz primitive`);
        continue;
      }
      if (prim.getMode() === 4) triangles += Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
    }
  }
  if (triangles > LIMITS.maxTriangles) errors.push(`${triangles} üçgen; sınır ${LIMITS.maxTriangles}.`);
  const textures: ValidationReport['textures'] = [];
  for (const t of root.listTextures()) {
    const size = t.getSize();
    const mime = t.getMimeType();
    if (size) {
      textures.push({ width: size[0], height: size[1], mime });
      if (Math.max(size[0], size[1]) > LIMITS.maxTexturePx) errors.push(`Doku ${size[0]}×${size[1]}; sınır ${LIMITS.maxTexturePx}.`);
    } else {
      errors.push(`Doku okunamadı (${mime})`);
    }
  }
  const scene = root.listScenes()[0];
  const b = scene ? getBounds(scene) : null;
  if (!scene) errors.push('Sahne yok');
  return {
    report: {
      ok: errors.length === 0,
      errors,
      warnings,
      triangles,
      bounds: b ? { min: b.min.map(r3), max: b.max.map(r3) } : null,
      textures,
    },
    doc: errors.length === 0 ? doc : null,
  };
}

/** LOD'lar: üçgen oranı ve en büyük doku kenarı (mobil bellek, K3) */
export const LODS = [
  { role: 'lod0', ratio: 1, texture: 1024 },
  { role: 'lod1', ratio: 0.5, texture: 512 },
  { role: 'lod2', ratio: 0.25, texture: 256 },
] as const;

/**
 * Optimizasyon: tekrarları ayıkla, kaynaştır, sadeleştir (LOD), dokuları WebP'ye çevir ve küçült (kullanıcı
 * kararı 2026-11-06: pilotta WebP, KTX2 sonra), geometriyi Meshopt ile sıkıştır.
 */
export async function optimizeLods(source: Buffer): Promise<{ role: string; data: Buffer; triangles: number }[]> {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const out: { role: string; data: Buffer; triangles: number }[] = [];
  for (const lod of LODS) {
    const doc = await io().readBinary(new Uint8Array(source));
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await doc.transform(
      dedup(),
      prune(),
      weld(),
      ...(lod.ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: 0.01 })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod.texture, lod.texture] }),
      reorder({ encoder: MeshoptEncoder }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    let triangles = 0;
    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) {
        const idx = p.getIndices();
        const pos = p.getAttribute('POSITION');
        if (pos && p.getMode() === 4) triangles += Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
      }
    }
    out.push({ role: lod.role, data: Buffer.from(await io().writeBinary(doc)), triangles });
  }
  return out;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
