import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {isId, openRecords, validateRun} from './records.js';
import {dayKey} from '../src/league.js';

const host = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT ?? 4173);
const database = process.env.RECORDS_DB ? resolve(process.env.RECORDS_DB)
  : resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data', 'records.sqlite');
const html = await readFile(new URL('../dist/index.html', import.meta.url));
await mkdir(dirname(database), {recursive: true});
const records = openRecords(database);
const cookie = 'bestdle_guest';
const pagesOrigin = process.env.PAGES_ORIGIN;

function respond(response, status, value, headers = {}) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  try {
    const {pathname: path, searchParams} = new URL(request.url, 'http://localhost');
    if (path.startsWith('/api/') && pagesOrigin && request.headers.origin === pagesOrigin) {
      response.setHeader('Access-Control-Allow-Origin', pagesOrigin);
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bestdle-Guest');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        return response.end();
      }
    }
    const savedGuest = request.headers.cookie?.match(/(?:^|;\s*)bestdle_guest=([a-f0-9]{32})(?:;|$)/)?.[1];
    if (path === '/api/guest' && request.method === 'GET') {
      const day = searchParams.get('day');
      const guest = savedGuest ?? request.headers['x-bestdle-guest'];
      if (!isId(guest) || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return respond(response, 400, {error: 'Invalid guest or date.'});
      return respond(response, 200, {completed: records.completed(guest, day)});
    }
    if (path === '/api/records' && request.method === 'GET') return respond(response, 200, records.totals(searchParams.get('day') ?? dayKey()));
    if (path === '/api/records' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return respond(response, 415, {error: 'Expected JSON.'});
      let source = '';
      for await (const chunk of request) {
        source += chunk;
        if (source.length > 32768) return respond(response, 413, {error: 'Run record is too large.'});
      }
      let body;
      try { body = JSON.parse(source); } catch { return respond(response, 400, {error: 'Invalid JSON.'}); }
      const guest = savedGuest ?? body?.guest;
      if (!isId(guest) || !validateRun(body?.run)) return respond(response, 400, {error: 'Invalid run record.'});
      const accepted = records.add(guest, body.run);
      const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return respond(response, 200, {accepted, progressRecorded: records.hasProgress(body.run.id, guest), ...records.totals(body.run.day)}, {
        'Set-Cookie': `${cookie}=${guest}; Path=/api; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
      });
    }
    if ((path === '/' || path === '/index.html') && request.method === 'GET') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      return response.end(html);
    }
    return respond(response, 404, {error: 'Not found.'});
  } catch (error) {
    console.error(error);
    if (!response.headersSent) respond(response, 500, {error: 'Records are unavailable.'});
    else response.end();
  }
}).listen(port, host, () => console.log(`BecomeTheVeryBestdle is running at http://${host}:${port}/`));
