const fs = require('fs');
let code = fs.readFileSync('src/renderer/src/components/SettingsModal.ts', 'utf-8');
code = code.replace(/\\`/g, '`').replace(/\\\$/g, '$');
fs.writeFileSync('src/renderer/src/components/SettingsModal.ts', code);
