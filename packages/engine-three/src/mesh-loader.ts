import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export type Lod = 'lod0' | 'lod1' | 'lod2';

/** Varlık sürümü → model. Aynı adres bir kez indirilir; her örnek klondur (geometri/malzeme paylaşılır). */
export type MeshLoader = (assetVersionId: string, lod: Lod) => Promise<Object3D | null>;

/**
 * Varlık kütüphanesi modellerini yükler (F3.2 çıktısı: EXT_meshopt_compression + WebP). resolveUrl sürüm
 * kimliğini dosya adresine çevirir (ör. /api/v1/assets/files/<sha>.glb); bulunamazsa null.
 */
export function createGltfMeshLoader(resolveUrl: (assetVersionId: string, lod: Lod) => Promise<string | null>): MeshLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map<string, Promise<Object3D | null>>();
  return async (id, lod) => {
    const url = await resolveUrl(id, lod);
    if (!url) return null;
    let p = cache.get(url);
    if (!p) {
      p = loader.loadAsync(url).then(
        (g) => g.scene,
        () => null,
      );
      cache.set(url, p);
    }
    const base = await p;
    return base ? base.clone(true) : null;
  };
}
