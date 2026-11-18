import { dayLong, int, money0, money2, moneyShort, pct } from '../domain/format.ts';
import { cpdStatus } from '../domain/status.ts';
import type { BuyerDay, DailyPoint } from '../domain/types.ts';
import { h, s } from './dom.ts';

/** Округляет максимум шкалы до «красивого» числа (1, 2, 2.5, 5 × 10^n). */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const isOver = (d: DailyPoint, bench: number | null): boolean =>
  d.cpdCents === null || (bench !== null && d.cpdCents > bench);

export interface ChartOptions {
  points: readonly DailyPoint[];
  benchCents: number | null;
  /** Отчётный день — подсвечивается и выбран по умолчанию. */
  reportDay: string | null;
  buyersByDate: Readonly<Record<string, BuyerDay[]>>;
  label: string;
}

const PLOT_H = 250;
const CPD_TOP = 20;
const CPD_BOTTOM = 120;
const SPEND_TOP = 150;
const SPEND_BOTTOM = 240;

/**
 * Два ряда на одной оси дней: сверху точки и линия CPD с пунктиром бенча,
 * снизу столбики спенда. Наведение на день показывает его цифры в строке под графиком,
 * клик закрепляет день.
 */
export function renderChart(host: HTMLElement, o: ChartOptions): void {
  host.replaceChildren();
  const { points, benchCents: bench } = o;
  if (!points.length) {
    host.append(h('p', { class: 'muted' }, 'В этом месяце спенда нет'));
    return;
  }
  const n = points.length;
  const step = 100 / n;
  const cpdVals = points.map((p) => p.cpdCents).filter((v): v is number => v !== null);
  const cMax = niceMax(Math.max(bench ?? 0, ...cpdVals, 100) * 1.1);
  const sMax = niceMax(Math.max(...points.map((p) => p.spendCents)) * 1.05);
  const yC = (v: number): number => CPD_BOTTOM - (v / cMax) * (CPD_BOTTOM - CPD_TOP);
  const yS = (v: number): number => SPEND_BOTTOM - (v / sMax) * (SPEND_BOTTOM - SPEND_TOP);

  const axis = h(
    'div',
    { class: 'ch-axis', 'aria-hidden': 'true' },
    h('span', { style: 'top:0' }, 'CPD'),
    h('span', { style: `top:${yC(cMax) - 6}px` }, money0(cMax)),
    h('span', { style: `top:${yC(cMax / 2) - 6}px` }, money0(cMax / 2)),
    h('span', { style: `top:${CPD_BOTTOM - 6}px` }, '$0'),
    h('span', { style: `top:${SPEND_TOP - 24}px` }, 'Спенд'),
    h('span', { style: `top:${yS(sMax) - 6}px` }, moneyShort(sMax)),
    h('span', { style: `top:${SPEND_BOTTOM - 6}px` }, '$0'),
  );

  const plot = h('div', { class: 'ch-plot', role: 'img', 'aria-label': o.label });
  for (const y of [yC(cMax), yC(cMax / 2), CPD_BOTTOM, yS(sMax), SPEND_BOTTOM]) {
    plot.append(h('div', { class: 'ch-grid', style: `top:${y}px` }));
  }
  const reportIdx = points.findIndex((p) => p.date === o.reportDay);
  if (reportIdx >= 0) plot.append(h('div', { class: 'ch-today', style: `left:${reportIdx * step}%;width:${step}%` }));
  if (bench !== null) plot.append(h('div', { class: 'ch-bench', style: `top:${yC(bench)}px` }));

  const withCpd = points.map((p, i) => ({ p, i })).filter((x) => x.p.cpdCents !== null);
  if (withCpd.length > 1) {
    const d = withCpd.map((x, k) => `${k ? 'L' : 'M'}${(((x.i + 0.5) / n) * 1000).toFixed(1)},${yC(x.p.cpdCents ?? 0).toFixed(1)}`).join(' ');
    plot.append(
      s('svg', { class: 'ch-line', viewBox: `0 0 1000 ${PLOT_H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, s('path', { d, 'vector-effect': 'non-scaling-stroke' })),
    );
  }

  const sel = h('div', { class: 'ch-sel', hidden: true });
  plot.append(sel);
  const detail = h('div', { class: 'ch-detail', 'aria-live': 'polite' });
  let pinned = reportIdx >= 0 ? reportIdx : n - 1;

  const show = (i: number): void => {
    const p = points[i];
    if (!p) return;
    sel.hidden = false;
    sel.style.left = `${i * step}%`;
    sel.style.width = `${step}%`;
    const st = cpdStatus(p, bench).level;
    const buyers = o.buyersByDate[p.date] ?? [];
    detail.replaceChildren(
      h('b', { class: 'ch-detail-date' }, dayLong(p.date) + (i === pinned && i !== reportIdx ? ' · закреплён' : '')),
      h('span', {}, 'Спенд ', h('b', {}, money2(p.spendCents))),
      h('span', {}, 'CPD ', h('b', { class: `st-${st}` }, p.cpdCents === null ? 'нет FTD' : money2(p.cpdCents))),
      h('span', {}, 'FTD ', h('b', {}, int(p.ftd))),
      h('span', {}, 'Reg→FTD ', h('b', {}, p.regs ? pct((p.ftd * 100) / p.regs) : '—')),
      h(
        'span',
        { class: 'ch-detail-buyers' },
        buyers.map((b) => `${b.buyer.replace('BUYER', 'B')} ${money0(b.spendCents)} · ${b.cpdCents === null ? 'нет FTD' : money2(b.cpdCents)}`).join('   '),
      ),
    );
  };

  points.forEach((p, i) => {
    const color = isOver(p, bench) ? 'bad' : 'ok';
    const top = yS(p.spendCents);
    plot.append(
      h('div', {
        class: `ch-bar ch-${color}`,
        style: `left:${i * step + step * 0.2}%;width:${step * 0.6}%;top:${top}px;height:${Math.max(1, SPEND_BOTTOM - top)}px`,
      }),
    );
    if (p.cpdCents !== null) {
      plot.append(h('div', { class: `ch-dot ch-${color}`, style: `left:${(i + 0.5) * step}%;top:${yC(p.cpdCents)}px` }));
    }
    const hit = h('button', {
      type: 'button',
      class: 'ch-hit',
      style: `left:${i * step}%;width:${step}%`,
      'aria-label': `${dayLong(p.date)}: спенд ${money0(p.spendCents)}, CPD ${p.cpdCents === null ? 'нет FTD' : money2(p.cpdCents)}, FTD ${p.ftd}`,
    });
    hit.addEventListener('mouseenter', () => show(i));
    hit.addEventListener('focus', () => show(i));
    hit.addEventListener('click', () => {
      pinned = i;
      show(i);
    });
    plot.append(hit);
  });
  plot.addEventListener('mouseleave', () => show(pinned));

  const labels = h('div', { class: 'ch-days', 'aria-hidden': 'true' }, ...points.map((p, i) => h('span', { class: i === reportIdx ? 'today' : undefined }, String(Number(p.date.slice(8))))));

  host.append(h('div', { class: 'ch-wrap' }, axis, plot), labels, detail);
  show(pinned);
}
