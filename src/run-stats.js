import {Dex} from '@pkmn/sim';

const identity = pokemon => Dex.species.get(pokemon.set.species).id;

export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function newRunStats(saved, partial) {
  return saved ? structuredClone(saved) : {id: randomId(), partial, players: {}, enemies: {}};
}

function playerRecord(stats, pokemon) {
  return stats.players[identity(pokemon)] ??= {kos: 0, damage: 0, moves: {}};
}

export function recordMove(stats, pokemon, move) {
  const {id, exists} = Dex.moves.get(move);
  if (!exists) return;
  const moves = playerRecord(stats, pokemon).moves;
  moves[id] = (moves[id] ?? 0) + 1;
}

function damageSource(target, source, effect) {
  if (source?.side && source !== target) return source;
  const id = effect?.id ?? target.battle.effect?.id;
  if (!id) return source;
  const {field} = target.battle;
  if (target.status === id) return target.statusState.source ?? source;
  if (field.weather === id) return field.weatherState.source ?? source;
  return target.volatiles[id]?.source ?? target.side.sideConditions[id]?.source ?? source;
}

export function trackBattle(battle, stats, trainerId) {
  const pendingKOs = new WeakMap();
  const add = battle.add;
  // Observe the simulator without adding event handlers that could change RNG consumption.
  Object.defineProperty(battle, 'add', {value(event, ...args) {
    const result = add.call(this, event, ...args);
    if (event === 'faint') {
      const target = args[0];
      const source = pendingKOs.get(target);
      pendingKOs.delete(target);
      if (!source?.side || source.side === target.side) return result;
      if (source.side.id === 'p1') playerRecord(stats, source).kos++;
      else {
        const species = identity(source);
        const record = stats.enemies[trainerId + '/' + species] ??= {trainer: trainerId, species, kos: 0};
        record.kos++;
      }
    }
    return result;
  }});
  for (const pokemon of battle.sides.flatMap(side => side.pokemon)) {
    const {damage, faint} = pokemon;
    Object.defineProperties(pokemon, {
      damage: {value(amount, source, effect) {
        const owner = damageSource(this, source, effect);
        const dealt = damage.call(this, amount, source, effect);
        if (dealt > 0 && owner?.side?.id === 'p1' && owner.side !== this.side) {
          playerRecord(stats, owner).damage += dealt;
        }
        return dealt;
      }},
      faint: {value(source, effect) {
        if (!this.fainted && !this.faintQueued) pendingKOs.set(this, damageSource(this, source, effect));
        return faint.call(this, source, effect);
      }},
    });
  }
}

export function reportRun(stats, team, result) {
  return {
    id: stats.id, partial: stats.partial, ...result,
    players: team.map(set => {
      const species = Dex.species.get(set.species).id;
      return {species, ...(stats.players[species] ?? {kos: 0, damage: 0, moves: {}})};
    }),
    enemies: Object.values(stats.enemies).sort((a, b) => b.kos - a.kos),
  };
}
