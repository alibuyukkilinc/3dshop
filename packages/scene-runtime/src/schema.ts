import { z } from 'zod';

/**
 * Motor bağımsız sahne belgesi dtd.scene.v1 (K20, K45). Koordinat sistemi: sağ el, Y yukarı, birim metre.
 * Belge render motorunu bilmez; her motor bir adaptörle çizer. scene_versions.document bu biçimdedir.
 */
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const Color = z.string().regex(/^#[0-9a-f]{6}$/i);

export const TransformSchema = z.object({
  p: Vec3.default([0, 0, 0]),
  r: Quat.default([0, 0, 0, 1]),
  s: Vec3.default([1, 1, 1]),
});

export const MaterialSchema = z.object({
  color: Color,
  roughness: z.number().min(0).max(1).default(0.8),
  metalness: z.number().min(0).max(1).default(0),
  /** Kendi ışığı (lamba, tabela, pencere) */
  emissive: Color.optional(),
});

/** Geometri ilkeli. Gerçek varlıklar gelene kadar (F3) prototip ve yer tutucu sahneler için. */
const PrimitiveSchema = z.object({
  type: z.literal('primitive'),
  shape: z.enum(['box', 'plane', 'cylinder', 'sphere']),
  /** box: [g, y, d]; plane: [g, d] (XZ düzlemi, yukarı bakar); cylinder: [çap, yükseklik]; sphere: [çap] */
  size: z.array(z.number().positive()).min(1).max(3),
  material: MaterialSchema,
  castShadow: z.boolean().default(true),
  receiveShadow: z.boolean().default(true),
});

/** Varlık kütüphanesindeki belirli bir sürüm (K27, K45). F3'te. */
const MeshSchema = z.object({
  type: z.literal('mesh'),
  asset_version_id: z.uuid(),
  lod_policy: z.enum(['auto', 'high', 'low']).default('auto'),
});

/** Ürün panosu: 3D'de ürün görselli pano olarak temsil edilir (K56). Doku istemcide üretilir. */
const BoardSchema = z.object({
  type: z.literal('board'),
  width: z.number().positive(),
  height: z.number().positive(),
  product_id: z.string(),
  title: z.string(),
  price_text: z.string(),
  color: Color,
});

const LightSchema = z.object({
  type: z.literal('light'),
  kind: z.enum(['hemispheric', 'directional']),
  color: Color.default('#ffffff'),
  intensity: z.number().nonnegative(),
  /** directional: ışığın geldiği yön (normalize edilir) */
  direction: Vec3.optional(),
  shadows: z.boolean().default(false),
});

/** Düğümü kapalı bir rota boyunca sabit hızla hareket ettirir (tramvay). */
const PathLoopSchema = z.object({
  type: z.literal('path_loop'),
  points: z.array(Vec3).min(2),
  speed: z.number().positive(),
});

const SlotSchema = z.object({ type: z.literal('slot'), slot_id: z.string() });
const PortalSchema = z.object({ type: z.literal('portal'), portal_id: z.string() });

export const ComponentSchema = z.discriminatedUnion('type', [
  PrimitiveSchema,
  MeshSchema,
  BoardSchema,
  LightSchema,
  PathLoopSchema,
  SlotSchema,
  PortalSchema,
]);

export const NodeSchema = z.object({
  id: z.string().min(1),
  parent: z.string().nullable(),
  name: z.string().optional(),
  transform: TransformSchema.default({ p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }),
  components: z.array(ComponentSchema).default([]),
});

export const SceneDocumentSchema = z
  .object({
    schema: z.literal('dtd.scene.v1'),
    units: z.literal('m'),
    background: Color.default('#bcd3e6'),
    nodes: z.array(NodeSchema),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    for (const n of doc.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `Yinelenen düğüm kimliği: ${n.id}` });
      ids.add(n.id);
    }
    // Ebeveyn önce gelmeli: adaptörler belgeyi tek geçişte kurar
    const seen = new Set<string>();
    for (const n of doc.nodes) {
      if (n.parent !== null && !seen.has(n.parent)) {
        ctx.addIssue({ code: 'custom', message: `Ebeveyn bulunamadı ya da sonra geliyor: ${n.id} -> ${n.parent}` });
      }
      seen.add(n.id);
    }
  });

export type SceneDocument = z.infer<typeof SceneDocumentSchema>;
export type SceneNode = z.infer<typeof NodeSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
