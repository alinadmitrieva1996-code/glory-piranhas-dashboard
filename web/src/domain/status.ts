import { WARN_SHARE_PERCENT } from '../config.ts';
import type { Status, StatusLevel, Totals } from './types.ts';

/** Статус CPD относительно бенча гео. Сравнение в целых центах. */
export function cpdStatus(t: Totals, benchCents: number | null): Status {
  if (t.spendCents > 0 && t.cpdCents === null) return { level: 'bad', text: 'Нет FTD' };
  if (t.cpdCents === null) return { level: 'none', text: 'Нет данных' };
  if (benchCents === null) return { level: 'none', text: 'Бенча нет' };
  if (t.cpdCents > benchCents) {
    const over = Math.round(((t.cpdCents - benchCents) * 100) / benchCents);
    return { level: 'bad', text: `Выше бенча на ${over}%` };
  }
  if (t.cpdCents * 100 >= benchCents * WARN_SHARE_PERCENT) return { level: 'warn', text: 'У границы' };
  return { level: 'ok', text: 'В бенче' };
}

const RANK: Record<StatusLevel, number> = { bad: 0, warn: 1, none: 2, ok: 3 };

export function worst(a: StatusLevel, b: StatusLevel): StatusLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Вчерашняя дата по Москве (UTC+3), YYYY-MM-DD. */
export function yesterdayMsk(now: Date): string {
  const t = new Date(now.getTime() + 3 * 3600_000 - 24 * 3600_000);
  return t.toISOString().slice(0, 10);
}

/**
 * Насколько свежий отчётный день. «Вчера» — только если это действительно вчера по Москве;
 * иначе экран пишет «Последний день» и предупреждает, что за вчера данных нет.
 */
export function freshness(reportDay: string | null, now: Date): { yesterday: string; isYesterday: boolean; yesterdayMissing: boolean } {
  const yesterday = yesterdayMsk(now);
  return {
    yesterday,
    isYesterday: reportDay === yesterday,
    yesterdayMissing: reportDay === null || reportDay < yesterday,
  };
}
