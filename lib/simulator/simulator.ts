import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CameraControls } from "./camera-controls";
import { Aircraft } from "./aircraft";
import { FlightAudio } from "./audio";
import { World } from "./world";
import {
  terrainHeight,
  createFlight,
  stepFlight,
  startEngine,
  setGear,
  clamp,
  nearestAirport,
  nextAirport,
  type FlightState,
  type FlightInput,
  type CameraMode,
  type Lighting,
  type Airport,
} from "./flight";

export interface Snapshot {
  flight: FlightState;
  camera: CameraMode;
  lighting: Lighting;
  paused: boolean;
  airport: Airport;
  destination: Airport;
  fps: number;
  audio: FlightAudio["status"];
  modelLoaded: boolean;
}
export type Action =
  | "battery"
  | "engine1"
  | "engine2"
  | "gear"
  | "flaps"
  | "speedbrake"
  | "parking"
  | "camera"
  | "resetCamera"
  | "pause";
export class Simulator {
  state = createFlight();
  readonly input: FlightInput = { pitch: 0, roll: 0, rudder: 0, brake: false };
  readonly audio = new FlightAudio();
  cameraMode: CameraMode = "chase";
  lighting: Lighting = "sunset";
  paused = false;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cameraControls: CameraControls;
  private camera = new THREE.PerspectiveCamera(48, 1, 1, 45000);
  private world: World;
  private aircraft: Aircraft;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private renderPass?: RenderPass;
  private outputPass?: OutputPass;
  private keys = new Set<string>();
  private frame = 0;
  private previousTime = 0;
  private accumulator = 0;
  private hudTime = 0;
  private fps = 60;
  private origin = new THREE.Vector3();
  private oldOrigin = new THREE.Vector3();
  private position = new THREE.Vector3();
  private cameraGoal = new THREE.Vector3();
  private lookGoal = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private observer: ResizeObserver;
  private mobile: boolean;
  private disposed = false;
  private readonly onLost: (event: Event) => void;

  constructor(
    private host: HTMLElement,
    private report: (snapshot: Snapshot) => void,
    onError: (message: string) => void,
  ) {
    this.mobile =
      window.innerWidth < 800 || window.matchMedia("(pointer: coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.mobile ? 1.25 : 1.65),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D flight world. Use the on-screen joystick or WASD to fly.",
    );
    this.host.appendChild(this.renderer.domElement);
    this.cameraControls = new CameraControls(
      this.renderer.domElement,
      () => this.cameraMode === "chase",
    );
    this.world = new World(this.scene, this.mobile);
    this.aircraft = new Aircraft();
    this.scene.add(this.aircraft.root);
    if (!this.mobile) {
      this.composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        0.22,
        0.65,
        1.1,
      );
      this.outputPass = new OutputPass();
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.outputPass);
    }
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.onLost = (event) => {
      event.preventDefault();
      this.setPaused(true);
      onError(
        "The 3D connection was interrupted. Reload to return to your aircraft.",
      );
    };
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.emit();
    this.frame = requestAnimationFrame(this.animate);
  }
  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
  };
  private keyDown = (event: KeyboardEvent) => {
    const target = event.target;
    // Range sliders are flight controls, so keeping focus must not disable WASD.
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        (target instanceof HTMLInputElement &&
          !["range", "checkbox", "button"].includes(target.type)))
    )
      return;
    // Preserve accessible native arrow-key adjustment of a focused slider.
    if (
      target instanceof HTMLInputElement &&
      target.type === "range" &&
      event.code.startsWith("Arrow")
    )
      return;
    const codes = [
      "KeyW",
      "KeyS",
      "KeyA",
      "KeyD",
      "KeyQ",
      "KeyE",
      "KeyB",
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Equal",
      "Minus",
      "KeyG",
      "KeyF",
      "KeyP",
      "KeyX",
      "KeyV",
      "Escape",
    ];
    if (!codes.includes(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;
    const actions: Record<string, Action> = {
      KeyG: "gear",
      KeyF: "flaps",
      KeyP: "parking",
      KeyX: "speedbrake",
      KeyV: "camera",
      Escape: "pause",
    };
    if (actions[event.code]) this.action(actions[event.code]);
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private blur = () => {
    this.keys.clear();
    this.input.pitch = 0;
    this.input.roll = 0;
    this.input.rudder = 0;
    this.input.brake = false;
  };
  private visibility = () => {
    if (document.hidden) {
      this.blur();
      this.setPaused(true);
    }
  };
  action(action: Action) {
    if (action === "resetCamera") {
      this.cameraControls.reset();
      return;
    }
    if (action === "camera") {
      this.cameraMode = this.cameraMode === "chase" ? "cockpit" : "chase";
      this.emit();
      return;
    }
    if (action === "pause") {
      this.setPaused(!this.paused);
      return;
    }
    if (this.state.crashed || this.paused) return;
    void this.audio.unlock();
    this.audio.effect("switch");
    const s = this.state;
    if (action === "battery") {
      s.battery = !s.battery;
      if (!s.battery) {
        for (const engine of s.engines) engine.phase = "off";
      }
    } else if (action === "engine1" || action === "engine2") {
      const index = action === "engine1" ? 0 : 1;
      if (s.engines[index].phase !== "off") {
        s.engines[index].phase = "off";
        this.audio.stopEngine(index);
      } else if (startEngine(s, index)) void this.audio.startEngine(index);
    } else if (action === "gear") {
      if (setGear(s, !s.gear)) this.audio.effect("gear");
    } else if (action === "flaps") {
      s.flaps = (s.flaps + 1) % 4;
      this.audio.effect("flaps");
    } else if (action === "speedbrake") s.speedBrake = !s.speedBrake;
    else if (action === "parking") s.parkingBrake = !s.parkingBrake;
    if (!s.engines.some((engine) => engine.phase === "running")) s.throttle = 0;
    this.emit();
  }
  setFlaps(value: number) {
    const flaps = Math.round(clamp(value, 0, 3));
    if (this.state.crashed || this.paused || this.state.flaps === flaps) return;
    void this.audio.unlock();
    this.state.flaps = flaps;
    this.audio.effect("flaps");
    this.emit();
  }
  setThrottle(value: number) {
    this.state.throttle = this.state.engines.some(
      (engine) => engine.phase === "running",
    )
      ? clamp(value, 0, 1)
      : 0;
    this.emit();
  }
  setLighting(mode: Lighting) {
    this.lighting = mode;
    this.world.setLighting(mode);
    this.renderer.toneMappingExposure = mode === "night" ? 1.25 : 1.12;
    if (this.bloom) this.bloom.strength = mode === "night" ? 0.48 : 0.2;
    this.emit();
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.audio.setPaused(value);
    this.blur();
    this.emit();
  }
  reset(airborne = false) {
    this.audio.reset();
    this.state = createFlight(airborne);
    this.paused = false;
    this.audio.setPaused(false);
    this.blur();
    this.accumulator = 0;
    if (airborne) void this.audio.unlock();
    this.emit();
  }
  private emit() {
    if (this.disposed) return;
    this.report({
      flight: {
        ...this.state,
        engines: this.state.engines.map((e) => ({
          ...e,
        })) as FlightState["engines"],
      },
      camera: this.cameraMode,
      lighting: this.lighting,
      paused: this.paused,
      airport: nearestAirport(this.state),
      destination: nextAirport(this.state),
      fps: Math.round(this.fps),
      audio: this.audio.status,
      modelLoaded: this.aircraft?.loaded ?? false,
    });
  }
  private animate = (time: number) => {
    if (this.disposed) return;
    const dt = this.previousTime
      ? Math.min((time - this.previousTime) / 1000, 0.1)
      : 1 / 60;
    this.previousTime = time;
    this.fps = THREE.MathUtils.lerp(this.fps, 1 / Math.max(dt, 0.001), 0.04);
    if (!this.paused) {
      const has = (key: string) => Number(this.keys.has(key));
      const input: FlightInput = {
        pitch: clamp(
          this.input.pitch +
            has("KeyS") +
            has("ArrowDown") -
            has("KeyW") -
            has("ArrowUp"),
          -1,
          1,
        ),
        roll: clamp(
          this.input.roll +
            has("KeyD") +
            has("ArrowRight") -
            has("KeyA") -
            has("ArrowLeft"),
          -1,
          1,
        ),
        rudder: clamp(this.input.rudder + has("KeyE") - has("KeyQ"), -1, 1),
        brake:
          this.input.brake || this.keys.has("Space") || this.keys.has("KeyB"),
      };
      this.state.throttle = this.state.engines.some(
        (engine) => engine.phase === "running",
      )
        ? clamp(
            this.state.throttle + (has("Equal") - has("Minus")) * dt * 0.3,
            0,
            1,
          )
        : 0;
      this.accumulator += dt;
      while (this.accumulator >= 1 / 60) {
        const landings = this.state.landingCount;
        stepFlight(this.state, input, 1 / 60);
        if (this.state.landingCount > landings) {
          this.audio.effect("touchdown");
          this.audio.effect("rollout");
        }
        this.accumulator -= 1 / 60;
      }
    }
    this.oldOrigin.copy(this.origin);
    this.origin.set(
      Math.floor(this.state.x / 5000) * 5000,
      0,
      Math.floor(this.state.z / 5000) * 5000,
    );
    this.offset.copy(this.oldOrigin).sub(this.origin);
    this.camera.position.add(this.offset);
    this.lookAt.add(this.offset);
    this.position.set(
      this.state.x - this.origin.x,
      this.state.y,
      this.state.z - this.origin.z,
    );
    this.world.update(
      this.state.x,
      this.state.z,
      this.origin,
      this.paused ? 0 : dt,
    );
    this.aircraft.root.position.copy(this.position);
    this.aircraft.update(this.state, this.paused ? 0 : dt);
    this.aircraft.root.visible = this.cameraMode !== "cockpit";
    if (this.cameraMode === "chase") {
      const { yaw, elevation, zoom } = this.cameraControls;
      const distance =
        zoom *
        Math.max(
          64,
          24 /
            (Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect),
        );
      this.offset
        .set(
          distance * Math.cos(elevation) * Math.sin(yaw),
          distance * Math.sin(elevation),
          distance * Math.cos(elevation) * Math.cos(yaw),
        )
        .applyAxisAngle(this.up, -this.state.heading);
      this.cameraGoal.copy(this.position).add(this.offset);
      const floor = terrainHeight(
        this.cameraGoal.x + this.origin.x,
        this.cameraGoal.z + this.origin.z,
      );
      this.cameraGoal.y = Math.max(this.cameraGoal.y, Math.max(0, floor) + 1.7);
      this.lookGoal.copy(this.position);
      this.camera.up.set(0, 1, 0);
    } else {
      this.offset.set(0, 1.4, -15.8).applyEuler(this.aircraft.root.rotation);
      this.cameraGoal.copy(this.position).add(this.offset);
      this.offset.set(0, 1.4, -200).applyEuler(this.aircraft.root.rotation);
      this.lookGoal.copy(this.position).add(this.offset);
      this.camera.up.set(0, 1, 0).applyEuler(this.aircraft.root.rotation);
    }
    // Keep a constant aircraft-relative view; world-space smoothing would lag
    // tens of metres behind at cruise and push the aircraft off centre.
    this.camera.position.copy(this.cameraGoal);
    this.lookAt.copy(this.lookGoal);
    this.camera.lookAt(this.lookAt);
    this.world.followLight(this.position);
    this.audio.update(this.state, this.cameraMode);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.hudTime += dt;
    if (this.hudTime >= 0.1) {
      this.hudTime = 0;
      this.emit();
    }
    this.frame = requestAnimationFrame(this.animate);
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.cameraControls.dispose();
    this.audio.dispose();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", this.onLost);
    this.aircraft.dispose();
    this.world.dispose();
    this.bloom?.dispose();
    this.renderPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
