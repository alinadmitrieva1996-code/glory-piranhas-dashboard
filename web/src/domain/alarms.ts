import { ALARM_THRESHOLDS as T } from '../config.ts';
import { dayShort, money0, money2 } from './format.ts';
import { addDays, lastFilledDay, normalize, reportDay } from './metrics.ts';
import { cpdCents } from './money.ts';
import { yesterdayMsk } from './status.ts';
import type { DayRow, GeoConfig, SheetRow, Totals } from './types.ts';

export type AlarmSeverity = 'red' | 'yellow' | 'data';

export interface AlarmDef {
  id: string;
  severity: AlarmSeverity;
  title: string;
  /** Условие простыми словами, с текущими порогами. */
  condition: string;
}

export interface AlarmHit {
  geo: string | null;
  buyer?: string;
  text: string;
}

export interface AlarmResult extends AlarmDef {
  hits: AlarmHit[];
}

const pct = (p: number): string => `${p}%`;

/** Все алармы в порядке показа. id стабильны: по ним хранится вкл/выкл. */
export const ALARM_DEFS: readonly AlarmDef[] = [
  {
    id: 'lead_not_stopped',
    severity: 'red',
    title: 'Не остановили дорогой залив',
    condition: `Байер за день потратил больше ${money0(T.leadStopSpendCents)}, а CPD выше бенча больше чем на ${pct(T.leadStopTolerancePercent)} (или FTD нет). Вопрос к лиду: почему не остановил.`,
  },
  {
    id: 'geo_day_over_bench',
    severity: 'red',
    title: 'CPD гео за вчера выше бенча',
    condition: 'CPD гео за последний внесённый день выше бенча или спенд без FTD.',
  },
  {
    id: 'geo_month_over_bench',
    severity: 'red',
    title: 'CPD гео за месяц перешёл бенч',
    condition: 'Средний CPD гео с 1-го числа выше бенча.',
  },
  {
    id: 'buyer_streak_over_bench',
    severity: 'red',
    title: `Байер выше бенча ${T.streakDays} дня подряд`,
    condition: `У байера CPD выше бенча (или нет FTD) каждый из последних ${T.streakDays} дней.`,
  },
  {
    id: 'buyer_spend_no_ftd',
    severity: 'red',
    title: 'Спенд без FTD',
    condition: `Байер потратил за день от ${money0(T.noFtdSpendCents)} и не получил ни одного FTD.`,
  },
  {
    id: 'geo_month_near_bench',
    severity: 'yellow',
    title: 'CPD месяца у границы',
    condition: `Средний CPD гео с 1-го числа — от ${pct(95)} до ${pct(100)} бенча.`,
  },
  {
    id: 'geo_cpd_jump',
    severity: 'yellow',
    title: 'Скачок CPD',
    condition: `CPD гео за вчера выше среднего за ${T.avgWindowDays} дней больше чем на ${pct(T.cpdJumpPercent)}.`,
  },
  {
    id: 'geo_spend_drop',
    severity: 'yellow',
    title: 'Спенд гео упал',
    condition: `Спенд гео за вчера меньше ${pct(T.spendDropPercent)} от среднего за ${T.avgWindowDays} дней: остановили сетап, проблемы с оплатой или аккаунтами.`,
  },
  {
    id: 'geo_no_bench_spend',
    severity: 'yellow',
    title: 'Гео без бенча тратит',
    condition: `У гео нет бенча, а спенд за день от ${money0(T.noBenchSpendCents)}. Нужно задать бенч или подтвердить тест.`,
  },
  {
    id: 'data_missing',
    severity: 'data',
    title: 'Вчера не внесено',
    condition: `После ${T.dataDeadlineHourMsk}:00 по Москве вчерашнего дня нет в таблице или его внесла половина байеров и меньше.`,
  },
];

export const DEFAULT_ENABLED: Readonly<Record<string, boolean>> = Object.fromEntries(ALARM_DEFS.map((d) => [d.id, true]));

export { addDays };

class Ledger {
  private readonly geoDay = new Map<string, { s: number; f: number }>();
  private readonly buyerDay = new Map<string, { s: number; f: number }>();
  readonly buyersByGeoDay = new Map<string, Set<string>>();

  constructor(rows: readonly DayRow[]) {
    for (const r of rows) {
      add(this.geoDay, `${r.geo}|${r.date}`, r);
      add(this.buyerDay, `${r.geo}|${r.buyer}|${r.date}`, r);
      const k = `${r.geo}|${r.date}`;
      const set = this.buyersByGeoDay.get(k) ?? new Set<string>();
      set.add(r.buyer);
      this.buyersByGeoDay.set(k, set);
    }
  }

  geo(geo: string, date: string): Totals {
    return totals(this.geoDay.get(`${geo}|${date}`));
  }

  buyer(geo: string, buyer: string, date: string): Totals {
    return totals(this.buyerDay.get(`${geo}|${buyer}|${date}`));
  }
}

function add(map: Map<string, { s: number; f: number }>, key: string, r: DayRow): void {
  const a = map.get(key) ?? { s: 0, f: 0 };
  a.s += r.spendCents;
  a.f += r.ftd;
  map.set(key, a);
}

function totals(a: { s: number; f: number } | undefined): Totals {
  const s = a?.s ?? 0;
  const f = a?.f ?? 0;
  return { spendCents: s, ftd: f, regs: 0, cpdCents: cpdCents(s, f) };
}

const isOver = (t: Totals, bench: number | null): boolean =>
  t.spendCents > 0 && (t.cpdCents === null || (bench !== null && t.cpdCents > bench));

const cpdText = (t: Totals): string => (t.cpdCents === null ? 'нет FTD' : `CPD ${money2(t.cpdCents)}`);

function overText(t: Totals, bench: number | null): string {
  if (t.cpdCents === null || bench === null) return cpdText(t);
  const over = Math.round(((t.cpdCents - bench) * 100) / bench);
  return `${cpdText(t)} (+${over}% к бенчу ${money0(bench)})`;
}

function mskHour(now: Date): number {
  return (now.getUTCHours() + 3) % 24;
}

/**
 * Проверяет все алармы по последнему внесённому дню.
 * Возвращает каждый аларм со списком срабатываний (пустой — не сработал).
 */
export function evaluateAlarms(sheetRows: readonly SheetRow[], geos: readonly GeoConfig[], now: Date): { lastDay: string | null; results: AlarmResult[] } {
  const rows = normalize(sheetRows);
  const { day: lastDay, partial } = reportDay(rows);
  const lastAny = lastFilledDay(rows);
  const hits = new Map<string, AlarmHit[]>(ALARM_DEFS.map((d) => [d.id, []]));
  const push = (id: string, hit: AlarmHit): void => {
    hits.get(id)?.push(hit);
  };

  const yesterday = yesterdayMsk(now);
  if (mskHour(now) >= T.dataDeadlineHourMsk && (lastAny === null || lastAny < yesterday)) {
    push('data_missing', {
      geo: null,
      text: lastAny === null ? `Нет данных за ${dayShort(yesterday)}: таблица пустая.` : `Нет данных за ${dayShort(yesterday)}. Последний внесённый день — ${dayShort(lastAny)}.`,
    });
  } else if (mskHour(now) >= T.dataDeadlineHourMsk && partial && partial.date === yesterday) {
    push('data_missing', { geo: null, text: `${dayShort(partial.date)} внесли ${partial.entered} из ${partial.expected} байеров.` });
  }

  if (lastDay !== null) {
    const ledger = new Ledger(rows);
    const month = lastDay.slice(0, 7);
    const windowDates = Array.from({ length: T.avgWindowDays }, (_, i) => addDays(lastDay, -(i + 1)));

    for (const g of geos) {
      const bench = g.benchCents;
      const day = ledger.geo(g.code, lastDay);

      let ms = 0;
      let mf = 0;
      for (const r of rows) {
        if (r.geo === g.code && r.date.startsWith(month) && r.date <= lastDay) {
          ms += r.spendCents;
          mf += r.ftd;
        }
      }
      const monthTotals: Totals = { spendCents: ms, ftd: mf, regs: 0, cpdCents: cpdCents(ms, mf) };

      if (bench !== null && isOver(day, bench)) {
        push('geo_day_over_bench', { geo: g.code, text: `${g.name}, ${dayShort(lastDay)}: ${overText(day, bench)}, спенд ${money0(day.spendCents)}.` });
      }
      if (bench !== null && monthTotals.cpdCents !== null) {
        if (monthTotals.cpdCents > bench) {
          push('geo_month_over_bench', { geo: g.code, text: `${g.name}: ${overText(monthTotals, bench)}, спенд ${money0(ms)}.` });
        } else if (monthTotals.cpdCents * 100 >= bench * 95) {
          push('geo_month_near_bench', { geo: g.code, text: `${g.name}: CPD ${money2(monthTotals.cpdCents)} при бенче ${money0(bench)}.` });
        }
      }
      if (bench === null && day.spendCents >= T.noBenchSpendCents) {
        push('geo_no_bench_spend', { geo: g.code, text: `${g.name}, ${dayShort(lastDay)}: спенд ${money0(day.spendCents)}, ${cpdText(day)}.` });
      }

      const windowDays = windowDates.map((d) => ledger.geo(g.code, d)).filter((t) => t.spendCents > 0);
      if (windowDays.length >= T.avgMinDays) {
        const ws = windowDays.reduce((a, t) => a + t.spendCents, 0);
        const wf = windowDays.reduce((a, t) => a + t.ftd, 0);
        const avgSpend = Math.round(ws / windowDays.length);
        const avgCpd = cpdCents(ws, wf);
        if (day.spendCents * 100 < avgSpend * T.spendDropPercent) {
          push('geo_spend_drop', { geo: g.code, text: `${g.name}, ${dayShort(lastDay)}: спенд ${money0(day.spendCents)} при среднем ${money0(avgSpend)} в день.` });
        }
        if (avgCpd !== null && day.cpdCents !== null && day.cpdCents * 100 > avgCpd * (100 + T.cpdJumpPercent)) {
          const jump = Math.round(((day.cpdCents - avgCpd) * 100) / avgCpd);
          push('geo_cpd_jump', { geo: g.code, text: `${g.name}, ${dayShort(lastDay)}: CPD ${money2(day.cpdCents)} против ${money2(avgCpd)} в среднем (+${jump}%).` });
        }
      }

      const buyers = [...(ledger.buyersByGeoDay.get(`${g.code}|${lastDay}`) ?? [])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      for (const buyer of buyers) {
        const t = ledger.buyer(g.code, buyer, lastDay);
        const where = `${buyer} · ${g.code}, ${dayShort(lastDay)}`;

        const leadLimit = bench === null ? null : Math.round((bench * (100 + T.leadStopTolerancePercent)) / 100);
        const leadOver = t.cpdCents === null || (leadLimit !== null && t.cpdCents > leadLimit);
        if (t.spendCents > T.leadStopSpendCents && leadOver) {
          push('lead_not_stopped', { geo: g.code, buyer, text: `${where}: спенд ${money0(t.spendCents)}, ${overText(t, bench)}. Вопрос к лиду.` });
        }
        if (t.ftd === 0 && t.spendCents >= T.noFtdSpendCents) {
          push('buyer_spend_no_ftd', { geo: g.code, buyer, text: `${where}: спенд ${money0(t.spendCents)}, FTD 0.` });
        }
        if (bench !== null) {
          const streak = Array.from({ length: T.streakDays }, (_, i) => addDays(lastDay, -i)).reverse();
          const series = streak.map((d) => ({ d, t: ledger.buyer(g.code, buyer, d) }));
          if (series.every((x) => isOver(x.t, bench))) {
            const list = series.map((x) => `${dayShort(x.d)} ${x.t.cpdCents === null ? 'нет FTD' : money2(x.t.cpdCents)}`).join(', ');
            push('buyer_streak_over_bench', { geo: g.code, buyer, text: `${buyer} · ${g.code}: ${list} при бенче ${money0(bench)}.` });
          }
        }
      }
    }
  }

  return { lastDay, results: ALARM_DEFS.map((d) => ({ ...d, hits: hits.get(d.id) ?? [] })) };
}

/** Оставляет только известные id и булевы значения; неизвестное = включено. */
export function resolveEnabled(stored: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = { ...DEFAULT_ENABLED };
  if (typeof stored === 'object' && stored !== null) {
    for (const d of ALARM_DEFS) {
      const v = (stored as Record<string, unknown>)[d.id];
      if (typeof v === 'boolean') out[d.id] = v;
    }
  }
  return out;
}
