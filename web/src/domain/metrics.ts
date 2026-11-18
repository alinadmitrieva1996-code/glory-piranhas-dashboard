import { cpdCents, toCents } from './money.ts';
import type { BuyerLine, DailyPoint, DashboardModel, DayRow, GeoConfig, GeoSummary, SheetRow, Totals } from './types.ts';

export function normalize(rows: readonly SheetRow[]): DayRow[] {
  return rows.map((r) => ({ buyer: r.buyer, date: r.date, geo: r.geo, ftd: r.ftd, spendCents: toCents(r.spend) }));
}

/** Последний день, где у команды (по всем гео) есть спенд. */
export function lastFilledDay(rows: readonly DayRow[]): string | null {
  let last: string | null = null;
  for (const r of rows) if (r.spendCents > 0 && (last === null || r.date > last)) last = r.date;
  return last;
}

function totals(rows: readonly DayRow[]): Totals {
  let spendCents = 0;
  let ftd = 0;
  for (const r of rows) {
    spendCents += r.spendCents;
    ftd += r.ftd;
  }
  return { spendCents, ftd, cpdCents: cpdCents(spendCents, ftd) };
}

function byBuyer(rows: readonly DayRow[]): BuyerLine[] {
  const groups = new Map<string, DayRow[]>();
  for (const r of rows) {
    const list = groups.get(r.buyer);
    if (list) list.push(r);
    else groups.set(r.buyer, [r]);
  }
  return [...groups.entries()]
    .map(([buyer, list]) => ({ buyer, ...totals(list) }))
    .filter((b) => b.spendCents > 0 || b.ftd > 0)
    .sort((a, b) => b.spendCents - a.spendCents || a.buyer.localeCompare(b.buyer, 'en', { numeric: true }));
}

function daily(rows: readonly DayRow[]): DailyPoint[] {
  const days = new Map<string, DayRow[]>();
  for (const r of rows) {
    const list = days.get(r.date);
    if (list) list.push(r);
    else days.set(r.date, [r]);
  }
  return [...days.entries()]
    .map(([date, list]) => ({ date, ...totals(list) }))
    .filter((d) => d.spendCents > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Сводка для экрана: «вчера» = последний заполненный день команды,
 * «месяц» = с 1-го числа месяца этого дня по этот день включительно.
 * CPD считается только внутри гео — общего CPD команды нет намеренно.
 */
export function buildModel(sheetRows: readonly SheetRow[], geos: readonly GeoConfig[]): DashboardModel {
  const rows = normalize(sheetRows);
  const lastDay = lastFilledDay(rows);
  if (lastDay === null) {
    const empty: Totals = { spendCents: 0, ftd: 0, cpdCents: null };
    return {
      lastDay: null,
      month: null,
      geos: geos.map((geo) => ({ geo, day: empty, month: empty, daily: [], buyersDay: [], buyersMonth: [] })),
    };
  }
  const month = lastDay.slice(0, 7);
  const inMonth = rows.filter((r) => r.date.startsWith(month) && r.date <= lastDay);
  const summaries: GeoSummary[] = geos.map((geo) => {
    const g = inMonth.filter((r) => r.geo === geo.code);
    const d = g.filter((r) => r.date === lastDay);
    return {
      geo,
      day: totals(d),
      month: totals(g),
      daily: daily(g),
      buyersDay: byBuyer(d),
      buyersMonth: byBuyer(g),
    };
  });
  return { lastDay, month, geos: summaries };
}

/** Сумма строк таблицы байеров (для строки «Итого гео»). */
export function sumLines(lines: readonly Totals[]): Totals {
  let spendCents = 0;
  let ftd = 0;
  for (const l of lines) {
    spendCents += l.spendCents;
    ftd += l.ftd;
  }
  return { spendCents, ftd, cpdCents: cpdCents(spendCents, ftd) };
}
