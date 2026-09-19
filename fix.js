const fs = require('fs');
let css = fs.readFileSync('src/renderer/src/styles/themes.css', 'utf-8');

// Replace accent variables
css = css.replace(/--accent:\s*#[a-fA-F0-9]+;/g, "--accent: var(--text);");
css = css.replace(/--accent-hover:\s*#[a-fA-F0-9]+;/g, "--accent-hover: var(--text-secondary);");
css = css.replace(/--accent-text:\s*#[a-fA-F0-9]+;/g, "--accent-text: var(--bg);");

// Replace border-focus with text
css = css.replace(/--border-focus:\s*#[a-fA-F0-9]+;/g, "--border-focus: var(--text);");

// Replace selection with text but with opacity
css = css.replace(/--selection:\s*#[a-fA-F0-9]+;/g, "--selection: var(--text-muted);");

// Replace colorful syntax highlighting with monochrome variants
css = css.replace(/--syntax-h2:\s*#[a-fA-F0-9]+;/g, "--syntax-h2: var(--text);");
css = css.replace(/--syntax-h3:\s*#[a-fA-F0-9]+;/g, "--syntax-h3: var(--text);");
css = css.replace(/--syntax-link:\s*#[a-fA-F0-9]+;/g, "--syntax-link: var(--text);");
css = css.replace(/--syntax-code:\s*#[a-fA-F0-9]+;/g, "--syntax-code: var(--text-secondary);");
css = css.replace(/--syntax-list:\s*#[a-fA-F0-9]+;/g, "--syntax-list: var(--text);");
css = css.replace(/--warning:\s*#[a-fA-F0-9]+;/g, "--warning: var(--text);");
css = css.replace(/--success:\s*#[a-fA-F0-9]+;/g, "--success: var(--text);");
css = css.replace(/--danger:\s*#[a-fA-F0-9]+;/g, "--danger: var(--text);");

fs.writeFileSync('src/renderer/src/styles/themes.css', css);
