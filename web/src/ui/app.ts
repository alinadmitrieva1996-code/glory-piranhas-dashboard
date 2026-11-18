import { GEOS } from '../config.ts';
import { dayShort, int, money0, money2, monthGenitive, monthName, timeLabel } from '../domain/format.ts';
import { buildModel, sumLines } from '../domain/metrics.ts';
import { parsePayload } from '../domain/parse.ts';
import { cpdStatus, worst, yesterdayMsk } from '../domain/status.ts';
import type { BuyerLine, DashboardModel, GeoSummary, Totals } from '../domain/types.ts';
import { renderChart } from './chart.ts';
import { h } from './dom.ts';

/** Что сообщает нативная оболочка помимо данных. */
export interface RenderMeta {
  /** Когда данные были получены из таблицы (ISO). */
  savedAt: string | null;
  loading: boolean;
  /** Ошибка последнего обновления (данные на экране — предыдущие). */
  error: string | null;
  /** Заданы ли ссылка и ключ таблицы. */
  configured: boolean;
}

type Period = 'day' | 'month';

const ui = {
  tab: loadPref('tab') ?? GEOS[0]?.code ?? '',
  period: new Map<string, Period>(),
};

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`piranhas.${key}`);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`piranhas.${key}`, value);
  } catch {
    /* хранилище недоступно — не критично */
  }
}

/** Отправить команду нативному приложению (в браузере — ничего не делает). */
export function sendToNative(action: 'refresh' | 'settings'): void {
  const w = window as unknown as { webkit?: { messageHandlers?: { app?: { postMessage(v: string): void } } } };
  w.webkit?.messageHandlers?.app?.postMessage(action);
}

export class DashboardApp {
  private model: DashboardModel | null = null;
  private meta: RenderMeta = { savedAt: null, loading: false, error: null, configured: true };
  private dataError: string | null = null;
  private resizeTimer = 0;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener('resize', () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.draw(), 120);
    });
  }

  render(payload: unknown, meta: Partial<RenderMeta> = {}): void {
    this.meta = { ...this.meta, ...meta };
    if (payload !== null && payload !== undefined) {
      const parsed = parsePayload(payload);
      if (parsed.ok) {
        this.model = buildModel(parsed.payload.rows, GEOS);
        this.dataError = null;
      } else {
        this.dataError = parsed.error;
      }
    }
    this.draw();
  }

  private draw(): void {
    const page = h('div', { class: 'page' }, this.header(), ...this.banners());
    if (this.model) page.append(this.tabs(this.model), ...this.model.geos.filter((g) => g.geo.code === ui.tab).map((g) => this.geoSection(g, this.model as DashboardModel)), this.notes());
    else page.append(this.emptyState());
    this.root.replaceChildren(page);
    for (const host of this.root.querySelectorAll<HTMLElement>('[data-chart]')) {
      const g = this.model?.geos.find((x) => x.geo.code === host.dataset.chart);
      if (g) renderChart(host, g.daily, g.geo.benchCents, `${g.geo.name}: CPD и спенд по дням`);
    }
  }

  private header(): HTMLElement {
    const m = this.model;
    const updated = this.meta.loading
      ? 'Обновляю данные…'
      : this.meta.savedAt
        ? `Обновлено ${timeLabel(this.meta.savedAt, new Date())}`
        : 'Ещё не обновлялось';
    const btn = h('button', { type: 'button', class: 'btn', disabled: this.meta.loading }, this.meta.loading ? 'Обновляю…' : 'Обновить');
    btn.addEventListener('click', () => sendToNative('refresh'));
    return h(
      'header',
      { class: 'head' },
      h(
        'div',
        { class: 'head-row' },
        h('h1', {}, 'Пираньи: CPD по гео'),
        h('div', { class: 'head-actions' }, h('span', { class: 'muted' }, updated), btn),
      ),
      h(
        'p',
        { class: 'muted' },
        `Последний внесённый день — ${dayShort(m?.lastDay ?? null)}. Спенд — чистый спенд Facebook, без комиссий. CPD = спенд / FTD.`,
      ),
    );
  }

  private banners(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (!this.meta.configured) {
      const link = h('button', { type: 'button', class: 'link' }, 'Открыть настройки');
      link.addEventListener('click', () => sendToNative('settings'));
      out.push(h('div', { class: 'banner' }, h('b', {}, 'Таблица не подключена. '), 'Вставьте ссылку на скрипт и ключ. ', link));
    }
    const err = this.meta.error ?? this.dataError;
    if (err) {
      out.push(
        h(
          'div',
          { class: 'banner banner-bad' },
          h('b', {}, 'Не удалось обновить. '),
          err,
          this.model ? ' На экране — последние полученные данные.' : '',
        ),
      );
    }
    const last = this.model?.lastDay;
    if (last) {
      const y = yesterdayMsk(new Date());
      if (last < y) {
        out.push(
          h(
            'div',
            { class: 'banner' },
            h('b', {}, `Нет данных за ${dayShort(y)}. `),
            `Команда ещё не внесла этот день — ниже последний заполненный, ${dayShort(last)}.`,
          ),
        );
      }
    }
    return out;
  }

  private tabs(model: DashboardModel): HTMLElement {
    const nav = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Гео' });
    for (const g of model.geos) {
      const lvl = worst(cpdStatus(g.day, g.geo.benchCents).level, cpdStatus(g.month, g.geo.benchCents).level);
      const tab = h(
        'button',
        { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(g.geo.code === ui.tab) },
        h('span', { class: `dot dot-${lvl}` }),
        g.geo.name,
      );
      tab.addEventListener('click', () => {
        ui.tab = g.geo.code;
        savePref('tab', ui.tab);
        this.draw();
      });
      nav.append(tab);
    }
    return nav;
  }

  private geoSection(g: GeoSummary, model: DashboardModel): HTMLElement {
    const bench = g.geo.benchCents;
    const monthLabel = `${monthName(model.month)}, с 1 ${monthGenitive(model.month)}`;
    return h(
      'section',
      { class: 'geo', role: 'tabpanel' },
      h('div', { class: 'geo-head' }, h('h2', {}, g.geo.name), h('span', { class: 'muted' }, 'Бенч CPD: ', h('b', {}, bench === null ? 'не задан' : money0(bench)))),
      h('div', { class: 'cards' }, this.card(`Вчера · ${dayShort(model.lastDay)}`, g.day, bench), this.card(monthLabel, g.month, bench)),
      h(
        'div',
        { class: 'block' },
        h('h3', {}, `CPD и объём по дням: ${monthName(model.month).toLowerCase()}`),
        h('p', { class: 'muted small' }, 'Красным — дни, когда CPD был выше бенча или не было FTD. Высота столбика — сколько потратили за день.'),
        h('div', { class: 'chart', 'data-chart': g.geo.code }),
      ),
      this.buyers(g, model),
    );
  }

  private card(label: string, t: Totals, bench: number | null): HTMLElement {
    const st = cpdStatus(t, bench);
    return h(
      'div',
      { class: 'card' },
      h('span', { class: 'label' }, label),
      h('div', { class: 'big' }, h('span', { class: 'num' }, t.cpdCents === null ? '—' : money2(t.cpdCents)), h('span', { class: `pill pill-${st.level}` }, st.text)),
      h('span', { class: 'muted small' }, 'CPD'),
      h('div', { class: 'meta' }, h('span', {}, 'Спенд ', h('b', {}, money0(t.spendCents))), h('span', {}, 'FTD ', h('b', {}, int(t.ftd)))),
    );
  }

  private buyers(g: GeoSummary, model: DashboardModel): HTMLElement {
    const period = ui.period.get(g.geo.code) ?? 'day';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
    for (const [p, text] of [['day', 'Вчера'], ['month', monthName(model.month)]] as const) {
      const b = h('button', { type: 'button', 'aria-pressed': String(p === period) }, text);
      b.addEventListener('click', () => {
        ui.period.set(g.geo.code, p);
        this.draw();
      });
      seg.append(b);
    }
    const lines = period === 'day' ? g.buyersDay : g.buyersMonth;
    return h(
      'div',
      { class: 'block' },
      h('div', { class: 'table-head' }, h('h3', {}, 'Байеры'), seg),
      h('div', { class: 'table-wrap' }, this.buyerTable(lines, g.geo.benchCents, period)),
    );
  }

  private buyerTable(lines: readonly BuyerLine[], bench: number | null, period: Period): HTMLElement {
    const head = h('thead', {}, h('tr', {}, h('th', {}, 'Байер'), h('th', {}, 'Спенд'), h('th', {}, 'FTD'), h('th', {}, 'CPD')));
    const body = h('tbody');
    if (!lines.length) {
      body.append(h('tr', {}, h('td', { colspan: 4, class: 'empty' }, period === 'day' ? 'Вчера в этом гео никто не лил' : 'В этом месяце в гео спенда нет')));
    } else {
      for (const l of lines) {
        const st = cpdStatus(l, bench).level;
        body.append(
          h(
            'tr',
            {},
            h('td', {}, l.buyer),
            h('td', {}, money0(l.spendCents)),
            h('td', {}, int(l.ftd)),
            h('td', { class: st === 'bad' || st === 'warn' ? `st-${st}` : undefined }, l.cpdCents === null ? 'нет FTD' : money2(l.cpdCents)),
          ),
        );
      }
      const t = sumLines(lines);
      body.append(
        h(
          'tr',
          { class: 'total' },
          h('td', {}, 'Итого гео'),
          h('td', {}, money0(t.spendCents)),
          h('td', {}, int(t.ftd)),
          h('td', {}, t.cpdCents === null ? 'нет FTD' : money2(t.cpdCents)),
        ),
      );
    }
    return h('table', { class: 'table' }, head, body);
  }

  private notes(): HTMLElement {
    const benches = GEOS.map((g) => `${g.name} ${g.benchCents === null ? '— не задан' : money0(g.benchCents)}`).join(', ');
    return h(
      'details',
      { class: 'notes' },
      h('summary', {}, 'Как считается'),
      h(
        'ul',
        {},
        h('li', {}, 'Спенд — чистый спенд Facebook без комиссии команды и агентов. CPD — спенд, делённый на число FTD за тот же период. Общего CPD команды нет: гео не смешиваем.'),
        h('li', {}, `Бенчи: ${benches}. «У границы» — CPD от 95% до 100% бенча, красным — выше бенча или спенд без FTD.`),
        h('li', {}, '«Вчера» — последняя дата, по которой в таблице есть спенд. Месяц — с 1-го числа по этот день.'),
        h('li', {}, 'Данные подтягиваются из Google Sheet команды раз в час и по кнопке «Обновить» (⌘R).'),
      ),
    );
  }

  private emptyState(): HTMLElement {
    if (this.dataError) return h('p', { class: 'muted' }, 'Данные не загружены.');
    if (!this.meta.configured) return h('p', { class: 'muted' }, 'Подключите таблицу, чтобы увидеть цифры.');
    return h('p', { class: 'muted' }, this.meta.loading ? 'Загружаю данные из таблицы…' : 'Данных пока нет.');
  }
}
