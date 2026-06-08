(() => {
  "use strict";

  const BASE = window.TIPOVACKA_DATA || { matches: [], players: [], groups: {}, flags: {}, scoring: {} };
  const CONFIG = window.TIPOVACKA_CONFIG || { mode: "local" };
  const STORAGE_KEY = "tipovacka2026_state_4players_v2";
  const USER_KEY = "tipovacka2026_user_4players_v2";
  const GROUPS = Object.keys(BASE.groups || {}).sort();
  const TEAM_LIST = Array.from(new Set(Object.values(BASE.groups || {}).flat())).sort((a, b) => a.localeCompare(b, "cs"));
  const CANONICAL_PLAYERS = (BASE.players || []).map(p => ({ name: p.name, pin: String(p.pin || "") }));
  const CANONICAL_PLAYER_NAMES = new Set(CANONICAL_PLAYERS.map(p => p.name));

  function filterToCanonicalPlayers(players) {
    const byName = new Map((players || []).filter(p => p && p.name).map(p => [p.name, { name: p.name, pin: String(p.pin || "") }]));
    return CANONICAL_PLAYERS.map(p => byName.get(p.name) || p);
  }

  let runtime = clone(BASE);
  let state = defaultState();
  let selectedDay = null;
  let activePredTab = "general";
  let activeAdminTab = "scores";

  function clone(obj) { return JSON.parse(JSON.stringify(obj || {})); }
  function $(id) { return document.getElementById(id); }
  function h(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function defaultState() {
    return {
      tips: [],
      results: {},
      predictions: {},
      tournamentResults: {},
      groupResults: {}
    };
  }

  function normalizeRemoteRow(row) {
    const out = {};
    Object.keys(row || {}).forEach(k => out[k.trim()] = row[k]);
    return out;
  }

  function numberOrBlank(v) {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    return Number.isFinite(n) ? n : "";
  }

  function isGoogleMode() {
    return CONFIG.mode === "google" && CONFIG.sheetUrl && CONFIG.scriptUrl;
  }

  function activePlayerSet() {
    return new Set(CANONICAL_PLAYER_NAMES);
  }

  function pruneStateForActivePlayers() {
    const active = activePlayerSet();
    state.tips = (state.tips || []).filter(t => active.has(t.player));
    const cleanedPredictions = {};
    Object.entries(state.predictions || {}).forEach(([player, pred]) => {
      if (active.has(player)) cleanedPredictions[player] = pred;
    });
    state.predictions = cleanedPredictions;
  }

  async function loadData() {
    runtime = clone(BASE);
    runtime.players = filterToCanonicalPlayers(runtime.players);
    if (isGoogleMode()) {
      await loadGoogleData();
    } else {
      const saved = localStorage.getItem(STORAGE_KEY);
      state = saved ? { ...defaultState(), ...JSON.parse(saved) } : defaultState();
      pruneStateForActivePlayers();
      hydrateResultsIntoMatches();
    }
    renderAll();
    updateUserBadge();
  }

  async function loadGoogleData() {
    const get = async (sheet) => {
      const res = await fetch(`${CONFIG.sheetUrl}/${sheet}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Nepodařilo se načíst sheet ${sheet}`);
      return (await res.json()).map(normalizeRemoteRow);
    };

    try {
      const [matches, tips, players, predictions, tournamentResults, groupResults] = await Promise.all([
        get("matches"), get("tips"), get("players"), get("predictions"), get("tournament_results"), get("group_results")
      ]);

      runtime.matches = matches.map(m => ({
        id: Number(m.id),
        round: m.round || "",
        stage: m.stage || "",
        group: m.group || "",
        date: m.date || "",
        time: m.time || "",
        home: m.home || "",
        away: m.away || "",
        home_goals: numberOrBlank(m.home_goals),
        away_goals: numberOrBlank(m.away_goals)
      })).filter(m => Number.isFinite(m.id)).sort((a, b) => a.id - b.id);

      runtime.players = filterToCanonicalPlayers(players);
      state = defaultState();
      state.tips = tips.filter(t => t.match_id && t.player).map(t => ({
        match_id: Number(t.match_id), player: t.player, home: Number(t.home), away: Number(t.away)
      }));
      pruneStateForActivePlayers();
      runtime.matches.forEach(m => {
        if (m.home_goals !== "" && m.away_goals !== "") {
          state.results[m.id] = { home: Number(m.home_goals), away: Number(m.away_goals) };
        }
      });
      predictions.filter(p => p.player && activePlayerSet().has(p.player)).forEach(p => {
        const groups = {};
        GROUPS.forEach(g => groups[g] = p[g] || "");
        state.predictions[p.player] = {
          champion: p.champion || "", second: p.second || "", third: p.third || "",
          topScorer: p.top_scorer || "", bestPlayer: p.best_player || "", bestYoung: p.best_young || "",
          bestGoalkeeper: p.best_gk || "", bestCzechScorer: p.best_czech_scorer || "", groups
        };
      });
      tournamentResults.forEach(r => { if (r.category) state.tournamentResults[r.category] = r.value || ""; });
      groupResults.forEach(r => { if (r.group) state.groupResults[r.group] = r.winner || ""; });
      hydrateResultsIntoMatches();
    } catch (err) {
      console.error(err);
      showToast("Google data se nenačetla, jedu lokálně. Protože samozřejmě.", "error");
      const saved = localStorage.getItem(STORAGE_KEY);
      state = saved ? { ...defaultState(), ...JSON.parse(saved) } : defaultState();
      pruneStateForActivePlayers();
      hydrateResultsIntoMatches();
    }
  }

  async function postRecord(sheet, payload) {
    if (!isGoogleMode()) return;
    const body = new URLSearchParams({ sheet, payload: JSON.stringify(payload) });
    const res = await fetch(CONFIG.scriptUrl, { method: "POST", body });
    if (!res.ok) throw new Error("Server error");
  }

  function saveLocal() {
    if (!isGoogleMode()) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function hydrateResultsIntoMatches() {
    runtime.matches.forEach(m => {
      const r = state.results[m.id];
      m.home_goals = r ? r.home : "";
      m.away_goals = r ? r.away : "";
    });
  }

  function renderAll() {
    hydrateResultsIntoMatches();
    setSubtitle();
    renderMatches();
    renderRanking();
    renderDayFilter();
    renderHistory();
    renderGroups();
    renderPredictions();
    renderScoringNote();
  }

  function pragueDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function addDaysIso(iso, days) {
    const d = new Date(`${iso}T12:00:00+02:00`);
    d.setUTCDate(d.getUTCDate() + days);
    return pragueDate(d);
  }

  function formatDate(dateStr, mode = "full") {
    if (!dateStr) return "-";
    const d = new Date(`${dateStr}T12:00:00+02:00`);
    const opts = mode === "short"
      ? { day: "numeric", month: "numeric", timeZone: "Europe/Prague" }
      : { weekday: "short", day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" };
    return d.toLocaleDateString("cs-CZ", opts);
  }

  function kickoffDate(match) {
    return new Date(`${match.date}T${match.time || "00:00"}:00+02:00`);
  }

  function hasScore(match) {
    return match.home_goals !== "" && match.away_goals !== "" && match.home_goals !== null && match.away_goals !== null;
  }

  function canTip(match) {
    return Date.now() < kickoffDate(match).getTime();
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }

  function setSubtitle() {
    const today = pragueDate();
    $("subtitle").innerText = `Dnes: ${formatDate(today)} · časy ${BASE.timezoneLabel || "CET/CEST"}`;
  }

  function flag(team) { return (runtime.flags && runtime.flags[team]) ? runtime.flags[team] : ""; }
  function teamHtml(team, side = "home") {
    return `<div class="team ${side === "away" ? "away" : ""}"><span class="flag">${h(flag(team))}</span><span class="team-name">${h(team)}</span></div>`;
  }
  function scoreHtml(match) { return hasScore(match) ? `${h(match.home_goals)} : ${h(match.away_goals)}` : "VS"; }

  function getMyTip(matchId) {
    const user = currentUser();
    if (!user) return null;
    return state.tips.find(t => Number(t.match_id) === Number(matchId) && t.player === user.name) || null;
  }

  function renderMatches() {
    const el = $("matchesList");
    const today = pragueDate();
    const tomorrow = addDaysIso(today, 1);
    const todayMatches = runtime.matches.filter(m => m.date === today);
    const tomorrowMatches = runtime.matches.filter(m => m.date === tomorrow);
    let blocks = [];

    if (todayMatches.length) blocks.push({ title: "Dnešní zápasy", cls: "today", matches: todayMatches });
    if (tomorrowMatches.length) blocks.push({ title: "⏭️ Zítřejší zápasy", cls: "tomorrow", matches: tomorrowMatches });

    if (!blocks.length) {
      const upcoming = runtime.matches.filter(m => kickoffDate(m).getTime() >= Date.now()).slice(0, 8);
      if (upcoming.length) blocks.push({ title: "Nejbližší zápasy", cls: "upcoming-list", matches: upcoming });
    }

    if (!blocks.length) {
      el.innerHTML = `<div class="empty-state">Žádné zápasy. Fotbal si vzal volno, což je podezřelé.</div>`;
      return;
    }

    el.innerHTML = blocks.map(block => `
      <div class="section-title ${block.cls !== "today" ? "secondary" : ""}">${h(block.title)}</div>
      ${block.matches.map(renderMatchCard).join("")}
    `).join("");
  }

  function renderMatchCard(match) {
    const tip = getMyTip(match.id);
    const played = hasScore(match);
    const status = played ? "played" : "upcoming";
    const tipText = tip ? `✔ tvůj tip ${h(tip.home)} : ${h(tip.away)}` : "X nemáš natipováno";
    return `
      <article class="match-card ${status}" data-match-id="${match.id}">
        <div class="match-top">
          <span class="match-time">${h(formatDate(match.date, "short"))} · ${h(match.time)}</span>
          <span class="stage-pill">${h(match.round)}</span>
        </div>
        <div class="match-body">
          ${teamHtml(match.home, "home")}
          <div class="score">${scoreHtml(match)}</div>
          ${teamHtml(match.away, "away")}
        </div>
        <div class="match-footer tip-indicator ${tip ? "yes" : "no"}">${played ? "Zápas ukončen" : "Tipuj výsledek"} · ${tipText}</div>
      </article>`;
  }

  function basePoints(actualH, actualA, tipH, tipA) {
    actualH = Number(actualH); actualA = Number(actualA); tipH = Number(tipH); tipA = Number(tipA);
    if ([actualH, actualA, tipH, tipA].some(n => !Number.isFinite(n))) return 0;
    const actualDiff = actualH - actualA;
    const tipDiff = tipH - tipA;
    const actualSign = Math.sign(actualDiff);
    const tipSign = Math.sign(tipDiff);
    if (actualH === tipH && actualA === tipA) return Number(runtime.scoring.groupExact || 6);
    if (actualSign === tipSign && actualDiff === tipDiff) return Number(runtime.scoring.groupGoalDifference || 4);
    if (actualSign === tipSign) return Number(runtime.scoring.groupResult || 2);
    return 0;
  }

  function matchPoints(match, tip) {
    const base = basePoints(match.home_goals, match.away_goals, tip.home, tip.away);
    return match.stage === "Knockout" ? base * Number(runtime.scoring.knockoutMultiplier || 2) : base;
  }

  function predictionBonus(pred = {}) {
    const tr = state.tournamentResults || {};
    let bonus = 0;
    const exact = (key, pts) => {
      if ((pred[key] || "").trim() && tr[key] && pred[key].trim() === tr[key]) bonus += pts;
    };
    exact("champion", Number(runtime.scoring.champion || 40));
    exact("second", Number(runtime.scoring.runnerUp || 25));
    exact("third", Number(runtime.scoring.thirdPlace || 15));
    exact("topScorer", Number(runtime.scoring.topScorer || 15));
    exact("bestPlayer", Number(runtime.scoring.bestPlayer || 15));
    exact("bestYoung", Number(runtime.scoring.bestYoung || 15));
    exact("bestGoalkeeper", Number(runtime.scoring.bestGoalkeeper || 15));
    exact("bestCzechScorer", Number(runtime.scoring.bestCzechScorer || 10));
    return bonus;
  }

  function groupPredictionPoints(pred = {}) {
    let pts = 0;
    GROUPS.forEach(g => {
      const predicted = pred.groups?.[g] || "";
      const real = state.groupResults?.[g] || "";
      if (predicted && real && predicted === real) pts += Number(runtime.scoring.groupWinner || 5);
    });
    return pts;
  }

  function calculateScores() {
    const scores = {};
    runtime.players.forEach(p => scores[p.name] = { player: p.name, groupMatch: 0, koMatch: 0, groupPred: 0, bonus: 0, total: 0 });
    runtime.matches.forEach(match => {
      if (!hasScore(match)) return;
      state.tips.filter(t => Number(t.match_id) === Number(match.id)).forEach(t => {
        if (!scores[t.player]) scores[t.player] = { player: t.player, groupMatch: 0, koMatch: 0, groupPred: 0, bonus: 0, total: 0 };
        const pts = matchPoints(match, t);
        if (match.stage === "Knockout") scores[t.player].koMatch += pts;
        else scores[t.player].groupMatch += pts;
      });
    });
    Object.keys(scores).forEach(player => {
      const pred = state.predictions[player] || {};
      scores[player].groupPred = groupPredictionPoints(pred);
      scores[player].bonus = predictionBonus(pred);
      scores[player].total = scores[player].groupMatch + scores[player].koMatch + scores[player].groupPred + scores[player].bonus;
    });
    return Object.values(scores).sort((a, b) => b.total - a.total || a.player.localeCompare(b.player, "cs"));
  }

  function renderRanking() {
    const table = $("rankingTable");
    const sorted = calculateScores();
    const leader = sorted[0];
    $("leaderBoxHeader").innerHTML = leader ? `<div class="leader-header">Lídr: ${h(leader.player)} (${leader.total} bodů)</div>` : "";
    table.innerHTML = `
      <thead><tr><th>#</th><th>Hráč</th><th>Skupiny</th><th>KO</th><th>Bonus</th><th>Celkem</th></tr></thead>
      <tbody>
        ${sorted.map((s, i) => {
          const rowClass = i === 0 ? "first" : i === 1 ? "second" : i === 2 ? "third" : "";
          const groupTotal = s.groupMatch + s.groupPred;
          return `<tr class="${rowClass}"><td>${i + 1}</td><td>${h(s.player)}</td><td>${groupTotal}</td><td>${s.koMatch}</td><td>${s.bonus}</td><td><strong>${s.total}</strong></td></tr>`;
        }).join("")}
      </tbody>`;
  }

  function renderScoringNote() {
    const s = runtime.scoring || {};
    $("scoringNote").innerHTML = `Skupina: přesný výsledek ${s.groupExact} b, rozdíl ${s.groupGoalDifference} b, trefený výsledek ${s.groupResult} b. KO se násobí ×${s.knockoutMultiplier}. Vítěz skupiny ${s.groupWinner} b. Bonusy: vítěz ${s.champion} b, 2. místo ${s.runnerUp} b, 3. místo ${s.thirdPlace} b.`;
  }

  function renderDayFilter() {
    const days = Array.from(new Set(runtime.matches.map(m => m.date).filter(Boolean))).sort();
    const today = pragueDate();
    if (!selectedDay || !days.includes(selectedDay)) {
      selectedDay = days.includes(today) ? today : (runtime.matches.find(m => kickoffDate(m).getTime() >= Date.now())?.date || days[0]);
    }
    $("dayFilter").innerHTML = `
      <button class="filter ${selectedDay === "all" ? "active" : ""}" data-day="all">Vše</button>
      ${days.map(d => `<button class="filter ${selectedDay === d ? "active" : ""}" data-day="${h(d)}">${h(formatDate(d, "short"))}</button>`).join("")}
    `;
  }

  function renderHistory() {
    const el = $("historyList");
    const filtered = selectedDay === "all" ? runtime.matches : runtime.matches.filter(m => m.date === selectedDay);
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">Pro tenhle den nic. Kalendář si dal pauzu.</div>`;
      return;
    }
    const byDay = {};
    filtered.forEach(m => { (byDay[m.date] ||= []).push(m); });
    el.innerHTML = Object.keys(byDay).sort().map(day => `
      <div class="history-day-title">${h(formatDate(day))}</div>
      ${byDay[day].map(renderHistoryMatch).join("")}
    `).join("");
  }

  function renderHistoryMatch(match) {
    const matchTips = state.tips.filter(t => Number(t.match_id) === Number(match.id));
    const played = hasScore(match);
    const tipsHtml = matchTips.length
      ? `<table class="modal-table"><thead><tr><th>Hráč</th><th>Tip</th><th>Body</th></tr></thead><tbody>${matchTips.map(t => {
          const pts = played ? matchPoints(match, t) : "-";
          return `<tr><td>${h(t.player)}</td><td>${h(t.home)} : ${h(t.away)}</td><td>${pts === "-" ? "-" : `<span class="points-good">${pts} b</span>`}</td></tr>`;
        }).join("")}</tbody></table>`
      : `<div class="small-meta">Zatím žádné tipy.</div>`;
    return `<div class="history-match-card">
      <div class="history-match-header">
        <div>${teamHtml(match.home)} <div class="score">${scoreHtml(match)}</div> ${teamHtml(match.away, "away")}</div>
        <div class="small-meta">${h(match.time)} · ${h(match.round)}</div>
      </div>
      <div class="history-tips">${tipsHtml}</div>
    </div>`;
  }

  function computeGroupTables() {
    const tables = {};
    Object.entries(runtime.groups || {}).forEach(([group, teams]) => {
      tables[group] = teams.map(team => ({ team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
    });
    const findTeam = (group, team) => tables[group]?.find(t => t.team === team);
    runtime.matches.filter(m => m.stage === "Group" && hasScore(m)).forEach(m => {
      const home = findTeam(m.group, m.home);
      const away = findTeam(m.group, m.away);
      if (!home || !away) return;
      const hg = Number(m.home_goals), ag = Number(m.away_goals);
      home.p++; away.p++;
      home.gf += hg; home.ga += ag; away.gf += ag; away.ga += hg;
      home.gd = home.gf - home.ga; away.gd = away.gf - away.ga;
      if (hg > ag) { home.w++; away.l++; home.pts += 3; }
      else if (hg < ag) { away.w++; home.l++; away.pts += 3; }
      else { home.d++; away.d++; home.pts += 1; away.pts += 1; }
    });
    Object.values(tables).forEach(rows => rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team, "cs")));
    return tables;
  }

  function renderGroups() {
    const tables = computeGroupTables();
    $("groupsList").innerHTML = `<div class="groups-grid">${GROUPS.map(group => `
      <div class="group-card"><h3>Skupina ${h(group)}</h3>
        <table class="group-table">
          <thead><tr><th>Tým</th><th>Z</th><th>Skóre</th><th>Body</th></tr></thead>
          <tbody>${(tables[group] || []).map((r, i) => `<tr class="${i < 2 ? "qualified" : i === 2 ? "third-place" : ""}"><td>${h(flag(r.team))} ${h(r.team)}</td><td>${r.p}</td><td>${r.gf}:${r.ga}</td><td><strong>${r.pts}</strong></td></tr>`).join("")}</tbody>
        </table>
      </div>`).join("")}</div>`;
  }

  function renderPredictions() {
    const preds = state.predictions || {};
    const tr = state.tournamentResults || {};
    const rows = runtime.players.map(p => {
      const pred = preds[p.name] || {};
      return { player: p.name, pred, groupPts: groupPredictionPoints(pred), bonus: predictionBonus(pred) };
    });
    const cell = (value, real) => `<td class="${value && real && value === real ? "correct" : ""}">${h(value || "-")}</td>`;
    $("predictionsList").innerHTML = `<div class="predictions-wrapper">
      <table class="pred-table"><thead><tr><th>Hráč</th><th>Vítěz</th><th>2.</th><th>3.</th><th>Střelec</th><th>Hráč</th><th>Mladý</th><th>Gólman</th><th>CZ střelec</th><th>Body</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${h(r.player)}</td>${cell(r.pred.champion, tr.champion)}${cell(r.pred.second, tr.second)}${cell(r.pred.third, tr.third)}${cell(r.pred.topScorer, tr.topScorer)}${cell(r.pred.bestPlayer, tr.bestPlayer)}${cell(r.pred.bestYoung, tr.bestYoung)}${cell(r.pred.bestGoalkeeper, tr.bestGoalkeeper)}${cell(r.pred.bestCzechScorer, tr.bestCzechScorer)}<td>${r.bonus}</td></tr>`).join("")}
        <tr class="real-row"><td>REALITA</td><td>${h(tr.champion || "-")}</td><td>${h(tr.second || "-")}</td><td>${h(tr.third || "-")}</td><td>${h(tr.topScorer || "-")}</td><td>${h(tr.bestPlayer || "-")}</td><td>${h(tr.bestYoung || "-")}</td><td>${h(tr.bestGoalkeeper || "-")}</td><td>${h(tr.bestCzechScorer || "-")}</td><td>—</td></tr>
      </tbody></table>
      <div style="height:14px"></div>
      <table class="pred-table"><thead><tr><th>Hráč</th>${GROUPS.map(g => `<th>${h(g)}</th>`).join("")}<th>Body</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${h(r.player)}</td>${GROUPS.map(g => `<td class="${r.pred.groups?.[g] && state.groupResults[g] && r.pred.groups[g] === state.groupResults[g] ? "correct" : ""}">${h(r.pred.groups?.[g] || "-")}</td>`).join("")}<td>${r.groupPts}</td></tr>`).join("")}
        <tr class="real-row"><td>REALITA</td>${GROUPS.map(g => `<td>${h(state.groupResults[g] || "-")}</td>`).join("")}<td>—</td></tr>
      </tbody></table>
    </div>`;
  }

  function openMatch(matchId) {
    const match = runtime.matches.find(m => Number(m.id) === Number(matchId));
    if (!match) return;
    const user = currentUser();
    const tip = getMyTip(match.id);
    const played = hasScore(match);
    const openForTips = canTip(match);
    $("modalTitle").innerHTML = `
      <div class="modal-title-teams">
        <div>${h(flag(match.home))} ${h(match.home)}</div>
        <div class="modal-score">${scoreHtml(match)}</div>
        <div>${h(flag(match.away))} ${h(match.away)}</div>
      </div>
      <div class="modal-meta">${h(formatDate(match.date))} · ${h(match.time)} · ${h(match.round)}</div>`;

    let html = "";
    if (!user) {
      html += `<div class="tip-form"><strong>Nejdřív se přihlas.</strong><br><span class="small-meta">Bez jména je tipování jen anonymní chaos. Ten už máme na internetu dost.</span></div>`;
    } else if (openForTips) {
      html += `<div class="tip-form">
        <strong>Můj tip jako ${h(user.name)}</strong>
        <div class="my-tip-inputs"><input id="myHomeTip" type="number" min="0" value="${h(tip?.home ?? "")}" /><span>:</span><input id="myAwayTip" type="number" min="0" value="${h(tip?.away ?? "")}" /></div>
        <button class="save-btn" id="saveMatchTipBtn" data-match-id="${match.id}">Uložit tip</button>
      </div>`;
    } else {
      html += `<div class="tip-form"><strong>Tipování uzavřeno.</strong><br><span class="small-meta">Výkop už proběhl. Čas, ten malý tyran, zvítězil.</span></div>`;
    }

    const matchTips = state.tips.filter(t => Number(t.match_id) === Number(match.id));
    const canSeeAll = played || !openForTips;
    if (!canSeeAll) {
      html += `<div class="empty-state">Tipy ostatních se zobrazí po výkopu.</div>`;
    } else if (matchTips.length) {
      html += `<table class="modal-table"><thead><tr><th>Hráč</th><th>Tip</th><th>Body</th></tr></thead><tbody>${matchTips.map(t => {
        const pts = played ? matchPoints(match, t) : "-";
        return `<tr><td>${h(t.player)}</td><td>${h(t.home)} : ${h(t.away)}</td><td>${pts === "-" ? "-" : `<span class="points-good">${pts} b</span>`}</td></tr>`;
      }).join("")}</tbody></table>`;
    } else {
      html += `<div class="empty-state">Zatím žádné tipy.</div>`;
    }
    $("modalBody").innerHTML = html;
    $("matchModal").classList.remove("hidden");
  }

  async function saveMatchTip(matchId) {
    const user = currentUser();
    if (!user) return showToast("Nejprve se přihlas.", "error");
    const match = runtime.matches.find(m => Number(m.id) === Number(matchId));
    if (!match || !canTip(match)) return showToast("Tipování už je zavřené.", "error");
    const home = Number($("myHomeTip").value);
    const away = Number($("myAwayTip").value);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return showToast("Vyplň normální skóre. Futurismus nechme FIFA.", "error");
    const payload = { match_id: Number(matchId), player: user.name, home, away };
    const idx = state.tips.findIndex(t => Number(t.match_id) === Number(matchId) && t.player === user.name);
    if (idx >= 0) state.tips[idx] = payload; else state.tips.push(payload);
    try {
      if (isGoogleMode()) await postRecord("tips", payload);
      saveLocal();
      showToast("Tip uložen.");
      closeMatchModal();
      await loadData();
    } catch (err) {
      console.error(err); showToast("Tip se nepodařilo uložit.", "error");
    }
  }

  function openLoginModal() {
    $("loginModal").classList.remove("hidden");
    setTimeout(() => $("loginName").focus(), 30);
  }
  function closeLoginModal() { $("loginModal").classList.add("hidden"); }
  function closeMatchModal() { $("matchModal").classList.add("hidden"); }
  function closePredictionsModal() { $("predictionsModal").classList.add("hidden"); }
  function closeAdminModal() { $("adminModal").classList.add("hidden"); }

  function normalizeName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function loginUser() {
    const name = $("loginName").value.trim();
    const pin = $("loginPin").value.trim();
    const wanted = normalizeName(name);
    const player = runtime.players.find(p => (p.name === name || normalizeName(p.name) === wanted) && String(p.pin) === pin);
    if (!player) return showToast("Špatné jméno nebo PIN.", "error");
    localStorage.setItem(USER_KEY, JSON.stringify({ name: player.name }));
    closeLoginModal();
    updateUserBadge();
    renderAll();
    showToast(`Přihlášen: ${player.name}`);
  }

  function logoutUser() {
    localStorage.removeItem(USER_KEY);
    updateUserBadge();
    renderAll();
  }

  function updateUserBadge() {
    const playerList = $("playersList");
    if (playerList) playerList.innerHTML = runtime.players.map(p => `<option value="${h(p.name)}"></option>`).join("");
    const user = currentUser();
    $("userBadge").innerHTML = user ? `<span class="user-badge">👤 ${h(user.name)} <button class="icon-button" id="logoutButton" title="Odhlásit">×</button></span>` : "";
  }

  function openPredictionsModal() {
    const user = currentUser();
    if (!user) return openLoginModal();
    const pred = state.predictions[user.name] || { groups: {} };
    $("predictionsModalBody").innerHTML = renderPredictionForm(user.name, pred);
    $("predictionsModal").classList.remove("hidden");
    setPredictionTab(activePredTab);
  }

  function optionsHtml(selected = "") {
    return `<option value="">— vyber —</option>${TEAM_LIST.map(t => `<option value="${h(t)}" ${selected === t ? "selected" : ""}>${h(flag(t))} ${h(t)}</option>`).join("")}`;
  }

  function renderPredictionForm(player, pred) {
    return `
      <div class="tab-bar">
        <button class="tab-btn" data-pred-tab="general">Turnaj</button>
        <button class="tab-btn" data-pred-tab="individual">Individuální</button>
        <button class="tab-btn" data-pred-tab="groups">Skupiny</button>
      </div>
      <div id="pred-tab-general" class="pred-tab">
        <div class="pred-form">
          <div class="form-section-title">Celkové pořadí · ${h(player)}</div>
          <div><label>Vítěz turnaje</label><select id="pred-champion">${optionsHtml(pred.champion)}</select></div>
          <div><label>2. místo</label><select id="pred-second">${optionsHtml(pred.second)}</select></div>
          <div><label>3. místo</label><select id="pred-third">${optionsHtml(pred.third)}</select></div>
        </div>
      </div>
      <div id="pred-tab-individual" class="pred-tab hidden">
        <div class="pred-form">
          <div><label>Nejlepší střelec</label><input id="pred-topScorer" value="${h(pred.topScorer || "")}" placeholder="Jméno hráče" /></div>
          <div><label>Nejlepší hráč</label><input id="pred-bestPlayer" value="${h(pred.bestPlayer || "")}" placeholder="Jméno hráče" /></div>
          <div><label>Nejlepší mladý hráč</label><input id="pred-bestYoung" value="${h(pred.bestYoung || "")}" placeholder="Jméno hráče" /></div>
          <div><label>Nejlepší gólman</label><input id="pred-bestGoalkeeper" value="${h(pred.bestGoalkeeper || "")}" placeholder="Jméno hráče" /></div>
          <div><label>Nejlepší český střelec</label><input id="pred-bestCzechScorer" value="${h(pred.bestCzechScorer || "")}" placeholder="Jméno hráče" /></div>
        </div>
      </div>
      <div id="pred-tab-groups" class="pred-tab hidden">
        <div class="groups-pred-grid">
          ${GROUPS.map(g => `<div class="group-select-card"><label>Skupina ${h(g)}</label><select id="group-${h(g)}"><option value="">— vyber —</option>${(runtime.groups[g] || []).map(t => `<option value="${h(t)}" ${(pred.groups?.[g] || "") === t ? "selected" : ""}>${h(flag(t))} ${h(t)}</option>`).join("")}</select></div>`).join("")}
        </div>
      </div>
      <div style="margin-top:16px"><button class="save-btn" id="savePredictionsBtn">Uložit predikce</button></div>`;
  }

  function setPredictionTab(tab) {
    activePredTab = tab;
    document.querySelectorAll("[data-pred-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.predTab === tab));
    document.querySelectorAll(".pred-tab").forEach(el => el.classList.add("hidden"));
    $(`pred-tab-${tab}`)?.classList.remove("hidden");
  }

  async function savePredictions() {
    const user = currentUser();
    if (!user) return showToast("Nejprve se přihlas.", "error");
    const pred = {
      champion: $("pred-champion")?.value || "",
      second: $("pred-second")?.value || "",
      third: $("pred-third")?.value || "",
      topScorer: $("pred-topScorer")?.value.trim() || "",
      bestPlayer: $("pred-bestPlayer")?.value.trim() || "",
      bestYoung: $("pred-bestYoung")?.value.trim() || "",
      bestGoalkeeper: $("pred-bestGoalkeeper")?.value.trim() || "",
      bestCzechScorer: $("pred-bestCzechScorer")?.value.trim() || "",
      groups: {}
    };
    GROUPS.forEach(g => pred.groups[g] = $(`group-${g}`)?.value || "");
    state.predictions[user.name] = pred;
    const payload = {
      player: user.name,
      champion: pred.champion, second: pred.second, third: pred.third,
      top_scorer: pred.topScorer, best_player: pred.bestPlayer, best_young: pred.bestYoung,
      best_gk: pred.bestGoalkeeper, best_czech_scorer: pred.bestCzechScorer,
      ...pred.groups
    };
    try {
      if (isGoogleMode()) await postRecord("predictions", payload);
      saveLocal();
      closePredictionsModal();
      showToast("Predikce uloženy.");
      await loadData();
    } catch (err) { console.error(err); showToast("Predikce se nepodařilo uložit.", "error"); }
  }

  function openAdminModal() {
    renderAdminModal();
    $("adminModal").classList.remove("hidden");
  }

  function renderAdminModal() {
    $("adminModalBody").innerHTML = `
      <div class="tab-bar">
        <button class="tab-btn" data-admin-tab="scores">Skóre zápasů</button>
        <button class="tab-btn" data-admin-tab="tournament">Turnajová realita</button>
        <button class="tab-btn" data-admin-tab="tools">Nástroje</button>
      </div>
      <div id="admin-tab-scores" class="admin-tab">${renderAdminScores()}</div>
      <div id="admin-tab-tournament" class="admin-tab hidden">${renderAdminTournament()}</div>
      <div id="admin-tab-tools" class="admin-tab hidden">${renderAdminTools()}</div>`;
    setAdminTab(activeAdminTab);
  }

  function renderAdminScores() {
    return `<div class="admin-toolbar"><button class="save-btn" id="saveResultsBtn">Uložit výsledky</button></div>
      <div class="admin-table-wrap"><table class="modal-table"><thead><tr><th>#</th><th>Datum</th><th>Fáze</th><th>Zápas</th><th>Skóre</th></tr></thead><tbody>
        ${runtime.matches.map(m => `<tr class="admin-score-row"><td>${m.id}</td><td>${h(formatDate(m.date, "short"))} ${h(m.time)}</td><td>${h(m.round)}</td><td>${h(m.home)} vs ${h(m.away)}</td><td><input class="score-input admin-home" data-id="${m.id}" type="number" min="0" value="${h(m.home_goals)}" /> : <input class="score-input admin-away" data-id="${m.id}" type="number" min="0" value="${h(m.away_goals)}" /></td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function renderAdminTournament() {
    const tr = state.tournamentResults || {};
    const input = (id, label) => `<div><label>${label}</label><input class="admin-input" id="real-${id}" value="${h(tr[id] || "")}" /></div>`;
    return `<div class="pred-form">
      <div class="form-section-title">Turnajové výsledky</div>
      ${input("champion", "Vítěz")}${input("second", "2. místo")}${input("third", "3. místo")}
      ${input("topScorer", "Nejlepší střelec")}${input("bestPlayer", "Nejlepší hráč")}${input("bestYoung", "Nejlepší mladý hráč")}${input("bestGoalkeeper", "Nejlepší gólman")}${input("bestCzechScorer", "Nejlepší český střelec")}
      <div class="form-section-title">Vítězové skupin</div>
      ${GROUPS.map(g => `<div><label>Skupina ${h(g)}</label><select class="admin-input" id="real-group-${h(g)}"><option value="">— vyber —</option>${(runtime.groups[g] || []).map(t => `<option value="${h(t)}" ${state.groupResults[g] === t ? "selected" : ""}>${h(flag(t))} ${h(t)}</option>`).join("")}</select></div>`).join("")}
      <div style="grid-column:1/-1"><button class="save-btn" id="saveTournamentBtn">Uložit realitu</button></div>
    </div>`;
  }

  function renderAdminTools() {
    return `<p class="small-meta">Lokální režim ukládá data jen v tomhle prohlížeči. Export/import je tu proto, aby vaše tipovačka nezmizela při prvním digitálním kýchnutí.</p>
      <div class="admin-toolbar"><button class="save-btn" id="exportButtonAdmin">Export dat</button><button class="danger-btn" id="resetLocalBtn">Smazat lokální data</button></div>`;
  }

  function setAdminTab(tab) {
    activeAdminTab = tab;
    document.querySelectorAll("[data-admin-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.adminTab === tab));
    document.querySelectorAll(".admin-tab").forEach(el => el.classList.add("hidden"));
    $(`admin-tab-${tab}`)?.classList.remove("hidden");
  }

  async function saveResultsFromAdmin() {
    const updates = [];
    runtime.matches.forEach(m => {
      const homeEl = document.querySelector(`.admin-home[data-id="${m.id}"]`);
      const awayEl = document.querySelector(`.admin-away[data-id="${m.id}"]`);
      const home = homeEl?.value === "" ? "" : Number(homeEl.value);
      const away = awayEl?.value === "" ? "" : Number(awayEl.value);
      if (home === "" && away === "") delete state.results[m.id];
      else if (Number.isInteger(home) && Number.isInteger(away) && home >= 0 && away >= 0) state.results[m.id] = { home, away };
      else if (!(home === "" && away === "")) return;
      updates.push({ id: m.id, home_goals: home, away_goals: away });
    });
    try {
      if (isGoogleMode()) await Promise.all(updates.map(u => postRecord("matches", u)));
      saveLocal();
      hydrateResultsIntoMatches();
      renderAll();
      showToast("Výsledky uloženy.");
    } catch (err) { console.error(err); showToast("Výsledky se nepodařilo uložit.", "error"); }
  }

  async function saveTournamentReality() {
    const keys = ["champion", "second", "third", "topScorer", "bestPlayer", "bestYoung", "bestGoalkeeper", "bestCzechScorer"];
    keys.forEach(k => state.tournamentResults[k] = $(`real-${k}`)?.value.trim() || "");
    GROUPS.forEach(g => state.groupResults[g] = $(`real-group-${g}`)?.value || "");
    try {
      if (isGoogleMode()) {
        await Promise.all([
          ...keys.map(k => postRecord("tournament_results", { category: k, value: state.tournamentResults[k] || "" })),
          ...GROUPS.map(g => postRecord("group_results", { group: g, winner: state.groupResults[g] || "" }))
        ]);
      }
      saveLocal();
      renderAll();
      showToast("Realita uložena. Bohužel stále realita.");
    } catch (err) { console.error(err); showToast("Realita se nepodařila uložit.", "error"); }
  }

  function exportState() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "Mundial Tipovačka 2026",
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tipovacka-2026-data-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importStateFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state = { ...defaultState(), ...(parsed.state || parsed) };
      saveLocal();
      renderAll();
      showToast("Data importována.");
    } catch (err) { console.error(err); showToast("Import selhal. JSON se tváří uraženě.", "error"); }
  }

  function resetLocalData() {
    if (!confirm("Smazat lokální tipy, výsledky a predikce?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    renderAll();
    showToast("Lokální data smazána.");
  }

  function showToast(message, type = "success") {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = `toast ${type}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function bindEvents() {
    $("loginButton").addEventListener("click", openLoginModal);
    $("predictionsButton").addEventListener("click", openPredictionsModal);
    $("adminButton").addEventListener("click", openAdminModal);
    $("exportButton").addEventListener("click", exportState);
    $("importFile").addEventListener("change", e => importStateFile(e.target.files?.[0]));
    $("loginSubmit").addEventListener("click", loginUser);
    $("closeLoginModal").addEventListener("click", closeLoginModal);
    $("closeMatchModal").addEventListener("click", closeMatchModal);
    $("closePredictionsModal").addEventListener("click", closePredictionsModal);
    $("closeAdminModal").addEventListener("click", closeAdminModal);

    ["loginModal", "matchModal", "predictionsModal", "adminModal"].forEach(id => {
      $(id).addEventListener("click", e => { if (e.target.id === id) $(id).classList.add("hidden"); });
    });

    document.addEventListener("click", e => {
      const card = e.target.closest(".match-card[data-match-id]");
      if (card) openMatch(card.dataset.matchId);
      const filter = e.target.closest(".filter[data-day]");
      if (filter) { selectedDay = filter.dataset.day; renderDayFilter(); renderHistory(); }
      const saveTip = e.target.closest("#saveMatchTipBtn");
      if (saveTip) saveMatchTip(saveTip.dataset.matchId);
      const tab = e.target.closest("[data-pred-tab]");
      if (tab) setPredictionTab(tab.dataset.predTab);
      const adminTab = e.target.closest("[data-admin-tab]");
      if (adminTab) setAdminTab(adminTab.dataset.adminTab);
      if (e.target.id === "savePredictionsBtn") savePredictions();
      if (e.target.id === "saveResultsBtn") saveResultsFromAdmin();
      if (e.target.id === "saveTournamentBtn") saveTournamentReality();
      if (e.target.id === "logoutButton") logoutUser();
      if (e.target.id === "exportButtonAdmin") exportState();
      if (e.target.id === "resetLocalBtn") resetLocalData();
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { closeMatchModal(); closeLoginModal(); closePredictionsModal(); closeAdminModal(); }
      if (e.key === "Enter" && !$("loginModal").classList.contains("hidden")) loginUser();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadData();
    if (CONFIG.refreshMs && isGoogleMode()) setInterval(loadData, Number(CONFIG.refreshMs));
  });
})();
