"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const state = { session: null, layer: "all", busy: false, booting: false, cooldownUntil: 0, regenerateUntil: 0, imageRequest: 0, history: [], pending: null };
  const routeInput = byId("route-input");
  const canvas = byId("map-canvas");
  const timeFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  let toastTimer;
  let storageWarning = false;

  function toast(message) {
    byId("toast").textContent = message;
    byId("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { byId("toast").hidden = true; }, 3200);
  }

  function readStorage(key, fallback = "") {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); return true; } catch {
      if (!storageWarning) { toast("Браузер не разрешает сохранять черновик. Скопируй нужные записи перед закрытием"); storageWarning = true; }
      return false;
    }
  }

  function removeStorage(key) {
    try { localStorage.removeItem(key); } catch { return; }
  }

  function storageKey(kind) {
    return `nightline:${kind}:${state.session.puzzle_id}`;
  }

  function storedJson(key, fallback) {
    try { return JSON.parse(readStorage(key, "null")) ?? fallback; } catch { return fallback; }
  }

  function normaliseRoute(value) {
    return value.replace(/[ \t\r\n]/g, "").toUpperCase();
  }

  function plural(value, one, few, many) {
    const last = value % 10;
    return value % 100 >= 11 && value % 100 <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  }

  function connection(status) {
    byId("connection").className = `connection ${status}`;
    byId("connection-label").textContent = status === "online" ? "На связи" : status === "offline" ? "Нет связи" : "Подключение";
  }

  class ApiError extends Error {
    constructor(message, status = 0, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers: { "Content-Type": "application/json", ...(state.session ? { "X-CSRF-Token": state.session.csrf_token } : {}), ...options.headers },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(typeof data.detail === "string" ? data.detail : "Диспетчерская не смогла обработать запрос", response.status, Number(response.headers.get("Retry-After")) || 0);
      connection("online");
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      connection("offline");
      throw new ApiError(error.name === "AbortError" ? "Диспетчерская долго не отвечает. Маршрут сохранён, можно повторить отправку" : "Связь с диспетчерской прервалась. Проверь подключение и попробуй ещё раз");
    } finally { clearTimeout(timer); }
  }

  class RasterMap {
    constructor(element) {
      this.canvas = element;
      this.context = element.getContext("2d");
      this.image = null;
      this.width = 0;
      this.height = 0;
      this.scale = 1;
      this.fitScale = 1;
      this.x = 0;
      this.y = 0;
      this.fitted = true;
      this.annotating = false;
      this.pins = [];
      this.pointers = new Map();
      this.gesture = false;
      this.moved = false;
      this.pointerOrigin = null;
      new ResizeObserver(() => this.resize()).observe(element.parentElement);
      element.addEventListener("wheel", (event) => {
        event.preventDefault();
        const point = this.local(event);
        this.zoom(Math.exp(-event.deltaY * 0.0015), point.x, point.y);
      }, { passive: false });
      element.addEventListener("pointerdown", (event) => this.pointerDown(event));
      element.addEventListener("pointermove", (event) => this.pointerMove(event));
      element.addEventListener("pointerup", (event) => this.pointerUp(event));
      element.addEventListener("pointercancel", (event) => this.pointerUp(event, true));
      element.addEventListener("keydown", (event) => {
        const actions = { "+": () => this.zoom(1.25), "=": () => this.zoom(1.25), "-": () => this.zoom(0.8), "0": () => this.fit(), Home: () => this.fit(), ArrowLeft: () => this.pan(45, 0), ArrowRight: () => this.pan(-45, 0), ArrowUp: () => this.pan(0, 45), ArrowDown: () => this.pan(0, -45), Escape: () => this.setAnnotation(false) };
        if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
      });
    }

    local(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const oldWidth = this.width;
      const oldHeight = this.height;
      this.width = rect.width;
      this.height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (this.image) {
        this.fitScale = Math.min(this.width / this.image.width, this.height / this.image.height) * 0.97;
        if (this.fitted) this.fit();
        else { this.x += (this.width - oldWidth) / 2; this.y += (this.height - oldHeight) / 2; this.draw(); }
      } else this.draw();
    }

    setImage(image, reset) {
      this.image = image;
      this.fitScale = Math.min(this.width / image.width, this.height / image.height) * 0.97;
      if (reset || this.fitted) this.fit(); else this.draw();
    }

    fit() {
      if (!this.image) return;
      this.scale = this.fitScale;
      this.x = this.width / 2;
      this.y = this.height / 2;
      this.fitted = true;
      this.draw();
    }

    zoom(factor, x = this.width / 2, y = this.height / 2) {
      if (!this.image) return;
      const next = Math.max(this.fitScale * 0.7, Math.min(this.fitScale * 6, this.scale * factor));
      const ratio = next / this.scale;
      this.x = x - (x - this.x) * ratio;
      this.y = y - (y - this.y) * ratio;
      this.scale = next;
      this.fitted = false;
      this.constrain();
      this.draw();
    }

    constrain() {
      if (!this.image) return;
      const halfWidth = this.image.width * this.scale / 2;
      const halfHeight = this.image.height * this.scale / 2;
      this.x = Math.max(48 - halfWidth, Math.min(this.width + halfWidth - 48, this.x));
      this.y = Math.max(48 - halfHeight, Math.min(this.height + halfHeight - 48, this.y));
    }

    pan(x, y) {
      if (!this.image) return;
      this.x += x;
      this.y += y;
      this.fitted = false;
      this.constrain();
      this.draw();
    }

    pointerDown(event) {
      if (event.button !== 0 || !this.image) return;
      this.canvas.setPointerCapture(event.pointerId);
      const point = this.local(event);
      this.pointers.set(event.pointerId, point);
      if (this.pointers.size === 1) { this.pointerOrigin = point; this.moved = false; this.gesture = false; }
      else this.gesture = true;
      this.canvas.classList.add("dragging");
    }

    pointerMove(event) {
      if (!this.pointers.has(event.pointerId)) return;
      const next = this.local(event);
      const previous = this.pointers.get(event.pointerId);
      if (this.pointerOrigin && Math.hypot(next.x - this.pointerOrigin.x, next.y - this.pointerOrigin.y) > 5) this.moved = true;
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)[1];
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        const oldCenter = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
        const newCenter = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
        if (before > 3) this.zoom(after / before, oldCenter.x, oldCenter.y);
        this.pan(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y);
      } else if (this.pointers.size === 1) this.pan(next.x - previous.x, next.y - previous.y);
      this.pointers.set(event.pointerId, next);
    }

    pointerUp(event, cancelled = false) {
      if (!this.pointers.has(event.pointerId)) return;
      if (!cancelled && !this.gesture && !this.moved && this.annotating) {
        const point = this.local(event);
        const x = (point.x - this.x) / this.scale + this.image.width / 2;
        const y = (point.y - this.y) / this.scale + this.image.height / 2;
        if (x >= 0 && y >= 0 && x <= this.image.width && y <= this.image.height) {
          const nearest = this.pins.findIndex((pin) => Math.hypot(pin.x - x, pin.y - y) * this.scale < 18);
          if (nearest >= 0) this.pins.splice(nearest, 1);
          else if (this.pins.length < 32) this.pins.push({ x, y });
          else toast("На карте уже 32 пометки. Нажми на существующую, чтобы убрать её");
          writeStorage(storageKey("pins"), JSON.stringify(this.pins));
          this.draw();
        }
      }
      this.pointers.delete(event.pointerId);
      if (!this.pointers.size) this.canvas.classList.remove("dragging");
    }

    setAnnotation(enabled) {
      this.annotating = enabled;
      this.canvas.classList.toggle("annotating", enabled);
      byId("toggle-pins").setAttribute("aria-pressed", String(enabled));
      byId("pin-hint").hidden = !enabled;
    }

    draw() {
      const context = this.context;
      context.clearRect(0, 0, this.width, this.height);
      if (!this.image) return;
      context.save();
      context.translate(this.x, this.y);
      context.scale(this.scale, this.scale);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(this.image, -this.image.width / 2, -this.image.height / 2);
      context.restore();
      this.pins.forEach((pin, index) => {
        const x = this.x + (pin.x - this.image.width / 2) * this.scale;
        const y = this.y + (pin.y - this.image.height / 2) * this.scale;
        context.beginPath();
        context.arc(x, y, 10, 0, Math.PI * 2);
        context.fillStyle = "#f1e5b6";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#2a3223";
        context.stroke();
        context.fillStyle = "#293222";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = "bold 10px monospace";
        context.fillText(String(index + 1), x, y + 0.5);
      });
      byId("zoom-label").textContent = `${Math.round(this.scale / this.fitScale * 100)}%`;
    }
  }

  const map = new RasterMap(canvas);

  function imageLoading(message, failed = false) {
    byId("map-loading").hidden = false;
    byId("map-loading-text").textContent = message;
    byId("map-loading").querySelector(".spinner").hidden = failed;
    byId("retry-map").hidden = !failed;
  }

  function loadMap(layer = "all", reset = false) {
    if (!state.session) return;
    state.layer = layer;
    const request = ++state.imageRequest;
    document.querySelectorAll("[data-layer]").forEach((button) => {
      const selected = button.dataset.layer === layer;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const url = `/api/map/${state.session.puzzle_id}/${layer}.png`;
    byId("download-map").href = `${url}?download=true`;
    byId("download-map").removeAttribute("aria-disabled");
    byId("download-map").removeAttribute("tabindex");
    imageLoading("Загружаем карту");
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (request !== state.imageRequest) return;
      map.setImage(image, reset);
      byId("map-loading").hidden = true;
    };
    image.onerror = () => {
      if (request === state.imageRequest) imageLoading("Не удалось получить карту. Если город открыт в другой вкладке, обнови страницу", true);
    };
    image.src = url;
  }

  function renderHistory() {
    const list = byId("history-list");
    list.replaceChildren();
    byId("history-empty").hidden = state.history.length > 0;
    const attempts = state.session?.attempts || 0;
    byId("attempt-count").textContent = `${attempts} ${plural(attempts, "попытка", "попытки", "попыток")}`;
    state.history.slice(0, 8).forEach((entry) => {
      const item = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = `history-dot${entry.accepted ? " success" : ""}`;
      const main = document.createElement("span");
      main.className = "history-main";
      main.textContent = entry.accepted ? "Маршрут принят" : `Попытка ${entry.attempt}`;
      const detail = document.createElement("small");
      detail.textContent = `${entry.length} ${plural(entry.length, "команда", "команды", "команд")}${entry.accepted ? " · все на складе" : " · требуется другой маршрут"}`;
      main.append(detail);
      const time = document.createElement("time");
      time.className = "history-time";
      time.dateTime = new Date(entry.created_at * 1000).toISOString();
      time.textContent = timeFormat.format(new Date(entry.created_at * 1000));
      item.append(dot, main, time);
      list.append(item);
    });
  }

  function renderSuccess() {
    const solved = Boolean(state.session?.solved);
    byId("success-panel").hidden = !solved;
    byId("route-form").hidden = solved;
    const pill = byId("mission-pill");
    pill.classList.toggle("complete", solved);
    pill.textContent = solved ? "Принят" : "Ожидает отправки";
    if (solved) {
      byId("flag-value").textContent = state.session.flag;
      byId("result-message").hidden = true;
    } else byId("flag-value").textContent = "";
  }

  function updateEditor(save = false) {
    const route = normaliseRoute(routeInput.value);
    const limit = state.session?.max_commands || 128;
    const invalid = /[^RB]/.test(route) || route.length > limit;
    byId("route-length").textContent = String(route.length);
    routeInput.classList.toggle("invalid", invalid);
    routeInput.setAttribute("aria-invalid", String(invalid));
    const error = byId("route-error");
    error.hidden = !invalid;
    error.textContent = route.length > limit ? `В маршруте больше ${limit} команд. Укороти его перед отправкой` : "Разрешены только латинские R и B, пробелы и переносы строк";
    const preview = byId("route-preview");
    preview.replaceChildren();
    if (!route) {
      const placeholder = document.createElement("span");
      placeholder.className = "preview-placeholder";
      placeholder.textContent = "R — красная дорога, B — синяя";
      preview.append(placeholder);
    } else {
      const visibleChips = Math.max(1, Math.min(12, Math.floor((preview.clientWidth - 24) / 23)));
      if (route.length > visibleChips) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "preview-ellipsis";
        ellipsis.textContent = "…";
        preview.append(ellipsis);
      }
      [...route.slice(-visibleChips)].forEach((command) => {
        const chip = document.createElement("span");
        chip.className = `route-chip ${command === "R" ? "red" : "blue"}`;
        chip.textContent = command;
        preview.append(chip);
      });
    }
    const unavailable = !state.session || state.busy || state.session.solved;
    routeInput.disabled = unavailable;
    byId("append-red").disabled = unavailable || route.length >= limit;
    byId("append-blue").disabled = unavailable || route.length >= limit;
    byId("undo-route").disabled = unavailable || !route;
    byId("clear-route").disabled = unavailable || !routeInput.value;
    updateSubmitButton(route);
    if (save && state.session) writeStorage(storageKey("route"), routeInput.value);
  }

  function updateSubmitButton(route = normaliseRoute(routeInput.value)) {
    const limit = state.session?.max_commands || 128;
    const invalid = /[^RB]/.test(route) || route.length > limit;
    const unavailable = !state.session || state.busy || state.session.solved;
    const wait = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
    const disabled = unavailable || !route || invalid || wait > 0;
    const label = state.busy ? "Проверяем маршрут…" : wait > 0 ? `Повторить через ${wait} с` : "Отправить маршрут";
    if (byId("submit-route").disabled !== Boolean(disabled)) byId("submit-route").disabled = Boolean(disabled);
    if (byId("submit-label").textContent !== label) byId("submit-label").textContent = label;
  }

  function loadSession(session) {
    if (!session.puzzle_id || !session.csrf_token || !session.map_url) throw new ApiError("Диспетчерская вернула неполную схему. Попробуй подключиться снова");
    state.session = session;
    state.history = session.history || [];
    state.cooldownUntil = Date.now() + session.submit_after * 1000;
    state.regenerateUntil = Date.now() + session.regenerate_after * 1000;
    state.pending = storedJson(storageKey("pending"), null);
    byId("district").textContent = session.district;
    byId("map-id").textContent = `Карта ${session.puzzle_id.slice(0, 6)}`;
    byId("target-label").textContent = session.target_label;
    byId("node-count").textContent = String(session.node_count);
    byId("session-duration").textContent = `${session.session_hours} ${plural(session.session_hours, "час", "часа", "часов")}`;
    ["command-limit", "route-limit"].forEach((id) => { byId(id).textContent = String(session.max_commands); });
    byId("open-new-city").disabled = false;
    byId("toggle-pins").disabled = false;
    document.querySelectorAll("[data-layer]").forEach((button) => { button.disabled = false; });
    byId("global-notice").hidden = true;
    byId("result-message").hidden = true;
    routeInput.value = readStorage(storageKey("route"));
    byId("notes-input").value = readStorage(storageKey("notes"));
    const pins = storedJson(storageKey("pins"), []);
    map.pins = Array.isArray(pins) ? pins.filter((pin) => Number.isFinite(pin.x) && Number.isFinite(pin.y) && pin.x >= 0 && pin.y >= 0 && pin.x <= session.map_width && pin.y <= session.map_height).slice(0, 32) : [];
    map.setAnnotation(false);
    renderHistory();
    renderSuccess();
    updateEditor();
    loadMap("all", true);
  }

  async function boot() {
    if (state.booting) return;
    state.booting = true;
    connection("connecting");
    byId("retry-session").disabled = true;
    try {
      const session = await api("/api/session", { method: "POST", body: "{}" });
      loadSession(session);
    } catch (error) {
      byId("global-notice-text").textContent = error.message;
      byId("global-notice").hidden = false;
      imageLoading("Город пока недоступен. Подключись снова", true);
    } finally { state.booting = false; byId("retry-session").disabled = false; }
  }

  function randomId() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function resultMessage(message, neutral = false) {
    byId("result-message").textContent = message;
    byId("result-message").classList.toggle("neutral", neutral);
    byId("result-message").hidden = false;
  }

  byId("route-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    updateEditor(true);
    if (byId("submit-route").disabled) return;
    const route = normaliseRoute(routeInput.value);
    if (!state.pending || state.pending.route !== route || state.pending.puzzle_id !== state.session.puzzle_id) state.pending = { route, puzzle_id: state.session.puzzle_id, request_id: randomId() };
    writeStorage(storageKey("pending"), JSON.stringify(state.pending));
    state.busy = true;
    byId("open-new-city").disabled = true;
    byId("result-message").hidden = true;
    updateEditor();
    try {
      const result = await api("/api/submit", { method: "POST", body: JSON.stringify(state.pending) });
      state.session.attempts = result.attempt;
      state.cooldownUntil = Date.now() + result.submit_after * 1000;
      state.history = [result, ...state.history.filter((entry) => entry.attempt !== result.attempt)].slice(0, 8);
      state.pending = null;
      removeStorage(storageKey("pending"));
      renderHistory();
      if (result.accepted) { state.session.solved = true; state.session.flag = result.flag; renderSuccess(); toast("Все курьеры на складе"); }
      else resultMessage(result.message);
    } catch (error) {
      if (error.retryAfter) state.cooldownUntil = Date.now() + error.retryAfter * 1000;
      resultMessage(error.message, error.status === 0);
      if ([401, 403, 409].includes(error.status)) { byId("global-notice-text").textContent = error.message; byId("global-notice").hidden = false; }
    } finally { state.busy = false; byId("open-new-city").disabled = false; updateEditor(); }
  });

  routeInput.addEventListener("input", () => { byId("result-message").hidden = true; updateEditor(true); });
  routeInput.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); byId("route-form").requestSubmit(); } });
  ["red", "blue"].forEach((color) => byId(`append-${color}`).addEventListener("click", () => { routeInput.value = normaliseRoute(routeInput.value) + (color === "red" ? "R" : "B"); updateEditor(true); routeInput.focus(); }));
  byId("undo-route").addEventListener("click", () => { routeInput.value = normaliseRoute(routeInput.value).slice(0, -1); updateEditor(true); routeInput.focus(); });
  byId("clear-route").addEventListener("click", () => { routeInput.value = ""; updateEditor(true); byId("result-message").hidden = true; routeInput.focus(); });
  document.querySelectorAll("[data-layer]").forEach((button) => button.addEventListener("click", () => { if (state.session && state.layer !== button.dataset.layer) loadMap(button.dataset.layer); }));
  byId("zoom-in").addEventListener("click", () => map.zoom(1.25));
  byId("zoom-out").addEventListener("click", () => map.zoom(0.8));
  byId("fit-map").addEventListener("click", () => map.fit());
  byId("toggle-pins").addEventListener("click", () => { if (state.session) map.setAnnotation(!map.annotating); });
  byId("clear-pins").addEventListener("click", () => { map.pins = []; writeStorage(storageKey("pins"), "[]"); map.draw(); });
  byId("retry-map").addEventListener("click", () => state.session ? loadMap(state.layer) : boot());
  byId("retry-session").addEventListener("click", boot);
  byId("focus-map").addEventListener("click", () => { byId("map-card").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); canvas.focus({ preventScroll: true }); });
  byId("fullscreen-map").addEventListener("click", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (byId("map-card").requestFullscreen) await byId("map-card").requestFullscreen(); else toast("Этот браузер не поддерживает полноэкранную карту"); }
    catch { toast("Браузер не разрешил открыть карту на весь экран"); }
  });

  function openDialog(id) { if (!byId(id).open) byId(id).showModal(); }
  byId("open-rules").addEventListener("click", () => openDialog("rules-dialog"));
  byId("brief-rules").addEventListener("click", () => openDialog("rules-dialog"));
  byId("open-notes").addEventListener("click", () => { if (state.session) openDialog("notes-dialog"); else toast("Блокнот откроется после подключения к городу"); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }));
  byId("notes-input").addEventListener("input", () => { byId("notes-status").textContent = writeStorage(storageKey("notes"), byId("notes-input").value) ? "Заметки сохранены" : "Скопируй заметки: сохранение недоступно"; });
  byId("open-new-city").addEventListener("click", () => { updateRegeneration(); openDialog("new-city-dialog"); });

  function updateRegeneration() {
    const wait = Math.max(0, Math.ceil((state.regenerateUntil - Date.now()) / 1000));
    byId("confirm-new-city").disabled = wait > 0 || state.busy;
    byId("new-city-wait").hidden = wait <= 0;
    byId("new-city-wait").textContent = `Сменить город можно через ${wait} с`;
  }

  byId("confirm-new-city").addEventListener("click", async () => {
    if (state.busy || !state.session) return;
    state.busy = true;
    updateEditor();
    updateRegeneration();
    byId("confirm-new-city").textContent = "Готовим город…";
    const oldId = state.session.puzzle_id;
    try {
      const session = await api("/api/city/new", { method: "POST", body: JSON.stringify({ puzzle_id: oldId }) });
      ["route", "pending", "notes", "pins"].forEach((kind) => removeStorage(`nightline:${kind}:${oldId}`));
      loadSession(session);
      byId("new-city-dialog").close();
      toast("Новая карта готова");
    } catch (error) {
      if (error.retryAfter) state.regenerateUntil = Date.now() + error.retryAfter * 1000;
      toast(error.message);
    } finally { state.busy = false; byId("confirm-new-city").textContent = "Сменить город"; updateRegeneration(); updateEditor(); }
  });

  byId("copy-flag").addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.session.flag);
      else {
        const range = document.createRange();
        range.selectNodeContents(byId("flag-value"));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand("copy")) throw new Error("copy");
        selection.removeAllRanges();
      }
      byId("flag-caption").textContent = "Скопировано в буфер обмена";
      toast("Флаг скопирован");
    } catch { byId("flag-caption").textContent = "Выдели флаг и скопируй вручную"; }
  });

  window.addEventListener("offline", () => connection("offline"));
  new ResizeObserver(() => updateEditor()).observe(byId("route-preview"));
  setInterval(() => {
    byId("clock").textContent = timeFormat.format(new Date());
    if (state.session) { updateSubmitButton(); if (byId("new-city-dialog").open) updateRegeneration(); }
  }, 1000);
  byId("clock").textContent = timeFormat.format(new Date());
  boot();
})();
