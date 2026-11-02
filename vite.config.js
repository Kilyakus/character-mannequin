import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
for (const file of ['index.html', 'demo/main.js', 'src/index.js']) {
  if (!existsSync(path.join(root, file))) {
    throw new Error(`Character Mannequin: missing ${file}. Extract the full project archive before starting Vite.`);
  }
}

export default defineConfig({
  root,
  base: './',
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: { outDir: path.join(root, 'dist'), emptyOutDir: true },
});
