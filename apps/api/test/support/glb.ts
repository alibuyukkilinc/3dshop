import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

/** n×n ızgara (2n² üçgen) + 512 px doku */
export async function makeGlb(n = 40, opts: { externalUri?: boolean } = {}): Promise<Buffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let z = 0; z <= n; z++)
    for (let x = 0; x <= n; x++) {
      pos.push(x / n, Math.sin(x / 3) * Math.cos(z / 4) * 0.05, z / n);
      uv.push(x / n, z / n);
    }
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  // Gürültülü doku: tek renkli doku prune adımında malzeme rengine indirgenir (doğru optimizasyon)
  const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();
  const tex = doc.createTexture('t').setImage(new Uint8Array(png)).setMimeType('image/png');
  const mat = doc.createMaterial('m').setBaseColorTexture(tex);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh('zemin').addPrimitive(prim);
  doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
  const glb = Buffer.from(await new NodeIO().writeBinary(doc));
  if (!opts.externalUri) return glb;
  // JSON bölümüne dış uri enjekte et (uzunluğu koruyarak değil: yeniden kur)
  const len = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + len).toString('utf8'));
  json.images = [{ uri: 'https://izleyici.example/p.png' }];
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = glb.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + bin.length, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, js, bin]);
}

