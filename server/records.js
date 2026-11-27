import {DatabaseSync} from 'node:sqlite';
import {Dex} from '@pkmn/sim';
import {dailyLeague, draftTeam} from '../src/league.js';

export const isId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const count = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

export function validateRun(value) {
  if (!value || !isId(value.id) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || value.partial !== false ||
      (value.outcome !== 'win' && value.outcome !== 'loss') ||
      !count(value.turns, 10000) || value.turns < 1 ||
      !Array.isArray(value.players) || value.players.length !== 6 || !Array.isArray(value.enemies)) return false;
  const date = new Date(value.day);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value.day) return false;
  const opponents = new Set(dailyLeague(value.day).flatMap(trainer =>
    trainer.team.map(set => trainer.id + '/' + Dex.species.get(set.species).id)));
  const total = opponents.size;
  if (!count(value.defeated, total) || (value.outcome === 'win' && value.defeated !== total) ||
      value.enemies.length > total) return false;
  const species = new Set(draftTeam(value.day).map(set => Dex.species.get(set.species).id));
  for (const row of value.players) {
    if (!row || !species.delete(row.species) || !count(row.kos, total) || !count(row.damage, 10000000) ||
        !row.moves || typeof row.moves !== 'object' || Array.isArray(row.moves) || Object.keys(row.moves).length > 100) return false;
    for (const [move, clicks] of Object.entries(row.moves)) {
      if (Dex.moves.get(move).id !== move || !Dex.moves.get(move).exists || !count(clicks, value.turns)) return false;
    }
  }
  if (value.players.reduce((sum, row) => sum + row.kos, 0) > value.defeated) return false;
  return value.enemies.every(row => typeof row?.trainer === 'string' && typeof row.species === 'string' &&
    opponents.delete(row.trainer + '/' + row.species) && count(row.kos, 10 + value.turns)) &&
    value.enemies.reduce((sum, row) => sum + row.kos, 0) <= 10 + value.turns;
}

export function openRecords(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, guest TEXT NOT NULL, day TEXT NOT NULL, UNIQUE (guest, day));
    CREATE TABLE IF NOT EXISTS attempts (guest TEXT NOT NULL, day TEXT NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY (guest, day));
    CREATE TABLE IF NOT EXISTS bug_reports (id INTEGER PRIMARY KEY, submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traffic (day TEXT NOT NULL, visitor TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY (day, visitor));
    CREATE TABLE IF NOT EXISTS daily_reports (run_id TEXT PRIMARY KEY REFERENCES runs(id), day TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS daily_reports_by_day ON daily_reports (day);
    CREATE TABLE IF NOT EXISTS daily_players (day TEXT NOT NULL, species TEXT NOT NULL, kos INTEGER NOT NULL, damage INTEGER NOT NULL, PRIMARY KEY (day, species));
    CREATE TABLE IF NOT EXISTS daily_moves (day TEXT NOT NULL, species TEXT NOT NULL, move TEXT NOT NULL, clicks INTEGER NOT NULL, PRIMARY KEY (day, species, move));
    CREATE TABLE IF NOT EXISTS daily_enemies (day TEXT NOT NULL, trainer TEXT NOT NULL, species TEXT NOT NULL, kos INTEGER NOT NULL, PRIMARY KEY (day, trainer, species));
    CREATE TABLE IF NOT EXISTS clears (run_id TEXT PRIMARY KEY REFERENCES runs(id), day TEXT NOT NULL, turns INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS fastest_clear_by_day ON clears (day, turns);
    CREATE TABLE IF NOT EXISTS progress (run_id TEXT PRIMARY KEY REFERENCES runs(id), day TEXT NOT NULL, defeated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS progress_by_day ON progress (day, defeated);
  `);
  const addRun = db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const knownRun = db.prepare('SELECT 1 FROM runs WHERE id = ? AND guest = ? AND day = ?');
  const addReport = db.prepare('INSERT INTO daily_reports VALUES (?, ?) ON CONFLICT DO NOTHING');
  const addClear = db.prepare('INSERT INTO clears VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const addProgress = db.prepare('INSERT INTO progress VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const addPlayer = db.prepare(`INSERT INTO daily_players VALUES (?, ?, ?, ?) ON CONFLICT (day, species) DO UPDATE
    SET kos = kos + excluded.kos, damage = damage + excluded.damage`);
  const addMove = db.prepare(`INSERT INTO daily_moves VALUES (?, ?, ?, ?) ON CONFLICT (day, species, move) DO UPDATE SET clicks = clicks + excluded.clicks`);
  const addEnemy = db.prepare(`INSERT INTO daily_enemies VALUES (?, ?, ?, ?) ON CONFLICT (day, trainer, species) DO UPDATE SET kos = kos + excluded.kos`);
  const runCounts = db.prepare(`SELECT COUNT(*) AS runs, COUNT(clears.run_id) AS championClears
    FROM daily_reports LEFT JOIN clears USING (run_id) WHERE daily_reports.day = ?`);
  const completed = db.prepare('SELECT 1 FROM runs WHERE guest = ? AND day = ?');
  const register = db.prepare('INSERT INTO attempts VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  const attempt = db.prepare('SELECT run_id FROM attempts WHERE guest = ? AND day = ?');
  const saveBug = db.prepare('INSERT INTO bug_reports (message) VALUES (?)');
  const addVisit = db.prepare(`INSERT INTO traffic (day, visitor, views) VALUES (?, ?, 1)
    ON CONFLICT (day, visitor) DO UPDATE SET views = views + 1`);
  const players = db.prepare('SELECT species, kos, damage FROM daily_players WHERE day = ? ORDER BY kos DESC, damage DESC, species');
  const moves = db.prepare(`SELECT species, move, clicks FROM (
    SELECT species, move, clicks, DENSE_RANK() OVER(PARTITION BY species ORDER BY clicks DESC) AS rank FROM daily_moves WHERE day = ?
  ) WHERE rank = 1 ORDER BY species, move`);
  const enemies = db.prepare('SELECT trainer, species, kos FROM daily_enemies WHERE day = ? AND kos > 0 ORDER BY kos DESC, trainer, species');
  const dailyFastest = db.prepare(`SELECT turns, COUNT(*) AS clears FROM clears JOIN daily_reports USING (run_id)
    WHERE clears.day = ? GROUP BY turns ORDER BY turns LIMIT 3`);
  const dailyProgress = db.prepare(`SELECT defeated, COUNT(*) AS runs FROM progress JOIN daily_reports USING (run_id)
    WHERE progress.day = ? GROUP BY defeated ORDER BY defeated`);
  const recordedProgress = db.prepare('SELECT 1 FROM progress JOIN runs ON runs.id = progress.run_id WHERE runs.id = ? AND guest = ?');
  return {
    add(guest, run) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const accepted = addRun.run(run.id, guest, run.day).changes > 0;
        // An existing result can fill in records that were added after it was submitted.
        if (accepted || knownRun.get(run.id, guest, run.day)) {
          if (run.outcome === 'win' && run.turns !== undefined) addClear.run(run.id, run.day, run.turns);
          if (run.defeated !== undefined) addProgress.run(run.id, run.day, run.defeated);
          if (addReport.run(run.id, run.day).changes) {
            for (const row of run.players) {
              addPlayer.run(run.day, row.species, row.kos, row.damage);
              for (const [move, clicks] of Object.entries(row.moves)) addMove.run(run.day, row.species, move, clicks);
            }
            for (const row of run.enemies) addEnemy.run(run.day, row.trainer, row.species, row.kos);
          }
        }
        db.exec('COMMIT');
        return accepted;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    totals(day) {
      const favorites = new Map();
      for (const row of moves.all(day)) {
        if (!favorites.has(row.species)) favorites.set(row.species, []);
        favorites.get(row.species).push(row);
      }
      const fastest = dailyFastest.all(day);
      return {
        ...runCounts.get(day),
        players: players.all(day).map(row => ({...row, moves: favorites.get(row.species) ?? []})),
        enemies: enemies.all(day),
        fastestClear: fastest[0] ?? null,
        fastestClears: fastest.flatMap(({turns, clears}) => Array(Math.min(clears, 3)).fill(turns)).slice(0, 3),
        dailyProgress: dailyProgress.all(day),
      };
    },
    completed(guest, day) { return Boolean(completed.get(guest, day)); },
    hasRun(id, guest, day) { return Boolean(knownRun.get(id, guest, day)); },
    start(guest, day, id) {
      register.run(guest, day, id);
      return attempt.get(guest, day)?.run_id === id;
    },
    saveBug(message) { saveBug.run(message); },
    visit(day, visitor) { addVisit.run(day, visitor); },
    hasProgress(id, guest) { return Boolean(recordedProgress.get(id, guest)); },
    close() { db.close(); },
  };
}
