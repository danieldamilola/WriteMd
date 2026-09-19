
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
  
  await page.evaluate(() => {
    const newFileBtn = document.querySelector('write-button[icon=\
lucide-file-edit\]') || document.querySelector('write-button');
    if (newFileBtn) newFileBtn.click();
  });
  
  await page.waitForTimeout(1000);
  
  const content = fs.readFileSync('PRD.md', 'utf8');
  
  await page.evaluate((content) => {
    const cm = document.querySelector('.cm-editor');
    if (cm && cm.view) {
      cm.view.dispatch({
        changes: {from: 0, to: cm.view.state.doc.length, insert: content}
      });
    } else {
      console.log('No CodeMirror view found');
    }
  }, content);
  
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/Users/Daniel/.gemini/antigravity/brain/f1d08e93-b740-483b-8705-3ead54c0e1b5/screenshot-test3.png' });
  await browser.close();
})();

