import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['client/main.mjs'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/game.js' });
await Promise.all(['index.html', 'style.css', 'favicon.svg'].map(file => copyFile(`client/${file}`, `dist/${file}`)));
console.log('Browser assets built in dist/');
