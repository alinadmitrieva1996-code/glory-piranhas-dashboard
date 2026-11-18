import { dayShort, int, money0, money2, moneyShort } from '../domain/format.ts';
import type { DailyPoint } from '../domain/types.ts';
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

/**
 * Два ряда на одной оси дней: сверху линия CPD с пунктиром бенча,
 * снизу столбики спенда. Красным — дни выше бенча или без FTD.
 */
export function renderChart(host: HTMLElement, points: readonly DailyPoint[], benchCents: number | null, label: string): void {
  host.replaceChildren();
  if (!points.length) {
    host.append(h('p', { class: 'muted' }, 'В этом месяце спенда нет'));
    return;
  }
  const W = Math.max(300, Math.floor(host.clientWidth || 640));
  const H = 290;
  const m = { l: 52, r: 10 };
  const top = { y0: 30, h: 104 };
  const bot = { y0: 176, h: 84 };
  const axisY = 278;

  const n = points.length;
  const step = (W - m.l - m.r) / n;
  const bw = Math.max(2, step * 0.72);
  const cx = (i: number): number => m.l + step * i + step / 2;

  const cpdVals = points.map((p) => p.cpdCents).filter((v): v is number => v !== null);
  const cpdMax = niceMax(Math.max(benchCents ?? 0, ...cpdVals, 100) * 1.1);
  const spendMax = niceMax(Math.max(...points.map((p) => p.spendCents)) * 1.05);
  const yC = (v: number): number => top.y0 + top.h - (v / cpdMax) * top.h;
  const yS = (v: number): number => bot.y0 + bot.h - (v / spendMax) * bot.h;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': label });

  const caption = (y: number, text: string, x = 0, anchor = 'start'): SVGTextElement =>
    s('text', { x, y, class: 'ch-cap', 'text-anchor': anchor }, text);
  svg.append(caption(top.y0 - 16, 'CPD, $'), caption(bot.y0 - 16, 'Спенд за день, $'));

  const grid = (y0: number, hgt: number, max: number, fmt: (v: number) => string): void => {
    for (const k of [0, 0.5, 1]) {
      const y = y0 + hgt - k * hgt;
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'ch-grid' }));
      svg.append(s('text', { x: m.l - 6, y: y + 4, class: 'ch-tick', 'text-anchor': 'end' }, fmt(max * k)));
    }
  };
  grid(top.y0, top.h, cpdMax, (v) => '$' + Math.round(v / 100));
  grid(bot.y0, bot.h, spendMax, moneyShort);

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l) / 40))));
  points.forEach((p, i) => {
    if (i % every === 0) svg.append(s('text', { x: cx(i), y: axisY, class: 'ch-tick', 'text-anchor': 'middle' }, String(Number(p.date.slice(8)))));
    const y = yS(p.spendCents);
    svg.append(
      s('rect', {
        x: cx(i) - bw / 2,
        y,
        width: bw,
        height: Math.max(1, bot.y0 + bot.h - y),
        rx: 1.5,
        class: isOver(p, benchCents) ? 'ch-bar ch-bad' : 'ch-bar',
      }),
    );
  });

  if (benchCents !== null) {
    const y = yC(benchCents);
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'ch-bench' }));
    svg.append(caption(top.y0 - 16, `- - бенч ${money0(benchCents)}`, W - m.r, 'end'));
  }

  const withCpd = points.map((p, i) => ({ p, i })).filter((x) => x.p.cpdCents !== null);
  if (withCpd.length > 1) {
    const d = withCpd.map((x, k) => `${k ? 'L' : 'M'}${cx(x.i).toFixed(1)},${yC(x.p.cpdCents ?? 0).toFixed(1)}`).join('');
    svg.append(s('path', { d, class: 'ch-line' }));
  }
  for (const x of withCpd) {
    svg.append(s('circle', { cx: cx(x.i), cy: yC(x.p.cpdCents ?? 0), r: 3.5, class: isOver(x.p, benchCents) ? 'ch-dot ch-bad' : 'ch-dot' }));
  }

  const hl = s('rect', { x: 0, y: top.y0, width: step, height: bot.y0 + bot.h - top.y0, class: 'ch-hl', visibility: 'hidden' });
  svg.append(hl);
  const tip = h('div', { class: 'ch-tip', hidden: true });

  points.forEach((p, i) => {
    const hit = s('rect', { x: m.l + step * i, y: top.y0, width: step, height: axisY - top.y0, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      hl.setAttribute('x', String(m.l + step * i));
      hl.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        h('div', {}, `${dayShort(p.date)}: CPD ${p.cpdCents === null ? 'нет FTD' : money2(p.cpdCents)}`),
        h('span', {}, `Спенд ${money0(p.spendCents)} · FTD ${int(p.ftd)}`),
      );
      tip.hidden = false;
      const scale = (host.clientWidth || W) / W;
      const left = cx(i) * scale - tip.offsetWidth / 2;
      tip.style.left = `${Math.min(Math.max(0, left), (host.clientWidth || W) - tip.offsetWidth)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      tip.hidden = true;
      hl.setAttribute('visibility', 'hidden');
    });
    svg.append(hit);
  });

  host.append(svg, tip);
}
