import * as THREE from "three";

type Vertex = { p: THREE.Vector3; n: THREE.Vector3; c: THREE.Vector3 };

/** Complementary land/water polygons share one shoreline, with no overlapping
 * near-coplanar surfaces for the depth buffer to alternate between. */
export function splitCoast(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  const color = source.getAttribute("color");
  const land = { p: [] as number[], n: [] as number[], c: [] as number[] };
  const water: number[] = [];
  function clip(vertices: Vertex[], above: boolean) {
    const result: Vertex[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length];
      const insideA = above ? a.p.y >= 0 : a.p.y < 0;
      const insideB = above ? b.p.y >= 0 : b.p.y < 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = -a.p.y / (b.p.y - a.p.y);
        const p = a.p.clone().lerp(b.p, t);
        p.y = 0;
        result.push({
          p,
          n: a.n.clone().lerp(b.n, t).normalize(),
          c: a.c.clone().lerp(b.c, t),
        });
      }
    }
    return result;
  }
  const count = source.index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((j): Vertex => {
      const k = source.index ? source.index.getX(i + j) : i + j;
      return {
        p: new THREE.Vector3().fromBufferAttribute(position, k),
        n: new THREE.Vector3().fromBufferAttribute(normal, k),
        c: new THREE.Vector3().fromBufferAttribute(color, k),
      };
    });
    for (const above of [true, false]) {
      const polygon = clip(triangle, above);
      for (let j = 1; j + 1 < polygon.length; j++) {
        for (const v of [polygon[0], polygon[j], polygon[j + 1]]) {
          if (above) {
            land.p.push(...v.p.toArray());
            land.n.push(...v.n.toArray());
            land.c.push(...v.c.toArray());
          } else water.push(v.p.x, 0, v.p.z);
        }
      }
    }
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute("position", new THREE.Float32BufferAttribute(land.p, 3));
  ground.setAttribute("normal", new THREE.Float32BufferAttribute(land.n, 3));
  ground.setAttribute("color", new THREE.Float32BufferAttribute(land.c, 3));
  const sea = new THREE.BufferGeometry();
  sea.setAttribute("position", new THREE.Float32BufferAttribute(water, 3));
  return { ground, sea };
}
