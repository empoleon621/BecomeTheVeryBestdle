import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';

const notices = readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8');

export default defineConfig({
  base: './',
  plugins: [
    viteSingleFile(),
    {name: 'third-party-notices', transformIndexHtml: html => html + '\n<!--\n' + notices + '-->\n'},
  ],
  server: {port: 4173, strictPort: true},
  // The simulator writes constructor names into save files.
  esbuild: {keepNames: true},
  build: {chunkSizeWarningLimit: 9000},
});
