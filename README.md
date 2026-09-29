# Astra Flight Simulator

A desktop-first browser flight simulator with an unbranded Airbus A320, an endless procedural landscape, airports every 10 km, and day, sunset, and night lighting. Touch controls also support mobile browsers.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:3000. For a production build, run `npm run build` and `npm start`. The build uses Next.js's supported Webpack path; the local Turbopack production worker encountered a port-permission error during development.

## First flight

1. Turn **BATTERY** on.
2. Start both engines. Each takes 24 seconds to spool up.
3. Release the parking brake with **P**. Move thrust to full.
4. At about 130 knots, gently pull the joystick down or hold **S** to lift the nose.
5. Press **G** to retract the gear and **F** to cycle the flaps.

The **Start airborne** button skips startup. On approach, use 130–150 knots, gear down, full flaps, and a gentle descent. Flare near the runway, reduce thrust, then hold brakes. Spoilers deploy automatically while braking on the ground. In flight, press **X** to toggle speed brakes or hold **Space/B**; retract them before the flare. Lift opposes gravity, so idle approaches descend and raising the nose gently reduces the sink.

| Control    | Action                                     |
| ---------- | ------------------------------------------ |
| W / S      | Nose down / up                             |
| A / D      | Bank left / right                          |
| Q / E      | Rudder and ground steering                 |
| − / +      | Throttle                                   |
| G / F      | Landing gear / flap setting                |
| Space / B  | Hold ground brakes / airborne speed brakes |
| X          | Toggle airborne speed brakes               |
| P          | Parking brake                              |
| V / Escape | Camera / pause                             |

The default rear-quarter camera shows the underside in flight. Drag the scenery to orbit, scroll or pinch to zoom, and use **Reset view** to return to the default angle. Press **V** or **Switch camera view** to enter the cockpit. On-screen controls provide the same flight actions. Landscape gives mobile users more room. Leaving the browser tab pauses the flight.

## Audio

Audio begins after a user gesture. Real A320 startup excerpts and aircraft mechanical recordings are cleaned offline with spectral noise reduction, filtering, midrange attenuation, normalization, and fades. A crossfaded A320 turbine excerpt also supplies the continuous engine layer; it is a sound-design adaptation, not a recording of a full-throttle takeoff. It blends with quiet generated turbine, wind, switch, and brake sounds. The mix has a compressor and volume slider. A quieter recorded turbine loop follows thrust gradually; synthetic noise and whine are kept low.

Cabin chatter overlaps engine frequencies, so it cannot be removed perfectly with this processing. Turn **Recorded sounds** off in Sound settings for a fully synthesized mix without recorded cabin noise. Gear hydraulics are quietly synthesized and follow actual gear movement. Flap and tire recordings are credited separately and are not all A320 recordings.

Processed clips ship locally (about 1 MB total); normal flights need no third-party sound requests. `npm run audio:prepare` downloads the credited public previews into ignored `.audio-source/` and rebuilds the clips. See [asset credits](public/credits.md), including the startup recording's **noncommercial** license.

## Check

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

The tests use installed Google Chrome. Playwright checks desktop startup and controls, browser audio decoding, lighting, camera switching, and mobile touch layout. Flight scenarios check takeoff, landing, braking, spoilers, stall, gear interlocks, and distant runways. Browser screenshots are written to ignored `test-results/`.

## Implementation

- Next.js / React for the flight deck; Three.js for the 3D world.
- Fixed 60 Hz flight integration with simplified lift, drag, bank turns, stall, and touchdown detection.
- Streaming terrain chunks, bounded runway resources, and a moving coordinate origin keep long flights practical.
- Attached retractable gear, native wing flaps/spoilers, spool-driven fans, and double-flash strobes; distant-visible runway lights.
- Complementary coastline meshes avoid overlapping land and water surfaces.
- Desktop shadows and bloom; reduced rendering resolution and no bloom on mobile.

The flight model is made for free-flight entertainment. Cockpit view is a forward flight view with a simplified instrument overlay, not a fully modeled A320 flight deck. It does not reproduce certified aircraft performance or full aircraft systems. Mobile was checked in a Chrome touch/viewport emulation; real-device performance depends on the GPU and WebGL 2 support.
