import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {isId, openRecords, validateRun} from './records.js';
import {validActions} from './replay.js';
import {limitRequests, loadTicketKey, readJson, replayInWorker, signTicket, validTicket} from './security.js';
import {dayKey} from '../src/league.js';

const host = process.env.HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT ?? 4173);
const database = process.env.RECORDS_DB ? resolve(process.env.RECORDS_DB)
  : resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data', 'records.sqlite');
const html = await readFile(new URL('../dist/index.html', import.meta.url));
process.umask(0o077);
await mkdir(dirname(database), {recursive: true});
const ticketKey = await loadTicketKey(database + '.ticket-key');
const records = openRecords(database);
const allowRequest = limitRequests();
const pagesOrigin = process.env.PAGES_ORIGIN;
let replaying = false;

function respond(response, status, value) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(value));
}

createServer({requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 8192}, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  try {
    const {pathname: path, searchParams} = new URL(request.url, 'http://localhost');
    const origin = request.headers.origin;
    if (path.startsWith('/api/') && origin) {
      if (![pagesOrigin, 'http://' + request.headers.host, 'https://' + request.headers.host].includes(origin)) {
        return respond(response, 403, {error: 'Origin is not allowed.'});
      }
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        return response.end();
      }
    }
    if (path === '/api/records' && request.method === 'GET') {
      if (!allowRequest(request, 'read', 120)) return respond(response, 429, {error: 'Try again shortly.'});
      const day = searchParams.get('day') ?? dayKey();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return respond(response, 400, {error: 'Invalid date.'});
      return respond(response, 200, records.totals(day));
    }
    if (request.method === 'POST' && ['/api/start', '/api/records', '/api/bugs'].includes(path)) {
      const cap = path === '/api/bugs' ? 4 : path === '/api/start' ? 24 : 12;
      if (!allowRequest(request, path, cap)) return respond(response, 429, {error: 'Try again shortly.'});
      const {body, status} = await readJson(request, path === '/api/records' ? 65536 : 8192);
      if (status) return respond(response, status, {error: 'Invalid JSON request.'});
      if (path === '/api/bugs') {
        const message = typeof body?.message === 'string' && body.message.trim();
        if (!message || message.length > 1500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) {
          return respond(response, 400, {error: 'Enter a report of up to 1,500 characters.'});
        }
        records.saveBug(message);
        return respond(response, 201, {received: true});
      }
      const {guest, day, id, ticket, actions} = body ?? {};
      if (!isId(guest) || !isId(id)) return respond(response, 400, {error: 'Invalid run.'});
      if (path === '/api/start') {
        if (day !== dayKey()) return respond(response, 409, {error: 'Today’s challenge has changed. Refresh to continue.'});
        if (records.completed(guest, day) || !records.start(guest, day, id)) {
          return respond(response, 409, {error: 'This browser already has a run for this challenge.'});
        }
        return respond(response, 200, {ticket: signTicket(ticketKey, guest, day, id)});
      }
      const yesterday = dayKey(new Date(Date.now() - 86400000));
      if (day !== dayKey() && day !== yesterday) return respond(response, 400, {error: 'Invalid challenge date.'});
      if (!validTicket(ticketKey, ticket, guest, day, id)) return respond(response, 403, {error: 'Invalid run ticket.'});
      if (records.completed(guest, day)) {
        return respond(response, 200, {accepted: false, progressRecorded: records.hasProgress(id, guest), ...records.totals(day)});
      }
      if (!validActions(actions)) return respond(response, 422, {error: 'Invalid run history.'});
      if (replaying) return respond(response, 503, {error: 'Records are busy. Try again shortly.'});
      replaying = true;
      let verified;
      try { verified = await replayInWorker(day, actions); } finally { replaying = false; }
      const run = verified && {...verified, day, id};
      if (!validateRun(run)) return respond(response, 422, {error: 'This run could not be verified.'});
      const accepted = records.add(guest, run);
      return respond(response, 200, {accepted, progressRecorded: records.hasProgress(id, guest), ...records.totals(day)});
    }
    if ((path === '/' || path === '/index.html') && request.method === 'GET') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
      return response.end(html);
    }
    return respond(response, 404, {error: 'Not found.'});
  } catch (error) {
    console.error(error);
    if (!response.headersSent) respond(response, 500, {error: 'Service is unavailable.'});
    else response.end();
  }
}).listen(port, host, () => console.log(`BecomeTheVeryBestdle is running at http://${host}:${port}/`));
