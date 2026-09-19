
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('pageerror', err => console.log('ERROR:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });

  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);
  
  const content = fs.readFileSync('PRD.md', 'utf8');
  
  await page.evaluate((content) => {
    const app = document.querySelector('writemd-app');
    if (app && app.fileState) {
       app.fileState.setContent(content);
       app.fileState.setPath('PRD.md');
       app.requestUpdate();
    } else {
       // try to find it
       window.__writemd_debug_content = content;
       console.error('app or fileState not found');
    }
  }, content);
  
  await page.waitForTimeout(2000);
  await browser.close();
})();

