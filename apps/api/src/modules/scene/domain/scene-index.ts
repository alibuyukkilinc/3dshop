import { createHash } from 'node:crypto';
import type { SceneDocument } from '@dtd/scene-runtime/schema';

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** Kuaterniyonla döndürme (x,y,z,w). */
function rotate([x, y, z]: V3, [qx, qy, qz, qw]: Q): V3 {
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
function mulQ([ax, ay, az, aw]: Q, [bx, by, bz, bw]: Q): Q {
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export interface IndexedNode {
  nodeId: string;
  kind: string;
  refId: string | null;
  x: number;
  y: number;
  z: number;
}

/**
 * Düğüm dizini (K45): yuva, portal, çapa ve varlık düğümlerinin dünya konumları. Ebeveyn önce gelir (şema
 * bunu zorlar), tek geçişte birleşik dönüşüm hesaplanır.
 */
export function indexNodes(doc: SceneDocument): IndexedNode[] {
  const world = new Map<string, { p: V3; r: Q; s: V3 }>();
  const out: IndexedNode[] = [];
  for (const n of doc.nodes) {
    const local = n.transform as { p: V3; r: Q; s: V3 };
    const parent = n.parent ? world.get(n.parent) : undefined;
    const t = parent
      ? {
          p: ((): V3 => {
            const scaled: V3 = [local.p[0] * parent.s[0], local.p[1] * parent.s[1], local.p[2] * parent.s[2]];
            const r = rotate(scaled, parent.r);
            return [r[0] + parent.p[0], r[1] + parent.p[1], r[2] + parent.p[2]];
          })(),
          r: mulQ(parent.r, local.r),
          s: [local.s[0] * parent.s[0], local.s[1] * parent.s[1], local.s[2] * parent.s[2]] as V3,
        }
      : local;
    world.set(n.id, t);
    for (const c of n.components) {
      const ref =
        c.type === 'mesh' ? c.asset_version_id : c.type === 'slot' ? c.slot_id : c.type === 'portal' ? c.portal_id : c.type === 'anchor' ? c.ref_id : null;
      const kind = c.type === 'anchor' ? `anchor:${c.kind}` : c.type;
      if (['mesh', 'slot', 'portal', 'anchor'].includes(c.type)) {
        out.push({ nodeId: n.id, kind, refId: ref, x: round(t.p[0]), y: round(t.p[1]), z: round(t.p[2]) });
      }
    }
  }
  return out;
}

export function assetVersionIds(doc: SceneDocument): string[] {
  return [...new Set(doc.nodes.flatMap((n) => n.components.filter((c) => c.type === 'mesh').map((c) => (c as { asset_version_id: string }).asset_version_id)))];
}

/** Anahtar sırasından bağımsız özet: aynı belge ikinci kez sürüm olmaz. */
export function documentChecksum(doc: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(doc)).digest('hex')}`;
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
    .join(',')}}`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
