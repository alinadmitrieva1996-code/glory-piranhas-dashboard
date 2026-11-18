const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Центы → «$1 234» (целые доллары). */
export function money0(cents: number): string {
  return '$' + nf0.format(Math.round(cents / 100));
}

/** Центы → «$19,72». */
export function money2(cents: number): string {
  return '$' + nf2.format(cents / 100);
}

export function int(n: number): string {
  return nf0.format(n);
}

/** Короткая подпись оси: $850, $1,5k. */
export function moneyShort(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) return '$' + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(d / 1000) + 'k';
  return '$' + nf0.format(d);
}

/** «2026-11-16» → «16 ноя». */
export function dayShort(iso: string | null): string {
  if (!iso) return '—';
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return `${d} ${MONTHS_SHORT[m - 1] ?? ''}`.trim();
}

/** «2026-11» → «Ноябрь». */
export function monthName(ym: string | null): string {
  if (!ym) return 'Месяц';
  return MONTHS_NOM[Number(ym.slice(5, 7)) - 1] ?? 'Месяц';
}

/** «2026-11» → «ноября» (для «с 1 ноября»). */
export function monthGenitive(ym: string | null): string {
  if (!ym) return '';
  return MONTHS_GEN[Number(ym.slice(5, 7)) - 1] ?? '';
}

/** ISO-время → «14:05» или «17 ноя, 14:05», если не сегодня. */
export function timeLabel(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  const hm = t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return hm;
  return `${t.getDate()} ${MONTHS_SHORT[t.getMonth()] ?? ''}, ${hm}`;
}

/** «2026-11-16» → «16 ноября 2026». */
export function dayLong(iso: string | null): string {
  if (!iso) return '—';
  const m = Number(iso.slice(5, 7));
  return `${Number(iso.slice(8, 10))} ${MONTHS_GEN[m - 1] ?? ''} ${iso.slice(0, 4)}`;
}

/** «2026-11-16» → «16 ноября». */
export function dayMedium(iso: string | null): string {
  if (!iso) return '—';
  return `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1] ?? ''}`;
}

/** 25.4 → «25%». */
export function pct(x: number): string {
  return nf0.format(Math.round(x)) + '%';
}

/** «2026-11-01», «2026-11-16» → «01.11–16.11». */
export function rangeShort(from: string, to: string): string {
  const f = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return `${f(from)}–${f(to)}`;
}
