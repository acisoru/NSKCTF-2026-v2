const ledgerList = document.getElementById('ledger-list');
const overviewLedgerList = document.getElementById('overview-ledger-list');
const ledgerFilter = document.getElementById('ledger-filter');
const evidenceForm = document.getElementById('evidence-form');
const evidencePayload = document.getElementById('evidence-payload');
const evidenceStatus = document.getElementById('evidence-status');
const reviewButton = document.getElementById('review-button');
const plateId = document.getElementById('plate-id');
const reviewState = document.getElementById('review-state');
const telemetryList = document.getElementById('telemetry-list');
const telemetryCount = document.getElementById('telemetry-count');
const telemetryRefresh = document.getElementById('telemetry-refresh');
const archiveForm = document.getElementById('archive-form');
const archiveToken = document.getElementById('archive-token');
const archiveStatus = document.getElementById('archive-status');
const archiveResult = document.getElementById('archive-result');

let currentPlate = null;
let savedCss = '';
let ledgerEntries = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status})`);
  return data;
}

function status(element, message, kind = '') {
  element.textContent = message;
  element.classList.remove('error', 'success');
  if (kind) element.classList.add(kind);
}

function create(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}

function entryElements(entries) {
  return entries.map(entry => {
      const article = create('article', 'ledger-entry');
      const label = create('span', 'entry-index', entry.id);
      const body = create('div');
      body.append(create('strong', '', entry.title), create('small', '', `${entry.date} · ${entry.summary}`));
      article.append(label, body);
      return article;
  });
}

function renderLedger() {
  const query = ledgerFilter.value.trim().toLowerCase();
  const entries = ledgerEntries.filter(entry => `${entry.id} ${entry.title} ${entry.date} ${entry.summary}`.toLowerCase().includes(query));
  ledgerList.replaceChildren(...(entries.length ? entryElements(entries) : [create('p', 'empty-state', query ? 'Совпадений нет.' : 'Записей пока нет.')]));
  overviewLedgerList.replaceChildren(...(ledgerEntries.length ? entryElements(ledgerEntries.slice(0, 3)) : [create('p', 'empty-state', 'Записей пока нет.')]));
}

async function loadLedger() {
  try {
    const { entries } = await api('/api/ledger');
    ledgerEntries = entries;
    renderLedger();
  } catch {
    ledgerList.replaceChildren(create('p', 'empty-state', 'Нет связи с архивом.'));
    overviewLedgerList.replaceChildren(create('p', 'empty-state', 'Нет связи с архивом.'));
  }
}
ledgerFilter.addEventListener('input', renderLedger);

async function savePlate() {
  const css = evidencePayload.value;
  if (!css.trim()) throw new Error('Сначала введите CSS для калибровки.');
  if (css.length > 16000) throw new Error('Размер CSS превышает 16 КБ.');
  if (currentPlate && css === savedCss) return currentPlate;
  const plate = await api('/api/plates', { method: 'POST', body: JSON.stringify({ css }) });
  currentPlate = plate.id;
  savedCss = css;
  plateId.textContent = plate.id.slice(0, 8);
  reviewState.textContent = 'Сохранён';
  renderTelemetry([]);
  status(evidenceStatus, `Оттиск ${plate.id.slice(0, 8)} сохранён. Можно отправлять на служебную проверку.`, 'success');
  return currentPlate;
}

evidenceForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await savePlate();
  } catch (error) {
    status(evidenceStatus, error.message, 'error');
  }
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderTelemetry(hits) {
  const count = hits.length;
  const form = count % 10 === 1 && count % 100 !== 11 ? 'запрос' :
    count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'запроса' : 'запросов';
  telemetryCount.textContent = `${count} ${form}`;
  if (!hits.length) {
    telemetryList.replaceChildren(create('div', 'empty-state', 'Запросов пока нет.'));
    return;
  }
  telemetryList.replaceChildren(...hits.map(hit => {
    const row = create('div', 'telemetry-entry');
    const time = create('time', '', new Date(hit.at).toLocaleTimeString('ru-RU'));
    const probe = create('code', '', hit.probe);
    row.append(time, probe);
    return row;
  }));
}

async function loadTelemetry() {
  if (!currentPlate) {
    renderTelemetry([]);
    return;
  }
  const { hits } = await api(`/api/plates/${currentPlate}/telemetry`);
  renderTelemetry(hits);
}

telemetryRefresh.addEventListener('click', async () => {
  try {
    await loadTelemetry();
  } catch (error) {
    status(evidenceStatus, error.message, 'error');
  }
});

reviewButton.addEventListener('click', async () => {
  reviewButton.disabled = true;
  try {
    const id = await savePlate();
    await api(`/api/plates/${id}/review`, { method: 'POST', body: '{}' });
    reviewState.textContent = 'В очереди';
    status(evidenceStatus, 'Служебная проверка запущена…');
    for (let attempt = 0; attempt < 65; attempt++) {
      await wait(450);
      const plate = await api(`/api/plates/${id}`);
      if (plate.status === 'reviewing') reviewState.textContent = 'Проверяется';
      if (plate.status === 'complete') {
        await loadTelemetry();
        reviewState.textContent = 'Готово';
        status(evidenceStatus, `Оттиск ${plate.id.slice(0, 8)} проверен. Журнал запросов обновлён.`, 'success');
        return;
      }
      if (plate.status === 'error') throw new Error(plate.error || 'Пост проверки не ответил.');
    }
    throw new Error('Время проверки истекло. Обновите журнал запросов позже.');
  } catch (error) {
    reviewState.textContent = 'Ошибка';
    status(evidenceStatus, error.message, 'error');
  } finally {
    reviewButton.disabled = false;
  }
});

archiveForm.addEventListener('submit', async event => {
  event.preventDefault();
  const key = archiveToken.value.trim();
  if (!key) {
    status(archiveStatus, 'Введите ключ доступа.', 'error');
    return;
  }
  try {
    status(archiveStatus, 'Проверка ключа…');
    const result = await api(`/api/archive?key=${encodeURIComponent(key)}`);
    archiveResult.replaceChildren(
      create('strong', '', 'Запись открыта'),
      create('p', '', result.flag),
      create('p', '', result.clue)
    );
    archiveResult.hidden = false;
    status(archiveStatus, 'Доступ разрешён.', 'success');
  } catch (error) {
    archiveResult.hidden = true;
    status(archiveStatus, error.message, 'error');
  }
});

loadLedger();
