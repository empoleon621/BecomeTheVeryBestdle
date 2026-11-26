import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';

const notices = readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8');

export default defineConfig({
  base: './',
  plugins: [
    viteSingleFile(),
    {name: 'third-party-notices', transformIndexHtml: html => html + '\n<!--\n' + notices + '-->\n'},
    {
      name: 'content-security-policy',
      enforce: 'post',
      generateBundle: {order: 'post', handler(_options, bundle) {
        const page = bundle['index.html'];
        const script = /<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/.exec(page.source)?.[1];
        if (!script) this.error('Expected the inlined game script.');
        const hash = createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
        const remote = process.env.VITE_RECORDS_ORIGIN && new URL(process.env.VITE_RECORDS_ORIGIN);
        if (remote && remote.protocol !== 'https:') this.error('The public records API requires HTTPS.');
        const policy = ["default-src 'none'", `script-src 'sha256-${hash}'`, "style-src 'unsafe-inline'",
          'font-src data:', 'img-src data: https://play.pokemonshowdown.com https://raw.githubusercontent.com',
          `connect-src 'self'${remote ? ' ' + remote.origin : ''}`, "base-uri 'none'", "form-action 'none'"].join('; ');
        page.source = page.source.replace('<meta charset="utf-8">', `$&\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
      }},
    },
  ],
  server: {port: 4173, strictPort: true},
  // The simulator writes constructor names into save files.
  esbuild: {keepNames: true},
  build: {chunkSizeWarningLimit: 9000},
});
