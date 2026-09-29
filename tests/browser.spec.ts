import { test, expect } from "@playwright/test";

test("full-thrust mix stays controlled and the unbranded aircraft renders cleanly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      createDynamicsCompressor() {
        const compressor = super.createDynamicsCompressor(),
          meter = this.createAnalyser();
        meter.fftSize = 2048;
        compressor.connect(meter);
        (window as unknown as { flightMeter: AnalyserNode }).flightMeter =
          meter;
        return compressor;
      }
    };
  });
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await expect(page.getByText(/IndiGo/i)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .click();
  await page.getByRole("slider", { name: "Throttle", exact: true }).fill("100");
  await page.waitForTimeout(3500);
  const rms = await page.evaluate(async () => {
    const meter = (window as unknown as { flightMeter: AnalyserNode })
      .flightMeter;
    const samples = new Float32Array(meter.fftSize);
    let total = 0;
    for (let i = 0; i < 8; i++) {
      meter.getFloatTimeDomainData(samples);
      total += samples.reduce((sum, x) => sum + x * x, 0) / samples.length;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return Math.sqrt(total / 8);
  });
  console.log(
    `Full-thrust output: ${(20 * Math.log10(rms)).toFixed(1)} dBFS RMS`,
  );
  expect(rms).toBeGreaterThan(0.003);
  expect(rms).toBeLessThan(0.08);
  await page.getByRole("button", { name: "day lighting", exact: true }).click();
  await page.mouse.move(640, 350);
  await page.mouse.down();
  await page.mouse.move(425, 350, { steps: 12 });
  await page.mouse.up();
  await page.screenshot({ path: "test-results/aircraft-side.png" });
});

test("WASD still flies the aircraft while the throttle slider has focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".loading-screen")).toBeHidden();
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .click();
  const throttle = page.getByRole("slider", { name: "Throttle", exact: true });
  await throttle.click();
  await expect(throttle).toBeFocused();
  await page.keyboard.down("d");
  await page.waitForTimeout(650);
  await page.keyboard.up("d");
  await expect(page.locator(".attitude-indicator")).not.toHaveAttribute(
    "aria-label",
    /bank 0 degrees/,
  );
});

test("desktop startup, views, audio decoding and flight controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on(
    "pageerror",
    (error) => (errors.push(error.message), console.error(error.message)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
      console.error(message.text());
    }
  });
  await page.goto("/");
  await expect(page.locator(".loading-screen")).toBeHidden();
  await expect(page.locator(".world-canvas canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ENGINE 1 off", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/desktop-sunset.png" });
  await page.getByRole("button", { name: "BATTERY off", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ENGINE 1 off", exact: true }),
  ).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "ENGINE 1 off", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ENGINE 1 on", exact: true }),
  ).toContainText("STARTING");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const context = new AudioContext();
        try {
          for (const name of [
            "engine-1",
            "engine-2",
            "turbofan",
            "flaps",
            "touchdown",
            "rollout",
          ]) {
            const response = await fetch(`/audio/${name}.mp3`);
            if (!response.ok) return false;
            const buffer = await context.decodeAudioData(
              await response.arrayBuffer(),
            );
            if (buffer.duration < 0.5) return false;
          }
          return true;
        } finally {
          await context.close();
        }
      }),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "night lighting", exact: true })
    .click();
  await expect(page.locator("main")).toHaveClass(/night/);
  await page.screenshot({ path: "test-results/desktop-night.png" });
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .click();
  await expect(page.locator(".flight-status")).toHaveText("IN FLIGHT");
  await page
    .getByRole("button", { name: "Toggle speed brakes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Toggle speed brakes", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("x");
  await expect(
    page.getByRole("button", { name: "Toggle speed brakes", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("g");
  await expect(
    page.getByRole("button", { name: "Landing gear down", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("f");
  await expect(
    page.getByRole("button", { name: "Flaps 1", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("s");
  await page.waitForTimeout(500);
  await page.keyboard.up("s");
  await expect(page.locator(".attitude-indicator")).not.toHaveAttribute(
    "aria-label",
    "Pitch 0 degrees, bank 0 degrees",
  );
  await page.keyboard.press("v");
  await expect(page.locator(".cockpit-frame")).toBeVisible();
  await page.screenshot({ path: "test-results/cockpit-night.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByText("Your flight is paused.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile layout and touch joystick", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/");
  await expect(page.locator(".loading-screen")).toBeHidden();
  await expect(
    page.getByRole("slider", { name: "Throttle", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-portrait.png" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .tap();
  const stick = page.locator(".joystick");
  await stick.tap();
  await expect(page.locator(".joystick-stick")).toHaveAttribute(
    "style",
    /translate\(0px,\s*0px\)/,
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: "test-results/mobile-landscape.png" });
  await context.close();
});

test("fixed underside view shows deployed gear, flaps and airborne spoilers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .click();
  await page.getByRole("button", { name: "day lighting", exact: true }).click();
  await page.keyboard.press("g");
  for (let i = 0; i < 3; i++) await page.keyboard.press("f");
  await page.keyboard.press("x");
  await page.waitForTimeout(6200);
  await expect(
    page.getByRole("button", { name: "Toggle speed brakes", exact: true }),
  ).toContainText("DEPLOYED");
  await page.screenshot({ path: "test-results/aircraft-deployed.png" });
  await page
    .getByRole("button", { name: "night lighting", exact: true })
    .click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/distant-runway-night.png" });
  expect(errors).toEqual([]);
});

test("dragging the scenery changes POV and scrolling zooms", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  // Freeze the world and hide overlays so only camera motion changes the pixels.
  const hide = await page.addStyleTag({
    content:
      ".flight-app > :not(.world-canvas) { visibility: hidden !important; }",
  });
  const canvas = page.locator(".world-canvas canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(850, 330);
  await page.mouse.down();
  await page.mouse.move(1050, 240, { steps: 8 });
  await page.mouse.up();
  const after = await canvas.screenshot();
  expect(
    after.equals(before),
    "Dragging must change the rendered camera angle",
  ).toBe(false);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  expect(
    (await canvas.screenshot()).equals(after),
    "Scrolling must change zoom",
  ).toBe(false);
  await page
    .getByRole("button", {
      name: "Reset view",
      exact: true,
      includeHidden: true,
    })
    .evaluate((el: HTMLButtonElement) => el.click());
  expect(
    (await canvas.screenshot()).equals(before),
    "Reset restores the original POV",
  ).toBe(true);
  await hide.evaluate((el) => el.parentNode?.removeChild(el));
});

test("camera switch stays clickable above the flight controls on shorter desktops", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 690 });
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Switch camera view", exact: true })
    .click({ timeout: 3000 });
  await expect(page.locator(".cockpit-frame")).toBeVisible();
  await page.keyboard.press("v");
  await expect(page.locator(".cockpit-frame")).toBeHidden();
});

test("touch drag and two-finger pinch adjust the external camera", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Pause flight", exact: true }).tap();
  await page.addStyleTag({
    content:
      ".flight-app > :not(.world-canvas) { visibility: hidden !important; }",
  });
  const canvas = page.locator(".world-canvas canvas");
  const client = await context.newCDPSession(page);
  const before = await canvas.screenshot();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 180, y: 320, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 260, y: 350, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const dragged = await canvas.screenshot();
  expect(dragged.equals(before), "Touch drag changes the POV").toBe(false);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 150, y: 320, id: 1 },
      { x: 230, y: 320, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 110, y: 320, id: 1 },
      { x: 270, y: 320, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(
    (await canvas.screenshot()).equals(dragged),
    "Pinch changes zoom",
  ).toBe(false);
  await context.close();
});

test("aircraft labels are removed and engine openings render from front and rear", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-aircraft-ready",
    "true",
  );
  await expect(page.getByText(/Airbus|A320/i)).toHaveCount(0);
  await page.getByRole("button", { name: "day lighting", exact: true }).click();
  await page
    .getByRole("button", { name: "Start airborne", exact: false })
    .click();
  await page.keyboard.press("Escape");
  await page.addStyleTag({
    content:
      ".flight-app > :not(.world-canvas) { visibility: hidden !important; }",
  });
  await page.mouse.move(900, 350);
  await page.mouse.wheel(0, -500);
  // Center the rear camera on both exhausts, slightly below the wing.
  await page.mouse.down();
  await page.mouse.move(900 + Math.atan2(0.46, 0.89) / 0.005, 350, {
    steps: 8,
  });
  await page.mouse.up();
  await page.screenshot({ path: "test-results/engines-rear.png" });
  await page.mouse.move(1100, 350);
  await page.mouse.down();
  await page.mouse.move(1100 - Math.PI / 0.005, 350, { steps: 12 });
  await page.mouse.up();
  await page.screenshot({ path: "test-results/engines-front.png" });
  expect(errors).toEqual([]);
});
