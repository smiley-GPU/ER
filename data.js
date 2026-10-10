'use strict';
// Game data. Injury causes, injury patterns, vital signs and the three-level urgency model
// are based on Bara.md (Chris Hani Baragwanath Academic Hospital trauma unit), simplified so
// that anyone can read them: every vital sign is shown as a word on a three-step scale.

const ROUND_SECONDS = 60;        // one 12-hour night shift = 60 real seconds
const SHIFT_START_MIN = 20 * 60; // shift starts 20:00
const GAME_MIN_PER_SEC = 12;     // 720 game minutes / 60 s
const LOBBY_SLOTS = 6;
const PASS_RATE = 0.8;           // survival needed to unlock the next night

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

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

// cats: urgency levels this injury can present with.
// pen: torso wound (chest/belly). Always at least Ward; with a fast pulse it means hidden bleeding, so Resus.
// major: major injury (pelvis, thigh bone, spine, large burn). Always at least Ward.
// red / orange: which vital signs go bad when the injury presents at that level.
// scary: sounds bad but is minor. calm: sounds harmless but can hide a serious problem.
const INJURIES = [
  { cause: 'stab', name: 'Chest stab wound', cats: ['red', 'orange'], pen: true, red: ['oxy', 'bp', 'pulse'] },
  { cause: 'stab', name: 'Stab wound near the heart', cats: ['red'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'stab', name: 'Belly stab wound', cats: ['red', 'orange'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'stab', name: 'Thigh stab · heavy bleeding', cats: ['red', 'orange'], red: ['bp'], orange: ['pulse', 'bp'] },
  { cause: 'stab', name: 'Forearm cut', cats: ['green', 'orange'], orange: ['pulse'] },
  { cause: 'stab', name: 'Stab wound · hand', cats: ['green'], scary: true },

  { cause: 'gsw', name: 'Shot in the belly', cats: ['red', 'orange'], pen: true, red: ['bp', 'pulse'] },
  { cause: 'gsw', name: 'Shot in the chest', cats: ['red', 'orange'], pen: true, red: ['oxy', 'bp', 'pulse'] },
  { cause: 'gsw', name: 'Shot in the head', cats: ['red'], red: ['mind'] },
  { cause: 'gsw', name: 'Shot in the thigh · broken bone', cats: ['red', 'orange'], major: true, red: ['bp'] },
  { cause: 'gsw', name: 'Bullet graze · arm', cats: ['green'], scary: true },

  { cause: 'assault', name: 'Beaten · head injury', cats: ['red', 'orange'], red: ['mind'], orange: ['mind'] },
  { cause: 'assault', name: 'Broken jaw', cats: ['orange', 'green'], orange: ['oxy'] },
  { cause: 'assault', name: 'Kicked · broken ribs', cats: ['orange', 'green'], orange: ['oxy', 'pulse'] },
  { cause: 'assault', name: 'Bruises · scalp cut', cats: ['green'] },
  { cause: 'assault', name: 'Walked in after a fight', cats: ['green', 'orange', 'red'], calm: true, red: ['bp'], orange: ['bp', 'pulse'] },

  { cause: 'road', name: 'Hit by car · broken pelvis', cats: ['red', 'orange'], major: true, red: ['bp'] },
  { cause: 'road', name: 'Hit by car · many injuries', cats: ['red'], major: true, red: ['bp', 'mind'] },
  { cause: 'road', name: 'Taxi crash · broken thigh', cats: ['orange'], major: true },
  { cause: 'road', name: 'Motorbike · head injury', cats: ['red', 'orange'], red: ['mind'], orange: ['mind'] },
  { cause: 'road', name: 'Car crash · sore neck', cats: ['green'] },
  { cause: 'road', name: 'Taxi crash · cuts & bruises', cats: ['green'], scary: true },
  { cause: 'road', name: 'Car crash · "I feel fine"', cats: ['green', 'orange', 'red'], calm: true, red: ['bp'], orange: ['pulse'] },

  { cause: 'fall', name: 'Fall from height · back injury', cats: ['orange', 'red'], major: true, red: ['bp'] },
  { cause: 'fall', name: 'Fall · head injury', cats: ['red', 'orange'], red: ['mind'], orange: ['mind'] },
  { cause: 'fall', name: 'Fall · sore belly', cats: ['red', 'orange'], calm: true, red: ['bp'], orange: ['pulse', 'bp'] },
  { cause: 'fall', name: 'Fall · broken wrist', cats: ['green'] },

  { cause: 'burn', name: 'Large burns · smoke inhaled', cats: ['red', 'orange'], major: true, red: ['oxy'] },
  { cause: 'burn', name: 'Burns on chest and arms', cats: ['orange'], major: true },
  { cause: 'burn', name: 'Burnt hand', cats: ['green'] },
];

const MASS_EVENTS = [
  { label: 'Minibus taxi crash on the N1', cause: 'road', size: 4 },
  { label: 'Shooting at a tavern', cause: 'gsw', size: 3 },
  { label: 'Knife fight outside a shebeen', cause: 'stab', size: 3 },
  { label: 'Shack fire in Soweto', cause: 'burn', size: 3 },
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

// A Ward patient left waiting too long slides into shock.
function worsenVitals(v) {
  v.bp = 2;
  v.pulse = 2;
}

// Difficulty curve: night 1 is fully saveable; every later night adds patients,
// tricky cases, mass casualties, deterioration and removes hints.
function nightConfig(n) {
  const k = n - 1;
  return {
    n,
    patients: Math.min(10 + k * 6, 52),
    mix: { red: Math.min(0.22 + k * 0.03, 0.38), orange: Math.min(0.3 + k * 0.02, 0.38) },
    tricky: Math.min(k * 0.12, 0.6),
    drain: 1 + k * 0.15,
    hints: n <= 2 ? 2 : n <= 4 ? 1 : 0,
    bursts: n >= 3 ? Math.min(Math.floor((n - 1) / 2), 4) : 0,
    deteriorate: n >= 4 ? Math.min(0.3 + (n - 4) * 0.1, 0.7) : 0,
    resusBeds: 3,
    wardBeds: 4,
  };
}

function describeNight(c) {
  const f = [`${c.patients} patients`];
  if (c.n === 1) f.push('Quiet start: everyone can be saved');
  if (c.tricky > 0) f.push(c.tricky < 0.3 ? 'Some tricky cases' : 'Many tricky cases');
  f.push(c.hints === 2 ? 'Coloured vital signs and room rules' : c.hints === 1 ? 'Coloured vital signs, no room rules' : 'No colours: read the words');
  if (c.bursts) f.push(`${c.bursts} mass-casualty event${c.bursts > 1 ? 's' : ''}`);
  if (c.deteriorate) f.push('Ward patients get worse while waiting');
  if (c.drain > 1) f.push(`Patients crash ${Math.round((c.drain - 1) * 100)}% faster`);
  return f;
}
