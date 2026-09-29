import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";

// Keep original recordings out of the browser bundle. See public/credits.md.
const sourceDir = ".audio-source";
mkdirSync(sourceDir, { recursive: true });
mkdirSync("public/audio", { recursive: true });
const sources = {
  startup: "https://cdn.freesound.org/previews/784/784355_2908844-hq.mp3",
  landing: "https://cdn.freesound.org/previews/249/249439_623488-hq.mp3",
  touchdown: "https://cdn.freesound.org/previews/479/479498_2524442-hq.mp3",
};
for (const [name, url] of Object.entries(sources)) {
  const path = join(sourceDir, `${name}.mp3`);
  if (!existsSync(path)) {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Download ${name}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
}

// Gentle spectral reduction preserves the turbine character. A broad midrange cut
// reduces cabin chatter; it cannot perfectly separate voices from machinery.
const engine =
  "highpass=f=65,lowpass=f=4300,afftdn=nr=14:nf=-42:gs=6,equalizer=f=1450:t=o:w=1.7:g=-7,agate=threshold=0.009:ratio=1.5:range=0.3:attack=40:release=450";
const mechanical =
  "highpass=f=90,lowpass=f=2400,afftdn=nr=12:nf=-38:gs=6,equalizer=f=1250:t=o:w=1.2:g=-4";
const clips = [
  {
    source: "startup",
    name: "turbofan",
    start: 96,
    duration: 16,
    filter: engine,
    level: -29,
    fade: 0,
  },
  {
    source: "startup",
    name: "engine-1",
    start: 15,
    duration: 24,
    filter: engine,
    level: -21,
    fade: 2,
  },
  {
    source: "startup",
    name: "engine-2",
    start: 64,
    duration: 24,
    filter: engine,
    level: -21,
    fade: 2,
  },
  // Event times are documented by the original recordist.
  {
    source: "landing",
    name: "flaps",
    start: 37,
    duration: 4,
    filter: mechanical,
    level: -25,
    fade: 0.5,
  },
  {
    source: "landing",
    name: "rollout",
    start: 246,
    duration: 7,
    filter: "highpass=f=65,lowpass=f=950,afftdn=nr=10:nf=-38:gs=5",
    level: -24,
    fade: 1.8,
  },
  {
    source: "touchdown",
    name: "touchdown",
    start: 0,
    duration: 1.1,
    filter: "highpass=f=110,lowpass=f=3500,afftdn=nr=10:nf=-40:gs=4",
    level: -23,
    fade: 0.2,
  },
];
for (const clip of clips) {
  const fades = clip.fade
    ? `,afade=t=in:d=0.15,afade=t=out:st=${clip.duration - clip.fade}:d=${clip.fade}`
    : "";
  const filter = `${clip.filter},loudnorm=I=${clip.level}:TP=-3:LRA=10${fades}`;
  const result = spawnSync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(clip.start),
      "-i",
      join(sourceDir, `${clip.source}.mp3`),
      "-t",
      String(clip.duration),
      "-af",
      filter,
      "-ac",
      "1",
      "-ar",
      "44100",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      `public/audio/${clip.name}.mp3`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error(`Audio processing failed: ${clip.name}`);
  console.log(`Prepared ${clip.name}: ${clip.duration}s`);
}
