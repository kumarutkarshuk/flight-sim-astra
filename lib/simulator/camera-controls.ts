import { clamp } from "./flight";

/** An aircraft-relative orbit that stays where the pilot leaves it. */
export class CameraControls {
  yaw = 0;
  elevation = 0.2;
  zoom = 0.9;
  private pointers = new Map<number, { x: number; y: number }>();

  constructor(
    private canvas: HTMLCanvasElement,
    private enabled: () => boolean,
  ) {
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    canvas.addEventListener("lostpointercapture", this.up);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
  }
  reset() {
    this.yaw = 0;
    this.elevation = 0.2;
    this.zoom = 0.9;
  }
  private spread() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  private down = (event: PointerEvent) => {
    if (!this.enabled() || event.button !== 0 || this.pointers.size >= 2)
      return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.setPointerCapture(event.pointerId);
  };
  private move = (event: PointerEvent) => {
    const before = this.pointers.get(event.pointerId);
    if (!before || !this.enabled()) return;
    const distance = this.spread();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const next = this.spread();
      if (distance > 1 && next > 1)
        this.zoom = clamp((this.zoom * distance) / next, 0.65, 2.5);
    } else {
      this.yaw -= (event.clientX - before.x) * 0.005;
      this.elevation = clamp(
        this.elevation + (event.clientY - before.y) * 0.005,
        -0.65,
        1.2,
      );
    }
  };
  private up = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
  };
  private wheel = (event: WheelEvent) => {
    if (!this.enabled()) return;
    event.preventDefault();
    const pixels =
      event.deltaY *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? this.canvas.clientHeight
          : 1);
    this.zoom = clamp(
      this.zoom * Math.exp(clamp(pixels, -500, 500) * 0.001),
      0.65,
      2.5,
    );
  };
  dispose() {
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.up);
    this.canvas.removeEventListener("lostpointercapture", this.up);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.pointers.clear();
  }
}
