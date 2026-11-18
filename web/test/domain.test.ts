import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GEOS } from '../src/config.ts';
import { dayShort, money0, money2, monthName } from '../src/domain/format.ts';
import { buildModel, lastFilledDay, normalize, sumLines } from '../src/domain/metrics.ts';
import { cpdCents, toCents } from '../src/domain/money.ts';
import { parsePayload } from '../src/domain/parse.ts';
import { cpdStatus, worst, yesterdayMsk } from '../src/domain/status.ts';
import type { SheetRow } from '../src/domain/types.ts';

const row = (buyer: string, date: string, geo: string, spend: number, ftd: number): SheetRow => ({ buyer, date, geo, clicks: 0, regs: 0, ftd, spend });

const ROWS: SheetRow[] = [
  row('BUYER1', '2026-10-31', 'AR', 500, 10), // прошлый месяц — не входит в ноябрь
  row('BUYER1', '2026-11-01', 'AR', 100.1, 5),
  row('BUYER2', '2026-11-01', 'AR', 200.2, 5),
  row('BUYER1', '2026-11-02', 'AR', 300, 10),
  row('BUYER2', '2026-11-02', 'AR', 330, 0),
  row('BUYER3', '2026-11-02', 'ET', 36, 2),
  row('BUYER3', '2026-11-03', 'MY', 0, 1), // FTD без спенда — день не считается заполненным
];

describe('money', () => {
  it('переводит доллары в центы без ошибок float', () => {
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(toCents(4053.51), 405351);
    assert.equal(toCents(Number.NaN), 0);
  });
  it('считает CPD в центах и null без FTD', () => {
    assert.equal(cpdCents(1457108, 739), 1972);
    assert.equal(cpdCents(1000, 0), null);
  });
});

describe('parsePayload', () => {
  it('принимает корректный ответ и пропускает битые строки', () => {
    const r = parsePayload({ ok: true, generatedAt: 'x', rows: [ROWS[1], { buyer: 'B', date: '16.11', geo: 'AR', spend: 1, ftd: 1 }, { foo: 1 }] });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.payload.rows.length, 1);
      assert.equal(r.skipped, 2);
    }
  });
  it('возвращает понятную ошибку на отказ скрипта', () => {
    const r = parsePayload({ ok: false, error: 'unauthorized' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unauthorized/);
  });
  it('отклоняет не-объект', () => {
    assert.equal(parsePayload('<html>').ok, false);
    assert.equal(parsePayload({ ok: true }).ok, false);
  });
});

describe('buildModel', () => {
  const model = buildModel(ROWS, GEOS);
  const ar = model.geos.find((g) => g.geo.code === 'AR');
  const et = model.geos.find((g) => g.geo.code === 'ET');

  it('находит последний день со спендом', () => {
    assert.equal(lastFilledDay(normalize(ROWS)), '2026-11-02');
    assert.equal(model.lastDay, '2026-11-02');
    assert.equal(model.month, '2026-11');
  });

  it('считает «вчера» и месяц по гео, без прошлого месяца', () => {
    assert.ok(ar);
    assert.deepEqual(ar.day, { spendCents: 63000, ftd: 10, cpdCents: 6300 });
    assert.deepEqual(ar.month, { spendCents: 93030, ftd: 20, cpdCents: 4652 });
  });

  it('не смешивает гео', () => {
    assert.ok(et);
    assert.deepEqual(et.month, { spendCents: 3600, ftd: 2, cpdCents: 1800 });
  });

  it('байеры отсортированы по спенду, спенд без FTD даёт null CPD', () => {
    assert.ok(ar);
    assert.deepEqual(
      ar.buyersDay.map((b) => [b.buyer, b.spendCents, b.cpdCents]),
      [
        ['BUYER2', 33000, null],
        ['BUYER1', 30000, 3000],
      ],
    );
    assert.deepEqual(sumLines(ar.buyersDay), ar.day);
  });

  it('график — только дни со спендом, по порядку', () => {
    assert.ok(ar);
    assert.deepEqual(ar.daily.map((d) => d.date), ['2026-11-01', '2026-11-02']);
  });

  it('пустые данные не ломают модель', () => {
    const empty = buildModel([], GEOS);
    assert.equal(empty.lastDay, null);
    assert.equal(empty.geos.length, GEOS.length);
  });
});

describe('cpdStatus', () => {
  const t = (spendCents: number, ftd: number) => ({ spendCents, ftd, cpdCents: cpdCents(spendCents, ftd) });
  it('выше бенча — красный с процентом', () => {
    assert.deepEqual(cpdStatus(t(2600, 1), 2000), { level: 'bad', text: 'Выше бенча на 30%' });
  });
  it('95–100% бенча — у границы, ровно бенч — тоже', () => {
    assert.equal(cpdStatus(t(1900, 1), 2000).level, 'warn');
    assert.equal(cpdStatus(t(2000, 1), 2000).level, 'warn');
    assert.equal(cpdStatus(t(1899, 1), 2000).level, 'ok');
  });
  it('спенд без FTD — красный, бенча нет — серый', () => {
    assert.deepEqual(cpdStatus(t(500, 0), 2000), { level: 'bad', text: 'Нет FTD' });
    assert.equal(cpdStatus(t(3600, 1), null).level, 'none');
    assert.equal(cpdStatus(t(0, 0), 2000).level, 'none');
  });
  it('worst выбирает худший статус', () => {
    assert.equal(worst('ok', 'warn'), 'warn');
    assert.equal(worst('bad', 'none'), 'bad');
  });
});

describe('даты и формат', () => {
  it('вчера по Москве', () => {
    assert.equal(yesterdayMsk(new Date('2026-11-18T06:00:00Z')), '2026-11-17');
    assert.equal(yesterdayMsk(new Date('2026-11-17T22:30:00Z')), '2026-11-17'); // 01:30 МСК 18-го
  });
  it('подписи', () => {
    assert.equal(dayShort('2026-11-16'), '16 ноя');
    assert.equal(monthName('2026-11'), 'Ноябрь');
    assert.equal(money2(1972).replace(/\s/g, ' '), '$19,72');
    assert.equal(money0(1457108).replace(/\s/g, ' '), '$14 571');
  });
});
