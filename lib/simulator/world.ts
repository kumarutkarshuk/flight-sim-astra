import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  AIRPORT_SPACING,
  FIELD_ELEVATION,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  airportAt,
  hash,
  noise,
  terrainHeight,
  type Airport,
  type Lighting,
} from "./flight";

import { splitCoast } from "./coast";

const CHUNK = 2400;
const vertexShader = `varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export class World {
  readonly root = new THREE.Group();
  readonly sky: THREE.Mesh;
  readonly ocean: THREE.Mesh;
  readonly ambient = new THREE.HemisphereLight(0xb6d7f7, 0x50543e, 2.2);
  readonly sun = new THREE.DirectionalLight(0xffe6ba, 3);
  private chunks = new Map<string, THREE.Group>();
  private airports = new Map<string, THREE.Group>();
  private queue: [number, number][] = [];
  private cell = "";
  private terrainMaterial: THREE.MeshStandardMaterial;
  private treeMaterial = new THREE.MeshStandardMaterial({
    color: 0x344e37,
    roughness: 1,
  });
  private trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5b4c38,
    roughness: 1,
  });
  private treeGeometry = new THREE.ConeGeometry(1, 1, 5);
  private trunkGeometry = new THREE.CylinderGeometry(0.13, 0.2, 1, 5);
  private cloudMaterial: THREE.SpriteMaterial;
  private cloudGroups = new Map<string, THREE.Group>();
  private runwayMaterial = new THREE.MeshStandardMaterial({
    color: 0x303841,
    roughness: 0.98,
  });
  private concreteMaterial = new THREE.MeshStandardMaterial({
    color: 0x767e7d,
    roughness: 1,
  });
  private markingMaterial = new THREE.MeshStandardMaterial({
    color: 0xe4e6dc,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0xa9b1ab,
    roughness: 0.75,
  });
  private glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x294c58,
    metalness: 0.3,
    roughness: 0.25,
  });
  private lightMaterial: THREE.ShaderMaterial;
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private runwayNumbers = new Map<string, THREE.MeshStandardMaterial>();
  private windsockMaterial = new THREE.MeshStandardMaterial({
    color: 0xf18b45,
    side: THREE.DoubleSide,
  });
  private time = 0;
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();
  private shadowAnchor = new THREE.Vector3();
  private night = false;
  private radius: number;

  constructor(
    private scene: THREE.Scene,
    mobile: boolean,
  ) {
    this.radius = mobile ? 3 : 4;
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vGround;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvGround = position;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
        varying vec3 vGround;
        float grain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      `,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
        float detail=grain(floor(vGround.xz*.65));
        float groundPatch=sin(vGround.x*.028)*sin(vGround.z*.024);
        float footprint=max(length(dFdx(vGround.xz)),length(dFdy(vGround.xz)));
        float resolved=1.-smoothstep(.5,2.,footprint);
        diffuseColor.rgb*=mix(.96,.86+detail*.2,resolved)+groundPatch*.06;
      `,
        );
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDirection: {
          value: new THREE.Vector3(0.45, 0.15, -0.8).normalize(),
        },
        night: { value: 0 },
      },
      vertexShader,
      fragmentShader: `
      varying vec3 vPosition; uniform vec3 zenith,horizon,sunColor,sunDirection; uniform float night;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        vec3 d=normalize(vPosition); float h=max(d.y,0.); vec3 col=mix(horizon,zenith,pow(h,.48));
        float sunDot=dot(d,sunDirection); float halo=pow(max(sunDot,0.),26.);
        col+=sunColor*halo*.22; col+=sunColor*pow(max(sunDot,0.),600.)*.5;
        col+=vec3(1.,.9,.72)*smoothstep(.99984,.99994,sunDot)*(1.-night)*4.;
        vec2 starUV=vec2(atan(d.x,d.z),asin(d.y))*250.;vec2 starCell=floor(starUV);
        float star=step(.993,hash(starCell))*pow(max(0.,1.-length(fract(starUV)-.5)*2.),10.);
        col+=vec3(star)*night*step(.08,d.y)*1.5;
        float moon=smoothstep(.99978,.9999,sunDot); col+=vec3(.7,.8,1.)*moon*night*1.2;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(35000, 32, 20), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    const waterMat = new THREE.ShaderMaterial({
      transparent: false,
      uniforms: {
        time: { value: 0 },
        originOffset: { value: new THREE.Vector2() },
        night: { value: 0 },
        sunDirection: {
          value: new THREE.Vector3(0.45, 0.15, -0.8).normalize(),
        },
        tint: { value: new THREE.Color(0x306b79) },
      },
      vertexShader: `varying vec3 vWorld; varying vec3 vView; void main(){vec4 w=modelMatrix*vec4(position,1.); vWorld=w.xyz;vView=cameraPosition-w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:
        `varying vec3 vWorld,vView; uniform float time,night; uniform vec3 tint,sunDirection; uniform vec2 originOffset;
        void main(){vec2 p=vWorld.xz+originOffset;float a=sin(p.x*.025+time*.7)*cos(p.y*.021+time*.5);float b=sin(p.x*.13-time*1.1)*cos(p.y*.09+time*.8);
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        b*=1.-smoothstep(4.,18.,footprint);
        float resolved=1.-smoothstep(12.,70.,footprint);a*=resolved;
        vec3 n=normalize(vec3(a*.13+b*.07,1.,cos(p.x*.032+time*.6)*.12*resolved)); vec3 v=normalize(vView);
        float fresnel=pow(1.-max(dot(v,n),0.),3.);vec3 col=mix(tint*.43,tint*1.15,fresnel);
        float spec=pow(max(dot(reflect(-sunDirection,n),v),0.),190.);
        col+=mix(vec3(2.,1.35,.6),vec3(.22,.3,.5),night)*spec*.7;
        col+=b*.008; float fog=1.-exp(-length(vView)*.000075);col=mix(col,mix(vec3(.60,.65,.64),vec3(.025,.047,.083),night),fog*.68);
        gl_FragColor=vec4(col,1.);#include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`.replace(";#include", ";\n#include"),
    });
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(120000, 120000),
      waterMat,
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = -20;
    scene.add(this.ocean);
    const glow = this.makeGlow();
    this.lightMaterial = new THREE.ShaderMaterial({
      uniforms: { glow: { value: glow }, night: { value: 0 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `varying vec3 vColor; uniform float night;
        void main(){vColor=color;vec4 v=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*v;
        gl_PointSize=clamp(4800./max(-v.z,1.),mix(.8,2.2,night),mix(5.,12.,night));}`,
      fragmentShader: `varying vec3 vColor; uniform sampler2D glow; uniform float night;
        void main(){vec4 g=texture2D(glow,gl_PointCoord);gl_FragColor=vec4(vColor*mix(.65,1.6,night),g.a*.8);}`,
    });
    this.cloudMaterial = new THREE.SpriteMaterial({
      map: this.makeCloud(),
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
      color: 0xfff5e6,
      fog: true,
    });
    this.sun.castShadow = !mobile;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -130;
    this.sun.shadow.camera.right = 130;
    this.sun.shadow.camera.top = 130;
    this.sun.shadow.camera.bottom = -130;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1200;
    this.sun.shadow.normalBias = 0.15;
    this.sun.shadow.bias = -0.0002;
    scene.add(this.root, this.ambient, this.sun, this.sun.target);
    this.materials = [
      this.terrainMaterial,
      this.treeMaterial,
      this.trunkMaterial,
      this.runwayMaterial,
      this.concreteMaterial,
      this.markingMaterial,
      this.buildingMaterial,
      this.glassMaterial,
      this.lightMaterial,
      this.cloudMaterial,
      skyMat,
      waterMat,
    ];
    this.materials.push(this.windsockMaterial);
    this.setLighting("sunset");
  }
  private makeGlow() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "white");
    g.addColorStop(0.12, "rgba(255,255,255,.95)");
    g.addColorStop(0.35, "rgba(255,255,255,.25)");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    this.textures.push(texture);
    return texture;
  }
  private makeCloud() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 45; i++) {
      const x = 70 + hash(i, 4) * 360,
        y = 115 + hash(i, 3) * 60,
        r = 25 + hash(i, 8) * 63;
      const g = ctx.createRadialGradient(x, y - r * 0.25, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,.27)");
      g.addColorStop(0.45, "rgba(240,245,249,.2)");
      g.addColorStop(1, "rgba(220,230,240,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }
  setLighting(mode: Lighting) {
    this.night = mode === "night";
    const p =
      mode === "day"
        ? {
            sky: 0x529aca,
            horizon: 0xc4dce1,
            sun: 0xfff6df,
            elev: 0.78,
            intensity: 3.1,
            ambient: 2.4,
            fog: 0xb8cbd0,
            water: 0x25657b,
          }
        : mode === "sunset"
          ? {
              sky: 0x597aa5,
              horizon: 0xecc5a3,
              sun: 0xffb86e,
              elev: 0.13,
              intensity: 3.2,
              ambient: 1.65,
              fog: 0xc7b6a7,
              water: 0x426b79,
            }
          : {
              sky: 0x020713,
              horizon: 0x18283e,
              sun: 0x92afe4,
              elev: 0.4,
              intensity: 0.55,
              ambient: 0.65,
              fog: 0x0c192b,
              water: 0x102637,
            };
    const sky = (this.sky.material as THREE.ShaderMaterial).uniforms;
    sky.zenith.value.setHex(p.sky);
    sky.horizon.value.setHex(p.horizon);
    sky.sunColor.value.setHex(p.sun);
    sky.sunDirection.value.set(0.6, p.elev, -0.8).normalize();
    sky.night.value = Number(this.night);
    const water = (this.ocean.material as THREE.ShaderMaterial).uniforms;
    water.night.value = Number(this.night);
    water.tint.value.setHex(p.water);
    water.sunDirection.value.copy(sky.sunDirection.value);
    this.ambient.intensity = p.ambient;
    this.ambient.color.setHex(this.night ? 0x6685bf : 0xb4d2e9);
    this.sun.intensity = p.intensity;
    this.sun.color.setHex(p.sun);
    this.scene.fog = new THREE.FogExp2(p.fog, this.night ? 0.00016 : 0.000083);
    this.cloudMaterial.color.setHex(
      this.night ? 0x64748a : mode === "sunset" ? 0xffd7b4 : 0xffffff,
    );
    this.cloudMaterial.opacity = this.night ? 0.3 : 0.8;
    this.lightMaterial.uniforms.night.value = Number(this.night);
    this.buildingMaterial.emissive.setHex(this.night ? 0x1c242a : 0x000000);
    this.glassMaterial.emissive.setHex(this.night ? 0xd6923f : 0x000000);
    this.glassMaterial.emissiveIntensity = this.night ? 0.8 : 0;
  }
  update(x: number, z: number, origin: THREE.Vector3, dt: number) {
    this.time += dt;
    this.root.position.set(-origin.x, 0, -origin.z);
    this.ocean.position.x = x - origin.x;
    this.ocean.position.z = z - origin.z;
    (
      this.ocean.material as THREE.ShaderMaterial
    ).uniforms.originOffset.value.set(origin.x, origin.z);
    (this.ocean.material as THREE.ShaderMaterial).uniforms.time.value =
      this.time;
    const cx = Math.floor(x / CHUNK),
      cz = Math.floor(z / CHUNK),
      cell = `${cx},${cz}`;
    if (cell !== this.cell) {
      this.cell = cell;
      const wanted = new Set<string>();
      const queue: [number, number][] = [];
      for (let dx = -this.radius; dx <= this.radius; dx++)
        for (let dz = -this.radius; dz <= this.radius; dz++) {
          const key = `${cx + dx},${cz + dz}`;
          wanted.add(key);
          if (!this.chunks.has(key)) queue.push([cx + dx, cz + dz]);
        }
      queue.sort(
        (a, b) =>
          Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz),
      );
      this.queue = queue;
      for (const [key, chunk] of this.chunks)
        if (!wanted.has(key)) {
          this.root.remove(chunk);
          this.disposeGroup(chunk);
          this.chunks.delete(key);
        }
      this.syncAirports(x, z);
      this.syncClouds(cx, cz);
    }
    for (let i = 0; i < 2 && this.queue.length; i++) {
      const [ix, iz] = this.queue.shift()!;
      const chunk = this.makeChunk(ix, iz);
      this.chunks.set(`${ix},${iz}`, chunk);
      this.root.add(chunk);
    }
  }
  followLight(position: THREE.Vector3) {
    const direction = (this.sky.material as THREE.ShaderMaterial).uniforms
      .sunDirection.value as THREE.Vector3;
    // Lock the shadow projection to texels in world space, including origin shifts.
    this.lightRight.set(0, 1, 0).cross(direction).normalize();
    this.lightUp.copy(direction).cross(this.lightRight).normalize();
    this.shadowAnchor.copy(position).sub(this.root.position);
    const texel = 260 / this.sun.shadow.mapSize.x;
    for (const axis of [this.lightRight, this.lightUp]) {
      const coordinate = this.shadowAnchor.dot(axis);
      this.shadowAnchor.addScaledVector(
        axis,
        Math.round(coordinate / texel) * texel - coordinate,
      );
    }
    this.shadowAnchor.add(this.root.position);
    this.sun.position.copy(this.shadowAnchor).addScaledVector(direction, 500);
    this.sun.target.position.copy(this.shadowAnchor);
    this.sky.position.copy(position);
  }
  private makeChunk(ix: number, iz: number) {
    const group = new THREE.Group();
    group.position.set(ix * CHUNK, 0, iz * CHUNK);
    const segments = 36,
      geometry = new THREE.PlaneGeometry(CHUNK, CHUNK, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(CHUNK / 2, 0, CHUNK / 2);
    const p = geometry.attributes.position,
      colors = new Float32Array(p.count * 3),
      color = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + ix * CHUNK,
        z = p.getZ(i) + iz * CHUNK,
        h = terrainHeight(x, z);
      p.setY(i, h);
      const patch = noise(x / 180, z / 180);
      if (h < 5) color.setHex(0xb0aa80);
      else if (h < 50) color.setHex(patch > 0.5 ? 0x727b50 : 0x7f865a);
      else if (h < 300) color.setHex(patch > 0.48 ? 0x566847 : 0x68754d);
      else if (h < 720) color.setHex(0x6c7161);
      else color.setHex(h > 1100 ? 0xc6c7c0 : 0x83867b);
      color.multiplyScalar(0.9 + patch * 0.16);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const coast = splitCoast(geometry);
    geometry.dispose();
    const ground = new THREE.Mesh(coast.ground, this.terrainMaterial);
    group.add(new THREE.Mesh(coast.sea, this.ocean.material));
    ground.receiveShadow = true;
    group.add(ground);
    const trees: THREE.Matrix4[] = [],
      trunks: THREE.Matrix4[] = [],
      dummy = new THREE.Object3D();
    for (let i = 0; i < 100; i++) {
      const lx = hash(ix * 137 + i, iz * 93) * CHUNK,
        lz = hash(ix * 19 + i, iz * 71 + 5) * CHUNK,
        x = ix * CHUNK + lx,
        z = iz * CHUNK + lz,
        h = terrainHeight(x, z);
      const a = airportAt(
        Math.round(x / AIRPORT_SPACING),
        Math.round(z / AIRPORT_SPACING),
      );
      if (h < 35 || h > 650 || Math.hypot(x - a.x, z - a.z) < 1900) continue;
      const size = 8 + hash(i, ix + iz) * 14;
      dummy.position.set(lx, h + size * 0.57, lz);
      dummy.scale.set(size * 0.24, size, size * 0.24);
      dummy.updateMatrix();
      trees.push(dummy.matrix.clone());
      dummy.position.y = h + size * 0.2;
      dummy.scale.set(size * 0.22, size * 0.5, size * 0.22);
      dummy.updateMatrix();
      trunks.push(dummy.matrix.clone());
    }
    if (trees.length) {
      const mesh = new THREE.InstancedMesh(
          this.treeGeometry,
          this.treeMaterial,
          trees.length,
        ),
        trunk = new THREE.InstancedMesh(
          this.trunkGeometry,
          this.trunkMaterial,
          trunks.length,
        );
      trees.forEach((m, i) => mesh.setMatrixAt(i, m));
      trunks.forEach((m, i) => trunk.setMatrixAt(i, m));
      group.add(mesh, trunk);
    }
    return group;
  }
  private syncClouds(cx: number, cz: number) {
    const wanted = new Set<string>();
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const ix = cx + dx,
          iz = cz + dz,
          key = `${ix},${iz}`;
        if (hash(ix + 90, iz) < 0.68) continue;
        wanted.add(key);
        if (this.cloudGroups.has(key)) continue;
        const group = new THREE.Group();
        group.position.set(
          (ix + hash(ix + 12, iz)) * CHUNK,
          1800 + hash(ix + 4, iz) * 1500,
          (iz + hash(ix, iz + 27)) * CHUNK,
        );
        const sprite = new THREE.Sprite(this.cloudMaterial);
        sprite.scale.set(
          1300 + hash(ix + 9, iz) * 2100,
          550 + hash(ix, iz + 3) * 400,
          1,
        );
        group.add(sprite);
        this.root.add(group);
        this.cloudGroups.set(key, group);
      }
    for (const [key, group] of this.cloudGroups)
      if (!wanted.has(key)) {
        this.root.remove(group);
        this.cloudGroups.delete(key);
      }
  }
  private syncAirports(x: number, z: number) {
    const ix = Math.round(x / AIRPORT_SPACING),
      iz = Math.round(z / AIRPORT_SPACING),
      wanted = new Set<string>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${ix + dx},${iz + dz}`;
        wanted.add(key);
        if (!this.airports.has(key)) {
          const a = airportAt(ix + dx, iz + dz),
            group = this.makeAirport(a);
          this.airports.set(key, group);
          this.root.add(group);
        }
      }
    for (const [key, group] of this.airports)
      if (!wanted.has(key)) {
        this.root.remove(group);
        this.disposeGroup(group);
        this.airports.delete(key);
      }
  }
  private makeAirport(a: Airport) {
    const group = new THREE.Group();
    group.position.set(a.x, FIELD_ELEVATION + 0.12, a.z);
    group.rotation.y = -a.heading;
    const slab = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    slab(RUNWAY_WIDTH + 0.8, 0.18, RUNWAY_LENGTH, 0, 0, 0, this.runwayMaterial);
    slab(22, 0.12, RUNWAY_LENGTH - 180, 130, -0.02, 0, this.concreteMaterial);
    slab(250, 0.12, 480, 240, -0.015, 700, this.concreteMaterial);
    for (const z of [-1100, 0, 1120])
      slab(120, 0.12, 23, 75, -0.01, z, this.concreteMaterial);
    const marks: THREE.BufferGeometry[] = [];
    const mark = (w: number, d: number, x: number, z: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.105, z);
      marks.push(g);
    };
    mark(1.0, RUNWAY_LENGTH - 14, -30, 0);
    mark(1.0, RUNWAY_LENGTH - 14, 30, 0);
    for (let z = -1300; z < 1300; z += 64) mark(1.4, 28, 0, z);
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 8; i++) mark(2.5, 38, -23 + i * 6.5, sign * 1335);
      for (const side of [-1, 1]) {
        mark(6, 44, side * 17, sign * 1000);
        for (let i = 0; i < 3; i++)
          mark(2, 26, side * (13 + i * 3.5), sign * 740);
      }
      const label =
        sign === 1
          ? a.runway
          : String(((Number(a.runway) + 17) % 36) + 1).padStart(2, "0");
      const mat = this.runwayNumber(label);
      const number = new THREE.Mesh(new THREE.PlaneGeometry(17, 27), mat);
      number.rotation.x = -Math.PI / 2;
      number.rotation.z = sign === 1 ? 0 : Math.PI;
      number.position.set(0, 0.12, sign * 1250);
      group.add(number);
    }
    const merged = mergeGeometries(marks);
    marks.forEach((g) => g.dispose());
    if (merged) group.add(new THREE.Mesh(merged, this.markingMaterial));
    const positions: number[] = [],
      colors: number[] = [];
    const point = (x: number, y: number, z: number, color: number) => {
      positions.push(x, y, z);
      const c = new THREE.Color(color);
      colors.push(c.r, c.g, c.b);
    };
    for (let z = -1390; z <= 1390; z += 45) {
      point(-34, 0.45, z, 0xffebbe);
      point(34, 0.45, z, 0xffebbe);
      point(0, 0.18, z, Math.abs(z) > 950 ? 0xff6554 : 0xffffed);
      point(143, 0.4, z, 0x387dff);
    }
    for (const sign of [-1, 1]) {
      for (let x = -30; x <= 30; x += 5) point(x, 0.35, sign * 1390, 0x68ff9a);
      for (let j = 1; j <= 12; j++)
        for (let k = -1; k <= 1; k++)
          point(
            k * 4,
            0.4,
            sign * (1400 + j * 32),
            j < 3 ? 0xffe7b3 : 0xfff6dd,
          );
      for (let i = 0; i < 4; i++)
        point(-46 - i * 5, 0.65, sign * 1000, i < 2 ? 0xff3333 : 0xffffff);
    }
    const lightGeo = new THREE.BufferGeometry();
    lightGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    lightGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    group.add(new THREE.Points(lightGeo, this.lightMaterial));
    const terminal = slab(135, 12, 40, 255, 6, 730, this.buildingMaterial);
    terminal.castShadow = true;
    slab(137, 3, 43, 255, 13, 730, this.markingMaterial);
    slab(130, 6, 1, 255, 7, 708.8, this.glassMaterial);
    for (let i = 0; i < 3; i++) {
      slab(34, 15, 42, 265, 7.5, 460 + i * 59, this.buildingMaterial);
      slab(35, 1.2, 43, 265, 15.4, 460 + i * 59, this.markingMaterial);
    }
    slab(8, 32, 8, 185, 16, 970, this.buildingMaterial);
    slab(16, 7, 16, 185, 34, 970, this.glassMaterial);
    slab(19, 1.3, 19, 185, 38.2, 970, this.markingMaterial);
    // Windsock: a readable warm accent beside the runway.
    slab(0.24, 10, 0.24, -65, 5, 1120, this.markingMaterial);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 5, 10, 1, true),
      this.windsockMaterial,
    );
    sock.rotation.z = -Math.PI / 2;
    sock.position.set(-62.5, 10, 1120);
    group.add(sock);
    return group;
  }
  private runwayNumber(label: string) {
    const cached = this.runwayNumbers.get(label);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e5e5dc";
    ctx.font = "bold 126px Arial";
    ctx.textAlign = "center";
    ctx.fillText(label, 64, 143);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(mat);
    this.runwayNumbers.set(label, mat);
    return mat;
  }
  private disposeGroup(group: THREE.Group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh))
        obj.geometry.dispose();
      else if (obj instanceof THREE.Points) obj.geometry.dispose();
      else if (obj instanceof THREE.InstancedMesh) obj.dispose();
    });
  }
  dispose() {
    for (const group of this.chunks.values()) this.disposeGroup(group);
    for (const group of this.airports.values()) this.disposeGroup(group);
    this.treeGeometry.dispose();
    this.trunkGeometry.dispose();
    this.sky.geometry.dispose();
    this.ocean.geometry.dispose();
    this.sun.shadow.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const texture of this.textures) texture.dispose();
    this.scene.remove(
      this.root,
      this.sky,
      this.ocean,
      this.sun,
      this.sun.target,
      this.ambient,
    );
  }
}
