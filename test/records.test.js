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
  assert.equal(one.players.length, 6);
  const slaking = one.players.find(row => row.species === 'slaking');
  assert.deepEqual(slaking, {species: 'slaking', kos: 4, damage: 872, moves: {gigaimpact: 4}});
  assert.deepEqual(one.enemies, [
    {trainer: 'flint', species: 'infernape', kos: 3}, {trainer: 'flint', species: 'arcanine', kos: 3},
  ]);
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
