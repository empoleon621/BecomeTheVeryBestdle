import {DatabaseSync} from 'node:sqlite';
import {Dex} from '@pkmn/sim';
import {dailyLeague, draftTeam} from '../src/league.js';

export const isId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const count = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

export function validateRun(value) {
  if (!value || !isId(value.id) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || value.partial ||
      !Array.isArray(value.players) || value.players.length !== 6 || !Array.isArray(value.enemies) || value.enemies.length > 30) return false;
  const date = new Date(value.day);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value.day) return false;
  const species = new Set(draftTeam(value.day).map(set => Dex.species.get(set.species).id));
  for (const row of value.players) {
    if (!row || !species.delete(row.species) || !count(row.kos, 30) || !count(row.damage, 10000000) ||
        !row.moves || typeof row.moves !== 'object' || Array.isArray(row.moves) || Object.keys(row.moves).length > 100) return false;
    for (const [move, clicks] of Object.entries(row.moves)) {
      if (Dex.moves.get(move).id !== move || !Dex.moves.get(move).exists || !count(clicks, 10000)) return false;
    }
  }
  if (value.players.reduce((sum, row) => sum + row.kos, 0) > 30) return false;
  const opponents = new Set(dailyLeague(value.day).flatMap(trainer =>
    trainer.team.map(set => trainer.id + '/' + Dex.species.get(set.species).id)));
  return value.enemies.every(row => row && opponents.delete(row.trainer + '/' + row.species) && count(row.kos, 30));
}

export function openRecords(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, guest TEXT NOT NULL, day TEXT NOT NULL, UNIQUE (guest, day));
    CREATE TABLE IF NOT EXISTS players (species TEXT PRIMARY KEY, kos INTEGER NOT NULL, damage INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS moves (species TEXT NOT NULL, move TEXT NOT NULL, clicks INTEGER NOT NULL, PRIMARY KEY (species, move));
    CREATE TABLE IF NOT EXISTS enemies (trainer TEXT NOT NULL, species TEXT NOT NULL, kos INTEGER NOT NULL, PRIMARY KEY (trainer, species));
  `);
  const addRun = db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const addPlayer = db.prepare(`INSERT INTO players VALUES (?, ?, ?) ON CONFLICT (species) DO UPDATE
    SET kos = kos + excluded.kos, damage = damage + excluded.damage`);
  const addMove = db.prepare(`INSERT INTO moves VALUES (?, ?, ?) ON CONFLICT (species, move) DO UPDATE SET clicks = clicks + excluded.clicks`);
  const addEnemy = db.prepare(`INSERT INTO enemies VALUES (?, ?, ?) ON CONFLICT (trainer, species) DO UPDATE SET kos = kos + excluded.kos`);
  const runCount = db.prepare('SELECT COUNT(*) AS total FROM runs');
  const completed = db.prepare('SELECT 1 FROM runs WHERE guest = ? AND day = ?');
  const players = db.prepare('SELECT species, kos, damage FROM players ORDER BY kos DESC, damage DESC, species');
  const moves = db.prepare(`SELECT species, move, clicks FROM (
    SELECT species, move, clicks, DENSE_RANK() OVER(PARTITION BY species ORDER BY clicks DESC) AS rank FROM moves
  ) WHERE rank = 1 ORDER BY species, move`);
  const enemies = db.prepare('SELECT trainer, species, kos FROM enemies WHERE kos > 0 ORDER BY kos DESC, trainer, species');
  return {
    add(guest, run) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const accepted = addRun.run(run.id, guest, run.day).changes > 0;
        if (accepted) {
          for (const row of run.players) {
            addPlayer.run(row.species, row.kos, row.damage);
            for (const [move, clicks] of Object.entries(row.moves)) addMove.run(row.species, move, clicks);
          }
          for (const row of run.enemies) addEnemy.run(row.trainer, row.species, row.kos);
        }
        db.exec('COMMIT');
        return accepted;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    totals() {
      const favorites = new Map();
      for (const row of moves.all()) {
        if (!favorites.has(row.species)) favorites.set(row.species, []);
        favorites.get(row.species).push(row);
      }
      return {runs: runCount.get().total, players: players.all().map(row => ({...row, moves: favorites.get(row.species) ?? []})), enemies: enemies.all()};
    },
    completed(guest, day) { return Boolean(completed.get(guest, day)); },
    close() { db.close(); },
  };
}
