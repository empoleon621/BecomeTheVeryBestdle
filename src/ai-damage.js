import {calculate, Field, Generations, Move, Pokemon} from '@smogon/calc';

const generation = Generations.get(9);
const assumedEvs = {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85};
const noDamage = {mean: 0, koChance: 0};
const weatherNames = {
  raindance: 'Rain', primordialsea: 'Heavy Rain', sunnyday: 'Sun', desolateland: 'Harsh Sunshine',
  sandstorm: 'Sand', hail: 'Hail', snowscape: 'Snow', deltastream: 'Strong Winds',
};
const terrainNames = {
  electricterrain: 'Electric', grassyterrain: 'Grassy', mistyterrain: 'Misty', psychicterrain: 'Psychic',
};

function combatant(battle, pokemon, known) {
  const isPublic = known !== undefined;
  const visible = isPublic && pokemon.illusion ? pokemon.illusion : pokemon;
  const species = visible.species;
  const ability = battle.dex.abilities.get(isPublic ? known.ability : pokemon.ability);
  const item = battle.dex.items.get(isPublic ? known.item : pokemon.item);
  const types = pokemon.volatiles.roost ? visible.types.filter(type => type !== 'Flying') : [...visible.types];
  if (!types.length) types.push('Normal');
  if (pokemon.addedType) types.push(pokemon.addedType);

  return {pokemon, species, ability, item, types, isPublic};
}

function applySuppression(battle, combatant, opponent) {
  const {pokemon, ability, item} = combatant;
  const gas = opponent.pokemon.isActive && opponent.ability.id === 'neutralizinggas';
  const modifiedAbility = !ability.flags?.cantsuppress && (pokemon.volatiles.gastroacid ||
    (pokemon.transformed && ability.flags?.notransform) ||
    (gas && ability.id !== 'neutralizinggas' && item.id !== 'abilityshield'));
  if (modifiedAbility) combatant.ability = battle.dex.abilities.get('');
  if (pokemon.volatiles.embargo || battle.field.pseudoWeather.magicroom ||
      (combatant.ability.id === 'klutz' && !item.ignoreKlutz)) {
    combatant.item = battle.dex.items.get('');
  }
}

function calcPokemon({pokemon, species, ability, item, types, isPublic}) {
  const {nature, evs, ivs} = isPublic ? {nature: 'Serious', evs: assumedEvs} : pokemon.set;
  const paradox = pokemon.volatiles[ability.id];
  const abilityOn = ['flashfire', 'slowstart', 'unburden']
    .some(id => ability.id === id && pokemon.volatiles[id]);
  const result = new Pokemon(generation, species.name, {
    level: pokemon.level,
    gender: pokemon.gender,
    ability: ability.name || 'None',
    item: item.name || undefined,
    nature,
    evs,
    ivs,
    boosts: pokemon.boosts,
    status: pokemon.status,
    boostedStat: paradox?.bestStat,
    abilityOn,
    alliesFainted: pokemon.isActive ? pokemon.abilityState?.fallen : pokemon.side.totalFainted,
    // Calc deep-merges arrays with its Pokédex. Clear the original second type explicitly.
    overrides: {baseStats: species.baseStats, types: [types[0], types[1] ?? null], weightkg: species.weightkg},
  });
  // Preserve visible HP thresholds for effects such as Blaze, Multiscale, and Brine.
  const hpRatio = pokemon.hp / pokemon.maxhp;
  const visibleRatio = pokemon.hp === pokemon.maxhp ? 1 : Math.min(99, Math.round(hpRatio * 100)) / 100;
  result.originalCurHP = Math.max(1, Math.round((isPublic ? visibleRatio : hpRatio) * result.maxHP()));
  return result;
}

function sideState(pokemon) {
  const {sideConditions} = pokemon.side;
  return {
    isReflect: !!sideConditions.reflect,
    isLightScreen: !!sideConditions.lightscreen,
    isAuroraVeil: !!sideConditions.auroraveil,
    isTailwind: !!sideConditions.tailwind,
    isSeeded: !!pokemon.volatiles.leechseed,
    isSaltCured: !!pokemon.volatiles.saltcure,
    isForesight: !!pokemon.volatiles.foresight,
    isCharge: !!pokemon.volatiles.charge,
  };
}

function calcField(battle, attacker, defender) {
  const {weather, terrain, pseudoWeather} = battle.field;
  const suppressWeather = [attacker, defender].some(({pokemon, ability}) => pokemon.isActive && ability.suppressWeather);
  return new Field({
    weather: suppressWeather ? undefined : weatherNames[weather],
    terrain: terrainNames[terrain],
    isGravity: !!pseudoWeather.gravity,
    isWonderRoom: !!pseudoWeather.wonderroom,
    attackerSide: sideState(attacker.pokemon),
    defenderSide: sideState(defender.pokemon),
  });
}

function accuracyFor(move, attacker, defender, field) {
  if (move.ohko && attacker.pokemon.level < defender.pokemon.level) return 0;
  if (move.accuracy === true || attacker.ability.id === 'noguard' || defender.ability.id === 'noguard') return 1;
  let accuracy = move.accuracy / 100;
  if (move.id === 'thunder' || move.id === 'hurricane') {
    if (field.hasWeather('Rain', 'Heavy Rain')) return 1;
    if (field.hasWeather('Sun', 'Harsh Sunshine')) accuracy = 0.5;
  }
  if (move.id === 'blizzard' && field.hasWeather('Snow', 'Hail')) return 1;
  if (move.ohko) {
    if (move.id === 'sheercold' && !attacker.types.includes('Ice')) accuracy = 0.2;
    return Math.min(1, accuracy + (attacker.pokemon.level - defender.pokemon.level) / 100);
  }

  const ignoresEvasion = move.ignoreEvasion || defender.pokemon.volatiles.foresight || defender.pokemon.volatiles.miracleeye;
  const evasion = ignoresEvasion || ['keeneye', 'illuminate', 'mindseye'].includes(attacker.ability.id)
    ? 0 : defender.pokemon.boosts.evasion;
  const stage = Math.max(-6, Math.min(6, attacker.pokemon.boosts.accuracy - (evasion ?? 0)));
  accuracy *= stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
  if (field.isGravity) accuracy *= 5 / 3;
  if (attacker.ability.id === 'compoundeyes') accuracy *= 1.3;
  if (attacker.ability.id === 'victorystar') accuracy *= 1.1;
  if (attacker.item.id === 'widelens') accuracy *= 1.1;
  if (attacker.ability.id === 'hustle' && move.category === 'Physical') accuracy *= 0.8;
  if (defender.item.id === 'brightpowder' || defender.item.id === 'laxincense') accuracy *= 0.9;
  if ((defender.ability.id === 'sandveil' && field.hasWeather('Sand')) ||
      (defender.ability.id === 'snowcloak' && field.hasWeather('Snow', 'Hail'))) accuracy *= 0.8;
  return Math.min(1, accuracy);
}

function hitCounts(move, attacker) {
  const {multihit} = move;
  if (multihit === 10 && attacker.item.id === 'loadeddice') {
    return Array.from({length: 7}, (_, index) => [index + 4, 1 / 7]);
  }
  if (!Array.isArray(multihit)) return [[multihit || 1, 1]];
  const [minimum, maximum] = multihit;
  if (attacker.ability.id === 'skilllink') return [[maximum, 1]];
  if (attacker.item.id === 'loadeddice' && minimum === 2 && maximum === 5) return [[4, 0.5], [5, 0.5]];
  if (minimum === 2 && maximum === 5) return [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]];
  return Array.from({length: maximum - minimum + 1}, (_, index) => [minimum + index, 1 / (maximum - minimum + 1)]);
}

function evaluateRolls(rolls, counts, targetHp, survivesFirstHit) {
  // Keep rolls below the KO threshold and use one bucket for all successful KOs.
  let distribution = new Map([[0, 1]]);
  let damageMean = 0;
  const estimate = {...noDamage};
  for (let hit = 0; hit < rolls.length; hit++) {
    const roll = rolls[hit];
    const next = new Map();
    for (const [previous, probability] of distribution) {
      const share = probability / roll.length;
      for (const damage of roll) {
        const total = previous + damage;
        const capped = survivesFirstHit && hit === 0 ? Math.min(targetHp - 1, total) : Math.min(targetHp, total);
        next.set(capped, (next.get(capped) ?? 0) + share);
      }
    }
    distribution = next;
    damageMean += roll.reduce((sum, damage) => sum + damage, 0) / roll.length;
    const weight = counts.get(hit + 1) ?? 0;
    estimate.mean += weight * damageMean;
    estimate.koChance += weight * (distribution.get(targetHp) ?? 0);
  }
  estimate.koChance = Math.min(1, estimate.koChance);
  return estimate;
}

export function damageEstimate(battle, move, attacker, defender, {attackerKnown, defenderKnown} = {}) {
  if (move.category === 'Status' || !defender.hp) return noDamage;
  const source = combatant(battle, attacker, attackerKnown);
  const target = combatant(battle, defender, defenderKnown);
  applySuppression(battle, source, target);
  applySuppression(battle, target, source);
  const field = calcField(battle, source, target);
  const accuracy = accuracyFor(move, source, target, field);
  if (!accuracy) return noDamage;

  const bypassAbility = ['moldbreaker', 'teravolt', 'turboblaze'].includes(source.ability.id) || move.ignoreAbility;
  const sturdy = target.ability.id === 'sturdy' && !bypassAbility;
  const survivesFirstHit = defender.hp === defender.maxhp && (sturdy || target.item.id === 'focussash');
  if (move.ohko) {
    if (!battle.dex.getImmunity(move.type, target.types) || sturdy ||
        (move.id === 'sheercold' && target.types.includes('Ice'))) return noDamage;
    return {mean: accuracy * defender.hp, koChance: survivesFirstHit ? 0 : accuracy};
  }

  if (move.type === 'Ground' && move.id !== 'thousandarrows' && !field.isGravity &&
      target.item.id !== 'ironball' && (defender.volatiles.magnetrise || defender.volatiles.telekinesis)) return noDamage;

  const counts = hitCounts(move, source);
  const maxHits = counts.at(-1)[0];
  const calcDefender = calcPokemon(target);
  const calcMove = new Move(generation, move.name, {
    ability: source.ability.name,
    item: source.item.name,
    hits: maxHits,
    overrides: generation.moves.get(move.id) ? undefined : {
      id: move.id,
      basePower: move.basePower,
      category: move.category,
      type: move.type,
      flags: move.flags,
      priority: move.priority,
      multihit: move.multihit,
      multiaccuracy: move.multiaccuracy,
      willCrit: move.willCrit,
    },
  });
  const {damage} = calculate(generation, calcPokemon(source), calcDefender, calcMove, field);
  const hitRolls = typeof damage === 'number' ? [[damage]] :
    Array.isArray(damage[0]) || damage.length === 2
      ? damage.map(value => Array.isArray(value) ? value : [value])
      : [damage];
  const multiaccuracy = calcMove.multiaccuracy && source.ability.id !== 'skilllink' && source.item.id !== 'loadeddice';
  const probabilities = multiaccuracy
    ? new Map(hitRolls.map((_, index) => [index + 1, accuracy ** (index + 1) * (index + 1 === hitRolls.length ? 1 : 1 - accuracy)]))
    : new Map((hitRolls.length === maxHits ? counts : [[hitRolls.length, 1]])
      .map(([hits, probability]) => [hits, probability * accuracy]));
  const result = evaluateRolls(hitRolls, probabilities, calcDefender.curHP(), survivesFirstHit);
  // Match the caller's HP units while preserving the estimated damage as a share of visible HP.
  result.mean *= defender.hp / calcDefender.curHP();
  return result;
}
