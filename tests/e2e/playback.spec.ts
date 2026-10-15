import { expect, test, type Page } from "@playwright/test";
import { seedSettings, setScript } from "./helpers";

const SCRIPT = Array.from(
  { length: 12 },
  (_, i) => `Paragraph ${i + 1} explains one more idea in plain words. [Pause.] Then it moves on.`,
).join("\n\n");

/** Opens the main window and the overlay as two pages that talk over a BroadcastChannel. */
async function openBoth(page: Page, settings: Record<string, unknown> = {}) {
  await seedSettings(page, { autoScroll: { startDelayMs: 0, speed: 200 }, ...settings });
  await page.goto("/");
  await setScript(page, SCRIPT);
  // The app opens the teleprompter itself (a popup window in a plain browser).
  const [overlay] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Show teleprompter" }).click(),
  ]);
  await expect(overlay.locator(".prompter-text")).toContainText("Paragraph 12");
  return overlay;
}

const scrollTop = (overlay: Page) =>
  overlay.locator(".prompter-scroll").evaluate((el) => el.scrollTop);

test("automatic scrolling starts, pauses and stops from the main window", async ({ page }) => {
  const overlay = await openBoth(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => scrollTop(overlay)).toBeGreaterThan(50);
  await expect(page.getByRole("status").filter({ hasText: "Scrolling" })).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await scrollTop(overlay);
  await overlay.waitForTimeout(400);
  expect(await scrollTop(overlay)).toBe(paused);
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(() => scrollTop(overlay)).toBeLessThan(400);
});

test("overlay keyboard shortcuts control playback and speed", async ({ page }) => {
  const overlay = await openBoth(page);
  await overlay.locator(".prompter").click();
  await overlay.keyboard.press("Space");
  await expect.poll(() => scrollTop(overlay)).toBeGreaterThan(20);
  await overlay.keyboard.press("ArrowUp");
  await expect(overlay.locator(".speed")).toHaveText("210");
  await overlay.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
});

test("shows a countdown before reading begins", async ({ page }) => {
  const overlay = await openBoth(page, { autoScroll: { startDelayMs: 3000, speed: 200 } });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(overlay.locator(".countdown")).toHaveText(/[123]/);
  await expect(page.getByText(/Starting in [123]/)).toBeVisible();
});

test("voice mode highlights words as they are recognized and skips stage directions", async ({
  page,
}) => {
  const overlay = await openBoth(page, { mode: "voice" });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  // In a browser the demo recognizer "reads" the script aloud from the current position.
  await expect(overlay.locator(".w.current")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => overlay.locator(".w.read").count(), { timeout: 15_000 })
    .toBeGreaterThan(12);
  await expect(overlay.locator(".ann.current")).toHaveCount(0);
  await expect(page.getByText("Mic on")).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Mic off")).toBeVisible();
});

test("switching modes keeps the reading position", async ({ page }) => {
  const overlay = await openBoth(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => scrollTop(overlay)).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Pause" }).click();
  const before = await scrollTop(overlay);

  await page.getByRole("radio", { name: "Voice" }).click();
  await expect(overlay.locator(".w.upcoming").first()).toBeVisible();
  const firstUpcomingTop = await overlay
    .locator(".w.upcoming")
    .first()
    .evaluate((el) => (el as HTMLElement).offsetTop);
  expect(Math.abs(firstUpcomingTop - before)).toBeLessThan(400);

  await page.getByRole("radio", { name: "Auto-scroll" }).click();
  expect(Math.abs((await scrollTop(overlay)) - before)).toBeLessThan(200);
});

test("overlay text can be highlighted and copied", async ({ page }) => {
  const overlay = await openBoth(page);
  await overlay.locator(".w", { hasText: "explains" }).first().dblclick();
  await expect
    .poll(() => overlay.evaluate(() => getSelection()?.toString().trim()))
    .toBe("explains");
  await overlay.keyboard.press("ControlOrMeta+C");
  await expect
    .poll(() => overlay.evaluate(() => navigator.clipboard.readText()))
    .toContain("explains");
});

test("clicking a word moves the voice position there", async ({ page }) => {
  const overlay = await openBoth(page, { mode: "voice" });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(overlay.locator(".w.current")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Pause" }).click();
  const target = overlay.locator(".w", { hasText: "Paragraph" }).nth(5);
  await target.click();
  await expect(target).toHaveClass(/upcoming/);
});
