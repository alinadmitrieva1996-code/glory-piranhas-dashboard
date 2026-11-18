import type { SheetPayload, SheetRow } from './types.ts';

export type ParseResult = { ok: true; payload: SheetPayload; skipped: number } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseRow(v: unknown): SheetRow | null {
  if (!isRecord(v)) return null;
  const { buyer, date, geo } = v;
  if (typeof buyer !== 'string' || !buyer || typeof geo !== 'string' || !geo) return null;
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null;
  const clicks = finiteNumber(v.clicks) ?? 0;
  const regs = finiteNumber(v.regs) ?? 0;
  const ftd = finiteNumber(v.ftd);
  const spend = finiteNumber(v.spend);
  if (ftd === null || spend === null || ftd < 0 || spend < 0) return null;
  return { buyer, date, geo: geo.toUpperCase(), clicks, regs, ftd: Math.round(ftd), spend };
}

/** Проверяет ответ скрипта таблицы. Битые строки пропускаются и считаются. */
export function parsePayload(input: unknown): ParseResult {
  if (!isRecord(input)) return { ok: false, error: 'Ответ таблицы пустой или не в формате JSON' };
  if (input.ok !== true) {
    const code = typeof input.error === 'string' ? input.error : 'unknown';
    return { ok: false, error: `Скрипт таблицы вернул ошибку: ${code}` };
  }
  if (!Array.isArray(input.rows)) return { ok: false, error: 'В ответе таблицы нет строк (rows)' };
  const rows: SheetRow[] = [];
  let skipped = 0;
  for (const raw of input.rows) {
    const row = parseRow(raw);
    if (row) rows.push(row);
    else skipped += 1;
  }
  const payload: SheetPayload = {
    ok: true,
    version: finiteNumber(input.version) ?? 1,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : '',
    rows,
  };
  if (typeof input.spreadsheet === 'string') payload.spreadsheet = input.spreadsheet;
  if (typeof input.timezone === 'string') payload.timezone = input.timezone;
  return { ok: true, payload, skipped };
}
