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
  regs: number;
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
  regs: number;
  /** null — FTD нет, CPD не определён. */
  cpdCents: number | null;
}

export interface DailyPoint extends Totals {
  date: string;
}

export interface BuyerDay extends Totals {
  buyer: string;
}

export interface BuyerSummary {
  buyer: string;
  day: Totals;
  month: Totals;
  /** Доля в спенде гео за месяц, в базисных пунктах (100% = 10 000). */
  shareBp: number;
  /** Спенд сверх бенча × FTD за месяц, центы (0, если в бенче). */
  overpayCents: number;
  /** Последние 7 календарных дней по отчётный день включительно. */
  last7: DailyPoint[];
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
  /** Средние за 7 дней до отчётного дня (только дни со спендом); null — данных мало. */
  avg7: { spendCents: number; ftd: number; cpdCents: number | null } | null;
  /** Бенч × FTD − спенд за месяц: >0 — запас, <0 — перерасход. null — бенча нет. */
  headroomCents: number | null;
  daily: DailyPoint[];
  /** Байеры по дням: дата → строки байеров (для строки выбранного дня на графике). */
  buyersByDate: Record<string, BuyerDay[]>;
  buyers: BuyerSummary[];
}

/** Последний день заполнен не всеми байерами. */
export interface PartialDay {
  date: string;
  entered: number;
  expected: number;
}

export interface DashboardModel {
  /** Отчётный день («вчера»): последний полностью заполненный. null — данных нет. */
  lastDay: string | null;
  /** Месяц отчётного дня, YYYY-MM. */
  month: string | null;
  /** Последний день в таблице заполнен частично — показываем предыдущий. */
  partial: PartialDay | null;
  geos: GeoSummary[];
}
