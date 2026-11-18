import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GEOS } from '../src/config.ts';
import { dayShort, money0, money2, monthName } from '../src/domain/format.ts';
import { applyBenches, buildModel, lastFilledDay, normalize, overpayCents, reportDay, sumLines } from '../src/domain/metrics.ts';
import { cpdCents, toCents } from '../src/domain/money.ts';
import { parsePayload } from '../src/domain/parse.ts';
import { cpdStatus, worst, yesterdayMsk } from '../src/domain/status.ts';
import type { SheetRow } from '../src/domain/types.ts';

const row = (buyer: string, date: string, geo: string, spend: number, ftd: number, regs = 0): SheetRow => ({ buyer, date, geo, clicks: 0, regs, ftd, spend });

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
    assert.deepEqual(ar.day, { spendCents: 63000, ftd: 10, regs: 0, cpdCents: 6300 });
    assert.deepEqual(ar.month, { spendCents: 93030, ftd: 20, regs: 0, cpdCents: 4652 });
  });

  it('не смешивает гео', () => {
    assert.ok(et);
    assert.deepEqual(et.month, { spendCents: 3600, ftd: 2, regs: 0, cpdCents: 1800 });
  });

  it('байеры: сортировка по переплате, вчера и месяц, доля спенда', () => {
    assert.ok(ar);
    // бенч AR $20: BUYER2 $530,20 на 5 FTD → переплата $430,20; BUYER1 $400,10 на 15 FTD → $100,10
    assert.deepEqual(
      ar.buyers.map((b) => [b.buyer, b.overpayCents, b.day.cpdCents, b.shareBp]),
      [
        ['BUYER2', 43020, null, 5699],
        ['BUYER1', 10010, 3000, 4301],
      ],
    );
    assert.deepEqual(sumLines(ar.buyers.map((b) => b.day)), ar.day);
    assert.equal(ar.buyers[0]?.last7.length, 7);
  });

  it('запас до бенча: бенч × FTD − спенд', () => {
    assert.equal(ar?.headroomCents, 2000 * 20 - 93030);
    assert.equal(model.geos.find((g) => g.geo.code === 'MY')?.headroomCents, null);
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

describe('отчётный день и бенчи', () => {
  it('последний день, внесённый половиной байеров и меньше, считается частичным', () => {
    const rs = normalize([
      row('B1', '2026-11-16', 'AR', 100, 5), row('B2', '2026-11-16', 'AR', 100, 5), row('B3', '2026-11-16', 'ET', 50, 2), row('B4', '2026-11-16', 'AR', 10, 1),
      row('B4', '2026-11-17', 'AR', 100, 5),
    ]);
    assert.deepEqual(reportDay(rs), { day: '2026-11-16', partial: { date: '2026-11-17', entered: 1, expected: 4 } });
  });

  it('если внесли больше половины — день полный', () => {
    const rs = normalize([
      row('B1', '2026-11-16', 'AR', 100, 5), row('B2', '2026-11-16', 'AR', 100, 5), row('B3', '2026-11-16', 'AR', 100, 5),
      row('B1', '2026-11-17', 'AR', 100, 5), row('B2', '2026-11-17', 'AR', 100, 5),
    ]);
    assert.deepEqual(reportDay(rs), { day: '2026-11-17', partial: null });
  });

  it('модель берёт отчётный день, а не частичный', () => {
    const m = buildModel([...ROWS, row('BUYER9', '2026-11-03', 'AR', 50, 1)], GEOS);
    assert.equal(m.lastDay, '2026-11-02');
    assert.equal(m.partial?.date, '2026-11-03');
  });

  it('переплата и бенч пользователя', () => {
    assert.equal(overpayCents({ spendCents: 10000, ftd: 4, regs: 0, cpdCents: 2500 }, 2000), 2000);
    assert.equal(overpayCents({ spendCents: 10000, ftd: 4, regs: 0, cpdCents: 2500 }, null), 0);
    const g = applyBenches(GEOS, { AR: 2200, MY: 4000, XX: 1, ET: -5 });
    assert.deepEqual(g.map((x) => x.benchCents), [2200, 1800, 4000]);
  });
});

describe('cpdStatus', () => {
  const t = (spendCents: number, ftd: number) => ({ spendCents, ftd, regs: 0, cpdCents: cpdCents(spendCents, ftd) });
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
