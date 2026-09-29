"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  Simulator,
  type Snapshot,
  type Action,
} from "@/lib/simulator/simulator";
import {
  createFlight,
  nearestAirport,
  nextAirport,
  nearbyAirports,
  KNOTS,
  FEET,
  type Lighting,
} from "@/lib/simulator/flight";

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plane: (
      <path d="m12 2 2 7 7 4v2l-7-2v5l2 2v1l-4-1-4 1v-1l2-2v-5l-7 2v-2l7-4z" />
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    sunset: (
      <path d="M3 17h18M5 21h14M6 13a6 6 0 0 1 12 0M12 2v3M3 6l2 2m14 0 2-2" />
    ),
    moon: <path d="M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z" />,
    volume: (
      <path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
    ),
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 4 13 8-13 8z" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="m8 6 1-3h6l1 3" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    arrow: <path d="M5 19 19 5M5 5h14v14" />,
    gear: (
      <>
        <path d="M12 3v13m-6-4h12M6 12v5m12-5v5" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
        <circle cx="12" cy="19" r="2" />
      </>
    ),
    flaps: <path d="m3 9 18-4-2 6-7 1-4 6-5 1zM12 12l7 5 2-6" />,
    brake: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M3 6a11 11 0 0 0 0 12M21 6a11 11 0 0 1 0 12M12 8v5m0 3h.01" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-3 5-5 3 3-5z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    reset: <path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.plane}
    </svg>
  );
}
const initialFlight = createFlight();
const initial: Snapshot = {
  flight: initialFlight,
  camera: "chase",
  lighting: "sunset",
  paused: false,
  airport: nearestAirport(initialFlight),
  destination: nextAirport(initialFlight),
  fps: 60,
  audio: "idle",
  modelLoaded: false,
};
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [keyboard, setKeyboard] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);
  const keys = useRef(new Set<string>());
  const visiblePosition = {
    x: position.x + keyboard.x,
    y: position.y + keyboard.y,
  };
  const visibleLength = Math.hypot(visiblePosition.x, visiblePosition.y);
  if (visibleLength > 1) {
    visiblePosition.x /= visibleLength;
    visiblePosition.y /= visibleLength;
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointer.current !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect(),
      r = rect.width * 0.36;
    let x = (e.clientX - rect.left - rect.width / 2) / r,
      y = (e.clientY - rect.top - rect.height / 2) / r;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setPosition({ x, y });
    onChange(x, y);
  }
  function release() {
    pointer.current = null;
    setPosition({ x: 0, y: 0 });
    onChange(0, 0);
  }
  useEffect(() => {
    const updateKeyboard = () => {
      const held = keys.current;
      let x =
        Number(held.has("KeyD") || held.has("ArrowRight")) -
        Number(held.has("KeyA") || held.has("ArrowLeft"));
      let y =
        Number(held.has("KeyS") || held.has("ArrowDown")) -
        Number(held.has("KeyW") || held.has("ArrowUp"));
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      setKeyboard({ x, y });
    };
    const keyDown = (event: KeyboardEvent) => {
      if (
        ![
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
        ].includes(event.code)
      )
        return;
      keys.current.add(event.code);
      updateKeyboard();
    };
    const keyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
      updateKeyboard();
    };
    const blur = () => {
      keys.current.clear();
      updateKeyboard();
      release();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  });
  return (
    <div
      className="joystick"
      role="group"
      aria-label="Flight joystick. Drag down to raise the nose, left or right to bank. Keyboard: WASD."
      onPointerDown={(e) => {
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="joystick-ring" />
      <div className="joystick-axis horizontal" />
      <div className="joystick-axis vertical" />
      <span className="joystick-north">W</span>
      <span className="joystick-south">S</span>
      <span className="joystick-west">A</span>
      <span className="joystick-east">D</span>
      <div
        className="joystick-stick"
        style={{
          transform: `translate(${visiblePosition.x * 31}px,${visiblePosition.y * 31}px)`,
        }}
      >
        <span />
      </div>
    </div>
  );
}
function EngineGauge({
  spool,
  throttle,
  phase,
  index,
}: {
  spool: number;
  throttle: number;
  phase: string;
  index: number;
}) {
  const n1 = phase === "running" ? 20 + throttle * 75 : spool * 20;
  return (
    <div className={`engine-gauge ${phase === "running" ? "running" : ""}`}>
      <svg viewBox="0 0 90 69" aria-hidden="true">
        <path className="gauge-track" d="M16 57 A34 34 0 1 1 74 57" />
        <path
          className="gauge-fill"
          d="M16 57 A34 34 0 1 1 74 57"
          pathLength="100"
          strokeDasharray={`${Math.max(1, n1)} 100`}
        />
        <path className="gauge-tick" d="M45 3v6M13 20l5 3m59-3-5 3" />
      </svg>
      <strong>
        {Math.round(n1)}
        <small>%</small>
      </strong>
      <span>ENG {index}</span>
    </div>
  );
}
function AirspaceMap({ snapshot }: { snapshot: Snapshot }) {
  const s = snapshot.flight,
    airports = nearbyAirports(s.x, s.z);
  const map = (x: number, z: number) => ({
    x: 112 + (x - s.x) / 110,
    y: 95 + (z - s.z) / 110,
  });
  const d = map(snapshot.destination.x, snapshot.destination.z);
  return (
    <svg
      className="airspace-map"
      viewBox="0 0 224 172"
      role="img"
      aria-label="Nearby runway map, north up"
    >
      <defs>
        <radialGradient id="mapGlow">
          <stop stopColor="#b9dfdf" stopOpacity=".10" />
          <stop offset="1" stopColor="#b9dfdf" stopOpacity="0" />
        </radialGradient>
        <clipPath id="mapClip">
          <rect width="224" height="172" rx="8" />
        </clipPath>
      </defs>
      <g clipPath="url(#mapClip)">
        <rect width="224" height="172" fill="url(#mapGlow)" />
        <path
          d="M0 43h224M0 86h224M0 129h224M56 0v172M112 0v172M168 0v172"
          className="map-grid"
        />
        <circle cx="112" cy="95" r="35" className="map-ring" />
        <circle cx="112" cy="95" r="70" className="map-ring" />
        <path d={`M112 95 ${d.x} ${d.y}`} className="map-route" />
        {airports.map((a, i) => {
          const p = map(a.x, a.z);
          return (
            <g key={i} transform={`translate(${p.x},${p.y})`}>
              <circle r="9" fill="#8dd8c1" opacity=".10" />
              <path
                d="M0-5v10"
                stroke="#8dd8c1"
                strokeWidth="3"
                transform={`rotate(${(a.heading * 180) / Math.PI})`}
              />
              <text x="9" y="3">
                {a.id}
              </text>
            </g>
          );
        })}
        <g
          transform={`translate(112,95) rotate(${(s.heading * 180) / Math.PI})`}
        >
          <path
            d="M0-10 3-1 10 3v2L3 3v5l2 2-5-1-5 1 2-2V3l-7 2V3l7-4z"
            fill="#fafcff"
          />
        </g>
      </g>
      <text x="112" y="12" textAnchor="middle" className="map-north">
        N
      </text>
      <text x="8" y="163" className="map-scale">
        10 KM
      </text>
      <path d="M8 148v4h35v-4" className="map-grid" />
    </svg>
  );
}

export default function FlightDeck() {
  const host = useRef<HTMLDivElement>(null),
    sim = useRef<Simulator | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(initial),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  const [modal, setModal] = useState<"help" | "credits" | null>(null),
    [soundOpen, setSoundOpen] = useState(false),
    [volume, setVolume] = useState(0.85),
    [recordings, setRecordings] = useState(true),
    [systemsOpen, setSystemsOpen] = useState(true),
    [mapOpen, setMapOpen] = useState(true);
  useEffect(() => {
    if (!host.current) return;
    let frame = 0;
    try {
      const engine = new Simulator(host.current, setSnapshot, setError);
      sim.current = engine;
      frame = requestAnimationFrame(() => setReady(true));
      return () => {
        cancelAnimationFrame(frame);
        engine.dispose();
        sim.current = null;
      };
    } catch (err) {
      frame = requestAnimationFrame(() =>
        setError(
          err instanceof Error
            ? err.message
            : "Your browser could not start the 3D renderer.",
        ),
      );
    }
    return () => cancelAnimationFrame(frame);
  }, []);
  const s = snapshot.flight,
    action = (a: Action) => sim.current?.action(a),
    enginesReady = s.engines.every((e) => e.phase === "running");
  const step = !s.battery
    ? 0
    : s.engines[0].phase !== "running"
      ? 1
      : s.engines[1].phase !== "running"
        ? 2
        : 3;
  const distance =
      Math.hypot(s.x - snapshot.airport.x, s.z - snapshot.airport.z) / 1852,
    nextDistance =
      Math.hypot(s.x - snapshot.destination.x, s.z - snapshot.destination.z) /
      1852;
  const heading = (Math.round((s.heading * 180) / Math.PI) % 360 || 360)
    .toString()
    .padStart(3, "0");
  const stateLabel = s.crashed
    ? "FLIGHT ENDED"
    : snapshot.paused
      ? "PAUSED"
      : s.stalled
        ? "STALL WARNING"
        : !enginesReady
          ? "PREFLIGHT"
          : s.grounded
            ? s.speed > 5
              ? "ON THE RUNWAY"
              : "READY TO TAXI"
            : "IN FLIGHT";
  const startHints = [
    "Turn on the battery to power your aircraft.",
    s.engines[0].phase === "starting"
      ? "Engine 1 is spooling up. Listen to the turbines."
      : "Start engine 1. Your flight is getting closer.",
    s.engines[1].phase === "starting"
      ? "Engine 2 is spooling up. Almost ready."
      : "Start engine 2 to complete the sequence.",
    "Release the parking brake, set full throttle, then pull back at 130 kt.",
  ];
  function hold(
    e: ReactPointerEvent<HTMLButtonElement>,
    kind: "brake" | "rudder",
    value: number,
  ) {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (sim.current) {
      if (kind === "brake") sim.current.input.brake = Boolean(value);
      else sim.current.input.rudder = value;
    }
  }
  function release(kind: "brake" | "rudder") {
    if (sim.current) {
      if (kind === "brake") sim.current.input.brake = false;
      else sim.current.input.rudder = 0;
    }
  }
  function openModal(value: "help" | "credits") {
    setModal(value);
    sim.current?.setPaused(true);
  }
  function closeModal() {
    setModal(null);
    sim.current?.setPaused(false);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* Optional on mobile Safari. */
    }
  }
  return (
    <main
      data-aircraft-ready={snapshot.modelLoaded}
      className={`flight-app ${snapshot.lighting} ${snapshot.camera === "cockpit" ? "cockpit-mode" : ""}`}
    >
      <section className="mobile-desktop-prompt" aria-labelledby="mobile-prompt-title">
        <div className="mobile-desktop-prompt-card">
          <span className="brand-icon" aria-hidden="true">
            <Icon name="plane" size={25} />
          </span>
          <p className="mobile-prompt-eyebrow">ASTRA FLIGHT SIMULATOR</p>
          <h1 id="mobile-prompt-title">Please switch to desktop</h1>
          <p className="mobile-prompt-copy">
            Astra is designed for a larger screen. Open this page on a desktop to
            start your flight.
          </p>
        </div>
      </section>
      <div className="world-canvas" ref={host} />
      <div className="scene-vignette" />
      {snapshot.camera === "cockpit" && (
        <div className="cockpit-frame" aria-hidden="true">
          <div className="cockpit-pillar left" />
          <div className="cockpit-pillar right" />
          <div className="glareshield" />
        </div>
      )}
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Astra flight simulator">
          <span className="brand-icon">
            <Icon name="plane" size={25} />
          </span>
          <span>
            astra<span className="brand-dot">.</span>
            <small>FLIGHT SIMULATOR</small>
          </span>
        </Link>
        {/* <div className="flight-identity">
          <span className="live-dot" /> FREE FLIGHT
        </div> */}
        <div className="header-actions">
          <div className="lighting-selector" aria-label="Time of day">
            {(["day", "sunset", "night"] as Lighting[]).map((mode) => (
              <button
                key={mode}
                className={snapshot.lighting === mode ? "active" : ""}
                title={`${mode} lighting`}
                aria-label={`${mode} lighting`}
                aria-pressed={snapshot.lighting === mode}
                onClick={() => sim.current?.setLighting(mode)}
              >
                <Icon
                  name={
                    mode === "day"
                      ? "sun"
                      : mode === "night"
                        ? "moon"
                        : "sunset"
                  }
                  size={17}
                />
                <span>{mode}</span>
              </button>
            ))}
          </div>
          <div className="sound-wrap">
            <button
              className={`icon-button ${soundOpen ? "selected" : ""}`}
              title="Sound settings"
              aria-label="Sound settings"
              aria-expanded={soundOpen}
              onClick={() => setSoundOpen(!soundOpen)}
            >
              <Icon name="volume" />
            </button>
            {soundOpen && (
              <div className="sound-popover glass">
                <div className="popover-heading">
                  <strong>Sound</strong>
                  <span>{Math.round(volume * 100)}%</span>
                </div>
                <input
                  aria-label="Master volume"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(volume * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    setVolume(v);
                    sim.current?.audio.setVolume(v);
                  }}
                />
                <p>Balanced mix · noise-reduced recordings</p>
                <button
                  aria-pressed={recordings}
                  onClick={() => {
                    setRecordings(!recordings);
                    sim.current?.audio.setRecordings(!recordings);
                  }}
                >
                  Recorded sounds <strong>{recordings ? "ON" : "OFF"}</strong>
                </button>
                <p>
                  Switch off for a fully synthesized mix without cabin chatter.
                </p>
                <button onClick={() => openModal("credits")}>
                  Sound & asset credits <Icon name="arrow" size={13} />
                </button>
              </div>
            )}
          </div>
          <button
            className="icon-button help-trigger"
            title="Flight guide"
            aria-label="Flight guide"
            onClick={() => openModal("help")}
          >
            <Icon name="help" />
          </button>
          <button
            className="icon-button pause-trigger"
            title="Pause (Esc)"
            aria-label={snapshot.paused ? "Resume flight" : "Pause flight"}
            onClick={() => action("pause")}
          >
            <Icon name={snapshot.paused ? "play" : "pause"} />
          </button>
        </div>
      </header>
      <div className="telemetry">
        <div className="flight-status">
          <span className={`status-dot ${s.stalled ? "warning" : ""}`} />
          {stateLabel}
        </div>
        <div className="flight-instruments">
          <div className="instrument">
            <span className="eyebrow">AIRSPEED</span>
            <div>
              <strong>
                {String(Math.round(s.speed * KNOTS)).padStart(3, "0")}
              </strong>
              <span>KTS</span>
            </div>
            <div className="instrument-rule">
              <span
                style={{ width: `${Math.min(100, (s.speed * KNOTS) / 4)}%` }}
              />
            </div>
          </div>
          <div className="instrument">
            <span className="eyebrow">ALTITUDE</span>
            <div>
              <strong>{fmt(s.y * FEET)}</strong>
              <span>FT</span>
            </div>
            <div className="instrument-rule" />
          </div>
          <div
            className="attitude-indicator"
            role="img"
            aria-label={`Pitch ${Math.round((s.pitch * 180) / Math.PI)} degrees, bank ${Math.round((s.bank * 180) / Math.PI)} degrees`}
          >
            <div
              className="attitude-horizon"
              style={{
                transform: `translateY(${s.pitch * 70}px) rotate(${(-s.bank * 180) / Math.PI}deg)`,
              }}
            />
            <div className="attitude-wings">
              — <span>⌄</span> —
            </div>
          </div>
        </div>
        <div className="vertical-speed">
          <span>VERTICAL SPEED</span>
          <strong>
            {s.verticalSpeed >= 0 ? "+" : "−"}
            {fmt(Math.abs(s.verticalSpeed * FEET * 60))}
            <small> FT/MIN</small>
          </strong>
        </div>
      </div>
      <div className="heading-bar">
        <span>
          {((Number(heading) + 330) % 360).toString().padStart(3, "0")}
        </span>
        <i />
        <i />
        <strong>
          {heading}
          <small>°</small>
        </strong>
        <i />
        <i />
        <span>
          {((Number(heading) + 30) % 360).toString().padStart(3, "0")}
        </span>
        <div className="heading-pointer" />
      </div>
      <aside
        className={`mt-5 airspace-card glass ${mapOpen ? "expanded" : "collapsed"}`}
      >
        <button
          className="card-heading"
          onClick={() => setMapOpen(!mapOpen)}
          aria-expanded={mapOpen}
        >
          <span>
            <Icon name="compass" size={15} /> NEARBY AIRSPACE
          </span>
          <span>{mapOpen ? "−" : "+"}</span>
        </button>
        {mapOpen && (
          <>
            <AirspaceMap snapshot={snapshot} />
            <div className="airfield-info">
              <span className="eyebrow">CLOSEST RUNWAY</span>
              <div>
                <strong>{snapshot.airport.name}</strong>
                <span>
                  {distance.toFixed(1)}
                  <small> NM</small>
                </span>
              </div>
              <p>
                <span className="runway-badge">{snapshot.airport.runway}</span>{" "}
                {snapshot.airport.id} <span>2,800 m · Asphalt</span>
              </p>
            </div>
            <div className="next-airfield">
              <span>
                Next airfield <strong>{snapshot.destination.name}</strong>
              </span>
              <span>
                {nextDistance.toFixed(1)} NM <Icon name="arrow" size={13} />
              </span>
            </div>
          </>
        )}
      </aside>
      <div className="view-controls mt-2">
        <button
          className="view-button"
          aria-label="Switch camera view"
          title="Switch camera view (V)"
          onClick={() => action("camera")}
        >
          <Icon name="camera" size={17} />
          {snapshot.camera === "chase" ? "Orbit camera" : "Cockpit view"}
          <kbd>V</kbd>
        </button>
        {snapshot.camera === "chase" && (
          <button
            className="view-button"
            onClick={() => action("resetCamera")}
            title="Restore the default underside view"
          >
            Reset view
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Toggle fullscreen"
          onClick={fullscreen}
        >
          <Icon name="expand" size={17} />
        </button>
      </div>
      {s.stalled && !s.crashed && (
        <div className="flight-warning" role="alert">
          LOW AIRSPEED <span>Lower the nose and increase throttle</span>
        </div>
      )}
      {s.landingRate !== null && !s.crashed && s.grounded && s.speed > 5 && (
        <div className="landing-message">
          <Icon name="check" size={17} />
          {s.landingRate < 240 ? "Smooth touchdown" : "On the runway"}
          <span>{s.landingRate} ft/min · Hold brakes to slow down</span>
        </div>
      )}
      {systemsOpen && (
        <section
          className={`startup-panel glass ${enginesReady ? "complete" : ""}`}
        >
          <div className="startup-heading">
            <span className="eyebrow">
              {enginesReady
                ? "CLEARED FOR YOUR NEXT CHAPTER"
                : "LET’S GET YOU IN THE AIR"}
            </span>
            <button
              aria-label="Close engine panel"
              onClick={() => setSystemsOpen(false)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
          <div className="startup-title">
            <h1>{enginesReady ? "Ready when you are." : "Before we fly."}</h1>
            <span>
              {Math.min(3, step + 1)
                .toString()
                .padStart(2, "0")}
              <small> / 03</small>
            </span>
          </div>
          <p className="startup-hint" aria-live="polite">
            {startHints[step]}
          </p>
          <div className="startup-switches">
            {[
              {
                name: "BATTERY",
                action: "battery" as Action,
                on: s.battery,
                busy: false,
                disabled: false,
              },
              {
                name: "ENGINE 1",
                action: "engine1" as Action,
                on: s.engines[0].phase !== "off",
                busy: s.engines[0].phase === "starting",
                disabled: s.engines[0].phase === "off" && !s.battery,
              },
              {
                name: "ENGINE 2",
                action: "engine2" as Action,
                on: s.engines[1].phase !== "off",
                busy: s.engines[1].phase === "starting",
                disabled: s.engines[1].phase === "off" && !s.battery,
              },
            ].map((item, i) => (
              <button
                key={item.name}
                className={`startup-switch ${item.on ? "on" : ""} ${item.busy ? "busy" : ""} ${step === i ? "next" : ""}`}
                onClick={() => action(item.action)}
                disabled={item.disabled}
                aria-label={`${item.name} ${item.on ? "on" : "off"}`}
                aria-pressed={item.on}
              >
                <span className="switch-track">
                  <i />
                </span>
                <strong>{item.name}</strong>
                <small>{item.busy ? "STARTING" : item.on ? "ON" : "OFF"}</small>
              </button>
            ))}
          </div>
          <div className="startup-footer">
            <span>
              <span className="tiny-dot" />
              {snapshot.audio === "loading"
                ? "Loading aircraft audio…"
                : enginesReady
                  ? "All engines available"
                  : "Guided startup"}
            </span>
            <button
              onClick={() => {
                sim.current?.reset(true);
                setSystemsOpen(false);
              }}
            >
              Start airborne <Icon name="arrow" size={13} />
            </button>
          </div>
        </section>
      )}
      <section className="control-dock" aria-label="Aircraft controls">
        <div className="stick-module">
          <Joystick
            onChange={(x, y) => {
              if (sim.current) {
                sim.current.input.roll = x;
                sim.current.input.pitch = y;
              }
            }}
          />
          <div className="rudder-controls">
            <button
              aria-label="Left rudder"
              onPointerDown={(e) => hold(e, "rudder", -1)}
              onPointerUp={() => release("rudder")}
              onPointerCancel={() => release("rudder")}
              onLostPointerCapture={() => release("rudder")}
            >
              ‹ <kbd>Q</kbd>
            </button>
            <span>RUDDER</span>
            <button
              aria-label="Right rudder"
              onPointerDown={(e) => hold(e, "rudder", 1)}
              onPointerUp={() => release("rudder")}
              onPointerCancel={() => release("rudder")}
              onLostPointerCapture={() => release("rudder")}
            >
              <kbd>E</kbd> ›
            </button>
          </div>
        </div>
        <div className="throttle-module">
          <div className="module-title">
            THRUST <span>− / +</span>
          </div>
          <div className="throttle-readout">
            <strong>
              {Math.round(s.throttle * 100)}
              <small>%</small>
            </strong>
            <span>
              {s.throttle > 0.9
                ? "TOGA"
                : s.throttle > 0.05
                  ? "MANUAL"
                  : "IDLE"}
            </span>
          </div>
          <input
            className="throttle-slider"
            aria-label="Throttle"
            type="range"
            disabled={!s.engines.some((engine) => engine.phase === "running")}
            min="0"
            max="100"
            value={Math.round(s.throttle * 100)}
            onChange={(e) =>
              sim.current?.setThrottle(Number(e.target.value) / 100)
            }
            style={{ "--fill": `${s.throttle * 100}%` } as CSSProperties}
          />
          <div className="throttle-ticks">
            <span>IDLE</span>
            <span>50</span>
            <span>MAX</span>
          </div>
        </div>
        <div className="engines-module">
          <div className="module-title">ENGINE POWER</div>
          <button
            className={`systems-display-button mr-2 ${systemsOpen ? "open" : "needs-attention"}`}
            onClick={() => setSystemsOpen(!systemsOpen)}
            aria-expanded={systemsOpen}
            title={systemsOpen ? "Close engine systems" : "Open engine systems"}
          >
            SYSTEMS <span>↗</span>
          </button>
          <div className="engine-pair">
            {s.engines.map((e, i) => (
              <EngineGauge
                key={i}
                index={i + 1}
                phase={e.phase}
                spool={e.spool}
                throttle={s.throttle}
              />
            ))}
          </div>
        </div>
        <div className="surfaces-module">
          <div className="module-title">CONFIGURATION</div>
          <div className="surface-buttons">
            <button
              className={s.gear ? "engaged" : ""}
              onClick={() => action("gear")}
              aria-label={`Landing gear ${s.gear ? "down" : "up"}`}
              aria-pressed={s.gear}
            >
              <Icon name="gear" />
              <span>
                GEAR
                <strong>
                  {Math.abs(s.gearPosition - Number(s.gear)) > 0.03
                    ? "MOVING"
                    : s.gear
                      ? "DOWN"
                      : "UP"}
                </strong>
              </span>
              <kbd>G</kbd>
            </button>
            <div className="flap-control">
              <div className="flap-readout">
                <Icon name="flaps" />
                <span>
                  FLAPS
                  <strong>
                    {s.flaps === 0
                      ? "UP"
                      : s.flaps === 3
                        ? "FULL"
                        : "CONF " + s.flaps}
                  </strong>
                </span>
                <kbd>F</kbd>
              </div>
              <input
                className="flap-slider"
                type="range"
                min="0"
                max="3"
                step="1"
                value={s.flaps}
                aria-label="Flaps"
                aria-valuetext={
                  s.flaps === 0
                    ? "Up"
                    : s.flaps === 3
                      ? "Full"
                      : "Configuration " + s.flaps
                }
                onChange={(event) =>
                  sim.current?.setFlaps(Number(event.currentTarget.value))
                }
              />
              <div className="flap-detents" aria-hidden="true">
                <span>UP</span>
                <span>1</span>
                <span>2</span>
                <span>FULL</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => action("speedbrake")}
            aria-label="Toggle speed brakes"
            aria-pressed={s.speedBrake}
            className={`spoiler-status ${s.spoilers > 0.1 ? "deployed" : ""}`}
          >
            <span className="tiny-dot" />
            SPEED BRAKES <kbd>X</kbd>
            <strong>
              {s.spoilers > 0.1
                ? "DEPLOYED"
                : s.grounded
                  ? "AUTO ON BRAKE"
                  : "STOWED"}
            </strong>
          </button>
        </div>
        <div className="brakes-module">
          <button
            className={`parking-button ${s.parkingBrake ? "set" : ""}`}
            onClick={() => action("parking")}
            aria-pressed={s.parkingBrake}
          >
            <span>Ⓟ PARKING BRAKE</span>
            <strong>{s.parkingBrake ? "SET" : "OFF"}</strong>
            <kbd>P</kbd>
          </button>
          <button
            className={`brake-button ${s.brake && !s.parkingBrake ? "braking" : ""}`}
            aria-label={s.grounded ? "Hold wheel brakes" : "Hold speed brakes"}
            onPointerDown={(e) => hold(e, "brake", 1)}
            onPointerUp={() => release("brake")}
            onPointerCancel={() => release("brake")}
            onLostPointerCapture={() => release("brake")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && sim.current)
                sim.current.input.brake = true;
            }}
            onKeyUp={() => release("brake")}
          >
            <Icon name="brake" size={23} />
            <span>
              HOLD BRAKES
              <small>
                {s.grounded
                  ? "WHEEL BRAKES + SPOILERS"
                  : "AIRBORNE SPEED BRAKES"}
              </small>
            </span>
            <kbd>SPACE</kbd>
          </button>
        </div>
      </section>
      <footer className="flight-footer">
        <span>
          <span className="live-dot" /> ENDLESS EXPLORATION{" "}
          <span className="footer-separator">/</span> YOUR SKY. YOUR PACE.
        </span>
        <span>
          {snapshot.fps} FPS <span className="footer-separator">/</span>
          <button onClick={() => openModal("help")}>Controls & help</button>
          <span className="footer-separator">/</span>
          <button onClick={() => openModal("credits")}>Credits</button>
        </span>
      </footer>
      {!ready && !error && (
        <div className="loading-screen">
          <span className="loading-plane">
            <Icon name="plane" size={36} />
          </span>
          <h2>Preparing your horizon.</h2>
          <p>Loading aircraft and scenery</p>
        </div>
      )}
      {error && (
        <div className="modal-backdrop">
          <div className="dialog">
            <Icon name="plane" size={32} />
            <h2>Let’s reconnect to the sky.</h2>
            <p>{error}</p>
            <p>Use a browser with WebGL 2 and hardware acceleration enabled.</p>
            <button
              className="primary-button"
              onClick={() => window.location.reload()}
            >
              Reload simulator
            </button>
          </div>
        </div>
      )}
      {s.crashed && !error && (
        <div className="modal-backdrop">
          <div className="dialog crash-dialog">
            <span className="eyebrow">EVERY PILOT STARTS SOMEWHERE</span>
            <h2>Another approach?</h2>
            <p>{s.crashReason}</p>
            <div className="dialog-stats">
              <span>
                FLIGHT TIME
                <strong>
                  {Math.floor(s.elapsed / 60)}m {Math.floor(s.elapsed % 60)}s
                </strong>
              </span>
              <span>
                DISTANCE<strong>{(s.distance / 1852).toFixed(1)} NM</strong>
              </span>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                sim.current?.reset();
                setSystemsOpen(true);
              }}
            >
              <Icon name="reset" size={17} /> Back to the runway
            </button>
            <button
              className="secondary-button"
              onClick={() => sim.current?.reset(true)}
            >
              Try again in the air
            </button>
          </div>
        </div>
      )}
      {snapshot.paused && !modal && !s.crashed && !error && (
        <div className="modal-backdrop">
          <div className="dialog">
            <span className="eyebrow">TAKE YOUR TIME</span>
            <h2>The sky can wait.</h2>
            <p>Your flight is paused.</p>
            <button className="primary-button" onClick={() => action("pause")}>
              <Icon name="play" size={16} /> Resume flight
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                sim.current?.reset();
                setSystemsOpen(true);
              }}
            >
              Restart on the runway
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                sim.current?.reset(true);
                setSystemsOpen(false);
              }}
            >
              Start airborne
            </button>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <section
            className="dialog wide-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close icon-button"
              onClick={closeModal}
              aria-label="Close dialog"
            >
              <Icon name="close" />
            </button>
            {modal === "help" ? (
              <>
                <span className="eyebrow">YOUR FIRST FLIGHT</span>
                <h2 id="dialog-title">Meet your aircraft.</h2>
                <p>
                  Power on the battery, then start each engine. When both
                  engines are ready, release the parking brake and advance the
                  throttle.
                </p>
                <div className="help-grid">
                  {[
                    ["W / S", "Nose down / up"],
                    ["A / D", "Bank left / right"],
                    ["Q / E", "Rudder / ground steering"],
                    ["− / +", "Decrease / increase thrust"],
                    ["G / F", "Landing gear / flap setting"],
                    ["SPACE / B", "Hold brakes / airborne speed brakes"],
                    ["X", "Toggle airborne speed brakes"],
                    ["P", "Parking brake"],
                    ["V / ESC", "Camera / pause"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <kbd>{key}</kbd>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="help-tip">
                  <strong>Takeoff</strong> At about 130 kt, gently pull the
                  joystick down or hold S to raise the nose. Retract gear and
                  flaps once climbing.
                </div>
                <div className="help-tip">
                  <strong>Landing</strong> Aim for a runway at 130–150 kt, gear
                  down and flaps full. Lower thrust, descend gently, and raise
                  the nose just before touchdown. Hold brakes to deploy
                  spoilers.
                </div>
                <p className="fine-print">
                  The fixed rear-quarter camera shows the underside in flight.
                  On mobile, landscape gives you more room. Simplified physics
                  for free flight.
                </p>
              </>
            ) : (
              <>
                <span className="eyebrow">MADE POSSIBLE BY</span>
                <h2 id="dialog-title">A little credit.</h2>
                <div className="credit-list">
                  <p>
                    <strong>Engine startup</strong>
                    <a
                      href="https://freesound.org/people/Alejpix/sounds/784355/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Alejpix · CC BY-NC 4.0 ↗
                    </a>
                    <span>
                      Real aircraft cabin recording, excerpted, noise-reduced,
                      equalized, and volume-normalized. Personal, noncommercial
                      use.
                    </span>
                  </p>
                  <p>
                    <strong>Landing gear</strong>
                    <span>
                      Soft synthesized hydraulics synchronized with gear
                      movement.
                    </span>
                  </p>
                  <p>
                    <strong>Flaps & landing rollout</strong>
                    <a
                      href="https://freesound.org/people/blaukreuz/sounds/249439/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      blaukreuz · CC0 ↗
                    </a>
                    <span>
                      Aircraft cabin recording, trimmed to hydraulic movement
                      and ground roll.
                    </span>
                  </p>
                  <p>
                    <strong>Touchdown tires</strong>
                    <a
                      href="https://freesound.org/people/craigsmith/sounds/479498/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      craigsmith · CC0 ↗
                    </a>
                  </p>
                  <p>
                    <strong>Aircraft model</strong>
                    <a
                      href="https://github.com/amvlab/aircraft-models"
                      target="_blank"
                      rel="noreferrer"
                    >
                      amvlab · CC BY 4.0 ↗
                    </a>
                    <span>
                      Adapted with a neutral finish and animated control
                      surfaces.
                    </span>
                  </p>
                </div>
                <p className="fine-print">
                  Wind, supplemental turbine noise, switches, and brake rumble
                  are synthesized. Independent flight simulator.{" "}
                  <a href="/credits.md" target="_blank">
                    Full credits and license links
                  </a>
                </p>
              </>
            )}
            <button className="primary-button" onClick={closeModal}>
              Back to the flight <Icon name="arrow" size={17} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
