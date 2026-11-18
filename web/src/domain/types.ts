/** Строка из таблицы команды: один байер, один день, одно гео. Контракт — docs/data-contract.md. */
export interface SheetRow {
  buyer: string;
  /** Дата в формате YYYY-MM-DD (часовой пояс таблицы). */
  date: string;
  geo: string;
  clicks: number;
  regs: number;
  ftd: number;
  /** Чистый спенд Facebook в долларах, без комиссий. */
  spend: number;
}

export interface SheetPayload {
  ok: true;
  version: number;
  generatedAt: string;
  spreadsheet?: string;
  timezone?: string;
  rows: SheetRow[];
}

/** Нормализованная строка: деньги в центах (целое), без float в расчётах. */
export interface DayRow {
  buyer: string;
  date: string;
  geo: string;
  ftd: number;
  spendCents: number;
}

export type StatusLevel = 'bad' | 'warn' | 'ok' | 'none';

export interface Status {
  level: StatusLevel;
  text: string;
}

export interface Totals {
  spendCents: number;
  ftd: number;
  /** null — FTD нет, CPD не определён. */
  cpdCents: number | null;
}

export interface DailyPoint extends Totals {
  date: string;
}

export interface BuyerLine extends Totals {
  buyer: string;
}

export interface GeoConfig {
  code: string;
  name: string;
  /** Бенчмарк CPD в центах; null — бенча нет. */
  benchCents: number | null;
}

export interface GeoSummary {
  geo: GeoConfig;
  day: Totals;
  month: Totals;
  daily: DailyPoint[];
  buyersDay: BuyerLine[];
  buyersMonth: BuyerLine[];
}

export interface DashboardModel {
  /** Последний день, где у команды есть спенд. null — данных нет. */
  lastDay: string | null;
  /** Месяц последнего дня, YYYY-MM. */
  month: string | null;
  geos: GeoSummary[];
}
