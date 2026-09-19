const fs = require('fs');
let code = fs.readFileSync('src/renderer/src/components/SettingsModal.ts', 'utf-8');

// 1. Remove sidebar navigation
code = code.replace(/<div class="sidebar" role="tablist">[\s\S]*?<\/div>/, '');

// 2. Remove conditional rendering for tabs (replace ${this.tab === 'general' ? html`...` : ''} with just the content)
code = code.replace(/\$\{this\.tab === '[^']+' \? html`/g, '`');
code = code.replace(/` : ''\}/g, '');

// 3. Update CSS width to be narrower
code = code.replace(/width: min\(780px, 94vw\);/, 'width: min(520px, 94vw);');

// 4. Remove sidebar CSS
code = code.replace(/\/\* Sidebar Navigation \*\/[\s\S]*?\/\* Content Area \*\//, '/* Content Area */');

fs.writeFileSync('src/renderer/src/components/SettingsModal.ts', code);
