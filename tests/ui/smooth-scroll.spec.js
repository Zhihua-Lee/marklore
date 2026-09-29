import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note =
  "# Pad\n\n" +
  Array.from(
    { length: 40 },
    (_, n) => `## Part ${n}\n\n${"Steady reading text. ".repeat(40)}\n\n`,
  ).join("");

async function boot(page, touchpadScroll) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, touchpadScroll }) => {
      window.folio = folioTest.mock({
        ready: async () => ({
          incoming: [
            {
              id: "n",
              name: "Pad.md",
              path: "C:/s/Pad.md",
              version: "1",
              text,
            },
          ],
          restored: [],
          roots: [],
          settings: { touchpadScroll },
        }),
      });
    },
    { text: note, touchpadScroll },
  );
  await page.goto("/");
  await expect(page.locator("#content h2").first()).toBeVisible();
}

// Dispatch a wheel event on the reader; report whether the page took it over.
const wheel = (page, init) =>
  page.evaluate((init) => {
    const reader = document.querySelector("#reader");
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      ...init,
    });
    reader.querySelector("#content p").dispatchEvent(event);
    return event.defaultPrevented;
  }, init);

test("smooth touchpad scrolling paces small deltas per frame and leaves wheels alone", async ({
  page,
}) => {
  await boot(page, "smooth");
  const top = () => page.locator("#reader").evaluate((el) => el.scrollTop);
  // Touchpad-sized deltas: taken over, then reached gradually, not at once.
  const samples = await page.evaluate(async () => {
    const reader = document.querySelector("#reader"),
      target = reader.querySelector("#content p");
    const tops = [];
    for (let i = 0; i < 12; i++) {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaMode: 0,
        deltaY: 10,
      });
      target.dispatchEvent(event);
      if (!event.defaultPrevented) return null;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      tops.push(reader.scrollTop);
    }
    return tops;
  });
  expect(samples).not.toBeNull();
  // Moves over several frames toward the 120 px target, never overshooting.
  expect(samples[0]).toBeGreaterThan(0);
  expect(samples[0]).toBeLessThan(90);
  for (let i = 1; i < samples.length; i++)
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  await expect.poll(top).toBeGreaterThan(118);
  expect(await top()).toBeLessThanOrEqual(121);

  // Zoom gestures, horizontal pans and page-sized deltas stay native.
  expect(await wheel(page, { deltaY: 10, ctrlKey: true })).toBe(false);
  expect(await wheel(page, { deltaX: 30, deltaY: 2 })).toBe(false);
  expect(await wheel(page, { deltaY: 1, deltaMode: 1 })).toBe(false);
});

test("the system default registers no blocking wheel listener", async ({
  page,
}) => {
  await boot(page, "system");
  expect(await wheel(page, { deltaY: 10 })).toBe(false);
  // Switching in Aa takes effect at once and back again.
  await page.locator("#weight").click();
  await page.locator("#touchpad-scroll").selectOption("smooth");
  expect(await wheel(page, { deltaY: 10 })).toBe(true);
  await page.locator("#touchpad-scroll").selectOption("system");
  expect(await wheel(page, { deltaY: 10 })).toBe(false);
});
