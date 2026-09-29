import { test, expect } from "@playwright/test";
import { installFolio } from "./fixtures.js";

const note =
  "# Pad\n\n" +
  Array.from(
    { length: 40 },
    (_, n) => `## Part ${n}\n\n${"Steady reading text. ".repeat(40)}\n\n`,
  ).join("");

async function boot(page, smoothScroll) {
  await installFolio(page);
  await page.addInitScript(
    ({ text, smoothScroll }) => {
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
          settings: { smoothScroll },
        }),
      });
    },
    { text: note, smoothScroll },
  );
  await page.goto("/");
  await expect(page.locator("#content h2").first()).toBeVisible();
}

// Dispatch a wheel event on the reader; report whether the page took it over.
// A deltaY of 120 is a Windows wheel notch (wheelDelta 120).
const wheel = (page, init) =>
  page.evaluate((init) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      ...init,
    });
    document.querySelector("#content p").dispatchEvent(event);
    return event.defaultPrevented;
  }, init);

// Dispatch `count` wheel events, then sample scrollTop for 20 frames.
const glide = (page, deltaY, count) =>
  page.evaluate(
    async ({ deltaY, count }) => {
      const reader = document.querySelector("#reader"),
        target = reader.querySelector("#content p");
      for (let i = 0; i < count; i++) {
        const event = new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: 0,
          deltaY,
        });
        target.dispatchEvent(event);
        if (!event.defaultPrevented) return null;
      }
      const tops = [];
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        tops.push(reader.scrollTop);
      }
      return tops;
    },
    { deltaY, count },
  );
const top = (page) => page.locator("#reader").evaluate((el) => el.scrollTop);

function expectGradual(samples, distance) {
  expect(samples).not.toBeNull();
  expect(samples[0]).toBeGreaterThan(0);
  expect(samples[0]).toBeLessThan(distance * 0.75);
  for (let i = 1; i < samples.length; i++)
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
}

test("touchpad smoothing paces small deltas per frame and leaves wheels alone", async ({
  page,
}) => {
  await boot(page, "touchpad");
  // Touchpad-sized deltas: taken over, then reached gradually, never beyond.
  expectGradual(await glide(page, 10, 12), 120);
  await expect.poll(() => top(page)).toBeGreaterThan(118);
  expect(await top(page)).toBeLessThanOrEqual(121);
  // Wheel notches (only smoothed in "all"), zoom gestures, horizontal pans and
  // line-based deltas stay native. The page-drawn scrollbar is not used.
  expect(await wheel(page, { deltaY: 120 })).toBe(false);
  expect(await wheel(page, { deltaY: 10, ctrlKey: true })).toBe(false);
  expect(await wheel(page, { deltaX: 30, deltaY: 2 })).toBe(false);
  expect(await wheel(page, { deltaY: 1, deltaMode: 1 })).toBe(false);
  await expect(page.locator(".reader-scrollbar")).toBeHidden();
});

test("with wheel and scrollbar smoothing, notches glide and the drawn scrollbar drags smoothly", async ({
  page,
}) => {
  await boot(page, "all");
  // Two notches merge into one continuous glide of 240 px.
  expectGradual(await glide(page, 120, 2), 240);
  await expect.poll(() => top(page)).toBeGreaterThan(238);
  expect(await top(page)).toBeLessThanOrEqual(241);

  // The native scrollbar is replaced by one drawn at the reader's right edge.
  const reader = page.locator("#reader"),
    bar = page.locator(".reader-scrollbar"),
    thumb = page.locator(".reader-scrollbar-thumb");
  await expect(bar).toBeVisible();
  expect(
    await reader.evaluate((el) => getComputedStyle(el).scrollbarWidth),
  ).toBe("none");
  const [readerBox, barBox] = [
    await reader.boundingBox(),
    await bar.boundingBox(),
  ];
  expect(
    Math.abs(barBox.x + barBox.width - (readerBox.x + readerBox.width)),
  ).toBeLessThan(1.5);
  expect(Math.abs(barBox.height - readerBox.height)).toBeLessThan(1.5);

  // Dragging: the thumb stays under the pointer; the page follows gradually.
  await reader.evaluate((el) => (el.scrollTop = 0));
  await expect
    .poll(async () => (await thumb.boundingBox()).y)
    .toBeLessThan(barBox.y + 4);
  const start = await thumb.boundingBox();
  await page.mouse.move(start.x + 4, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 110, { steps: 5 });
  const during = await page.evaluate(() => ({
    top: document.querySelector("#reader").scrollTop,
    thumb: document
      .querySelector(".reader-scrollbar-thumb")
      .getBoundingClientRect().y,
  }));
  expect(Math.abs(during.thumb - (start.y + 100))).toBeLessThan(1.5);
  const expected = await page.evaluate(() => {
    const r = document.querySelector("#reader"),
      track = r.clientHeight - 4,
      length = Math.max(
        32,
        Math.round((track * r.clientHeight) / r.scrollHeight),
      );
    return (100 * (r.scrollHeight - r.clientHeight)) / (track - length);
  });
  expect(during.top).toBeLessThan(expected);
  await expect.poll(() => top(page)).toBeGreaterThan(expected - 2);
  await page.mouse.up();
  expect(Math.abs((await top(page)) - expected)).toBeLessThan(2);

  // A track click below the thumb pages down.
  const before = await top(page);
  await page.mouse.click(barBox.x + 4, barBox.y + barBox.height - 6);
  await expect
    .poll(() => top(page))
    .toBeGreaterThan(before + readerBox.height * 0.8);
});

test("off registers no blocking wheel listener and keeps the native scrollbar", async ({
  page,
}) => {
  await boot(page, "off");
  expect(await wheel(page, { deltaY: 10 })).toBe(false);
  await expect(page.locator(".reader-scrollbar")).toBeHidden();
  // Switching in Aa takes effect at once and back again.
  await page.locator("#weight").click();
  await page.locator("#smooth-scroll").selectOption("all");
  expect(await wheel(page, { deltaY: 10 })).toBe(true);
  await expect(page.locator(".reader-scrollbar")).toBeVisible();
  await page.locator("#smooth-scroll").selectOption("off");
  expect(await wheel(page, { deltaY: 10 })).toBe(false);
  await expect(page.locator(".reader-scrollbar")).toBeHidden();
  expect(
    await page
      .locator("#reader")
      .evaluate((el) => getComputedStyle(el).scrollbarWidth),
  ).toBe("auto");
});
