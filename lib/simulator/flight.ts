// A forgiving, fixed-step flight model. Distances are metres, speeds m/s, angles radians.
// This is an entertainment model, not aircraft performance or training software.
export const AIRPORT_SPACING = 10_000;
export const RUNWAY_LENGTH = 2_800;
export const RUNWAY_WIDTH = 64;
export const FIELD_ELEVATION = 24;
export const GEAR_HEIGHT = 3.25;
export const RUNWAY_SURFACE = FIELD_ELEVATION + 0.21;
export const LANDING_GEAR = [
  { x: -2.4, z: 2.4, radius: 0.58 },
  { x: 2.4, z: 2.4, radius: 0.58 },
  { x: 0, z: -12.8, radius: 0.39 },
] as const;
// The visual gear uses these same wheel centers and radii. Account for pitch and
// bank when determining first contact, instead of testing a fixed fuselage height.
export function wheelClearance(pitch: number, bank: number) {
  return Math.max(
    ...LANDING_GEAR.map(
      (wheel) =>
        -(
          (-wheel.x * Math.sin(bank) +
            (-GEAR_HEIGHT + wheel.radius) * Math.cos(bank)) *
            Math.cos(pitch) -
          wheel.z * Math.sin(pitch) -
          wheel.radius
        ),
    ),
  );
}
export const KNOTS = 1.943844;
export const FEET = 3.28084;
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (v: number) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrap = (v: number) =>
  ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
export const hash = (x: number, z: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7 + 74.7) * 43758.5453123;
  return v - Math.floor(v);
};
export function noise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = smooth(x - ix),
    fz = smooth(z - iz);
  return lerp(
    lerp(hash(ix, iz), hash(ix + 1, iz), fx),
    lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz,
  );
}

export interface Airport {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  runway: string;
}
const names = [
  "Azure Coast",
  "Silver Bay",
  "Cape Meridian",
  "Coral Point",
  "Northhaven",
  "Emerald Isle",
  "Sierra Valley",
  "Bluewater",
];
export function airportAt(ix: number, iz: number): Airport {
  const origin = ix === 0 && iz === 0;
  const heading = origin
    ? 0
    : (Math.floor(hash(ix + 6, iz - 2) * 6) * Math.PI) / 6;
  const number = Math.round((heading * 180) / Math.PI / 10) || 36;
  return {
    id: `AX${(Math.abs(ix * 73 + iz * 31) % 900) + 100}`,
    name: origin ? names[0] : names[Math.floor(hash(ix, iz) * names.length)],
    x: ix * AIRPORT_SPACING,
    z: iz * AIRPORT_SPACING,
    heading,
    runway: String(number).padStart(2, "0"),
  };
}
export function nearbyAirports(x: number, z: number, radius = 1) {
  const ix = Math.round(x / AIRPORT_SPACING),
    iz = Math.round(z / AIRPORT_SPACING);
  const airports: Airport[] = [];
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++)
      airports.push(airportAt(ix + dx, iz + dz));
  return airports;
}
export function airportLocal(x: number, z: number, airport: Airport) {
  const dx = x - airport.x,
    dz = z - airport.z,
    c = Math.cos(airport.heading),
    s = Math.sin(airport.heading);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}
export function runwayAt(x: number, z: number): Airport | null {
  const airport = airportAt(
    Math.round(x / AIRPORT_SPACING),
    Math.round(z / AIRPORT_SPACING),
  );
  const local = airportLocal(x, z, airport);
  return Math.abs(local.x) < RUNWAY_WIDTH / 2 &&
    Math.abs(local.z) < RUNWAY_LENGTH / 2
    ? airport
    : null;
}
export function terrainHeight(x: number, z: number) {
  const broad = noise(x / 7000 + 16, z / 7000 - 8);
  const ridge = 1 - Math.abs(noise(x / 3400 + 8, z / 3400) * 2 - 1);
  const detail =
    noise(x / 750, z / 750) * 0.65 + noise(x / 280, z / 280) * 0.35;
  const base =
    (broad - 0.44) * 1500 +
    Math.pow(ridge, 5) * 900 * smooth((broad - 0.46) * 5) +
    detail * 70 -
    90;
  const airport = airportAt(
    Math.round(x / AIRPORT_SPACING),
    Math.round(z / AIRPORT_SPACING),
  );
  const local = airportLocal(x, z, airport);
  const edge = Math.hypot(
    Math.max(0, Math.abs(local.x) - 360),
    Math.max(0, Math.abs(local.z) - 1600),
  );
  return lerp(FIELD_ELEVATION, base, smooth(edge / 1700));
}

export type EnginePhase = "off" | "starting" | "running";
export type Lighting = "day" | "sunset" | "night";
export type CameraMode = "chase" | "cockpit";
export interface Engine {
  phase: EnginePhase;
  spool: number;
}
export interface FlightState {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  bank: number;
  speed: number;
  verticalSpeed: number;
  throttle: number;
  grounded: boolean;
  gear: boolean;
  gearPosition: number;
  flaps: number;
  flapPosition: number;
  spoilers: number;
  speedBrake: boolean;
  parkingBrake: boolean;
  brake: boolean;
  battery: boolean;
  engines: [Engine, Engine];
  crashed: boolean;
  crashReason: string;
  stalled: boolean;
  elapsed: number;
  distance: number;
  landingRate: number | null;
  landingCount: number;
}
export interface FlightInput {
  pitch: number;
  roll: number;
  rudder: number;
  brake: boolean;
}
export function createFlight(airborne = false): FlightState {
  return {
    x: 0,
    // Start airborne on a short, runway-aligned approach rather than high above
    // the airport so the player can practice landing right away.
    y: airborne ? RUNWAY_SURFACE + 120 : RUNWAY_SURFACE + GEAR_HEIGHT,
    z: airborne ? -3400 : 1080,
    heading: airborne ? Math.PI : 0,
    pitch: airborne ? -0.02 : 0,
    bank: 0,
    speed: airborne ? 78 : 0,
    verticalSpeed: airborne ? -2 : 0,
    throttle: airborne ? 0.25 : 0,
    grounded: !airborne,
    gear: true,
    gearPosition: 1,
    flaps: airborne ? 2 : 1,
    flapPosition: airborne ? 2 : 1,
    spoilers: 0,
    speedBrake: false,
    parkingBrake: !airborne,
    brake: false,
    battery: airborne,
    engines: [
      { phase: airborne ? "running" : "off", spool: airborne ? 1 : 0 },
      { phase: airborne ? "running" : "off", spool: airborne ? 1 : 0 },
    ],
    crashed: false,
    crashReason: "",
    stalled: false,
    elapsed: 0,
    distance: 0,
    landingRate: null,
    landingCount: 0,
  };
}
export function startEngine(s: FlightState, index: 0 | 1) {
  if (!s.battery || s.crashed) return false;
  if (s.engines[index].phase !== "off") return false;
  s.engines[index].phase = "starting";
  return true;
}
export function setGear(s: FlightState, down: boolean) {
  if (s.grounded && !down) return false;
  s.gear = down;
  return true;
}
export function stepFlight(s: FlightState, input: FlightInput, dt: number) {
  if (s.crashed) return;
  dt = clamp(dt, 0, 1 / 30);
  s.elapsed += dt;
  for (const engine of s.engines) {
    if (engine.phase === "starting") {
      if (!s.battery) engine.phase = "off";
      else {
        engine.spool = Math.min(1, engine.spool + dt / 24);
        if (engine.spool >= 1) engine.phase = "running";
      }
    }
    if (engine.phase === "off")
      engine.spool = Math.max(0, engine.spool - dt / 5);
  }
  s.gearPosition += clamp(Number(s.gear) - s.gearPosition, -dt / 4, dt / 4);
  s.flapPosition += clamp(s.flaps - s.flapPosition, -dt / 2, dt / 2);
  s.brake = input.brake || s.parkingBrake;
  const spoilerTarget = s.grounded
    ? s.brake && s.speed > 2
      ? 1
      : 0
    : s.speedBrake || input.brake
      ? 0.65
      : 0;
  s.spoilers = lerp(s.spoilers, spoilerTarget, 1 - Math.exp(-dt * 5));
  const power = s.engines.reduce(
    (sum, e) => sum + (e.phase === "running" ? 0.5 : 0),
    0,
  );
  const speed = Math.max(s.speed, 35);
  const pitchInput = clamp(input.pitch, -1, 1),
    rollInput = clamp(input.roll, -1, 1);
  const softenedRoll =
    Math.sign(rollInput) *
    Math.pow(Math.max(0, (Math.abs(rollInput) - 0.04) / 0.96), 1.6);
  const bankTarget = s.grounded ? 0 : softenedRoll * 0.56;
  s.bank += clamp((bankTarget - s.bank) * 1.3, -0.21, 0.21) * dt;
  // Releasing the stick holds pitch; a soft attitude limit keeps casual flying manageable.
  s.pitch = clamp(
    s.pitch +
      Math.sign(pitchInput) * Math.pow(Math.abs(pitchInput), 1.6) * dt * 0.085,
    -0.36,
    0.4,
  );
  if (s.grounded && s.speed < 60) s.pitch = lerp(s.pitch, 0, dt * 4);
  if (s.grounded && Math.abs(pitchInput) < 0.01)
    s.pitch = lerp(s.pitch, 0, dt * 0.9);
  if (s.grounded) s.pitch = clamp(s.pitch, 0, 0.23);
  const rudder = clamp(input.rudder, -1, 1);
  s.heading = wrap(
    s.heading +
      (s.grounded
        ? rudder * 0.35 * clamp(s.speed / 10, 0, 1)
        : (Math.tan(s.bank) * 9.81) / speed + rudder * 0.045) *
        dt,
  );
  const drag =
    0.09 +
    s.speed *
      s.speed *
      (0.000072 +
        s.gearPosition * 0.000047 +
        s.flapPosition * 0.000031 +
        s.spoilers * 0.00016);
  const thrust = power * (s.throttle * 3.35 + 0.12);
  const braking = s.grounded && s.brake ? 5.3 + s.spoilers * 1.4 : 0;
  const acceleration =
    thrust -
    drag -
    (s.grounded
      ? 0.1
      : 9.81 * Math.sin(Math.atan2(s.verticalSpeed, Math.max(s.speed, 1)))) -
    braking;
  s.speed = clamp(s.speed + acceleration * dt, 0, 245);
  const stallSpeed = 64 - s.flapPosition * 5;
  s.stalled = !s.grounded && s.speed < stallSpeed;
  // Lift opposes gravity. Angle of attack includes the descent path, so a gentle
  // nose-up flare increases lift and arrests the sink instead of snapping altitude.
  const flightPath = Math.atan2(s.verticalSpeed, Math.max(s.speed, 1));
  const alpha = clamp(s.pitch - flightPath, -0.2, 0.25);
  const liftRatio = clamp(
    (s.speed / 100) ** 2 *
      (0.86 + s.flapPosition * 0.38 + alpha * 10) *
      (1 - s.spoilers * 0.35),
    0,
    1.8,
  );
  if (
    s.grounded &&
    s.speed > stallSpeed + 2 &&
    s.pitch > 0.055 &&
    liftRatio > 1.02 &&
    !s.brake
  ) {
    s.grounded = false;
    s.verticalSpeed = 0.4;
    s.y += 0.05;
    s.landingRate = null;
  }
  if (!s.grounded) {
    s.verticalSpeed += 9.81 * (liftRatio * Math.cos(s.bank) - 1) * dt;
    s.y += s.verticalSpeed * dt;
  }
  const travel = s.speed * Math.cos(s.pitch) * dt;
  s.x += Math.sin(s.heading) * travel;
  s.z -= Math.cos(s.heading) * travel;
  s.distance += travel;
  const terrain = terrainHeight(s.x, s.z);
  const runway = runwayAt(s.x, s.z);
  const surface = runway ? RUNWAY_SURFACE : Math.max(0, terrain);
  const clearance =
    s.gearPosition >= 0.98
      ? wheelClearance(s.pitch, s.bank)
      : 2.7 + (GEAR_HEIGHT - 2.7) * s.gearPosition;
  if (s.grounded) {
    s.y = surface + wheelClearance(s.pitch, s.bank);
    s.verticalSpeed = 0;
    if (s.landingRate !== null && s.speed <= 5) s.landingRate = null;
    if (!runway && s.speed > 35)
      crash(s, terrain < 0 ? "Water landing" : "Runway excursion");
  } else if (s.y <= surface + clearance) {
    const impact = Math.abs(s.verticalSpeed);
    if (terrain < 0) crash(s, "Water landing");
    else if (!runway) crash(s, "Terrain contact — aim for a runway");
    else if (s.gearPosition < 0.98) crash(s, "Landing gear was not fully down");
    else if (
      impact > 6 ||
      Math.abs(s.bank) > 0.2 ||
      s.pitch < -0.14 ||
      s.pitch > 0.25
    )
      crash(s, "Hard landing — flare gently before touchdown");
    else {
      s.grounded = true;
      s.y = surface + clearance;
      s.verticalSpeed = 0;
      s.landingRate = Math.round(impact * FEET * 60);
      s.landingCount += 1;
      s.pitch = Math.max(0, s.pitch);
      s.bank = 0;
      s.y = surface + wheelClearance(s.pitch, s.bank);
      s.stalled = false;
    }
  }
}
function crash(s: FlightState, reason: string) {
  s.crashed = true;
  s.crashReason = reason;
  s.speed = 0;
  s.verticalSpeed = 0;
  s.throttle = 0;
}
export function nearestAirport(s: Pick<FlightState, "x" | "z">) {
  return nearbyAirports(s.x, s.z).sort(
    (a, b) =>
      Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z),
  )[0];
}
export function nextAirport(s: Pick<FlightState, "x" | "z" | "heading">) {
  return nearbyAirports(s.x, s.z, 2)
    .filter((a) => Math.hypot(a.x - s.x, a.z - s.z) > 2500)
    .sort((a, b) => {
      const score = (p: Airport) => {
        const dx = p.x - s.x,
          dz = p.z - s.z,
          dist = Math.hypot(dx, dz);
        const forward =
          (dx * Math.sin(s.heading) - dz * Math.cos(s.heading)) / dist;
        return dist * (1.4 - forward);
      };
      return score(a) - score(b);
    })[0];
}
