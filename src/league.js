import {Dex, PRNG, Teams} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';
import {champions, trainers} from './trainer-rosters.js';

Teams.setGeneratorFactory(TeamGenerators);

export const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);

export function seedFor(key) {
  let hash = 2166136261;
  return Array.from({length: 4}, (_, index) => {
    for (const char of key + index) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 16;
  });
}

const stats = {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85};

export function dailyLeague(day) {
  const rng = new PRNG(seedFor('league/' + day));
  const eligible = trainers.slice();
  rng.shuffle(eligible);
  return [...eligible.slice(0, 4), champions[rng.random(champions.length)]]
    .map(([name, type, mark, roster], round) => ({
      id: name.toLowerCase(), name, type, mark,
      team: roster.map(([species, ability, moves, item]) => {
        return {
          species, ability, moves: moves.split(', '),
          item,
          level: [73, 75, 77, 79, 82][round],
          evs: {...stats}, nature: 'Serious',
        };
      }),
    }));
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
  revive: {name: 'Revive', description: 'Bring one fainted Pokémon back at half HP.', targets: 1},
  heal: {name: 'Full HP', description: 'Heal up to two living Pokémon to full HP.', targets: 2},
  fullrestores: {name: '3 Full Restores', description: 'Add three Full Restores to your bag.', targets: 0, item: 'fullrestore', quantity: 3},
  maxrevive: {name: '1 Max Revive', description: 'Add one Max Revive to your bag.', targets: 0, item: 'maxrevive', quantity: 1},
};

export function rewardOffers(day, round) {
  const options = Object.keys(rewards);
  new PRNG(seedFor('rewards/' + day + '/' + round)).shuffle(options);
  return options.slice(0, 3);
}
