import type { GeoConfig } from './domain/types.ts';

/**
 * Гео команды «Пираньи» и бенчмарки CPD.
 * Меняется здесь и только здесь; порядок = порядок в боковом меню.
 */
export const GEOS: readonly GeoConfig[] = [
  { code: 'AR', name: 'Аргентина', benchCents: 2000 },
  { code: 'ET', name: 'Эфиопия', benchCents: 1800 },
  { code: 'MY', name: 'Малайзия', benchCents: null },
];

/** «У границы» — CPD от этой доли бенча и до бенча включительно. */
export const WARN_SHARE_PERCENT = 95;

/** Пороги алармов. Все суммы — в центах. */
export const ALARM_THRESHOLDS = {
  /** «Не остановили дорогой залив»: спенд байера за день больше этого… */
  leadStopSpendCents: 30_000,
  /** …и CPD выше бенча больше чем на этот процент (или FTD нет). */
  leadStopTolerancePercent: 5,
  /** «Спенд без FTD»: байер потратил за день не меньше этого и не получил ни одного FTD. */
  noFtdSpendCents: 5_000,
  /** «Байер выше бенча N дней подряд». */
  streakDays: 2,
  /** «Спенд гео упал»: день ниже этой доли от среднего за окно. */
  spendDropPercent: 50,
  /** «Скачок CPD»: день выше среднего CPD за окно больше чем на этот процент. */
  cpdJumpPercent: 30,
  /** «Гео без бенча тратит»: спенд за день не меньше этого. */
  noBenchSpendCents: 10_000,
  /** Окно для средних, дней до последнего внесённого. */
  avgWindowDays: 7,
  /** Минимум дней со спендом в окне, чтобы среднему можно было верить. */
  avgMinDays: 3,
  /** «Вчера не внесено»: проверяется начиная с этого часа по Москве. */
  dataDeadlineHourMsk: 10,
} as const;
