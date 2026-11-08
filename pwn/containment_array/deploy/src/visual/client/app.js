const output = document.getElementById('terminal-output');
const connectionStatus = document.getElementById('connection-status');
const selectedSensorOutput = document.getElementById('selected-sensor');
const sensorList = document.getElementById('sensor-list');
const commandForm = document.getElementById('command-form');
const commandInput = document.getElementById('command-input');
const channelInput = document.getElementById('channel-index');
const calLengthInput = document.getElementById('cal-length');
const frameStatus = document.getElementById('frame-status');
const hexForm = document.getElementById('hex-form');
const hexInput = document.getElementById('hex-input');
const nativeHost = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
document.getElementById('native-address').textContent = `${nativeHost}:34120`;
document.getElementById('direct-command').textContent = `nc ${nativeHost} 34120`;
let socket;
let activeSensor = -1;
let responseTail = '';
let pendingFrameLength = null;
let nativeDecoder = new TextDecoder('utf-8', { fatal: false });

function append(value) {
  output.textContent += value;
  if (output.textContent.length > 45_000) output.textContent = output.textContent.slice(-30_000);
  output.scrollTop = output.scrollHeight;
}

function setConnection(value) {
  const labels = {
    connecting: 'Подключение', connected: 'Подключено', disconnected: 'Отключено',
    'link failure': 'Ошибка связи', 'native offline': 'Нативный сервис недоступен',
    'session closed': 'Сеанс закрыт', 'invalid command frame': 'Некорректная команда'
  };
  connectionStatus.textContent = labels[value] || value;
  connectionStatus.dataset.state = value;
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return nativeDecoder.decode(bytes, { stream: true });
}

function recordReadings(chunk) {
  const text = responseTail + chunk;
  for (const match of text.matchAll(/КАНАЛ\s+(\d{2})\s*=\s*([0-9a-fA-F]{16})/g)) {
    const index = Number(match[1]);
    const reading = sensorList.querySelector(`tr[data-index="${index}"] .sensor-reading`);
    if (reading) reading.textContent = match[2].toLowerCase();
  }
  responseTail = text.slice(-90);
}

function connect() {
  if (socket) socket.close();
  output.textContent = '';
  responseTail = '';
  pendingFrameLength = null;
  nativeDecoder = new TextDecoder('utf-8', { fatal: false });
  frameStatus.textContent = 'Нет ожидающего кадра';
  hexForm.hidden = true;
  sensorList.querySelectorAll('.sensor-reading').forEach(cell => { cell.textContent = '—'; });
  setConnection('connecting');
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const next = new WebSocket(`${scheme}//${location.host}/socket`);
  socket = next;
  next.addEventListener('message', event => {
    if (socket !== next) return;
    const message = JSON.parse(event.data);
    if (message.type === 'status') {
      setConnection(message.value);
      if (message.value !== 'connected') append(`\n[ ${connectionStatus.textContent.toUpperCase()} ]\n`);
    } else if (message.type === 'data') {
      const chunk = decodeBase64(message.base64);
      const combined = responseTail + chunk;
      append(chunk);
      recordReadings(chunk);
      if (combined.includes('КАЛИБРОВКА ПРИНЯТА')) {
        pendingFrameLength = null;
        frameStatus.textContent = 'Кадр принят';
      }
    }
  });
  next.addEventListener('close', () => { if (socket === next) setConnection('disconnected'); });
  next.addEventListener('error', () => { if (socket === next) setConnection('link failure'); });
}

function send(type, data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    append('\n[ НЕТ СВЯЗИ — ПЕРЕПОДКЛЮЧИТЕСЬ ]\n');
    return false;
  }
  socket.send(JSON.stringify({ type, data }));
  return true;
}

function prepareFrame(length) {
  if (!Number.isInteger(length) || length < 1 || length > 512) {
    frameStatus.textContent = 'Длина должна быть от 1 до 512 байт';
    return;
  }
  if (!send('line', `CAL ${length}`)) return;
  pendingFrameLength = length;
  frameStatus.textContent = `Ожидание ${length} байт`;
  hexForm.hidden = false;
  hexInput.focus();
}

function activateSensor(index, fromScene = false) {
  activeSensor = index;
  selectedSensorOutput.textContent = `Датчик ${String(index + 1).padStart(2, '0')} · канал ${String(index).padStart(2, '0')}`;
  sensorList.querySelectorAll('tr[data-index]').forEach(row => {
    row.classList.toggle('selected', Number(row.dataset.index) === index);
  });
  channelInput.value = index;
  if (!fromScene) window.arrayVisual?.selectSensor(index);
  if (fromScene || !window.arrayVisual) send('line', `VIEW ${index}`);
}

for (let i = 0; i < 8; i++) {
  const row = document.createElement('tr');
  row.dataset.index = String(i);
  const channelCell = document.createElement('td');
  channelCell.className = 'sensor-id';
  channelCell.textContent = String(i).padStart(2, '0');
  const nameCell = document.createElement('td');
  nameCell.textContent = `Датчик ${String(i + 1).padStart(2, '0')}`;
  const readingCell = document.createElement('td');
  readingCell.className = 'sensor-reading';
  readingCell.textContent = '—';
  const actionCell = document.createElement('td');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sensor-button';
  button.textContent = 'Читать';
  button.setAttribute('aria-label', `Читать датчик ${i + 1}, канал ${i}`);
  button.addEventListener('click', () => activateSensor(i));
  actionCell.append(button);
  row.append(channelCell, nameCell, readingCell, actionCell);
  sensorList.append(row);
}

document.addEventListener('array:sensor', event => {
  const index = event.detail?.index;
  if (Number.isInteger(index) && index >= 0 && index < 8) activateSensor(index, true);
});

document.getElementById('reconnect').addEventListener('click', connect);
document.getElementById('clear-output').addEventListener('click', () => { output.textContent = ''; });
document.getElementById('view-reset').addEventListener('click', () => window.arrayVisual?.resetView());
commandForm.addEventListener('submit', event => {
  event.preventDefault();
  const command = commandInput.value.trim();
  if (!command) return;
  const calibration = /^CAL\s+(\d+)$/i.exec(command);
  if (calibration) prepareFrame(Number(calibration[1]));
  else send('line', command);
  commandInput.value = '';
});
document.getElementById('send-view').addEventListener('click', () => {
  const index = Number(channelInput.value);
  if (!Number.isInteger(index) || index < 0 || index > 31) {
    append('\n[ НОМЕР КАНАЛА ДОЛЖЕН БЫТЬ ОТ 0 ДО 31 ]\n');
    return;
  }
  if (index < 8) activateSensor(index);
  else send('line', `VIEW ${index}`);
});
document.getElementById('prepare-cal').addEventListener('click', () => prepareFrame(Number(calLengthInput.value)));
document.getElementById('open-hex').addEventListener('click', () => {
  hexForm.hidden = !hexForm.hidden;
  if (!hexForm.hidden) hexInput.focus();
});
hexForm.addEventListener('submit', event => {
  event.preventDefault();
  const value = hexInput.value.replace(/\s+/g, '');
  if (!value || value.length % 2 || /[^0-9a-f]/i.test(value)) {
    append('\n[ ВВЕДИТЕ ЧЁТНОЕ ЧИСЛО ШЕСТНАДЦАТЕРИЧНЫХ ЦИФР ]\n');
    return;
  }
  if (pendingFrameLength !== null && value.length / 2 !== pendingFrameLength) {
    frameStatus.textContent = `Ожидалось ${pendingFrameLength} байт, получено ${value.length / 2}`;
    return;
  }
  if (!send('hex', value)) return;
  frameStatus.textContent = `Передано ${value.length / 2} байт`;
  hexInput.value = '';
});

connect();
