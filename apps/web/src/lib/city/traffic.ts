import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { Obstacle } from './movement';
import { carParts } from './vehicles';

/**
 * Cadde trafiği (görsel iyileştirme 3): her hat parçasında iki yönlü birer şerit (sağdan akış), öndeki
 * araca mesafe bırakan ve yoldaki yayanın (oyuncu) önünde duran araçlar; güney bordüründe park etmiş
 * araçlar. Şeritler sis mesafesinin ötesine uzanır: araçlar uçta görünmeden başa döner. Tümü tek örnekli
 * çizim kümesi (parça başına bir çizim çağrısı). Yalnız istemci süsüdür; sahne belgesine yazılmaz.
 */

type V2 = [number, number];

export interface LaneCar {
  /** Şerit başından uzaklık (m) */
  s: number;
  v: number;
  /** İstenen hız (m/s) */
  cruise: number;
}

/** Şerit sürüş kuralı (saf): öndekine en az `gap` m, yaya `stopAt` uzaklıktaysa önünde dur; uzunlukta başa döner */
export function advanceLane(cars: LaneCar[], dt: number, length: number, stopAt: number | null, gap = 9): void {
  const order = [...cars].sort((a, b) => a.s - b.s);
  for (let i = 0; i < order.length; i++) {
    const c = order[i]!;
    const lead = order[(i + 1) % order.length]!;
    let room = lead === c ? Infinity : (lead.s - c.s + length) % length;
    if (stopAt !== null) {
      const d = stopAt - c.s;
      if (d > 0 && d < room) room = d;
    }
    // Hedef hız: boşluk azaldıkça yumuşakça düşer; boşluk `gap`in altındaysa durur
    const want = Math.max(0, Math.min(c.cruise, (room - gap) * 0.9));
    const acc = want > c.v ? 2.5 : 7;
    c.v += Math.max(-acc * dt, Math.min(acc * dt, want - c.v));
    c.s = (c.s + c.v * dt) % length;
  }
}

/** Gerçekçi araç renkleri (beyaz ve gri tonları ağırlıklı) */
const PAINT = ['#f2f2f0', '#f2f2f0', '#e9e9e6', '#b8bcc0', '#9aa0a6', '#5c6167', '#2b2e33', '#1b1d20', '#1d2f4f', '#7a1b1f', '#8e8473', '#2f4a3a'];

interface Lane {
  origin: V2;
  dir: V2;
  length: number;
  cars: LaneCar[];
  /** İlk örnek indisi */
  first: number;
  /** Örnek başına ölçek (uzunluk, yükseklik, genişlik) */
  scale: Vector3[];
}

export interface Traffic {
  root: Group;
  obstacles: Obstacle[];
  /** `range`: bu uzaklığın (m) ötesindeki araçlar çizilmez (sis) */
  update(dt: number, player: V2, range: number): void;
  dispose(): void;
}

export function createTraffic(
  lines: { path: V2[]; stations: { position: [number, number, number] | null }[] }[],
  bounds: { min: V2; max: V2 },
  shadows: boolean,
  /** Şeridin hat ucundan dışarı uzantısı (m): sisin ötesi */
  reach: number,
): Traffic {
  let seed = 71;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const root = new Group();
  const obstacles: Obstacle[] = [];
  const lanes: Lane[] = [];
  const parked: Matrix4[] = [];
  const parkedScale: Vector3[] = [];
  const stations = lines.flatMap((l) => l.stations.flatMap((s) => (s.position ? [[s.position[0], s.position[2]] as V2] : [])));
  let count = 0;
  const shape = () => new Vector3(0.92 + rnd() * 0.16, 0.95 + rnd() * 0.22, 0.97 + rnd() * 0.08);

  for (const line of lines)
    for (let i = 0; i + 1 < line.path.length; i++) {
      const a = line.path[i]!;
      const b = line.path[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const nrm: V2 = [-dir[1], dir[0]];
      const A: V2 = [a[0] - dir[0] * reach, a[1] - dir[1] * reach];
      const B: V2 = [b[0] + dir[0] * reach, b[1] + dir[1] * reach];
      const total = len + reach * 2;
      // Sağdan akış: hat yönünde giden şerit +normal tarafında, karşı yön −normal tarafında (iç şerit, 2,9 m)
      for (const sgn of [1, -1]) {
        const origin: V2 = sgn > 0 ? [A[0] + nrm[0] * 2.9, A[1] + nrm[1] * 2.9] : [B[0] - nrm[0] * 2.9, B[1] - nrm[1] * 2.9];
        const n = Math.round(total / 42);
        const cars: LaneCar[] = [];
        const scale: Vector3[] = [];
        for (let k = 0; k < n; k++) {
          const cruise = 8 + rnd() * 5;
          cars.push({ s: (k / n) * total + rnd() * 12, v: cruise, cruise });
          scale.push(shape());
        }
        lanes.push({ origin, dir: [dir[0] * sgn, dir[1] * sgn], length: total, cars, first: count, scale });
        count += n;
      }
      // Park etmiş araçlar: güney (+normal) dış şerit, şehir sınırları içinde; durak ve yaya geçidi önü boş
      for (let s = reach + 4; s < total - reach - 4; s += 6.2 + rnd() * 2.5) {
        const x = A[0] + dir[0] * s + nrm[0] * 5.35;
        const z = A[1] + dir[1] * s + nrm[1] * 5.35;
        if (x < bounds.min[0] || x > bounds.max[0] || z < bounds.min[1] || z > bounds.max[1]) continue;
        if (stations.some((st) => Math.hypot(st[0] - x, st[1] - z) < 19)) continue;
        if (rnd() < 0.3) continue;
        const sc = shape();
        parked.push(new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.atan2(dir[1], dir[0]) + (rnd() - 0.5) * 0.04), sc));
        parkedScale.push(sc);
        for (const off of [-1.3, 1.3]) obstacles.push({ x: x + dir[0] * off, z: z + dir[1] * off, r: 1.05 });
      }
    }

  const total = count + parked.length;
  const parts = carParts();
  const paint = new MeshStandardMaterial({ roughness: 0.28, metalness: 0.55, envMapIntensity: 1.2 });
  const glass = new MeshStandardMaterial({ color: '#1a2128', roughness: 0.06, metalness: 0.6, envMapIntensity: 1.3 });
  const tyre = new MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.85 });
  const head = new MeshBasicMaterial({ color: '#fff6e0' });
  const tail = new MeshBasicMaterial({ color: '#b3161b' });
  const meshes = [
    new InstancedMesh(parts.body, paint, total),
    new InstancedMesh(parts.glass, glass, total),
    new InstancedMesh(parts.tyre, tyre, total),
    new InstancedMesh(parts.head, head, total),
    new InstancedMesh(parts.tail, tail, total),
  ];
  // Araç başına boya rengi (kalıcı); her karede yalnız görüş mesafesindeki araçlar ardışık örneklere yazılır
  const paintOf = Array.from({ length: total }, () => new Color(PAINT[Math.floor(rnd() * PAINT.length)]!));
  for (const m of meshes) {
    m.frustumCulled = false;
    m.castShadow = shadows && m !== meshes[3] && m !== meshes[4];
    m.receiveShadow = shadows;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    root.add(m);
  }
  meshes[0]!.setColorAt(0, paintOf[0]!);

  const mat = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const parkedPos = parked.map((m) => new Vector3().setFromMatrixPosition(m));
  let slot = 0;
  const put = (m4: Matrix4, id: number) => {
    for (const m of meshes) m.setMatrixAt(slot, m4);
    meshes[0]!.setColorAt(slot, paintOf[id]!);
    slot++;
  };

  return {
    root,
    obstacles,
    update(dt, player, range) {
      slot = 0;
      parkedPos.forEach((p, i) => {
        if (Math.hypot(p.x - player[0], p.z - player[1]) < range) put(parked[i]!, count + i);
      });
      for (const lane of lanes) {
        // Oyuncu bu şeridin üstündeyse (yanal 2 m içinde) önünde durulur
        const rel: V2 = [player[0] - lane.origin[0], player[1] - lane.origin[1]];
        const along = rel[0] * lane.dir[0] + rel[1] * lane.dir[1];
        const lateral = Math.abs(rel[0] * -lane.dir[1] + rel[1] * lane.dir[0]);
        advanceLane(lane.cars, dt, lane.length, lateral < 2 && along > 0 && along < lane.length ? along - 2.5 : null);
        q.setFromAxisAngle(up, -Math.atan2(lane.dir[1], lane.dir[0]));
        lane.cars.forEach((c, k) => {
          pos.set(lane.origin[0] + lane.dir[0] * c.s, 0, lane.origin[1] + lane.dir[1] * c.s);
          if (Math.hypot(pos.x - player[0], pos.z - player[1]) >= range) return;
          put(mat.compose(pos, q, lane.scale[k]!), lane.first + k);
        });
      }
      for (const m of meshes) {
        m.count = slot;
        m.instanceMatrix.needsUpdate = true;
      }
      meshes[0]!.instanceColor!.needsUpdate = true;
    },
    dispose() {
      for (const m of meshes) m.dispose();
      for (const g of Object.values(parts)) g.dispose();
      for (const x of [paint, glass, tyre, head, tail]) x.dispose();
    },
  };
}
