import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['client/main.mjs'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/lab.js' });
for (const file of ['index.html', 'style.css']) await copyFile(`client/${file}`, `dist/${file}`);
console.log('Network lab client built.');
