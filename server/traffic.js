const pacificCalendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function pacificDate(date = new Date()) {
  const {year, month, day} = Object.fromEntries(
    pacificCalendar.formatToParts(date).map(({type, value}) => [type, value]),
  );
  return `${year}-${month}-${day}`;
}

function daysBefore(day, count) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

export function trafficSummary(db, today = pacificDate()) {
  const yesterday = daysBefore(today, 1);
  const sevenDayStart = daysBefore(today, 6);
  const thirtyDayStart = daysBefore(today, 29);
  const rows = db.prepare(`
    WITH periods (label, firstDay, lastDay) AS (
      VALUES ('today', ?, ?), ('yesterday', ?, ?), ('last7', ?, ?), ('last30', ?, ?)
    )
    SELECT label, COUNT(DISTINCT NULLIF(visitor, '')) AS uniqueBrowsers,
      COALESCE(SUM(views), 0) AS pageViews
    FROM periods LEFT JOIN traffic ON day BETWEEN firstDay AND lastDay
    GROUP BY label
    UNION ALL
    SELECT day, COUNT(DISTINCT NULLIF(visitor, '')), SUM(views)
    FROM traffic WHERE day BETWEEN ? AND ?
    GROUP BY day
  `).all(today, today, yesterday, yesterday, sevenDayStart, today, thirtyDayStart, today, thirtyDayStart, today);
  const counts = new Map(rows.map(({label, uniqueBrowsers, pageViews}) => [label, {uniqueBrowsers, pageViews}]));
  const daily = Array.from({length: 30}, (_, offset) => {
    const day = daysBefore(today, offset);
    return {day, ...(counts.get(day) ?? {uniqueBrowsers: 0, pageViews: 0})};
  });
  return {
    today: counts.get('today'),
    yesterday: counts.get('yesterday'),
    last7: counts.get('last7'),
    last30: counts.get('last30'),
    daily,
  };
}
