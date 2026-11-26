import {Dex} from '@pkmn/sim';
import {canUse, LeagueRun, rewardTargets} from './battle.js';
import {bagItems, dayKey, rewards} from './league.js';
import {corridorArt, creaturePaths, idleFrame, trainerSprite, walkFrames} from './pixel-art.js';
import {randomId} from './run-stats.js';
import forest from './battle-forest.png';
import fullRestoreIcon from './graphics/items/fullrestore.png';
import maxReviveIcon from './graphics/items/maxrevive.png';
import reviveIcon from './graphics/items/revive.png';
import './style.css';

const app = document.querySelector('#app');
const details = document.querySelector('#details');
const day = dayKey();
const gameName = 'BecomeTheVeryBestdle';
const storageKey = 'league-after-dark:v5';
const recordsOrigin = import.meta.env.VITE_RECORDS_ORIGIN ?? '';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const colors = {
  Normal:'#7c7872', Fire:'#a73c30', Water:'#265689', Electric:'#805c0f', Grass:'#3f6e36',
  Ice:'#326779', Fighting:'#a84f2f', Poison:'#744886', Ground:'#805842', Flying:'#585a95',
  Psychic:'#9a416b', Bug:'#566723', Rock:'#826238', Ghost:'#605082', Dragon:'#53459c',
  Dark:'#4f485b', Steel:'#4d6370', Fairy:'#955675', Champion:'#99682e',
};
const statusName = {brn:'BRN', par:'PAR', slp:'SLP', psn:'PSN', tox:'TOX', frz:'FRZ'};
const rounds = ['Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Champion'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[c]);
const color = type => colors[type] ?? colors.Normal;
const tag = type => `<span class="type" style="--type:${color(type)}">${escape(type)}</span>`;
const tags = types => types.map(tag).join('');
const date = new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'short', day:'numeric', year:'numeric'})
  .format(new Date(day + 'T00:00:00Z')).toUpperCase();
const rest = ms => new Promise(resolve => setTimeout(resolve, ms));

let run;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  run = new LeagueRun(day, saved?.day === day ? saved : null);
  run.view();
} catch {
  run = new LeagueRun(day);
}
let menu = 'command';
let partySelected = '';
let selected = '';
let bagSelection = null;
let rewardSelection = null;
let sharedRecords;
let busy=false;
let walking=false;
let entered=false;
let flash='';
let copied=false;
let logOpen = false;
let travelTimer;

function save() {
  if (dayKey() !== day) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({day, ...run.snapshot()}));
  } catch {
    // A browser can disallow local storage for local files.
  }
}

function sprite(member, className, {back = false, animated = false} = {}) {
  const paths = creaturePaths(member.sprite, back, animated && !reducedMotion.matches);
  const [url, mirror, gif] = paths[0];
  return `<span class="sprite-box ${className}"><img alt="" draggable="false"
    src="${url}" class="sprite ${mirror ? 'mirror' : ''} ${animated && !gif ? 'idle' : ''}"
    data-frames="${escape(JSON.stringify(paths.slice(1)))}" data-animated="${animated}"></span>`;
}

document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.frames) return;
  const [next, ...rest] = JSON.parse(img.dataset.frames);
  if (!next) {
    img.parentElement.classList.add('missing-sprite');
    img.remove();
    return;
  }
  const [url, mirror, animated] = next;
  img.classList.toggle('mirror', mirror);
  img.classList.toggle('idle', img.dataset.animated === 'true' && !animated);
  img.dataset.frames = JSON.stringify(rest);
  img.src = url;
}, true);

function hpBar(member) {
  const n = 100 * member.hp / member.maxhp;
  const tone = n > 50 ? 'green' : n > 20 ? 'amber' : 'red';
  return `<span class="hp-track" role="progressbar" aria-label="${escape(member.name)} HP"
    aria-valuemin="0" aria-valuemax="${member.maxhp}" aria-valuenow="${member.hp}">
    <span style="--hp:${n}%" class="${tone}"></span></span>`;
}

function caption(trainer) {
  return trainer.type === 'Champion' ? 'Mixed team' : trainer.type + ' specialist';
}

function itinerary(view) {
  return run.league.map((trainer, index) => {
    const cleared = index < view.wins;
    const current = index === run.round && !cleared;
    return `<li class="${current ? 'current' : ''} ${cleared ? 'cleared' : ''}" style="--type:${color(trainer.type)}"
        ${current ? 'aria-current="step"' : ''}>
      <span class="route-text"><small>${rounds[index]}</small><strong>${escape(trainer.name)}</strong><span>${trainer.type}</span></span>
      <span class="route-state" aria-label="${cleared ? 'Cleared' : current ? 'Current opponent' : 'Upcoming'}">${cleared ? '✓' : current ? '▶' : '·'}</span>
    </li>`;
  }).join('');
}

function memberRow(member, action, selectedId, disabled = action === 'lead' && !member.hp) {
  const status = !member.hp ? 'FNT' : member.status && statusName[member.status];
  return `<button class="member ${!member.hp ? 'down' : ''} ${member.active ? 'active-member' : ''}"
      data-${action}="${escape(member.id)}" ${disabled ? 'disabled' : ''}
      aria-pressed="${member.id === selectedId}"
      aria-label="${action === 'lead' ? 'Lead with ' : 'Select '}${escape(member.name)}">
    ${sprite(member, 'portrait')}
    <span class="member-info"><span class="member-title"><strong>${escape(member.name)}</strong><small>Lv.${member.level}</small></span>
    <span class="member-types">${tags(member.types)}${status ? `<span class="status">${status}</span>` : ''}</span></span>
    <span class="member-health"><small>${member.hp}/${member.maxhp}</small>${hpBar(member)}</span>
  </button>`;
}

function camp(view) {
  const member = view.team.find(pokemon => pokemon.id === selected);
  const trainerFrame = trainerSprite(view.trainer.id);
  const player = `<span class="walker ${walking ? 'walking' : run.round > 0 ? 'arrived' : ''}">
    <img class="walker-idle" src="${idleFrame}" alt="">
    <img class="walker-step walker-step-first" src="${walkFrames[0]}" alt="">
    <img class="walker-step walker-step-second" src="${walkFrames[1]}" alt="">
  </span>`;
  return `<section class="box main-panel" aria-labelledby="main-heading">
    <header class="panel-head"><h2 id="main-heading">${walking ? 'League hallway' : rounds[run.round] + ' · ' + escape(view.trainer.name)}</h2><span class="phase-tag">${caption(view.trainer)}</span></header>
    <div class="hall scene" style="--scene:url('${corridorArt(run.round)}')">
      <img class="hall-trainer" src="${trainerFrame}" alt="">
      ${player}
      ${walking ? '<button class="skip" data-action="skip">Skip walk</button>' : ''}
    </div>
    <div class="textbox camp-text" aria-live="polite"><span class="dialog-arrow" aria-hidden="true">▶</span>
      <span>${escape(flash || (walking ? 'You continued to ' + view.trainer.name + '’s room.' :
        run.round > 0 ? view.trainer.name + ' is next. Check your bag and choose a lead.' :
        'The Elite Four await. Choose the first Pokémon you’ll send out.'))}</span></div>
    <div class="panel-body camp-controls">
      <div class="menu-heading"><h3>Choose your lead</h3><button class="quiet" data-action="bag" ${walking ? 'disabled' : ''}>Open bag</button></div>
      <div class="party-grid">${view.team.map(pokemon => memberRow(pokemon, 'lead', selected)).join('')}</div>
      <div class="camp-actions"><button class="secondary" data-inspect="${escape(selected)}" ${!member ? 'disabled' : ''}>Summary</button>
        <button class="primary" data-action="start" ${!member || walking ? 'disabled' : ''}>Battle ${escape(view.trainer.name)}</button></div>
    </div>
  </section>`;
}

function combatant(member, role) {
  const player = role === 'player';
  return `<div class="combat ${role}" data-combat="${role}:${escape(member.sprite)}">
    <div class="stat-box">
      <div class="stat-content">
        <div class="stat-name"><strong title="${escape(member.name)}">${escape(member.name)}</strong><small>Lv.${member.level}</small></div>
        <div class="stat-meta"><span class="stat-types">${tags(member.types)}</span>
          <span class="status combat-status" ${statusName[member.status] ? '' : 'hidden'}>${statusName[member.status] ?? ''}</span></div>
        <div class="stat-health"><div class="stat-hp">${hpBar(member)}</div>
          <small class="hp-number">${player ? member.hp + '/' + member.maxhp : Math.ceil(100 * member.hp / member.maxhp) + '%'}</small></div>
      </div>
    </div>
    <div class="fighter ${member.hp ? '' : 'fainted'}">${sprite(member, 'fight-art', {back:player, animated:true})}</div>
  </div>`;
}

function battleScene(view) {
  const effects = [view.field.weather, view.field.terrain,
    ...view.field.sides.flatMap((side,index) => side.map(name => (index ? 'Foe' : 'You') + ' · ' + name))].filter(Boolean);
  return `<div class="arena scene ${entered ? 'entered' : ''}" style="--scene:url('${forest}')">
    ${combatant(view.opponent, 'opponent')}
    ${combatant(view.player, 'player')}
    ${effects.length ? '<div class="effects">' + effects.map(effect => `<span>${escape(effect)}</span>`).join('') + '</div>' : ''}
  </div>`;
}

function moveButtons(view) {
  return view.moves.map((move, index) => `<button class="move" data-command="move ${index + 1}" data-move="${index}"
      style="--type:${color(move.type)}" ${move.disabled ? 'disabled' : ''} title="${escape(move.description)}">
    <span><strong>${escape(move.name)}</strong><small>${tag(move.type)} ${escape(move.category)}</small></span>
    <span class="move-data"><b>${move.pp == null ? '—' : move.pp + '/' + move.maxpp}</b><small>PP</small></span>
    <kbd>${index + 1}</kbd>
  </button>`).join('');
}

function rewardMenu(view) {
  const choices = view.rewardOffers.map(id => ({
    id, ...rewards[id], eligible: rewardTargets(id, view.team),
  }));
  const choice = choices.find(({id}) => id === rewardSelection?.kind);
  let body;
  if (!choice) {
    const claimable = choices.some(option => option.item || option.eligible.length);
    body = `<p class="reward-prompt">Move PP refills before the next battle.</p>
      <div class="reward-options">${choices.map(option => `<button class="reward-option"
        data-reward="${option.id}" ${option.item || option.eligible.length ? '' : 'disabled'}><strong>${option.name}</strong>
        <span>${option.description}</span></button>`).join('')}</div>
      ${claimable ? '' : '<div class="submenu-foot"><button class="primary" data-action="advance">Enter hallway</button></div>'}`;
  } else if (choice.item) {
    body = `<p class="reward-prompt">${choice.description}</p>
      <div class="submenu-foot"><button class="primary" data-action="advance">Claim and continue</button></div>`;
  } else {
    const {targets} = rewardSelection;
    const count = Math.min(choice.targets, choice.eligible.length);
    body = `<p class="reward-prompt">Choose ${count === 1 ? 'one Pokémon' : 'two Pokémon'}.</p>
      <div class="party-grid">${view.team.map(member => {
        const selected = targets.includes(member.id);
        const disabled = !choice.eligible.includes(member) || (!selected && targets.length === count);
        return memberRow(member, 'reward-target', selected ? member.id : '', disabled);
      }).join('')}</div>
      <div class="submenu-foot"><p aria-live="polite">${targets.length} / ${count} selected</p>
        <button class="primary" data-action="advance" ${targets.length === count ? '' : 'disabled'}>Claim and continue</button></div>`;
  }
  return `<section class="reward-menu" aria-labelledby="reward-heading">
    <div class="submenu-head"><h3 id="reward-heading">${choice ? choice.name : 'Choose one reward'}</h3>
      ${choice ? '<button class="quiet" data-action="reward-back">Back</button>' : ''}</div>
    ${body}</section>`;
}

function actions(view) {
  if (view.phase !== 'battle') {
    const won = view.phase !== 'defeat';
    const title = view.phase === 'champion' ? 'You’re the champion!' : won ? view.trainer.name + ' was defeated!' : 'Your run ended';
    const description = view.phase === 'advance' ? 'Next up: ' + view.next.name + ' · ' + caption(view.next) :
      `${view.wins} of 5 battles won in ${view.totalTurns} turns.`;
    return `<div class="results ${view.phase === 'advance' ? 'reward-result' : ''}">
      <div class="result-main">${won ? '<span class="result-symbol" aria-hidden="true">★</span>' : ''}<div>
        <h3>${escape(title)}</h3>
        ${view.records ? `<p id="result-percentile" aria-live="polite">${progressPercentile(view.records)}</p>` : ''}
        <p>${escape(description)}</p>
      </div></div>
      ${view.phase === 'advance' ? rewardMenu(view) :
      `<div class="result-buttons"><button class="primary" data-action="copy">${copied ? 'Result copied ✓' : 'Copy result'}</button></div>`}
    </div>`;
  }
  const screen = view.forced ? 'party' : menu;
  const back = view.forced ? '' : '<button class="quiet" data-menu="command">Back</button>';
  const error = view.error ? `<p class="form-error" role="alert">${escape(view.error)}</p>` : '';

  if (screen === 'command') {
    return `<div class="command-screen">
      <div class="command-prompt"><h3>What will ${escape(view.player.name)} do?</h3>${error}</div>
      <div class="command-grid" aria-label="Battle commands">
        <button class="command fight" data-menu="fight">Fight</button>
        <button class="command party" data-menu="party">Party</button>
        <button class="command bag" data-menu="bag" ${!view.canUseBag ? 'disabled' : ''}>Bag</button>
        <button class="command run" disabled title="You can’t run from a trainer battle.">Run</button>
      </div></div>`;
  }
  if (screen === 'fight') {
    return `<div class="submenu-head"><h3>Choose a move</h3>${back}</div>${error}
      <div class="move-grid">${moveButtons(view)}</div>
      <p class="move-hint" id="move-hint">Select a move. Use keys 1–4 to choose quickly.</p>`;
  }
  if (screen === 'party') {
    const member = view.team.find(pokemon => pokemon.id === partySelected);
    const canSwitch = member?.hp && !member.active && (!view.trapped || view.forced);
    return `<div class="submenu-head"><h3>${view.forced ? 'Choose a replacement' : 'Party'}</h3>${back}</div>${error}
      <div class="party-grid">${view.team.map(pokemon => memberRow(pokemon, 'party', partySelected)).join('')}</div>
      <div class="submenu-foot">
        <p>${view.trapped && !view.forced ? 'Your Pokémon is trapped.' : member ? escape(member.name) : 'Select a Pokémon.'}</p>
        <button class="secondary" data-inspect="${escape(member?.id)}" ${!member ? 'disabled' : ''}>Summary</button>
        <button class="primary" data-command="switch ${member?.slot}" ${!canSwitch ? 'disabled' : ''}>Switch</button>
      </div>`;
  }
  const bag = bagContent(view);
  return `<div class="submenu-head"><h3>${escape(bag.title)}</h3><button class="quiet" data-action="bag-back">Back</button></div>${bag.body}`;
}

function battle(view) {
  const event = [...view.log].reverse().find(entry => !entry.turn && entry.message);
  return `<section class="box main-panel" aria-labelledby="main-heading">
    <header class="panel-head"><h2 id="main-heading">${rounds[run.round]} <span>· ${escape(view.trainer.name)}</span></h2>
      <div class="battle-meta"><span class="foe-balls" aria-label="${view.foes.filter(fainted => !fainted).length} opponents remaining">
        ${view.foes.map(fainted => `<i class="ball ${fainted ? 'spent' : ''}"></i>`).join('')}</span><span class="phase-tag">Turn ${view.turn}</span></div></header>
    ${battleScene(view)}
    <div class="textbox battle-text" aria-live="polite"><span class="dialog-arrow" aria-hidden="true">▶</span>
      <span id="battle-message">${escape(event?.message ?? 'The battle begins.')}</span></div>
    <div class="panel-body battle-controls">${actions(view)}</div>
    ${view.records ? runReport(view.records) : ''}
  </section>`;
}

const speciesName = id => Dex.species.get(id).name;
const numberFormat = new Intl.NumberFormat();
const count = value => numberFormat.format(value);

function mostClicked(moves) {
  return moves.length ? moves.map(({move}) => escape(Dex.moves.get(move).name)).join(', ') +
    ' ×' + count(moves[0].clicks) : 'No move clicked';
}

function reportDropdown(title, contents) {
  return `<details class="report-dropdown"><summary>${title}</summary><div class="report-dropdown-body">${contents}</div></details>`;
}

function teamStats(rows, {koTitle, koLeader = ''}) {
  const list = (value, sortedBy) => `<ul class="report-rows">${(sortedBy ?
    [...rows].sort((a, b) => b[sortedBy] - a[sortedBy]) : rows).map(row => `<li>
    <span>${escape(speciesName(row.species))}</span><strong>${value(row)}</strong></li>`).join('')}</ul>`;
  return reportDropdown(koTitle, koLeader + list(row => `${count(row.kos)} KO${row.kos === 1 ? '' : 's'}`, 'kos')) +
    reportDropdown('Damage dealt', list(row => `${count(row.damage)} HP`, 'damage')) +
    reportDropdown('Most-clicked moves', list(row => mostClicked(row.moves)));
}

function enemyRecords(rows) {
  return rows.length ? `<ul class="report-rows">${rows.map(row => `<li>
    <span>${escape(speciesName(row.species))} · ${escape(row.trainer[0].toUpperCase() + row.trainer.slice(1))}</span>
    <strong>${count(row.kos)} KO${row.kos === 1 ? '' : 's'}</strong></li>`).join('')}</ul>` : '<p>No opposing Pokémon recorded a KO.</p>';
}

function progressPercentile(records) {
  const result = sharedRecords?.id === records.id ? sharedRecords : null;
  if (location.protocol === 'file:' || result?.error) return 'Progress percentile unavailable.';
  if (!result?.data) return 'Loading progress percentile…';
  const {dailyProgress: distribution = [], progressRecorded: included = false} = result.data;
  const {defeated} = records;
  const others = distribution.reduce((sum, bucket) => sum + bucket.runs, 0) - Number(included);
  if (others < 1) return 'Progress percentile · Waiting for another finished run.';
  const behind = distribution.filter(bucket => bucket.defeated < defeated).reduce((sum, bucket) => sum + bucket.runs, 0);
  const tied = (distribution.find(bucket => bucket.defeated === defeated)?.runs ?? 0) - Number(included);
  return `Ahead of <strong>${count(Math.floor(behind * 100 / others))}%</strong> of the other
    finished ${others === 1 ? 'run' : 'runs'} on this daily challenge.${tied ? ` ${count(tied)} tied.` : ''}`;
}

function globalReport(records) {
  const result = sharedRecords?.id === records.id ? sharedRecords : null;
  if (location.protocol === 'file:') return '<p>Open the game on a shared server to see global records.</p>';
  if (result?.error) return '<p>Global records are unavailable. Refresh to try again.</p>';
  if (!result?.data) return '<p>Loading global records…</p>';
  const {runs, players, enemies, fastestClear} = result.data;
  const rows = new Map(players.map(row => [row.species, row]));
  const team = records.players.map(({species}) => rows.get(species) ?? {species, kos: 0, damage: 0, moves: []});
  const clear = record => record ? `<strong>${count(record.turns)} turns</strong>${record.clears > 1 ? ` · ${count(record.clears)} runs tied` : ''}`
    : 'No recorded clear yet';
  const koLeader = players[0]?.kos ? `<p>Overall leader <strong>${escape(speciesName(players[0].species))} · ${count(players[0].kos)} KOs</strong></p>` : '';
  return `<p>${count(runs)} completed guest ${runs === 1 ? 'run' : 'runs'} across all days.</p>
    ${teamStats(team, {koTitle: 'Pokémon KO leaderboard', koLeader})}
    ${reportDropdown('Deadliest opponents', enemyRecords(enemies.slice(0, 5)))}
    ${reportDropdown('Fastest clear', `<p>This daily challenge · ${clear(fastestClear?.daily)}</p>
      <p>All time · ${clear(fastestClear?.allTime)}</p>`)}`;
}

function runReport(records) {
  const rows = records.players.map(row => {
    const highest = Math.max(0, ...Object.values(row.moves));
    return {...row, moves: Object.entries(row.moves).filter(([,clicks]) => clicks === highest).map(([move,clicks]) => ({move,clicks}))};
  });
  return `<section class="panel-body run-report" aria-labelledby="run-report-heading">
    <h3 id="run-report-heading">Run report</h3>
    <h4>Global stats</h4>
    <div id="global-records" class="report-group" aria-live="polite">${globalReport(records)}</div>
    <h4>Your run</h4>
    <p>Opposing Pokémon defeated · <strong>${count(records.defeated)} / 30</strong></p>
    ${records.partial ? '<p>This run started before tracking was added. Your report covers the battles tracked after the update.</p>' : ''}
    <div class="report-group">
      ${teamStats(rows, {koTitle: 'Pokémon KOs'})}
      ${reportDropdown('Opponents that scored KOs', enemyRecords(records.enemies))}
    </div>
  </section>`;
}

async function syncGlobalRecords(records) {
  if (location.protocol === 'file:' || sharedRecords?.id === records.id) return;
  const pending = sharedRecords = {id: records.id};
  try {
    const response = await fetch(recordsOrigin + '/api/records?day=' + day, records.partial ? undefined : {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({guest: guestId(), run: {...records, day}}),
    });
    if (!response.ok) throw new Error('Global records are unavailable.');
    pending.data = await response.json();
  } catch {
    pending.error = true;
  }
  if (sharedRecords === pending) {
    const report = document.querySelector('#global-records');
    if (report) report.innerHTML = globalReport(records);
    const percentile = document.querySelector('#result-percentile');
    if (percentile) percentile.innerHTML = progressPercentile(records);
  }
}

function guestId() {
  const key = 'bestdle:guest';
  const guest = localStorage.getItem(key) || randomId();
  localStorage.setItem(key, guest);
  return guest;
}

async function alreadyPlayedToday() {
  if (location.protocol === 'file:') return false;
  try {
    const response = await fetch(recordsOrigin + '/api/guest?day=' + day, {
      headers: {'X-Bestdle-Guest': guestId()}, signal: AbortSignal.timeout(3000),
    });
    return response.ok && (await response.json()).completed === true;
  } catch {
    return false;
  }
}

const itemIcons = {fullrestore: fullRestoreIcon, revive: reviveIcon, maxrevive: maxReviveIcon};

function record(view) {
  if (view.phase === 'camp') return '';
  return `<details class="record" ${logOpen ? 'open' : ''}><summary>Battle log</summary>
    <ol id="battle-log" tabindex="0" aria-label="Recent battle events">${view.log.filter(entry => entry.message).slice(-80)
      .map(entry => `<li class="${entry.turn ? 'turn-record' : ''}">${escape(entry.message)}</li>`).join('')}</ol></details>`;
}

function render(keepSprites = false) {
  const view = run.view();
  const retained = new Map();
  if (keepSprites) {
    for (const side of app.querySelectorAll('[data-combat]')) {
      retained.set(side.dataset.combat, side.querySelector('.fight-art'));
    }
  }
  if (!view.team.some(member => member.id === selected && member.hp)) selected = view.team.find(member => member.hp)?.id;
  app.innerHTML = `<header class="topbar"><div class="frame top-inner">
    <a class="brand" href="" aria-label="${gameName} home"><i class="ball"></i><h1>${gameName}</h1></a>
    <button class="quiet help" data-action="how">How to play</button>
    </div></header>
    <main class="frame">
      <section class="route" aria-labelledby="route-heading"><div class="route-head"><h2 id="route-heading">Today’s league</h2>
        <div class="date"><time datetime="${day}">${date}</time><span id="clock"></span></div></div>
        <ol>${itinerary(view)}</ol></section>
      ${view.phase === 'camp' ? camp(view) : battle(view)}
      ${record(view)}
    </main>
    <footer class="frame footer"><span>Unofficial Pokémon fan game</span><span><a href="https://play.pokemonshowdown.com/credits">Battle art</a> · <a href="https://github.com/smogon/sprites">Sprites</a> · <a href="https://eeveeexpo.com/resources/1544/">Paldea sprites</a> · <a href="https://github.com/Ghasty001/Animated_sprites_by_Ghasty001">Ghasty001</a></span>
      <span>Overworld tiles by <a href="https://eeveeexpo.com/resources/15/#:~:text=Gen%205%20interior%20tileset">Akizakura16, Shiney570, and UltimoSpriter</a></span></footer>`;
  for (const side of app.querySelectorAll('[data-combat]')) {
    const sprite = retained.get(side.dataset.combat);
    if (sprite) side.querySelector('.fight-art').replaceWith(sprite);
  }
  scrollLog();
  clock();
  if (view.records) void syncGlobalRecords(view.records);
}

function scrollLog() {
  const log = document.querySelector('#battle-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function renderMenu(focus) {
  const controls = app.querySelector('.battle-controls');
  if (!controls) return;
  controls.innerHTML = actions(run.view());
  if (focus) (controls.querySelector(focus) ?? controls.querySelector('button:enabled'))?.focus({preventScroll:true});
}

function clock() {
  const label = document.querySelector('#clock');
  if (!label) return;
  const wait = new Date(day + 'T00:00:00Z').getTime() + 86400000 - Date.now();
  if (wait <= 0) {
    label.innerHTML = '<a href="">New league available ↻</a>';
  } else {
    const minutes = Math.ceil(wait / 60000);
    label.textContent = `Resets in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2,'0')}m`;
  }
}

function dialog(title, body) {
  details.innerHTML = `<header class="panel-head"><h2 id="details-title">${escape(title)}</h2>
    <form method="dialog"><button class="secondary close" aria-label="Close">×</button></form></header><div class="dialog-content">${body}</div>`;
  if (!details.open) details.showModal();
}

function inspect(id) {
  const member = run.view().team.find(pokemon => pokemon.id === id);
  if (!member) return;
  dialog(member.name, `<div class="detail-member">${sprite(member,'detail-sprite')}
    <div><p>${tags(member.types)}</p><p>Lv.${member.level} · ${member.hp}/${member.maxhp} HP</p>
    <p>${escape(member.ability)} · ${escape(member.item || 'No held item')}</p></div></div>
    <div class="detail-moves">${member.moves.map(slot => {
      const move = Dex.moves.get(slot.id);
      return `<article><strong>${escape(move.name)}</strong> ${tag(move.type)}
        <small>${escape(move.category)} · ${moveReadout(move)} · ${slot.pp}/${slot.maxpp} PP</small>
        <p>${escape(move.desc || move.shortDesc)}</p></article>`;
    }).join('')}</div>`);
}

function bagContent(view) {
  const item = bagSelection;
  if (!item) {
    const inventory = Object.entries(bagItems).filter(([id]) => view.bag[id] > 0);
    if (!inventory.length) return {title: 'Item bag', body: '<p class="menu-note">Your bag is empty.</p>'};
    return {title: 'Item bag', body: `<div class="item-list">${inventory.map(([id,record]) => `
      <button class="item" data-item="${id}">
        <span class="item-icon"><img src="${itemIcons[id]}" alt="" width="24" height="24"></span>
        <span><strong>${record.name}</strong><small>${record.description}</small></span><b>×${view.bag[id]}</b></button>`).join('')}</div>
      ${view.phase === 'battle' ? '<p class="menu-note">Using an item spends your turn.</p>' : ''}`};
  }
  const anyTarget = view.team.some(member => canUse(item, member));
  const title = bagItems[item].name + ' ×' + view.bag[item];
  return {title, body: `<p class="menu-note">${anyTarget ? 'Choose a Pokémon.' : 'No party member can use this item right now.'}</p>
    <div class="item-targets">${view.team.map(pokemon =>
      `<button class="secondary" data-target="${escape(pokemon.id)}" ${canUse(item,pokemon) ? '' : 'disabled'}>${escape(pokemon.name)}
        <span>${pokemon.hp ? pokemon.hp + '/' + pokemon.maxhp + ' HP' : 'FNT'}</span></button>`).join('')}</div>`};
}

function openBag(item = null) {
  const view = run.view();
  if (!view.canUseBag) return;
  bagSelection = item;
  if (view.phase === 'battle') {
    menu = 'bag';
    renderMenu('.item:enabled, .item-targets button:enabled');
  } else {
    const bag = bagContent(view);
    dialog(bag.title, bag.body + (item ? '<button class="quiet" data-action="bag-back">Back</button>' : ''));
  }
}

function backFromBag() {
  if (bagSelection) openBag();
  else setMenu('command', '[data-menu="bag"]');
}

function chooseBagOption({item, target}) {
  if (item) openBag(item);
  else if (bagSelection && target) {
    const selectedItem = bagSelection;
    if (details.open) details.close();
    resolveAction(() => run.useItem(selectedItem, target), true);
  }
}

function setMenu(next, focus) {
  const previous = menu;
  if (next === 'bag') {
    openBag();
    return;
  }
  menu = next;
  partySelected = '';
  renderMenu(focus ?? (next === 'command' ? `[data-menu="${previous}"]` :
    next === 'fight' ? '[data-move]:enabled' : '[data-party]'));
}

function moveReadout(move) {
  const power = move.power ?? move.basePower;
  return 'Power ' + (power || '—') + ' · Accuracy ' + (move.accuracy === true ? '—' : move.accuracy + '%');
}

function showMove(element) {
  if (!element) return;
  const move = run.view().moves?.[Number(element.dataset.move)];
  const hint = document.querySelector('#move-hint');
  if (move && hint) hint.textContent = moveReadout(move) + ' · ' + (move.description || '');
}

function animateHealth(combat, health) {
  const track = combat.querySelector('.hp-track');
  const fill = track.querySelector('span');
  const number = combat.querySelector('.hp-number');
  const start = Number(track.getAttribute('aria-valuenow'));
  const max = health.maxhp || Number(track.getAttribute('aria-valuemax'));
  const end = health.hp;
  const duration = end < start ? 500 : 280;

  function paint(hp) {
    const percent = hp / max * 100;
    fill.style.setProperty('--hp', percent + '%');
    fill.classList.toggle('red', percent <= 20);
    fill.classList.toggle('amber', percent > 20 && percent <= 50);
    track.setAttribute('aria-valuenow', String(Math.round(hp)));
    number.textContent = combat.classList.contains('player') ? Math.round(hp) + '/' + max : Math.ceil(percent) + '%';
  }
  if (start === end) return;
  return new Promise(resolve => {
    const started = performance.now();
    function tick(now) {
      const fraction = Math.min(1, Math.max(0, (now - started) / duration));
      paint(start + (end - start) * fraction);
      if (fraction < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

function showPlayback(turn) {
  app.dataset.resolving = 'true';
  app.querySelector('.battle-controls').innerHTML = `<div class="turn-playback">
    <div class="turn-playback-head"><h3>Turn ${turn}</h3><span role="status">Resolving</span></div>
    <ol id="turn-feed" aria-label="Turn events"></ol>
  </div>`;
}

async function playEvents(events) {
  const line = document.querySelector('#battle-message');
  const record = document.querySelector('#battle-log');
  const feed = document.querySelector('#turn-feed');
  let previous;
  const activate = message => {
    if (!message) return;
    if (previous) {
      const row = document.createElement('li');
      row.textContent = previous;
      feed.append(row);
      if (feed.children.length > 3) feed.firstElementChild.remove();
    }
    const entry = document.createElement('li');
    entry.textContent = message;
    record.append(entry);
    scrollLog();
    line.textContent = message;
    previous = message;
  };

  for (const event of events) {
    if (event.turn) continue;
    const role = event.side === 'p1' ? 'player' : event.side === 'p2' ? 'opponent' : null;
    let combat = role && document.querySelector('.combat.' + role);
    const fighter = combat?.querySelector('.fighter');
    const artwork = fighter?.querySelector('.fight-art');

    if (combat && event.health) {
      const oldHp = Number(combat.querySelector('.hp-track').getAttribute('aria-valuenow'));
      const hit = event.health.hp < oldHp;
      if (artwork && !reducedMotion.matches && event.health.hp !== oldHp) {
        const recoil = role === 'player' ? -9 : 9;
        artwork.animate(hit ? [
          {transform:'translateX(0)', filter:'brightness(1)'},
          {transform:`translateX(${recoil}px)`, filter:'brightness(1.35)', offset:.2},
          {transform:`translateX(${-recoil / 3}px)`, filter:'brightness(1)', offset:.55},
          {transform:'translateX(0)', filter:'brightness(1)'},
        ] : [{filter:'brightness(1)'}, {filter:'brightness(1.38)'}, {filter:'brightness(1)'}],
        {duration:hit ? 265 : 280, easing:'cubic-bezier(.25,.65,.35,1)'});
      }
      await animateHealth(combat, event.health);
      activate(event.message);
      await rest(210);
      continue;
    }

    activate(event.message);
    if (combat && event.status != null) {
      const badge = combat.querySelector('.combat-status');
      badge.textContent = statusName[event.status] ?? '';
      badge.hidden = !badge.textContent;
    }
    if (combat && event.member?.maxhp) {
      combat.outerHTML = combatant(event.member, role);
      combat = document.querySelector('.combat.' + role);
      if (!reducedMotion.matches) {
        await combat.querySelector('.fighter').animate([{opacity:0, translate:'0 12px'}, {opacity:1, translate:'0 0'}],
          {duration:245, easing:'cubic-bezier(.2,.65,.35,1)'}).finished;
      }
      await rest(290);
      continue;
    }
    if (event.event === 'move') {
      await rest(195);
      if (artwork && !reducedMotion.matches) {
        const distance = role === 'player' ? 25 : -25;
        await artwork.animate([
          {transform:'translate(0,0)'},
          {transform:`translate(${-distance / 4}px,2px) scale(.98,1.02)`, offset:.28, easing:'ease-in'},
          {transform:`translate(${distance}px,${role === 'player' ? -9 : 6}px) scale(1.02,.98)`, offset:.57, easing:'ease-out'},
          {transform:'translate(0,0)'},
        ], {duration:290}).finished;
      } else {
        await rest(175);
      }
      continue;
    }
    if (fighter && event.event === 'faint') {
      if (!reducedMotion.matches) {
        await fighter.animate([{translate:'0 0', opacity:1}, {translate:'0 35px', opacity:0}],
          {duration:275, easing:'ease-in', fill:'forwards'}).finished;
      }
      fighter.classList.add('fainted');
      await rest(350);
      continue;
    }
    if (event.message) {
      const item = event.event === '-enditem' || event.event === '-item' || event.event === 'bag';
      await rest(item ? 400 : 285);
    }
  }
}

async function resolveAction(action, restoreFocus) {
  if (busy || walking) return;
  const before = run.view();
  const result = action();
  if (result) {
    save();
    flash = typeof result === 'string' ? result : '';
    if (before.phase === 'battle') {
      busy = true;
      showPlayback(before.turn);
      try {
        await playEvents(run.view().log.slice(before.log.length));
      } finally {
        busy = false;
        delete app.dataset.resolving;
        menu = 'command';
        partySelected = '';
        render(true);
      }
    } else render();
  } else render();
  if (restoreFocus) (app.querySelector('[data-menu="fight"]') ?? app.querySelector('[data-party]') ??
    app.querySelector('[data-reward]:enabled, [data-action="advance"]:enabled'))?.focus({preventScroll:true});
}

function endWalk() {
  if (!walking) return;
  clearTimeout(travelTimer);
  walking = false;
  render();
  app.querySelector('[data-lead]:enabled')?.focus();
}

async function doAction(action) {
  const view = run.view();
  if (action === 'how') {
    dialog('How to play', `<ol class="rules">
      <li>Start with six Pokémon and an empty bag. The draft and opponents rotate at midnight UTC.</li>
      <li>Pick your lead before each battle. Use Fight to attack, Party to switch, or Bag to use an item. Items spend a turn during battle.</li>
      <li>After each Elite Four win, claim one of three randomly offered rewards. The pool includes +5 levels for one Pokémon, a full-HP revive, full HP for up to two living Pokémon, three Full Restores, or one Max Revive.</li>
      <li>Move PP refills between battles. Levels, HP, fainting, status, and held items carry over. A Max Revive brings a fainted Pokémon back at full HP.</li>
      <li>Beat four Elite Four members and the Champion to finish the run. Your progress saves in this browser.</li>
      <li>Complete one run per browser each UTC day. Your run report and the global records appear when the run ends.</li>
    </ol>`);
  }
  if (action === 'bag') openBag();
  if (action === 'bag-back') backFromBag();
  if (action === 'skip') endWalk();
  if (action === 'start' && !walking) {
    if (run.round === 0) {
      busy = true;
      const completed = await alreadyPlayedToday();
      busy = false;
      if (completed) return dialog('Today’s run is complete', '<p>This browser has already finished today’s run. A new run opens at midnight UTC.</p>');
    }
    if (!run.start(selected)) return;
    flash = '';
    entered = true;
    menu = 'command';
    save();
    render();
    entered = false;
    app.querySelector('[data-menu="fight"]')?.focus({preventScroll:true});
  }
  if (action === 'reward-back') {
    const kind = rewardSelection?.kind;
    rewardSelection = null;
    renderMenu(`[data-reward="${kind}"]`);
  }
  if (action === 'advance' && run.advance(rewardSelection?.kind, rewardSelection?.targets)) {
    rewardSelection = null;
    flash = '';
    selected = '';
    walking = !reducedMotion.matches;
    save();
    render();
    if (walking) travelTimer = setTimeout(endWalk, 1350);
  }
  if (action === 'copy') {
    const text = `${gameName} · ${date}\n${'🟩'.repeat(view.wins)}${'⬜'.repeat(5 - view.wins)} ${view.wins}/5 · ${view.totalTurns} turns`;
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => {
      copied = true;
      render();
    }).catch(() => {
      dialog('Your result', `<textarea readonly rows="3" aria-label="Daily result">${escape(text)}</textarea>`);
      details.querySelector('textarea').select();
    });
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || busy) return;
  const {command, inspect:member, lead, party, menu:next, action, item, target, reward, rewardTarget} = button.dataset;
  if (command) resolveAction(() => run.choose(command), event.detail === 0);
  if (member) inspect(member);
  if (lead && !walking) {
    selected = lead;
    render();
    app.querySelector(`[data-lead="${lead}"]`)?.focus({preventScroll:true});
  }
  if (party) {
    partySelected = party;
    renderMenu(`[data-party="${party}"]`);
  }
  if (next) setMenu(next);
  if (reward) {
    rewardSelection = {kind: reward, targets: []};
    renderMenu(rewards[reward].item ? '[data-action="advance"]' : '[data-reward-target]:enabled');
  }
  if (rewardTarget && rewardSelection) {
    const {targets} = rewardSelection;
    rewardSelection.targets = targets.includes(rewardTarget) ? targets.filter(id => id !== rewardTarget) : [...targets, rewardTarget];
    renderMenu(`[data-reward-target="${rewardTarget}"]`);
  }
  if ((item || target) && !walking) chooseBagOption(button.dataset);
  if (action) doAction(action);
});

details.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.action === 'bag-back') backFromBag();
  else chooseBagOption(button.dataset);
});

app.addEventListener('toggle', event => {
  if (!event.target.matches('.record') || !event.target.isConnected) return;
  logOpen = event.target.open;
  if (logOpen) scrollLog();
}, true);

app.addEventListener('focusin', event => showMove(event.target.closest('[data-move]')));
app.addEventListener('pointerover', event => showMove(event.target.closest('[data-move]')));
document.addEventListener('keydown', event => {
  if (busy || walking || details.open || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === 'Escape' && menu !== 'command' && run.phase === 'battle' && !run.view().forced) {
    event.preventDefault();
    if (menu === 'bag') backFromBag();
    else setMenu('command');
    return;
  }
  if (!/^[1-4]$/.test(event.key)) return;
  const button = app.querySelector(`[data-command="move ${event.key}"]:enabled`);
  if (button) {
    event.preventDefault();
    button.click();
  }
});

save();
render();
setInterval(clock, 15000);
