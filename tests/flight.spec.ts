import { test, expect } from "@playwright/test";
import {
  createFlight,
  stepFlight,
  startEngine,
  setGear,
  runwayAt,
  airportAt,
  terrainHeight,
  FIELD_ELEVATION,
  GEAR_HEIGHT,
  RUNWAY_SURFACE,
  wheelClearance,
  type FlightState,
  type FlightInput,
} from "../lib/simulator/flight";

const neutral: FlightInput = { pitch: 0, roll: 0, rudder: 0, brake: false };

test("touchdown waits for wheel contact and leaves wheels on the runway", () => {
  const s = createFlight(true);
  Object.assign(s, {
    x: 0,
    z: 900,
    pitch: -0.02,
    bank: 0,
    speed: 67,
    gear: true,
    gearPosition: 1,
    flaps: 3,
    flapPosition: 3,
    verticalSpeed: -1,
    throttle: 0,
  });
  s.y = RUNWAY_SURFACE + wheelClearance(s.pitch, s.bank) + 0.07;
  stepFlight(s, neutral, 1 / 60);
  expect(s.landingCount).toBe(0);
  expect(s.y - wheelClearance(s.pitch, s.bank)).toBeGreaterThan(RUNWAY_SURFACE);
  for (let i = 0; i < 120 && !s.grounded; i++) stepFlight(s, neutral, 1 / 60);
  expect(s.landingCount).toBe(1);
  expect(s.y - wheelClearance(s.pitch, s.bank)).toBeCloseTo(RUNWAY_SURFACE, 5);
});

test("a one-second bank input rolls at a gentle rate", () => {
  const s = createFlight(true);
  for (let i = 0; i < 60; i++) stepFlight(s, { ...neutral, roll: 1 }, 1 / 60);
  expect((s.bank * 180) / Math.PI).toBeLessThanOrEqual(15);
  expect(s.bank).toBeGreaterThan(0);
});
function advance(state: FlightState, seconds: number, input = neutral) {
  for (let i = 0; i < seconds * 60; i++) stepFlight(state, input, 1 / 60);
}

test("cold start prerequisites, takeoff and gear interlock", () => {
  const s = createFlight();
  expect(startEngine(s, 0)).toBe(false);
  expect(setGear(s, false)).toBe(false);
  s.battery = true;
  advance(s, 4.1);
  expect(startEngine(s, 0)).toBe(true);
  expect(startEngine(s, 1)).toBe(true);
  advance(s, 24.1);
  expect(s.engines.every((e) => e.phase === "running")).toBe(true);
  s.parkingBrake = false;
  s.throttle = 1;
  for (let i = 0; i < 45 * 60 && !s.crashed; i++)
    stepFlight(
      s,
      { ...neutral, pitch: s.speed > 64 && s.pitch < 0.13 ? 1 : 0 },
      1 / 60,
    );
  expect(s.crashed, s.crashReason).toBe(false);
  expect(s.grounded).toBe(false);
  expect(s.y).toBeGreaterThan(FIELD_ELEVATION + GEAR_HEIGHT + 20);
  expect(setGear(s, false)).toBe(true);
});

test("gentle touchdown, automatic spoilers and wheel braking", () => {
  const s = createFlight(true);
  Object.assign(s, {
    x: 0,
    z: 900,
    y: FIELD_ELEVATION + GEAR_HEIGHT + 1,
    speed: 67,
    pitch: -0.025,
    gear: true,
    gearPosition: 1,
    flaps: 3,
    flapPosition: 3,
    throttle: 0,
    verticalSpeed: -1.5,
  });
  advance(s, 3);
  expect(s.crashed, s.crashReason).toBe(false);
  expect(s.landingCount).toBe(1);
  expect(s.grounded).toBe(true);
  expect(s.landingRate).toBeLessThan(500);
  const before = s.speed;
  advance(s, 1, { ...neutral, brake: true });
  expect(s.speed).toBeLessThan(before);
  expect(s.spoilers).toBeGreaterThan(0.9);
  advance(s, 20, { ...neutral, brake: true });
  expect(s.speed).toBe(0);
  expect(s.crashed).toBe(false);
});

test("gear-up landing and stall are detected", () => {
  const s = createFlight(true);
  s.z = 900;
  s.y = FIELD_ELEVATION + GEAR_HEIGHT + 0.1;
  s.pitch = -0.05;
  s.verticalSpeed = -3;
  advance(s, 1);
  expect(s.crashed).toBe(true);
  expect(s.crashReason).toContain("gear");
  const stalled = createFlight(true);
  stalled.speed = 35;
  stalled.throttle = 0;
  advance(stalled, 1);
  expect(stalled.stalled).toBe(true);
  expect(stalled.verticalSpeed).toBeLessThan(0);
});

test("distant and negative world coordinates produce level usable runways", () => {
  for (const [x, z] of [
    [0, 0],
    [1001, -802],
    [-504, 301],
  ]) {
    const airport = airportAt(x, z);
    expect(runwayAt(airport.x, airport.z)?.id).toBe(airport.id);
    expect(terrainHeight(airport.x, airport.z)).toBe(FIELD_ELEVATION);
    expect(airportAt(x, z)).toEqual(airport);
  }
});

test("pitch is gentle and an idle approach descends until the pilot flares", () => {
  const s = createFlight(true);
  advance(s, 1, { ...neutral, pitch: 1 });
  expect((s.pitch * 180) / Math.PI).toBeLessThan(5);
  const approach = createFlight(true);
  Object.assign(approach, {
    z: 900,
    speed: 69,
    throttle: 0,
    gear: true,
    gearPosition: 1,
    flaps: 3,
    flapPosition: 3,
    verticalSpeed: -2,
    y: 400,
  });
  advance(approach, 2);
  expect(approach.verticalSpeed).toBeLessThan(-1);
  const unflared = structuredClone(approach);
  advance(approach, 1.2, { ...neutral, pitch: 1 });
  advance(unflared, 1.2);
  expect(approach.verticalSpeed).toBeGreaterThan(unflared.verticalSpeed + 1);
  expect(approach.y).toBeGreaterThan(unflared.y);
});

test("airborne speed brakes add drag and reduce lift, then retract", () => {
  const clean = createFlight(true),
    braking = createFlight(true);
  braking.speedBrake = true;
  advance(clean, 4);
  advance(braking, 4);
  expect(braking.speed).toBeLessThan(clean.speed - 2);
  expect(braking.verticalSpeed).toBeLessThan(clean.verticalSpeed);
  expect(braking.spoilers).toBeCloseTo(0.65, 2);
  braking.speedBrake = false;
  advance(braking, 2);
  expect(braking.spoilers).toBeLessThan(0.01);
  advance(braking, 1, { ...neutral, brake: true });
  expect(braking.spoilers).toBeGreaterThan(0.6);
});
