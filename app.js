'use strict';

// ---------- Storage ----------

const STORE_KEY = 'roadToScratch.v1';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Starting emphasis before any rounds are logged, from Spencer's own read of his game.
const PRIOR_WEIGHTS = { tee: 0.22, approach: 0.18, short: 0.30, putt: 0.30 };

// Rough per-18 numbers for a scratch golfer. Estimates, not tour data.
const SCRATCH = { fwPct: 0.55, gir: 10.5, putts: 29.5, udPct: 0.55, teePen: 0.3 };

function defaultState() {
  return {
    version: 1,
    profile: { startIndex: 11.0, startDate: '2026-10-28', goalIndex: 0, goalDate: '2027-10-31', minutes: 60 },
    // Matches the Fitbod plan's week. minutes: null means the profile default.
    week: [
      { venue: 'home',      body: 'liftA',    minutes: null }, // Mon: putting and chipping
      { venue: 'range',     body: 'liftB',    minutes: null }, // Tue: full swing
      { venue: 'shortgame', body: 'walkmob',  minutes: null }, // Wed: inside 100 yd
      { venue: 'sim',       body: 'liftC',    minutes: null }, // Thu: full swing or sim round
      { venue: 'home',      body: 'liftD',    minutes: 30 },   // Fri: light short game, putting
      { venue: 'course',    body: 'rest',     minutes: null }, // Sat: round or sim round
      { venue: 'home',      body: 'mobility', minutes: 20 },   // Sun: optional putting
    ],
    overrides: {},  // date -> venue
    rounds: [],
    sessions: {},   // date -> { venue, blocks: [{ key, minutes, score, done }], notes }
    indexHistory: [
      { date: '2026-06-01', value: 15.7 },
      { date: '2026-10-28', value: 11.0 },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* fall through to defaults */ }
  return defaultState();
}

let state = load();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save. Export your data from Setup.'); }
}

// ---------- Dates ----------

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const weekdayIdx = s => (parseYmd(s).getDay() + 6) % 7;  // Mon = 0
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const fmtDate = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const mondayOf = s => addDays(s, -weekdayIdx(s));

// ---------- Strokes-lost model ----------

// Estimated strokes lost to a scratch golfer, per area, normalised to 18 holes.
// Sim rounds skip putting and short game unless putting was played out for real.
function strokesLost(r) {
  const f = 18 / (r.holes || 18);
  const out = {};
  if (r.fwPossible > 0) {
    const fwPct = r.fwHit / r.fwPossible;
    out.tee = (SCRATCH.fwPct - fwPct) * 14 * 0.3 + (r.teePen * f - SCRATCH.teePen) * 1.2;
  } else {
    out.tee = (r.teePen * f - SCRATCH.teePen) * 1.2;
  }
  out.approach = (SCRATCH.gir - r.gir * f) * 0.5 + r.otherPen * f;
  const realGreens = r.type === 'course' || r.simRealPutting;
  if (realGreens) {
    if (r.udAttempts > 0) out.short = (SCRATCH.udPct - r.udMade / r.udAttempts) * r.udAttempts * f * 0.8;
    const expectedPutts = SCRATCH.putts + (r.gir * f - SCRATCH.gir) * 0.25;
    out.putt = r.putts * f - expectedPutts;
  }
  return out;
}

// Average strokes lost per area over recent rounds. Course rounds count double a sim round.
function recentLoss(n = 8) {
  const rounds = [...state.rounds].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  const sum = {}, wt = {};
  for (const r of rounds) {
    const w = r.type === 'course' ? 1 : 0.5;
    const sl = strokesLost(r);
    for (const k in sl) { sum[k] = (sum[k] || 0) + sl[k] * w; wt[k] = (wt[k] || 0) + w; }
  }
  const avg = {};
  for (const k of Object.keys(AREAS)) avg[k] = wt[k] ? sum[k] / wt[k] : null;
  const evidence = rounds.reduce((s, r) => s + (r.type === 'course' ? 1 : 0.5), 0);
  return { avg, evidence, count: rounds.length };
}

// Practice weights: start from the prior, shift toward measured losses as rounds accumulate.
function planWeights() {
  const { avg, evidence } = recentLoss();
  const k = 3;
  const trust = evidence / (evidence + k);
  const data = {};
  let total = 0;
  for (const a in AREAS) {
    // Areas without data keep their prior share. A floor keeps every area in rotation.
    const v = avg[a] == null ? PRIOR_WEIGHTS[a] * 4 : Math.max(avg[a], 0) + 0.3;
    data[a] = v; total += v;
  }
  const w = {};
  let sum = 0;
  for (const a in AREAS) {
    w[a] = PRIOR_WEIGHTS[a] * (1 - trust) + (data[a] / total) * trust;
    w[a] = Math.max(w[a], 0.08);
    sum += w[a];
  }
  for (const a in w) w[a] /= sum;
  return { weights: w, trust };
}

// ---------- Plan generation ----------

function venueFor(date) {
  return state.overrides[date] || state.week[weekdayIdx(date)].venue;
}

function dayNumber(date) { return Math.floor(parseYmd(date).getTime() / 86400000); }

function pickDrill(area, venue, date, salt) {
  const list = DRILLS.filter(d => d.area === area && d.venues.includes(venue));
  if (!list.length) return null;
  return list[(dayNumber(date) + salt) % list.length];
}

function minutesFor(date) {
  return state.week[weekdayIdx(date)].minutes || state.profile.minutes;
}

// Fitbod rule: the day before a round is mobility plus putting only.
function isRoundDay(date) { return venueFor(date) === 'course'; }

function buildPlan(date) {
  const venue = venueFor(date);
  const v = VENUES[venue];
  let minutes = minutesFor(date);
  if (venue === 'rest') return [{ key: 'rest', minutes: 0 }];
  if (venue === 'course') return [{ key: 'warmup', minutes: 12 }, { key: 'course', minutes: 0 }];
  if (isRoundDay(addDays(date, 1)) && !v.fullSwing) {
    const drill = pickDrill('putt', venue, date, 0);
    return drill ? [{ key: drill.id, minutes: Math.min(minutes, 30) }] : [{ key: 'rest', minutes: 0 }];
  }

  const blocks = [];
  if (v.fullSwing) { blocks.push({ key: 'warmup', minutes: 15 }); minutes -= 15; }

  // Restrict weights to what this venue supports. No-ball swing work at home is
  // useful but less valuable than putting and chipping, so it gets a smaller share.
  const { weights } = planWeights();
  const local = {};
  let sum = 0;
  for (const a of v.areas) {
    let w = weights[a];
    if (venue === 'home' && (a === 'tee' || a === 'approach')) w *= 0.35;
    // Range and sim time is best spent on full swing; wedges get a fixed small slice.
    if (v.fullSwing && a === 'short') w *= 0.5;
    local[a] = w; sum += w;
  }

  // Keep at most three blocks of at least 10 minutes each.
  let areas = Object.keys(local).sort((a, b) => local[b] - local[a]);
  while (areas.length > 1) {
    const s = areas.reduce((t, a) => t + local[a], 0);
    const smallest = areas[areas.length - 1];
    if (areas.length > 3 || (local[smallest] / s) * minutes < 10) areas.pop();
    else break;
  }
  const s = areas.reduce((t, a) => t + local[a], 0);
  let alloc = areas.map(a => ({ a, m: Math.max(10, Math.round((local[a] / s) * minutes / 5) * 5) }));
  let diff = minutes - alloc.reduce((t, x) => t + x.m, 0);
  alloc[0].m += diff;

  alloc.forEach((x, i) => {
    const drill = pickDrill(x.a, venue, date, i);
    if (drill) blocks.push({ key: drill.id, minutes: x.m });
  });
  return blocks;
}

function sessionFor(date) {
  const venue = venueFor(date);
  const existing = state.sessions[date];
  if (existing && existing.venue === venue) return existing;
  return { venue, blocks: buildPlan(date).map(b => ({ ...b, score: null, done: false })), notes: '' };
}

function blockInfo(key) {
  if (BLOCK_EXTRAS[key]) return { ...BLOCK_EXTRAS[key], area: null, score: null };
  return DRILLS.find(d => d.id === key);
}

// ---------- Rendering helpers ----------

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = n => (n == null || isNaN(n)) ? '–' : (Math.round(n * 10) / 10).toFixed(1);
const pct = n => (n == null || isNaN(n)) ? '–' : Math.round(n * 100) + '%';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function areaChip(a) {
  if (!a) return '';
  return `<span class="chip" style="--chip:${AREAS[a].color}">${AREAS[a].short}</span>`;
}

function stepper(name, value, min = 0, max = 99) {
  return `<div class="stepper" data-name="${name}" data-min="${min}" data-max="${max}">
    <button type="button" data-step="-1" aria-label="minus">−</button>
    <input type="number" inputmode="numeric" name="${name}" value="${value}" min="${min}" max="${max}">
    <button type="button" data-step="1" aria-label="plus">+</button>
  </div>`;
}

function goalLine() {
  const days = daysBetween(today(), state.profile.goalDate);
  const latest = state.indexHistory.length ? state.indexHistory[state.indexHistory.length - 1].value : state.profile.startIndex;
  $('#goal-line').textContent = `Index ${fmt1(latest)} · goal ${fmt1(state.profile.goalIndex)} · ${days} days left`;
}

// ---------- Views ----------

let tab = 'today';
let viewDate = today();

function render() {
  goalLine();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const views = { today: renderToday, week: renderWeek, log: renderLog, progress: renderProgress, settings: renderSettings };
  $('#view').innerHTML = views[tab]();
  window.scrollTo(0, 0);
}

function renderToday() {
  const date = viewDate;
  const sess = sessionFor(date);
  const dayCfg = state.week[weekdayIdx(date)];
  const isToday = date === today();
  const venueOpts = Object.entries(VENUES).map(([k, v]) =>
    `<option value="${k}" ${k === sess.venue ? 'selected' : ''}>${v.name}</option>`).join('');
  const totalMin = sess.blocks.reduce((t, b) => t + (b.minutes || 0), 0);
  const doneCount = sess.blocks.filter(b => b.done).length;

  const bodyNote = bodyLabel(date);
  const warns = fitnessWarnings(date).map(w => `<p class="note">${esc(w)}</p>`).join('');

  const blocks = sess.blocks.map((b, i) => {
    const info = blockInfo(b.key);
    if (!info) return '';
    const scoreInput = info.score ? `
      <label class="score">
        <span>${esc(info.score.label)}${info.score.lowerBetter ? ' (lower is better)' : ` (of ${info.score.max})`}</span>
        ${stepper(`score-${i}`, b.score ?? '', 0, info.score.max || 99)}
      </label>` : '';
    return `<article class="card block ${b.done ? 'done' : ''}">
      <header>
        <div>${areaChip(info.area)} ${b.minutes ? `<span class="mins">${b.minutes} min</span>` : ''}</div>
        <label class="check"><input type="checkbox" data-done="${i}" ${b.done ? 'checked' : ''}> Done</label>
      </header>
      <h3>${esc(info.name)}</h3>
      <p class="how">${esc(info.how)}</p>
      ${scoreInput}
    </article>`;
  }).join('');

  return `
    <section class="daybar">
      <button class="ghost" data-nav="-1" aria-label="Previous day">‹</button>
      <div class="center">
        <strong>${isToday ? 'Today' : fmtDate(date)}</strong>
        <span class="sub">${isToday ? fmtDate(date) : ''}</span>
      </div>
      <button class="ghost" data-nav="1" aria-label="Next day">›</button>
    </section>

    <section class="card summary">
      <label class="row">
        <span>Where</span>
        <select id="venue-select">${venueOpts}</select>
      </label>
      <div class="row"><span>Body</span><span>${esc(bodyNote)}</span></div>
      <div class="row"><span>Plan</span><span>${totalMin ? totalMin + ' min · ' : ''}${doneCount}/${sess.blocks.length} done</span></div>
      ${warns}
    </section>

    ${blocks}

    <section class="card">
      <label class="stack"><span>Notes</span>
        <textarea id="sess-notes" rows="2" placeholder="What felt good, what to fix">${esc(sess.notes)}</textarea>
      </label>
      <button class="primary wide" id="save-session">Save session</button>
    </section>`;
}

function renderWeek() {
  const start = mondayOf(viewDate);
  const { weights, trust } = planWeights();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const sess = sessionFor(d);
    const cfg = state.week[i];
    const items = sess.blocks.map(b => {
      const info = blockInfo(b.key);
      return `<li class="${b.done ? 'done' : ''}">${areaChip(info.area)} ${esc(info.name)}${b.minutes ? ` <span class="mins">${b.minutes}m</span>` : ''}</li>`;
    }).join('');
    days.push(`<article class="card day ${d === today() ? 'is-today' : ''}" data-open="${d}">
      <header><strong>${fmtDate(d)}</strong><span class="sub">${VENUES[sess.venue].name} · ${esc(bodyLabel(d, true))}</span></header>
      <ul class="plain">${items}</ul>
    </article>`);
  }

  const bars = Object.keys(AREAS).map(a => `
    <div class="bar-row"><span>${AREAS[a].name}</span>
      <div class="bar"><i style="width:${Math.round(weights[a] * 100)}%;background:${AREAS[a].color}"></i></div>
      <b>${pct(weights[a])}</b></div>`).join('');

  return `
    <section class="daybar">
      <button class="ghost" data-week="-7" aria-label="Previous week">‹</button>
      <div class="center"><strong>Week of ${fmtDate(start)}</strong></div>
      <button class="ghost" data-week="7" aria-label="Next week">›</button>
    </section>
    <p class="sub center">${esc(phaseLine(start))}</p>
    <section class="card">
      <h2>Practice focus</h2>
      ${bars}
      <p class="sub">${trust < 0.05
        ? 'Based on your own read of your game. Log rounds and this shifts toward where you lose strokes.'
        : `Weighted ${Math.round(trust * 100)}% on your logged rounds, the rest on your starting read.`}</p>
    </section>
    ${days.join('')}
    <p class="sub center">Tap a day to open it. Change your usual week in Setup.</p>`;
}

function roundForm() {
  return `
  <form id="round-form" class="card">
    <h2>Log a round</h2>
    <div class="grid2">
      <label class="stack"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
      <label class="stack"><span>Type</span>
        <select name="type"><option value="course">Course</option><option value="sim">Simulator</option></select></label>
      <label class="stack"><span>Holes</span>
        <select name="holes"><option>18</option><option>9</option></select></label>
      <label class="stack"><span>Course</span><input name="course" placeholder="optional"></label>
    </div>
    <div class="grid2">
      <label class="stack"><span>Score</span>${stepper('score', 85, 20, 150)}</label>
      <label class="stack"><span>Par</span>${stepper('par', 72, 27, 80)}</label>
    </div>

    <h3>Off the tee</h3>
    <div class="grid2">
      <label class="stack"><span>Fairways hit</span>${stepper('fwHit', 7, 0, 18)}</label>
      <label class="stack"><span>Fairway holes</span>${stepper('fwPossible', 14, 0, 18)}</label>
      <label class="stack"><span>Missed left</span>${stepper('missLeft', 0, 0, 18)}</label>
      <label class="stack"><span>Missed right</span>${stepper('missRight', 0, 0, 18)}</label>
      <label class="stack"><span>Tee penalty strokes</span>${stepper('teePen', 0, 0, 20)}</label>
    </div>

    <h3>Approach</h3>
    <div class="grid2">
      <label class="stack"><span>Greens in reg</span>${stepper('gir', 6, 0, 18)}</label>
      <label class="stack"><span>Fat or thin shots</span>${stepper('poorContact', 0, 0, 40)}</label>
      <label class="stack"><span>Other penalty strokes</span>${stepper('otherPen', 0, 0, 20)}</label>
    </div>

    <h3>Short game and putting</h3>
    <div class="grid2">
      <label class="stack"><span>Up-and-down tries</span>${stepper('udAttempts', 10, 0, 18)}</label>
      <label class="stack"><span>Up-and-downs made</span>${stepper('udMade', 3, 0, 18)}</label>
      <label class="stack"><span>Total putts</span>${stepper('putts', 32, 0, 60)}</label>
      <label class="stack"><span>3-putts</span>${stepper('threePutts', 1, 0, 18)}</label>
    </div>
    <p class="sub">An up-and-down try is any missed green where you chip or pitch (or play a bunker shot) and then putt.</p>
    <label class="check sim-only"><input type="checkbox" name="simRealPutting"> Sim round with putting played out (no gimmes or auto-putt)</label>
    <label class="stack"><span>Notes</span><textarea name="notes" rows="2"></textarea></label>
    <p id="form-warn" class="warn"></p>
    <button class="primary wide" type="submit">Save round</button>
  </form>`;
}

function renderLog() {
  const rounds = [...state.rounds].sort((a, b) => b.date.localeCompare(a.date));
  const list = rounds.map(r => {
    const sl = strokesLost(r);
    const toPar = r.score - r.par;
    return `<li class="round">
      <div>
        <strong>${fmtDate(r.date)}</strong> · ${r.type === 'sim' ? 'Sim' : 'Course'}${r.course ? ' · ' + esc(r.course) : ''} · ${r.holes}h
        <div class="sub">${r.score} (${toPar >= 0 ? '+' : ''}${toPar}) · FW ${r.fwHit}/${r.fwPossible} · GIR ${r.gir} · ${r.putts} putts · U&D ${r.udMade}/${r.udAttempts} · pen ${r.teePen + r.otherPen}</div>
        <div class="sub">Est. lost vs scratch: ${Object.keys(AREAS).filter(a => sl[a] != null).map(a => `${AREAS[a].short} ${fmt1(sl[a])}`).join(' · ')}</div>
      </div>
      <button class="ghost small" data-del-round="${r.id}" aria-label="Delete round">✕</button>
    </li>`;
  }).join('');

  return `
    ${roundForm()}
    <form id="index-form" class="card">
      <h2>Update handicap index</h2>
      <p class="sub">Copy it from GHIN when it changes. GHIN stays your official index.</p>
      <div class="grid2">
        <label class="stack"><span>Date</span><input type="date" name="date" value="${today()}"></label>
        <label class="stack"><span>Index</span><input type="number" step="0.1" name="value" inputmode="decimal" required></label>
      </div>
      <button class="primary wide" type="submit">Save index</button>
    </form>
    <section class="card">
      <h2>Rounds (${rounds.length})</h2>
      ${rounds.length ? `<ul class="plain">${list}</ul>` : '<p class="sub">No rounds yet.</p>'}
    </section>`;
}

function lineChart(points, opts = {}) {
  // points: [{x: Date number, y}], optional opts.guide: [{x,y},{x,y}]
  const W = 340, H = 160, P = 28;
  const all = points.concat(opts.guide || []);
  if (!all.length) return '<p class="sub">No data yet.</p>';
  const xs = all.map(p => p.x), ys = all.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const y0 = Math.min(0, ...ys), y1 = Math.max(...ys) + 1;
  const sx = x => P + ((x - x0) / ((x1 - x0) || 1)) * (W - P - 8);
  const sy = y => H - P + 8 - ((y - y0) / ((y1 - y0) || 1)) * (H - P - 8);
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const ticks = [y0, Math.round((y0 + y1) / 2), Math.round(y1)].map(t =>
    `<text x="4" y="${sy(t) + 4}" class="tick">${t}</text><line x1="${P}" x2="${W - 8}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/>`).join('');
  const guide = opts.guide ? `<path d="${path(opts.guide)}" class="guide"/>` : '';
  const dots = points.map(p => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.5" class="dot"><title>${p.label || ''} ${fmt1(p.y)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || 'chart')}">
    ${ticks}${guide}<path d="${path(points)}" class="line"/>${dots}</svg>`;
}

function renderProgress() {
  const p = state.profile;
  const hist = [...state.indexHistory].sort((a, b) => a.date.localeCompare(b.date));
  const pts = hist.map(h => ({ x: parseYmd(h.date).getTime(), y: h.value, label: h.date }));
  const guide = [
    { x: parseYmd(p.startDate).getTime(), y: p.startIndex },
    { x: parseYmd(p.goalDate).getTime(), y: p.goalIndex },
  ];
  const latest = hist.length ? hist[hist.length - 1] : null;
  let pace = '';
  if (latest) {
    const total = daysBetween(p.startDate, p.goalDate);
    const elapsed = Math.max(0, daysBetween(p.startDate, latest.date));
    const target = p.startIndex + (p.goalIndex - p.startIndex) * Math.min(1, elapsed / total);
    const gap = latest.value - target;
    pace = `Target on ${fmtDate(latest.date)}: ${fmt1(target)}. You are ${gap <= 0.05 ? 'on pace' : fmt1(gap) + ' behind pace'}.`;
  }

  const { avg, count } = recentLoss();
  const lossBars = Object.keys(AREAS).map(a => {
    const v = avg[a];
    const w = v == null ? 0 : Math.min(100, Math.abs(v) / 4 * 100);
    return `<div class="bar-row"><span>${AREAS[a].name}</span>
      <div class="bar"><i style="width:${w}%;background:${v != null && v < 0 ? 'var(--good)' : AREAS[a].color}"></i></div>
      <b>${v == null ? '–' : (v < 0 ? '−' : '') + fmt1(Math.abs(v))}</b></div>`;
  }).join('');

  // Stat averages: last 5 course rounds vs the 5 before, per 18.
  const course = state.rounds.filter(r => r.type === 'course').sort((a, b) => b.date.localeCompare(a.date));
  const stat = (rs, fn) => rs.length ? rs.reduce((s, r) => s + fn(r), 0) / rs.length : null;
  const per18 = r => 18 / r.holes;
  const defs = [
    ['Score to par', r => (r.score - r.par) * per18(r), fmt1],
    ['Fairways', r => r.fwPossible ? r.fwHit / r.fwPossible : 0, pct],
    ['Tee misses right', r => (r.missRight || 0) * per18(r), fmt1],
    ['GIR', r => r.gir * per18(r), fmt1],
    ['Putts', r => r.putts * per18(r), fmt1],
    ['3-putts', r => r.threePutts * per18(r), fmt1],
    ['Up-and-down', r => r.udAttempts ? r.udMade / r.udAttempts : 0, pct],
    ['Penalty strokes', r => (r.teePen + r.otherPen) * per18(r), fmt1],
    ['Fat or thin', r => (r.poorContact || 0) * per18(r), fmt1],
  ];
  const last5 = course.slice(0, 5), prev5 = course.slice(5, 10);
  const statRows = defs.map(([name, fn, f]) =>
    `<tr><td>${name}</td><td>${f(stat(last5, fn))}</td><td>${f(stat(prev5, fn))}</td></tr>`).join('');

  // Practice minutes by area, last 28 days.
  const since = addDays(today(), -27);
  const mins = { tee: 0, approach: 0, short: 0, putt: 0 };
  let sessions = 0;
  for (const [d, s] of Object.entries(state.sessions)) {
    if (d < since) continue;
    let any = false;
    for (const b of s.blocks) {
      const info = blockInfo(b.key);
      if (b.done && info && info.area) { mins[info.area] += b.minutes; any = true; }
    }
    if (any) sessions++;
  }
  const maxMin = Math.max(60, ...Object.values(mins));
  const minBars = Object.keys(AREAS).map(a => `
    <div class="bar-row"><span>${AREAS[a].name}</span>
      <div class="bar"><i style="width:${mins[a] / maxMin * 100}%;background:${AREAS[a].color}"></i></div>
      <b>${mins[a]}m</b></div>`).join('');

  // Drill scores: last vs average.
  const scores = {};
  for (const [d, s] of Object.entries(state.sessions)) {
    for (const b of s.blocks) if (b.done && b.score != null && b.score !== '') {
      (scores[b.key] = scores[b.key] || []).push({ d, v: Number(b.score) });
    }
  }
  const drillRows = Object.entries(scores).map(([key, list]) => {
    const info = blockInfo(key);
    list.sort((a, b) => a.d.localeCompare(b.d));
    const avgV = list.reduce((s, x) => s + x.v, 0) / list.length;
    const best = info.score.lowerBetter ? Math.min(...list.map(x => x.v)) : Math.max(...list.map(x => x.v));
    return `<tr><td>${esc(info.name)}</td><td>${list[list.length - 1].v}</td><td>${fmt1(avgV)}</td><td>${best}</td><td>${list.length}</td></tr>`;
  }).join('');

  return `
    <section class="card">
      <h2>Handicap index</h2>
      ${lineChart(pts, { guide, label: 'Handicap index over time with goal line' })}
      <p class="sub"><span class="key line"></span> your index <span class="key guide"></span> straight line to goal. ${pace}</p>
    </section>
    <section class="card">
      <h2>Strokes lost vs scratch</h2>
      ${count ? lossBars : '<p class="sub">Log a round to see where strokes go.</p>'}
      <p class="sub">Per 18, averaged over your last ${count || 0} rounds (course rounds count double). These are estimates from your summary stats, good for direction, not exact.</p>
    </section>
    <section class="card">
      <h2>Course stats per 18</h2>
      <table><thead><tr><th></th><th>Last 5</th><th>Prior 5</th></tr></thead><tbody>${statRows}</tbody></table>
    </section>
    <section class="card">
      <h2>Practice, last 4 weeks</h2>
      ${minBars}
      <p class="sub">${sessions} sessions logged.</p>
    </section>
    <section class="card">
      <h2>Drill scores</h2>
      ${drillRows ? `<table><thead><tr><th>Drill</th><th>Last</th><th>Avg</th><th>Best</th><th>n</th></tr></thead><tbody>${drillRows}</tbody></table>`
        : '<p class="sub">Score drills on the Today tab to see them here.</p>'}
    </section>`;
}

function renderSettings() {
  const p = state.profile;
  const rows = state.week.map((d, i) => `
    <tr><td>${WEEKDAYS[i]}</td>
      <td><select data-week-venue="${i}">${Object.entries(VENUES).map(([k, v]) =>
        `<option value="${k}" ${k === d.venue ? 'selected' : ''}>${v.name}</option>`).join('')}</select></td>
      <td><select data-week-body="${i}">${Object.entries(BODY).map(([k, v]) =>
        `<option value="${k}" ${k === d.body ? 'selected' : ''}>${v.short}</option>`).join('')}</select></td>
      <td><input type="number" step="5" min="0" max="240" inputmode="numeric" data-week-min="${i}" value="${d.minutes || ''}" placeholder="${p.minutes}"></td></tr>`).join('');
  return `
    <section class="card">
      <h2>Usual week</h2>
      <p class="sub">Where you practice each day and what the Fitbod plan has you doing that day. Set up to match the Fitbod plan; change it if your Fitbod days move. Blank minutes use the daily default below.</p>
      <table class="week-table"><thead><tr><th></th><th>Golf</th><th>Body</th><th>Min</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
    <form id="profile-form" class="card">
      <h2>Goal</h2>
      <div class="grid2">
        <label class="stack"><span>Start index</span><input type="number" step="0.1" name="startIndex" value="${p.startIndex}"></label>
        <label class="stack"><span>Start date</span><input type="date" name="startDate" value="${p.startDate}"></label>
        <label class="stack"><span>Goal index</span><input type="number" step="0.1" name="goalIndex" value="${p.goalIndex}"></label>
        <label class="stack"><span>Goal date</span><input type="date" name="goalDate" value="${p.goalDate}"></label>
        <label class="stack"><span>Default minutes per day</span><input type="number" step="5" min="20" max="240" name="minutes" value="${p.minutes}"></label>
      </div>
      <button class="primary wide" type="submit">Save goal</button>
    </form>
    <section class="card">
      <h2>Your data</h2>
      <p class="sub">Everything is stored on this phone only. Export a backup now and then; clearing Chrome's site data would erase it.</p>
      <div class="btn-row">
        <button id="export">Export backup</button>
        <label class="button">Import backup<input type="file" id="import" accept="application/json" hidden></label>
      </div>
      <button class="danger wide" id="reset">Erase all data</button>
    </section>
    <section class="card">
      <h2>How the plan adapts</h2>
      <p class="sub">Each round is compared with rough scratch-golfer numbers (55% fairways, 10.5 greens, 29.5 putts, 55% up-and-down) to estimate strokes lost in each area. Practice time shifts toward the biggest losses as rounds pile up. Until then it follows your own read: putting and short game first, then driver, then iron contact. Sim rounds count half and skip putting and short game unless you played putts out, because sim greens and chips flatter you.</p>
    </section>`;
}

// ---------- Fitbod coordination ----------

function phaseFor(date) {
  const ph = PHASES.find(p => date >= p.start && date <= p.end);
  if (!ph) return null;
  const week = Math.floor(daysBetween(ph.start, date) / 7) + 1;
  return { ...ph, week, deload: week % 4 === 0 };
}

function phaseLine(date) {
  const ph = phaseFor(date);
  if (!ph) return 'Between Fitbod phases';
  return `Fitbod ${ph.name} phase, week ${ph.week}${ph.deload ? ' (deload)' : ''}${ph.note ? ', ' + ph.note : ''}`;
}

function bodyLabel(date, short) {
  const key = state.week[weekdayIdx(date)].body;
  const b = BODY[key];
  if (key === 'liftD' && date < '2027-01-04') return short ? 'No lift' : 'No lift yet (Lift D starts Jan 2027). 12 min mobility.';
  if (!short && b.lift && phaseFor(date)?.deload) return b.name + ' (deload week)';
  return short ? b.short : b.name;
}

// Checks the Fitbod plan's spacing rules against this date and the days around it.
function fitnessWarnings(date) {
  const w = [];
  const body = d => state.week[weekdayIdx(d)].body;
  const activeLift = d => BODY[body(d)].lift && !(body(d) === 'liftD' && d < '2027-01-04');
  const venue = venueFor(date);
  if (isRoundDay(addDays(date, 1))) {
    w.push('Round tomorrow: mobility plus putting only today.');
    if (activeLift(date)) w.push(`Skip today's ${BODY[body(date)].short}; the plan keeps the day before a round lift-free.`);
  }
  if (isRoundDay(addDays(date, 1)) || isRoundDay(addDays(date, 2))) {
    if (body(date) === 'liftA') w.push('Lift A is within 48 hours of a round. Move it earlier or swap it for Lift B.');
  }
  if (VENUES[venue].fullSwing && activeLift(date)) w.push('Golf first, lift after.');
  if (VENUES[venue].fullSwing && activeLift(addDays(date, 1))) {
    w.push(`Over about 150 full swings today? ${body(addDays(date, 1)) === 'liftD' ? 'Skip Lift D tomorrow' : 'Switch tomorrow\'s lift to Lift B'}.`);
  }
  if (venue === 'course' && body(date) !== 'rest' && activeLift(date)) w.push('Round day: no lift.');
  return w;
}

function clearFuturePlans() {
  // Future plans change with the settings; keep anything already worked on.
  for (const [d, s] of Object.entries(state.sessions)) if (d >= today() && !s.blocks.some(b => b.done)) delete state.sessions[d];
}

// ---------- Events ----------

function readSession() {
  const sess = sessionFor(viewDate);
  sess.notes = $('#sess-notes') ? $('#sess-notes').value : sess.notes;
  sess.blocks.forEach((b, i) => {
    const inp = document.querySelector(`input[name="score-${i}"]`);
    if (inp) b.score = inp.value === '' ? null : Number(inp.value);
    const chk = document.querySelector(`[data-done="${i}"]`);
    if (chk) b.done = chk.checked;
  });
  return sess;
}

function storeSession(sess) {
  state.sessions[viewDate] = sess;
  save();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-open]');
  if (!t) return;

  if (t.dataset.tab) { tab = t.dataset.tab; if (tab === 'today') viewDate = today(); render(); return; }
  if (t.dataset.nav) { viewDate = addDays(viewDate, Number(t.dataset.nav)); render(); return; }
  if (t.dataset.week) { viewDate = addDays(viewDate, Number(t.dataset.week)); render(); return; }
  if (t.dataset.open) { viewDate = t.dataset.open; tab = 'today'; render(); return; }

  if (t.dataset.step) {
    const wrap = t.closest('.stepper');
    const inp = wrap.querySelector('input');
    const v = (inp.value === '' ? 0 : Number(inp.value)) + Number(t.dataset.step);
    inp.value = Math.min(Number(wrap.dataset.max), Math.max(Number(wrap.dataset.min), v));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (t.id === 'save-session') {
    storeSession(readSession());
    toast('Session saved');
    render();
    return;
  }

  if (t.dataset.delRound) {
    if (!confirm('Delete this round?')) return;
    state.rounds = state.rounds.filter(r => r.id !== t.dataset.delRound);
    save(); render(); return;
  }

  if (t.id === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `road-to-scratch-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }

  if (t.id === 'reset') {
    if (!confirm('Erase every round, session and setting on this phone?')) return;
    state = defaultState(); save(); render(); toast('Data erased'); return;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'venue-select') {
    const sess = readSession();
    const def = state.week[weekdayIdx(viewDate)].venue;
    if (t.value === def) delete state.overrides[viewDate]; else state.overrides[viewDate] = t.value;
    // Replanning drops unsaved scores for the old venue only if nothing was done yet.
    if (!sess.blocks.some(b => b.done)) delete state.sessions[viewDate];
    save(); render(); return;
  }
  if (t.dataset.done !== undefined) {
    storeSession(readSession());
    t.closest('.block').classList.toggle('done', t.checked);
    return;
  }
  if (t.dataset.weekVenue !== undefined) { state.week[t.dataset.weekVenue].venue = t.value; save(); toast('Week updated'); return; }
  if (t.dataset.weekBody !== undefined) { state.week[t.dataset.weekBody].body = t.value; save(); toast('Week updated'); return; }
  if (t.dataset.weekMin !== undefined) {
    state.week[t.dataset.weekMin].minutes = Number(t.value) || null;
    clearFuturePlans(); save(); toast('Week updated'); return;
  }
  if (t.id === 'import') {
    const file = t.files[0];
    if (!file) return;
    file.text().then(txt => {
      const data = JSON.parse(txt);
      if (!data || data.version !== 1 || !Array.isArray(data.rounds)) throw new Error('bad file');
      if (!confirm(`Replace current data with this backup (${data.rounds.length} rounds)?`)) return;
      state = Object.assign(defaultState(), data); save(); render(); toast('Backup restored');
    }).catch(() => toast('That file is not a Road to Scratch backup'));
  }
  if (t.name === 'type') {
    t.form.querySelector('.sim-only').style.display = t.value === 'sim' ? '' : 'none';
  }
  if (t.name === 'holes') {
    const f = t.form;
    const nine = t.value === '9';
    f.fwPossible.value = nine ? 7 : 14;
    f.par.value = nine ? 36 : 72;
  }
});

document.addEventListener('input', e => {
  const f = e.target.form;
  if (!f || f.id !== 'round-form') return;
  const v = n => Number(f[n].value || 0);
  const holes = Number(f.holes.value);
  const warns = [];
  if (v('fwHit') + v('missLeft') + v('missRight') > v('fwPossible')) warns.push('Fairways hit plus misses is more than fairway holes.');
  if (v('udMade') > v('udAttempts')) warns.push('More up-and-downs made than tried.');
  if (v('udAttempts') > holes - v('gir')) warns.push(`Up-and-down tries are usually at most greens missed (${holes - v('gir')}).`);
  if (v('gir') > holes) warns.push('More greens than holes.');
  $('#form-warn').textContent = warns.join(' ');
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const fd = new FormData(f);
  if (f.id === 'round-form') {
    const n = k => Number(fd.get(k) || 0);
    const r = {
      id: Date.now().toString(36),
      date: fd.get('date'), type: fd.get('type'), holes: n('holes'), course: (fd.get('course') || '').trim(),
      score: n('score'), par: n('par'),
      fwHit: n('fwHit'), fwPossible: n('fwPossible'), missLeft: n('missLeft'), missRight: n('missRight'), teePen: n('teePen'),
      gir: n('gir'), poorContact: n('poorContact'), otherPen: n('otherPen'),
      udAttempts: n('udAttempts'), udMade: n('udMade'), putts: n('putts'), threePutts: n('threePutts'),
      simRealPutting: fd.get('simRealPutting') === 'on', notes: (fd.get('notes') || '').trim(),
    };
    state.rounds.push(r);
    save();
    toast('Round saved. Plan updated.');
    render();
  }
  if (f.id === 'index-form') {
    const value = Number(fd.get('value'));
    if (isNaN(value)) return;
    state.indexHistory = state.indexHistory.filter(h => h.date !== fd.get('date'));
    state.indexHistory.push({ date: fd.get('date'), value });
    state.indexHistory.sort((a, b) => a.date.localeCompare(b.date));
    save(); toast('Index saved'); render();
  }
  if (f.id === 'profile-form') {
    Object.assign(state.profile, {
      startIndex: Number(fd.get('startIndex')), startDate: fd.get('startDate'),
      goalIndex: Number(fd.get('goalIndex')), goalDate: fd.get('goalDate'),
      minutes: Math.max(20, Number(fd.get('minutes')) || 60),
    });
    clearFuturePlans();
    save(); toast('Goal saved'); render();
  }
});

// ---------- Boot ----------

render();
// Hide the sim-only checkbox until Simulator is chosen.
const hideSimOnly = () => { const el = document.querySelector('.sim-only'); if (el) el.style.display = 'none'; };
new MutationObserver(hideSimOnly).observe($('#view'), { childList: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
