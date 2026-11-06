import fs from 'node:fs';
import path from 'node:path';

/** Inlines the Vite output into one index.html that can be opened or dropped on Vercel as is. */
const dist = 'dist';
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\/?(assets\/[^"]+)"[^>]*>/, (_, file) => {
  const css = fs.readFileSync(path.join(dist, file), 'utf8');
  return `<style>${css}</style>`;
});
html = html.replace(/<script type="module"[^>]*src="\/?([^"]+)"[^>]*><\/script>/, (_, file) => {
  const js = fs.readFileSync(path.join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
if (/(src|href)="\/?assets\//.test(html)) throw new Error('An asset was left outside the file.');

fs.mkdirSync('release', { recursive: true });
fs.writeFileSync(path.join('release', 'index.html'), html);
console.log(`release/index.html ${(html.length / 1024).toFixed(0)} KB`);
