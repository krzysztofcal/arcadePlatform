const DEFAULT_WINDOW_DURATION_MS = 12_000;
const DEFAULT_INPUT_COUNT = 10;
const POST_WINDOW_DELAY_MS = 1_000;

async function driveActiveWindow(page, durationMs = DEFAULT_WINDOW_DURATION_MS, minInputs = DEFAULT_INPUT_COUNT) {
  const totalDuration = Math.max(Number(durationMs) || 0, DEFAULT_WINDOW_DURATION_MS);
  const inputCount = Math.max(Number(minInputs) || 0, DEFAULT_INPUT_COUNT);
  try {
    await page.bringToFront();
  } catch (_) {
    // ignore when bringToFront is unsupported (e.g., WebKit headless)
  }
  const spacing = Math.max(80, Math.floor(totalDuration / inputCount));
  const sequence = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'];
  for (let i = 0; i < inputCount; i += 1) {
    const key = sequence[i % sequence.length];
    try {
      await page.keyboard.press(key);
    } catch (_) {
      // ignore keyboard failures in extremely constrained environments
    }
    try {
      const x = 120 + (i % 5) * 15;
      const y = 160 + (i % 7) * 10;
      await page.mouse.move(x, y);
    } catch (_) {
      // ignore mouse failures
    }
    await page.waitForTimeout(spacing);
  }
  await page.waitForTimeout(POST_WINDOW_DELAY_MS);
}

module.exports = {
  driveActiveWindow,
};
