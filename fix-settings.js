const fs = require('fs');
let ts = fs.readFileSync('src/renderer/src/components/SettingsModal.ts', 'utf-8');

ts = ts.replace(/accent:\s*'#[a-fA-F0-9]+'/g, "accent: '#ffffff'");

// For light themes where text is dark, we should use dark accent for the preview
ts = ts.replace(/\{ id: 'light'(.*?)accent: '#ffffff'/g, "{ id: 'light'$1accent: '#1a1a1a'");
ts = ts.replace(/\{ id: 'paper'(.*?)accent: '#ffffff'/g, "{ id: 'paper'$1accent: '#3d3a2e'");

fs.writeFileSync('src/renderer/src/components/SettingsModal.ts', ts);
