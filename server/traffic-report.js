import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pacificDate, trafficSummary} from './traffic.js';

const path = process.env.RECORDS_DB ? resolve(process.env.RECORDS_DB)
  : resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data', 'records.sqlite');
const db = new DatabaseSync(path, {readOnly: true});
try {
  const today = pacificDate();
  const report = trafficSummary(db, today);
  const counts = ({uniqueBrowsers, pageViews}) => ({
    'Unique browsers': uniqueBrowsers,
    'Page views': pageViews,
  });
  console.log(`Site traffic through ${today} · Pacific calendar dates`);
  console.table({
    Today: counts(report.today),
    Yesterday: counts(report.yesterday),
    'Last 7 days': counts(report.last7),
    'Last 30 days': counts(report.last30),
  });
  console.table(report.daily.map(({day, ...row}) => ({Date: day, ...counts(row)})));
} finally {
  db.close();
}
