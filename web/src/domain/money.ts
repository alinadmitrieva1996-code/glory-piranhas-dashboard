/** Доллары из таблицы → целые центы. Все суммы и деления дальше — только в центах. */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/** CPD в центах, округлённый до цента. null, если FTD нет. */
export function cpdCents(spendCents: number, ftd: number): number | null {
  return ftd > 0 ? Math.round(spendCents / ftd) : null;
}
