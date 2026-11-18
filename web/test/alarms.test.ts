import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GEOS } from '../src/config.ts';
import { ALARM_DEFS, addDays, evaluateAlarms, resolveEnabled } from '../src/domain/alarms.ts';
import type { SheetRow } from '../src/domain/types.ts';

const row = (buyer: string, date: string, geo: string, spend: number, ftd: number): SheetRow => ({ buyer, date, geo, clicks: 0, regs: 0, ftd, spend });

// 9–15 ноября — ровная база AR: $1000 и 50 FTD в день (CPD $20), ET: $300 и 20 FTD (CPD $15).
const base: SheetRow[] = [];
for (let d = 9; d <= 15; d++) {
  const date = `2026-11-${String(d).padStart(2, '0')}`;
  base.push(row('BUYER1', date, 'AR', 1000, 50), row('BUYER7', date, 'ET', 300, 20));
}

// 15 ноября BUYER4 уже выше бенча, 16 ноября — последний день.
const rows: SheetRow[] = [
  ...base,
  row('BUYER4', '2026-11-15', 'AR', 120, 4), // $30
  row('BUYER1', '2026-11-16', 'AR', 900, 50), // $18 — в бенче
  row('BUYER4', '2026-11-16', 'AR', 350, 10), // $35 > $21 при спенде > $300 → вопрос к лиду; 2 дня подряд
  row('BUYER2', '2026-11-16', 'AR', 80, 0), // спенд без FTD
  row('BUYER7', '2026-11-16', 'ET', 100, 2), // $50: скачок CPD и выше бенча; спенд упал (100 < 150)
  row('BUYER3', '2026-11-16', 'MY', 150, 3), // гео без бенча тратит
];

const at = (iso: string): Date => new Date(iso);
const hitsOf = (id: string, now = at('2026-11-17T09:00:00Z')) =>
  evaluateAlarms(rows, GEOS, now).results.find((r) => r.id === id)?.hits ?? [];

describe('алармы', () => {
  it('все 10 условий описаны, id уникальны', () => {
    assert.equal(ALARM_DEFS.length, 10);
    assert.equal(new Set(ALARM_DEFS.map((d) => d.id)).size, 10);
  });

  it('не остановили дорогой залив: спенд > $300 и CPD > бенч +5%', () => {
    const h = hitsOf('lead_not_stopped');
    assert.deepEqual(h.map((x) => x.buyer), ['BUYER4']);
    assert.match(h[0]?.text ?? '', /Вопрос к лиду/);
  });

  it('при CPD в пределах +5% к бенчу лида не дёргаем', () => {
    const r = evaluateAlarms([row('BUYER9', '2026-11-16', 'AR', 420, 20)], GEOS, at('2026-11-16T12:00:00Z')); // $21,00 = ровно +5%
    assert.equal(r.results.find((x) => x.id === 'lead_not_stopped')?.hits.length, 0);
  });

  it('спенд без FTD', () => {
    assert.deepEqual(hitsOf('buyer_spend_no_ftd').map((x) => x.buyer), ['BUYER2']);
  });

  it('байер выше бенча 2 дня подряд', () => {
    assert.deepEqual(hitsOf('buyer_streak_over_bench').map((x) => x.buyer), ['BUYER4']);
  });

  it('гео за вчера выше бенча: AR (из-за BUYER4/BUYER2) и ET', () => {
    // AR 16-го: $1330 / 60 = $22,17 > $20
    assert.deepEqual(hitsOf('geo_day_over_bench').map((x) => x.geo), ['AR', 'ET']);
  });

  it('месяц: AR перешёл бенч ($8 450 / 414 = $20,41)', () => {
    assert.deepEqual(hitsOf('geo_month_over_bench').map((x) => x.geo), ['AR']);
    assert.deepEqual(hitsOf('geo_month_near_bench').map((x) => x.geo), []);
  });

  it('месяц у границы: 95–100% бенча', () => {
    const r = evaluateAlarms([row('BUYER1', '2026-11-16', 'AR', 1950, 100)], GEOS, at('2026-11-16T12:00:00Z')); // $19,50
    const ids = r.results.filter((x) => x.hits.length).map((x) => x.id);
    assert.ok(ids.includes('geo_month_near_bench'));
    assert.ok(!ids.includes('geo_month_over_bench'));
  });

  it('скачок CPD и падение спенда к среднему за 7 дней', () => {
    // AR: $22,17 против $20,11 — +10%, ниже порога 30%. ET: $50 против $15.
    assert.deepEqual(hitsOf('geo_cpd_jump').map((x) => x.geo), ['ET']);
    assert.deepEqual(hitsOf('geo_spend_drop').map((x) => x.geo), ['ET']);
  });

  it('гео без бенча тратит', () => {
    assert.deepEqual(hitsOf('geo_no_bench_spend').map((x) => x.geo), ['MY']);
  });

  it('вчера не внесено — только после 10:00 МСК', () => {
    assert.equal(hitsOf('data_missing', at('2026-11-18T06:59:00Z')).length, 0); // 09:59 МСК
    assert.equal(hitsOf('data_missing', at('2026-11-18T07:00:00Z')).length, 1); // 10:00 МСК, нет 17-го
    assert.equal(hitsOf('data_missing', at('2026-11-17T09:00:00Z')).length, 0); // 16-е внесено
  });

  it('пустые данные: срабатывает только «не внесено»', () => {
    const r = evaluateAlarms([], GEOS, at('2026-11-18T08:00:00Z'));
    assert.deepEqual(r.results.filter((x) => x.hits.length).map((x) => x.id), ['data_missing']);
  });

  it('addDays переходит через месяц', () => {
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  it('resolveEnabled: по умолчанию всё включено, мусор игнорируется', () => {
    const e = resolveEnabled({ lead_not_stopped: false, geo_cpd_jump: 'no', unknown: false });
    assert.equal(e.lead_not_stopped, false);
    assert.equal(e.geo_cpd_jump, true);
    assert.equal('unknown' in e, false);
    assert.equal(Object.values(resolveEnabled(null)).every(Boolean), true);
  });
});
