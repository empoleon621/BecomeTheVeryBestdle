import {PRNG} from '@pkmn/sim';
import {damageEstimate} from './ai-damage.js';

const STAB = {
  Normal: ['Body Slam', 'Hyper Voice'], Fire: ['Fire Punch', 'Flamethrower'], Water: ['Liquidation', 'Surf'],
  Electric: ['Thunder Punch', 'Thunderbolt'], Grass: ['Seed Bomb', 'Energy Ball'], Ice: ['Ice Spinner', 'Ice Beam'],
  Fighting: ['Drain Punch', 'Aura Sphere'], Poison: ['Poison Jab', 'Sludge Bomb'], Ground: ['Earthquake', 'Earth Power'],
  Flying: ['Drill Peck', 'Air Slash'], Psychic: ['Zen Headbutt', 'Psychic'], Bug: ['X-Scissor', 'Bug Buzz'],
  Rock: ['Rock Slide', 'Power Gem'], Ghost: ['Shadow Claw', 'Shadow Ball'], Dragon: ['Dragon Claw', 'Dragon Pulse'],
  Dark: ['Crunch', 'Dark Pulse'], Steel: ['Iron Head', 'Flash Cannon'], Fairy: ['Play Rough', 'Moonblast'],
};
const HAZARDS = {spikes: 3, toxicspikes: 2, stealthrock: 1, stickyweb: 1};
const RECOVERY = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'milkdrink', 'healorder', 'synthesis', 'morningsun', 'moonlight', 'shoreup', 'strengthsap', 'wish', 'rest']);
const OPPOSING_TARGETS = new Set(['normal', 'adjacentFoe', 'randomNormal', 'any', 'allAdjacent', 'allAdjacentFoes']);

function observedSet(battle, target) {
  const observed = {ability: '', item: '', moves: new Set()};
  const name = target.illusion?.name ?? target.name;
  for (let i = 0; i < battle.log.length; i++) {
    const [, event, who, value, ...details] = battle.log[i].split('|');
    if (event === 'split') {
      i++;
    } else if (who?.startsWith('p1') && who.slice(who.indexOf(': ') + 2) === name) {
      if (event === '-ability') observed.ability = value;
      if (event === '-item') observed.item = value;
      if (event === '-enditem') observed.item = '';
      if (['-immune', '-activate'].includes(event) && value?.startsWith('[from] ability: ')) {
        observed.ability = value.slice('[from] ability: '.length);
      }
      if (event === 'move' && !details.some(detail => detail.startsWith('[from]'))) observed.moves.add(value);
    }
  }
  return observed;
}

function speed(battle, pokemon, observed) {
  const base = (pokemon.illusion ?? pokemon).species.baseStats.spe;
  let value = observed
    ? Math.floor((2 * base + 31 + 21) * pokemon.level / 100) + 5
    : pokemon.storedStats.spe;
  const stage = pokemon.boosts.spe;
  value *= stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
  const ability = battle.dex.abilities.get(observed?.ability ?? pokemon.ability).id;
  const item = battle.dex.items.get(observed?.item ?? pokemon.item).id;
  const weather = battle.field.effectiveWeather();
  if (pokemon.side.sideConditions.tailwind) value *= 2;
  if (item === 'choicescarf' && !battle.field.pseudoWeather.magicroom && !pokemon.volatiles.embargo && ability !== 'klutz') value *= 1.5;
  if (ability === 'quickfeet' && pokemon.status) value *= 1.5;
  else if (pokemon.status === 'par') value *= 0.5;
  if ((ability === 'swiftswim' && ['raindance', 'primordialsea'].includes(weather)) ||
      (ability === 'chlorophyll' && ['sunnyday', 'desolateland'].includes(weather)) ||
      (ability === 'sandrush' && weather === 'sandstorm') ||
      (ability === 'slushrush' && ['hail', 'snow'].includes(weather)) ||
      (ability === 'surgesurfer' && battle.field.terrain === 'electricterrain')) value *= 2;
  return value;
}

function groundContact(battle, pokemon, ability, item) {
  if (battle.field.pseudoWeather.gravity || pokemon.volatiles.ingrain || pokemon.volatiles.smackdown ||
      (item === 'ironball' && !battle.field.pseudoWeather.magicroom)) return true;
  return !pokemon.getTypes().includes('Flying') && ability !== 'levitate' &&
    !(item === 'airballoon' && !battle.field.pseudoWeather.magicroom) && !pokemon.volatiles.magnetrise;
}

function entryCost(battle, pokemon) {
  const conditions = pokemon.side.sideConditions;
  const item = pokemon.getItem().id;
  if ((item === 'heavydutyboots' && !pokemon.ignoringItem()) || pokemon.hasAbility('magicguard')) return 0;
  const rock = conditions.stealthrock
    ? Math.max(1, Math.floor(pokemon.maxhp * (2 ** battle.dex.getEffectiveness('Rock', pokemon)) / 8)) : 0;
  const layers = conditions.spikes?.layers;
  const spikes = layers && groundContact(battle, pokemon, pokemon.ability, item)
    ? Math.max(1, Math.floor(pokemon.maxhp / [0, 8, 6, 4][layers])) : 0;
  return rock + spikes;
}

function threatMoves(battle, target, observed) {
  const {atk, spa} = (target.illusion ?? target).species.baseStats;
  const category = atk * (target.boosts.atk + 8) >= spa * (target.boosts.spa + 8) ? 0 : 1;
  const types = target.illusion ? target.illusion.species.types : target.getTypes();
  const guesses = types.map(type => STAB[type]?.[category]).filter(Boolean);
  const moves = [...new Set([...observed.moves, ...guesses])]
    .map(name => battle.dex.moves.get(name))
    .filter(move => move.category !== 'Status' && move.exists);
  return moves;
}

function statusScore(battle, move, user, target, observed, incoming, attacks) {
  const ability = battle.dex.abilities.get(observed.ability).id;
  const item = battle.dex.items.get(observed.item).id;
  const types = target.illusion ? target.illusion.species.types : target.getTypes();
  const targeted = OPPOSING_TARGETS.has(move.target);
  const prankster = user.hasAbility('prankster');
  if (targeted && ((prankster && types.includes('Dark')) ||
      ['goodasgold', 'magicbounce'].includes(ability) && (ability === 'goodasgold' || move.flags.reflectable) ||
      (move.flags.powder && (types.includes('Grass') || ability === 'overcoat' || item === 'safetygoggles')) ||
      (move.flags.sound && ability === 'soundproof') || target.volatiles.substitute && !move.flags.bypasssub && !move.flags.sound ||
      (prankster && battle.field.terrain === 'psychicterrain' && groundContact(battle, target, ability, item)))) return -Infinity;
  if (RECOVERY.has(move.id)) {
    const missing = user.maxhp - user.hp;
    if (missing < user.maxhp * 0.4 || incoming.mean >= user.maxhp * 0.48 || incoming.mean >= user.hp) return -5;
    if (move.id === 'rest' && (user.status === 'slp' || (battle.field.terrain === 'electricterrain' &&
        groundContact(battle, user, user.ability, user.item)))) return -5;
    return move.id === 'rest' && !user.hasItem(['chestoberry', 'lumberry']) ? 38 : 66;
  }
  if (HAZARDS[move.id]) {
    const condition = target.side.sideConditions[move.id];
    const layers = condition?.layers ?? Number(Boolean(condition));
    return layers < HAZARDS[move.id] && target.side.pokemonLeft >= 3 && ability !== 'magicbounce'
      ? 28 + target.side.pokemonLeft * 4 - layers * 6 : -10;
  }
  if (move.id === 'defog') {
    const ours = Object.keys(user.side.sideConditions).filter(id => HAZARDS[id]).length;
    const theirs = Object.keys(target.side.sideConditions).filter(id => HAZARDS[id]).length;
    return ours > theirs && user.side.pokemonLeft > 2 ? 48 : -5;
  }
  if (move.id === 'haze') {
    const total = pokemon => Object.values(pokemon.boosts).reduce((sum, stage) => sum + stage, 0);
    return total(target) - total(user) >= 2 ? 70 : -5;
  }
  if (move.forceSwitch) {
    const boosts = Object.values(target.boosts).some(stage => stage >= 2);
    return target.side.pokemonLeft > 1 && boosts && incoming.mean < user.hp ? 66 : -5;
  }
  if (move.target === 'self' && (move.boosts || move.id === 'bellydrum')) {
    const stages = move.boosts ?? {atk: 6};
    const usesPhysical = attacks.some(attack => attack.category === 'Physical');
    const usesSpecial = attacks.some(attack => attack.category === 'Special');
    const useful = Object.entries(stages).filter(([stat, amount]) => amount > 0 && user.boosts[stat] < 6 &&
      (stat === 'atk' ? usesPhysical : stat === 'spa' ? usesSpecial : stat === 'spe' || stat === 'def' || stat === 'spd'));
    const cost = move.id === 'bellydrum' ? user.maxhp / 2 : 0;
    if (!useful.length || incoming.mean + cost >= user.hp * 0.65) return -5;
    return (useful.some(([stat]) => stat === 'atk' || stat === 'spa') ? 51 : 30)
      + useful.length * 5 - useful.reduce((sum, [stat]) => sum + Math.max(0, user.boosts[stat]) * 8, 0);
  }
  const status = move.status || (move.id === 'yawn' ? 'slp' : '');
  if (targeted && status) {
    const terrain = battle.field.terrain;
    const grounded = groundContact(battle, target, ability, item);
    const corrosion = user.hasAbility('corrosion');
    const typeBlocksStatus = !battle.dex.getImmunity(status === 'tox' ? 'psn' : status, types) && !(
      (status === 'psn' || status === 'tox') && corrosion
    );
    if (target.status || target.volatiles.yawn || target.side.sideConditions.safeguard || typeBlocksStatus ||
        (move.type === 'Electric' && !battle.dex.getImmunity('Electric', types)) ||
        (grounded && (terrain === 'mistyterrain' || terrain === 'electricterrain' && status === 'slp')) ||
        (status === 'slp' && ['insomnia', 'vitalspirit', 'sweetveil'].includes(ability)) ||
        (status === 'brn' && ['waterveil', 'waterbubble', 'guts'].includes(ability)) ||
        (['psn', 'tox'].includes(status) && ability === 'immunity') ||
        (status === 'par' && ability === 'limber') ||
        ['comatose', 'purifyingsalt'].includes(ability)) return -Infinity;
    const prefersBurn = (target.illusion ?? target).species.baseStats.atk >= (target.illusion ?? target).species.baseStats.spa;
    const urgency = status === 'brn' && prefersBurn ? 58 : status === 'slp' ? 62 : 40;
    return urgency * (move.accuracy === true ? 1 : move.accuracy / 100) - (target.hp < target.maxhp * 0.23 ? 28 : 0);
  }
  return 4;
}

export function chooseTrainerAction(battle, seed) {
  const {p1, p2} = battle;
  const request = p2.activeRequest;
  const user = p2.active[0];
  const target = p1.active[0];
  const rng = new PRNG(seed);
  const reserves = p2.pokemon.filter(pokemon => !pokemon.isActive && pokemon.hp > 0);
  const targetAvailable = target?.hp > 0;
  const observed = targetAvailable ? observedSet(battle, target) : null;
  const targetSpeed = targetAvailable ? speed(battle, target, observed) : 0;
  const threats = targetAvailable ? threatMoves(battle, target, observed) : [];
  const trickRoom = Boolean(battle.field.pseudoWeather.trickroom);
  const incoming = pokemon => threats.map(move => ({
    ...damageEstimate(battle, move, target, pokemon, {attackerKnown: observed}), move,
  })).sort((a, b) => b.mean - a.mean)[0] ?? {mean: 0, koChance: 0};

  function order(pokemon, move, threat) {
    const priority = move.priority - (threat.move?.priority ?? 0);
    if (priority) return Math.sign(priority);
    return Math.sign(speed(battle, pokemon) - targetSpeed) * (trickRoom ? -1 : 1);
  }

  function attackScore(pokemon, move, threat, health) {
    const estimate = damageEstimate(battle, move, pokemon, target, {defenderKnown: observed});
    if (!estimate.mean && !estimate.koChance) return {score: -Infinity, ...estimate};
    const first = order(pokemon, move, threat);
    let score = Math.min(1, estimate.mean / target.hp) * 100;
    score += estimate.koChance * (first > 0 ? 106 : first === 0 ? 88 : 72);
    if (first <= 0 && threat.mean >= health) score *= first === 0 ? 0.72 : 0.45;
    if (move.flags.recharge && estimate.koChance < 0.9) score -= 28;
    if (move.flags.charge && !pokemon.hasItem('powerherb') && !pokemon.volatiles.twoturnmove) score -= 32;
    if (move.recoil && estimate.koChance < 0.9) score -= 8;
    if (move.drain && pokemon.hp < pokemon.maxhp * 0.7) score += 7;
    if (['rapidspin', 'mortalspin'].includes(move.id) &&
        pokemon.side.pokemonLeft > 2 && Object.keys(pokemon.side.sideConditions).some(id => HAZARDS[id])) score += 30;
    return {score, first, ...estimate};
  }

  function switchScore(pokemon, takesHit) {
    const entry = entryCost(battle, pokemon);
    const hp = pokemon.hp - entry;
    if (hp <= 0) return -1000 + pokemon.hp / pokemon.maxhp;
    if (!targetAvailable) return hp / pokemon.maxhp * 100;
    const threat = incoming(pokemon);
    const health = hp - (takesHit ? threat.mean : 0);
    if (health <= 0) return -200 + health / pokemon.maxhp * 100;
    const attacks = pokemon.moveSlots.filter(slot => slot.pp > 0).map(slot => battle.dex.moves.get(slot.id))
      .filter(move => move.category !== 'Status');
    const offense = Math.max(0, ...attacks.map(move => attackScore(pokemon, move, threat, health).score));
    return offense * 0.65 + health / pokemon.maxhp * 36 - Math.min(1.5, threat.mean / health) * 36;
  }

  const rank = (a, b) => b.score - a.score;
  if (request.forceSwitch?.[0]) {
    if (p2.slotConditions[0].revivalblessing) return 'default';
    const replacement = reserves.map(pokemon => ({pokemon, score: switchScore(pokemon, false) + rng.random(3)}))
      .sort(rank)[0];
    return replacement ? 'switch ' + (replacement.pokemon.position + 1) : 'default';
  }
  const active = request.active?.[0];
  if (!targetAvailable || !active) return 'default';
  const threat = incoming(user);
  const moves = active.moves.flatMap((option, index) => option.disabled ? [] :
    [{move: battle.dex.moves.get(option.id), command: 'move ' + (index + 1)}]);
  const attacks = moves.filter(({move}) => move.category !== 'Status').map(({move}) => move);
  const ranked = moves.map(({move, command}) => {
    const assessment = move.category === 'Status'
      ? {score: statusScore(battle, move, user, target, observed, threat, attacks)}
      : attackScore(user, move, threat, user.hp);
    return {command, ...assessment, score: assessment.score + rng.random(3)};
  }).sort(rank);
  const best = ranked[0];
  const urgent = user.volatiles.perishsong?.duration === 1 || user.volatiles.perishsong?.duration === 2 ||
    user.volatiles.yawn;
  const safeKO = best?.first > 0 && best.koChance >= 0.85;
  const pressured = (best?.score ?? -Infinity) < 31 || threat.mean >= user.hp * 0.78;
  if ((urgent || pressured && !safeKO) && reserves.length && !active.trapped && !active.maybeTrapped && !user.trapped &&
      !user.volatiles.twoturnmove && !user.volatiles.mustrecharge) {
    const currentScore = switchScore(user, false);
    const candidate = reserves.map(pokemon => ({pokemon, score: switchScore(pokemon, true)})).sort(rank)[0];
    if (candidate.score > 0 && (urgent || candidate.score > currentScore + 17)) {
      return 'switch ' + (candidate.pokemon.position + 1);
    }
  }
  return best?.command ?? 'default';
}
