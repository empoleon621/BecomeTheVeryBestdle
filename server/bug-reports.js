import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';

const path = process.env.RECORDS_DB ? resolve(process.env.RECORDS_DB)
  : resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data', 'records.sqlite');
const db = new DatabaseSync(path, {readOnly: true});
try {
  const rows = db.prepare('SELECT id, submitted_at, message FROM bug_reports ORDER BY id DESC LIMIT 100').all();
  for (const row of rows) process.stdout.write(JSON.stringify(row) + '\n');
} finally {
  db.close();
}
