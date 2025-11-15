const MIN_DURATION_MS = 12_000;
const MIN_INPUTS = 10;
const MIN_INTERVAL_MS = 200;

function resolveStep(durationMs, inputCount) {
  const duration = Math.max(MIN_DURATION_MS, Number(durationMs) || 0);
  const inputs = Math.max(MIN_INPUTS, Number(inputCount) || 0);
  return Math.max(MIN_INTERVAL_MS, Math.floor(duration / inputs));
}

async function driveActiveWindow(page, durationMs = MIN_DURATION_MS, inputCount = MIN_INPUTS) {
  if (!page) return;

  await page.bringToFront();

  const inputs = Math.max(MIN_INPUTS, Number(inputCount) || 0);
  const step = resolveStep(durationMs, inputs);

  for (let i = 0; i < inputs; i += 1) {
    const x = 120 + (i % 8) * 6;
    const y = 160 + (i % 5) * 8;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
    await page.waitForTimeout(step);
  }

  await page.waitForTimeout(1_000);
}

module.exports = { driveActiveWindow };
