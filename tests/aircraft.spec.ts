import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Aircraft } from "../lib/simulator/aircraft";
import { createFlight, GEAR_HEIGHT } from "../lib/simulator/flight";

// Use the shipped mesh, without loading textures or needing a WebGL context.
function modelFixture() {
  const bytes = readFileSync("public/models/a320.glb"),
    length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length),
    geometry = new THREE.BufferGeometry();
  const primitive = gltf.meshes[0].primitives[0];
  for (const [semantic, id] of Object.entries(primitive.attributes)) {
    const a = gltf.accessors[id as number],
      v = gltf.bufferViews[a.bufferView],
      size = a.type === "VEC2" ? 2 : 3;
    const data = new Float32Array(a.count * size),
      offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < data.length; i++)
      data[i] = binary.readFloatLE(offset + i * 4);
    geometry.setAttribute(
      (
        { POSITION: "position", NORMAL: "normal", TEXCOORD_0: "uv" } as Record<
          string,
          string
        >
      )[semantic],
      new THREE.BufferAttribute(data, size),
    );
  }
  const a = gltf.accessors[primitive.indices],
    v = gltf.bufferViews[a.bufferView],
    offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  geometry.setIndex(
    Array.from({ length: a.count }, (_, i) =>
      a.componentType === 5123
        ? binary.readUInt16LE(offset + i * 2)
        : binary.readUInt32LE(offset + i * 4),
    ),
  );
  const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
    ),
    node = gltf.nodes[0];
  mesh.quaternion.fromArray(node.rotation);
  mesh.scale.fromArray(node.scale);
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}

test("stowed flaps and spoilers preserve the real wing skin without extra floating panels", async () => {
  const scene = modelFixture(),
    reference = scene.clone();
  reference.updateMatrixWorld(true);
  const source = reference.children[0] as THREE.Mesh;
  const referenceMesh = new THREE.Mesh(
    source.geometry
      .clone()
      .applyMatrix4(source.matrixWorld)
      .rotateY(Math.PI / 2)
      .translate(0, 0, -3),
    source.material,
  );
  const previous = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (_url, onLoad) {
    queueMicrotask(() => onLoad({ scene } as unknown as GLTF));
  };
  let aircraft: Aircraft | undefined;
  try {
    aircraft = new Aircraft();
    await expect.poll(() => aircraft!.loaded).toBe(true);
    aircraft.update(createFlight(true));
    aircraft.root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    aircraft.root.traverseVisible((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    const ray = new THREE.Raycaster(),
      mismatches: string[] = [];
    for (const side of [-1, 1])
      for (let x = 3.6; x < 12; x += 0.4)
        for (let z = -3; z < 5; z += 0.4) {
          ray.set(
            new THREE.Vector3(x * side, 6, z),
            new THREE.Vector3(0, -1, 0),
          );
          const expected = ray.intersectObject(referenceMesh)[0]?.point.y;
          const actual = ray.intersectObjects(meshes, false)[0]?.point.y;
          if (
            (expected === undefined) !== (actual === undefined) ||
            (expected !== undefined &&
              actual !== undefined &&
              Math.abs(expected - actual) > 0.035)
          )
            mismatches.push(`${(x * side).toFixed(1)},${z.toFixed(1)}`);
        }
    expect(
      mismatches,
      "Additional or displaced wing skin at these sampled coordinates",
    ).toEqual([]);
    const state = createFlight();
    aircraft.update(state, 0);
    aircraft.root.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) {
      const wheel = aircraft.root.getObjectByName(`wheel-${i}-1`)!;
      const bounds = new THREE.Box3().setFromObject(wheel);
      expect(bounds.min.y).toBeCloseTo(-GEAR_HEIGHT, 2);
    }
    const mounts = [0, 1, 2].map((i) =>
      aircraft!.root.getObjectByName(`gear-mount-${i}`)!.position.clone(),
    );
    state.gearPosition = 0.5;
    aircraft.update(state, 0);
    for (let i = 0; i < 3; i++)
      expect(
        aircraft.root
          .getObjectByName(`gear-mount-${i}`)!
          .position.equals(mounts[i]),
      ).toBe(true);
    expect(
      aircraft.root.getObjectByName("gear-leg-0")!.rotation.z,
    ).toBeGreaterThan(0);
    expect(
      aircraft.root.getObjectByName("gear-leg-1")!.rotation.z,
    ).toBeLessThan(0);
    expect(
      aircraft.root.getObjectByName("gear-leg-2")!.rotation.x,
    ).toBeLessThan(0);
    state.gearPosition = 0;
    aircraft.update(state, 0);
    expect(aircraft.root.getObjectByName("gear-leg-2")!.visible).toBe(false);
    const fan1 = aircraft.root.getObjectByName("engine-fan-1")!;
    const fan2 = aircraft.root.getObjectByName("engine-fan-2")!;
    const before1 = fan1.rotation.z,
      before2 = fan2.rotation.z;
    state.engines[0] = { phase: "starting", spool: 0.5 };
    aircraft.update(state, 0.2);
    expect(fan1.rotation.z).toBeGreaterThan(before1);
    expect(fan2.rotation.z).toBe(before2);
    expect(aircraft.root.getObjectByName("engine-turbine-1")!.rotation.z).toBe(
      fan1.rotation.z,
    );
    expect(aircraft.root.getObjectByName("engine-turbine-2")!.rotation.z).toBe(
      fan2.rotation.z,
    );
    state.battery = true;
    for (const [time, visible] of [
      [0.02, true],
      [0.1, false],
      [0.18, true],
      [0.4, false],
    ] as const) {
      state.elapsed = time;
      aircraft.update(state, 0);
      expect(aircraft.root.getObjectByName("strobe-0")!.visible).toBe(visible);
    }
  } finally {
    GLTFLoader.prototype.load = previous;
    aircraft?.dispose();
    referenceMesh.geometry.dispose();
  }
});

test("engine rotors sit inside the nacelles and light lenses touch the airframe", async () => {
  const scene = modelFixture();
  const previous = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (_url, onLoad) {
    queueMicrotask(() => onLoad({ scene } as unknown as GLTF));
  };
  const aircraft = new Aircraft();
  try {
    await expect.poll(() => aircraft.loaded).toBe(true);
    aircraft.root.updateMatrixWorld(true);
    const body = aircraft.root.children.find(
      (o) =>
        o instanceof THREE.Mesh &&
        !(o.geometry instanceof THREE.SphereGeometry),
    ) as THREE.Mesh;
    const ray = new THREE.Raycaster();
    for (const id of [1, 2]) {
      const fan = aircraft.root.getObjectByName(`engine-fan-${id}`)!;
      for (let i = 0; i < 8; i++) {
        const direction = new THREE.Vector3(
          Math.cos((i * Math.PI) / 4),
          Math.sin((i * Math.PI) / 4),
          0,
        );
        ray.set(
          fan.position.clone().addScaledVector(direction, 0.9),
          direction,
        );
        const wall = ray.intersectObject(body)[0];
        expect
          .soft(
            wall ? wall.distance + 0.9 : undefined,
            `Engine ${id} casing must surround rotor at angle ${i}`,
          )
          .toBeGreaterThan(0.9);
        expect
          .soft(
            wall ? wall.distance + 0.9 : undefined,
            `Engine ${id} casing must surround rotor at angle ${i}`,
          )
          .toBeLessThan(1.3);
      }
    }
    for (const id of [1, 2]) {
      for (const rear of [false, true]) {
        const rotor = aircraft.root.getObjectByName(
          `engine-${rear ? "turbine" : "fan"}-${id}`,
        );
        expect
          .soft(rotor, "Both ends of the engine must have rotating blades")
          .toBeDefined();
        if (!rotor) continue;
        const blade = rotor.children.find(
          (o) => o.name === "rotor-blade",
        ) as THREE.Mesh;
        const vertices = blade.geometry.getAttribute("position");
        const target = new THREE.Vector3();
        for (let k = 0; k < 3; k++)
          target.add(
            new THREE.Vector3().fromBufferAttribute(
              vertices,
              blade.geometry.index!.getX(k),
            ),
          );
        target.divideScalar(3).applyMatrix4(blade.matrixWorld);
        ray.set(
          target.clone().add(new THREE.Vector3(0, 0, rear ? 30 : -30)),
          new THREE.Vector3(0, 0, rear ? -1 : 1),
        );
        expect
          .soft(
            ray.intersectObject(aircraft.root, true)[0]?.object === blade,
            "Rotor blades must be visible through the opening",
          )
          .toBe(true);
      }
    }
    const p = body.geometry.getAttribute("position"),
      triangle = new THREE.Triangle(),
      nearest = new THREE.Vector3();
    for (const light of aircraft.root.children) {
      if (
        !(light instanceof THREE.Mesh) ||
        !(light.geometry instanceof THREE.SphereGeometry)
      )
        continue;
      let distance = Infinity;
      for (let i = 0; i < p.count; i += 3) {
        triangle.a.fromBufferAttribute(p, i);
        triangle.b.fromBufferAttribute(p, i + 1);
        triangle.c.fromBufferAttribute(p, i + 2);
        triangle.closestPointToPoint(light.position, nearest);
        if (Number.isFinite(nearest.x))
          distance = Math.min(distance, nearest.distanceTo(light.position));
      }
      expect
        .soft(
          distance,
          `${light.name || "navigation light"} lens must touch skin`,
        )
        .toBeLessThan(light.geometry.parameters.radius);
    }
  } finally {
    GLTFLoader.prototype.load = previous;
    aircraft.dispose();
  }
});
