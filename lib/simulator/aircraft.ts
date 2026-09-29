import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { FlightState } from "./flight";
import { AircraftRig } from "./aircraft-rig";

export class Aircraft {
  readonly root = new THREE.Group();
  private rig?: AircraftRig;
  private navigation: THREE.Mesh[] = [];
  private strobes: THREE.Mesh[] = [];
  private beacons: THREE.Mesh[] = [];
  private disposed = false;
  private owned = new Set<THREE.Material>();
  private textures: THREE.Texture[] = [];
  private fallback = new THREE.Group();
  loaded = false;

  constructor() {
    const white = this.material(0xe9edf1),
      metal = this.material(0xa9b4c4, 0.65),
      rubber = this.material(0x141822);
    // A small silhouette remains available if the local GLB cannot be decoded.
    const fuselage = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.9, 31, 8, 24),
      white,
    );
    fuselage.rotation.x = Math.PI / 2;
    this.fallback.add(fuselage);
    for (const sign of [-1, 1]) {
      const wing = this.polygon(
        [
          [sign * 1.6, -1, -2],
          [sign * 17.5, 0, 7],
          [sign * 16.5, 0, 8.5],
          [sign * 2, -1, 5],
        ],
        white,
      );
      this.fallback.add(wing);
    }
    this.root.add(this.fallback);
    new GLTFLoader().load(
      "/models/a320.glb",
      (gltf) => {
        if (this.disposed) {
          this.disposeObject(gltf.scene);
          return;
        }
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const geometry = obj.geometry.clone();
          geometry.applyMatrix4(obj.matrixWorld);
          geometry.rotateY(Math.PI / 2);
          geometry.translate(0, 0, -3);
          const material = (obj.material as THREE.MeshStandardMaterial).clone();
          material.roughness = 0.38;
          material.metalness = 0.18;
          material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vAirframe;",
              )
              .replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nvAirframe = position;",
              );
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vAirframe;",
              )
              .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
            if (diffuseColor.b > diffuseColor.r * 1.3 && diffuseColor.g > diffuseColor.r * 1.35 && diffuseColor.g > 0.12) diffuseColor.rgb = vec3(0.89, 0.92, 0.97);
            if (diffuseColor.b > diffuseColor.r * 1.3 && diffuseColor.b > diffuseColor.g * 1.15) diffuseColor.rgb = vec3(0.12, 0.17, 0.22);
          `,
              );
          };
          this.rig = new AircraftRig(geometry, material, white, metal, rubber);
          const mesh = new THREE.Mesh(this.rig.body, material);
          this.root.add(this.rig.root);
          this.attachLights(geometry);
          geometry.dispose();
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.owned.add(material);
          if (material.map) this.textures.push(material.map);
          this.root.add(mesh);
        });
        this.root.remove(this.fallback);
        this.disposeObject(this.fallback);
        gltf.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.loaded = true;
      },
      undefined,
      () => {
        /* Keep the visible procedural fallback. */
      },
    );

    for (const sign of [-1, 1]) {
      // Seed locations are projected onto the loaded wingtip skin.
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 8, 8),
        new THREE.MeshBasicMaterial({
          color: sign < 0 ? 0xff3344 : 0x59ffb4,
          toneMapped: false,
        }),
      );
      light.position.set(sign * 17.65, 1.45, 3.05);
      light.name = `navigation-${sign < 0 ? "left" : "right"}`;
      this.navigation.push(light);
      this.root.add(light);
      this.owned.add(light.material);
      const strobe = new THREE.Mesh(
        new THREE.SphereGeometry(0.065, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      );
      strobe.position.set(sign * 17.6, 1.55, 3.4);
      this.root.add(strobe);
      this.strobes.push(strobe);
      this.owned.add(strobe.material);
    }
    const tailStrobe = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    );
    tailStrobe.position.set(0, 0.35, 18.85);
    this.root.add(tailStrobe);
    this.strobes.push(tailStrobe);
    this.owned.add(tailStrobe.material);
    const strobeGlow = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(650./max(-p.z,1.),5.,18.);}`,
      fragmentShader: `void main(){float d=length(gl_PointCoord-.5)*2.;float glow=pow(max(0.,1.-d),2.);gl_FragColor=vec4(vec3(3.),glow);}`,
    });
    this.owned.add(strobeGlow);
    this.strobes.forEach((strobe, i) => {
      strobe.name = `strobe-${i}`;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0], 3),
      );
      strobe.add(new THREE.Points(geometry, strobeGlow));
    });
    for (const y of [2.0, -1.85]) {
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff2a30, toneMapped: false }),
      );
      beacon.position.set(0, y, 1);
      beacon.name = `beacon-${y > 0 ? "top" : "bottom"}`;
      this.root.add(beacon);
      this.beacons.push(beacon);
      this.owned.add(beacon.material);
    }
  }
  /** Seat each lens into the closest skin triangle, including the asymmetric
   * wingtips and tapered tail. Only a small part of the lens protrudes. */
  private attachLights(source: THREE.BufferGeometry) {
    const geometry = source.index ? source.toNonIndexed() : source;
    const positions = geometry.getAttribute("position");
    const triangle = new THREE.Triangle();
    const candidate = new THREE.Vector3();
    for (const light of [
      ...this.navigation,
      ...this.strobes,
      ...this.beacons,
    ]) {
      const closest = new THREE.Vector3();
      let distance = Infinity;
      for (let i = 0; i < positions.count; i += 3) {
        triangle.a.fromBufferAttribute(positions, i);
        triangle.b.fromBufferAttribute(positions, i + 1);
        triangle.c.fromBufferAttribute(positions, i + 2);
        if (triangle.getArea() < 1e-10) continue;
        triangle.closestPointToPoint(light.position, candidate);
        const d = candidate.distanceToSquared(light.position);
        if (d < distance) {
          distance = d;
          closest.copy(candidate);
        }
      }
      const outward = light.position.clone().sub(closest).normalize();
      light.position.copy(closest).addScaledVector(outward, 0.025);
    }
    if (geometry !== source) geometry.dispose();
  }
  private material(color: number, metalness = 0.1) {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness,
      side: THREE.DoubleSide,
    });
    this.owned.add(m);
    return m;
  }
  private polygon(points: number[][], material: THREE.Material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points.flat(), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }
  update(s: FlightState, dt = 1 / 60) {
    this.rig?.update(s, dt);
    for (const beacon of this.beacons)
      beacon.visible = s.battery && s.elapsed % 1.3 < 0.12;
    const flash = s.elapsed % 1.15;
    for (const strobe of this.strobes)
      strobe.visible =
        s.battery && (flash < 0.065 || (flash > 0.16 && flash < 0.225));
    this.root.rotation.set(s.pitch, -s.heading, -s.bank, "YXZ");
  }
  private disposeObject(object: THREE.Object3D) {
    object.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points)
        o.geometry.dispose();
    });
  }
  dispose() {
    this.disposed = true;
    this.disposeObject(this.root);
    this.disposeObject(this.fallback);
    for (const m of this.owned) m.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
