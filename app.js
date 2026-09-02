(function () {
  "use strict";

  var STORAGE_KEY = "estudio-app-state-v1";

  var PALETTE = [
    { dot: "#2F6F4E", solid: "#2F6F4E", text: "#1F4B34" },
    { dot: "#3B4FA0", solid: "#3B4FA0", text: "#28356E" },
    { dot: "#8B4B72", solid: "#8B4B72", text: "#5E3149" }
  ];

  var DEFAULT_SUBJECTS = [
    { id: "mat", name: "Matemática Aplicada II", color: 0, goalHours: 5 },
    { id: "micro", name: "Microeconomía", color: 1, goalHours: 3 },
    { id: "macro", name: "Macroeconomía", color: 2, goalHours: 2 }
  ];

  var ICONS = {
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>',
    stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
    pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  var state = {
    subjects: DEFAULT_SUBJECTS,
    weeklyData: {},
    activeTimer: null,
    editingId: null,
    draftName: "",
    draftGoal: ""
  };

  function pad(n) { return String(n).padStart(2, "0"); }

  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function getWeekKey(date) {
    var m = mondayOf(date);
    return m.getFullYear() + "-" + pad(m.getMonth() + 1) + "-" + pad(m.getDate());
  }

  function weekStartFromKey(key) {
    var parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function weekRangeLabel(key) {
    var start = weekStartFromKey(key);
    var end = new Date(start);
    end.setDate(start.getDate() + 6);
    function fmt(d) {
      var month = d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
      return d.getDate() + " " + month;
    }
    return fmt(start) + " \u2013 " + fmt(end);
  }

  function splitByWeek(startTs, endTs) {
    var out = {};
    var cursor = startTs;
    var guard = 0;
    while (cursor < endTs && guard < 60) {
      guard += 1;
      var key = getWeekKey(new Date(cursor));
      var start = weekStartFromKey(key);
      var nextStart = new Date(start);
      nextStart.setDate(start.getDate() + 7);
      var segmentEnd = Math.min(endTs, nextStart.getTime());
      out[key] = (out[key] || 0) + (segmentEnd - cursor);
      cursor = segmentEnd;
    }
    return out;
  }

  function formatDuration(ms) {
    var totalMin = Math.round(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + " min";
    if (m === 0) return h + "h";
    return h + "h " + m + "m";
  }

  function formatClock(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state.subjects = parsed.subjects || DEFAULT_SUBJECTS;
        state.weeklyData = parsed.weeklyData || {};
        state.activeTimer = parsed.activeTimer || null;
      }
    } catch (e) {
      // start fresh if storage is corrupted
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        subjects: state.subjects,
        weeklyData: state.weeklyData,
        activeTimer: state.activeTimer
      }));
    } catch (e) {
      // ignore write failures (e.g. private browsing storage limits)
    }
  }

  function currentWeekKey() { return getWeekKey(new Date()); }

  function liveAdditionsForWeek(weekKey) {
    if (!state.activeTimer) return 0;
    var splits = splitByWeek(state.activeTimer.startTs, Date.now());
    return splits[weekKey] || 0;
  }

  function accumulatedMs(subjectId) {
    var wk = currentWeekKey();
    var stored = (state.weeklyData[wk] && state.weeklyData[wk][subjectId]) || 0;
    var live = state.activeTimer && state.activeTimer.subjectId === subjectId
      ? liveAdditionsForWeek(wk) : 0;
    return stored + live;
  }

  function flushActiveTimer(endTs) {
    if (!state.activeTimer) return;
    var splits = splitByWeek(state.activeTimer.startTs, endTs);
    Object.keys(splits).forEach(function (wk) {
      state.weeklyData[wk] = state.weeklyData[wk] || {};
      state.weeklyData[wk][state.activeTimer.subjectId] =
        (state.weeklyData[wk][state.activeTimer.subjectId] || 0) + splits[wk];
    });
  }

  function startTimer(subjectId) {
    var now = Date.now();
    if (state.activeTimer) flushActiveTimer(now);
    state.activeTimer = { subjectId: subjectId, startTs: now };
    save();
    render();
  }

  function stopTimer() {
    if (!state.activeTimer) return;
    flushActiveTimer(Date.now());
    state.activeTimer = null;
    save();
    render();
  }

  function openEdit(id) {
    var subject = state.subjects.find(function (s) { return s.id === id; });
    if (!subject) return;
    state.editingId = id;
    state.draftName = subject.name;
    state.draftGoal = String(subject.goalHours);
    render();
  }

  function cancelEdit() {
    state.editingId = null;
    render();
  }

  function saveEdit(id) {
    var goalInput = document.getElementById("goal-input-" + id);
    var nameInput = document.getElementById("name-input-" + id);
    var parsedGoal = parseFloat((goalInput.value || "").replace(",", "."));
    var goalHours = isNaN(parsedGoal) || parsedGoal <= 0 ? 1 : parsedGoal;
    var trimmedName = (nameInput.value || "").trim() || "Materia sin nombre";
    state.subjects = state.subjects.map(function (s) {
      return s.id === id ? Object.assign({}, s, { name: trimmedName, goalHours: goalHours }) : s;
    });
    state.editingId = null;
    save();
    render();
  }

  function cardTemplate(subject) {
    var palette = PALETTE[subject.color % PALETTE.length];
    var goalMs = subject.goalHours * 3600000;
    var accMs = accumulatedMs(subject.id);
    var pct = goalMs > 0 ? (accMs / goalMs) * 100 : 0;
    var barPct = Math.min(pct, 100);
    var isActive = state.activeTimer && state.activeTimer.subjectId === subject.id;

    if (state.editingId === subject.id) {
      return (
        '<div class="card" style="--accent:' + palette.solid + '">' +
          '<div class="edit-form">' +
            '<input type="text" id="name-input-' + subject.id + '" value="' + escapeHtml(state.draftName) + '" placeholder="Nombre de la materia" />' +
            '<div class="goal-row">' +
              '<label>Objetivo semanal</label>' +
              '<input type="number" min="0.5" step="0.5" id="goal-input-' + subject.id + '" value="' + escapeHtml(state.draftGoal) + '" />' +
              '<span>horas</span>' +
            '</div>' +
            '<div class="edit-actions">' +
              '<button class="cancel" data-action="cancel-edit" aria-label="Cancelar">' + ICONS.x + '</button>' +
              '<button class="save" data-action="save-edit" data-id="' + subject.id + '" aria-label="Guardar">' + ICONS.check + '</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    var liveClock = "";
    if (isActive) {
      var sessionElapsed = Date.now() - state.activeTimer.startTs;
      liveClock = '<span class="live-clock mono"><span class="pulse"></span>' + formatClock(sessionElapsed) + '</span>';
    }

    return (
      '<div class="card' + (isActive ? " active" : "") + '" style="--accent:' + palette.solid + ';--accent-text:' + palette.text + '">' +
        '<div class="card-head">' +
          '<div class="name-group">' +
            '<span class="dot"></span>' +
            '<h2>' + escapeHtml(subject.name) + '</h2>' +
          '</div>' +
          '<button class="icon-btn" data-action="edit" data-id="' + subject.id + '" aria-label="Editar ' + escapeHtml(subject.name) + '">' + ICONS.pencil + '</button>' +
        '</div>' +
        '<div class="progress-block">' +
          '<div class="figures">' +
            '<span class="acc mono">' + formatDuration(accMs) + '</span>' +
            '<span class="goal">/ ' + formatDuration(goalMs) + '</span>' +
          '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + barPct + '%"></div></div>' +
          '<div class="progress-meta">' +
            '<span class="pct">' + Math.round(pct) + '%' + (pct >= 100 ? ' \uD83C\uDFAF' : '') + '</span>' +
            liveClock +
          '</div>' +
        '</div>' +
        '<button class="big-btn' + (isActive ? " stop" : "") + '" data-action="' + (isActive ? "stop" : "start") + '" data-id="' + subject.id + '">' +
          (isActive ? ICONS.stop + " DETENER" : ICONS.play + " INICIAR") +
        '</button>' +
      '</div>'
    );
  }

  function goalsRowTemplate(subject) {
    var palette = PALETTE[subject.color % PALETTE.length];
    var goalMs = subject.goalHours * 3600000;
    var accMs = accumulatedMs(subject.id);
    var pct = goalMs > 0 ? (accMs / goalMs) * 100 : 0;
    var remaining = goalMs - accMs;
    return (
      '<div class="goal-list-row">' +
        '<div class="name"><span class="dot" style="width:8px;height:8px;background:' + palette.dot + '"></span><span>' + escapeHtml(subject.name) + '</span></div>' +
        '<div class="times mono">' + formatDuration(accMs) + ' / ' + formatDuration(goalMs) + '</div>' +
        '<div class="pctcol" style="color:' + palette.text + '">' + Math.round(pct) + '%</div>' +
        '<div class="remaining">' + (remaining <= 0 ? "Cumplido \uD83C\uDFAF" : "Faltan " + formatDuration(remaining)) + '</div>' +
      '</div>'
    );
  }

  function historyRowTemplate(subject) {
    return (
      '<div class="history-row">' +
        '<span>' + escapeHtml(subject.name) + '</span>' +
        '<span class="val mono">' + formatDuration(accumulatedMs(subject.id)) + '</span>' +
      '</div>'
    );
  }

  function render() {
    var app = document.getElementById("app");
    var totalMs = state.subjects.reduce(function (sum, s) { return sum + accumulatedMs(s.id); }, 0);

    app.innerHTML =
      '<div class="wrap">' +
        '<header class="top">' +
          '<h1>Estudio</h1>' +
          '<span class="week-range">' + weekRangeLabel(currentWeekKey()) + '</span>' +
        '</header>' +
        '<div class="cards">' + state.subjects.map(cardTemplate).join("") + '</div>' +
        '<section class="panel">' +
          '<h3>Objetivos de esta semana</h3>' +
          state.subjects.map(goalsRowTemplate).join("") +
        '</section>' +
        '<section class="panel">' +
          '<h3>Esta semana</h3>' +
          state.subjects.map(historyRowTemplate).join("") +
          '<div class="history-total"><span>Total</span><span class="mono">' + formatDuration(totalMs) + '</span></div>' +
        '</section>' +
      '</div>';
  }

  function handleClick(e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    var id = target.getAttribute("data-id");
    if (action === "start") startTimer(id);
    else if (action === "stop") stopTimer();
    else if (action === "edit") openEdit(id);
    else if (action === "cancel-edit") cancelEdit();
    else if (action === "save-edit") saveEdit(id);
  }

  function init() {
    load();
    document.getElementById("app").addEventListener("click", handleClick);
    render();
    setInterval(render, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
