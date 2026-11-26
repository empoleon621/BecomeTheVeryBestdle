import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {Worker} from 'node:worker_threads';

export async function loadTicketKey(path) {
  try {
    await writeFile(path, randomBytes(32), {flag: 'wx', mode: 0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFile(path);
}

export function signTicket(key, guest, day, id) {
  return createHmac('sha256', key).update(guest + '/' + day + '/' + id).digest('hex');
}

export function validTicket(key, ticket, guest, day, id) {
  return typeof ticket === 'string' && /^[a-f0-9]{64}$/.test(ticket) &&
    timingSafeEqual(Buffer.from(ticket, 'hex'), Buffer.from(signTicket(key, guest, day, id), 'hex'));
}

export function limitRequests() {
  const counters = new Map();
  let expires = 0;
  return (request, route, max) => {
    if (Date.now() >= expires) {
      counters.clear();
      expires = Date.now() + 60000;
    }
    const proxyIp = request.headers['x-real-ip'];
    const ip = process.env.RAILWAY_ENVIRONMENT_ID && typeof proxyIp === 'string' && isIP(proxyIp)
      ? proxyIp : request.socket.remoteAddress;
    const key = route + '/' + ip;
    if ((!counters.has(key) && counters.size >= 4096) || (counters.get(key) ?? 0) >= max) return false;
    counters.set(key, (counters.get(key) ?? 0) + 1);
    return true;
  };
}

export async function readJson(request, limit) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') return {status: 415};
  const length = Number(request.headers['content-length']);
  if (length > limit) return {status: 413};
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({destroyOnReturn: false})) {
    bytes += chunk.length;
    if (bytes > limit) return {status: 413};
    chunks.push(chunk);
  }
  try { return {body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}; }
  catch { return {status: 400}; }
}

export function replayInWorker(day, actions) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./replay.js', import.meta.url), {
      workerData: {day, actions}, resourceLimits: {maxOldGenerationSizeMb: 128},
    });
    const finish = value => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 8000);
    worker.once('message', finish);
    worker.once('error', () => finish(null));
    worker.once('exit', () => finish(null));
  });
}
