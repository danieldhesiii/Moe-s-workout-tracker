/* ============================================================
   Moe's Training Log — app logic
   State in localStorage. No backend. Mobile-first.
   ============================================================ */

const { WEEK_TEMPLATE, CHECKIN_QUESTIONS, SWAP_OPTIONS, WEATHER_OPTS, MOOD_OPTS } = window.MOE_DATA;

/* ---------------- State ---------------- */
const STORE_KEY = "moe_training_log_v1";

const defaultState = () => ({
  checkins: {},              // { 'YYY-MM-DD': {answers, score, band, suggestionId} }
  sessions: [],              // logged sessions
  goals: [
    { id: uid(), race: "Full Marathon", date: nextYear(), targetKm: 42.2, note: "Primary goal — flexible date", progress: 0 },
  ],
  settings: { weeklyTarget: 75 },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seedDemo(defaultState());
    return JSON.parse(raw);
  } catch { return defaultState(); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

function uid() { return Math.random().toString(36).slice(2, 9); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function nextYear() { const d = new Date(); d.setFullYear(d.getFullYear() + 1); d.setMonth(4, 12); return d.toISOString().slice(0, 10); }

/* Seed a little demo history so Progress isn't empty on first open */
function seedDemo(s) {
  const titles = ["Long Run", "Speed / Intervals", "Easy Run + Lower Strength", "Tempo / Threshold + Core", "Recovery Run + Upper Strength"];
  for (let i = 12; i > 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ([0, 4].includes(d.getDay())) continue; // rough rest days
    const km = +(8 + Math.random() * 16).toFixed(1);
    s.sessions.push({
      id: uid(), date: d.toISOString().slice(0, 10),
      title: titles[i % titles.length], type: "run",
      distance: km, duration: Math.round(km * (5.1 + Math.random() * .6)),
      pace: (4.6 + Math.random() * .8).toFixed(2), hr: Math.round(142 + Math.random() * 22),
      rpe: Math.round(4 + Math.random() * 4), mood: 3 + Math.round(Math.random()),
      weather: WEATHER_OPTS[Math.floor(Math.random() * 3)], notes: "",
    });
  }
  return s;
}

/* ---------------- Readiness engine ---------------- */
/* Turns the pre-workout check-in into an adaptive recommendation.
   Injury prevention is weighted hardest — sore knees cap the day. */
function computeReadiness(answers) {
  const w = { sleep: 1, energy: 1, legs: 1.2, knees: 1.6, motivation: .8, stress: 1 };
  let sum = 0, wsum = 0;
  for (const q of CHECKIN_QUESTIONS) {
    const v = answers[q.key] ?? 3;
    sum += v * (w[q.key] || 1); wsum += 5 * (w[q.key] || 1);
  }
  let score = Math.round((sum / wsum) * 100);

  const kneeVal = answers.knees ?? 3;
  const kneeFlag = kneeVal <= 2;           // sore knees → override
  if (kneeFlag) score = Math.min(score, 55);

  let band, ringCol;
  if (score >= 75 && !kneeFlag) { band = "green"; ringCol = "var(--moss)"; }
  else if (score >= 55) { band = "amber"; ringCol = "var(--amber)"; }
  else { band = "red"; ringCol = "var(--ember)"; }

  const plan = WEEK_TEMPLATE[new Date().getDay()];
  const rec = buildRecommendation(band, kneeFlag, plan);
  return { score, band, ringCol, kneeFlag, rec, plan };
}

function buildRecommendation(band, kneeFlag, plan) {
  const isHardDay = plan.type === "run" && /Interval|Long|Tempo|Speed/.test(plan.title);
  if (kneeFlag) {
    return {
      cls: "caution", label: "Adapted — protect the knees",
      title: "Swap to low-impact + rehab",
      body: `Your knees flagged sore today. Skip impact. Do the knee rehab circuit and, if you want aerobic work, cross-train (bike/swim) at an easy effort. Nothing is worth a flare-up — this is exactly the call that keeps you running long-term.`,
      swap: "rehab",
    };
  }
  if (band === "green") {
    return isHardDay
      ? { cls: "hard", label: "Green light — go get it", title: `Full send: ${plan.title}`, body: `You're primed. Run the session exactly as prescribed. Full warm-up first, then hit the targets. Great day to push progressive overload.`, swap: "planned" }
      : { cls: "", label: "Ready — on plan", title: plan.title, body: `Body's in good shape. Follow the plan as written and log it after.`, swap: "planned" };
  }
  if (band === "amber") {
    return isHardDay
      ? { cls: "caution", label: "Amber — dial it back", title: "Ease the intensity", body: `You're a bit under par. Keep today's session but drop the hard reps — turn intervals into a steady Zone 2, or cut volume ~20%. Consistency beats heroics.`, swap: "easy" }
      : { cls: "caution", label: "Amber — keep it gentle", title: "Easy version of today", body: `Do a relaxed version of the plan. Prioritise form and finish feeling like you could do more.`, swap: "easy" };
  }
  return {
    cls: "caution", label: "Red — recover", title: "Rest or light mobility",
    body: `Low readiness across the board. The smart move is rest or a gentle walk plus mobility. You bank fitness by recovering, not by grinding a bad day.`,
    swap: "rest",
  };
}

/* ---------------- Router ---------------- */
let currentTab = "today";
const view = document.getElementById("view");

function render() {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === currentTab));
  ({ today: renderToday, plan: renderPlan, log: () => openLogSheet(), progress: renderProgress, goals: renderGoals }[currentTab] || renderToday)();
  updateHeader();
}

document.getElementById("tabbar").addEventListener("click", e => {
  const btn = e.target.closest(".tab"); if (!btn) return;
  if (btn.dataset.tab === "log") { openLogSheet(); return; }
  currentTab = btn.dataset.tab; render();
});

function updateHeader() {
  const d = new Date();
  document.getElementById("headerDate").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  const wk = weekSessions().length;
  document.getElementById("streakNum").textContent = wk;
}

/* ---------------- TODAY ---------------- */
function renderToday() {
  const plan = WEEK_TEMPLATE[new Date().getDay()];
  const ci = state.checkins[todayKey()];

  let html = `<div class="today-hero">
    <div class="eyebrow">Today · ${plan.focus}</div>
    <div class="h-big">${plan.title}</div>
  </div>`;

  // Guard: heal any stored check-in that predates the current schema
  if (ci && !ci.result) { ci.result = computeReadiness(ci.answers || {}); state.checkins[todayKey()] = ci; save(); }

  if (!ci) {
    html += `<div class="card readiness-card" style="margin-top:16px">
      <div class="eyebrow">Daily check-in</div>
      <h3 style="font-family:var(--font-display);font-size:20px;font-weight:600;margin:4px 0 6px">How are you feeling?</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.5">Tell me before you start and I'll set today's session for you — no guesswork. Takes 15 seconds.</p>
      <button class="btn btn-ember" style="margin-top:16px" onclick="openCheckin()">Start check-in</button>
    </div>`;
  } else {
    const r = ci.result;
    html += renderReadinessCard(r);
    html += renderWorkoutCard(r.plan, ci.swap || r.rec.swap);
  }

  view.innerHTML = html;
}

function renderReadinessCard(r) {
  return `<div class="card readiness-card" style="margin-top:16px">
    <div class="readiness-ring">
      <div class="ring" style="--pct:${r.score};--ring-col:${r.ringCol}"><span class="ring-val">${r.score}</span></div>
      <div class="ring-info">
        <h3>Readiness ${r.band === "green" ? "· strong" : r.band === "amber" ? "· moderate" : "· low"}</h3>
        <p>${r.kneeFlag ? "⚠️ Knees flagged — plan adapted to protect them." : "Based on this morning's check-in."}</p>
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

// Shared: the run + strength + coach body of a workout (used by Today, Plan detail & timer)
function workoutBodyHtml(resolved) {
  let html = "";
  if (resolved.run) {
    const rn = resolved.run;
    html += `<div class="wk-block">
      <div class="wk-metrics">
        <div class="metric"><div class="m-label">${rn.style === "time" ? "Duration" : "Distance"}</div><div class="m-val">${rn.target}</div></div>
        <div class="metric"><div class="m-label">Intensity</div><div class="m-val" style="font-size:13px">${rn.intensity}</div></div>
        ${rn.pace ? `<div class="metric"><div class="m-label">Pace</div><div class="m-val" style="font-size:13px">${rn.pace}</div></div>` : ""}
      </div>
      ${rn.warmup ? `<p class="muted" style="font-size:12.5px;margin-top:10px">🔥 Warm-up: ${rn.warmup}</p>` : ""}
    </div>`;
  }
  if (resolved.strength) {
    html += `<div class="wk-block"><div class="eyebrow" style="margin-top:16px">${resolved.strength.label}</div><div class="exlist">`;
    for (const ex of resolved.strength.block) {
      html += `<div class="exrow"><div style="flex:1"><div class="ex-name">${ex.name}</div>${ex.note ? `<div class="ex-note">${ex.note}</div>` : ""}</div><div class="ex-target">${ex.sets}×${ex.target}</div></div>`;
    }
    html += `</div></div>`;
  }
  if (resolved.coach) html += `<div class="coach-note"><strong>Coach:</strong> ${resolved.coach}</div>`;
  return html;
}

function renderWorkoutCard(plan, swapId) {
  // Resolve swap into what she actually does
  const resolved = resolveSwap(plan, swapId);
  const t = resolved.title.replace(/'/g, "");
  const isRest = /Rest Day|Full Rest/.test(resolved.title);
  let html = `<div class="card" style="margin-top:12px">
    <div class="wk-header">
      <div><div class="eyebrow">Your session${swapId !== "planned" ? " · swapped" : ""}</div>
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
  const tagFor = t => t === "hard" ? `<span class="pill hard">high impact</span>` : t === "rest" ? `<span class="pill">recovery</span>` : `<span class="pill go">on plan</span>`;
  switch (swapId) {
    case "rehab":
      return { title: "Rehab + Mobility", run: null, strength: { label: "Knee rehab circuit", block: window.MOE_DATA.KNEE_REHAB }, coach: "Low-impact and protective. Move well, no pain.", tag: `<span class="pill caution">protective</span>` };
    case "rest":
      return { title: "Rest Day", run: null, strength: null, coach: "Full recovery. A gentle walk is fine. Adaptation happens now.", tag: `<span class="pill">rest</span>` };
    case "easy":
      return { title: "Easy Run", run: { style: "time", label: "Easy run", target: "35–40 min", intensity: "Zone 2 · conversational", pace: "5:30–6:00 /km" }, strength: null, coach: "Keep it genuinely easy — nose-breathing pace.", tag: `<span class="pill go">easy</span>` };
    case "strength":
      return { title: "Strength Session", run: null, strength: plan.strength || { label: "Full body", block: window.MOE_DATA.KNEE_REHAB }, coach: "Control every rep. Progressive overload only if it's clean.", tag: `<span class="pill">strength</span>` };
    case "cross":
      return { title: "Cross-Training", run: { style: "time", label: "Bike / swim", target: "45 min", intensity: "Zone 2 · low-impact" }, strength: null, coach: "Aerobic work with zero pounding on the knees.", tag: `<span class="pill go">low impact</span>` };
    default: {
      const hard = /Interval|Long|Tempo|Speed/.test(plan.title);
      return { title: plan.title, run: plan.run, strength: plan.strength, coach: plan.coach, tag: plan.type === "rest" ? tagFor("rest") : tagFor(hard ? "hard" : "plan") };
    }
  }
}

/* ---------------- Plan day detail ---------------- */
function openDayDetail(dow) {
  const plan = WEEK_TEMPLATE[dow];
  const resolved = resolveSwap(plan, "planned");
  const t = resolved.title.replace(/'/g, "");
  const isRest = plan.type === "rest";
  mountSheet(`
    <div class="eyebrow" style="margin-top:2px">${plan.day} · ${plan.focus}</div>
    <h2 style="display:flex;align-items:center;gap:10px">${resolved.title} ${resolved.tag}</h2>
    <div style="margin-top:14px">${workoutBodyHtml(resolved)}</div>
    ${isRest
      ? `<button class="btn btn-ghost" style="margin-top:16px" onclick="closeSheet()">Close</button>`
      : `<button class="btn btn-ember" style="margin-top:16px" onclick="startWorkout('${t}', ${dow}, 'planned')">▶ Start workout</button>
         <button class="btn btn-ghost" style="margin-top:10px" onclick="openLogSheet('${t}')">Log without timer</button>`}
  `);
}

/* ---------------- Workout timer (follow-along player) ---------------- */
let timerState = { accMs: 0, startAt: 0, running: false, iv: null, title: "" };

function timerElapsedMs() {
  return timerState.accMs + (timerState.running ? Date.now() - timerState.startAt : 0);
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = n => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}
function paintTimer() {
  const el = document.getElementById("timerClock");
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
  if (!swapId) swapId = "planned";
  const resolved = resolveSwap(WEEK_TEMPLATE[dow], swapId);
  resolved.title = title || resolved.title;
  timerState = { accMs: 0, startAt: Date.now(), running: true, iv: null, title: resolved.title, steps: buildSteps(resolved), done: [] };
  timerState.done = new Array(timerState.steps.length).fill(false);
  renderTimerSheet(resolved);
  timerState.iv = setInterval(paintTimer, 250);
}

function stepsHtml() {
  if (!timerState.steps.length) return `<p class="muted" style="font-size:13px">Rest/recovery — no exercises to check off. Great job showing up.</p>`;
  return timerState.steps.map((s, i) => `
    <button class="chk-row ${timerState.done[i] ? "done" : ""}" onclick="toggleStep(${i})">
      <span class="chk-box">${timerState.done[i] ? "✓" : ""}</span>
      <span class="chk-main"><span class="chk-name">${s.name}</span>${s.note ? `<span class="chk-note">${s.note}</span>` : ""}</span>
      <span class="chk-target">${s.target || ""}</span>
    </button>`).join("");
}
function paintSteps() {
  const wrap = document.getElementById("timerSteps"); if (wrap) wrap.innerHTML = stepsHtml();
  const n = timerState.done.filter(Boolean).length, t = timerState.steps.length;
  const pr = document.getElementById("timerProg"); if (pr) pr.style.width = (t ? (n / t) * 100 : 0) + "%";
  const pl = document.getElementById("timerProgLbl"); if (pl) pl.textContent = `${n} / ${t} done`;
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
      <div class="g-bar-track"><div class="g-bar-fill" id="timerProg" style="width:0%"></div></div></div>` : ""}
    <div class="timer-steps" id="timerSteps">${stepsHtml()}</div>
    <button class="btn btn-ember" id="tFinish" style="margin-top:16px">Finish &amp; log</button>
    <button class="btn btn-ghost" id="tLogNow" style="margin-top:10px">Log now (keep timer running)</button>
  `);
  document.getElementById("tToggle").addEventListener("click", toggleTimer);
  document.getElementById("tReset").addEventListener("click", resetTimer);
  document.getElementById("tFinish").addEventListener("click", () => logFromTimer(true));
  document.getElementById("tLogNow").addEventListener("click", () => logFromTimer(false));
  paintTimer();
}
function toggleTimer() {
  const btn = document.getElementById("tToggle");
  if (timerState.running) {
    timerState.accMs = timerElapsedMs(); timerState.running = false;
    clearInterval(timerState.iv); timerState.iv = null; btn.textContent = "Resume"; btn.classList.add("paused");
  } else {
    timerState.startAt = Date.now(); timerState.running = true;
    timerState.iv = setInterval(paintTimer, 250); btn.textContent = "Pause"; btn.classList.remove("paused");
  }
}
function resetTimer() {
  timerState.accMs = 0; timerState.startAt = Date.now();
  const btn = document.getElementById("tToggle");
  if (!timerState.running) { timerState.running = true; timerState.iv = setInterval(paintTimer, 250); if (btn) { btn.textContent = "Pause"; btn.classList.remove("paused"); } }
  paintTimer();
}
function stopTimer() { clearInterval(timerState.iv); timerState.iv = null; timerState.running = false; }

// finish=true → stop timer & close the player; finish=false → log on top, timer keeps running
function logFromTimer(finish) {
  const mins = Math.max(1, Math.round(timerElapsedMs() / 60000));
  const doneNames = timerState.steps.filter((_, i) => timerState.done[i]).map(s => s.name);
  const notes = doneNames.length ? "Completed: " + doneNames.join(", ") : "";
  const prefill = { duration: mins, notes };
  if (finish) { stopTimer(); closeSheet(); openLogSheet(timerState.title, prefill); }
  else { openLogSheet(timerState.title, prefill, { onSaved: () => toast("Logged — timer still running ⏱") }); }
}

/* ---------------- Check-in sheet ---------------- */
let checkinDraft = {};
function openCheckin() {
  checkinDraft = { ...(state.checkins[todayKey()]?.answers || {}) };
  let qs = CHECKIN_QUESTIONS.map(q => `
    <div class="q-block">
      <div class="q-top">
        <div class="q-label ${q.critical ? "critical" : ""}">${q.icon} ${q.label}</div>
      </div>
      <div class="scale" data-q="${q.key}">
        ${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}" class="${checkinDraft[q.key] === n ? "on" + (q.critical ? " crit" : "") : ""}">${n}</button>`).join("")}
      </div>
      <div class="q-ends" style="display:flex;justify-content:space-between;margin-top:6px"><span>${q.low}</span><span>${q.high}</span></div>
    </div>`).join("");

  mountSheet(`
    <h2>Morning check-in</h2>
    <p class="sub">Rate each 1–5. I'll weigh your knees and legs heaviest, then set today's session so you don't have to decide.</p>
    ${qs}
    <button class="btn btn-ember" id="ciSubmit" style="margin-top:6px">See my session</button>
  `);

  document.querySelectorAll(".scale").forEach(sc => {
    sc.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const key = sc.dataset.q, crit = CHECKIN_QUESTIONS.find(q => q.key === key)?.critical;
      checkinDraft[key] = +b.dataset.v;
      sc.querySelectorAll("button").forEach(x => x.classList.remove("on", "crit"));
      b.classList.add("on"); if (crit) b.classList.add("crit");
    });
  });
  document.getElementById("ciSubmit").addEventListener("click", () => {
    for (const q of CHECKIN_QUESTIONS) if (checkinDraft[q.key] == null) checkinDraft[q.key] = 3;
    const result = computeReadiness(checkinDraft);
    state.checkins[todayKey()] = { answers: { ...checkinDraft }, result, swap: result.rec.swap };
    save(); closeSheet(); currentTab = "today"; render();
    toast(result.kneeFlag ? "Plan adapted for your knees 🩹" : "Session set — let's go");
  });
}

function openSwap() {
  const cur = state.checkins[todayKey()];
  let opts = SWAP_OPTIONS.map(o => `
    <button class="day-card" data-swap="${o.id}" style="width:100%;text-align:left;cursor:pointer;border:none;font:inherit;${cur?.swap === o.id ? "border:1px solid var(--ember)" : ""}">
      <div class="day-body"><h4>${o.label}</h4><p>${o.desc}</p></div>
    </button>`).join("");
  mountSheet(`<h2>Swap today's session</h2><p class="sub">Not feeling the plan? Pick what works — flexibility keeps you consistent.</p><div class="week-grid">${opts}</div>`);
  document.querySelectorAll("[data-swap]").forEach(b => b.addEventListener("click", () => {
    if (!state.checkins[todayKey()]) {
      const result = computeReadiness({});
      state.checkins[todayKey()] = { answers: {}, result, swap: b.dataset.swap };
    } else state.checkins[todayKey()].swap = b.dataset.swap;
    save(); closeSheet(); currentTab = "today"; render(); toast("Session swapped");
  }));
}

/* ---------------- LOG sheet ---------------- */
let logDraft = {};
function openLogSheet(presetTitle, prefill, opts) {
  prefill = prefill || {}; opts = opts || {};
  const plan = WEEK_TEMPLATE[new Date().getDay()];
  logDraft = { type: "run", title: presetTitle || plan.title, weather: null, mood: null, date: todayKey() };
  mountSheet(`
    <h2>Log a session</h2>
    <p class="sub">Every field's optional — capture what matters. Notes sit above the numbers.</p>

    <div class="field"><label>Session type</label>
      <div class="seg" id="typeSeg">
        <button data-t="run" class="on">Run</button>
        <button data-t="strength">Strength</button>
        <button data-t="cross">Cross</button>
        <button data-t="rehab">Rehab</button>
      </div>
    </div>

    <div class="field"><label>Title</label><input id="f_title" value="${(logDraft.title || "").replace(/"/g, "")}" /></div>

    <div class="field"><label>Notes — how did it feel?</label>
      <textarea id="f_notes" placeholder="Legs, knees, breathing, anything worth remembering…">${(prefill.notes || "").replace(/</g, "&lt;")}</textarea></div>

    <div class="field-row">
      <div class="field"><label>Distance (km)</label><input id="f_distance" class="mono" inputmode="decimal" placeholder="12.0" /></div>
      <div class="field"><label>Duration (min)</label><input id="f_duration" class="mono" inputmode="numeric" placeholder="60" value="${prefill.duration || ""}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Avg pace (/km)</label><input id="f_pace" class="mono" placeholder="4:50" /></div>
      <div class="field"><label>Avg HR (bpm)</label><input id="f_hr" class="mono" inputmode="numeric" placeholder="150" /></div>
    </div>

    <div class="field"><label>Effort (RPE 1–10)</label>
      <div class="scale" id="rpeScale">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button data-v="${n}" style="font-size:13px">${n}</button>`).join("")}</div>
    </div>

    <div class="field"><label>Mood</label>
      <div class="mood-row" id="moodRow">${MOOD_OPTS.map((m,i) => `<button class="chip" data-mood="${i+1}">${m}</button>`).join("")}</div>
    </div>

    <div class="field"><label>Weather</label>
      <div class="chip-row" id="weatherRow">${WEATHER_OPTS.map(w => `<button class="chip" data-w="${w}">${w}</button>`).join("")}</div>
    </div>

    <button class="btn btn-ember" id="logSubmit" style="margin-top:6px">Save session</button>
  `);

  bindSeg("typeSeg", "t", v => logDraft.type = v);
  bindScale("rpeScale", v => logDraft.rpe = v);
  bindChips("moodRow", "mood", v => logDraft.mood = +v, true);
  bindChips("weatherRow", "w", v => logDraft.weather = v, true);

  document.getElementById("logSubmit").addEventListener("click", () => {
    const g = id => document.getElementById(id).value.trim();
    const entry = {
      id: uid(), date: logDraft.date, type: logDraft.type, title: g("f_title") || "Session",
      notes: g("f_notes"),
      distance: parseFloat(g("f_distance")) || null,
      duration: parseInt(g("f_duration")) || null,
      pace: g("f_pace") || null, hr: parseInt(g("f_hr")) || null,
      rpe: logDraft.rpe || null, mood: logDraft.mood || null, weather: logDraft.weather || null,
    };
    state.sessions.push(entry);
    // nudge goal progress by distance
    const g0 = state.goals[0];
    if (g0 && entry.distance) g0.progress = Math.min(100, (g0.progress || 0) + entry.distance / 4);
    save(); closeSheet();
    if (opts.onSaved) { opts.onSaved(entry); }        // stacked over a running timer — stay put
    else { currentTab = "progress"; render(); toast("Session logged 💪"); }
  });
}

/* ---------------- PLAN ---------------- */
function renderPlan() {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const todayDow = new Date().getDay();
  let cards = order.map(dow => {
    const p = WEEK_TEMPLATE[dow];
    const isToday = dow === todayDow, isRest = p.type === "rest";
    const icon = isRest ? "☕" : p.type === "run+strength" ? "🏃‍♀️＋🏋️" : "🏃‍♀️";
    const tags = [];
    if (p.run) tags.push(`<span class="pill">${p.run.target}</span>`);
    if (p.strength) tags.push(`<span class="pill">strength</span>`);
    if (/Interval|Long|Tempo|Speed/.test(p.title)) tags.push(`<span class="pill hard">key session</span>`);
    if (isRest) tags.push(`<span class="pill go">recovery</span>`);
    return `<button class="day-card ${isToday ? "is-today" : ""} ${isRest ? "is-rest" : ""}" onclick="openDayDetail(${dow})" style="width:100%;text-align:left;border:${isToday ? "1px solid var(--ember)" : "1px solid var(--line)"};font:inherit;cursor:pointer">
      <div class="day-badge"><span class="dd">${p.day.slice(0,3)}</span><span class="di">${icon.slice(0,2)}</span></div>
      <div class="day-body"><h4>${p.title}</h4><p>${p.focus}</p><div class="day-tags">${tags.join("")}</div></div>
      <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--ink-3);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
  }).join("");

  view.innerHTML = `
    <div class="eyebrow">Weekly structure</div>
    <div class="h-big">Your training week</div>
    <p class="muted" style="font-size:13.5px;margin:8px 2px 4px;line-height:1.5">5 run days · 2 rest · strength stacked on run days · knee rehab woven throughout. Progressive overload, injury-first.</p>
    <div class="section-title">This week</div>
    <div class="week-grid">${cards}</div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Weekly volume target</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">
        <span class="mono" style="font-size:26px;font-weight:700">${state.settings.weeklyTarget}</span>
        <span class="muted">km / week — building gradually (max +10%/wk)</span>
      </div>
    </div>`;
}

/* ---------------- PROGRESS ---------------- */
function weekSessions() {
  const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0,0,0,0);
  return state.sessions.filter(s => new Date(s.date) >= monday);
}
function renderProgress() {
  const s = state.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const wk = weekSessions();
  const wkKm = wk.reduce((a, x) => a + (x.distance || 0), 0);
  const totalKm = s.reduce((a, x) => a + (x.distance || 0), 0);
  const runsWithPace = s.filter(x => x.pace);
  const avgPace = runsWithPace.length ? avgPaceStr(runsWithPace) : "—";
  const longest = Math.max(0, ...s.map(x => x.distance || 0));

  // last 7 days bars
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0,10);
    const km = state.sessions.filter(x => x.date === k).reduce((a, x) => a + (x.distance || 0), 0);
    days.push({ label: d.toLocaleDateString("en-GB", { weekday: "narrow" }), km }); }
  const maxKm = Math.max(8, ...days.map(d => d.km));

  let bars = days.map(d => `<div class="bar-col">
    <span class="bar-val">${d.km ? d.km.toFixed(0) : ""}</span>
    <div class="bar ${d.km ? "" : "rest"}" style="height:${d.km ? Math.max(6, (d.km / maxKm) * 100) : 4}%"></div>
    <span class="bar-lbl">${d.label}</span></div>`).join("");

  let entries = s.slice().reverse().slice(0, 20).map(renderLogEntry).join("");

  view.innerHTML = `
    <div class="eyebrow">Progress</div>
    <div class="h-big">Your numbers</div>
    <div class="stat-grid" style="margin-top:16px">
      <div class="stat"><div class="s-val">${wkKm.toFixed(1)}<span> km</span></div><div class="s-label">This week</div><div class="s-trend up">Target ${state.settings.weeklyTarget} km</div></div>
      <div class="stat"><div class="s-val">${totalKm.toFixed(0)}<span> km</span></div><div class="s-label">All-time logged</div><div class="s-trend">${s.length} sessions</div></div>
      <div class="stat"><div class="s-val" style="font-size:22px">${avgPace}<span> /km</span></div><div class="s-label">Avg pace</div></div>
      <div class="stat"><div class="s-val">${longest.toFixed(1)}<span> km</span></div><div class="s-label">Longest run</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Last 7 days · km</div>
      <div class="bars">${bars}</div>
    </div>

    <div class="section-title">History</div>
    ${entries || `<div class="empty"><div class="e-emoji">🗒️</div><p>No sessions yet.<br>Tap the <b>＋</b> to log your first one.</p></div>`}
  `;
}

function renderLogEntry(x) {
  const icon = { run: "🏃‍♀️", strength: "🏋️", cross: "🚴", rehab: "🩹" }[x.type] || "🏃‍♀️";
  const dt = new Date(x.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const m = [];
  if (x.distance) m.push(`<span class="le-m">📏 <b>${x.distance}</b> km</span>`);
  if (x.duration) m.push(`<span class="le-m">⏱ <b>${x.duration}</b> min</span>`);
  if (x.pace) m.push(`<span class="le-m">⚡ <b>${x.pace}</b>/km</span>`);
  if (x.hr) m.push(`<span class="le-m">❤️ <b>${x.hr}</b></span>`);
  if (x.rpe) m.push(`<span class="le-m">💪 RPE <b>${x.rpe}</b></span>`);
  if (x.mood) m.push(`<span class="le-m">${MOOD_OPTS[x.mood - 1]}</span>`);
  return `<div class="log-entry">
    <div class="le-top"><div><div class="le-date">${dt} ${x.weather || ""}</div><div class="le-title">${icon} ${x.title}</div></div>
    <button class="btn btn-ghost btn-sm" onclick="delSession('${x.id}')" style="padding:6px 10px;font-size:12px">✕</button></div>
    ${m.length ? `<div class="le-metrics">${m.join("")}</div>` : ""}
    ${x.notes ? `<div class="le-note">${escapeHtml(x.notes)}</div>` : ""}
  </div>`;
}
function delSession(id) { state.sessions = state.sessions.filter(s => s.id !== id); save(); render(); toast("Deleted"); }

function avgPaceStr(runs) {
  const secs = runs.map(r => { const [m, s] = r.pace.toString().split(/[:.]/); return (+m) * 60 + (+(s || 0)); });
  const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
  return `${Math.floor(avg / 60)}:${String(Math.round(avg % 60)).padStart(2, "0")}`;
}

/* ---------------- GOALS ---------------- */
function renderGoals() {
  let cards = state.goals.map(g => {
    const days = Math.max(0, Math.ceil((new Date(g.date) - new Date()) / 864e5));
    const wks = Math.floor(days / 7);
    return `<div class="card goal-card">
      <div class="eyebrow">Target race</div>
      <div class="g-race">${g.race}</div>
      <div class="g-date">${new Date(g.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} ${g.note ? "· " + g.note : ""}</div>
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
  }).join("");

  view.innerHTML = `
    <div class="eyebrow">Goals & events</div>
    <div class="h-big">What you're building toward</div>
    <p class="muted" style="font-size:13.5px;margin:8px 2px;line-height:1.5">Add races or events as they come up — the plan and countdown adapt around them. Injury-free is the goal underneath every goal.</p>
    <div style="margin-top:16px">${cards}</div>
    <button class="add-inline" onclick="openGoalSheet()">＋ Add a goal or event</button>
  `;
}
function delGoal(id) { state.goals = state.goals.filter(g => g.id !== id); save(); render(); toast("Goal removed"); }

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
  document.getElementById("goalSubmit").addEventListener("click", () => {
    const g = id => document.getElementById(id).value.trim();
    if (!g("g_race")) { toast("Give it a name"); return; }
    state.goals.push({ id: uid(), race: g("g_race"), date: g("g_date") || nextYear(), targetKm: parseFloat(g("g_km")) || 0, note: g("g_note"), progress: 0 });
    save(); closeSheet(); render(); toast("Goal added 🎯");
  });
}

/* ---------------- Sheet + helpers ---------------- */
const sheetRoot = document.getElementById("sheet-root");
// Sheets stack — a log sheet can open over a running timer, then close back to it.
function mountSheet(inner) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet"><div class="sheet-grip"></div>${inner}</div>`;
  wrap.addEventListener("click", e => { if (e.target === wrap) closeSheet(); });
  sheetRoot.appendChild(wrap);
}
function closeSheet() {
  const backs = sheetRoot.querySelectorAll(".sheet-backdrop");
  if (backs.length) backs[backs.length - 1].remove();
}

function bindSeg(id, attr, cb) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
    el.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); cb(b.dataset[attr]); });
}
function bindScale(id, cb) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
    el.querySelectorAll("button").forEach(x => x.classList.remove("on")); b.classList.add("on"); cb(+b.dataset.v); });
}
function bindChips(id, attr, cb, single) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return;
    if (single) el.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
    b.classList.toggle("on"); cb(b.dataset[attr]); });
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// expose for inline onclick
Object.assign(window, { openCheckin, openSwap, openLogSheet, openGoalSheet, delSession, delGoal, openDayDetail, startWorkout, closeSheet, toggleStep });

/* ---------------- Boot ---------------- */
try {
  render();
} catch (err) {
  console.error("Boot failed:", err);
  // Never leave a blank screen — reset corrupt state and retry once.
  try { localStorage.removeItem(STORE_KEY); state = defaultState(); render(); }
  catch (e2) {
    view.innerHTML = `<div class="empty"><div class="e-emoji">🛠️</div><p>Something glitched loading your data.<br>Tap below to reset and start fresh.</p><button class="btn btn-ember" style="margin-top:14px;width:auto" onclick="localStorage.clear();location.reload()">Reset app</button></div>`;
  }
}
