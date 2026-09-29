import * as THREE from "three";
import { GEAR_HEIGHT, LANDING_GEAR, smooth, type FlightState } from "./flight";

type Vertex = { p: THREE.Vector3; n: THREE.Vector3; uv: THREE.Vector2 };
type Triangle = Vertex[];
type Plane = (p: THREE.Vector3) => number;
function split(polygon: Vertex[], plane: Plane): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [],
    outside: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = plane(a.p),
      db = plane(b.p);
    (da >= 0 ? inside : outside).push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db),
        v = {
          p: a.p.clone().lerp(b.p, t),
          n: a.n.clone().lerp(b.n, t),
          uv: a.uv.clone().lerp(b.uv, t),
        };
      inside.push(v);
      outside.push(v);
    }
  }
  return [inside, outside];
}
function triangles(p: Vertex[]): Triangle[] {
  const result: Triangle[] = [];
  for (let i = 1; i < p.length - 1; i++) result.push([p[0], p[i], p[i + 1]]);
  return result;
}
function geometryFrom(tris: Triangle[]) {
  const p: number[] = [],
    n: number[] = [],
    uv: number[] = [];
  for (const tri of tris)
    for (const v of tri) {
      p.push(v.p.x, v.p.y, v.p.z);
      n.push(v.n.x, v.n.y, v.n.z);
      uv.push(v.uv.x, v.uv.y);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** Movable wing surfaces are cut from the airframe itself. At rest, their skin,
 * UVs and outline reproduce the original mesh; there are no overlaid panels. */
export class AircraftRig {
  readonly root = new THREE.Group();
  readonly body: THREE.BufferGeometry;
  private flaps: THREE.Group[] = [];
  private spoilers: THREE.Group[] = [];
  private legs: { moving: THREE.Group; side: number; nose: boolean }[] = [];
  private fans: { rotor: THREE.Group; engine: number }[] = [];

  constructor(
    source: THREE.BufferGeometry,
    skin: THREE.Material,
    paint: THREE.Material,
    metal: THREE.Material,
    rubber: THREE.Material,
  ) {
    const probe = new THREE.Mesh(source, skin),
      ray = new THREE.Raycaster();
    const height = (x: number, z: number, below = false) => {
      ray.set(
        new THREE.Vector3(x, below ? -12 : 12, z),
        new THREE.Vector3(0, below ? 1 : -1, 0),
      );
      return ray.intersectObject(probe, false)[0]?.point.y;
    };
    const edge = (x: number) => {
      for (let z = 6; z > -6; z -= 0.025) {
        const y = height(x, z);
        if (y !== undefined && y > -0.8 && y < 2) return z;
      }
      throw new Error("Cannot locate the aircraft wing edge.");
    };
    const raw = source.index ? source.toNonIndexed() : source.clone(),
      p = raw.getAttribute("position"),
      n = raw.getAttribute("normal"),
      uv = raw.getAttribute("uv");
    let remaining: Triangle[] = [];
    for (let i = 0; i < p.count; i += 3) {
      const tri: Triangle = [];
      for (let j = 0; j < 3; j++) {
        const k = i + j;
        tri.push({
          p: new THREE.Vector3().fromBufferAttribute(p, k),
          n: new THREE.Vector3().fromBufferAttribute(n, k),
          uv: new THREE.Vector2(uv.getX(k), uv.getY(k)),
        });
      }
      remaining.push(tri);
    }
    raw.dispose();
    const surface = (
      side: number,
      lo: number,
      hi: number,
      depth: number,
      spoiler: boolean,
    ) => {
      const mid = (lo + hi) / 2,
        z0 = edge(side * (lo + 0.04)),
        z1 = edge(side * (hi - 0.04)),
        slope = (z1 - z0) / (hi - lo - 0.08);
      const hingeZ = (x: number) => z0 + (side * x - lo - 0.04) * slope - depth;
      const cx = side * mid,
        cz = hingeZ(cx),
        cy = height(cx, cz) ?? 0;
      const planes: Plane[] = [
        (v) => side * v.x - lo,
        (v) => hi - side * v.x,
        (v) => v.z - hingeZ(v.x),
        (v) => 5 - v.z,
        (v) => v.y + 0.8,
        (v) => 2 - v.y,
      ];
      if (spoiler) planes.push((v) => hingeZ(v.x) + 0.66 - v.z);
      const selected: Triangle[] = [],
        rest: Triangle[] = [];
      for (const tri of remaining) {
        if (spoiler && tri.reduce((s, v) => s + v.n.y, 0) < 0.75) {
          rest.push(tri);
          continue;
        }
        if (planes.some((plane) => tri.every((v) => plane(v.p) < 0))) {
          rest.push(tri);
          continue;
        }
        let inside = tri;
        for (const plane of planes) {
          const [a, b] = split(inside, plane);
          rest.push(...triangles(b));
          inside = a;
          if (!inside.length) break;
        }
        selected.push(...triangles(inside));
      }
      remaining = rest;
      const outer = new THREE.Group();
      outer.position.set(cx, cy, cz);
      const dy =
        ((height(side * (hi - 0.05), hingeZ(side * (hi - 0.05))) ?? cy) -
          (height(side * (lo + 0.05), hingeZ(side * (lo + 0.05))) ?? cy)) /
        (hi - lo - 0.1);
      outer.quaternion.setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, side * dy, side * slope).normalize(),
      );
      outer.updateMatrix();
      const geometry = geometryFrom(selected);
      geometry.applyMatrix4(outer.matrix.clone().invert());
      const moving = new THREE.Group();
      moving.name = `${spoiler ? "spoiler" : "flap"}-${side}-${lo}`;
      const mesh = new THREE.Mesh(geometry, skin);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      moving.add(mesh);
      outer.add(moving);
      this.root.add(outer);
      (spoiler ? this.spoilers : this.flaps).push(moving);
    };
    for (const side of [-1, 1]) {
      surface(side, 3.7, 6.9, 0.9, false);
      surface(side, 7.05, 11.7, 0.72, false);
      for (let i = 0; i < 4; i++)
        surface(side, 4.0 + i * 1.85, 5.65 + i * 1.85, 1.65, true);
    }
    this.body = geometryFrom(remaining);
    const cylinder = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      radius: number,
      material: THREE.Material,
    ) => {
      const delta = b.clone().sub(a),
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, delta.length(), 12),
          material,
        );
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
      mesh.castShadow = true;
      return mesh;
    };
    LANDING_GEAR.forEach((wheel, index) => {
      const nose = index === 2,
        side = Math.sign(wheel.x);
      let mx = wheel.x,
        mz = wheel.z,
        underside = height(mx, mz, true);
      // Find an actual attachment on the belly/wing root, not an empty ray beside it.
      for (let i = 0; underside === undefined && i < 16; i++) {
        mx = wheel.x - side * (i + 1) * 0.06;
        mz = wheel.z - (i + 1) * 0.055;
        underside = height(mx, mz, true);
      }
      if (underside === undefined)
        throw new Error("Cannot locate landing-gear mounting point.");
      const mount = new THREE.Group();
      mount.name = `gear-mount-${index}`;
      mount.position.set(mx, underside + 0.035, mz);
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.15, 0.24, 12),
        paint,
      );
      collar.position.y = -0.07;
      mount.add(collar);
      const moving = new THREE.Group();
      moving.name = `gear-leg-${index}`;
      mount.add(moving);
      const axle = new THREE.Vector3(
          wheel.x - mx,
          -GEAR_HEIGHT + wheel.radius - mount.position.y,
          wheel.z - mz,
        ),
        join = axle.clone().multiplyScalar(0.58);
      moving.add(
        cylinder(new THREE.Vector3(), join, 0.12, paint),
        cylinder(join, axle, 0.078, metal),
      );
      moving.add(
        cylinder(
          new THREE.Vector3(0, -0.12, 0.35),
          axle.clone().multiplyScalar(0.7),
          0.045,
          metal,
        ),
      );
      moving.add(
        cylinder(
          axle.clone().add(new THREE.Vector3(-0.49, 0, 0)),
          axle.clone().add(new THREE.Vector3(0.49, 0, 0)),
          0.085,
          metal,
        ),
      );
      for (const sign of [-1, 1]) {
        const tire = new THREE.Group();
        tire.name = `wheel-${index}-${sign}`;
        tire.position.copy(axle).add(new THREE.Vector3(sign * 0.28, 0, 0));
        const thickness = wheel.radius * 0.29;
        const tread = new THREE.Mesh(
          new THREE.TorusGeometry(wheel.radius - thickness, thickness, 12, 28),
          rubber,
        );
        tread.rotation.y = Math.PI / 2;
        tread.castShadow = true;
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(
            wheel.radius * 0.53,
            wheel.radius * 0.53,
            thickness * 1.8,
            20,
          ),
          metal,
        );
        hub.rotation.z = Math.PI / 2;
        tire.add(tread, hub);
        moving.add(tire);
      }
      this.root.add(mount);
      this.legs.push({ moving, side, nose });
    });
    // The imported nacelles are not mirrored about x=0. These centers and
    // recesses are measured in the transformed airframe's coordinates.
    for (const [engine, x] of [-5.4662, 4.885].entries()) {
      for (const rear of [false, true]) {
        const fan = new THREE.Group();
        fan.name = `engine-${rear ? "turbine" : "fan"}-${engine + 1}`;
        fan.position.set(x, -1.55, rear ? -4.35 : -7.02);
        const scale = rear ? 0.84 : 1;
        fan.scale.setScalar(scale);
        const back = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), rubber);
        back.position.z = rear ? -0.045 : 0.045;
        back.rotation.y = rear ? 0 : Math.PI;
        fan.add(back);
        for (let i = 0; i < 24; i++) {
          const blade = new THREE.Shape();
          blade.moveTo(0.16, -0.025);
          blade.quadraticCurveTo(0.51, -0.04, 0.88, 0.1);
          blade.lineTo(0.85, 0.17);
          blade.quadraticCurveTo(0.48, 0.05, 0.15, 0.025);
          const mesh = new THREE.Mesh(new THREE.ShapeGeometry(blade, 5), metal);
          mesh.name = "rotor-blade";
          mesh.rotation.z = (i / 24) * Math.PI * 2;
          mesh.castShadow = false;
          fan.add(mesh);
        }
        const hub = new THREE.Mesh(
          new THREE.ConeGeometry(0.18, 0.26, 20),
          metal,
        );
        hub.rotation.x = rear ? Math.PI / 2 : -Math.PI / 2;
        hub.position.z = rear ? 0.08 : -0.08;
        fan.add(hub);
        this.root.add(fan);
        this.fans.push({ rotor: fan, engine });
      }
    }
  }
  update(s: FlightState, dt: number) {
    const extension = smooth(s.gearPosition);
    for (const { moving, side, nose } of this.legs) {
      moving.rotation.set(
        nose ? -(1 - extension) * 1.52 : 0,
        0,
        nose ? 0 : -side * (1 - extension) * 1.52,
      );
      moving.position.y = (1 - extension) * 0.65;
      moving.visible = s.gearPosition > 0.005;
    }
    for (const flap of this.flaps) flap.rotation.x = s.flapPosition * 0.19;
    for (const spoiler of this.spoilers)
      spoiler.rotation.x = -s.spoilers * 0.95;
    this.fans.forEach(({ rotor, engine }) => {
      rotor.rotation.z +=
        dt *
        s.engines[engine].spool *
        (20 + (s.engines[engine].phase === "running" ? s.throttle * 55 : 0));
    });
  }
}
