import {Battle, Dex, PRNG} from '@pkmn/sim';
import {bagItems, dailyLeague, draftTeam, expandedElitePoolsFrom, rewardOffers, rewards, seedFor, speciesInfo, typedEliteFrom} from './league.js';
import {chooseTrainerAction} from './trainer-ai.js';
import {newRunStats, recordMove, reportRun, trackBattle} from './run-stats.js';

const formatid = 'gen9customgame@@@!Team Preview,Terastal Clause';
const battleFormat = day => day >= expandedElitePoolsFrom ? formatid + ',NatDex Mod' : formatid;
const smartTrainerFrom = '2026-11-29';
const toxicImmunityFrom = '2026-11-27';
const healing = new Set(['recover', 'roost', 'strengthsap', 'morningsun', 'slackoff']);
const setup = new Set(['dragondance', 'swordsdance', 'calmmind', 'bulkup', 'quiverdance', 'nastyplot']);
const hazards = {spikes: 3, toxicspikes: 2, stealthrock: 1, stickyweb: 1};
const inflictions = new Set(['toxic', 'willowisp', 'stunspore', 'spore', 'thunderwave', 'yawn']);
const opposingTargets = new Set(['normal', 'adjacentFoe', 'randomNormal', 'any', 'allAdjacent', 'allAdjacentFoes']);
const abilityImmunities = {
  levitate: ['Ground'], flashfire: ['Fire'], eartheater: ['Ground'], sapsipper: ['Grass'],
  waterabsorb: ['Water'], stormdrain: ['Water'], dryskin: ['Water'], voltabsorb: ['Electric'],
  motordrive: ['Electric'], lightningrod: ['Electric'], wellbakedbody: ['Fire'],
};

function damageValue(move, user, target, battle) {
  const targetTypes = target.getTypes();
  const ability = target.ignoringAbility() ? '' : target.ability;
  const naturalImmunity = !(move.id === 'freezedry' && targetTypes.includes('Water'))
    && !Dex.getImmunity(move.type, targetTypes);
  if (naturalImmunity || abilityImmunities[ability]?.includes(move.type)) return 0;
  let effectiveness = Dex.getEffectiveness(move.type, targetTypes);
  if (move.id === 'freezedry' && targetTypes.includes('Water')) effectiveness += 2;
  const stab = user.getTypes().includes(move.type) ? 1.5 : 1;
  const physical = move.category === 'Physical';
  // The AI scores moves outside an active move event.
  const attack = user.getStat(physical ? 'atk' : 'spa', false, true);
  const defense = target.getStat(physical ? 'def' : 'spd', false, true);
  const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
  const power = move.basePower || 55;
  const speed = user.getStat('spe', false, true) - target.getStat('spe', false, true);
  const priority = move.priority > 0 && (speed < 0 || target.hp < target.maxhp / 4) ? 1.2 : 1;
  const weather = battle.field.effectiveWeather();
  const weatherFactor = (move.type === 'Fire' || move.type === 'Water') && ['raindance', 'sunnyday'].includes(weather)
    ? ((move.type === 'Water') === (weather === 'raindance') ? 1.5 : 0.5) : 1;
  const burn = physical && user.status === 'brn' && user.ability !== 'guts' ? 0.5 : 1;
  return power * stab * (2 ** effectiveness) * (attack / defense) * accuracy * priority * weatherFactor * burn;
}

function cpuChoice(battle, seed, day) {
  if (day >= smartTrainerFrom) return chooseTrainerAction(battle, seed);
  const {p1, p2} = battle;
  const request = p2.activeRequest;
  const user = p2.active[0];
  const target = p1.active[0];
  const rng = new PRNG(seed);
  if (request.forceSwitch?.[0]) {
    return p2.pokemon
      .filter(pokemon => !pokemon.isActive && pokemon.hp > 0)
      .map(pokemon => ({
        command: 'switch ' + (pokemon.position + 1),
        score: Math.max(...pokemon.moveSlots.map(slot => {
          const move = Dex.moves.get(slot.id);
          return move.category === 'Status' ? 0 : damageValue(move, pokemon, target, battle);
        })) + rng.random(15),
      }))
      .sort((a, b) => b.score - a.score)[0]?.command ?? 'default';
  }
  const available = request.active?.[0]?.moves ?? [];
  const pranksterImmune = day >= typedEliteFrom && user.hasAbility('prankster') && !battle.dex.getImmunity('prankster', target);
  return available.map((option, index) => {
    if (option.disabled) return {score: -Infinity};
    const move = battle.dex.moves.get(option.id);
    const canPoison = day >= toxicImmunityFrom && move.id === 'toxic'
      ? user.hasAbility('corrosion') || battle.dex.getImmunity('psn', target)
      : undefined;
    let score = 2;
    if (move.category !== 'Status') {
      score = damageValue(move, user, target, battle);
    } else if (healing.has(move.id) && user.hp < user.maxhp * 0.38) {
      score = 110;
    } else if (setup.has(move.id) && user.hp > user.maxhp * 0.65 && !Object.values(user.boosts).some(value => value > 0)) {
      score = 68;
    } else if (hazards[move.id] && p1.pokemonLeft >= 3 &&
        (p1.sideConditions[move.id]?.layers ?? (p1.sideConditions[move.id] ? 1 : 0)) < hazards[move.id]) {
      score = 59;
    } else if (inflictions.has(move.id) && !target.status && !target.volatiles.yawn &&
        (canPoison ?? Dex.getImmunity(move.type, target.getTypes()))) {
      score = 65;
    }
    const rankedScore = score + rng.random(15);
    const blockedByDark = pranksterImmune && move.category === 'Status' && opposingTargets.has(move.target);
    return {command: 'move ' + (index + 1), score: canPoison === false || blockedByDark ? -1 : rankedScore};
  }).sort((a, b) => b.score - a.score)[0]?.command ?? 'default';
}

const conditionText = {brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen'};
const nameFrom = label => label?.split(': ').slice(1).join(': ') || label;
function readHealth(value) {
  const [health, status = ''] = value.split(' ');
  const [hp, maxhp] = health.split('/').map(Number);
  return {hp, maxhp, status};
}

function healthPercent(value) {
  const {hp, maxhp} = readHealth(value);
  return maxhp ? Math.ceil(hp / maxhp * 100) : hp;
}

const hitMessages = new Set(['-crit', '-supereffective', '-resisted']);
const statNames = {atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'Accuracy', evasion: 'Evasion'};
const emptyStages = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0};

function formatLog(lines, trainer) {
  const entries = [];
  const activeStages = {p1: emptyStages, p2: emptyStages};
  let lastMover;
  let lastMove;
  for (let index = 0; index < lines.length; index++) {
    const [, event, who, arg, extra, source] = lines[index].split('|');
    const side = who?.slice(0, 2);
    const current = who?.[2] === 'a' && activeStages[side];
    const name = nameFrom(who);
    const detail = value => value?.replace(/^(?:\[from\] )?(?:move: |ability: |item: )?/, '');
    let message;
    let display;
    let stages;
    const setStages = (target, value) => {
      activeStages[target] = value;
      (stages ??= {})[target] = value;
    };
    switch (event) {
    case 'split':
      index += 1;
      break;
    case 'bag': message = who; break;
    case 'turn':
      lastMove = undefined;
      message = 'Turn ' + who;
      break;
    case 'move':
      lastMover = who;
      lastMove = arg;
      message = name + ' used ' + arg + '!';
      break;
    case 'switch':
    case 'drag':
    case 'replace': {
      const [species, level] = arg.split(', ');
      if (current && event !== 'replace' && !source?.endsWith('Baton Pass')) setStages(side, emptyStages);
      display = {member: {...speciesInfo(species), ...readHealth(extra), boosts: activeStages[side],
        level: level?.startsWith('L') ? Number(level.slice(1)) : 100}};
      if (event !== 'replace') message = (who.startsWith('p1') ? 'You sent out ' : trainer + ' sent out ') + name + '.';
      break;
    }
    case 'faint': message = name + ' fainted.'; break;
    case '-supereffective': message = 'It was super effective!'; break;
    case '-resisted': message = 'It was not very effective.'; break;
    case '-crit': message = 'A critical hit!'; break;
    case '-miss': message = name + ' missed!'; break;
    case '-fail':
      message = who === lastMover && lastMove === 'Belly Drum' && current?.atk === 6
        ? name + '’s Attack won’t go any higher!' : 'The move failed.';
      break;
    case '-immune': message = 'It had no effect on ' + name + '.'; break;
    case '-status':
    case '-curestatus':
      if (who[2] === 'a') display = {status: event === '-status' ? arg : ''};
      message = event === '-status' ? name + ' is ' + (conditionText[arg] ?? arg) + '.' :
        name + ' recovered from its status condition.';
      break;
    case '-damage':
    case '-heal':
    case '-sethp': {
      if (who[2] === 'a') display = {health: readHealth(arg)};
      const why = extra?.startsWith('[from]') ? ' (' + detail(extra) + ')' : '';
      const change = event === '-heal' ? ' recovered to ' : event === '-damage' ? ' dropped to ' : ' is at ';
      message = name + change + healthPercent(arg) + '% HP' + why + '.';
      break;
    }
    case '-weather':
      if (extra !== '[upkeep]') message = who === 'none' ? 'The weather cleared.' : 'Weather changed to ' + (Dex.conditions.get(who).name || who) + '.';
      break;
    case '-fieldstart': message = detail(who) + ' took effect.'; break;
    case '-fieldend': message = detail(who) + ' ended.'; break;
    case '-sidestart':
    case '-sideend': message = detail(arg) + (event === '-sidestart' ? ' appeared on ' : ' cleared from ') + name + '’s side.'; break;
    case '-boost':
    case '-unboost': {
      const increase = event === '-boost';
      const amount = Number(extra);
      const label = name + '’s ' + (statNames[arg] ?? arg);
      if (amount === 0) {
        message = label + (increase ? ' won’t go any higher!' : ' won’t go any lower!');
      } else {
        if (current) setStages(side, {...current, [arg]: current[arg] + amount * (increase ? 1 : -1)});
        message = label + (increase ? ' rose' : ' fell') + (amount > 1 ? ' by ' + amount + ' stages.' : '.');
      }
      break;
    }
    case '-setboost': {
      const stage = Number(extra);
      if (current) setStages(side, {...current, [arg]: stage});
      message = name + '’s ' + (statNames[arg] ?? arg) + (stage === 6 ? ' was maxed out!' : ' changed.');
      break;
    }
    case '-clearallboost':
      setStages('p1', emptyStages);
      setStages('p2', emptyStages);
      message = 'All stat changes were reset.';
      break;
    case '-clearboost':
    case '-clearpositiveboost':
    case '-clearnegativeboost':
    case '-invertboost': {
      if (current) {
        const updated = Object.fromEntries(Object.entries(current).map(([stat, value]) => [stat,
          event === '-clearpositiveboost' ? Math.min(0, value) : event === '-clearnegativeboost' ? Math.max(0, value)
            : event === '-invertboost' ? -value : 0,
        ]));
        setStages(side, updated);
      }
      const action = {'-clearpositiveboost': 'stat boosts were cleared.', '-clearnegativeboost': 'stat drops were cleared.',
        '-invertboost': 'stat changes were reversed.'}[event] ?? 'stat changes were reset.';
      message = name + '’s ' + action;
      break;
    }
    case '-swapboost':
    case '-copyboost':
    case '-transform': {
      const otherSide = arg?.slice(0, 2);
      const other = activeStages[otherSide];
      if (current && other) {
        const keys = extra && !extra.startsWith('[') && event !== '-transform' ? extra.split(', ') : Object.keys(emptyStages);
        const from = value => Object.fromEntries(keys.map(key => [key, value[key]]));
        if (event === '-swapboost') setStages(otherSide, {...other, ...from(current)});
        setStages(side, {...current, ...from(other)});
      }
      message = event === '-transform' ? name + ' transformed into ' + nameFrom(arg) + '.' :
        name + (event === '-swapboost' ? ' swapped stat changes with ' : ' copied stat changes from ') + nameFrom(arg) + '.';
      break;
    }
    case '-start': message = name + ' was affected by ' + detail(arg) + '.'; break;
    case '-end': message = detail(arg) + ' ended for ' + name + '.'; break;
    case '-ability': message = name + ' activated ' + arg + '.'; break;
    case '-item': message = name + ' obtained ' + arg + '.'; break;
    case '-enditem':
      if (extra === '[eat]') message = name + ' ate its ' + arg + '!';
      else if (extra === '[weaken]') message = name + '’s ' + arg + ' weakened the hit!';
      else if (extra?.startsWith('[from]')) message = name + ' lost its ' + arg + ' (' + detail(extra) + ').';
      else message = name + ' used its ' + arg + '.';
      break;
    case '-hitcount': message = 'Hit ' + arg + ' times.'; break;
    case '-activate': message = name + ' activated ' + detail(arg) + '.'; break;
    case 'cant': message = name + ' could not move (' + (conditionText[arg] ?? detail(arg)) + ').'; break;
    case 'win': message = who === 'Challenger' ? 'You won the battle!' : trainer + ' won the battle.'; break;
    case 'tie': message = 'The battle ended in a draw.'; break;
    }
    if (!message && !display && !stages) continue;
    const entry = {message, turn: event === 'turn', event, side, ...display, ...(stages && {stages})};
    let position = entries.length;
    if (event === '-damage' && display) {
      while (position > 0 && hitMessages.has(entries[position - 1].event) && entries[position - 1].side === side) position--;
    }
    entries.splice(position, 0, entry);
  }
  return entries;
}

function memberView(pokemon) {
  return {
    ...speciesInfo(pokemon.species.name),
    types: pokemon.getTypes(), level: pokemon.level, hp: pokemon.hp, maxhp: pokemon.maxhp,
    item: pokemon.getItem().name, ability: pokemon.getAbility().name, status: pokemon.status,
    boosts: {...pokemon.boosts},
    active: pokemon.isActive && pokemon.hp > 0, slot: pokemon.position + 1,
  };
}

const speciesId = set => Dex.species.get(set.species).id;

function partyState(pokemon) {
  return {
    ...memberView(pokemon),
    id: speciesId(pokemon.set),
    sleep: pokemon.status === 'slp' ? pokemon.statusState.time : undefined,
    confused: !!pokemon.volatiles.confusion,
    moves: pokemon.baseMoveSlots.map(({id, move: name, pp, maxpp}) => ({id, name, pp, maxpp})),
  };
}

function campParty(pokemon) {
  return {
    ...partyState(pokemon),
    ...speciesInfo(pokemon.set.species),
    active: false,
    confused: false,
    status: pokemon.hp ? pokemon.status : '',
  };
}

function refillPartyPP(party) {
  for (const member of party) {
    for (const move of member.moves) move.pp = move.maxpp;
  }
  return party;
}

export function canUse(item, member) {
  if (!member) return false;
  switch (item) {
    case 'fullrestore': return member.hp > 0 && (member.hp < member.maxhp || !!member.status || member.confused);
    case 'revive':
    case 'maxrevive': return member.hp === 0;
    default: return false;
  }
}

export function rewardTargets(kind, party) {
  switch (kind) {
    case 'level': return party.filter(member => member.level < 100);
    case 'revive': return party.filter(member => member.hp === 0);
    case 'heal': return party.filter(member => member.hp > 0 && member.hp < member.maxhp);
    default: return [];
  }
}

function applyPartyState(battle, pokemon, state) {
  pokemon.hp = state.hp;
  pokemon.fainted = state.hp === 0;
  if (state.status) {
    pokemon.status = state.status;
    pokemon.statusState = battle.initEffectState({id: state.status, target: pokemon});
    if (state.status === 'slp') {
      pokemon.statusState.time = state.sleep;
      pokemon.statusState.startTime = state.sleep;
    }
    if (state.status === 'tox') pokemon.statusState.stage = 0;
  }
  for (const [index, move] of state.moves.entries()) pokemon.baseMoveSlots[index].pp = move.pp;
}

function useMedicine(item, member) {
  member.hp = item === 'revive' ? Math.max(1, Math.floor(member.maxhp / 2)) : member.maxhp;
  member.status = '';
  member.sleep = undefined;
  return item === 'fullrestore' ? member.name + ' was fully restored!' : member.name + ' was revived!';
}

export class LeagueRun {
  constructor(day, saved) {
    this.day = day;
    this.league = dailyLeague(day);
    this.team = draftTeam(day);
    this.round = saved?.round ?? 0;
    this.roundTurns = saved?.roundTurns ?? [];
    this.bag = Object.fromEntries(Object.keys(bagItems).map(id => [id, saved?.bag?.[id] ?? 0]));
    this.battle = saved?.battle ? Battle.fromJSON(saved.battle) : null;
    this.camp = saved?.camp ? refillPartyPP(structuredClone(saved.camp)) : this.battle ? null : this.initialParty();
    this.stats = newRunStats(saved?.stats, Boolean(this.round || this.battle?.ended || this.battle?.turn > 1));
    if (this.battle) trackBattle(this.battle, this.stats, this.league[this.round].id);
    this.error = '';
  }

  initialParty() {
    const battle = new Battle({formatid: battleFormat(this.day), seed: seedFor('party/' + this.day)});
    battle.setPlayer('p1', {name: 'Challenger', team: structuredClone(this.team)});
    return battle.p1.pokemon.map(campParty);
  }

  start(leadId) {
    if (this.phase !== 'camp' || !this.camp.find(member => member.id === leadId && member.hp > 0)) return false;
    const trainer = this.league[this.round];
    const leadIndex = this.team.findIndex(set => speciesId(set) === leadId);
    const party = this.team.slice();
    party.unshift(...party.splice(leadIndex, 1));
    const format = Dex.formats.get(battleFormat(this.day), true);
    const battle = new Battle({
      format: {...format, onBattleStart() {
        this.p1.pokemonLeft = this.p1.pokemon.filter(pokemon => pokemon.hp > 0).length;
      }},
      seed: seedFor('battle/' + this.day + '/' + this.round),
    });
    const playerSets = party.map(original => {
      const set = structuredClone(original);
      const member = this.camp.find(candidate => candidate.id === speciesId(set));
      set.item = member.item;
      set.level = member.level;
      return set;
    });
    battle.setPlayer('p1', {name: 'Challenger', team: playerSets});
    for (const pokemon of battle.p1.pokemon) {
      applyPartyState(battle, pokemon, this.camp.find(member => member.id === speciesId(pokemon.set)));
    }
    battle.setPlayer('p2', {name: trainer.name, team: structuredClone(trainer.team)});
    trackBattle(battle, this.stats, trainer.id);
    this.battle = battle;
    this.camp = null;
    this.error = '';
    return true;
  }

  get phase() {
    if (!this.battle) return 'camp';
    if (!this.battle.ended) return 'battle';
    if (this.battle.winner !== 'Challenger') return 'defeat';
    return this.round === this.league.length - 1 ? 'champion' : 'advance';
  }

  get wins() {
    return this.round + Number(this.phase === 'advance' || this.phase === 'champion');
  }

  advance(reward, targets = []) {
    if (this.phase !== 'advance') return false;
    const {battle} = this;
    const party = battle.p1.pokemon.map(campParty);
    const offers = rewardOffers(this.day, this.round);
    const option = offers.includes(reward) ? rewards[reward] : null;
    if (option?.item) {
      if (targets.length) return false;
      this.bag[option.item] += option.quantity;
    } else if (option) {
      const eligible = rewardTargets(reward, party);
      const count = Math.min(option.targets, eligible.length);
      if (!count || targets.length !== count || new Set(targets).size !== count ||
          !targets.every(id => eligible.some(member => member.id === id))) return false;
      for (const id of targets) {
        const member = party.find(candidate => candidate.id === id);
        if (reward === 'revive') useMedicine('maxrevive', member);
        else if (reward === 'heal') member.hp = member.maxhp;
        else {
          const {set} = battle.p1.pokemon.find(pokemon => speciesId(pokemon.set) === id);
          const species = battle.dex.species.get(set.species);
          const level = Math.min(100, member.level + 5);
          const maxhp = species.maxHP || battle.statModify(species.baseStats, {...set, level}, 'hp');
          if (member.hp) member.hp += maxhp - member.maxhp;
          member.level = level;
          member.maxhp = maxhp;
        }
      }
    } else if (reward != null || offers.some(kind => rewards[kind].item || rewardTargets(kind, party).length)) {
      return false;
    }
    this.camp = refillPartyPP(this.team.map(set => party.find(member => member.id === speciesId(set))));
    this.roundTurns.push(this.battle.turn);
    this.round++;
    this.battle = null;
    this.error = '';
    return true;
  }

  finishTurn(firstChoice) {
    const {battle} = this;
    let attempts = 0;
    while (!battle.ended && battle.p1.isChoiceDone() && battle.p2.activeRequest &&
        !battle.p2.activeRequest.wait && !battle.p2.isChoiceDone()) {
      const seed = seedFor('cpu/' + this.day + '/' + this.round + '/' + battle.turn + '/' + attempts++);
      const command = firstChoice ?? cpuChoice(battle, seed, this.day);
      firstChoice = null;
      if (!battle.choose('p2', command) && !battle.choose('p2', 'default')) {
        throw new Error('The opponent could not select a legal action.');
      }
    }
  }

  choose(command) {
    if (this.phase !== 'battle' || !/^(?:move [1-4]|switch [1-6])$/.test(command)) return false;
    this.error = '';
    const player = this.battle.p1;
    const pokemon = player.active[0];
    const move = command.startsWith('move ') && player.activeRequest?.active?.[0]?.moves[Number(command.at(-1)) - 1];
    const {battle, day, round} = this;
    const opponent = battle.p2;
    const cpu = day >= smartTrainerFrom && opponent.activeRequest && !opponent.activeRequest.wait &&
      !opponent.isChoiceDone() ? cpuChoice(battle, seedFor('cpu/' + day + '/' + round + '/' + battle.turn + '/0'), day) : undefined;
    if (!battle.choose('p1', command)) {
      this.error = (this.battle.p1.choice.error || 'That action is unavailable.').replace(/^\[(?:Invalid|Unavailable) choice\] /, '');
      return false;
    }
    if (move) recordMove(this.stats, pokemon, move.id);
    this.finishTurn(cpu);
    return true;
  }

  get canUseBag() {
    return this.phase === 'camp' || (this.phase === 'battle' && this.battle.p1.requestState === 'move' &&
      !this.battle.p1.active[0].getLockedMove());
  }

  useItem(item, id) {
    if (!this.canUseBag || !Object.hasOwn(this.bag, item) || this.bag[item] <= 0) return '';
    const pokemon = this.battle?.p1.pokemon.find(candidate => speciesId(candidate.set) === id);
    const member = pokemon ? partyState(pokemon) : this.camp?.find(candidate => candidate.id === id);
    if (!canUse(item, member)) return '';
    this.error = '';
    const message = useMedicine(item, member);
    this.bag[item]--;
    if (!pokemon) return message;

    const {battle} = this;
    const cpu = cpuChoice(battle, seedFor('cpu/' + this.day + '/' + this.round + '/' + battle.turn + '/0'), this.day);
    battle.add('bag', 'You used ' + bagItems[item].name + '!');
    battle.add('bag', message);
    if (item !== 'fullrestore') {
      pokemon.hp = member.hp;
      pokemon.fainted = false;
      pokemon.faintQueued = false;
      pokemon.subFainted = false;
      pokemon.status = '';
      pokemon.statusState = battle.initEffectState({});
      battle.p1.pokemonLeft++;
    } else {
      const previous = pokemon.hp;
      pokemon.sethp(member.hp);
      if (pokemon.hp !== previous) battle.add('-heal', pokemon, pokemon.getHealth, '[from] item: Full Restore');
      if (pokemon.status) pokemon.cureStatus();
      pokemon.removeVolatile('confusion');
    }
    // The simulator has no trainer bag. A pass spends the move slot while the opponent takes its turn.
    battle.p1.clearChoice();
    battle.p1.choice.actions.push({choice: 'pass'});
    if (battle.allChoicesDone()) battle.commitChoices();
    this.finishTurn(cpu);
    return message;
  }

  snapshot() {
    return {
      round: this.round, roundTurns: [...this.roundTurns], bag: {...this.bag},
      camp: this.camp && structuredClone(this.camp), battle: this.battle?.toJSON() ?? null,
      stats: structuredClone(this.stats),
    };
  }

  view() {
    const trainer = this.league[this.round];
    const phase = this.phase;
    const outcome = phase === 'champion' ? 'win' : phase === 'defeat' ? 'loss' : null;
    const totalTurns = this.roundTurns.reduce((sum, turns) => sum + turns, this.battle?.turn ?? 0);
    const summary = {
      trainer, phase, wins: this.wins, bag: {...this.bag}, canUseBag: this.canUseBag,
      rewardOffers: phase === 'advance' ? rewardOffers(this.day, this.round) : [],
      records: outcome ? reportRun(this.stats, this.team, {
        outcome, turns: totalTurns,
        opponentCount: this.league.reduce((sum, opponent) => sum + opponent.team.length, 0),
        defeated: this.league.slice(0, this.round).reduce((sum, opponent) => sum + opponent.team.length, 0) +
          this.battle.p2.pokemon.filter(pokemon => pokemon.fainted).length,
      }) : null,
      next: this.league[this.round + 1], error: this.error,
      totalTurns,
    };
    if (!this.battle) return {...summary, team: this.camp, log: []};
    const {p1, p2, turn, field} = this.battle;
    const request = p1.activeRequest;
    const active = request?.active?.[0];
    return {
      ...summary, turn, forced: !!request?.forceSwitch?.[0], trapped: !!active?.trapped,
      reviving: !!p1.slotConditions[0].revivalblessing,
      moves: (active?.moves ?? []).map(option => {
        const move = Dex.moves.get(option.id);
        return {
          name: option.move, id: option.id, pp: option.pp, maxpp: option.maxpp, disabled: !!option.disabled,
          type: move.type || 'Normal', category: move.category, power: move.basePower, accuracy: move.accuracy,
          description: move.desc || move.shortDesc,
        };
      }),
      team: p1.pokemon.map(partyState), player: memberView(p1.active[0]), opponent: memberView(p2.active[0]),
      field: {
        weather: field.weather ? Dex.conditions.get(field.weather).name : '',
        terrain: field.terrain ? Dex.conditions.get(field.terrain).name : '',
        sides: [p1, p2].map(side => Object.keys(side.sideConditions).map(id => Dex.moves.get(id).name)),
      },
      foes: p2.pokemon.map(pokemon => pokemon.hp === 0),
      log: formatLog(this.battle.log, trainer.name),
    };
  }
}
