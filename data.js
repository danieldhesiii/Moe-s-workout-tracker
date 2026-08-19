/* ============================================================
   Moe's Training Log — plan & exercise data
   Advanced marathon runner, knee-safe, strength + running blend.
   Injury prevention is the non-negotiable constraint.
   ============================================================ */

const KNEE_REHAB = [
  { name: "Spanish squat (band)", sets: "3", target: "45s hold", note: "VMO + patellar tendon load, knee-safe isometric" },
  { name: "Terminal knee extension (TKE)", sets: "3", target: "15 / side", note: "Bands behind knee, drive to lockout" },
  { name: "Single-leg step-down", sets: "3", target: "10 / side", note: "Slow eccentric, control the drop — no knee cave" },
  { name: "Tibialis raises", sets: "3", target: "20", note: "Shin / anterior chain, shock absorption" },
  { name: "Calf raises (bent + straight)", sets: "3", target: "15 each", note: "Soleus + gastroc for landing forces" },
  { name: "Copenhagen / adductor", sets: "3", target: "8 / side", note: "Hip stability to protect the knee" },
];

const STRENGTH_LOWER = [
  { name: "Trap-bar deadlift", sets: "4", target: "5 reps @ RPE 7", note: "Progressive overload — add load when RPE drops" },
  { name: "Bulgarian split squat", sets: "3", target: "8 / side", note: "Unilateral strength, glute-driven" },
  { name: "Romanian deadlift", sets: "3", target: "8", note: "Posterior chain, hamstring resilience" },
  { name: "Hip thrust", sets: "3", target: "10", note: "Glute strength = knee protection" },
  ...KNEE_REHAB.slice(0, 3),
];

const STRENGTH_UPPER = [
  { name: "Pull-ups / assisted", sets: "4", target: "6–8", note: "Back & posture for running economy" },
  { name: "Dumbbell bench press", sets: "3", target: "8", note: "" },
  { name: "Single-arm row", sets: "3", target: "10 / side", note: "" },
  { name: "Overhead press", sets: "3", target: "8", note: "" },
  { name: "Pallof press + dead bug", sets: "3", target: "12", note: "Anti-rotation core for stride stability" },
];

const CORE_MOBILITY = [
  { name: "Hanging leg raises", sets: "3", target: "12", note: "" },
  { name: "Side plank + reach", sets: "3", target: "30s / side", note: "" },
  { name: "90/90 hip mobility", sets: "2", target: "8 / side", note: "" },
  { name: "World's greatest stretch", sets: "2", target: "5 / side", note: "" },
  ...KNEE_REHAB.slice(3),
];

/* Weekly template — 5 run days, 2 rest, strength stacked on run days.
   Preferred run days Mon/Tue/Wed honoured; Thu & Sun rest. */
const WEEK_TEMPLATE = {
  1: { // Monday
    day: "Monday", type: "run+strength", title: "Easy Run + Lower Strength",
    focus: "Aerobic base + knee-focused strength",
    run: { style: "distance", label: "Easy run", target: "10 km", intensity: "Zone 2 · conversational", pace: "5:15–5:40 /km" },
    strength: { label: "Lower body", block: STRENGTH_LOWER },
    coach: "Keep it truly easy — this is recovery-paced aerobic volume. Strength after the run, not before.",
  },
  2: { // Tuesday
    day: "Tuesday", type: "run", title: "Speed / Intervals",
    focus: "VO2 max + running economy",
    run: { style: "distance", label: "Interval session", target: "8–10 km total", intensity: "Zone 4–5", pace: "6×1km @ 4:05–4:15, 2min jog", warmup: "2km easy + strides" },
    strength: null,
    coach: "Highest-impact day. Only run this as prescribed if the check-in is green. Full warm-up is mandatory for the knees.",
  },
  3: { // Wednesday
    day: "Wednesday", type: "run+strength", title: "Recovery Run + Upper Strength",
    focus: "Active recovery + upper/core strength",
    run: { style: "time", label: "Recovery run", target: "40 min", intensity: "Zone 1–2 · very easy", pace: "5:30–6:00 /km" },
    strength: { label: "Upper body + core", block: STRENGTH_UPPER },
    coach: "Legs should feel fresher leaving than arriving. Push the upper-body strength here since legs are light.",
  },
  4: { // Thursday
    day: "Thursday", type: "rest", title: "Rest + Rehab",
    focus: "Full recovery, knee rehab, mobility",
    run: null,
    strength: { label: "Knee rehab + mobility", block: [...KNEE_REHAB, ...CORE_MOBILITY.slice(2)] },
    coach: "Non-negotiable rest from impact. Do the rehab circuit — this is what keeps the knees healthy long-term.",
  },
  5: { // Friday
    day: "Friday", type: "run+strength", title: "Tempo / Threshold + Core",
    focus: "Lactate threshold + core",
    run: { style: "distance", label: "Tempo run", target: "12 km", intensity: "Zone 3–4", pace: "20min @ 4:30 threshold block", warmup: "3km easy" },
    strength: { label: "Core", block: CORE_MOBILITY.slice(0, 4) },
    coach: "Controlled discomfort, not a race. If knees are talking after Tuesday, swap tempo for a steady Zone 2.",
  },
  6: { // Saturday
    day: "Saturday", type: "run", title: "Long Run",
    focus: "Marathon endurance",
    run: { style: "distance", label: "Long run", target: "24–28 km", intensity: "Zone 2 · steady", pace: "5:00–5:20 /km, last 5km faster" },
    strength: null,
    coach: "The cornerstone of marathon prep. Fuel every 40min, hydrate, and stop if knee pain changes your gait.",
  },
  0: { // Sunday
    day: "Sunday", type: "rest", title: "Full Rest",
    focus: "Recovery",
    run: null,
    strength: null,
    coach: "Complete rest or a gentle walk / swim. Recovery is where the adaptation happens.",
  },
};

/* Readiness check-in questions */
const CHECKIN_QUESTIONS = [
  { key: "sleep",     label: "Sleep quality",      icon: "😴", low: "Poor", high: "Great" },
  { key: "energy",    label: "Energy level",       icon: "⚡", low: "Flat", high: "Buzzing" },
  { key: "legs",      label: "Legs / freshness",   icon: "🦵", low: "Heavy", high: "Springy" },
  { key: "knees",     label: "Knees",              icon: "🩹", low: "Sore", high: "Perfect", critical: true },
  { key: "motivation",label: "Motivation",         icon: "🔥", low: "Low", high: "High" },
  { key: "stress",    label: "Stress (life)",      icon: "🧠", low: "High", high: "Calm" },
];

/* Alternative swaps she can pick if she doesn't want the planned session */
const SWAP_OPTIONS = [
  { id: "planned",  label: "Do the plan", desc: "Follow today's prescribed session" },
  { id: "easy",     label: "Easy run",    desc: "Swap for a relaxed Zone 2 run" },
  { id: "strength", label: "Strength",    desc: "Gym session instead of running" },
  { id: "rehab",    label: "Rehab + mobility", desc: "Knee circuit + mobility only" },
  { id: "cross",    label: "Cross-train", desc: "Bike / swim — low-impact aerobic" },
  { id: "rest",     label: "Rest",        desc: "Take the day off completely" },
];

const WEATHER_OPTS = ["☀️ Clear", "⛅ Cloudy", "🌧️ Rain", "❄️ Cold", "🥵 Hot", "💨 Windy"];
const MOOD_OPTS = ["😖", "😕", "😐", "🙂", "😄"];

window.MOE_DATA = { WEEK_TEMPLATE, CHECKIN_QUESTIONS, SWAP_OPTIONS, WEATHER_OPTS, MOOD_OPTS, KNEE_REHAB };
