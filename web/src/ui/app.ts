import { GEOS } from '../config.ts';
import { ALARM_DEFS, type AlarmResult, type AlarmSeverity, evaluateAlarms, resolveEnabled } from '../domain/alarms.ts';
import { dayShort, int, money0, money2, monthGenitive, monthName, timeLabel } from '../domain/format.ts';
import { buildModel, sumLines } from '../domain/metrics.ts';
import { parsePayload } from '../domain/parse.ts';
import { cpdStatus, worst, yesterdayMsk } from '../domain/status.ts';
import type { BuyerLine, DashboardModel, GeoSummary, SheetRow, Totals } from '../domain/types.ts';
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
  /** Включённые алармы, как их сохранило приложение: { id: true/false }. */
  alarms?: Record<string, boolean> | null;
}

type Period = 'day' | 'month';
type NativeMessage = 'refresh' | 'settings' | { type: 'setAlarms'; alarms: Record<string, boolean> };

const ALARMS_VIEW = 'alarms';

const ui = {
  view: loadPref('view') ?? GEOS[0]?.code ?? ALARMS_VIEW,
  period: new Map<string, Period>(),
};

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(`buyers-dashboard.${key}`);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`buyers-dashboard.${key}`, value);
  } catch {
    /* хранилище недоступно — не критично */
  }
}

/** Отправить сообщение нативному приложению (в браузере — ничего не делает). */
export function sendToNative(message: NativeMessage): void {
  const w = window as unknown as { webkit?: { messageHandlers?: { app?: { postMessage(v: unknown): void } } } };
  w.webkit?.messageHandlers?.app?.postMessage(message);
}

const SEVERITY_GROUPS: readonly { severity: AlarmSeverity; title: string; hint: string }[] = [
  { severity: 'red', title: 'Красные', hint: 'реагировать сегодня' },
  { severity: 'yellow', title: 'Жёлтые', hint: 'присмотреться' },
  { severity: 'data', title: 'Данные', hint: 'таблица заполнена вовремя' },
];

export class DashboardApp {
  private model: DashboardModel | null = null;
  private rows: SheetRow[] = [];
  private meta: RenderMeta = { savedAt: null, loading: false, error: null, configured: true };
  private enabled: Record<string, boolean> = resolveEnabled(safeParse(loadPref('alarms')));
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
    if (meta.alarms) this.enabled = resolveEnabled(meta.alarms);
    if (payload !== null && payload !== undefined) {
      const parsed = parsePayload(payload);
      if (parsed.ok) {
        this.rows = parsed.payload.rows;
        this.model = buildModel(this.rows, GEOS);
        this.dataError = null;
      } else {
        this.dataError = parsed.error;
      }
    }
    this.draw();
  }

  private alarmResults(): AlarmResult[] {
    if (!this.model) return [];
    return evaluateAlarms(this.rows, GEOS, new Date()).results;
  }

  private firing(results: readonly AlarmResult[]): AlarmResult[] {
    return results.filter((r) => this.enabled[r.id] && r.hits.length > 0);
  }

  private draw(): void {
    const results = this.alarmResults();
    const main = h('main', { class: 'content' });
    if (ui.view === ALARMS_VIEW) main.append(this.alarmsView(results));
    else main.append(this.geoView(results));
    this.root.replaceChildren(h('div', { class: 'layout' }, this.sidebar(results), main));
    for (const host of this.root.querySelectorAll<HTMLElement>('[data-chart]')) {
      const g = this.model?.geos.find((x) => x.geo.code === host.dataset.chart);
      if (g) renderChart(host, g.daily, g.geo.benchCents, `${g.geo.name}: CPD и спенд по дням`);
    }
  }

  private go(view: string): void {
    ui.view = view;
    savePref('view', view);
    this.draw();
    window.scrollTo(0, 0);
  }

  // ───────────── Боковое меню ─────────────

  private sidebar(results: readonly AlarmResult[]): HTMLElement {
    const navItem = (view: string, label: string, extra: Node[]): HTMLElement => {
      const b = h('button', { type: 'button', class: 'nav-item', 'aria-current': ui.view === view ? 'page' : undefined }, ...extra, h('span', { class: 'nav-label' }, label));
      b.addEventListener('click', () => this.go(view));
      return b;
    };

    const geoItems = GEOS.map((cfg) => {
      const g = this.model?.geos.find((x) => x.geo.code === cfg.code);
      const lvl = g ? worst(cpdStatus(g.day, cfg.benchCents).level, cpdStatus(g.month, cfg.benchCents).level) : 'none';
      return navItem(cfg.code, cfg.name, [h('span', { class: `dot dot-${lvl}` })]);
    });

    const firing = this.firing(results);
    const red = firing.some((r) => r.severity === 'red');
    const badge = firing.length ? h('span', { class: `badge ${red ? 'badge-bad' : 'badge-warn'}`, 'aria-label': `сработало ${firing.length}` }, String(firing.length)) : null;
    const alarmsItem = navItem(ALARMS_VIEW, 'Алармы', [h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, '⚑')]);
    if (badge) alarmsItem.append(badge);

    const updated = this.meta.loading ? 'Обновляю…' : this.meta.savedAt ? `Обновлено ${timeLabel(this.meta.savedAt, new Date())}` : 'Ещё не обновлялось';
    const refresh = h('button', { type: 'button', class: 'btn btn-block', disabled: this.meta.loading }, this.meta.loading ? 'Обновляю…' : 'Обновить');
    refresh.addEventListener('click', () => sendToNative('refresh'));
    const settings = h('button', { type: 'button', class: 'link small' }, 'Подключение таблицы');
    settings.addEventListener('click', () => sendToNative('settings'));

    return h(
      'aside',
      { class: 'side' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-name' }, 'Дашборд байеры'), h('div', { class: 'muted small' }, 'Команда «Пираньи»')),
      h('nav', { class: 'nav', 'aria-label': 'Разделы' }, h('div', { class: 'nav-title' }, 'Гео'), ...geoItems, h('div', { class: 'nav-title' }, 'Контроль'), alarmsItem),
      h('div', { class: 'side-foot' }, h('div', { class: 'muted small' }, updated), refresh, settings),
    );
  }

  // ───────────── Общие плашки ─────────────

  private banners(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (!this.meta.configured) {
      const link = h('button', { type: 'button', class: 'link' }, 'Открыть настройки');
      link.addEventListener('click', () => sendToNative('settings'));
      out.push(h('div', { class: 'banner' }, h('b', {}, 'Таблица не подключена. '), 'Вставьте ссылку на скрипт и ключ. ', link));
    }
    const err = this.meta.error ?? this.dataError;
    if (err) {
      out.push(h('div', { class: 'banner banner-bad' }, h('b', {}, 'Не удалось обновить. '), err, this.model ? ' На экране — последние полученные данные.' : ''));
    }
    return out;
  }

  // ───────────── Экран гео ─────────────

  private geoView(results: readonly AlarmResult[]): HTMLElement {
    const model = this.model;
    const g = model?.geos.find((x) => x.geo.code === ui.view) ?? model?.geos[0];
    const cfg = g?.geo ?? GEOS.find((x) => x.code === ui.view) ?? GEOS[0];
    const page = h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'head' },
        h('div', { class: 'head-row' }, h('h1', {}, cfg?.name ?? 'Гео'), cfg ? h('span', { class: 'muted' }, 'Бенч CPD: ', h('b', {}, cfg.benchCents === null ? 'не задан' : money0(cfg.benchCents))) : null),
        h('p', { class: 'muted' }, `Последний внесённый день — ${dayShort(model?.lastDay ?? null)}. Спенд — чистый спенд Facebook, без комиссий. CPD = спенд / FTD.`),
      ),
      ...this.banners(),
    );

    const last = model?.lastDay;
    if (last && last < yesterdayMsk(new Date())) {
      page.append(h('div', { class: 'banner' }, h('b', {}, `Нет данных за ${dayShort(yesterdayMsk(new Date()))}. `), `Команда ещё не внесла этот день — ниже последний заполненный, ${dayShort(last)}.`));
    }

    if (cfg) {
      const geoHits = this.firing(results).flatMap((r) => r.hits.filter((x) => x.geo === cfg.code).map((x) => ({ r, x })));
      if (geoHits.length) {
        const open = h('button', { type: 'button', class: 'link' }, 'Открыть алармы');
        open.addEventListener('click', () => this.go(ALARMS_VIEW));
        const red = geoHits.some((x) => x.r.severity === 'red');
        page.append(
          h(
            'div',
            { class: `banner ${red ? 'banner-bad' : ''}` },
            h('b', {}, `Алармы по гео: ${geoHits.length}. `),
            h('ul', { class: 'banner-list' }, ...geoHits.slice(0, 4).map(({ r, x }) => h('li', {}, h('span', { class: 'muted' }, `${r.title}: `), x.text))),
            open,
          ),
        );
      }
    }

    if (!model || !g) {
      page.append(this.emptyState());
      return page;
    }

    const bench = g.geo.benchCents;
    const monthLabel = `${monthName(model.month)}, с 1 ${monthGenitive(model.month)}`;
    page.append(
      h('div', { class: 'cards' }, this.card(`Вчера · ${dayShort(model.lastDay)}`, g.day, bench), this.card(monthLabel, g.month, bench)),
      h(
        'div',
        { class: 'block' },
        h('h3', {}, `CPD и объём по дням: ${monthName(model.month).toLowerCase()}`),
        h('p', { class: 'muted small' }, 'Красным — дни, когда CPD был выше бенча или не было FTD. Высота столбика — сколько потратили за день.'),
        h('div', { class: 'chart', 'data-chart': g.geo.code }),
      ),
      this.buyers(g, model),
      this.notes(),
    );
    return page;
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
    return h('div', { class: 'block' }, h('div', { class: 'table-head' }, h('h3', {}, 'Байеры'), seg), h('div', { class: 'table-wrap' }, this.buyerTable(lines, g.geo.benchCents, period)));
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
      body.append(h('tr', { class: 'total' }, h('td', {}, 'Итого гео'), h('td', {}, money0(t.spendCents)), h('td', {}, int(t.ftd)), h('td', {}, t.cpdCents === null ? 'нет FTD' : money2(t.cpdCents))));
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

  // ───────────── Экран алармов ─────────────

  private setEnabled(next: Record<string, boolean>): void {
    this.enabled = resolveEnabled(next);
    savePref('alarms', JSON.stringify(this.enabled));
    sendToNative({ type: 'setAlarms', alarms: this.enabled });
    this.draw();
  }

  private alarmsView(results: readonly AlarmResult[]): HTMLElement {
    const firing = this.firing(results);
    const onCount = ALARM_DEFS.filter((d) => this.enabled[d.id]).length;
    const allOn = h('button', { type: 'button', class: 'btn' }, 'Включить все');
    allOn.addEventListener('click', () => this.setEnabled(Object.fromEntries(ALARM_DEFS.map((d) => [d.id, true]))));
    const allOff = h('button', { type: 'button', class: 'btn' }, 'Выключить все');
    allOff.addEventListener('click', () => this.setEnabled(Object.fromEntries(ALARM_DEFS.map((d) => [d.id, false]))));

    const summary = !this.model
      ? 'Алармы проверятся, когда загрузятся данные.'
      : `Проверяются при каждом обновлении по последнему внесённому дню — ${dayShort(this.model.lastDay)}. Включено ${onCount} из ${ALARM_DEFS.length}, сработало ${firing.length}.`;

    const page = h(
      'div',
      { class: 'page' },
      h('header', { class: 'head' }, h('div', { class: 'head-row' }, h('h1', {}, 'Алармы'), h('div', { class: 'head-actions' }, allOn, allOff)), h('p', { class: 'muted' }, summary)),
      ...this.banners(),
    );

    const byId = new Map(results.map((r) => [r.id, r]));
    for (const group of SEVERITY_GROUPS) {
      const defs = ALARM_DEFS.filter((d) => d.severity === group.severity);
      page.append(
        h(
          'section',
          { class: 'alarm-group' },
          h('h2', {}, h('span', { class: `sev sev-${group.severity}` }), group.title, h('span', { class: 'muted small' }, ` · ${group.hint}`)),
          ...defs.map((d) => this.alarmCard(d.id, byId.get(d.id))),
        ),
      );
    }
    return page;
  }

  private alarmCard(id: string, result: AlarmResult | undefined): HTMLElement {
    const def = result ?? ALARM_DEFS.find((d) => d.id === id);
    if (!def) return h('div');
    const on = this.enabled[id] ?? true;
    const hits = result?.hits ?? [];

    const toggle = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': `${def.title}: ${on ? 'включён' : 'выключен'}` }, h('span', { class: 'switch-knob' }));
    toggle.addEventListener('click', () => this.setEnabled({ ...this.enabled, [id]: !on }));

    let status: HTMLElement;
    if (!on) status = h('p', { class: 'alarm-status muted' }, 'Выключен — не проверяется и не попадает в счётчик.');
    else if (!this.model) status = h('p', { class: 'alarm-status muted' }, 'Нет данных для проверки.');
    else if (!hits.length) status = h('p', { class: 'alarm-status ok' }, 'Сейчас не срабатывает.');
    else status = h('ul', { class: `alarm-hits hits-${def.severity}` }, ...hits.map((x) => h('li', {}, x.text)));

    return h(
      'article',
      { class: `alarm ${on ? '' : 'alarm-off'} ${on && hits.length ? `alarm-fired alarm-${def.severity}` : ''}` },
      h('div', { class: 'alarm-main' }, h('div', { class: 'alarm-title' }, def.title, on && hits.length ? h('span', { class: `badge ${def.severity === 'red' ? 'badge-bad' : 'badge-warn'}` }, String(hits.length)) : null), h('p', { class: 'muted small' }, def.condition), status),
      toggle,
    );
  }
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
