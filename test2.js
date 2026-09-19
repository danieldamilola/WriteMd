
const { chromium } = require('playwright');
const fs = require('fs');

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
  
  const content = fs.readFileSync('PRD.md', 'utf8');
  
  await page.evaluate((content) => {
    const view = document.querySelector('.cm-content');
    if (view) {
      view.textContent = content;
      view.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, content);
  
  await page.waitForTimeout(2000);
  await browser.close();
})();

