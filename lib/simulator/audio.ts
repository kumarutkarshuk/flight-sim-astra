import { clamp, type FlightState, type CameraMode } from "./flight";

type Sample =
  "engine1" | "engine2" | "turbofan" | "flaps" | "touchdown" | "rollout";
const files: Record<Sample, string> = {
  engine1: "/audio/engine-1.mp3",
  engine2: "/audio/engine-2.mp3",
  turbofan: "/audio/turbofan.mp3",
  flaps: "/audio/flaps.mp3",
  touchdown: "/audio/touchdown.mp3",
  rollout: "/audio/rollout.mp3",
};

/** All sound stays behind the first user gesture. Recordings and synthesized layers are
 * credited separately in public/credits.md. A compressor controls the final mix. */
export class FlightAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private windGain?: GainNode;
  private wheelGain?: GainNode;
  private gearGain?: GainNode;
  private gearMoving = false;
  private engineFilter?: BiquadFilterNode;
  private turbine?: OscillatorNode;
  private turbineGain?: GainNode;
  private recordedEngine?: AudioBufferSourceNode;
  private recordedEngineGain?: GainNode;
  private samples = new Map<Sample, AudioBuffer>();
  private pending?: Promise<void>;
  private sources = new Set<AudioBufferSourceNode>();
  private startups: (AudioBufferSourceNode | null)[] = [null, null];
  private engineGeneration = [0, 0];
  private requests = new AbortController();
  private recordings = true;
  private volume = 0.85;
  private disposed = false;
  private paused = false;
  private lastWarning = 0;
  private loops: AudioBufferSourceNode[] = [];
  status: "idle" | "loading" | "ready" | "partial" = "idle";

  async unlock() {
    if (this.disposed) return;
    if (!this.context) this.initialize();
    if (this.context?.state === "suspended") await this.context.resume();
    if (!this.pending) {
      this.status = "loading";
      this.pending = Promise.allSettled(
        Object.entries(files).map(async ([name, url]) => {
          const response = await fetch(url, { signal: this.requests.signal });
          if (!response.ok)
            throw new Error(`Audio ${name}: ${response.status}`);
          const buffer = await this.context!.decodeAudioData(
            await response.arrayBuffer(),
          );
          if (!this.disposed) this.samples.set(name as Sample, buffer);
        }),
      ).then((results) => {
        this.status = results.every((r) => r.status === "fulfilled")
          ? "ready"
          : "partial";
        if (!this.disposed) this.prepareEngineLoop();
      });
    }
    await this.pending;
  }
  private prepareEngineLoop() {
    const ctx = this.context,
      raw = this.samples.get("turbofan");
    if (!ctx || !raw || !this.master) return;
    const overlap = Math.min(
      Math.floor(raw.sampleRate * 1.5),
      Math.floor(raw.length / 4),
    );
    const buffer = ctx.createBuffer(
      raw.numberOfChannels,
      raw.length - overlap,
      raw.sampleRate,
    );
    for (let channel = 0; channel < raw.numberOfChannels; channel++) {
      const input = raw.getChannelData(channel),
        output = buffer.getChannelData(channel);
      output.set(input.subarray(overlap));
      for (let i = 0; i < overlap; i++) {
        const mix = i / overlap;
        output[output.length - overlap + i] =
          input[raw.length - overlap + i] * (1 - mix) + input[i] * mix;
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
    this.recordedEngine = source;
    this.recordedEngineGain = gain;
    this.loops.push(source);
  }
  private initialize() {
    const ctx = new AudioContext();
    this.context = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 1.7;
    this.master.connect(compressor);
    compressor.connect(ctx.destination);
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.04) / 1.02;
      data[i] = brown * 3.4;
    }
    const noiseLayer = (cutoff: number) => {
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master!);
      source.start();
      this.loops.push(source);
      return { gain, filter };
    };
    const engine = noiseLayer(600);
    this.engineGain = engine.gain;
    this.engineFilter = engine.filter;
    this.windGain = noiseLayer(1700).gain;
    this.wheelGain = noiseLayer(200).gain;
    const gear = noiseLayer(420);
    gear.filter.type = "bandpass";
    gear.filter.Q.value = 0.65;
    this.gearGain = gear.gain;
    this.turbine = ctx.createOscillator();
    this.turbine.type = "sine";
    this.turbine.frequency.value = 110;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbine.connect(this.turbineGain);
    this.turbineGain.connect(this.master);
    this.turbine.start();
  }
  setVolume(value: number) {
    this.volume = clamp(value, 0, 1);
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.paused ? 0 : this.volume * 1.7,
        this.context.currentTime,
        0.05,
      );
  }
  setRecordings(enabled: boolean) {
    this.recordings = enabled;
    if (!enabled) this.reset();
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!this.context) return;
    if (paused) void this.context.suspend();
    else {
      this.setVolume(this.volume);
      void this.context.resume();
    }
  }
  private play(name: Sample, gain = 1, offset = 0, duration?: number) {
    const ctx = this.context,
      buffer = this.samples.get(name);
    if (!ctx || !buffer || !this.master || this.disposed || !this.recordings)
      return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const level = ctx.createGain();
    level.gain.value = gain;
    source.connect(level);
    level.connect(this.master);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      level.disconnect();
    };
    source.start(0, Math.min(offset, buffer.duration - 0.1), duration);
    return source;
  }
  async startEngine(index: number) {
    this.stopEngine(index);
    const generation = this.engineGeneration[index];
    await this.unlock();
    if (this.disposed || generation !== this.engineGeneration[index]) return;
    // Denoised, equalized excerpts; their final fade blends into the turbine bed.
    this.startups[index] = this.play(index === 0 ? "engine1" : "engine2", 1.1);
  }
  stopEngine(index: number) {
    this.engineGeneration[index] += 1;
    try {
      this.startups[index]?.stop();
    } catch {
      /* A finished source is already silent. */
    }
    this.startups[index] = null;
  }
  effect(name: "gear" | "flaps" | "touchdown" | "rollout" | "switch") {
    if (name === "switch") {
      this.click();
      return;
    }
    // Gear audio follows actuator motion in update(), including direction changes.
    if (name === "gear") return;
    if (!this.play(name, name === "touchdown" ? 0.6 : 0.8)) this.hydraulic(1.8);
  }
  private click() {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(360, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.035);
    gain.gain.setValueAtTime(0.13, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  private hydraulic(duration: number) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 83;
    filter.frequency.value = 260;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.055, ctx.currentTime + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  update(s: FlightState, camera: CameraMode) {
    const ctx = this.context;
    if (!ctx || this.paused) return;
    const moving =
      !s.crashed && Math.abs(Number(s.gear) - s.gearPosition) > 0.003;
    this.gearGain?.gain.setTargetAtTime(
      moving ? 0.09 : 0,
      ctx.currentTime,
      0.16,
    );
    if (this.gearMoving && !moving && !s.crashed) this.click();
    this.gearMoving = moving;
    const running = s.engines.reduce(
      (n, e) => n + (e.phase === "running" ? 0.5 : 0),
      0,
    );
    const starting = s.engines.reduce(
      (n, e) => n + (e.phase === "starting" ? e.spool * 0.18 : 0),
      0,
    );
    const engine = s.crashed
      ? 0
      : running * (0.012 + s.throttle * 0.035) + starting * 0.35;
    const cabin = camera === "cockpit" ? 0.72 : 1;
    this.engineGain!.gain.setTargetAtTime(engine * cabin, ctx.currentTime, 0.8);
    this.recordedEngineGain?.gain.setTargetAtTime(
      this.recordings && !s.crashed
        ? running * (0.2 + s.throttle * 0.22) * cabin
        : 0,
      ctx.currentTime,
      1.2,
    );
    this.recordedEngine?.playbackRate.setTargetAtTime(
      0.88 + s.throttle * 0.26,
      ctx.currentTime,
      1.8,
    );
    this.engineFilter!.frequency.setTargetAtTime(
      250 + s.throttle * 500,
      ctx.currentTime,
      0.2,
    );
    this.turbine!.frequency.setTargetAtTime(
      110 + s.throttle * 140 + starting * 180,
      ctx.currentTime,
      1.2,
    );
    this.turbineGain!.gain.setTargetAtTime(
      engine * 0.012,
      ctx.currentTime,
      0.8,
    );
    this.windGain!.gain.setTargetAtTime(
      s.crashed ? 0 : (s.speed / 200) * 0.055 * cabin,
      ctx.currentTime,
      0.15,
    );
    this.wheelGain!.gain.setTargetAtTime(
      s.grounded && !s.crashed
        ? Math.min(1, s.speed / 65) * (s.brake ? 0.12 : 0.045)
        : 0,
      ctx.currentTime,
      0.1,
    );
    for (let i = 0; i < 2; i++)
      if (s.engines[i].phase === "off") this.stopEngine(i);
    if (s.stalled && ctx.currentTime - this.lastWarning > 1.6) {
      this.hydraulic(0.55);
      this.lastWarning = ctx.currentTime;
    }
  }
  reset() {
    this.gearMoving = false;
    if (this.context)
      this.gearGain?.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
    this.engineGeneration[0] += 1;
    this.engineGeneration[1] += 1;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.startups = [null, null];
  }
  dispose() {
    this.disposed = true;
    this.requests.abort();
    this.reset();
    for (const loop of this.loops) loop.stop();
    this.turbine?.stop();
    void this.context?.close();
  }
}
