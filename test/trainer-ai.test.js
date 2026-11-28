import assert from 'node:assert/strict';
import test from 'node:test';
import {Battle} from '@pkmn/sim';
import {chooseTrainerAction} from '../src/trainer-ai.js';

const seed = [1, 2, 3, 4];
const set = (species, ability, moves, extra = {}) => ({species, ability, moves, level: 75, ...extra});
const gastrodon = set('Gastrodon', 'Storm Drain', ['Earth Power', 'Recover']);
const rotom = set('Rotom-Wash', 'Levitate', ['Hydro Pump', 'Volt Switch']);
const heatran = set('Heatran', 'Flash Fire', ['Flamethrower']);

function start(player, trainer) {
  const battle = new Battle({formatid: 'gen9customgame@@@!Team Preview,Terastal Clause', seed});
  battle.setPlayer('p1', {name: 'Guest', team: player});
  battle.setPlayer('p2', {name: 'Trainer', team: trainer});
  return battle;
}

test('a trainer can switch into an absorbing ability when badly outmatched', () => {
  const battle = start([rotom], [heatran, gastrodon]);
  const command = chooseTrainerAction(battle, seed);
  assert.equal(command, 'switch 2');
  assert.ok(battle.choose('p1', 'move 1'));
  assert.ok(battle.choose('p2', command));
  assert.equal(battle.p2.active[0].name, 'Gastrodon');
  assert.equal(battle.p2.active[0].hp, battle.p2.active[0].maxhp);
  assert.equal(battle.p2.active[0].boosts.spa, 1);
});

test('a trainer takes a fast KO and ignores the player’s queued move and unseen item', () => {
  const pikachu = set('Pikachu', 'Static', ['Thunderbolt', 'Quick Attack']);
  const weavile = set('Weavile', 'Pressure', ['Night Slash', 'Ice Shard']);
  const plain = start([pikachu], [weavile, gastrodon]);
  const differentSet = start([{...pikachu, item: 'Choice Scarf', nature: 'Timid'}], [weavile, gastrodon]);
  plain.p1.active[0].hp = 75;
  differentSet.p1.active[0].hp = 75;
  assert.ok(plain.choose('p1', 'move 1'));
  assert.ok(differentSet.choose('p1', 'move 2'));
  const before = JSON.stringify(plain.toJSON());
  const command = chooseTrainerAction(plain, seed);
  assert.equal(command, 'move 1');
  assert.equal(chooseTrainerAction(differentSet, seed), command);
  assert.equal(JSON.stringify(plain.toJSON()), before);
  assert.ok(plain.choose('p2', command));
  assert.equal(plain.winner, 'Trainer');
});

test('after a KO the trainer picks a viable replacement that survives entry hazards', () => {
  const starmie = set('Starmie', 'Illuminate', ['Surf']);
  const rhydon = set('Rhydon', 'Rock Head', ['Earthquake']);
  const charizard = set('Charizard', 'Blaze', ['Fire Blast']);
  const battle = start([starmie], [rhydon, charizard, gastrodon]);
  battle.p2.pokemon[0].hp = 1;
  battle.p2.pokemon[1].hp = 1;
  battle.p2.addSideCondition('stealthrock', battle.p1.active[0]);
  assert.ok(battle.choose('p1', 'move 1'));
  assert.ok(battle.choose('p2', 'move 1'));
  assert.ok(battle.p2.activeRequest.forceSwitch[0]);
  const replacement = chooseTrainerAction(battle, seed);
  assert.equal(replacement, 'switch 3');
  assert.ok(battle.choose('p2', replacement));
  assert.equal(battle.p2.active[0].name, 'Gastrodon');
  assert.ok(battle.p2.active[0].hp > 0);
});
