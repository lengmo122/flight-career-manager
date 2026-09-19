import assert from 'node:assert/strict';

const {chromium} = await import(process.env.FCM_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // UI verification must not connect, inject, or change the user's running simulator.
  await page.route('**/api/simulator/**',route=>route.fulfill({json:{connected:false,started:false}}));
  await page.goto(process.env.FCM_PANEL_APP_URL || 'http://127.0.0.1:4176/');
  await page.locator('#pilotNameInput').fill('9911');
  await page.locator('#pilotBaseInput').fill('ZBAA');
  await page.locator('#pilotSubmitBtn').click();
  assert.equal(await page.locator('[data-view="glassout"]').count(),0);
  assert.equal(await page.locator('#glassoutView').count(),0);
  assert.ok(await page.locator('[data-view="dashboard"]').isVisible());
  assert.deepEqual(errors,[]);
  console.log('Panel UI removal: navigation and view are absent, dashboard remains available, and no browser exceptions occurred.');
} finally {await browser.close();}
