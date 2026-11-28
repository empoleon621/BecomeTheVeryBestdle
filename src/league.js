import {Dex, PRNG, Teams} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';
import {eliteMonotypeSets} from './elite-monotype-sets.js';
import {champions, trainers} from './trainer-rosters.js';

Teams.setGeneratorFactory(TeamGenerators);

const resetHour = 21;
export const firstChallengeDay = '2026-11-26';
const pacificClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
});

export function dayKey(now = new Date(), offset = 0) {
  const {year, month, day, hour} = Object.fromEntries(pacificClock.formatToParts(now).map(({type, value}) => [type, Number(value)]));
  return new Date(Date.UTC(year, month - 1, day + Number(hour >= resetHour) + offset)).toISOString().slice(0, 10);
}

export function resetAt(day) {
  const utc = new Date(`${day}T${resetHour}:00:00Z`);
  const localHour = Number(pacificClock.formatToParts(utc).find(({type}) => type === 'hour').value);
  return utc.getTime() + (resetHour - localHour) * 3600000;
}

export function isArchiveDay(day, currentDay = dayKey()) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < firstChallengeDay || day >= currentDay) return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

export function seedFor(key) {
  let hash = 2166136261;
  return Array.from({length: 4}, (_, index) => {
    for (const char of key + index) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 16;
  });
}

const stats = {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85};
export const expandedElitePoolsFrom = '2026-11-27';
export const typedEliteFrom = '2026-11-29';

function eliteRoster(day, name, type, roster) {
  const originals = new Set(roster.map(set => Dex.species.get(set.species).baseSpecies));
  const pool = roster.concat(eliteMonotypeSets[type].filter(set => !originals.has(Dex.species.get(set.species).baseSpecies)));
  const rng = new PRNG(seedFor('elite-roster/' + day + '/' + name));
  const size = 4 + rng.random(2);
  const slots = pool.map((_, index) => index);
  rng.shuffle(slots);
  const selected = new Set();
  const items = new Set();
  for (const slot of slots) {
    const item = Dex.items.get(pool[slot].item).id;
    if (items.has(item)) continue;
    selected.add(slot);
    items.add(item);
    if (selected.size === size) break;
  }
  return pool.filter((_, index) => selected.has(index));
}

export function dailyLeague(day) {
  const rng = new PRNG(seedFor('league/' + day));
  const eligible = trainers.slice();
  rng.shuffle(eligible);
  const specialists = day >= typedEliteFrom
    ? eligible.filter(([, type], index) => eligible.findIndex(([, candidate]) => candidate === type) === index)
    : eligible;
  return [...specialists.slice(0, 4), champions[rng.random(champions.length)]]
    .map(([name, type, mark, roster], round) => {
      const base = roster.map(([species, ability, moves, item]) => ({
        species, ability, moves: moves.split(', '), item, evs: {...stats}, nature: 'Serious',
      }));
      const themed = round < 4 && day >= typedEliteFrom
        ? base.filter(set => Dex.species.get(set.species).types.includes(type))
        : base;
      const picks = round < 4 && day >= expandedElitePoolsFrom ? eliteRoster(day, name, type, themed) : themed;
      return {
        id: name.toLowerCase(), name, type, mark,
        team: picks.map(set => ({...structuredClone(set), level: [73, 75, 77, 79, 82][round]})),
      };
    });
}

export function draftTeam(day) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const team = Teams.generate('gen9randombattle', {seed: seedFor('draft/' + day + '/' + attempt)});
    if (team.length !== 6 || !team.some(set => Dex.species.get(set.species).gen === 9)) continue;
    const playable = team.every(set => {
      const species = Dex.species.get(set.species);
      return !set.moves.includes('terablast') && (species.bst >= 390 || species.id === 'ditto');
    });
    if (playable) return team;
  }
  throw new Error('Could not draft a team for the daily challenge.');
}

export function speciesInfo(name) {
  const species = Dex.species.get(name);
  return {name: species.name || name, types: species.types, sprite: species.spriteid};
}

export const bagItems = {
  fullrestore: {name: 'Full Restore', description: 'Restores all HP and cures status.'},
  revive: {name: 'Revive', description: 'Revives a fainted Pokémon with half its HP.'},
  maxrevive: {name: 'Max Revive', description: 'Revives a fainted Pokémon with full HP.'},
};

export const rewards = {
  level: {name: '+5 levels', description: 'Raise one Pokémon by five levels, up to level 100.', targets: 1},
  revive: {name: 'Revive', description: 'Bring one fainted Pokémon back at full HP.', targets: 1},
  heal: {name: 'Full HP', description: 'Heal up to two living Pokémon to full HP.', targets: 2},
  fullrestores: {name: '3 Full Restores', description: 'Add three Full Restores to your bag.', targets: 0, item: 'fullrestore', quantity: 3},
  maxrevive: {name: '1 Max Revive', description: 'Add one Max Revive to your bag.', targets: 0, item: 'maxrevive', quantity: 1},
};

export function rewardOffers(day, round) {
  const options = Object.keys(rewards);
  new PRNG(seedFor('rewards/' + day + '/' + round)).shuffle(options);
  return options.slice(0, 3);
}
