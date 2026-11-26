import {parentPort, workerData} from 'node:worker_threads';
import {LeagueRun} from '../src/battle.js';

const id = value => typeof value === 'string' && /^[a-z0-9]{1,48}$/.test(value);

export function validActions(actions) {
  return Array.isArray(actions) && actions.length > 1 && actions.length <= 2048 && actions.every(action => {
    if (!Array.isArray(action)) return false;
    const [kind, first, second] = action;
    if (kind === 'start') return action.length === 2 && id(first);
    if (kind === 'choose') return action.length === 2 && typeof first === 'string' && /^(move [1-4]|switch [1-6])$/.test(first);
    if (kind === 'item') return action.length === 3 && id(first) && id(second);
    return kind === 'advance' && action.length === 3 && (first === null || id(first)) &&
      Array.isArray(second) && second.length <= 2 && second.every(id);
  });
}

export function replayRun(day, actions) {
  if (!validActions(actions)) return null;
  const run = new LeagueRun(day);
  for (const [kind, first, second] of actions) {
    const applied = kind === 'start' ? run.start(first)
      : kind === 'choose' ? run.choose(first)
      : kind === 'item' ? run.useItem(first, second)
      : run.advance(first, second);
    if (!applied) return null;
  }
  return run.phase === 'defeat' || run.phase === 'champion' ? run.view().records : null;
}

if (parentPort) parentPort.postMessage(replayRun(workerData.day, workerData.actions));
