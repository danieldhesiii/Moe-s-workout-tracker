/* ============================================================
   Moe's Training Log — app logic v10
   Offline-first (localStorage + Supabase), PWA-ready.
   All features: PBs, HR zones, knee trend, weight log,
   weekly notes, swipe tabs, auto weather, training load.
   ============================================================ */

const { WEEK_TEMPLATE, CHECKIN_QUESTIONS, SWAP_OPTIONS, WEATHER_OPTS, MOOD_OPTS, LIB_RUNS, LIB_STRENGTH } = window.MOE_DATA;

/* --------------- Constants --------------- */
const STORE_KEY = 'moe_training_log_v1';
const AGE = 29;
const MAX_HR = 220 - AGE; // 191 bpm
const TAB_ORDER = ['today', 'plan', 'progress', 'goals'];

/* --------------- State --------------- */
const defaultState = () => ({
  checkins: {},
  sessions: [],
  goals: [
    { id: uid(), race: 'Full Marathon', date: nextYear(), targetKm: 42.2, note: 'Primary goal — flexible date', progress: 0 },
  ],
  plan: {},
  settings: { weeklyTarget: 75 },
  weights: [],
  weeklyNotes: {},
});

let state = load();

function ensureShape(s) {
  s = s || {};
  s.checkins    = s.checkins    || {};
  s.sessions    = s.sessions    || [];
  s.goals       = s.goals       || defaultState().goals;
  s.plan        = s.plan        || {};
  s.settings    = s.settings    || { weeklyTarget: 75 };
  s.weights     = s.weights     || [];
  s.weeklyNotes = s.weeklyNotes || {};
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seedDemo(defaultState());
    return ensureShape(JSON.parse(raw));
  } catch { return defaultState(); }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (sb && syncReady) pushRemote();
}

/* --------------- Cloud sync (Supabase + offline queue) --------------- */
let sb = null, syncReady = false, syncTimer = null, offlinePending = false;

function initSync() {
  const cfg = window.MOE_CONFIG;
  if (!cfg || !window.supabase) { console.warn('[sync] Supabase unavailable — local-only'); return; }
  try { sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false } }); }
  catch (e) { console.warn('[sync] init failed', e); return; }
  pullRemote();
}

async function pullRemote() {
  const cfg = window.MOE_CONFIG;
  try {
    const { data, error } = await sb.from(cfg.table).select('data').eq('id', cfg.rowId).maybeSingle();
    if (error) { console.warn('[sync] pull error', error.message); syncReady = true; return; }
    if (data && data.data && Object.keys(data.data).length) {
      state = ensureShape(data.data);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      syncReady = true;
      render();
      toast('Synced from cloud ☁️');
    } else {
      syncReady = true;
      pushRemote(true);
    }
  } catch (e) { console.warn('[sync] pull failed', e); syncReady = true; }
}

function pushRemote(immediate) {
  if (!sb || !syncReady) return;
  if (!navigator.onLine) { offlinePending = true; updateSyncDot(); return; }
  const cfg = window.MOE_CONFIG;
  const doPush = async () => {
    try {
      const { error } = await sb.from(cfg.table).upsert({ id: cfg.rowId, data: state, updated_at: new Date().toISOString() });
      if (error) { console.warn('[sync] push error', error.message); offlinePending = true; }
      else offlinePending = false;
      updateSyncDot();
    } catch (e) { console.warn('[sync] push failed', e); offlinePending = true; updateSyncDot(); }
  };
  clearTimeout(syncTimer);
  if (immediate) doPush(); else syncTimer = setTimeout(doPush, 700);
}

window.addEventListener('online', () => {
  updateSyncDot();
  if (offlinePending && sb && syncReady) {
    offlinePending = false;
    pushRemote(true);
    toast('Back online — syncing ☁️');
  }
});
window.addEventListener('offline', () => { updateSyncDot(); toast('Offline — saved locally 📱'); });

function updateSyncDot() {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  if (!navigator.onLine) { dot.className = 'sync-dot offline'; dot.title = 'Offline — saved locally'; }
  else if (offlinePending) { dot.className = 'sync-dot pending'; dot.title = 'Saving to cloud…'; }
  else { dot.className = 'sync-dot ok'; dot.title = 'Synced to cloud'; }
}

/* --------------- Utilities --------------- */
function uid() { return Math.random().toString(36).slice(2, 9); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function nextYear() { const d = new Date(); d.setFullYear(d.getFullYear() + 1); d.setMonth(4, 12); return d.toISOString().slice(0, 10); }
function weekKey(d) {
  const dt = d || new Date();
  const jan1 = new Date(dt.getFullYear(), 0, 1);
  const wk = Math.ceil(((dt - jan1) / 864e5 + jan1.getDay() + 1) / 7);
  return `${dt.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/* --------------- HR zones (Max HR 191 bpm) --------------- */
function hrZone(hr) {
  const pct = (hr / MAX_HR) * 100;
  if (pct < 60) return { n: 1, label: 'Z1', full: 'Zone 1 · Recovery', col: '#8fb4c8' };
  if (pct < 70) return { n: 2, label: 'Z2', full: 'Zone 2 · Easy', col: '#6aaa7e' };
  if (pct < 80) return { n: 3, label: 'Z3', full: 'Zone 3 · Aerobic', col: '#d4a017' };
  if (pct < 90) return { n: 4, label: 'Z4', full: 'Zone 4 · Threshold', col: '#e07840' };
  return { n: 5, label: 'Z5', full: 'Zone 5 · Max', col: '#c72f5c' };
}

/* --------------- Personal Bests (computed live from sessions) --------------- */
function computePBs() {
  const paceToSecs = p => {
    if (!p) return Infinity;
    const [m, s] = p.toString().split(/[:.]/);
    return (+m) * 60 + (+(s || 0));
  };
  const runs = state.sessions.filter(s => s.type === 'run' && s.distance);
  const best = (min, max) => {
    const m = runs.filter(r => r.distance >= min && r.distance <= max && r.pace);
    if (!m.length) return null;
    return m.reduce((a, b) => paceToSecs(a.pace) < paceToSecs(b.pace) ? a : b);
  };
  const longest = runs.reduce((a, b) => (b.distance > (a?.distance || 0) ? b : a), null);
  return { k5: best(4.8, 5.2), k10: best(9.8, 10.2), half: best(20.5, 21.5), marathon: best(41.5, 42.7), longest };
}

function checkForPB(entry) {
  if (!entry.pace || !entry.distance) return;
  const paceToSecs = p => { const [m, s] = p.toString().split(/[:.]/); return (+m) * 60 + (+(s || 0)); };
  const ranges = [
    { min: 4.8, max: 5.2, label: '5K' },
    { min: 9.8, max: 10.2, label: '10K' },
    { min: 20.5, max: 21.5, label: 'Half Marathon' },
    { min: 41.5, max: 42.7, label: 'Marathon' },
  ];
  const prevRuns = state.sessions.filter(s => s.id !== entry.id && s.type === 'run' && s.distance && s.pace);
  for (const r of ranges) {
    if (entry.distance >= r.min && entry.distance <= r.max) {
      const prevBest = prevRuns.filter(s => s.distance >= r.min && s.distance <= r.max);
      if (!prevBest.length || prevBest.every(s => paceToSecs(entry.pace) < paceToSecs(s.pace))) {
        setTimeout(() => toast(`🏆 New ${r.label} PB — ${entry.pace}/km!`), 600);
        return;
      }
    }
  }
  const prevLongest = prevRuns.reduce((a, b) => b.distance > (a?.distance || 0) ? b : a, null);
  if (entry.distance > 5 && (!prevLongest || entry.distance > prevLongest.distance)) {
    setTimeout(() => toast(`🏆 Longest run yet — ${entry.distance} km!`), 600);
  }
}

/* --------------- Auto weather (Open-Meteo, no API key needed) --------------- */
async function autoDetectWeather() {
  if (!navigator.geolocation) return null;
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weathercode,windspeed_10m&timezone=auto`
        );
        const d = await r.json();
        const code = d.current?.weathercode ?? -1;
        const temp = d.current?.temperature_2m ?? 20;
        const wind = d.current?.windspeed_10m ?? 0;
        if (temp > 28) return resolve('🥵 Hot');
        if (temp < 3)  return resolve('❄️ Cold');
        if (wind > 30) return resolve('💨 Windy');
        if (code === 0)       return resolve('☀️ Clear');
        if (code <= 3)        return resolve('⛅ Cloudy');
        if (code <= 48)       return resolve('⛅ Cloudy');
        if (code <= 82)       return resolve('🌧️ Rain');
        if (code <= 86)       return resolve('❄️ Cold');
        resolve('⛅ Cloudy');
      } catch { resolve(null); }
    }, () => resolve(null), { timeout: 5000 });
  });
}

/* --------------- Demo seed --------------- */
function seedDemo(s) {
  const titles = ['Long Run', 'Speed / Intervals', 'Easy Run + Lower Strength', 'Tempo / Threshold + Core', 'Recovery Run + Upper Strength'];
  for (let i = 12; i > 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ([0, 4].includes(d.getDay())) continue;
    const km = +(8 + Math.random() * 16).toFixed(1);
    s.sessions.push({
      id: uid(), date: d.toISOString().slice(0, 10),
      title: titles[i % titles.length], type: 'run',
      distance: km, duration: Math.round(km * (5.1 + Math.random() * .6)),
      pace: (4.6 + Math.random() * .8).toFixed(2), hr: Math.round(142 + Math.random() * 22),
      rpe: Math.round(4 + Math.random() * 4), mood: 3 + Math.round(Math.random()),
      weather: WEATHER_OPTS[Math.floor(Math.random() * 3)], notes: '',
    });
  }
  // Demo weight entries (last 9 weeks)
  let wBase = 63.6;
  for (let i = 8; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    const kg = +(wBase + (Math.random() - 0.55) * 0.3).toFixed(1);
    wBase = kg;
    s.weights.push({ id: uid(), date: d.toISOString().slice(0, 10), kg });
  }
  return s;
}

/* --------------- Effective plan (overrides + defaults) --------------- */
function getDay(dow) {
  const c = state.plan && state.plan[dow];
  return c ? materializeDay(dow, c) : WEEK_TEMPLATE[dow];
}
function materializeDay(dow, c) {
  const day = WEEK_TEMPLATE[dow].day;
  if (c.rest) return { day, type: 'rest', title: 'Rest Day', focus: 'Recovery', run: null, strength: null, coach: 'Full rest — recovery is where the adaptation happens.' };
  const strLib = c.strengthId ? LIB_STRENGTH.find(s => s.id === c.strengthId) : null;
  const strength = strLib ? { label: strLib.label, block: strLib.block } : null;
  if (c.cross) {
    return { day, type: 'cross', title: 'Cross-Training' + (strength ? ' + ' + strength.label : ''), focus: 'Low-impact cross-training',
      run: { style: 'time', label: 'Bike / swim / row', target: '45 min', intensity: 'Zone 2 · low-impact' }, strength,
      coach: 'Aerobic work with zero pounding on the knees.' };
  }
  const run = c.runId ? LIB_RUNS.find(r => r.id === c.runId) : null;
  let type, title;
  if (run && strength) { type = 'run+strength'; title = `${run.label} + ${strength.label}`; }
  else if (run) { type = 'run'; title = run.label; }
  else if (strength) { type = 'strength'; title = strength.label; }
  else { type = 'rest'; title = 'Rest Day'; }
  const focus = run ? run.intensity : strength ? strength.label : 'Recovery';
  const coach = run?.coach || 'Your custom session — warm up well and mind the knees.';
  return { day, type, title, focus, run, strength, coach };
}

/* --------------- Readiness engine --------------- */
function computeReadiness(answers) {
  const w = { sleep: 1, energy: 1, legs: 1.2, knees: 1.6, motivation: .8, stress: 1 };
  let sum = 0, wsum = 0;
  for (const q of CHECKIN_QUESTIONS) {
    const v = answers[q.key] ?? 3;
    sum += v * (w[q.key] || 1); wsum += 5 * (w[q.key] || 1);
  }
  let score = Math.round((sum / wsum) * 100);
  const kneeVal = answers.knees ?? 3;
  const kneeFlag = kneeVal <= 2;
  if (kneeFlag) score = Math.min(score, 55);
  let band, ringCol;
  if (score >= 75 && !kneeFlag) { band = 'green'; ringCol = 'var(--moss)'; }
  else if (score >= 55) { band = 'amber'; ringCol = 'var(--amber)'; }
  else { band = 'red'; ringCol = 'var(--ember)'; }
  const plan = getDay(new Date().getDay());
  const rec = buildRecommendation(band, kneeFlag, plan);
  return { score, band, ringCol, kneeFlag, rec, plan };
}

function buildRecommendation(band, kneeFlag, plan) {
  const isHardDay = plan.type === 'run' && /Interval|Long|Tempo|Speed/.test(plan.title);
  if (kneeFlag) return { cls: 'caution', label: 'Adapted — protect the knees', title: 'Swap to low-impact + rehab',
    body: 'Your knees flagged sore today. Skip impact. Do the knee rehab circuit and, if you want aerobic work, cross-train at an easy effort. Nothing is worth a flare-up — this is exactly the call that keeps you running long-term.', swap: 'rehab' };
  if (band === 'green') return isHardDay
    ? { cls: 'hard', label: 'Green light — go get it', title: `Full send: ${plan.title}`, body: 'You\'re primed. Run the session exactly as prescribed. Full warm-up first, then hit the targets. Great day to push progressive overload.', swap: 'planned' }
    : { cls: '', label: 'Ready — on plan', title: plan.title, body: 'Body\'s in good shape. Follow the plan as written and log it after.', swap: 'planned' };
  if (band === 'amber') return isHardDay
    ? { cls: 'caution', label: 'Amber — dial it back', title: 'Ease the intensity', body: 'You\'re a bit under par. Keep today\'s session but drop the hard reps — turn intervals into a steady Zone 2, or cut volume ~20%. Consistency beats heroics.', swap: 'easy' }
    : { cls: 'caution', label: 'Amber — keep it gentle', title: 'Easy version of today', body: 'Do a relaxed version of the plan. Prioritise form and finish feeling like you could do more.', swap: 'easy' };
  return { cls: 'caution', label: 'Red — recover', title: 'Rest or light mobility',
    body: 'Low readiness across the board. The smart move is rest or a gentle walk plus mobility. You bank fitness by recovering, not by grinding a bad day.', swap: 'rest' };
}

/* --------------- Router + swipe gestures --------------- */
let currentTab = 'today';
const view = document.getElementById('view');

// Swipe left/right to switch tabs
let swipeStartX = 0, swipeStartY = 0;
view.addEventListener('touchstart', e => {
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
}, { passive: true });
view.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = e.changedTouches[0].clientY - swipeStartY;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.85) return;
  const idx = TAB_ORDER.indexOf(currentTab);
  if (dx < 0 && idx < TAB_ORDER.length - 1) { currentTab = TAB_ORDER[idx + 1]; render(); }
  else if (dx > 0 && idx > 0) { currentTab = TAB_ORDER[idx - 1]; render(); }
}, { passive: true });

function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentTab));
  ({ today: renderToday, plan: renderPlan, log: () => openLogSheet(), progress: renderProgress, goals: renderGoals }[currentTab] || renderToday)();
  updateHeader();
}

document.getElementById('tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.tab'); if (!btn) return;
  if (btn.dataset.tab === 'log') { openLogSheet(); return; }
  currentTab = btn.dataset.tab; render();
});

function updateHeader() {
  const d = new Date();
  document.getElementById('headerDate').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const done = weekSessions().length;
  const active = activeDaysThisWeek();
  document.getElementById('streakNum').textContent = `${done}/${active}`;
  updateSyncDot();
}

function activeDaysThisWeek() {
  let n = 0;
  for (let dow = 0; dow < 7; dow++) if (getDay(dow).type !== 'rest') n++;
  return n;
}

function weekSessions() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return state.sessions.filter(s => new Date(s.date) >= monday);
}

/* --------------- TODAY --------------- */
function renderToday() {
  const plan = getDay(new Date().getDay());
  const ci = state.checkins[todayKey()];
  const wk = weekSessions();
  const wkKm = wk.reduce((a, s) => a + (s.distance || 0), 0);
  const target = state.settings.weeklyTarget;
  const pct = Math.min(100, (wkKm / target) * 100);
  const active = activeDaysThisWeek();
  const kmLeft = Math.max(0, target - wkKm);

  // Heal old check-in schema
  if (ci && !ci.result) { ci.result = computeReadiness(ci.answers || {}); state.checkins[todayKey()] = ci; save(); }

  let html = `<div class="today-hero">
    <div class="eyebrow">Today · ${plan.focus}</div>
    <div class="h-big">${plan.title}</div>
  </div>

  <div class="card wk-mileage-card" style="margin-top:14px">
    <div class="wk-prog-top">
      <span class="eyebrow" style="margin:0">This week</span>
      <span class="mono" style="font-size:13px;font-weight:700;color:var(--ember)">${wkKm.toFixed(1)}<span style="color:var(--ink-3);font-weight:400"> / ${target} km</span></span>
    </div>
    <div class="g-bar-track" style="margin-top:9px">
      <div class="g-bar-fill" style="width:${pct}%;transition:width .6s cubic-bezier(.2,.8,.2,1)"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:12px;color:var(--ink-3);font-weight:500">
      <span>${wk.length}/${active} sessions · ${pct >= 100 ? 'target hit 🎉' : `${kmLeft.toFixed(1)} km to go`}</span>
      <span>${Math.round(pct)}%</span>
    </div>
  </div>`;

  if (!ci) {
    html += `<div class="card readiness-card" style="margin-top:12px">
      <div class="eyebrow">Daily check-in</div>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:600;margin:4px 0 6px">How are you feeling?</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.5">Tell me before you start and I'll set today's session — no guesswork. Takes 15 seconds.</p>
      <button class="btn btn-ember" style="margin-top:16px" onclick="openCheckin()">Start check-in</button>
      <button class="btn btn-ghost" style="margin-top:10px" onclick="openLogSheet()">Quick log a session</button>
    </div>`;
  } else {
    const r = ci.result;
    html += renderReadinessCard(r);
    html += renderWorkoutCard(r.plan, ci.swap || r.rec.swap);
  }

  view.innerHTML = html;
}

function renderReadinessCard(r) {
  return `<div class="card readiness-card" style="margin-top:12px">
    <div class="readiness-ring">
      <div class="ring" style="--pct:${r.score};--ring-col:${r.ringCol}"><span class="ring-val">${r.score}</span></div>
      <div class="ring-info">
        <h3>Readiness ${r.band === 'green' ? '· strong' : r.band === 'amber' ? '· moderate' : '· low'}</h3>
        <p>${r.kneeFlag ? '⚠️ Knees flagged — plan adapted to protect them.' : 'Based on this morning\'s check-in.'}</p>
      </div>
    </div>
    <div class="suggestion ${r.rec.cls}">
      <div class="sug-label">${r.rec.label}</div>
      <div class="sug-title">${r.rec.title}</div>
      <div class="sug-body">${r.rec.body}</div>
    </div>
    <div class="swap-row">
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openCheckin()">Redo check-in</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="openSwap()">Swap session</button>
    </div>
  </div>`;
}

function workoutBodyHtml(resolved) {
  let html = '';
  if (resolved.run) {
    const rn = resolved.run;
    html += `<div class="wk-block">
      <div class="wk-metrics">
        <div class="metric"><div class="m-label">${rn.style === 'time' ? 'Duration' : 'Distance'}</div><div class="m-val">${rn.target}</div></div>
        <div class="metric"><div class="m-label">Intensity</div><div class="m-val" style="font-size:13px">${rn.intensity}</div></div>
        ${rn.pace ? `<div class="metric"><div class="m-label">Pace</div><div class="m-val" style="font-size:13px">${rn.pace}</div></div>` : ''}
      </div>
      ${rn.warmup ? `<p class="muted" style="font-size:12.5px;margin-top:10px">🔥 Warm-up: ${rn.warmup}</p>` : ''}
    </div>`;
  }
  if (resolved.strength) {
    html += `<div class="wk-block"><div class="eyebrow" style="margin-top:16px">${resolved.strength.label}</div><div class="exlist">`;
    for (const ex of resolved.strength.block) {
      html += `<div class="exrow"><div style="flex:1"><div class="ex-name">${ex.name}</div>${ex.note ? `<div class="ex-note">${ex.note}</div>` : ''}</div><div class="ex-target">${ex.sets}×${ex.target}</div></div>`;
    }
    html += `</div></div>`;
  }
  if (resolved.coach) html += `<div class="coach-note"><strong>Coach:</strong> ${resolved.coach}</div>`;
  return html;
}

function renderWorkoutCard(plan, swapId) {
  const resolved = resolveSwap(plan, swapId);
  const t = resolved.title.replace(/'/g, '');
  const isRest = /Rest Day|Full Rest/.test(resolved.title);
  let html = `<div class="card" style="margin-top:12px">
    <div class="wk-header">
      <div><div class="eyebrow">Your session${swapId !== 'planned' ? ' · swapped' : ''}</div>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:600;margin-top:2px">${resolved.title}</h3></div>
      ${resolved.tag}
    </div>`;
  html += workoutBodyHtml(resolved);
  if (!isRest) html += `<button class="btn btn-ember" style="margin-top:16px" onclick="startWorkout('${t}', ${new Date().getDay()}, '${swapId}')">▶ Start workout</button>`;
  html += `<button class="btn btn-ghost" style="margin-top:10px" onclick="openLogSheet('${t}')">Log without timer</button>`;
  html += `</div>`;
  return html;
}

function resolveSwap(plan, swapId) {
  const tagFor = t => t === 'hard' ? `<span class="pill hard">high impact</span>` : t === 'rest' ? `<span class="pill">recovery</span>` : `<span class="pill go">on plan</span>`;
  switch (swapId) {
    case 'rehab':
      return { title: 'Rehab + Mobility', run: null, strength: { label: 'Knee rehab circuit', block: window.MOE_DATA.KNEE_REHAB }, coach: 'Low-impact and protective. Move well, no pain.', tag: `<span class="pill caution">protective</span>` };
    case 'rest':
      return { title: 'Rest Day', run: null, strength: null, coach: 'Full recovery. A gentle walk is fine. Adaptation happens now.', tag: `<span class="pill">rest</span>` };
    case 'easy':
      return { title: 'Easy Run', run: { style: 'time', label: 'Easy run', target: '35–40 min', intensity: 'Zone 2 · conversational', pace: '5:30–6:00 /km' }, strength: null, coach: 'Keep it genuinely easy — nose-breathing pace.', tag: `<span class="pill go">easy</span>` };
    case 'strength':
      return { title: 'Strength Session', run: null, strength: plan.strength || { label: 'Full body', block: window.MOE_DATA.KNEE_REHAB }, coach: 'Control every rep. Progressive overload only if it\'s clean.', tag: `<span class="pill">strength</span>` };
    case 'cross':
      return { title: 'Cross-Training', run: { style: 'time', label: 'Bike / swim', target: '45 min', intensity: 'Zone 2 · low-impact' }, strength: null, coach: 'Aerobic work with zero pounding on the knees.', tag: `<span class="pill go">low impact</span>` };
    default: {
      const hard = /Interval|Long|Tempo|Speed/.test(plan.title);
      return { title: plan.title, run: plan.run, strength: plan.strength, coach: plan.coach, tag: plan.type === 'rest' ? tagFor('rest') : tagFor(hard ? 'hard' : 'plan') };
    }
  }
}

/* --------------- Plan day detail --------------- */
function openDayDetail(dow) {
  const plan = getDay(dow);
  const resolved = resolveSwap(plan, 'planned');
  const t = resolved.title.replace(/'/g, '');
  const isRest = plan.type === 'rest';
  const custom = state.plan && state.plan[dow];
  mountSheet(`
    <div class="eyebrow" style="margin-top:2px">${plan.day} · ${plan.focus} ${custom ? '· <span style="color:var(--ember)">customised</span>' : ''}</div>
    <h2 style="display:flex;align-items:center;gap:10px">${resolved.title} ${resolved.tag}</h2>
    <div style="margin-top:14px">${workoutBodyHtml(resolved)}</div>
    ${isRest ? '' : `<button class="btn btn-ember" style="margin-top:16px" onclick="startWorkout('${t}', ${dow}, 'planned')">▶ Start workout</button>
         <button class="btn btn-ghost" style="margin-top:10px" onclick="openLogSheet('${t}')">Log without timer</button>`}
    <button class="btn btn-ghost" style="margin-top:10px" onclick="openDayEditor(${dow})">✎ Edit this day</button>
  `);
}

/* --------------- Day editor --------------- */
let planDraft = {};
function openDayEditor(dow) {
  const def = WEEK_TEMPLATE[dow];
  const c = state.plan && state.plan[dow];
  planDraft = c
    ? { mode: c.rest ? 'rest' : c.cross ? 'cross' : 'train', runId: c.runId || null, strengthId: c.strengthId || null }
    : { mode: def.type === 'rest' ? 'rest' : 'train', runId: def.libRun || null, strengthId: def.libStr || null };
  renderDayEditor(dow);
}
function renderDayEditor(dow) {
  const def = WEEK_TEMPLATE[dow];
  const d = planDraft;
  const hasOverride = state.plan && state.plan[dow];
  const runOpts = [{ id: null, label: 'No run', note: '' }, ...LIB_RUNS];
  const strOpts = [{ id: null, label: 'No strength', note: '' }, ...LIB_STRENGTH];
  const pick = (arr, sel, kind) => arr.map(o => `
    <button class="lib-row ${sel === o.id ? 'on' : ''}" onclick="pickLib('${kind}', ${o.id === null ? 'null' : `'${o.id}'`}, ${dow})">
      <span class="lib-name">${o.label}</span>
      <span class="lib-meta">${o.target ? `<span class="mono">${o.target}</span> · ` : ''}${o.intensity || o.note || (o.block ? o.block.length + ' exercises' : '')}</span>
      <span class="lib-tick">${sel === o.id ? '✓' : ''}</span>
    </button>`).join('');
  mountSheet(`
    <div class="eyebrow" style="margin-top:2px">Customise · ${def.day}</div>
    <h2>Edit ${def.day}</h2>
    <p class="sub">Set the day and pick sessions from the library. Injury-first — keep at least two rest days a week.</p>
    <div class="field"><label>Day type</label>
      <div class="seg" id="modeSeg">
        <button data-m="train" class="${d.mode === 'train' ? 'on' : ''}">Train</button>
        <button data-m="cross" class="${d.mode === 'cross' ? 'on' : ''}">Cross</button>
        <button data-m="rest" class="${d.mode === 'rest' ? 'on' : ''}">Rest</button>
      </div>
    </div>
    ${d.mode === 'rest' ? `<div class="card" style="text-align:center;padding:26px 18px"><div style="font-size:34px">☕</div><p class="muted" style="margin-top:8px;font-size:13.5px">Full rest day — recovery & optional gentle mobility.</p></div>` : ''}
    ${d.mode === 'train' ? `<div class="lib-group"><div class="eyebrow" style="margin:14px 2px 8px">Run session</div><div class="lib-list">${pick(runOpts, d.runId, 'run')}</div></div>` : ''}
    ${d.mode !== 'rest' ? `<div class="lib-group"><div class="eyebrow" style="margin:16px 2px 8px">Strength / rehab</div><div class="lib-list">${pick(strOpts, d.strengthId, 'str')}</div></div>` : ''}
    <button class="btn btn-ember" style="margin-top:18px" onclick="saveDayEditor(${dow})">Save ${def.day}</button>
    ${hasOverride ? `<button class="btn btn-ghost" style="margin-top:10px" onclick="resetDay(${dow})">↺ Reset to default</button>` : ''}
  `);
  document.getElementById('modeSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    planDraft.mode = b.dataset.m; renderDayEditor(dow);
  });
}
function pickLib(kind, id, dow) {
  if (kind === 'run') planDraft.runId = id; else planDraft.strengthId = id;
  renderDayEditor(dow);
}
function saveDayEditor(dow) {
  const d = planDraft;
  if (!state.plan) state.plan = {};
  if (d.mode === 'rest') state.plan[dow] = { rest: true };
  else if (d.mode === 'cross') state.plan[dow] = { cross: true, strengthId: d.strengthId || null };
  else {
    if (!d.runId && !d.strengthId) { toast('Pick a run or strength, or set to Rest'); return; }
    state.plan[dow] = { runId: d.runId || null, strengthId: d.strengthId || null };
  }
  save(); closeSheet();
  if (currentTab === 'plan') renderPlan(); else render();
  toast(`${WEEK_TEMPLATE[dow].day} updated`);
  warnRestDays();
}
function resetDay(dow) {
  if (state.plan) delete state.plan[dow];
  save(); closeSheet();
  if (currentTab === 'plan') renderPlan(); else render();
  toast(`${WEEK_TEMPLATE[dow].day} reset to default`);
}
function restDayCount() {
  let n = 0; for (let dow = 0; dow < 7; dow++) if (getDay(dow).type === 'rest') n++;
  return n;
}
function warnRestDays() {
  if (restDayCount() < 2) toast('⚠️ Under 2 rest days — watch those knees');
}

/* --------------- Workout timer --------------- */
let timerState = { accMs: 0, startAt: 0, running: false, iv: null, title: '' };

function timerElapsedMs() {
  return timerState.accMs + (timerState.running ? Date.now() - timerState.startAt : 0);
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
function paintTimer() {
  const el = document.getElementById('timerClock');
  if (el) el.textContent = fmtClock(timerElapsedMs());
}
function buildSteps(resolved) {
  const steps = [];
  if (resolved.run) steps.push({ name: resolved.run.label, target: resolved.run.target, note: resolved.run.intensity });
  if (resolved.strength) for (const ex of resolved.strength.block) steps.push({ name: ex.name, target: `${ex.sets}×${ex.target}`, note: ex.note });
  return steps;
}
function startWorkout(title, dow, swapId) {
  if (dow == null) dow = new Date().getDay();
  if (!swapId) swapId = 'planned';
  const resolved = resolveSwap(getDay(dow), swapId);
  resolved.title = title || resolved.title;
  timerState = { accMs: 0, startAt: Date.now(), running: true, iv: null, title: resolved.title, steps: buildSteps(resolved), done: [] };
  timerState.done = new Array(timerState.steps.length).fill(false);
  renderTimerSheet(resolved);
  timerState.iv = setInterval(paintTimer, 250);
}
function stepsHtml() {
  if (!timerState.steps.length) return `<p class="muted" style="font-size:13px">Rest/recovery — no exercises to check off. Great job showing up.</p>`;
  return timerState.steps.map((s, i) => `
    <button class="chk-row ${timerState.done[i] ? 'done' : ''}" onclick="toggleStep(${i})">
      <span class="chk-box">${timerState.done[i] ? '✓' : ''}</span>
      <span class="chk-main"><span class="chk-name">${s.name}</span>${s.note ? `<span class="chk-note">${s.note}</span>` : ''}</span>
      <span class="chk-target">${s.target || ''}</span>
    </button>`).join('');
}
function paintSteps() {
  const wrap = document.getElementById('timerSteps'); if (wrap) wrap.innerHTML = stepsHtml();
  const n = timerState.done.filter(Boolean).length, t = timerState.steps.length;
  const pr = document.getElementById('timerProg'); if (pr) pr.style.width = (t ? (n / t) * 100 : 0) + '%';
  const pl = document.getElementById('timerProgLbl'); if (pl) pl.textContent = `${n} / ${t} done`;
}
function toggleStep(i) { timerState.done[i] = !timerState.done[i]; paintSteps(); }
function renderTimerSheet(resolved) {
  const t = timerState.steps.length;
  mountSheet(`
    <div class="eyebrow" style="text-align:center;margin-top:2px">Workout in progress</div>
    <h2 style="text-align:center">${resolved.title}</h2>
    <div class="timer-clock" id="timerClock">00:00</div>
    <div class="timer-controls">
      <button class="tbtn" id="tReset" title="Reset timer">↺</button>
      <button class="tbtn tbtn-main" id="tToggle">Pause</button>
    </div>
    ${t ? `<div class="timer-prog"><div class="timer-prog-top"><span class="eyebrow" style="margin:0">Follow along</span><span class="mono" id="timerProgLbl" style="font-size:12px;color:var(--ink-2)">0 / ${t} done</span></div>
      <div class="g-bar-track"><div class="g-bar-fill" id="timerProg" style="width:0%"></div></div></div>` : ''}
    <div class="timer-steps" id="timerSteps">${stepsHtml()}</div>
    <button class="btn btn-ember" id="tFinish" style="margin-top:16px">Finish &amp; log</button>
    <button class="btn btn-ghost" id="tLogNow" style="margin-top:10px">Log now (keep timer running)</button>
  `);
  document.getElementById('tToggle').addEventListener('click', toggleTimer);
  document.getElementById('tReset').addEventListener('click', resetTimer);
  document.getElementById('tFinish').addEventListener('click', () => logFromTimer(true));
  document.getElementById('tLogNow').addEventListener('click', () => logFromTimer(false));
  paintTimer();
}
function toggleTimer() {
  const btn = document.getElementById('tToggle');
  if (timerState.running) {
    timerState.accMs = timerElapsedMs(); timerState.running = false;
    clearInterval(timerState.iv); timerState.iv = null; if (btn) { btn.textContent = 'Resume'; btn.classList.add('paused'); }
  } else {
    timerState.startAt = Date.now(); timerState.running = true;
    timerState.iv = setInterval(paintTimer, 250); if (btn) { btn.textContent = 'Pause'; btn.classList.remove('paused'); }
  }
}
function resetTimer() {
  timerState.accMs = 0; timerState.startAt = Date.now();
  const btn = document.getElementById('tToggle');
  if (!timerState.running) { timerState.running = true; timerState.iv = setInterval(paintTimer, 250); if (btn) { btn.textContent = 'Pause'; btn.classList.remove('paused'); } }
  paintTimer();
}
function stopTimer() { clearInterval(timerState.iv); timerState.iv = null; timerState.running = false; }
function logFromTimer(finish) {
  const mins = Math.max(1, Math.round(timerElapsedMs() / 60000));
  const doneNames = timerState.steps.filter((_, i) => timerState.done[i]).map(s => s.name);
  const notes = doneNames.length ? 'Completed: ' + doneNames.join(', ') : '';
  const prefill = { duration: mins, notes };
  if (finish) { stopTimer(); closeSheet(); openLogSheet(timerState.title, prefill); }
  else { openLogSheet(timerState.title, prefill, { onSaved: () => toast('Logged — timer still running ⏱') }); }
}

/* --------------- Check-in --------------- */
let checkinDraft = {};
function openCheckin() {
  checkinDraft = { ...(state.checkins[todayKey()]?.answers || {}) };
  const qs = CHECKIN_QUESTIONS.map(q => `
    <div class="q-block">
      <div class="q-top"><div class="q-label ${q.critical ? 'critical' : ''}">${q.icon} ${q.label}</div></div>
      <div class="scale" data-q="${q.key}">
        ${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}" class="${checkinDraft[q.key] === n ? 'on' + (q.critical ? ' crit' : '') : ''}">${n}</button>`).join('')}
      </div>
      <div class="q-ends" style="display:flex;justify-content:space-between;margin-top:6px"><span>${q.low}</span><span>${q.high}</span></div>
    </div>`).join('');
  mountSheet(`
    <h2>Morning check-in</h2>
    <p class="sub">Rate each 1–5. I'll weigh your knees and legs heaviest, then set today's session so you don't have to decide.</p>
    ${qs}
    <button class="btn btn-ember" id="ciSubmit" style="margin-top:6px">See my session</button>
  `);
  document.querySelectorAll('.scale').forEach(sc => {
    sc.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const key = sc.dataset.q, crit = CHECKIN_QUESTIONS.find(q => q.key === key)?.critical;
      checkinDraft[key] = +b.dataset.v;
      sc.querySelectorAll('button').forEach(x => x.classList.remove('on', 'crit'));
      b.classList.add('on'); if (crit) b.classList.add('crit');
    });
  });
  document.getElementById('ciSubmit').addEventListener('click', () => {
    for (const q of CHECKIN_QUESTIONS) if (checkinDraft[q.key] == null) checkinDraft[q.key] = 3;
    const result = computeReadiness(checkinDraft);
    state.checkins[todayKey()] = { answers: { ...checkinDraft }, result, swap: result.rec.swap };
    save(); closeSheet(); currentTab = 'today'; render();
    toast(result.kneeFlag ? 'Plan adapted for your knees 🩹' : 'Session set — let\'s go');
  });
}

function openSwap() {
  const cur = state.checkins[todayKey()];
  const opts = SWAP_OPTIONS.map(o => `
    <button class="day-card" data-swap="${o.id}" style="width:100%;text-align:left;cursor:pointer;border:${cur?.swap === o.id ? '1px solid var(--ember)' : '1px solid var(--line)'};font:inherit">
      <div class="day-body"><h4>${o.label}</h4><p>${o.desc}</p></div>
    </button>`).join('');
  mountSheet(`<h2>Swap today's session</h2><p class="sub">Not feeling the plan? Pick what works — flexibility keeps you consistent.</p><div class="week-grid">${opts}</div>`);
  document.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', () => {
    if (!state.checkins[todayKey()]) {
      const result = computeReadiness({});
      state.checkins[todayKey()] = { answers: {}, result, swap: b.dataset.swap };
    } else state.checkins[todayKey()].swap = b.dataset.swap;
    save(); closeSheet(); currentTab = 'today'; render(); toast('Session swapped');
  }));
}

/* --------------- Log sheet (with auto-weather) --------------- */
let logDraft = {};
function openLogSheet(presetTitle, prefill, opts) {
  prefill = prefill || {}; opts = opts || {};
  const plan = getDay(new Date().getDay());
  logDraft = { type: 'run', title: presetTitle || plan.title, weather: null, mood: null, date: todayKey() };

  mountSheet(`
    <h2>Log a session</h2>
    <p class="sub">Every field's optional — capture what matters.</p>
    <div class="field"><label>Session type</label>
      <div class="seg" id="typeSeg">
        <button data-t="run" class="on">Run</button>
        <button data-t="strength">Strength</button>
        <button data-t="cross">Cross</button>
        <button data-t="rehab">Rehab</button>
      </div>
    </div>
    <div class="field"><label>Title</label><input id="f_title" value="${(logDraft.title || '').replace(/"/g, '')}" /></div>
    <div class="field"><label>Notes — how did it feel?</label>
      <textarea id="f_notes" placeholder="Legs, knees, breathing, anything worth remembering…">${(prefill.notes || '').replace(/</g, '&lt;')}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Distance (km)</label><input id="f_distance" class="mono" inputmode="decimal" placeholder="12.0" /></div>
      <div class="field"><label>Duration (min)</label><input id="f_duration" class="mono" inputmode="numeric" placeholder="60" value="${prefill.duration || ''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Avg pace (/km)</label><input id="f_pace" class="mono" placeholder="4:50" /></div>
      <div class="field"><label>Avg HR (bpm)</label><input id="f_hr" class="mono" inputmode="numeric" placeholder="150" /></div>
    </div>
    <div class="field"><label>Effort (RPE 1–10)</label>
      <div class="scale" id="rpeScale">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button data-v="${n}" style="font-size:13px">${n}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Mood</label>
      <div class="mood-row" id="moodRow">${MOOD_OPTS.map((m, i) => `<button class="chip" data-mood="${i+1}">${m}</button>`).join('')}</div>
    </div>
    <div class="field">
      <label>Weather <span id="weatherAutoLabel" style="font-size:11px;color:var(--ink-3);font-weight:400"></span></label>
      <div class="chip-row" id="weatherRow">${WEATHER_OPTS.map(w => `<button class="chip" data-w="${w}">${w}</button>`).join('')}</div>
    </div>
    <button class="btn btn-ember" id="logSubmit" style="margin-top:6px">Save session</button>
  `);

  bindSeg('typeSeg', 't', v => logDraft.type = v);
  bindScale('rpeScale', v => logDraft.rpe = v);
  bindChips('moodRow', 'mood', v => logDraft.mood = +v, true);
  bindChips('weatherRow', 'w', v => logDraft.weather = v, true);

  // Auto-detect weather silently in background
  autoDetectWeather().then(w => {
    if (!w) return;
    const row = document.getElementById('weatherRow');
    const lbl = document.getElementById('weatherAutoLabel');
    if (!row) return;
    const match = WEATHER_OPTS.find(o => o === w);
    if (match && !logDraft.weather) {
      logDraft.weather = match;
      row.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.w === match));
      if (lbl) lbl.textContent = '· auto-detected';
    }
  });

  document.getElementById('logSubmit').addEventListener('click', () => {
    const g = id => document.getElementById(id).value.trim();
    const entry = {
      id: uid(), date: logDraft.date, type: logDraft.type,
      title: g('f_title') || 'Session',
      notes: g('f_notes'),
      distance: parseFloat(g('f_distance')) || null,
      duration: parseInt(g('f_duration')) || null,
      pace: g('f_pace') || null,
      hr: parseInt(g('f_hr')) || null,
      rpe: logDraft.rpe || null,
      mood: logDraft.mood || null,
      weather: logDraft.weather || null,
    };
    state.sessions.push(entry);
    const g0 = state.goals[0];
    if (g0 && entry.distance) g0.progress = Math.min(100, (g0.progress || 0) + entry.distance / 4);
    save();
    checkForPB(entry);
    closeSheet();
    if (opts.onSaved) { opts.onSaved(entry); }
    else { currentTab = 'progress'; render(); toast('Session logged 💪'); }
  });
}

/* --------------- PLAN tab --------------- */
function renderPlan() {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const todayDow = new Date().getDay();
  let cards = order.map(dow => {
    const p = getDay(dow);
    const isToday = dow === todayDow, isRest = p.type === 'rest';
    const icon = isRest ? '☕' : p.type === 'run+strength' ? '🏃‍♀️＋🏋️' : '🏃‍♀️';
    const tags = [];
    if (p.run) tags.push(`<span class="pill">${p.run.target}</span>`);
    if (p.strength) tags.push(`<span class="pill">strength</span>`);
    if (/Interval|Long|Tempo|Speed/.test(p.title)) tags.push(`<span class="pill hard">key session</span>`);
    if (isRest) tags.push(`<span class="pill go">recovery</span>`);
    return `<button class="day-card ${isToday ? 'is-today' : ''} ${isRest ? 'is-rest' : ''}" onclick="openDayDetail(${dow})" style="width:100%;text-align:left;border:${isToday ? '1px solid var(--ember)' : '1px solid var(--line)'};font:inherit;cursor:pointer">
      <div class="day-badge"><span class="dd">${p.day.slice(0, 3)}</span><span class="di">${icon.slice(0, 2)}</span></div>
      <div class="day-body"><h4>${p.title}</h4><p>${p.focus}</p><div class="day-tags">${tags.join('')}</div></div>
      <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--ink-3);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join('');

  let runDays = 0, restDays = 0;
  for (let dow = 0; dow < 7; dow++) { const ty = getDay(dow).type; if (ty === 'rest') restDays++; else if (ty.includes('run') || ty === 'cross') runDays++; }
  const lowRest = restDays < 2;

  view.innerHTML = `
    <div class="eyebrow">Weekly structure</div>
    <div class="h-big">Your training week</div>
    <p class="muted" style="font-size:13.5px;margin:8px 2px 4px;line-height:1.5">${runDays} active · ${restDays} rest · strength on run days · knee rehab throughout. <b style="color:var(--ink-2)">Tap any day to view or ✎ customise it.</b></p>
    ${lowRest ? `<div class="card" style="margin-top:12px;border-color:var(--ember);background:var(--ember-soft)"><div style="font-size:13.5px;color:var(--ink);line-height:1.5"><b>⚠️ Only ${restDays} rest day${restDays === 1 ? '' : 's'} this week.</b> Aim for at least 2 to protect the knees.</div></div>` : ''}
    <div class="section-title">This week</div>
    <div class="week-grid">${cards}</div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Weekly volume target</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">
        <span class="mono" style="font-size:26px;font-weight:700">${state.settings.weeklyTarget}</span>
        <span class="muted">km / week — building gradually (max +10%/wk)</span>
      </div>
    </div>
    ${renderWeeklyNotes()}
  `;
  bindWeeklyNotes();
}

/* --------------- Weekly notes --------------- */
function renderWeeklyNotes() {
  const wk = weekKey();
  const note = (state.weeklyNotes && state.weeklyNotes[wk]) || '';
  return `<div class="section-title">Week notes</div>
  <div class="card">
    <p class="muted" style="font-size:12px;margin-bottom:10px">How's training going this week? Body feedback, goals, anything worth noting.</p>
    <textarea id="weeklyNote" placeholder="Feeling strong this week… knees behaved… focused on form…" style="width:100%;min-height:90px;font-family:var(--font-body);font-size:14px;border:none;background:transparent;color:var(--ink);resize:none;outline:none;line-height:1.6;padding:0">${escapeHtml(note)}</textarea>
    <div style="font-size:11px;color:var(--ink-3);margin-top:6px" id="noteStatus">Auto-saves as you type</div>
  </div>`;
}

let notesSaveTimer = null;
function bindWeeklyNotes() {
  const ta = document.getElementById('weeklyNote');
  if (!ta) return;
  ta.addEventListener('input', () => {
    const wk = weekKey();
    if (!state.weeklyNotes) state.weeklyNotes = {};
    state.weeklyNotes[wk] = ta.value;
    const st = document.getElementById('noteStatus');
    if (st) st.textContent = 'Saving…';
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      save();
      const st2 = document.getElementById('noteStatus');
      if (st2) { st2.textContent = 'Saved ✓'; setTimeout(() => { if (st2) st2.textContent = 'Auto-saves as you type'; }, 1500); }
    }, 900);
  });
}

/* --------------- PROGRESS tab --------------- */
function renderProgress() {
  const s = state.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const wk = weekSessions();
  const wkKm = wk.reduce((a, x) => a + (x.distance || 0), 0);
  const totalKm = s.reduce((a, x) => a + (x.distance || 0), 0);
  const runsWithPace = s.filter(x => x.pace);
  const avgPace = runsWithPace.length ? avgPaceStr(runsWithPace) : '—';
  const target = state.settings.weeklyTarget;
  const pct = Math.min(100, (wkKm / target) * 100);
  const pbs = computePBs();

  // ---- last 7 days ----
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const km = state.sessions.filter(x => x.date === k).reduce((a, x) => a + (x.distance || 0), 0);
    days7.push({ label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }), km });
  }
  const max7 = Math.max(8, ...days7.map(d => d.km));
  const bars7 = days7.map(d => `<div class="bar-col">
    <span class="bar-val">${d.km ? d.km.toFixed(0) : ''}</span>
    <div class="bar ${d.km ? '' : 'rest'}" style="height:${d.km ? Math.max(6, (d.km / max7) * 100) : 4}%"></div>
    <span class="bar-lbl">${d.label}</span></div>`).join('');

  const entries = s.slice().reverse().slice(0, 20).map(renderLogEntry).join('');

  view.innerHTML = `
    <div class="eyebrow">Progress</div>
    <div class="h-big">Your numbers</div>

    <div class="card" style="margin-top:16px">
      <div class="wk-prog-top">
        <span class="eyebrow" style="margin:0">This week</span>
        <span class="mono" style="font-size:13px;font-weight:700;color:var(--ember)">${wkKm.toFixed(1)}<span style="color:var(--ink-3);font-weight:400"> / ${target} km</span></span>
      </div>
      <div class="g-bar-track" style="margin-top:9px">
        <div class="g-bar-fill" style="width:${pct}%;transition:width .6s cubic-bezier(.2,.8,.2,1)"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:12px;color:var(--ink-3)">
        <span>${wk.length} sessions · ${Math.round(pct)}% of weekly target</span>
        <span>${pct >= 100 ? '🎉 Target hit!' : `${(target - wkKm).toFixed(1)} km left`}</span>
      </div>
    </div>

    <div class="stat-grid" style="margin-top:12px">
      <div class="stat"><div class="s-val">${totalKm.toFixed(0)}<span> km</span></div><div class="s-label">All-time km</div><div class="s-trend">${s.length} sessions</div></div>
      <div class="stat"><div class="s-val" style="font-size:22px">${avgPace}<span> /km</span></div><div class="s-label">Avg pace</div></div>
      <div class="stat"><div class="s-val">${(pbs.longest?.distance || 0).toFixed(1)}<span> km</span></div><div class="s-label">Longest run</div></div>
      <div class="stat"><div class="s-val">${wk.length}<span> / ${activeDaysThisWeek()}</span></div><div class="s-label">This week</div><div class="s-trend up">${wkKm.toFixed(1)} km done</div></div>
    </div>

    <div class="section-title">Personal Bests</div>
    ${buildPBCard(pbs)}

    <div class="section-title">Training Load</div>
    ${buildTrainingLoad()}

    <div class="card" style="margin-top:12px">
      <div class="eyebrow">Last 7 days · km</div>
      <div class="bars">${bars7}</div>
    </div>

    ${buildKneeTrend()}

    ${buildHRZoneChart()}

    <div class="section-title">Monthly breakdown</div>
    <div class="card">${buildMonthlySummary()}</div>

    ${buildWeightSection()}

    <div class="section-title">History</div>
    ${entries || `<div class="empty"><div class="e-emoji">🗒️</div><p>No sessions yet.<br>Tap the <b>＋</b> to log your first one.</p></div>`}
  `;
}

function buildPBCard(pbs) {
  const pbItems = [
    { label: '5K', pb: pbs.k5 },
    { label: '10K', pb: pbs.k10 },
    { label: '½ Marathon', pb: pbs.half },
    { label: 'Marathon', pb: pbs.marathon },
  ];
  const cells = pbItems.map(({ label, pb }) => pb
    ? `<div class="pb-item"><div class="pb-label">${label}</div><div class="pb-pace">${pb.pace}<span>/km</span></div><div class="pb-date">${new Date(pb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div></div>`
    : `<div class="pb-item pb-empty"><div class="pb-label">${label}</div><div class="pb-pace muted">—</div><div class="pb-date muted" style="font-size:10px">log a race-distance run</div></div>`
  ).join('');
  const longest = pbs.longest ? `<div class="pb-item"><div class="pb-label">Longest</div><div class="pb-pace">${pbs.longest.distance}<span>km</span></div><div class="pb-date">${new Date(pbs.longest.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div></div>` : '';
  return `<div class="card"><div class="pb-grid">${cells}${longest}</div><p class="muted" style="font-size:11px;margin-top:12px">Auto-detected from logged runs within ±200m of each race distance.</p></div>`;
}

function buildTrainingLoad() {
  const weeks = [];
  for (let i = 4; i >= 0; i--) {
    const start = new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - i * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const km = state.sessions.filter(s => { const d = new Date(s.date); return d >= start && d < end; })
      .reduce((a, s) => a + (s.distance || 0), 0);
    const label = i === 0 ? 'Now' : i === 1 ? 'Last' : `-${i}w`;
    weeks.push({ label, km });
  }
  const maxKm = Math.max(10, ...weeks.map(w => w.km));
  const bars = weeks.map(w => `<div class="bar-col">
    <span class="bar-val">${w.km ? w.km.toFixed(0) : ''}</span>
    <div class="bar ${w.km ? '' : 'rest'}" style="height:${w.km ? Math.max(6, (w.km / maxKm) * 100) : 4}%"></div>
    <span class="bar-lbl">${w.label}</span></div>`).join('');
  return `<div class="card"><div class="eyebrow">Rolling 5-week km</div><div class="bars" style="height:100px;margin-top:8px">${bars}</div></div>`;
}

function buildKneeTrend() {
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const ci = state.checkins[k];
    last14.push({ knee: ci ? (ci.answers?.knees ?? null) : null, label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }), idx: i });
  }
  const withData = last14.filter(d => d.knee !== null);
  if (withData.length < 3) return `<div class="section-title">Knee Health</div><div class="card"><p class="muted" style="font-size:13px;text-align:center;padding:8px 0">Complete 3+ check-ins to see your knee health trend.</p></div>`;

  const dots = last14.map((d, i) => {
    if (d.knee === null) return `<div class="kt-col"><div class="kt-dot-empty"></div><div class="kt-lbl">${i % 2 === 0 ? d.label : ''}</div></div>`;
    const pct = ((d.knee - 1) / 4) * 100;
    const col = d.knee <= 2 ? 'var(--ember)' : d.knee >= 4 ? 'var(--moss)' : 'var(--amber)';
    return `<div class="kt-col"><div class="kt-bar" style="height:${Math.max(8, pct)}%;background:${col}" title="${d.knee}/5 on check-in"></div><div class="kt-lbl">${i % 2 === 0 ? d.label : ''}</div></div>`;
  }).join('');

  const avg = (withData.reduce((a, d) => a + d.knee, 0) / withData.length).toFixed(1);
  const recent3 = withData.slice(-3).reduce((a, d) => a + d.knee, 0) / Math.min(3, withData.length);
  const trendLabel = recent3 >= 4 ? '↑ Looking strong' : recent3 >= 3 ? '→ Moderate' : '↓ Keep an eye on this';
  const trendCol = recent3 >= 4 ? 'var(--moss)' : recent3 >= 3 ? 'var(--amber)' : 'var(--ember)';

  return `<div class="section-title">Knee Health</div>
  <div class="card">
    <div class="wk-prog-top" style="margin-bottom:10px">
      <div class="eyebrow" style="margin:0">Last 14 days · check-in scores</div>
      <div style="font-size:12.5px;font-weight:600;color:${trendCol}">${trendLabel}</div>
    </div>
    <div class="kt-chart">${dots}</div>
    <div style="font-size:11.5px;color:var(--ink-3);margin-top:8px">Avg score ${avg}/5 · 1 = sore, 5 = perfect · red = caution zone</div>
  </div>`;
}

function buildHRZoneChart() {
  const withHR = state.sessions.filter(s => s.hr);
  if (withHR.length < 3) return '';
  const zones = [0, 0, 0, 0, 0];
  for (const s of withHR) zones[hrZone(s.hr).n - 1]++;
  const total = withHR.length;
  const zoneInfo = [
    { label: 'Z1 Recovery',  col: '#8fb4c8' },
    { label: 'Z2 Easy',      col: '#6aaa7e' },
    { label: 'Z3 Aerobic',   col: '#d4a017' },
    { label: 'Z4 Threshold', col: '#e07840' },
    { label: 'Z5 Max',       col: '#c72f5c' },
  ];
  const rows = zones.map((n, i) => {
    const pct = Math.round((n / total) * 100);
    return `<div class="hz-row">
      <span class="hz-label">${zoneInfo[i].label}</span>
      <div class="hz-bar-wrap"><div class="hz-bar" style="width:${pct}%;background:${zoneInfo[i].col}"></div></div>
      <span class="hz-pct">${pct}%</span>
    </div>`;
  }).join('');
  return `<div class="section-title">Heart Rate Zones</div>
  <div class="card">
    <div class="eyebrow" style="margin-bottom:12px">Distribution · ${total} sessions with HR · Max HR ${MAX_HR} bpm (age ${AGE})</div>
    ${rows}
  </div>`;
}

function buildMonthlySummary() {
  const months = {};
  for (const s of state.sessions) {
    const m = s.date.slice(0, 7);
    if (!months[m]) months[m] = { sessions: 0, km: 0 };
    months[m].sessions++;
    months[m].km += s.distance || 0;
  }
  const sorted = Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).slice(0, 6);
  if (!sorted.length) return '<p class="muted" style="font-size:13px;padding:8px 0">No sessions logged yet.</p>';
  return sorted.map(([m, d]) => {
    const label = new Date(m + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="month-row">
      <span class="month-label">${label}</span>
      <span class="month-km mono">${d.km.toFixed(0)}<span style="font-size:11px;color:var(--ink-3);font-weight:400"> km</span></span>
      <span class="month-sess">${d.sessions} sessions</span>
    </div>`;
  }).join('');
}

function buildWeightSection() {
  const sorted = [...(state.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  const sparkline = sorted.length >= 2 ? buildWeightSparkline(sorted) : '';
  return `<div class="section-title">Body Weight</div>
  <div class="card">
    ${latest
      ? `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px">
          <span class="mono" style="font-size:28px;font-weight:700">${latest.kg}</span>
          <span class="muted" style="font-size:14px">kg · ${new Date(latest.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>`
      : '<p class="muted" style="font-size:13.5px;margin-bottom:12px">No weight entries yet — track your trend over time.</p>'}
    ${sparkline}
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:12px" onclick="openWeightSheet()">＋ Log weight</button>
  </div>`;
}

function buildWeightSparkline(sorted) {
  const n = sorted.slice(-12);
  if (n.length < 2) return '';
  const kgs = n.map(w => w.kg);
  const minK = Math.min(...kgs) - 0.3, maxK = Math.max(...kgs) + 0.3;
  const W = 280, H = 56;
  const x = i => (i / (n.length - 1)) * W;
  const y = v => H - ((v - minK) / (maxK - minK || 1)) * H;
  const pts = n.map((w, i) => `${x(i).toFixed(1)},${y(w.kg).toFixed(1)}`).join(' ');
  const diff = (kgs[kgs.length - 1] - kgs[0]).toFixed(1);
  const diffLabel = diff > 0 ? `+${diff}` : diff;
  const diffCol = +diff < 0 ? 'var(--moss)' : +diff > 0 ? 'var(--ember)' : 'var(--ink-3)';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:56px;overflow:visible;display:block">
    <polyline points="${pts}" fill="none" stroke="var(--ember)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${n.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="3.5" fill="var(--ember)"/>`).join('')}
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-3);margin-top:4px">
    <span>${kgs[0]} kg</span>
    <span style="color:${diffCol};font-weight:600">${diffLabel} kg over ${n.length} entries</span>
    <span>${kgs[kgs.length - 1]} kg</span>
  </div>`;
}

/* --------------- Weight sheet --------------- */
function openWeightSheet() {
  const recent = [...(state.weights || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentHtml = recent.length
    ? `<div class="section-title" style="margin-top:20px;font-size:15px">Recent entries</div>${recent.map(w => `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)"><span class="mono" style="font-weight:600">${w.kg} kg</span><span style="font-size:12.5px;color:var(--ink-3)">${new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><button onclick="delWeight('${w.id}')" style="border:none;background:none;color:var(--ink-3);cursor:pointer;font-size:15px;padding:4px 8px">✕</button></div>`).join('')}` : '';
  mountSheet(`
    <h2>Log weight</h2>
    <p class="sub">Track body weight over time — long-term trends matter, not day-to-day.</p>
    <div class="field"><label>Weight (kg)</label><input id="w_kg" class="mono" inputmode="decimal" placeholder="63.5" /></div>
    <div class="field"><label>Date</label><input id="w_date" type="date" value="${todayKey()}" /></div>
    <button class="btn btn-ember" id="wSubmit">Save</button>
    ${recentHtml}
  `);
  document.getElementById('wSubmit').addEventListener('click', () => {
    const kg = parseFloat(document.getElementById('w_kg').value);
    const date = document.getElementById('w_date').value || todayKey();
    if (!kg || kg < 30 || kg > 200) { toast('Enter a valid weight (30–200 kg)'); return; }
    state.weights = state.weights || [];
    state.weights.push({ id: uid(), date, kg });
    state.weights.sort((a, b) => a.date.localeCompare(b.date));
    save(); closeSheet();
    if (currentTab === 'progress') renderProgress();
    toast('Weight logged');
  });
}
function delWeight(id) {
  state.weights = (state.weights || []).filter(w => w.id !== id);
  save(); closeSheet();
  if (currentTab === 'progress') renderProgress();
}

/* --------------- Log entry renderer --------------- */
function renderLogEntry(x) {
  const icon = { run: '🏃‍♀️', strength: '🏋️', cross: '🚴', rehab: '🩹' }[x.type] || '🏃‍♀️';
  const dt = new Date(x.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const m = [];
  if (x.distance) m.push(`<span class="le-m">📏 <b>${x.distance}</b> km</span>`);
  if (x.duration) m.push(`<span class="le-m">⏱ <b>${x.duration}</b> min</span>`);
  if (x.pace) m.push(`<span class="le-m">⚡ <b>${x.pace}</b>/km</span>`);
  if (x.hr) {
    const z = hrZone(x.hr);
    m.push(`<span class="le-m">❤️ <b>${x.hr}</b> <span class="zone-badge" style="background:${z.col}">${z.label}</span></span>`);
  }
  if (x.rpe) m.push(`<span class="le-m">💪 RPE <b>${x.rpe}</b></span>`);
  if (x.mood) m.push(`<span class="le-m">${MOOD_OPTS[x.mood - 1]}</span>`);
  return `<div class="log-entry">
    <div class="le-top"><div><div class="le-date">${dt} ${x.weather || ''}</div><div class="le-title">${icon} ${x.title}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="delSession('${x.id}')" style="padding:6px 10px;font-size:12px">✕</button></div>
    ${m.length ? `<div class="le-metrics">${m.join('')}</div>` : ''}
    ${x.notes ? `<div class="le-note">${escapeHtml(x.notes)}</div>` : ''}
  </div>`;
}
function delSession(id) { state.sessions = state.sessions.filter(s => s.id !== id); save(); render(); toast('Deleted'); }

function avgPaceStr(runs) {
  const secs = runs.map(r => { const [m, s] = r.pace.toString().split(/[:.]/); return (+m) * 60 + (+(s || 0)); });
  const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
  return `${Math.floor(avg / 60)}:${String(Math.round(avg % 60)).padStart(2, '0')}`;
}

/* --------------- GOALS --------------- */
function renderGoals() {
  const cards = state.goals.map(g => {
    const days = Math.max(0, Math.ceil((new Date(g.date) - new Date()) / 864e5));
    const wks = Math.floor(days / 7);
    return `<div class="card goal-card">
      <div class="eyebrow">Target race</div>
      <div class="g-race">${g.race}</div>
      <div class="g-date">${new Date(g.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} ${g.note ? '· ' + g.note : ''}</div>
      <div class="countdown">
        <div class="cd-unit"><div class="cd-n">${days}</div><div class="cd-l">days</div></div>
        <div class="cd-unit"><div class="cd-n">${wks}</div><div class="cd-l">weeks</div></div>
        <div class="cd-unit"><div class="cd-n">${g.targetKm}</div><div class="cd-l">km race</div></div>
      </div>
      <div class="g-progress">
        <div class="g-bar-track"><div class="g-bar-fill" style="width:${Math.min(100, g.progress || 0)}%"></div></div>
        <div class="g-meta"><span>Build progress</span><span>${Math.round(g.progress || 0)}%</span></div>
      </div>
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:14px" onclick="delGoal('${g.id}')">Remove goal</button>
    </div>`;
  }).join('');
  view.innerHTML = `
    <div class="eyebrow">Goals & events</div>
    <div class="h-big">What you're building toward</div>
    <p class="muted" style="font-size:13.5px;margin:8px 2px;line-height:1.5">Add races or events as they come up. Injury-free is the goal underneath every goal.</p>
    <div style="margin-top:16px">${cards}</div>
    <button class="add-inline" onclick="openGoalSheet()">＋ Add a goal or event</button>
  `;
}
function delGoal(id) { state.goals = state.goals.filter(g => g.id !== id); save(); render(); toast('Goal removed'); }

function openGoalSheet() {
  mountSheet(`
    <h2>Add a goal</h2>
    <p class="sub">A race, an event, or a target. The tracker reshapes around it.</p>
    <div class="field"><label>Name</label><input id="g_race" placeholder="e.g. City Half Marathon" /></div>
    <div class="field"><label>Date</label><input id="g_date" type="date" value="${todayKey()}" /></div>
    <div class="field"><label>Distance (km)</label><input id="g_km" class="mono" inputmode="decimal" placeholder="21.1" /></div>
    <div class="field"><label>Note</label><input id="g_note" placeholder="Goal time, priority, anything…" /></div>
    <button class="btn btn-ember" id="goalSubmit">Add goal</button>
  `);
  document.getElementById('goalSubmit').addEventListener('click', () => {
    const g = id => document.getElementById(id).value.trim();
    if (!g('g_race')) { toast('Give it a name'); return; }
    state.goals.push({ id: uid(), race: g('g_race'), date: g('g_date') || nextYear(), targetKm: parseFloat(g('g_km')) || 0, note: g('g_note'), progress: 0 });
    save(); closeSheet(); render(); toast('Goal added 🎯');
  });
}

/* --------------- Sheets + helpers --------------- */
const sheetRoot = document.getElementById('sheet-root');

function mountSheet(inner) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet"><div class="sheet-grip"></div>${inner}</div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
  sheetRoot.appendChild(wrap);
}
function closeSheet() {
  const backs = sheetRoot.querySelectorAll('.sheet-backdrop');
  if (backs.length) backs[backs.length - 1].remove();
}

function bindSeg(id, attr, cb) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); cb(b.dataset[attr]); });
}
function bindScale(id, cb) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); cb(+b.dataset.v); });
}
function bindChips(id, attr, cb, single) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return;
    if (single) el.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
    b.classList.toggle('on'); cb(b.dataset[attr]); });
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* --------------- Expose for inline onclick --------------- */
Object.assign(window, {
  openCheckin, openSwap, openLogSheet, openGoalSheet,
  delSession, delGoal, openDayDetail, startWorkout, closeSheet,
  toggleStep, openDayEditor, pickLib, saveDayEditor, resetDay,
  openWeightSheet, delWeight,
});

/* --------------- Register service worker (PWA) --------------- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* --------------- Boot --------------- */
try {
  render();
  initSync();
} catch (err) {
  console.error('Boot failed:', err);
  try { localStorage.removeItem(STORE_KEY); state = defaultState(); render(); initSync(); }
  catch (e2) {
    view.innerHTML = `<div class="empty"><div class="e-emoji">🛠️</div><p>Something glitched loading your data.<br>Tap below to reset and start fresh.</p><button class="btn btn-ember" style="margin-top:14px;width:auto" onclick="localStorage.clear();location.reload()">Reset app</button></div>`;
  }
}
