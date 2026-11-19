import { GEOS } from '../config.ts';
import { ALARM_DEFS, type AlarmResult, type AlarmSeverity, evaluateAlarms, resolveEnabled } from '../domain/alarms.ts';
import { dayMedium, int, money0, money2, monthName, pct, rangeShort, timeLabel } from '../domain/format.ts';
import { applyBenches, buildModel, sumLines } from '../domain/metrics.ts';
import { parsePayload } from '../domain/parse.ts';
import { cpdStatus, worst } from '../domain/status.ts';
import type { BuyerSummary, DashboardModel, GeoConfig, GeoSummary, SheetRow, StatusLevel, Totals } from '../domain/types.ts';
import { renderChart } from './chart.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

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
  /** Бенчи, изменённые пользователем: { AR: 2000 } в центах. */
  benches?: Record<string, number> | null;
}

type NativeMessage =
  | 'refresh'
  | 'settings'
  | { type: 'setAlarms'; alarms: Record<string, boolean> }
  | { type: 'setBenches'; benches: Record<string, number> };

const ALARMS_VIEW = 'alarms';
const BENCH_STEP_CENTS = 50;

const ui = { view: loadPref('view') ?? GEOS[0]?.code ?? ALARMS_VIEW };

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

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Только известные гео и целые центы > 0. */
function cleanBenches(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const g of GEOS) {
    const v = (raw as Record<string, unknown>)[g.code];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000_00) out[g.code] = v;
  }
  return out;
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

const levelClass = (l: StatusLevel): string => `st-${l}`;
const cpdText = (t: Totals): string => (t.cpdCents === null ? (t.spendCents > 0 ? 'нет FTD' : '—') : money2(t.cpdCents));

function deltaText(t: Totals, bench: number | null): string {
  if (t.cpdCents === null) return t.spendCents > 0 ? 'нет FTD' : 'нет данных';
  if (bench === null) return 'бенча нет';
  const p = Math.round(((t.cpdCents - bench) * 100) / bench);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}% к бенчу`;
}

function vsAvg(v: number, avg: number | undefined): string {
  if (!avg) return 'нет среднего за 7 дн.';
  const p = Math.round((v / avg - 1) * 100);
  return `${p >= 0 ? '+' : '−'}${Math.abs(p)}% к ср. за 7 дн.`;
}

/** «BUYER4 · AR, 16 ноя: спенд $435, …» → «спенд $435, …» (кто и когда уже видно на экране). */
function shortHit(text: string): string {
  const i = text.indexOf(': ');
  return i >= 0 ? text.slice(i + 2) : text;
}

export class DashboardApp {
  private rows: SheetRow[] = [];
  private loaded = false;
  private meta: RenderMeta = { savedAt: null, loading: false, error: null, configured: true };
  private enabled: Record<string, boolean> = resolveEnabled(safeParse(loadPref('alarms')));
  private benches: Record<string, number> = cleanBenches(safeParse(loadPref('benches')));
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
    if (meta.benches) this.benches = cleanBenches(meta.benches);
    if (payload !== null && payload !== undefined) {
      const parsed = parsePayload(payload);
      if (parsed.ok) {
        this.rows = parsed.payload.rows;
        this.loaded = true;
        this.dataError = null;
      } else {
        this.dataError = parsed.error;
      }
    }
    this.draw();
  }

  private geos(): GeoConfig[] {
    return applyBenches(GEOS, this.benches);
  }

  private draw(): void {
    const geos = this.geos();
    const model = this.loaded ? buildModel(this.rows, geos, new Date()) : null;
    const results = this.loaded ? evaluateAlarms(this.rows, geos, new Date()).results : [];
    const main = h('main', { class: 'panel' });
    if (ui.view === ALARMS_VIEW) main.append(this.alarmsView(model, results));
    else main.append(this.geoView(model, results));
    this.root.replaceChildren(h('div', { class: 'layout' }, this.sidebar(model, results), main));
    const g = model?.geos.find((x) => x.geo.code === ui.view);
    const host = this.root.querySelector<HTMLElement>('[data-chart]');
    if (g && host) {
      renderChart(host, { points: g.daily, benchCents: g.geo.benchCents, reportDay: model?.lastDay ?? null, buyersByDate: g.buyersByDate, label: `${g.geo.name}: CPD и спенд по дням` });
    }
  }

  private go(view: string): void {
    ui.view = view;
    savePref('view', view);
    this.draw();
    window.scrollTo(0, 0);
  }

  private firing(results: readonly AlarmResult[]): AlarmResult[] {
    return results.filter((r) => this.enabled[r.id] && r.hits.length > 0);
  }

  // ───────────── Боковое меню ─────────────

  private sidebar(model: DashboardModel | null, results: readonly AlarmResult[]): HTMLElement {
    const item = (view: string, children: (Node | string | null)[]): HTMLElement => {
      const b = h('button', { type: 'button', class: 'nav-item', 'aria-current': ui.view === view ? 'page' : undefined }, ...children);
      b.addEventListener('click', () => this.go(view));
      return b;
    };
    const geoItems = this.geos().map((cfg) => {
      const g = model?.geos.find((x) => x.geo.code === cfg.code);
      const lvl = g ? worst(cpdStatus(g.day, cfg.benchCents).level, cpdStatus(g.month, cfg.benchCents).level) : 'none';
      return item(cfg.code, [h('span', { class: `dot dot-${lvl}`, 'aria-hidden': 'true' }), h('span', { class: 'nav-label' }, cfg.name), g ? h('span', { class: 'nav-meta' }, cpdText(g.month)) : null]);
    });
    const firing = this.firing(results);
    const alarms = item(ALARMS_VIEW, [icon('bell'), h('span', { class: 'nav-label' }, 'Алармы'), firing.length ? h('span', { class: 'counter', 'aria-label': `сработало ${firing.length}` }, String(firing.length)) : null]);
    const settings = h('button', { type: 'button', class: 'nav-item' }, icon('table'), h('span', { class: 'nav-label' }, 'Подключение таблицы'));
    settings.addEventListener('click', () => sendToNative('settings'));

    return h(
      'aside',
      { class: 'side' },
      h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }, 'G'), h('div', {}, h('div', { class: 'brand-name' }, 'Дашборд байеры'), h('div', { class: 'caption' }, 'Команда «Пираньи»'))),
      h('nav', { class: 'nav', 'aria-label': 'Разделы' }, h('div', { class: 'nav-title' }, 'Гео'), ...geoItems, h('div', { class: 'nav-title' }, 'Контроль'), alarms),
      h('div', { class: 'side-foot' }, settings, h('div', { class: 'user' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, 'А'), h('div', {}, h('div', { class: 'user-name' }, 'Алина'), h('div', { class: 'caption' }, 'COO · Glory')))),
    );
  }

  // ───────────── Общие части ─────────────

  private topbar(crumb: string): HTMLElement {
    const updated = this.meta.loading ? 'Обновляю…' : this.meta.savedAt ? `Обновлено в ${timeLabel(this.meta.savedAt, new Date())}` : 'Ещё не обновлялось';
    const refresh = h('button', { type: 'button', class: 'btn btn-primary', disabled: this.meta.loading }, icon('refresh'), this.meta.loading ? 'Обновляю…' : 'Обновить');
    refresh.addEventListener('click', () => sendToNative('refresh'));
    return h(
      'div',
      { class: 'topbar' },
      h('nav', { class: 'crumbs', 'aria-label': 'Путь' }, h('span', {}, 'Пираньи'), h('span', { 'aria-hidden': 'true' }, '/'), h('span', { class: 'crumb-current' }, crumb)),
      h('span', { class: 'caption' }, updated),
      refresh,
    );
  }

  private banners(model: DashboardModel | null): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (!this.meta.configured) {
      const link = h('button', { type: 'button', class: 'link' }, 'Подключить');
      link.addEventListener('click', () => sendToNative('settings'));
      out.push(h('div', { class: 'note note-warn', role: 'status' }, icon('info'), h('span', {}, h('b', {}, 'Таблица не подключена. '), link)));
    }
    const err = this.meta.error ?? this.dataError;
    if (err) out.push(h('div', { class: 'note note-bad', role: 'alert' }, icon('info'), h('span', {}, h('b', {}, 'Не удалось обновить. '), err)));
    if (model?.partial) {
      const p = model.partial;
      out.push(h('div', { class: 'note note-warn', role: 'status' }, icon('info'), h('span', {}, h('b', {}, `${dayMedium(p.date)} внесли ${p.entered} из ${p.expected} байеров`), ' — цифры за вчера неполные.')));
    }
    return out;
  }

  // ───────────── Экран гео ─────────────

  private benchControl(cfg: GeoConfig): HTMLElement {
    const def = GEOS.find((g) => g.code === cfg.code)?.benchCents ?? null;
    const cur = cfg.benchCents;
    const input = h('input', {
      id: 'bench',
      type: 'number',
      step: '0.5',
      min: '0.5',
      inputmode: 'decimal',
      placeholder: '—',
      value: cur === null ? '' : String(cur / 100),
    });
    const commit = (cents: number | null): void => {
      const next = { ...this.benches };
      if (cents === null || cents === def) delete next[cfg.code];
      else next[cfg.code] = cents;
      this.benches = next;
      savePref('benches', JSON.stringify(next));
      sendToNative({ type: 'setBenches', benches: next });
      this.draw();
      this.root.querySelector<HTMLInputElement>('#bench')?.focus();
    };
    input.addEventListener('change', () => {
      const v = parseFloat(input.value.replace(',', '.'));
      if (Number.isFinite(v) && v > 0) commit(Math.round(v * 100));
    });
    const stepBtn = (d: number, label: string, text: string): HTMLElement => {
      const b = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': label }, text);
      b.addEventListener('click', () => commit(Math.max(BENCH_STEP_CENTS, (cur ?? 2000) + d)));
      return b;
    };
    const changed = cur !== def;
    let reset: HTMLElement | null = null;
    if (changed) {
      reset = h('button', { type: 'button', class: 'link caption-link' }, def === null ? 'Убрать бенч' : `Вернуть ${money2(def)}`);
      reset.addEventListener('click', () => commit(def));
    }
    return h(
      'div',
      { class: 'bench' },
      h('div', { class: 'bench-main' }, h('label', { for: 'bench', class: 'caption' }, 'Бенч CPD, $'), h('div', { class: 'bench-row' }, stepBtn(-BENCH_STEP_CENTS, 'Уменьшить бенч на 50 центов', '−'), input, stepBtn(BENCH_STEP_CENTS, 'Увеличить бенч на 50 центов', '+'))),
      h('div', { class: 'bench-side' }, h('span', { class: 'caption' }, cur === null ? 'Бенч не задан' : `У границы от ${money2(Math.round((cur * 95) / 100))}`), reset),
    );
  }

  private geoView(model: DashboardModel | null, results: readonly AlarmResult[]): HTMLElement {
    const cfg = this.geos().find((x) => x.code === ui.view) ?? this.geos()[0];
    const page = h('div', { class: 'page' }, this.topbar(cfg?.name ?? 'Гео'));
    if (!cfg) return page;
    page.append(
      h('div', { class: 'title-row' }, h('div', { class: 'title' }, h('h1', {}, cfg.name), h('span', { class: 'sub' }, model?.dataThrough ? `Последние данные — ${dayMedium(model.dataThrough)}` : 'Данных за месяц нет')), this.benchControl(cfg)),
      ...this.banners(model),
    );
    const g = model?.geos.find((x) => x.geo.code === cfg.code);
    if (!model || !g) {
      page.append(h('p', { class: 'muted' }, this.emptyText()));
      return page;
    }
    const geoHits = this.firing(results).flatMap((r) => r.hits.filter((x) => x.geo === cfg.code).map((x) => ({ r, x })));
    const insight = this.insight(g, geoHits);
    if (insight) page.append(insight);
    page.append(this.cards(g, model), this.chartAndAlarms(g, geoHits), this.buyers(g, model));
    return page;
  }

  private insight(g: GeoSummary, hits: { r: AlarmResult; x: { buyer?: string; text: string } }[]): HTMLElement | null {
    const leadHit = hits.find((x) => x.r.id === 'lead_not_stopped');
    const lead = leadHit ? g.buyers.find((b) => b.buyer === leadHit.x.buyer) : undefined;
    const top = g.buyers.find((b) => b.overpayCents > 0);
    const head = lead
      ? `${lead.buyer}: ${money0(lead.day.spendCents)} по ${cpdText(lead.day)} — вопрос к лиду.`
      : top
        ? `${top.buyer} переплатил ${money0(top.overpayCents)} сверх бенча за месяц.`
        : 'Все байеры в бенче.';
    const tail = lead && top ? `За месяц больше всех переплатил ${top.buyer} — ${money0(top.overpayCents)}.` : '';
    return h('div', { class: 'insight' }, icon('sparkle'), h('span', {}, h('b', {}, head), tail ? ' ' + tail : ''));
  }

  private kpi(label: string, value: string, valueClass: string, sub: (Node | string)[]): HTMLElement {
    return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('span', { class: `kpi-value ${valueClass}` }, value), h('span', { class: 'kpi-sub' }, ...sub));
  }

  private cards(g: GeoSummary, model: DashboardModel): HTMLElement {
    const bench = g.geo.benchCents;
    const dSt = cpdStatus(g.day, bench).level;
    const mSt = cpdStatus(g.month, bench).level;
    const room = g.headroomCents;
    const yesterday = h(
      'article',
      { class: 'card card-hero' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Вчера'), h('span', { class: 'muted' }, dayMedium(model.lastDay))),
      h(
        'div',
        { class: 'card-cols' },
        ...(model.hasDayData && (g.day.spendCents > 0 || g.day.ftd > 0)
          ? [
              this.kpi('CPD гео', cpdText(g.day), levelClass(dSt), [h('b', { class: levelClass(dSt) }, deltaText(g.day, bench)), ` · ${int(g.day.ftd)} FTD`]),
              this.kpi('Спенд гео', money2(g.day.spendCents), '', [vsAvg(g.day.spendCents, g.avg7?.spendCents)]),
            ]
          : [this.kpi('CPD гео', '—', 'st-none', ['Данных нет']), this.kpi('Спенд гео', '—', 'st-none', ['Данных нет'])]),
      ),
    );
    const month = h(
      'article',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Месяц · ${monthName(model.month).toLowerCase()} ${model.month?.slice(0, 4) ?? ''}`), h('span', { class: 'muted' }, model.dataThrough ? rangeShort(`${model.month}-01`, model.dataThrough) : 'данных нет')),
      h(
        'div',
        { class: 'card-cols' },
        this.kpi('CPD гео', cpdText(g.month), levelClass(mSt), [h('b', { class: levelClass(mSt) }, deltaText(g.month, bench)), ` · ${int(g.month.ftd)} FTD`]),
        this.kpi('Спенд гео', g.month.spendCents ? money2(g.month.spendCents) : '—', g.month.spendCents ? '' : 'st-none', room === null ? ['Бенч не задан'] : [room >= 0 ? 'Запас до бенча ' : 'Перерасход ', h('b', { class: room >= 0 ? 'st-ok' : 'st-bad' }, money0(Math.abs(room)))]),
      ),
    );
    return h('section', { class: 'cards', 'aria-label': 'Вчера и месяц' }, yesterday, month);
  }

  private chartAndAlarms(g: GeoSummary, hits: { r: AlarmResult; x: { buyer?: string; text: string } }[]): HTMLElement {
    const bench = g.geo.benchCents;
    const over = g.daily.filter((d) => d.cpdCents === null || (bench !== null && d.cpdCents > bench));
    const overSpend = sumLines(over).spendCents;
    const chart = h(
      'section',
      { class: 'chart-block', 'aria-labelledby': 'chart-h' },
      h(
        'div',
        { class: 'block-head' },
        h('h2', { id: 'chart-h' }, 'Объём и CPD по дням'),
        h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'sw sw-ok' }), 'в бенче'), h('span', {}, h('i', { class: 'sw sw-bad' }), 'выше бенча'), bench !== null ? h('span', {}, h('i', { class: 'sw-line' }), `бенч ${money2(bench)}`) : null),
      ),
      h(
        'div',
        { class: 'chart-sum' },
        h('span', {}, 'Спенд ', h('b', {}, money2(g.month.spendCents))),
        h('span', {}, 'Выше бенча ', h('b', { class: over.length ? 'st-bad' : 'st-ok' }, over.length ? `${over.length} дн. · ${money2(overSpend)}` : '0 дней')),
      ),
      h('div', { 'data-chart': g.geo.code }),
    );

    const list = h('section', { class: 'alarms-block', 'aria-labelledby': 'alarms-h' });
    const all = h('button', { type: 'button', class: 'link caption-link' }, 'Все алармы →');
    all.addEventListener('click', () => this.go(ALARMS_VIEW));
    list.append(h('div', { class: 'block-head' }, h('h2', { id: 'alarms-h' }, 'Алармы'), all));
    if (!hits.length) list.append(h('div', { class: 'note note-ok' }, 'Сейчас ничего не горит.'));
    for (const { r, x } of hits) {
      list.append(
        h(
          'article',
          { class: 'alarm-mini' },
          h('div', { class: 'alarm-mini-head' }, h('span', { class: `dot dot-${r.severity === 'red' ? 'bad' : 'warn'}`, 'aria-hidden': 'true' }), h('span', {}, r.title)),
          h('span', { class: 'muted' }, x.buyer ? h('b', { class: 'alarm-who' }, x.buyer) : null, ' ', shortHit(x.text)),
        ),
      );
    }
    return h('div', { class: 'split' }, chart, list);
  }

  private buyers(g: GeoSummary, model: DashboardModel): HTMLElement {
    const bench = g.geo.benchCents;
    const th = (text: string, cls = ''): HTMLElement => h('th', { scope: 'col', class: cls }, text);
    const head = h(
      'thead',
      {},
      h('tr', {}, h('th', { scope: 'col', rowspan: 2 }, 'Байер'), h('th', { scope: 'col', rowspan: 2 }, 'Статус'), h('th', { scope: 'colgroup', colspan: 3, class: 'grp' }, `Вчера · ${dayMedium(model.lastDay)}`), h('th', { scope: 'colgroup', colspan: 5, class: 'grp' }, monthName(model.month)), h('th', { scope: 'col', rowspan: 2, class: 'sep' }, 'Спенд 7 дней')),
      h('tr', {}, th('Спенд', 'num sep'), th('FTD', 'num'), th('CPD', 'num'), th('Спенд', 'num sep'), th('Доля', 'num'), th('CPD', 'num'), th('Reg→FTD', 'num'), th('Переплата', 'num')),
    );
    const body = h('tbody');
    for (const b of g.buyers) body.append(this.buyerRow(b, bench));
    const dT = sumLines(g.buyers.map((b) => b.day));
    const mT = sumLines(g.buyers.map((b) => b.month));
    const overT = g.buyers.reduce((a, b) => a + b.overpayCents, 0);
    body.append(
      h(
        'tr',
        { class: 'total' },
        h('th', { scope: 'row' }, 'Итого гео'),
        h('td'),
        h('td', { class: 'num sep' }, money0(dT.spendCents)),
        h('td', { class: 'num' }, int(dT.ftd)),
        h('td', { class: 'num' }, cpdText(dT)),
        h('td', { class: 'num sep' }, money0(mT.spendCents)),
        h('td', { class: 'num muted' }, '100%'),
        h('td', { class: 'num' }, cpdText(mT)),
        h('td', { class: 'num muted' }, mT.regs ? pct((mT.ftd * 100) / mT.regs) : '—'),
        h('td', { class: `num ${overT ? 'st-bad' : ''}` }, overT ? money0(overT) : '—'),
        h('td', { class: 'sep' }),
      ),
    );
    return h(
      'section',
      { class: 'buyers', 'aria-labelledby': 'buyers-h' },
      h('div', { class: 'block-head' }, h('h2', { id: 'buyers-h' }, 'Байеры'), h('span', { class: 'caption' }, 'по переплате за месяц')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, head, body)),
      this.notes(),
    );
  }

  private buyerRow(b: BuyerSummary, bench: number | null): HTMLElement {
    const active = b.day.spendCents > 0 || b.day.ftd > 0;
    const st = cpdStatus(active ? b.day : b.month, bench);
    const stText = !active && b.month.spendCents === 0 ? 'Не лил' : active ? st.text : `${st.text} · мес`;
    const overD = active && cpdStatus(b.day, bench).level === 'bad';
    const overM = cpdStatus(b.month, bench).level === 'bad';
    const maxS = Math.max(1, ...b.last7.map((x) => x.spendCents));
    const spark = h(
      'div',
      { class: 'spark', role: 'img', 'aria-label': `${b.buyer}: спенд за 7 дней, красным — выше бенча` },
      ...b.last7.map((x) => {
        const cls = x.spendCents === 0 ? 'none' : cpdStatus(x, bench).level === 'bad' ? 'bad' : 'ok';
        return h('span', { class: `spark-${cls}`, style: `height:${x.spendCents ? Math.max(2, Math.round((x.spendCents / maxS) * 22)) : 1}px`, title: `${dayMedium(x.date)}: ${x.spendCents ? `${money0(x.spendCents)}, CPD ${cpdText(x)}` : 'не лил'}` });
      }),
    );
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, b.buyer),
      h('td', {}, h('span', { class: `chip chip-${st.level}` }, h('i', { 'aria-hidden': 'true' }), stText)),
      h('td', { class: `num sep ${active ? '' : 'muted'}` }, active ? money0(b.day.spendCents) : '—'),
      h('td', { class: `num ${active ? '' : 'muted'}` }, active ? int(b.day.ftd) : '—'),
      h('td', { class: `num ${overD ? 'st-bad strong' : active ? '' : 'muted'}` }, active ? cpdText(b.day) : '—'),
      h('td', { class: 'num sep' }, money0(b.month.spendCents)),
      h('td', { class: 'num muted' }, pct(b.shareBp / 100)),
      h('td', { class: `num ${overM ? 'st-bad strong' : ''}` }, cpdText(b.month)),
      h('td', { class: 'num muted' }, b.month.regs ? pct((b.month.ftd * 100) / b.month.regs) : '—'),
      h('td', { class: `num ${b.overpayCents ? 'st-bad strong' : 'muted'}` }, b.overpayCents ? money0(b.overpayCents) : '—'),
      h('td', { class: 'sep' }, spark),
    );
  }

  private notes(): HTMLElement {
    return h(
      'details',
      { class: 'notes' },
      h('summary', {}, 'Как считается'),
      h(
        'ul',
        {},
        h('li', {}, 'Спенд — чистый спенд Facebook без комиссий. CPD = спенд / FTD, только внутри гео.'),
        h('li', {}, '«Вчера» — вчерашний день по Москве; если его ещё не внесли — прочерки. Месяц — накопительно с 1-го числа, растёт по мере внесения данных.'),
        h('li', {}, 'Переплата = спенд − бенч × FTD за месяц. Запас до бенча = бенч × FTD − спенд.'),
        h('li', {}, 'Reg→FTD = FTD / регистрации. «У границы» — CPD от 95% до 100% бенча.'),
        h('li', {}, 'Бенч меняется сверху справа и сохраняется в приложении; весь экран и алармы пересчитываются.'),
      ),
    );
  }

  private emptyText(): string {
    if (this.dataError) return 'Данные не загружены.';
    if (!this.meta.configured) return 'Подключите таблицу, чтобы увидеть цифры.';
    return this.meta.loading ? 'Загружаю данные из таблицы…' : 'Данных пока нет.';
  }

  // ───────────── Экран алармов ─────────────

  private setEnabled(next: Record<string, boolean>): void {
    this.enabled = resolveEnabled(next);
    savePref('alarms', JSON.stringify(this.enabled));
    sendToNative({ type: 'setAlarms', alarms: this.enabled });
    this.draw();
  }

  private alarmsView(model: DashboardModel | null, results: readonly AlarmResult[]): HTMLElement {
    const firing = this.firing(results);
    const onCount = ALARM_DEFS.filter((d) => this.enabled[d.id]).length;
    const allOn = h('button', { type: 'button', class: 'btn' }, 'Включить все');
    allOn.addEventListener('click', () => this.setEnabled(Object.fromEntries(ALARM_DEFS.map((d) => [d.id, true]))));
    const allOff = h('button', { type: 'button', class: 'btn' }, 'Выключить все');
    allOff.addEventListener('click', () => this.setEnabled(Object.fromEntries(ALARM_DEFS.map((d) => [d.id, false]))));

    const page = h(
      'div',
      { class: 'page' },
      this.topbar('Алармы'),
      h(
        'div',
        { class: 'title-row' },
        h('div', { class: 'title' }, h('h1', {}, 'Алармы'), h('span', { class: 'sub' }, model ? `За ${dayMedium(model.lastDay)} · включено ${onCount} из ${ALARM_DEFS.length} · сработало ${firing.length}` : 'Нет данных для проверки')),
        h('div', { class: 'head-actions' }, allOn, allOff),
      ),
      ...this.banners(model),
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const group of SEVERITY_GROUPS) {
      const defs = ALARM_DEFS.filter((d) => d.severity === group.severity);
      page.append(
        h(
          'section',
          { class: 'alarm-group' },
          h('h2', {}, h('span', { class: `sev sev-${group.severity}`, 'aria-hidden': 'true' }), group.title, h('span', { class: 'caption' }, ` · ${group.hint}`)),
          ...defs.map((d) => this.alarmCard(d.id, byId.get(d.id), model !== null)),
        ),
      );
    }
    return page;
  }

  private alarmCard(id: string, result: AlarmResult | undefined, hasData: boolean): HTMLElement {
    const def = result ?? ALARM_DEFS.find((d) => d.id === id);
    if (!def) return h('div');
    const on = this.enabled[id] ?? true;
    const hits = result?.hits ?? [];
    const toggle = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': `${def.title}: ${on ? 'включён' : 'выключен'}` }, h('span', { class: 'switch-knob' }));
    toggle.addEventListener('click', () => this.setEnabled({ ...this.enabled, [id]: !on }));

    let status: HTMLElement;
    if (!on) status = h('p', { class: 'alarm-status muted' }, 'Выключен');
    else if (!hasData) status = h('p', { class: 'alarm-status muted' }, 'Нет данных');
    else if (!hits.length) status = h('p', { class: 'alarm-status st-ok' }, 'Не срабатывает');
    else status = h('ul', { class: `alarm-hits hits-${def.severity}` }, ...hits.map((x) => h('li', {}, x.text)));

    const fired = on && hits.length > 0;
    return h(
      'article',
      { class: `alarm ${on ? '' : 'alarm-off'} ${fired ? `alarm-fired alarm-${def.severity}` : ''}` },
      h('div', { class: 'alarm-main' }, h('div', { class: 'alarm-title' }, def.title, fired ? h('span', { class: `counter counter-${def.severity}` }, String(hits.length)) : null), h('p', { class: 'caption' }, def.condition), status),
      toggle,
    );
  }
}
