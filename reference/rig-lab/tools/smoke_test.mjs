// End-to-end smoke test. Start `npm run dev`, then `node tools/smoke_test.mjs`.
// Requires `npx playwright install chromium` once on a machine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.TEST_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
});
const errors = [];
await fs.mkdir('tmp', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#boneCount')?.textContent === '85', { timeout: 30000 });
  assert.equal(await page.locator('#selectedRaw').textContent(), 'upper_arm.L');
  await page.locator('#loadingOverlay').waitFor({ state: 'detached' });
  await page.screenshot({ path: 'tmp/desktop.png' });

  // Click actual skinned head geometry, not a DOM list item or a joint marker.
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 190);
  assert.equal(await page.locator('#selectedRaw').textContent(), 'Head');
  await page.locator('.bone-row[data-bone="upper_arm.L"]').click();
  const beforeGizmo = await page.locator('#numberZ').inputValue();
  await page.mouse.move(800, 252);
  await page.mouse.down();
  await page.mouse.move(833, 286, { steps: 12 });
  await page.mouse.up();
  assert.notEqual(await page.locator('#numberZ').inputValue(), beforeGizmo,
                  'Dragging the 3D rotation ring should turn the bone');

  await page.locator('#boneSearch').fill('предплечье');
  assert.equal(await page.locator('.bone-row').count(), 2);
  await page.locator('.bone-row').filter({ hasText: 'Правое предплечье' }).click();
  assert.equal(await page.locator('#selectedRaw').textContent(), 'forearm.R');
  await page.locator('#boneSearch').fill('');
  await page.locator('#sliderZ').evaluate((input) => {
    input.value = '42'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#numberZ').inputValue(), '42');
  assert.equal(await page.locator('#poseName').textContent(), 'СВОЯ ПОЗА');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportPose').click();
  const download = await downloadPromise;
  const saved = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.equal(saved.format, 'capsule-rig-pose');
  assert.equal(Object.keys(saved.bones).length, 85);
  await page.locator('#resetAll').click();
  assert.equal(await page.locator('#numberZ').inputValue(), '0');
  await page.locator('#poseFile').setInputFiles({
    name: 'pose.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page.waitForFunction(() => document.querySelector('#numberZ')?.value === '42');
  assert.equal(await page.locator('#numberZ').inputValue(), '42');
  await page.locator('[data-preset="hello"]').click();
  await page.screenshot({ path: 'tmp/hello.png' });
  await page.locator('[data-view="front"]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-view="front"]').getAttribute('class'), 'camera-btn is-active');
  await page.locator('#jointToggle').click();
  assert.equal(await page.locator('#jointToggle').getAttribute('aria-pressed'), 'false');
  await page.locator('#lineToggle').click();
  assert.equal(await page.locator('#lineToggle').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: 'tmp/bones.png' });
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
  await phone.waitForFunction(() => document.querySelector('#boneCount')?.textContent === '85', { timeout: 30000 });
  assert.equal(await phone.locator('#mobileBonesBtn').isVisible(), true);
  await phone.screenshot({ path: 'tmp/mobile.png' });
  await phone.locator('#mobileBonesBtn').click();
  assert.equal(await phone.locator('#bonesPanel').getAttribute('class'), 'bones-panel is-open');
  await phone.locator('#boneSearch').fill('голова');
  await phone.locator('.bone-row').filter({ hasText: 'Голова' }).first().click();
  assert.equal(await phone.locator('#selectedRaw').textContent(), 'Head');
  await phone.locator('#mobileInspectorBtn').click();
  await phone.screenshot({ path: 'tmp/mobile_inspector.png' });
  await phone.close();
  assert.deepEqual(errors, []);
  console.log('PASS: 85-bone GLB loaded; picking, sliders, presets, JSON roundtrip, camera, overlays and mobile UI work.');
} finally {
  await browser.close();
}
