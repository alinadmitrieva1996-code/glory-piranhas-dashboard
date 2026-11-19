import { cpdCents, toCents } from './money.ts';
import { yesterdayMsk } from './status.ts';
import type { BuyerDay, BuyerSummary, DailyPoint, DashboardModel, DayRow, GeoConfig, GeoSummary, PartialDay, SheetRow, Totals } from './types.ts';

export function normalize(rows: readonly SheetRow[]): DayRow[] {
  return rows.map((r) => ({ buyer: r.buyer, date: r.date, geo: r.geo, ftd: r.ftd, regs: r.regs, spendCents: toCents(r.spend) }));
}

/** Дата ± n дней, YYYY-MM-DD (в UTC, без часовых поясов). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Последний день, где у команды (по всем гео) есть спенд. */
export function lastFilledDay(rows: readonly DayRow[]): string | null {
  let last: string | null = null;
  for (const r of rows) if (r.spendCents > 0 && (last === null || r.date > last)) last = r.date;
  return last;
}

function buyersWithSpend(rows: readonly DayRow[], date: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.date === date && r.spendCents > 0) out.add(r.buyer);
  return out;
}

/**
 * Внесён ли день частично: спенд в нём внесла половина байеров или меньше
 * от работавших в предыдущий день со спендом. null — день пустой или полный.
 */
export function partialDay(rows: readonly DayRow[], day: string): PartialDay | null {
  const entered = buyersWithSpend(rows, day).size;
  if (entered === 0) return null;
  const prev = lastFilledDay(rows.filter((r) => r.date < day));
  if (prev === null) return null;
  const expected = buyersWithSpend(rows, prev).size;
  return expected >= 2 && entered * 2 <= expected ? { date: day, entered, expected } : null;
}

export function totals(rows: readonly DayRow[]): Totals {
  let spendCents = 0;
  let ftd = 0;
  let regs = 0;
  for (const r of rows) {
    spendCents += r.spendCents;
    ftd += r.ftd;
    regs += r.regs;
  }
  return { spendCents, ftd, regs, cpdCents: cpdCents(spendCents, ftd) };
}

/** Спенд сверх бенча × FTD, центы. 0 — в бенче или бенча нет. */
export function overpayCents(t: Totals, benchCents: number | null): number {
  if (benchCents === null) return 0;
  return Math.max(0, t.spendCents - benchCents * t.ftd);
}

/** Сумма строк (для «Итого гео»). */
export function sumLines(lines: readonly Totals[]): Totals {
  let spendCents = 0;
  let ftd = 0;
  let regs = 0;
  for (const l of lines) {
    spendCents += l.spendCents;
    ftd += l.ftd;
    regs += l.regs;
  }
  return { spendCents, ftd, regs, cpdCents: cpdCents(spendCents, ftd) };
}

function groupBy<T>(items: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of items) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

const byBuyerName = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

function geoSummary(geo: GeoConfig, geoRows: readonly DayRow[], day: string, month: string): GeoSummary {
  const inMonth = geoRows.filter((r) => r.date.startsWith(month) && r.date <= day);
  const byDate = groupBy(inMonth, (r) => r.date);
  const daily: DailyPoint[] = [...byDate.entries()]
    .map(([date, list]) => ({ date, ...totals(list) }))
    .filter((d) => d.spendCents > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const buyersByDate: Record<string, BuyerDay[]> = {};
  for (const [date, list] of byDate) {
    buyersByDate[date] = [...groupBy(list, (r) => r.buyer).entries()]
      .map(([buyer, rs]) => ({ buyer, ...totals(rs) }))
      .filter((b) => b.spendCents > 0 || b.ftd > 0)
      .sort((a, b) => b.spendCents - a.spendCents || byBuyerName(a.buyer, b.buyer));
  }

  const monthT = totals(inMonth);
  const dayT = totals(inMonth.filter((r) => r.date === day));

  const windowDays: DailyPoint[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(day, -i);
    const t = totals(geoRows.filter((r) => r.date === d));
    if (t.spendCents > 0) windowDays.push({ date: d, ...t });
  }
  const avg7 =
    windowDays.length >= 3
      ? (() => {
          const w = sumLines(windowDays);
          return {
            spendCents: Math.round(w.spendCents / windowDays.length),
            ftd: Math.round((w.ftd * 10) / windowDays.length) / 10,
            cpdCents: w.cpdCents,
          };
        })()
      : null;

  const last7Dates = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
  const buyers: BuyerSummary[] = [...groupBy(inMonth, (r) => r.buyer).entries()]
    .map(([buyer, list]) => {
      const m = totals(list);
      const mine = geoRows.filter((r) => r.buyer === buyer);
      return {
        buyer,
        day: totals(list.filter((r) => r.date === day)),
        month: m,
        shareBp: monthT.spendCents > 0 ? Math.round((m.spendCents * 10_000) / monthT.spendCents) : 0,
        overpayCents: overpayCents(m, geo.benchCents),
        last7: last7Dates.map((d) => ({ date: d, ...totals(mine.filter((r) => r.date === d)) })),
      };
    })
    .filter((b) => b.month.spendCents > 0 || b.month.ftd > 0)
    .sort((a, b) => b.overpayCents - a.overpayCents || b.month.spendCents - a.month.spendCents || byBuyerName(a.buyer, b.buyer));

  return {
    geo,
    day: dayT,
    month: monthT,
    avg7,
    headroomCents: geo.benchCents === null ? null : geo.benchCents * monthT.ftd - monthT.spendCents,
    daily,
    buyersByDate,
    buyers,
  };
}

/**
 * Сводка для экрана. «Вчера» — всегда вчерашний день по Москве: если данных за него нет,
 * экран показывает прочерки, а не предыдущий день. Месяц — накопительно с 1-го числа
 * месяца вчерашнего дня по вчера включительно. CPD — только внутри гео.
 */
export function buildModel(sheetRows: readonly SheetRow[], geos: readonly GeoConfig[], now: Date): DashboardModel {
  const day = yesterdayMsk(now);
  const month = day.slice(0, 7);
  const rows = normalize(sheetRows).filter((r) => r.date <= day);
  const hasDayData = rows.some((r) => r.date === day && (r.spendCents > 0 || r.ftd > 0));
  return {
    lastDay: day,
    month,
    hasDayData,
    dataThrough: lastFilledDay(rows.filter((r) => r.date.startsWith(month))),
    partial: partialDay(rows, day),
    geos: geos.map((geo) => geoSummary(geo, rows.filter((r) => r.geo === geo.code), day, month)),
  };
}

/** Гео с бенчами, изменёнными пользователем (центы); неизвестные коды игнорируются. */
export function applyBenches(geos: readonly GeoConfig[], overrides: Readonly<Record<string, number>>): GeoConfig[] {
  return geos.map((g) => {
    const v = overrides[g.code];
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? { ...g, benchCents: v } : g;
  });
}
