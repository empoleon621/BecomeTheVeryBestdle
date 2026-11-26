import assert from 'node:assert/strict';
import test from 'node:test';
import {LeagueRun} from '../src/battle.js';
import {openRecords, validateRun} from '../server/records.js';

const day = '2026-11-26';
const idFor = n => n.toString(16).padStart(32, '0');

function playDefeat(reload) {
  let run = new LeagueRun(day);
  assert.ok(run.start('reshiram'));
  for (let turns = 0; turns < 40 && run.phase === 'battle'; turns++) {
    const view = run.view();
    assert.equal(view.records, null);
    const command = view.forced ? 'switch ' + view.team.find(member => member.hp && !member.active).slot
      : 'move ' + (view.moves.findIndex(move => !move.disabled) + 1);
    assert.ok(run.choose(command));
    if (reload && turns === 10) run = new LeagueRun(day, JSON.parse(JSON.stringify(run.snapshot())));
  }
  assert.equal(run.phase, 'defeat');
  return {day, ...run.view().records};
}

test('both copies of a daily run have identical counters, including after a mid-battle reload', () => {
  const {id: first, ...one} = playDefeat(false);
  const {id: second, ...two} = playDefeat(true);
  assert.notEqual(first, second);
  assert.deepEqual(one, two);
  assert.equal(one.turns, 24);
  assert.equal(one.players.length, 6);
  const slaking = one.players.find(row => row.species === 'slaking');
  assert.deepEqual(slaking, {species: 'slaking', kos: 4, damage: 872, moves: {gigaimpact: 4}});
  assert.deepEqual(one.enemies, [
    {trainer: 'flint', species: 'infernape', kos: 3}, {trainer: 'flint', species: 'arcanine', kos: 3},
  ]);
});

test('fastest clear ranks wins across dates and counts ties once per guest', () => {
  const loss = playDefeat(false);
  const store = openRecords(':memory:');
  const fastestClear = date => JSON.parse(JSON.stringify(store.totals(date))).fastestClear;
  try {
    assert.equal(store.add(idFor(1), {...loss, turns: 1}), true);
    assert.deepEqual(fastestClear(day), {daily: null, allTime: null});

    const win = {...loss, id: idFor(10), outcome: 'win', turns: 38, defeated: 30};
    assert.equal(validateRun(win), true);
    assert.equal(validateRun({...win, turns: 0}), false);
    assert.equal(validateRun({...win, turns: 1.5}), false);
    assert.equal(store.add(idFor(2), win), true);
    assert.equal(store.add(idFor(2), {...win, id: idFor(11), turns: 12}), false);
    assert.equal(store.add(idFor(3), {...win, id: idFor(12)}), true);
    assert.deepEqual(fastestClear(day), {
      daily: {turns: 38, clears: 2}, allTime: {turns: 38, clears: 2},
    });

    const tomorrow = '2026-11-27';
    assert.equal(store.add(idFor(2), {...win, id: idFor(13), day: tomorrow, turns: 31}), true);
    assert.equal(store.add(idFor(4), {...win, id: idFor(14), turns: undefined}), true);
    assert.deepEqual(fastestClear(day), {
      daily: {turns: 38, clears: 2}, allTime: {turns: 31, clears: 1},
    });
    assert.deepEqual(fastestClear(tomorrow).daily, {turns: 31, clears: 1});
  } finally {
    store.close();
  }
});

test('daily progress records finished losses and wins without counting duplicate submissions', () => {
  const loss = playDefeat(false);
  const store = openRecords(':memory:');
  try {
    assert.equal(loss.defeated, 4);
    assert.equal(validateRun({...loss, defeated: -1}), false);
    assert.equal(validateRun({...loss, outcome: 'win', defeated: 29}), false);
    assert.equal(store.add(idFor(1), loss), true);
    assert.equal(store.add(idFor(1), {...loss, id: idFor(20), defeated: 9}), false);
    assert.equal(store.hasProgress(loss.id, idFor(1)), true);
    assert.equal(store.hasProgress(loss.id, idFor(2)), false);
    assert.equal(store.add(idFor(2), {...loss, id: idFor(21), defeated: 9}), true);
    assert.equal(store.add(idFor(3), {...loss, id: idFor(22), defeated: 30, outcome: 'win'}), true);
    const distribution = date => JSON.parse(JSON.stringify(store.totals(date))).dailyProgress;
    assert.deepEqual(distribution(day), [
      {defeated: 4, runs: 1}, {defeated: 9, runs: 1}, {defeated: 30, runs: 1},
    ]);
    assert.deepEqual(distribution('2026-11-27'), []);
  } finally {
    store.close();
  }
});

test('shared counters count distinct guests once per date and reject mismatched teams', () => {
  const run = playDefeat(false);
  const store = openRecords(':memory:');
  try {
    assert.ok(validateRun(run));
    assert.equal(validateRun({...run, outcome: null}), false);
    assert.equal(validateRun({...run, players: [...run.players.slice(0, 5), run.players[4]]}), false);
    assert.equal(store.add(idFor(1), run), true);
    assert.equal(store.completed(idFor(1), day), true);
    assert.equal(store.completed(idFor(2), day), false);
    assert.equal(store.add(idFor(1), run), false);
    assert.equal(store.add(idFor(1), {...run, id: idFor(3)}), false);
    assert.equal(store.add(idFor(2), {...run, id: idFor(4)}), true);
    const global = store.totals();
    assert.equal(global.runs, 2);
    assert.equal(global.players[0].species, 'slaking');
    assert.equal(global.players[0].kos, 8);
    assert.equal(global.players[0].damage, 1744);
    assert.equal(global.enemies[0].kos, 6);
  } finally {
    store.close();
  }
});
