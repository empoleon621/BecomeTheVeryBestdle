import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Dex, TeamValidator} from '@pkmn/sim';
import {dailyLeague, dayKey, draftTeam, expandedElitePoolsFrom, isArchiveDay, resetAt, rewardOffers, rewards, typedEliteFrom} from '../src/league.js';
import {LeagueRun} from '../src/battle.js';
import {eliteMonotypeSets} from '../src/elite-monotype-sets.js';
import {trainers} from '../src/trainer-rosters.js';

test('challenge resets at 9 p.m. Pacific across midnight UTC and daylight saving time', () => {
  for (const [day, instant] of [
    ['2026-11-26', '2026-11-27T05:00:00Z'],
    ['2027-03-14', '2027-03-15T04:00:00Z'],
    ['2027-11-07', '2027-11-08T05:00:00Z'],
  ]) {
    const reset = Date.parse(instant);
    assert.equal(resetAt(day), reset);
    assert.equal(dayKey(new Date(reset - 1)), day);
    assert.equal(dayKey(new Date(reset)), instant.slice(0, 10));
    assert.equal(dayKey(new Date(reset), -1), day);
  }
  assert.equal(dayKey(new Date('2026-11-27T00:00:00Z')), '2026-11-26');
});

test('independent runs of a challenge draw the same six complete sets', () => {
  const day = '2026-11-26';
  const draft = draftTeam(day);
  assert.equal(draft.length, 6);
  assert.equal(new Set(draft.map(set => set.species)).size, 6);
  for (const set of draft) {
    assert.equal(set.moves.length, 4);
    assert.ok(set.ability);
    assert.ok(!set.moves.includes('terablast'));
  }
  assert.deepEqual(draftTeam(day), draft);
  assert.notDeepEqual(draftTeam('2026-11-27'), draft);
});

test('archive accepts completed challenge dates and rejects current, future, and invalid dates', () => {
  assert.ok(isArchiveDay('2026-11-26', '2026-11-27'));
  assert.ok(isArchiveDay('2026-11-28', '2026-12-01'));
  for (const date of [null, '2026-11-25', '2026-11-31', '26-11-2026']) {
    assert.equal(isArchiveDay(date, '2026-12-01'), false, String(date));
  }
  assert.equal(isArchiveDay('2026-11-27', '2026-11-27'), false);
  assert.equal(isArchiveDay('2026-11-28', '2026-11-27'), false);
});

const nationalDex = new TeamValidator('gen9nationaldexag@@@Species Clause,Terastal Clause,-Tera Blast');

test('the imported sets are National Dex legal at every Elite Four level', () => {
  const olderSpecies = new Set();
  const olderMoves = new Set();
  for (const [type, sets] of Object.entries(eliteMonotypeSets)) {
    assert.equal(new Set(sets.map(set => Dex.species.get(set.species).baseSpecies)).size, sets.length);
    for (const set of sets) {
      const species = Dex.species.get(set.species);
      assert.ok(species.types.includes(type), set.species);
      if (species.isNonstandard === 'Past') olderSpecies.add(species.id);
      for (const move of set.moves) if (Dex.moves.get(move).isNonstandard === 'Past') olderMoves.add(move);
      for (const level of [73, 75, 77, 79]) {
        assert.equal(nationalDex.validateTeam([{...structuredClone(set), level}]), null, set.species + ' at level ' + level);
      }
    }
  }
  assert.ok(olderSpecies.has('aegislash'));
  assert.ok(olderMoves.has('Fishious Rend'));
});

test('a National Dex opponent can use a move absent from Scarlet and Violet', () => {
  const day = '2026-12-21';
  const round = dailyLeague(day).findIndex(trainer => trainer.team.some(set => set.species === 'Dracovish'));
  assert.ok(round >= 0);
  const run = new LeagueRun(day, {round});
  assert.ok(run.start(run.view().team[0].id));
  const {battle} = run;
  const slot = battle.p2.pokemon.findIndex(pokemon => pokemon.species.id === 'dracovish') + 1;
  assert.ok(battle.choose('p1', 'switch 2'));
  assert.ok(battle.choose('p2', 'switch ' + slot));
  const move = battle.p2.active[0].moveSlots.findIndex(slot => slot.id === 'fishiousrend') + 1;
  assert.ok(battle.choose('p1', 'switch 3'));
  assert.ok(battle.choose('p2', 'move ' + move));
  const log = run.view().log;
  const used = log.findIndex(entry => entry.message === 'Dracovish used Fishious Rend!');
  assert.ok(used > -1);
  assert.equal(log[used + 1].event, '-damage');
});

test('daily rotation draws legal Elite Four subsets and full Champion teams', () => {
  const validator = new TeamValidator('gen9ubers');
  const checked = new Set();
  const trainerFrames = new Set();
  const lineups = new Set();
  const shortSizes = new Set();
  const rosters = new Map(trainers.map(([name, type, , team]) => [name, new Set([
    ...team.map(([species]) => species), ...eliteMonotypeSets[type].map(set => set.species),
  ])]));
  const seen = new Map(trainers.map(([name]) => [name, new Set()]));
  for (let day = 1; day <= 62; day++) {
    const date = new Date(Date.UTC(2026, 10, day)).toISOString().slice(0, 10);
    const league = dailyLeague(date);
    assert.deepEqual(dailyLeague(date), league);
    assert.equal(league.length, 5);
    assert.equal(new Set(league.map(trainer => trainer.name)).size, 5);
    if (date >= typedEliteFrom) assert.equal(new Set(league.slice(0, 4).map(trainer => trainer.type)).size, 4, date);
    assert.equal(league[4].type, 'Champion');
    lineups.add(league.map(trainer => trainer.name).join('/'));
    for (const [round, trainer] of league.entries()) {
      const size = trainer.team.length;
      if (date >= expandedElitePoolsFrom && round < 4) {
        assert.ok(size === 4 || size === 5, trainer.name);
        shortSizes.add(size);
        for (const set of trainer.team) {
          assert.ok(rosters.get(trainer.name).has(set.species), set.species);
          if (date >= typedEliteFrom) assert.ok(Dex.species.get(set.species).types.includes(trainer.type), set.species);
          assert.equal(set.level, [73,75,77,79][round]);
          seen.get(trainer.name).add(Dex.species.get(set.species).baseSpecies);
        }
        assert.equal(new Set(trainer.team.map(set => Dex.species.get(set.species).baseSpecies)).size, size, trainer.name);
        assert.equal(new Set(trainer.team.map(set => set.item)).size, size, trainer.name);
      } else assert.equal(size, 6, trainer.name);
      assert.equal(new Set(trainer.team.map(set => set.species)).size, size, trainer.name);
      const legalFormat = date >= expandedElitePoolsFrom && round < 4 ? nationalDex : validator;
      assert.equal(legalFormat.validateTeam(trainer.team), null, trainer.name);
      if (checked.has(trainer.id)) continue;
      const heldItems = trainer.team.map(set => set.item);
      assert.equal(new Set(heldItems).size, heldItems.length, trainer.name);
      assert.ok(heldItems.filter(item => item === 'Sitrus Berry').length <= 1);
      checked.add(trainer.id);
      trainerFrames.add(readFileSync(new URL('../src/graphics/overworld/' + trainer.id + '.png', import.meta.url)).toString('base64'));
      const run = new LeagueRun(date, {round});
      assert.ok(run.start(run.view().team[0].id), trainer.name);
      assert.deepEqual(run.view().foes, Array(size).fill(false));
      assert.ok(run.choose('move ' + (run.view().moves.findIndex(move => !move.disabled) + 1)), trainer.name);
    }
  }
  assert.equal(checked.size, 26);
  assert.equal(trainerFrames.size, checked.size);
  assert.ok(lineups.size > 1);
  assert.deepEqual(shortSizes, new Set([4, 5]));
  for (const [name, species] of seen) assert.ok(species.size > 6, name);
});

test('Prankster avoids targeting Dark opponents while retaining self-targeted recovery', () => {
  const original = new LeagueRun('2026-11-28', {round: 2});
  assert.ok(original.start('chienpao'));
  const snapshot = original.snapshot();
  const setup = 'move ' + (original.view().moves.findIndex(move => move.id === 'swordsdance') + 1);
  assert.ok(original.choose(setup));
  assert.ok(original.view().log.some(entry => entry.message === 'Sableye used Will-O-Wisp!'));
  assert.ok(original.view().log.some(entry => entry.message === 'It had no effect on Chien-Pao.'));

  const soloSableye = () => {
    const run = new LeagueRun(typedEliteFrom, structuredClone(snapshot));
    // Isolate move selection from the trainer's option to switch out.
    const {p2} = run.battle;
    for (const member of p2.pokemon.slice(1)) {
      member.hp = 0;
      member.fainted = true;
    }
    p2.pokemonLeft = 1;
    return run;
  };
  const updated = soloSableye();
  assert.ok(updated.choose(setup));
  assert.ok(updated.view().log.some(entry => entry.message === 'Sableye used Knock Off!'));

  const healing = soloSableye();
  Object.assign(healing.battle.p1.active[0].boosts, {atk: -6, spa: -6});
  const sableye = healing.battle.p2.active[0];
  sableye.sethp(Math.floor(sableye.maxhp / 4));
  assert.ok(healing.choose(setup));
  assert.ok(healing.view().log.some(entry => entry.message === 'Sableye used Recover!'));
});

test('reload preserves the available choices, HP and the next turn outcome', () => {
  const day = '2026-11-26';
  const run = new LeagueRun(day);
  assert.equal(run.start(run.view().team[0].id), true);
  const initial = run.view();
  const bench = initial.team.find(member => !member.active);
  assert.equal(run.choose('switch ' + bench.slot), true);
  const before = run.view();
  assert.equal(before.player.name, bench.name);
  assert.ok(before.turn > initial.turn);
  const restored = new LeagueRun(day, JSON.parse(JSON.stringify(run.snapshot())));
  assert.deepEqual(restored.view(), before);
  const command = before.forced
    ? 'switch ' + before.team.find(member => member.hp && !member.active).slot
    : 'move ' + (before.moves.findIndex(move => !move.disabled) + 1);
  assert.equal(run.choose(command), true);
  assert.equal(restored.choose(command), true);
  assert.deepEqual(restored.view(), run.view());
});

test('Calm Mind reports the stat cap and exposes stage changes during playback', () => {
  const day = '2026-11-27';
  const run = new LeagueRun(day);
  run.team[0].moves = ['Calm Mind', 'Growl'];
  run.camp = run.initialParty();
  run.league[0].team[0].moves = ['Splash'];
  assert.ok(run.start('lugia'));
  const firstTurn = run.view().log.length;
  assert.ok(run.choose('move 1'));
  const firstBoosts = run.view().log.slice(firstTurn).filter(entry => entry.event === '-boost');
  assert.equal(firstBoosts[0].stages.p1.spa, 1);
  assert.equal(firstBoosts[0].stages.p1.spd, 0);
  assert.equal(firstBoosts[1].stages.p1.spd, 1);
  for (let i = 0; i < 6; i++) assert.ok(run.choose('move 1'));
  assert.equal(run.view().player.boosts.spa, 6);
  assert.ok(run.view().log.some(entry => entry.message === 'Lugia’s Sp. Atk won’t go any higher!'));
  for (let i = 0; i < 7; i++) assert.ok(run.choose('move 2'));
  assert.equal(run.view().opponent.boosts.atk, -6);
  assert.ok(run.view().log.some(entry => entry.message.endsWith('Attack won’t go any lower!')));
  const restored = new LeagueRun(day, JSON.parse(JSON.stringify(run.snapshot())));
  assert.equal(restored.view().player.boosts.spa, 6);
  assert.ok(restored.choose('switch 2'));
  assert.equal(restored.view().player.boosts.spa, 0);
});

test('Belly Drum reports capped Attack when the simulator emits a generic failure', () => {
  const run = new LeagueRun('2026-11-27');
  run.team[0].moves = ['Belly Drum'];
  run.camp = run.initialParty();
  run.league[0].team[0].moves = ['Splash'];
  assert.ok(run.start('lugia'));
  assert.ok(run.choose('move 1'));
  assert.equal(run.view().player.boosts.atk, 6);
  assert.ok(run.choose('move 1'));
  assert.ok(run.view().log.some(entry => entry.message === 'Lugia’s Attack won’t go any higher!'));
});

test('Umbreon stops wasting Toxic on Hisuian Qwilfish starting with the November 27 challenge', () => {
  const run = new LeagueRun('2026-11-26', {round: 2});
  assert.ok(run.start('qwilfishhisui'));
  const initial = JSON.parse(JSON.stringify(run.snapshot()));
  const spikes = 'move ' + (run.view().moves.findIndex(move => move.id === 'spikes') + 1);
  assert.ok(run.choose(spikes));
  assert.ok(run.view().log.some(entry => entry.message === 'Umbreon used Toxic!'));
  assert.ok(run.view().log.some(entry => entry.message === 'It had no effect on Qwilfish.'));

  const nextChallenge = new LeagueRun('2026-11-27', initial);
  assert.ok(nextChallenge.choose(spikes));
  const used = nextChallenge.view().log.filter(entry => entry.message?.startsWith('Umbreon used'));
  assert.deepEqual(used.map(entry => entry.message), ['Umbreon used Foul Play!']);

  const corrosion = new LeagueRun('2026-11-27', initial);
  corrosion.battle.p1.active[0].setType(['Steel', 'Dark']);
  corrosion.battle.p2.active[0].setAbility('corrosion');
  assert.ok(corrosion.choose(spikes));
  assert.ok(corrosion.view().log.some(entry => entry.message === 'Umbreon used Toxic!'));
  assert.equal(corrosion.view().player.status, 'tox');
});

function winOpeningBattle() {
  const day = '2026-11-26';
  const run = new LeagueRun(day);
  assert.equal(run.start('reshiram'), true);
  const firstRound = [
    'move 4', 'move 3', 'move 1', 'move 3', 'move 3', 'switch 3', 'move 2', 'move 2', 'move 2', 'move 2',
  ];
  for (const command of firstRound) assert.equal(run.choose(command), true);
  assert.equal(run.phase, 'advance');
  return run;
}

test('level rewards carry through the hallway while PP refills and damage carries over', () => {
  const opening = winOpeningBattle();
  assert.equal(opening.advance('level', ['slitherwing']), false);
  const run = new LeagueRun(opening.day, {...opening.snapshot(), round: 1});
  const afterFight = run.view().team.find(member => member.id === 'reshiram');
  const injured = run.view().team.find(member => member.id === 'slitherwing');
  assert.equal(afterFight.hp, 0);
  assert.ok(afterFight.moves[0].pp < afterFight.moves[0].maxpp);
  assert.equal(run.advance(), false);
  assert.equal(run.advance('level', ['slitherwing']), true);
  assert.equal(run.advance('level', ['slitherwing']), false);
  const leveled = run.view().team.find(member => member.id === 'slitherwing');
  assert.equal(leveled.level, injured.level + 5);
  assert.equal(leveled.maxhp - leveled.hp, injured.maxhp - injured.hp);
  assert.ok(leveled.moves.every(move => move.pp === move.maxpp));
  assert.deepEqual(run.view().bag, {fullrestore: 0, revive: 0, maxrevive: 0});
  assert.equal(run.start('reshiram'), false);
  assert.equal(run.view().team.find(member => member.id === 'reshiram').hp, 0);
  const restored = new LeagueRun(run.day, JSON.parse(JSON.stringify(run.snapshot())));
  assert.equal(restored.start('slitherwing'), true);
  const lead = restored.view().team.find(member => member.active);
  assert.equal(lead.id, 'slitherwing');
  assert.equal(lead.level, leveled.level);
  assert.equal(lead.maxhp, leveled.maxhp);
  assert.equal(lead.hp, leveled.hp);
  assert.ok(lead.moves.every(move => move.pp === move.maxpp));
});

test('one reward can revive a fainted target or fill the HP of two injured living targets', () => {
  const won = winOpeningBattle();
  const fainted = won.view().team.find(member => member.id === 'reshiram');
  assert.equal(won.advance('revive', ['pyroar']), false);
  assert.equal(won.advance('revive', ['reshiram']), true);
  const revived = won.view().team.find(member => member.id === 'reshiram');
  assert.equal(revived.hp, fainted.maxhp);
  assert.ok(revived.moves.every(move => move.pp === move.maxpp));
  assert.equal(won.view().bag.revive, 0);

  const snapshot = JSON.parse(JSON.stringify(winOpeningBattle().snapshot()));
  snapshot.round = 2;
  const pyroar = snapshot.battle.sides[0].pokemon.find(member => member.species === '[Species:pyroar]');
  pyroar.hp -= 20;
  pyroar.status = 'brn';
  const healing = new LeagueRun(won.day, snapshot);
  assert.equal(healing.advance('heal', ['pyroar']), false);
  assert.equal(healing.advance('heal', ['pyroar', 'pyroar']), false);
  assert.equal(healing.advance('heal', ['pyroar', 'reshiram']), false);
  assert.equal(healing.advance('heal', ['pyroar', 'slitherwing']), true);
  const party = healing.view().team;
  for (const id of ['pyroar', 'slitherwing']) {
    const member = party.find(candidate => candidate.id === id);
    assert.equal(member.hp, member.maxhp);
  }
  assert.equal(party.find(member => member.id === 'pyroar').status, 'brn');
  assert.equal(party.find(member => member.id === 'reshiram').hp, 0);
  assert.equal(healing.view().bag.fullrestore, 0);
});

test('three stable offers are drawn from the full reward pool, and bag rewards grant stock once', () => {
  const run = winOpeningBattle();
  const {day} = run;
  assert.deepEqual(run.view().bag, {fullrestore: 0, revive: 0, maxrevive: 0});
  const offers = [0, 1, 2, 3].map(round => rewardOffers(day, round));
  assert.ok(offers.every(draw => draw.length === 3 && new Set(draw).size === 3));
  assert.deepEqual(new Set(offers.flat()), new Set(Object.keys(rewards)));
  const restored = new LeagueRun(day, JSON.parse(JSON.stringify(run.snapshot())));
  assert.deepEqual(restored.view().rewardOffers, run.view().rewardOffers);
  assert.equal(restored.advance('fullrestores', ['reshiram']), false);
  assert.equal(restored.advance('fullrestores'), true);
  assert.equal(restored.advance('fullrestores'), false);
  assert.equal(restored.view().bag.fullrestore, 3);
  assert.equal(restored.view().team.find(member => member.id === 'reshiram').hp, 0);

  assert.equal(run.advance('maxrevive'), true);
  assert.equal(run.view().bag.maxrevive, 1);
  assert.equal(run.start('slaking'), true);
  assert.equal(run.useItem('maxrevive', 'slaking'), '');
  assert.ok(run.useItem('maxrevive', 'reshiram'));
  const revived = run.view().team.find(member => member.id === 'reshiram');
  assert.equal(revived.hp, revived.maxhp);
  assert.equal(run.view().bag.maxrevive, 0);
});

test('an in-battle Full Restore spends one item and one turn without refilling PP', () => {
  const run = new LeagueRun('2026-11-26', {bag: {fullrestore: 1}});
  assert.equal(run.start('reshiram'), true);
  assert.equal(run.choose('move 1'), true);
  assert.equal(run.choose('move 1'), true);
  const before = run.view();
  assert.ok(run.useItem('fullrestore', 'reshiram'));
  const after = run.view();
  assert.equal(after.bag.fullrestore, 0);
  assert.equal(after.turn, before.turn + 1);
  assert.deepEqual(after.moves.map(move => move.pp), before.moves.map(move => move.pp));
});

test('older hallway saves refill PP and drop Ether without changing HP, status, or remaining items', () => {
  const day = '2026-11-26';
  const snapshot = new LeagueRun(day).snapshot();
  const member = snapshot.camp[0];
  member.status = 'par';
  member.hp = member.maxhp - 40;
  member.moves[0].pp -= 3;
  snapshot.bag = {fullrestore: 3, revive: 1, ether: 2};
  const run = new LeagueRun(day, snapshot);
  assert.deepEqual(run.view().bag, {fullrestore: 3, revive: 1, maxrevive: 0});
  assert.equal(run.view().team[0].hp, member.hp);
  assert.equal(run.view().team[0].status, 'par');
  assert.equal(run.view().team[0].moves[0].pp, member.moves[0].maxpp);
  assert.ok(run.useItem('fullrestore', member.id));
  assert.equal(run.view().bag.fullrestore, 2);
  assert.equal(run.start(member.id), true);
  const view = run.view();
  assert.equal(view.player.status, '');
  assert.equal(view.player.hp, member.maxhp);
  assert.equal(view.moves[0].pp, member.moves[0].maxpp);
});
