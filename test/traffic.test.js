import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {pacificDate, trafficSummary} from '../server/traffic.js';

test('traffic dates roll over at Pacific midnight in winter and summer', () => {
  assert.equal(pacificDate(new Date('2026-11-27T07:59:59Z')), '2026-11-26');
  assert.equal(pacificDate(new Date('2026-11-27T08:00:00Z')), '2026-11-27');
  assert.equal(pacificDate(new Date('2026-07-04T06:59:59Z')), '2026-07-03');
  assert.equal(pacificDate(new Date('2026-07-04T07:00:00Z')), '2026-07-04');
});

test('traffic summary deduplicates browsers across days and includes unidentified page views', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE traffic (
        day TEXT NOT NULL, visitor TEXT NOT NULL, views INTEGER NOT NULL, PRIMARY KEY(day, visitor)
      );
      INSERT INTO traffic VALUES
        ('2026-11-26', 'a', 3),
        ('2026-11-26', '', 2),
        ('2026-11-25', 'a', 1),
        ('2026-11-25', 'b', 2),
        ('2026-11-20', 'c', 2),
        ('2026-11-19', 'd', 3),
        ('2026-10-28', 'a', 1),
        ('2026-10-27', 'old', 10),
        ('2026-11-27', 'future', 5);
    `);
    const report = trafficSummary(db, '2026-11-26');
    assert.deepEqual(report.today, {uniqueBrowsers: 1, pageViews: 5});
    assert.deepEqual(report.yesterday, {uniqueBrowsers: 2, pageViews: 3});
    assert.deepEqual(report.last7, {uniqueBrowsers: 3, pageViews: 10});
    assert.deepEqual(report.last30, {uniqueBrowsers: 4, pageViews: 14});
    assert.equal(report.daily.length, 30);
    assert.deepEqual(report.daily[0], {day: '2026-11-26', uniqueBrowsers: 1, pageViews: 5});
    assert.deepEqual(report.daily[2], {day: '2026-11-24', uniqueBrowsers: 0, pageViews: 0});
    assert.deepEqual(report.daily.at(-1), {day: '2026-10-28', uniqueBrowsers: 1, pageViews: 1});
  } finally {
    db.close();
  }
});
