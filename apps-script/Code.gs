/**
 * Glory · «Пираньи» — источник данных для Mac-дашборда.
 *
 * Скрипт живёт внутри таблицы команды (Расширения → Apps Script) и отдаёт
 * строки листов BUYER1…BUYER10 в JSON. Доступ только по секретному ключу.
 *
 * Установка — docs/setup-google-sheet.md. Коротко:
 *   1. Вставить этот файл в редактор Apps Script таблицы.
 *   2. Запустить функцию setup() и скопировать ключ из журнала выполнения.
 *   3. Развернуть → Новое развёртывание → Веб-приложение:
 *      «Выполнять от имени: меня», «Доступ: все». Скопировать ссылку /exec.
 *   4. Вставить ссылку и ключ в настройки приложения.
 *
 * Контракт ответа — docs/data-contract.md.
 */

var CONFIG = {
  /** Листы байеров. Имя листа = идентификатор байера в дашборде. */
  BUYER_SHEET_PATTERN: /^BUYER\d+$/,
  /** Строка с заголовками блоков гео вида «BUYER1 - AR». */
  HEADER_ROW: 1,
  /** Первая строка с данными по дням. */
  FIRST_DATA_ROW: 4,
  /** Колонка с датой (1 = A, 2 = B). */
  DATE_COL: 2,
  /** Сколько прошлых месяцев отдавать помимо текущего. */
  MONTHS_BACK: 1,
};

/** Точка входа веб-приложения: GET …/exec?key=<секрет>. */
function doGet(e) {
  try {
    var key = (e && e.parameter && e.parameter.key) || '';
    var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!expected) return json_({ ok: false, error: 'not_configured' });
    if (!safeEqual_(String(key), expected)) return json_({ ok: false, error: 'unauthorized' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return json_({
      ok: true,
      version: 1,
      generatedAt: new Date().toISOString(),
      spreadsheet: ss.getName(),
      timezone: ss.getSpreadsheetTimeZone(),
      rows: collectRows_(ss),
    });
  } catch (err) {
    return json_({ ok: false, error: 'internal', message: String((err && err.message) || err) });
  }
}

/** Запустить один раз из редактора: создаёт секретный ключ и печатает его в журнал. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_KEY', key);
  }
  Logger.log('Секретный ключ для приложения: ' + key);
}

/** Выпустить новый ключ (старый перестанет работать). */
function rotateKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  setup();
}

/** Проверка из редактора: сколько строк увидит приложение. */
function preview() {
  var rows = collectRows_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Строк: ' + rows.length);
  Logger.log(JSON.stringify(rows.slice(-5), null, 2));
}

function collectRows_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var from = new Date(now.getFullYear(), now.getMonth() - CONFIG.MONTHS_BACK, 1);
  var fromIso = Utilities.formatDate(from, tz, 'yyyy-MM-dd');
  var out = [];

  ss.getSheets().forEach(function (sheet) {
    var buyer = sheet.getName();
    if (!CONFIG.BUYER_SHEET_PATTERN.test(buyer)) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.FIRST_DATA_ROW || lastCol < CONFIG.DATE_COL) return;

    var header = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
    var blocks = [];
    header.forEach(function (title, i) {
      var m = /-\s*([A-Za-z0-9]+)\s*$/.exec(String(title));
      if (m) blocks.push({ geo: m[1].toUpperCase(), col: i });
    });
    if (!blocks.length) return;

    var values = sheet
      .getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, lastCol)
      .getValues();

    values.forEach(function (r) {
      var d = r[CONFIG.DATE_COL - 1];
      if (!(d instanceof Date)) return;
      var iso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      if (iso < fromIso) return;
      blocks.forEach(function (b) {
        // Блок: Click, Reg, FD, Spend, Dep, CPC, CPR, CPD
        var ftd = num_(r[b.col + 2]);
        var spend = num_(r[b.col + 3]);
        if (spend <= 0 && ftd <= 0) return;
        out.push({
          buyer: buyer,
          date: iso,
          geo: b.geo,
          clicks: Math.round(num_(r[b.col])),
          regs: Math.round(num_(r[b.col + 1])),
          ftd: Math.round(ftd),
          spend: Math.round(spend * 100) / 100,
        });
      });
    });
  });
  return out;
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(String(v).replace(/[\s$]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
