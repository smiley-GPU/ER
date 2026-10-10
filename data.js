'use strict';
// Game data. Injury causes, injury patterns, vital signs and the three-level urgency model
// are based on Bara.md (Chris Hani Baragwanath Academic Hospital trauma unit), simplified so
// that anyone can read them: every vital sign is shown as a word on a three-step scale.

const ROUND_SECONDS = 90;        // one 12-hour night shift = 90 real seconds
const SHIFT_START_MIN = 20 * 60; // shift starts 20:00
const GAME_MIN_PER_SEC = 8;      // 720 game minutes / 90 s
const LOBBY_SLOTS = 6;
const PASS_RATE = 0.8;           // survival needed to unlock the next night

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

// Priority-one mechanism mix at Bara: ~1/3 stabbings, ~1/7 gunshots, ~1/7 blunt assault,
// plus road crashes, falls and burns.
const CAUSES = {
  stab:    { label: 'Stab wound', icon: '🔪', weight: 33 },
  gsw:     { label: 'Gunshot',    icon: '🔫', weight: 15 },
  assault: { label: 'Assault',    icon: '👊', weight: 14 },
  road:    { label: 'Road crash', icon: '🚗', weight: 15 },
  fall:    { label: 'Fall',       icon: '🧗', weight: 12 },
  burn:    { label: 'Burns',      icon: '🔥', weight: 11 },
};

// Each vital sign has three levels: 0 = fine, 1 = worrying, 2 = critical.
// Simplified from the Bara.md thresholds: pulse > 120, systolic BP < 90, GCS < 13 / < 9, SpO2 < 94 / < 90.
const VITALS = [
  { k: 'pulse', icon: '❤️', label: 'Pulse',     words: ['Normal', 'Fast', 'Racing'] },
  { k: 'bp',    icon: '🩸', label: 'BP',        words: ['Normal', 'Low', 'Very low'] },
  { k: 'mind',  icon: '🧠', label: 'Awake',     words: ['Alert', 'Drowsy', 'Unconscious'] },
  { k: 'oxy',   icon: '💨', label: 'Breathing', words: ['Easy', 'Hard', 'Failing'] },
];

// Doctor skill areas. Every injury belongs to one.
const AREAS = {
  wounds: { label: 'Wounds', icon: '🔪' },
  head:   { label: 'Head',   icon: '🧠' },
  bones:  { label: 'Bones',  icon: '🦴' },
  burns:  { label: 'Burns',  icon: '🔥' },
};

// cats: urgency levels this injury can present with.
// pen: torso wound (chest/belly). Always at least Ward; with a fast pulse it means hidden bleeding, so Resus.
// major: major injury (pelvis, thigh bone, spine, large burn). Always at least Ward.
// red / orange: which vital signs go bad when the injury presents at that level (and worsen first).
// scary: sounds bad but is minor. calm: sounds harmless but can hide a serious problem.
// head: head injury (Head skill area).
const INJURIES = [
  { cause: 'stab', name: 'Chest stab wound', cats: ['red', 'orange'], pen: true, red: ['oxy', 'bp', 'pulse'] },
  { cause: 'stab', name: 'Stab wound near the heart', cats: ['red'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'stab', name: 'Belly stab wound', cats: ['red', 'orange'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'stab', name: 'Thigh stab · heavy bleeding', cats: ['red', 'orange'], red: ['bp'], orange: ['pulse', 'bp'] },
  { cause: 'stab', name: 'Forearm cut', cats: ['green', 'orange'], orange: ['pulse'] },
  { cause: 'stab', name: 'Stab wound · hand', cats: ['green'], scary: true },

  { cause: 'gsw', name: 'Shot in the belly', cats: ['red', 'orange'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'gsw', name: 'Shot in the chest', cats: ['red', 'orange'], pen: true, red: ['oxy', 'bp', 'pulse'] },
  { cause: 'gsw', name: 'Shot in the head', cats: ['red'], head: true, red: ['mind'] },
  { cause: 'gsw', name: 'Shot in the thigh · broken bone', cats: ['red', 'orange'], major: true, red: ['bp'] },
  { cause: 'gsw', name: 'Bullet graze · arm', cats: ['green'], scary: true },

  { cause: 'assault', name: 'Beaten · head injury', cats: ['red', 'orange'], head: true, red: ['mind'], orange: ['mind'] },
  { cause: 'assault', name: 'Broken jaw', cats: ['orange', 'green'], orange: ['oxy'] },
  { cause: 'assault', name: 'Kicked · broken ribs', cats: ['orange', 'green'], orange: ['oxy', 'pulse'] },
  { cause: 'assault', name: 'Bruises · scalp cut', cats: ['green'] },
  { cause: 'assault', name: 'Walked in after a fight', cats: ['green', 'orange', 'red'], calm: true, red: ['bp'], orange: ['bp', 'pulse'] },

  { cause: 'road', name: 'Hit by car · broken pelvis', cats: ['red', 'orange'], major: true, red: ['bp'] },
  { cause: 'road', name: 'Hit by car · many injuries', cats: ['red'], major: true, red: ['bp', 'mind'] },
  { cause: 'road', name: 'Taxi crash · broken thigh', cats: ['orange'], major: true },
  { cause: 'road', name: 'Motorbike · head injury', cats: ['red', 'orange'], head: true, red: ['mind'], orange: ['mind'] },
  { cause: 'road', name: 'Car crash · sore neck', cats: ['green'] },
  { cause: 'road', name: 'Taxi crash · cuts & bruises', cats: ['green'], scary: true },
  { cause: 'road', name: 'Car crash · "I feel fine"', cats: ['green', 'orange', 'red'], calm: true, red: ['bp'], orange: ['pulse'] },

  { cause: 'fall', name: 'Fall from height · back injury', cats: ['orange', 'red'], major: true, red: ['bp'] },
  { cause: 'fall', name: 'Fall · head injury', cats: ['red', 'orange'], head: true, red: ['mind'], orange: ['mind'] },
  { cause: 'fall', name: 'Fall · sore belly', cats: ['red', 'orange'], calm: true, red: ['bp'], orange: ['pulse', 'bp'] },
  { cause: 'fall', name: 'Fall · broken wrist', cats: ['green'] },

  { cause: 'burn', name: 'Large burns · smoke inhaled', cats: ['red', 'orange'], major: true, red: ['oxy'] },
  { cause: 'burn', name: 'Burns on chest and arms', cats: ['orange'], major: true },
  { cause: 'burn', name: 'Burnt hand', cats: ['green'] },
];

function areaOf(inj) {
  if (inj.cause === 'burn') return 'burns';
  if (inj.head) return 'head';
  if (inj.cause === 'stab' || inj.cause === 'gsw') return 'wounds';
  return 'bones';
}

const MASS_EVENTS = [
  { label: 'Minibus taxi crash on the N1', cause: 'road', size: 4 },
  { label: 'Shooting at a tavern', cause: 'gsw', size: 3 },
  { label: 'Knife fight outside a shebeen', cause: 'stab', size: 3 },
  { label: 'Shack fire in Soweto', cause: 'burn', size: 3 },
  { label: 'Scaffolding collapse', cause: 'fall', size: 3 },
];

// What tonight looks like. Multiplies the cause weights, so the doctor team choice matters.
const FORECASTS = [
  { title: 'Quiet weeknight', text: 'A normal mix of patients.', boost: {}, areas: [] },
  { title: 'Payday weekend', text: 'The taverns are full. Expect stabbings and assaults.', boost: { stab: 1.8, assault: 1.8 }, areas: ['wounds', 'head'] },
  { title: 'Rain and taxi rush', text: 'Wet roads. Expect crashes and pedestrians hit by cars.', boost: { road: 3 }, areas: ['bones', 'head'] },
  { title: 'Freezing winter night', text: 'Paraffin heaters in shacks. Expect burns.', boost: { burn: 3.5 }, areas: ['burns'] },
  { title: 'Gang trouble', text: 'Shootings reported across Soweto. Expect gunshot wounds.', boost: { gsw: 3 }, areas: ['wounds'] },
  { title: 'Construction boom', text: 'Building sites work late. Expect falls: broken bones and head injuries.', boost: { fall: 3 }, areas: ['bones', 'head'] },
];

// Doctor roster. skills: 1 = weak, 2 = solid, 3 = expert.
const DOCTORS = [
  { id: 'khumalo', name: 'Dr Khumalo', role: 'Emergency physician', skills: { wounds: 2, head: 2, bones: 2, burns: 1 }, start: true },
  { id: 'naidoo',  name: 'Dr Naidoo',  role: 'Trauma surgeon',      skills: { wounds: 3, head: 1, bones: 2, burns: 1 }, start: true },
  { id: 'botha',   name: 'Dr Botha',   role: 'Junior doctor',       skills: { wounds: 1, head: 1, bones: 1, burns: 2 }, start: true },
  { id: 'mokoena', name: 'Dr Mokoena', role: 'Neurosurgeon',        skills: { wounds: 1, head: 3, bones: 2, burns: 1 }, cost: 160 },
  { id: 'vanwyk',  name: 'Dr van Wyk', role: 'Orthopaedic surgeon', skills: { wounds: 1, head: 1, bones: 3, burns: 1 }, cost: 160 },
  { id: 'dlamini', name: 'Dr Dlamini', role: 'Burns surgeon',       skills: { wounds: 2, head: 1, bones: 1, burns: 3 }, cost: 160 },
];

const UPGRADE_COSTS = {
  resusBed: [150, 220, 300],      // 2 -> 5 beds
  wardBed: [90, 140, 200],        // 3 -> 6 beds
  train: 70,                      // +1 skill in one area
  nurse: [80, 140],               // 1 -> 3 nurses in Waiting
};
const BASE_BEDS = { resus: 2, ward: 3 };
const BASE_NURSES = 1;

// Instant analysis at triage. Hidden signs show "?" until measured.
const ANALYSIS = [
  { name: 'Basic triage', desc: 'Hidden signs take a while to measure.', reveal: 6 },
  { name: 'Bedside monitors', desc: 'Hidden signs are measured twice as fast.', reveal: 3, cost: 110 },
  { name: 'Point-of-care blood lab', desc: 'One fewer sign is hidden on arrival.', reveal: 3, cost: 190 },
  { name: 'Ultrasound at triage', desc: 'Every sign is known the moment a patient arrives.', reveal: 0, cost: 290 },
];

const NAMES_M = ['Sipho', 'Thabo', 'Themba', 'Bongani', 'Mandla', 'Tshepo', 'Sibusiso', 'Kagiso', 'Lungelo', 'Musa',
  'Lucky', 'Vusi', 'Jabulani', 'Neo', 'Karabo', 'Thulani', 'Sizwe', 'Tumelo', 'Pieter', 'Riaan', 'Ahmed', 'Kabelo', 'Andile', 'Xolani'];
const NAMES_F = ['Lerato', 'Nomsa', 'Zanele', 'Lindiwe', 'Palesa', 'Ayanda', 'Precious', 'Thandi', 'Naledi', 'Busisiwe', 'Refilwe', 'Mpho'];

// The whole triage rule. red = Resus/ICU now, orange = Ward when time, green = Waiting, no doctor.
//   Any critical sign, or a torso wound with a fast pulse  -> Resus
//   Any worrying sign, a torso wound or a major injury     -> Ward
//   Everything fine and a minor injury                     -> Waiting
function triage(v, inj) {
  const worst = Math.max(v.pulse, v.bp, v.mind, v.oxy);
  if (worst === 2 || (inj.pen && v.pulse >= 1)) return 'red';
  if (worst === 1 || inj.pen || inj.major) return 'orange';
  return 'green';
}

// Colour hint for one vital: 'crit' means Resus on its own, 'warn' means at least Ward.
function vitalLevel(k, val, inj) {
  if (val === 2 || (k === 'pulse' && val === 1 && inj.pen)) return 'crit';
  return val === 1 ? 'warn' : '';
}

function vitalsText(v) {
  return VITALS.map((d) => `${d.label} ${d.words[v[d.k]].toLowerCase()}`).join(' · ');
}

// Clear cases show several bad signs at once. Tricky cases show a single bad sign, a torso wound
// with only a fast pulse, or several worrying signs that still only add up to Ward.
function genVitals(target, inj, tricky) {
  const v = { pulse: 0, bp: 0, mind: 0, oxy: 0 };
  if (target === 'orange') {
    if (inj.pen) {
      if (tricky) v.bp = 1;                       // stays Ward: pulse is still normal
    } else if (inj.major) {
      if (tricky) v[pick(['bp', 'oxy'])] = 1;
    } else {
      v[pick(inj.orange || ['pulse'])] = 1;
      if (tricky) v[pick(['pulse', 'bp', 'mind', 'oxy'])] = 1;  // two worrying signs are still Ward
    }
  } else if (target === 'red') {
    const s = pick(inj.red || ['bp']);
    if (s === 'pulse') {
      if (inj.pen && tricky) v.pulse = 1;         // torso wound + fast pulse = hidden bleeding
      else { v.pulse = 2; if (!tricky) v.bp = 1; }
    } else {
      v[s] = 2;
      if (!tricky) {
        if (s === 'bp') v.pulse = 2;
        if (s === 'oxy') v.pulse = 1;
        if (s === 'mind') v.oxy = 1;
      }
    }
  }
  return v;
}

// Shock progression while untreated (Bara.md: rising pulse, falling BP, then the brain and
// breathing fail). Worsens one sign by one step; returns the sign that changed.
// The opposite: basic or full treatment brings the worst sign down one step.
function improveOnce(v) {
  const k = Object.keys(v).filter((key) => v[key] > 0).sort((a, b) => v[b] - v[a])[0];
  if (k) v[k]--;
  return k || null;
}

function worsenOnce(v, inj) {
  const order = (inj.red || ['bp']).concat(['pulse', 'bp', 'mind', 'oxy']);
  for (const k of order) if (v[k] < 2) { v[k]++; return k; }
  return null;
}

// Difficulty curve: night 1 is fully saveable. Later nights get harder through the cases
// themselves (tricky presentations, hidden signs, mass casualties), not through raw speed.
function nightConfig(n) {
  const k = n - 1;
  return {
    n,
    patients: Math.min(10 + k * 5, 45),
    mix: { red: Math.min(0.28 + k * 0.025, 0.38), orange: Math.min(0.3 + k * 0.02, 0.38) },
    tricky: Math.min(k * 0.13, 0.65),
    hiddenChance: n >= 3 ? Math.min(0.25 + (n - 3) * 0.1, 0.7) : 0,
    hiddenMax: n >= 5 ? 2 : 1,
    drain: 1 + k * 0.06,
    hints: n <= 2 ? 2 : n <= 4 ? 1 : 0,
    bursts: n >= 3 ? Math.min(Math.floor((n - 1) / 2), 4) : 0,
  };
}

function describeNight(c) {
  const f = [`${c.patients} patients`];
  if (c.n === 1) f.push('Quiet start: everyone can be saved');
  if (c.tricky > 0) f.push(c.tricky < 0.3 ? 'Some tricky cases' : 'Many tricky cases');
  if (c.hiddenChance) f.push(`Some signs unknown on arrival${c.hiddenMax > 1 ? ' (up to 2)' : ''}`);
  f.push(c.hints === 2 ? 'Coloured vital signs and room rules' : c.hints === 1 ? 'Coloured vital signs, no room rules' : 'No colours: read the words');
  if (c.bursts) f.push(`${c.bursts} mass-casualty event${c.bursts > 1 ? 's' : ''}`);
  return f;
}
