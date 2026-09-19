
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('pageerror', err => console.log('ERROR:', err.message));
  page.on('console', msg => console.log('CONSOLE:', msg.text()));

  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);
  
  await page.evaluate(() => {
    const newFileBtn = document.querySelector('write-button');
    if (newFileBtn) newFileBtn.click();
  });
  
  await page.waitForTimeout(1000);
  
  await page.evaluate(() => {
    const view = document.querySelector('.cm-content');
    if (view) {
      view.textContent = '# Heading 1\n\n**Bold text**\n\n| A | B |\n|---|---|\n| 1 | 2 |';
      view.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  
  await page.waitForTimeout(2000);
  await browser.close();
})();

