import type { GeoConfig } from './domain/types.ts';

/**
 * Гео команды «Пираньи» и бенчмарки CPD.
 * Меняется здесь и только здесь; порядок = порядок вкладок.
 */
export const GEOS: readonly GeoConfig[] = [
  { code: 'AR', name: 'Аргентина', benchCents: 2000 },
  { code: 'ET', name: 'Эфиопия', benchCents: 1800 },
  { code: 'MY', name: 'Малайзия', benchCents: null },
];

/** «У границы» — CPD от этой доли бенча и до бенча включительно. */
export const WARN_SHARE_PERCENT = 95;
