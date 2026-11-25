/* XAUUSD trading journal. Entries stay in localStorage under tradingJournal.v1. */
(function () {
  "use strict";

  var STORAGE_KEY = "tradingJournal.v1";
  var NOTE_MAX = 140;
  var CURRENCIES = {
    MYR: { label: "Malaysian ringgit", symbol: "RM" },
    USD: { label: "US dollar", symbol: "$" },
    EUR: { label: "Euro", symbol: "€" },
    GBP: { label: "British pound", symbol: "£" },
    SGD: { label: "Singapore dollar", symbol: "S$" },
    JPY: { label: "Japanese yen", symbol: "¥" },
    AUD: { label: "Australian dollar", symbol: "A$" }
  };

  var state = {
    entries: [],
    currency: "MYR",
    customSymbol: "",
    from: "",
    to: "",
    preset: "month",
    editingId: null,
    pendingDeleteId: null,
    persist: "ok",
    storageWarning: ""
  };

  var lastSaveAt = 0;
  var lastSignature = "";

  function $(id) {
    return document.getElementById(id);
  }

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function toISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseISODate(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  function startOfWeek(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var weekday = d.getDay();
    var delta = weekday === 0 ? 6 : weekday - 1;
    d.setDate(d.getDate() - delta);
    return d;
  }

  function endOfWeek(date) {
    var start = startOfWeek(date);
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return end;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function formatDate(iso) {
    var date = parseISODate(iso);
    if (!date) return iso;
    return new Intl.DateTimeFormat("en-MY", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatCount(n) {
    return new Intl.NumberFormat("en-MY").format(n);
  }

  function round2(n) {
    var sign = n < 0 ? -1 : 1;
    return (sign * Math.round(Math.abs(n) * 100 + 1e-8)) / 100;
  }

  function newId() {
    var cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      try {
        return cryptoObj.randomUUID();
      } catch (err) {
        /* file:// is not a secure context in every browser */
      }
    }
    return "e-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function knownCurrency(code) {
    return Object.prototype.hasOwnProperty.call(CURRENCIES, code) || code === "CUSTOM";
  }

  function currentSymbol() {
    if (state.currency === "CUSTOM") {
      var symbol = state.customSymbol.trim();
      return symbol || "¤";
    }
    return CURRENCIES[state.currency].symbol;
  }

  function currencyLabel() {
    if (state.currency === "CUSTOM") {
      var symbol = state.customSymbol.trim();
      return symbol ? "custom symbol " + symbol : "a custom symbol";
    }
    return CURRENCIES[state.currency].label;
  }

  function currencyCodeForExport() {
    if (state.currency === "CUSTOM") {
      return state.customSymbol.trim() || "CUSTOM";
    }
    return state.currency;
  }

  function symbolNeedsSpace(symbol) {
    return /[A-Za-z]$/.test(symbol);
  }

  function formatSignedAmount(amount) {
    var rounded = round2(amount);
    var abs = new Intl.NumberFormat("en-MY", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Math.abs(rounded));
    var symbol = currentSymbol();
    var body = symbolNeedsSpace(symbol) ? symbol + " " + abs : symbol + abs;
    if (rounded > 0) return { tone: "profit", label: "Profit", value: "+" + body };
    if (rounded < 0) return { tone: "loss", label: "Loss", value: "\u2212" + body };
    return { tone: "flat", label: "Breakeven", value: body };
  }

  function plNode(amount) {
    var view = formatSignedAmount(amount);
    var wrap = document.createElement("span");
    wrap.className = "pl pl-" + view.tone;
    var label = document.createElement("span");
    label.className = "pl-label";
    label.textContent = view.label;
    var value = document.createElement("span");
    value.className = "pl-value";
    value.textContent = view.value;
    wrap.setAttribute("aria-label", view.label + " " + view.value);
    wrap.append(label, value);
    return wrap;
  }

  function tradesLabel(n) {
    return formatCount(n) + (n === 1 ? " trade" : " trades");
  }

  function isEntry(entry) {
    return Boolean(entry)
      && typeof entry.id === "string"
      && entry.id.length > 0
      && Boolean(parseISODate(entry.date))
      && Number.isInteger(entry.trades)
      && entry.trades >= 1
      && entry.trades <= 9999
      && typeof entry.profitLoss === "number"
      && Number.isFinite(entry.profitLoss)
      && Math.abs(entry.profitLoss) <= 1e12
      && typeof entry.note === "string"
      && entry.note.length <= NOTE_MAX
      && typeof entry.createdAt === "string";
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      state.persist = "blocked";
      state.storageWarning = "This browser blocked local storage. Entries will last only until you close the page. Export a CSV if you need to keep them.";
      return;
    }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
        throw new Error("shape");
      }
      var entries = [];
      for (var i = 0; i < data.entries.length; i += 1) {
        if (isEntry(data.entries[i])) {
          entries.push({
            id: data.entries[i].id,
            date: data.entries[i].date,
            trades: data.entries[i].trades,
            profitLoss: round2(data.entries[i].profitLoss),
            note: data.entries[i].note,
            createdAt: data.entries[i].createdAt,
            updatedAt: typeof data.entries[i].updatedAt === "string" ? data.entries[i].updatedAt : data.entries[i].createdAt
          });
        }
      }
      state.entries = entries;
      state.currency = knownCurrency(data.currency) ? data.currency : "MYR";
      state.customSymbol = typeof data.customSymbol === "string" ? data.customSymbol.slice(0, 8) : "";
    } catch (err) {
      state.persist = "corrupt";
      state.storageWarning = "Saved data under tradingJournal.v1 could not be read, so it was left untouched. Start fresh only if you no longer need that saved data.";
    }
  }

  function save() {
    if (state.persist === "corrupt" || state.persist === "blocked") return false;
    var payload = {
      version: 1,
      currency: state.currency,
      customSymbol: state.customSymbol,
      entries: state.entries
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      state.storageWarning = "";
      return true;
    } catch (err) {
      state.storageWarning = "The browser could not save this change. Storage may be full (the limit is about 5 MB) or blocked. Export a CSV before you close the page.";
      renderStorage();
      return false;
    }
  }

  function sortedEntries(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  }

  function chronological(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
  }

  function rangeError() {
    if (state.from && state.to && state.from > state.to) {
      return "The From date is after the To date.";
    }
    return "";
  }

  function filteredEntries() {
    if (rangeError()) return [];
    return state.entries.filter(function (entry) {
      if (state.from && entry.date < state.from) return false;
      if (state.to && entry.date > state.to) return false;
      return true;
    });
  }

  function totalsOf(list) {
    return list.reduce(function (acc, entry) {
      acc.trades += entry.trades;
      acc.profitLoss = round2(acc.profitLoss + entry.profitLoss);
      return acc;
    }, { trades: 0, profitLoss: 0 });
  }

  function dailyRows(list) {
    var map = new Map();
    list.forEach(function (entry) {
      var row = map.get(entry.date);
      if (!row) {
        row = { date: entry.date, trades: 0, profitLoss: 0 };
        map.set(entry.date, row);
      }
      row.trades += entry.trades;
      row.profitLoss = round2(row.profitLoss + entry.profitLoss);
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    });
  }

  function detectPreset(from, to) {
    var today = new Date();
    if (!from && !to) return "all";
    if (from === toISODate(startOfWeek(today)) && to === toISODate(endOfWeek(today))) return "week";
    if (from === toISODate(startOfMonth(today)) && to === toISODate(endOfMonth(today))) return "month";
    return "custom";
  }

  function rangeCaption() {
    if (state.preset === "all" || (!state.from && !state.to)) return "All entries";
    if (state.preset === "week") return "This week, " + formatDate(state.from) + " – " + formatDate(state.to);
    if (state.preset === "month") return "This month, " + formatDate(state.from) + " – " + formatDate(state.to);
    if (state.from && state.to) return formatDate(state.from) + " – " + formatDate(state.to);
    if (state.from) return "From " + formatDate(state.from);
    return "Through " + formatDate(state.to);
  }

  function showFieldError(inputId, errorId, message) {
    var input = $(inputId);
    var field = input.closest(".field") || input.closest("fieldset");
    var error = $(errorId);
    if (message) {
      if (field) field.classList.add("is-invalid");
      error.hidden = false;
      error.textContent = message;
      input.setAttribute("aria-invalid", "true");
    } else {
      if (field) field.classList.remove("is-invalid");
      error.hidden = true;
      error.textContent = "";
      input.removeAttribute("aria-invalid");
    }
  }

  function clearErrors() {
    showFieldError("date", "date-error", "");
    showFieldError("trades", "trades-error", "");
    showFieldError("amount", "amount-error", "");
    showFieldError("note", "note-error", "");
    $("form-errors").hidden = true;
    $("form-errors").textContent = "";
  }

  function parseDateInput(raw) {
    var iso = String(raw || "").trim();
    if (!iso) return { ok: false, message: "Choose the date of this entry." };
    if (!parseISODate(iso)) return { ok: false, message: "That date is not valid." };
    var year = Number(iso.slice(0, 4));
    if (year < 1990 || year > 2100) return { ok: false, message: "Use a date between 1990 and 2100." };
    return { ok: true, value: iso };
  }

  function parseTrades(raw) {
    var cleaned = String(raw || "").trim().replace(/,/g, "");
    if (!cleaned) return { ok: false, message: "Enter how many trades you took." };
    if (!/^\d+$/.test(cleaned)) return { ok: false, message: "Use a whole number, such as 3." };
    var n = Number(cleaned);
    if (n < 1) return { ok: false, message: "Enter at least 1 trade." };
    if (n > 9999) return { ok: false, message: "Enter 9,999 trades or fewer." };
    return { ok: true, value: n };
  }

  function parseAmountInput(raw) {
    var cleaned = String(raw || "").trim().replace(/,/g, "").replace(/\u2212/g, "-").replace(/\s+/g, "");
    if (!cleaned) return { ok: false, message: "Enter the profit or loss. Use 0 for a flat result." };
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
      return { ok: false, message: "Use a number such as 120.50 or -45." };
    }
    var unsigned = cleaned.replace(/^[+-]/, "");
    var parts = unsigned.split(".");
    var decimals = parts[1] || "";
    if (parts.length > 2 || decimals.length > 2) {
      return { ok: false, message: "Use at most two decimal places, such as 120.50." };
    }
    var n = Number(cleaned);
    if (!Number.isFinite(n)) return { ok: false, message: "Use a number such as 120.50 or -45." };
    if (Math.abs(n) > 1e12) return { ok: false, message: "That amount is larger than this journal can store." };
    return { ok: true, value: round2(n) };
  }

  function parseNote(raw) {
    var note = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (note.length > NOTE_MAX) return { ok: false, message: "Keep the note to 140 characters." };
    return { ok: true, value: note };
  }

  function signedAmount(value, direction) {
    if (value < 0) return value;
    if (value === 0) return 0;
    return direction === "loss" ? -value : value;
  }

  function updateDatePreview() {
    var parsed = parseISODate($("date").value);
    $("date-preview").textContent = parsed ? "Recorded as " + formatDate($("date").value) + "." : "";
  }

  function updateNoteCount() {
    var len = $("note").value.length;
    var count = $("note-count");
    count.textContent = len + " of " + NOTE_MAX;
    count.classList.toggle("is-max", len >= NOTE_MAX);
  }

  function updateAmountHint() {
    var symbol = currentSymbol();
    $("amount-hint").textContent = "Shown as " + symbol + ". A negative number, such as -45, is a loss. Amounts are not converted.";
    $("currency-hint").textContent = state.currency === "CUSTOM" && !state.customSymbol.trim()
      ? "Enter a symbol so amounts are labelled. Changing currency does not convert numbers."
      : "Formatting only, in " + currencyLabel() + ". Changing this does not convert amounts you already saved.";
  }

  function setFormStatus(message) {
    $("form-status").textContent = message;
  }

  function setBackupStatus(message) {
    $("backup-status").textContent = message;
    $("backup-error").hidden = true;
    $("backup-error").textContent = "";
  }

  function setBackupError(message) {
    $("backup-status").textContent = "";
    $("backup-error").hidden = false;
    $("backup-error").textContent = message;
  }

  function renderStorage() {
    var alert = $("storage-alert");
    if (!state.storageWarning) {
      alert.hidden = true;
      $("storage-alert-text").textContent = "";
      $("start-fresh").hidden = true;
      return;
    }
    alert.hidden = false;
    $("storage-alert-text").textContent = state.storageWarning;
    $("start-fresh").hidden = state.persist !== "corrupt";
  }

  function renderSummary() {
    var error = rangeError();
    var errorEl = $("range-error");
    if (error) {
      errorEl.hidden = false;
      errorEl.textContent = error;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    $("range-caption").textContent = rangeCaption();
    ["week", "month", "all"].forEach(function (name) {
      $("preset-" + name).setAttribute("aria-pressed", state.preset === name ? "true" : "false");
    });
    if ($("from-date").value !== state.from) $("from-date").value = state.from;
    if ($("to-date").value !== state.to) $("to-date").value = state.to;

    var list = error ? [] : filteredEntries();
    var stats = $("stats");
    stats.replaceChildren();

    var tradesStat = document.createElement("div");
    tradesStat.className = "stat";
    var tradesLabelEl = document.createElement("p");
    tradesLabelEl.className = "stat-label";
    tradesLabelEl.textContent = "Total trades";
    var tradesValue = document.createElement("p");
    tradesValue.className = "stat-value";
    tradesValue.textContent = error ? "—" : formatCount(totalsOf(list).trades);
    var tradesSub = document.createElement("p");
    tradesSub.className = "stat-sub";
    if (error) tradesSub.textContent = "Fix the dates to see a total.";
    else if (list.length === 0) tradesSub.textContent = "No entries in this range.";
    else tradesSub.textContent = "Across " + list.length + (list.length === 1 ? " entry" : " entries");
    tradesStat.append(tradesLabelEl, tradesValue, tradesSub);

    var plStat = document.createElement("div");
    plStat.className = "stat";
    var plLabel = document.createElement("p");
    plLabel.className = "stat-label";
    plLabel.textContent = "Total profit / loss";
    var plValue = document.createElement("p");
    plValue.className = "stat-value";
    if (error || list.length === 0) {
      plValue.textContent = "—";
      plValue.classList.add("cell-quiet");
    } else {
      plValue.append(plNode(totalsOf(list).profitLoss));
    }
    plStat.append(plLabel, plValue);
    stats.append(tradesStat, plStat);

    var days = error ? [] : dailyRows(list);
    var dailyList = $("daily-list");
    dailyList.replaceChildren();
    $("daily-empty").hidden = days.length !== 0;
    $("daily-list").hidden = days.length === 0;
    document.querySelector(".days-columns").hidden = days.length === 0;
    days.forEach(function (row) {
      var item = document.createElement("li");
      item.className = "day";
      item.setAttribute("role", "listitem");
      var when = document.createElement("span");
      when.className = "when";
      var time = document.createElement("time");
      time.dateTime = row.date;
      time.textContent = formatDate(row.date);
      when.append(time);
      var trades = document.createElement("p");
      trades.className = "trades";
      trades.textContent = tradesLabel(row.trades);
      var result = document.createElement("div");
      result.className = "result";
      result.append(plNode(row.profitLoss));
      item.append(when, trades, result);
      dailyList.append(item);
    });
  }

  function renderJournal() {
    var list = sortedEntries(state.entries);
    var ul = $("journal-list");
    ul.replaceChildren();
    $("journal-empty").hidden = list.length !== 0;
    $("journal-list").hidden = list.length === 0;
    document.querySelector(".entry-columns").hidden = list.length === 0;
    $("journal-count").textContent = list.length === 0
      ? "Every saved entry, newest first."
      : formatCount(list.length) + (list.length === 1 ? " entry" : " entries") + ", newest first.";

    list.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = "entry" + (entry.id === state.editingId ? " is-editing" : "");
      item.setAttribute("role", "listitem");
      item.dataset.id = entry.id;
      if (entry.id === state.editingId) item.setAttribute("aria-current", "true");

      var when = document.createElement("span");
      when.className = "when";
      var time = document.createElement("time");
      time.dateTime = entry.date;
      time.textContent = formatDate(entry.date);
      when.append(time);

      var trades = document.createElement("p");
      trades.className = "trades";
      trades.textContent = tradesLabel(entry.trades);

      var result = document.createElement("div");
      result.className = "result";
      result.append(plNode(entry.profitLoss));

      var note = document.createElement("p");
      note.className = "note";
      if (entry.note) {
        note.textContent = entry.note;
      } else {
        note.classList.add("cell-quiet");
        note.textContent = "No note";
      }

      var actions = document.createElement("div");
      actions.className = "row-actions";
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-secondary";
      editBtn.dataset.action = "edit";
      editBtn.textContent = entry.id === state.editingId ? "Editing" : "Edit";
      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.textContent = "Delete";
      actions.append(editBtn, deleteBtn);

      item.append(when, trades, result, note, actions);
      ul.append(item);
    });
  }

  function render() {
    updateAmountHint();
    renderStorage();
    renderSummary();
    renderJournal();
  }

  function resetForm() {
    state.editingId = null;
    $("entry-form").reset();
    $("date").value = todayISO();
    updateDatePreview();
    $("dir-profit").checked = true;
    $("add-heading").textContent = "Quick add";
    $("save-btn").textContent = "Add entry";
    $("cancel-btn").hidden = true;
    $("editing-banner").hidden = true;
    $("editing-banner").textContent = "";
    updateNoteCount();
    clearErrors();
  }

  function startEdit(id) {
    var entry = state.entries.find(function (item) { return item.id === id; });
    if (!entry) return;
    state.editingId = id;
    clearErrors();
    $("form-status").textContent = "";
    $("date").value = entry.date;
    updateDatePreview();
    $("trades").value = String(entry.trades);
    var loss = entry.profitLoss < 0;
    $("dir-profit").checked = !loss;
    $("dir-loss").checked = loss;
    $("amount").value = Math.abs(entry.profitLoss).toFixed(2);
    $("note").value = entry.note;
    updateNoteCount();
    $("add-heading").textContent = "Edit entry";
    $("save-btn").textContent = "Save changes";
    $("cancel-btn").hidden = false;
    var banner = $("editing-banner");
    banner.hidden = false;
    banner.textContent = "Editing " + formatDate(entry.date) + ". Save changes replaces this entry. Cancel leaves it as it is.";
    renderJournal();
    $("quick-add").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    $("date").focus();
  }

  function askDelete(id) {
    var entry = state.entries.find(function (item) { return item.id === id; });
    if (!entry) return;
    state.pendingDeleteId = id;
    var view = formatSignedAmount(entry.profitLoss);
    var detail = formatDate(entry.date) + ", " + tradesLabel(entry.trades) + ", " + view.label + " " + view.value + ".";
    if (entry.note) detail += " Note: " + entry.note;
    $("delete-detail").textContent = detail;
    var dialog = $("delete-dialog");
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      $("delete-cancel").focus();
    } else if (window.confirm(detail + " Delete this entry?")) {
      confirmDelete();
    }
  }

  function confirmDelete() {
    var id = state.pendingDeleteId;
    state.pendingDeleteId = null;
    var dialog = $("delete-dialog");
    if (dialog.open) dialog.close();
    if (!id) return;
    var index = state.entries.findIndex(function (entry) { return entry.id === id; });
    if (index === -1) return;
    var removed = state.entries[index];
    state.entries.splice(index, 1);
    if (state.editingId === id) resetForm();
    save();
    render();
    setFormStatus("Deleted " + formatDate(removed.date) + ", " + tradesLabel(removed.trades) + ".");
    $("journal-heading").focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    var date = parseDateInput($("date").value);
    var trades = parseTrades($("trades").value);
    var amount = parseAmountInput($("amount").value);
    var note = parseNote($("note").value);
    var errors = [];
    if (!date.ok) errors.push({ id: "date", errorId: "date-error", message: date.message });
    if (!trades.ok) errors.push({ id: "trades", errorId: "trades-error", message: trades.message });
    if (!amount.ok) errors.push({ id: "amount", errorId: "amount-error", message: amount.message });
    if (!note.ok) errors.push({ id: "note", errorId: "note-error", message: note.message });

    showFieldError("date", "date-error", date.ok ? "" : date.message);
    showFieldError("trades", "trades-error", trades.ok ? "" : trades.message);
    showFieldError("amount", "amount-error", amount.ok ? "" : amount.message);
    showFieldError("note", "note-error", note.ok ? "" : note.message);

    if (errors.length) {
      var summary = $("form-errors");
      summary.hidden = false;
      summary.textContent = errors.length === 1
        ? errors[0].message
        : "Please fix " + errors.length + " fields. " + errors[0].message;
      $(errors[0].id).focus();
      return;
    }

    var direction = $("dir-loss").checked ? "loss" : "profit";
    var profitLoss = signedAmount(amount.value, direction);
    var signature = JSON.stringify([state.editingId || "", date.value, trades.value, profitLoss, note.value]);
    // A second click of the same submit is ignored. A different entry still saves.
    if (signature === lastSignature && Date.now() - lastSaveAt < 800) return;
    lastSignature = signature;
    lastSaveAt = Date.now();
    var now = new Date().toISOString();
    var view;

    if (state.editingId) {
      var existing = state.entries.find(function (entry) { return entry.id === state.editingId; });
      if (!existing) {
        resetForm();
        renderJournal();
        return;
      }
      existing.date = date.value;
      existing.trades = trades.value;
      existing.profitLoss = profitLoss;
      existing.note = note.value;
      existing.updatedAt = now;
      view = formatSignedAmount(profitLoss);
      save();
      resetForm();
      render();
      setFormStatus("Updated " + formatDate(date.value) + ", " + tradesLabel(trades.value) + ", " + view.label + " " + view.value + ".");
      return;
    }

    state.entries.push({
      id: newId(),
      date: date.value,
      trades: trades.value,
      profitLoss: profitLoss,
      note: note.value,
      createdAt: now,
      updatedAt: now
    });
    view = formatSignedAmount(profitLoss);
    save();
    var keptDate = date.value;
    resetForm();
    $("date").value = keptDate;
    updateDatePreview();
    render();
    setFormStatus("Added " + formatDate(date.value) + ", " + tradesLabel(trades.value) + ", " + view.label + " " + view.value + ".");
    $("trades").focus();
  }

  function applyPreset(preset) {
    var today = new Date();
    if (preset === "week") {
      state.from = toISODate(startOfWeek(today));
      state.to = toISODate(endOfWeek(today));
    } else if (preset === "month") {
      state.from = toISODate(startOfMonth(today));
      state.to = toISODate(endOfMonth(today));
    } else {
      state.from = "";
      state.to = "";
    }
    state.preset = preset;
    renderSummary();
  }

  function onRangeChange() {
    state.from = $("from-date").value;
    state.to = $("to-date").value;
    state.preset = detectPreset(state.from, state.to);
    renderSummary();
  }

  function csvEscape(value) {
    var text = String(value == null ? "" : value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csvNumber(n) {
    var rounded = round2(n);
    if (Object.is(rounded, -0)) rounded = 0;
    return rounded.toFixed(2);
  }

  function buildCSV(entries) {
    var lines = ["date,trades,profit_loss,currency,note"];
    var code = currencyCodeForExport();
    chronological(entries).forEach(function (entry) {
      lines.push([
        csvEscape(entry.date),
        String(entry.trades),
        csvNumber(entry.profitLoss),
        csvEscape(code),
        csvEscape(entry.note)
      ].join(","));
    });
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  function downloadCSV(filename, csv) {
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportEntries(kind) {
    if (kind === "range" && rangeError()) {
      setBackupError(rangeError());
      $("from-date").focus();
      return;
    }
    var list = kind === "range" ? filteredEntries() : state.entries.slice();
    var today = todayISO();
    var filename;
    if (kind === "all" || (!state.from && !state.to)) {
      filename = "xauusd-journal-all-" + today + ".csv";
    } else if (state.from && state.to) {
      filename = "xauusd-journal-" + state.from + "-to-" + state.to + ".csv";
    } else if (state.from) {
      filename = "xauusd-journal-from-" + state.from + ".csv";
    } else {
      filename = "xauusd-journal-through-" + state.to + ".csv";
    }
    downloadCSV(filename, buildCSV(list));
    var noun = list.length === 1 ? "entry" : "entries";
    setBackupStatus("Downloaded " + filename + " with " + formatCount(list.length) + " " + noun + ".");
  }

  function parseCSV(text) {
    var source = String(text || "").replace(/^\uFEFF/, "");
    var delimiter = ",";
    var headerLine = source.split(/\r?\n/, 1)[0] || "";
    if (headerLine.indexOf(";") !== -1 && headerLine.indexOf(",") === -1) delimiter = ";";
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    for (var i = 0; i < source.length; i += 1) {
      var c = source[i];
      if (inQuotes) {
        if (c === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(function (cells) {
      return cells.some(function (cell) { return String(cell).trim() !== ""; });
    });
  }

  function importCSV(text) {
    var rows = parseCSV(text);
    if (!rows.length) {
      setBackupError("That file is empty.");
      return;
    }
    var header = rows[0].map(function (cell) { return String(cell).trim().toLowerCase(); });
    var index = {
      date: header.indexOf("date"),
      trades: header.indexOf("trades"),
      profit: header.indexOf("profit_loss"),
      currency: header.indexOf("currency"),
      note: header.indexOf("note")
    };
    if (index.date === -1 || index.trades === -1 || index.profit === -1) {
      setBackupError("This file needs a header row with date, trades, profit_loss, currency, and note.");
      return;
    }

    var added = [];
    var problems = [];
    var currencies = new Set();
    rows.slice(1).forEach(function (cells, offset) {
      var rowNumber = offset + 2;
      var date = parseDateInput(cells[index.date]);
      var trades = parseTrades(cells[index.trades]);
      var amount = parseAmountInput(cells[index.profit]);
      var note = parseNote(index.note === -1 ? "" : cells[index.note] || "");
      if (!date.ok || !trades.ok || !amount.ok || !note.ok) {
        var why = !date.ok ? date.message : !trades.ok ? trades.message : !amount.ok ? amount.message : note.message;
        problems.push("Row " + rowNumber + ": " + why);
        return;
      }
      if (index.currency !== -1 && cells[index.currency]) currencies.add(String(cells[index.currency]).trim());
      var stamp = new Date(Date.now() + added.length).toISOString();
      added.push({
        id: newId(),
        date: date.value,
        trades: trades.value,
        profitLoss: round2(amount.value),
        note: note.value,
        createdAt: stamp,
        updatedAt: stamp
      });
    });

    if (!added.length) {
      setBackupError(problems.length ? problems.slice(0, 3).join(" ") : "No entries were found to import.");
      return;
    }

    state.entries = state.entries.concat(added);
    save();
    render();
    var noun = added.length === 1 ? "entry" : "entries";
    var message = "Imported " + formatCount(added.length) + " " + noun + ".";
    if (problems.length) {
      message += " Skipped " + problems.length + ". " + problems.slice(0, 2).join(" ");
    }
    var codes = Array.from(currencies).filter(Boolean);
    if (codes.length && (codes.length > 1 || codes[0] !== currencyCodeForExport())) {
      message += " Amounts were not converted.";
    }
    setBackupStatus(message);
  }

  function syncCurrencyControls() {
    $("currency").value = state.currency;
    $("custom-symbol").value = state.customSymbol;
    $("custom-wrap").hidden = state.currency !== "CUSTOM";
  }

  function onCurrencyChange() {
    state.currency = $("currency").value;
    $("custom-wrap").hidden = state.currency !== "CUSTOM";
    if (state.currency === "CUSTOM") $("custom-symbol").focus();
    save();
    render();
    setFormStatus("Display currency is now " + currencyLabel() + ". Amounts were not converted.");
  }

  function onCustomSymbol() {
    state.customSymbol = $("custom-symbol").value.replace(/[\r\n,]/g, "").slice(0, 8);
    if ($("custom-symbol").value !== state.customSymbol) $("custom-symbol").value = state.customSymbol;
    save();
    updateAmountHint();
    renderSummary();
    renderJournal();
  }

  function startFresh() {
    state.persist = "ok";
    state.entries = [];
    state.currency = "MYR";
    state.customSymbol = "";
    state.storageWarning = "";
    state.editingId = null;
    resetForm();
    syncCurrencyControls();
    var ok = save();
    render();
    if (ok) setFormStatus("Started a new journal in this browser.");
  }

  function bind() {
    $("entry-form").addEventListener("submit", onSubmit);
    $("cancel-btn").addEventListener("click", function () {
      resetForm();
      renderJournal();
      setFormStatus("Edit cancelled. The entry was not changed.");
    });
    $("note").addEventListener("input", function () {
      updateNoteCount();
      showFieldError("note", "note-error", "");
      $("form-errors").hidden = true;
      $("form-status").textContent = "";
    });
    ["date", "trades", "amount"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        showFieldError(id, id + "-error", "");
        $("form-errors").hidden = true;
        $("form-status").textContent = "";
        if (id === "date") updateDatePreview();
      });
    });
    $("date").addEventListener("change", updateDatePreview);
    $("amount").addEventListener("input", function () {
      if (/^\s*[-\u2212]/.test($("amount").value)) $("dir-loss").checked = true;
    });
    $("dir-profit").addEventListener("change", function () {
      var parsed = parseAmountInput($("amount").value);
      if (parsed.ok && parsed.value < 0) $("amount").value = Math.abs(parsed.value).toFixed(2);
    });
    $("amount").addEventListener("blur", function () {
      var parsed = parseAmountInput($("amount").value);
      if (!parsed.ok) return;
      if (parsed.value < 0) $("dir-loss").checked = true;
      if (parsed.value === 0) $("dir-profit").checked = true;
      $("amount").value = Math.abs(parsed.value).toFixed(2);
    });

    $("journal-list").addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;
      var row = button.closest("[data-id]");
      if (!row) return;
      if (button.dataset.action === "edit") startEdit(row.dataset.id);
      if (button.dataset.action === "delete") askDelete(row.dataset.id);
    });

    $("delete-cancel").addEventListener("click", function () {
      state.pendingDeleteId = null;
      $("delete-dialog").close();
    });
    $("delete-confirm").addEventListener("click", confirmDelete);
    $("delete-dialog").addEventListener("cancel", function () {
      state.pendingDeleteId = null;
    });
    $("delete-dialog").addEventListener("click", function (event) {
      if (event.target === $("delete-dialog")) {
        state.pendingDeleteId = null;
        $("delete-dialog").close();
      }
    });

    $("preset-week").addEventListener("click", function () { applyPreset("week"); });
    $("preset-month").addEventListener("click", function () { applyPreset("month"); });
    $("preset-all").addEventListener("click", function () { applyPreset("all"); });
    $("from-date").addEventListener("change", onRangeChange);
    $("to-date").addEventListener("change", onRangeChange);

    $("currency").addEventListener("change", onCurrencyChange);
    $("custom-symbol").addEventListener("input", onCustomSymbol);
    $("custom-symbol").addEventListener("blur", function () {
      state.customSymbol = state.customSymbol.trim();
      $("custom-symbol").value = state.customSymbol;
      save();
      updateAmountHint();
      renderSummary();
      renderJournal();
    });

    $("export-all").addEventListener("click", function () { exportEntries("all"); });
    $("export-range").addEventListener("click", function () { exportEntries("range"); });
    $("import-file").addEventListener("change", function () {
      var file = $("import-file").files && $("import-file").files[0];
      $("import-file").value = "";
      if (!file) return;
      if (file.size > 1024 * 1024) {
        setBackupError("That CSV is larger than 1 MB. Export from this journal is a small text file.");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { importCSV(String(reader.result || "")); };
      reader.onerror = function () { setBackupError("That file could not be read."); };
      reader.readAsText(file);
    });
    $("start-fresh").addEventListener("click", startFresh);

    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY || state.persist === "corrupt") return;
      var editing = state.editingId;
      load();
      if (editing && !state.entries.some(function (entry) { return entry.id === editing; })) {
        resetForm();
      }
      syncCurrencyControls();
      render();
      setFormStatus("Updated from another tab in this browser.");
    });
  }

  function init() {
    load();
    bind();
    syncCurrencyControls();
    var today = new Date();
    state.from = toISODate(startOfMonth(today));
    state.to = toISODate(endOfMonth(today));
    state.preset = "month";
    $("date").value = todayISO();
    updateDatePreview();
    updateNoteCount();
    render();
  }

  init();
})();
