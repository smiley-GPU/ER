'use strict';

const $ = (s) => document.querySelector(s);

const ROOMS = {
  resus:   { label: 'Resus', rank: 2 },
  ward:    { label: 'Ward', rank: 1 },
  waiting: { label: 'Waiting', rank: 0 },
};
const CAT_RANK = { red: 2, orange: 1, green: 0 };
const CAT_ROOM = { red: 'resus', orange: 'ward', green: 'waiting' };

// Hidden stability (0–100). The player never sees the number: it shows through signs getting
// worse, the beating heart on the card and the monitor alarm.
const DRAIN = { red: 3.6, orange: 1.5, green: 0.25 };  // per second while untreated in the lobby
const QUEUE_DRAIN = 1.5;           // stuck outside the door
const WRONG_ROOM_DRAIN = 1.15;     // in a room that can't treat them: nobody is watching closely
const WORSEN_AT = [66, 40];        // stability levels where one sign gets worse
const ALARM_AT = 28;
const TREAT_TIME = { resus: 14, ward: 10 };       // seconds with a solid (2-star) doctor
const SKILL_SPEED = [0, 0.75, 1, 1.4];            // by doctor skill 1–3
const SKILL_CARE = [0, 0.55, 0.3, 0.12];          // stability drain multiplier during treatment
const GO_HOME_AFTER = 12;          // minor patients in Waiting leave after this many seconds

const Store = {
  get(k, d) {
    try { const v = localStorage.getItem('baraER.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; }
  },
  set(k, v) { try { localStorage.setItem('baraER.' + k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } },
};

/* ---------------- saved progress ---------------- */

function defaultSave() {
  const doctors = {};
  for (const d of DOCTORS) doctors[d.id] = { hired: !!d.start, skills: { ...d.skills } };
  return { unlocked: 1, funds: 0, beds: { ...BASE_BEDS }, analysis: 0, doctors, team: { resus: 'naidoo', ward: 'khumalo' } };
}

function loadSave() {
  const d = defaultSave();
  const s = Store.get('save', null);
  if (!s) return d;
  return { ...d, ...s, beds: { ...d.beds, ...s.beds }, doctors: { ...d.doctors, ...s.doctors }, team: { ...d.team, ...s.team } };
}

let S = loadSave();
function save() { Store.set('save', S); }

const docDef = (id) => DOCTORS.find((d) => d.id === id);
const skillOf = (docId, area) => S.doctors[docId].skills[area];
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/* ---------------- sound ---------------- */

const Sound = {
  on: Store.get('sound', false),
  ctx: null,
  ensure() {
    if (!this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) this.ctx = new AC();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.06, when = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  arrive() { this.tone(960, 0.11, 'square', 0.025); this.tone(720, 0.11, 'square', 0.025, 0.12); },
  place() { this.tone(660, 0.08, 'sine', 0.07); this.tone(990, 0.06, 'sine', 0.05, 0.06); },
  saved() { this.tone(880, 0.1, 'sine', 0.05); this.tone(1320, 0.14, 'sine', 0.04, 0.09); },
  reject() { this.tone(140, 0.22, 'sawtooth', 0.05); },
  worse() { this.tone(520, 0.1, 'triangle', 0.05); this.tone(390, 0.14, 'triangle', 0.05, 0.1); },
  death() { this.tone(440, 1.0, 'sine', 0.06); },
  alarm() { for (let i = 0; i < 6; i++) this.tone(i % 2 ? 700 : 950, 0.16, 'square', 0.035, i * 0.18); },
};

function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* unsupported */ } }

/* ---------------- game state ---------------- */

const G = {
  night: S.unlocked, cfg: null, forecast: null, state: 'menu',
  t: 0, last: 0, overtime: false, patients: [], schedule: [], lobby: [], queue: [], slotEls: [],
  beds: { resus: [], ward: [] }, waiting: [], selected: null, dead: 0, arrived: 0, announced: new Set(),
  roomsDirty: true, placedCount: 0, earned: 0,
};

/* ---------------- patient generation ---------------- */

function weightedCause() {
  const keys = Object.keys(CAUSES);
  const w = (k) => CAUSES[k].weight * (G.forecast.boost[k] || 1);
  let r = Math.random() * keys.reduce((s, k) => s + w(k), 0);
  for (const k of keys) { r -= w(k); if (r <= 0) return k; }
  return keys[0];
}

function sampleCat(mix) {
  const r = Math.random();
  return r < mix.red ? 'red' : r < mix.red + mix.orange ? 'orange' : 'green';
}

// Arrivals peak around midnight.
function arrivalTimes(n) {
  const peak = ROUND_SECONDS * 0.33;
  const sd = ROUND_SECONDS * 0.15;
  const w = (t) => 1 + 1.3 * Math.exp(-((t - peak) ** 2) / (2 * sd * sd));
  const times = [];
  while (times.length < n) {
    const t = 0.8 + Math.random() * (ROUND_SECONDS - 6);
    if (Math.random() * 2.3 < w(t)) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

function hiddenSigns(cfg) {
  if (Math.random() >= cfg.hiddenChance) return [];
  let n = ri(1, cfg.hiddenMax);
  if (S.analysis >= 2) n--;
  if (S.analysis >= 3) n = 0;
  return shuffle(VITALS.map((d) => d.k)).slice(0, Math.max(n, 0));
}

function makePatient(cfg, at, ev) {
  let target = sampleCat(ev ? { red: 0.4, orange: 0.35 } : cfg.mix);
  const cause = ev ? ev.cause : weightedCause();
  const tricky = Math.random() < cfg.tricky;
  let opts = INJURIES.filter((i) => i.cause === cause && i.cats.includes(target));
  if (!opts.length) opts = INJURIES.filter((i) => i.cause === cause);
  // Tricky cases favour misleading injuries: scary-sounding minor ones, harmless-sounding serious ones.
  const misleading = opts.filter((i) => (target === 'green' ? i.scary : i.calm));
  if (tricky && misleading.length && Math.random() < 0.6) opts = misleading;
  const inj = pick(opts);
  if (!inj.cats.includes(target)) target = pick(inj.cats);
  const vitals = genVitals(target, inj, tricky);
  const male = Math.random() < 0.85;
  return {
    id: 0, at, cause, inj, area: areaOf(inj), vitals, truth: triage(vitals, inj), tricky,
    name: pick(male ? NAMES_M : NAMES_F), sex: male ? 'M' : 'F', age: ri(17, 58),
    hidden: hiddenSigns(cfg), revealT: ANALYSIS[S.analysis].reveal,
    s: 100, worsenIdx: 0, worsened: false, loc: null, bed: -1, slot: -1, progress: 0,
    outcome: null, where: null, firstRoom: null, firstNeed: null, over: false, burst: ev ? ev.label : null,
  };
}

function generatePatients(cfg) {
  const events = [];
  const pool = MASS_EVENTS.filter((e) => G.forecast.boost[e.cause]);
  for (let b = 0; b < cfg.bursts; b++) {
    const ev = pool.length && Math.random() < 0.7 ? pick(pool) : pick(MASS_EVENTS);
    events.push({ ...ev, at: ROUND_SECONDS * (0.15 + Math.random() * 0.6) });
  }
  const burstTotal = events.reduce((s, e) => s + e.size, 0);
  const list = arrivalTimes(Math.max(cfg.patients - burstTotal, 4)).map((t) => makePatient(cfg, t));
  for (const ev of events) {
    for (let i = 0; i < ev.size; i++) list.push(makePatient(cfg, ev.at + i * 0.5, ev));
  }
  list.sort((a, b) => a.at - b.at).forEach((p, i) => { p.id = i; });
  return list;
}

/* ---------------- DOM helpers ---------------- */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
}
function roomEl(room) { return document.querySelector(`.room[data-room="${room}"]`); }
function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function fmtMin(m) { m = Math.floor(m); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }

function ticker(msg) {
  $('#ticker').textContent = msg;
  restartAnim($('#bay'), 'flash');
}

function banner(title, text, calm) {
  const b = $('#banner');
  b.innerHTML = `<b>${title}</b><span>${text}</span>`;
  b.classList.toggle('calm', !!calm);
  restartAnim(b, 'show');
}

function buildCard(p) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = p.id;
  el.dataset.drag = '';
  const tags = (p.inj.pen ? '<em>TORSO WOUND</em>' : '') + (p.inj.major ? '<em>MAJOR INJURY</em>' : '');
  el.innerHTML = `
    <div class="c-top"><span class="c-ico">${CAUSES[p.cause].icon}</span><span class="c-inj">${p.inj.name}</span><span class="c-wait"></span><span class="c-heart">❤</span></div>
    <div class="c-meta"><span>${p.name}, ${p.age}${p.sex}</span>${tags}</div>
    <div class="c-vit">
      ${VITALS.map((d) => `<div class="vt" data-k="${d.k}"><i>${d.icon} ${d.label}</i><b></b></div>`).join('')}
    </div>`;
  p.el = el;
  p.heartEl = el.querySelector('.c-heart');
  p.waitEl = el.querySelector('.c-wait');
  updateVitals(p);
  return el;
}

function buildToken(p) {
  const t = document.createElement('div');
  t.className = 'tok';
  t.dataset.id = p.id;
  t.dataset.drag = '';
  t.innerHTML = `<span>${CAUSES[p.cause].icon}</span>`;
  p.tok = t;
  return t;
}

function updateVitals(p, flash) {
  for (const d of VITALS) {
    const val = p.vitals[d.k];
    const cell = p.el.querySelector(`.vt[data-k="${d.k}"]`);
    const unknown = p.hidden.includes(d.k);
    const word = unknown ? '? measuring' : d.words[val];
    const old = cell.lastElementChild.textContent;
    cell.lastElementChild.textContent = word;
    const lvl = G.cfg.hints > 0 && !unknown ? vitalLevel(d.k, val, p.inj) : '';
    cell.classList.toggle('warn', lvl === 'warn');
    cell.classList.toggle('crit', lvl === 'crit');
    cell.classList.toggle('bad', !unknown && val > 0);
    cell.classList.toggle('unknown', unknown);
    if (flash && old !== word) restartAnim(cell, 'changed');
  }
}

function buildGameDom() {
  const lobby = $('#lobby');
  lobby.innerHTML = '';
  G.slotEls = [];
  for (let i = 0; i < LOBBY_SLOTS; i++) {
    const s = document.createElement('div');
    s.className = 'slot';
    lobby.appendChild(s);
    G.slotEls.push(s);
  }
  for (const r of ['resus', 'ward']) {
    const c = $('#beds-' + r);
    c.innerHTML = '';
    c.style.setProperty('--cols', G.beds[r].length > 4 ? 3 : 2);
    G.beds[r].forEach(() => { const b = document.createElement('div'); b.className = 'bed'; c.appendChild(b); });
    roomEl(r).classList.remove('full');
    const doc = docDef(S.team[r]);
    $('#doc-' + r).textContent = doc.name;
  }
  $('#waiting-list').innerHTML = '';
  const game = $('#screen-game');
  game.classList.remove('hints-0', 'hints-1', 'hints-2', 'armed', 'overtime');
  game.classList.add('hints-' + G.cfg.hints);
  $('#hud-night').textContent = G.night;
  $('#hud-total').textContent = G.patients.length;
  $('#ticker').textContent = 'Shift starts. Ambulance bay quiet…';
  $('#door').classList.remove('show');
  $('#btn-handover').classList.remove('show');
  $('#pause').classList.remove('show');
  $('#inspect').classList.remove('show');
  $('#inspect-card').innerHTML = '';
  document.querySelectorAll('.ghost.card, .ghost.tok, .flying').forEach((e) => e.remove());
}

/* ---------------- round flow ---------------- */

function startNight() {
  Sound.ensure();
  G.cfg = nightConfig(G.night);
  G.t = 0;
  G.overtime = false;
  G.patients = generatePatients(G.cfg);
  G.schedule = G.patients.slice();
  G.lobby = new Array(LOBBY_SLOTS).fill(null);
  G.queue = [];
  G.beds = { resus: new Array(S.beds.resus).fill(null), ward: new Array(S.beds.ward).fill(null) };
  G.waiting = [];
  G.selected = null;
  G.dead = 0;
  G.arrived = 0;
  G.placedCount = 0;
  G.announced = new Set();
  G.roomsDirty = true;
  buildGameDom();
  showScreen('game');
  banner(`NIGHT ${G.night}`, G.forecast.title, true);
  G.state = 'play';
  G.last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  if (G.state !== 'play') return;
  const dt = Math.min(Math.max((now - G.last) / 1000, 0), 0.1);
  G.last = now;
  step(dt);
  if (G.state === 'play') requestAnimationFrame(frame);
}

function step(dt) {
  G.t += dt;
  while (G.schedule.length && G.schedule[0].at <= G.t) arrive(G.schedule.shift());
  if (!G.overtime && G.t >= ROUND_SECONDS) startOvertime();
  tick(dt);
  render();
  if (G.overtime) checkHandover();
}

function startOvertime() {
  G.overtime = true;
  $('#screen-game').classList.add('overtime');
  banner('08:00 · OVERTIME', 'No new arrivals. Finish every patient who came in tonight.', true);
  ticker('Overtime: place everyone still waiting, then hand over.');
}

function pendingInLobby() {
  return G.queue.length > 0 || G.lobby.some((p) => p && !p.outcome);
}

function checkHandover() {
  const ready = !pendingInLobby();
  $('#btn-handover').classList.toggle('show', ready);
  if (!ready) return;
  const busy = G.beds.resus.some(Boolean) || G.beds.ward.some(Boolean) || G.waiting.some((p) => p.truth !== 'green');
  if (!busy) endNight();
}

function arrive(p) {
  G.arrived++;
  if (p.burst && !G.announced.has(p.burst)) {
    G.announced.add(p.burst);
    const size = G.patients.filter((q) => q.burst === p.burst).length;
    banner('⚠ MASS CASUALTY', `${p.burst}: ${size} incoming`);
    Sound.alarm();
    buzz([80, 60, 80, 60, 80]);
  } else {
    Sound.arrive();
  }
  ticker(`🚑 Incoming: ${CAUSES[p.cause].icon} ${p.inj.name}`);
  p.arrivedAt = G.t;
  buildCard(p);
  buildToken(p);
  const slot = G.lobby.indexOf(null);
  if (slot >= 0) putInSlot(p, slot);
  else { p.loc = 'queue'; G.queue.push(p); }
}

function putInSlot(p, slot) {
  p.loc = 'lobby';
  p.slot = slot;
  G.lobby[slot] = p;
  G.slotEls[slot].appendChild(p.el);
  restartAnim(p.el, 'enter');
}

function freeSlot(slot) {
  G.lobby[slot] = null;
  G.slotEls[slot].innerHTML = '';
  const next = G.queue.shift();
  if (next) putInSlot(next, slot);
}

/* ---------------- simulation ---------------- */

function isTreating(p) {
  return (p.loc === 'resus' || p.loc === 'ward') && ROOMS[p.loc].rank >= CAT_RANK[p.truth];
}

function tick(dt) {
  for (const p of G.patients) {
    if (!p.loc) continue;
    if (p.dyingT !== undefined) {
      p.dyingT -= dt;
      if (p.dyingT <= 0) { delete p.dyingT; G.lobby[p.slot] = null; p.loc = null; freeSlot(p.slot); }
      continue;
    }
    if (p.outcome) continue;

    if (p.hidden.length) {
      p.revealT -= dt;
      if (p.revealT <= 0) {
        p.hidden.shift();
        p.revealT = ANALYSIS[S.analysis].reveal;
        updateVitals(p, true);
      }
    }

    const base = DRAIN[p.truth] * G.cfg.drain;
    if (isTreating(p)) {
      const skill = skillOf(S.team[p.loc], p.area);
      p.progress += dt * 100 * SKILL_SPEED[skill] / TREAT_TIME[p.loc];
      p.s -= base * SKILL_CARE[skill] * dt;
      if (p.progress >= 100) { finishTreatment(p); continue; }
    } else {
      let mult = 1;
      if (p.loc === 'queue') mult = QUEUE_DRAIN;
      else if (p.loc === 'waiting') mult = p.truth === 'green' ? 0 : WRONG_ROOM_DRAIN;
      else if (p.loc !== 'lobby') mult = WRONG_ROOM_DRAIN;
      p.s -= base * mult * dt;
      while (p.worsenIdx < WORSEN_AT.length && p.s < WORSEN_AT[p.worsenIdx]) { p.worsenIdx++; worsen(p); }
    }

    if (p.loc === 'waiting' && p.truth === 'green') {
      p.homeT -= dt;
      if (p.homeT <= 0) { goHome(p); continue; }
    }
    if (p.s <= 0) die(p);
  }
}

function worsen(p) {
  if (!worsenOnce(p.vitals, p.inj)) return;
  p.truth = triage(p.vitals, p.inj);
  updateVitals(p, true);
  if (!p.worsened) {
    p.worsened = true;
    p.el.querySelector('.c-meta').insertAdjacentHTML('beforeend', '<em class="warnflag">⚠ WORSE</em>');
  }
  if (p.loc !== 'queue') {
    ticker(`⚠ ${p.name} is getting worse${p.loc === 'lobby' ? '' : ' in ' + ROOMS[p.loc].label}!`);
    Sound.worse();
  }
}

// Take the patient out of wherever they are. The caller decides where they go next.
function removeFromLocation(p) {
  if (p.loc === 'lobby') freeSlot(p.slot);
  else if (p.loc === 'queue') G.queue.splice(G.queue.indexOf(p), 1);
  else if (p.loc === 'resus' || p.loc === 'ward') G.beds[p.loc][p.bed] = null;
  else if (p.loc === 'waiting') G.waiting.splice(G.waiting.indexOf(p), 1);
  if (p.loc !== 'lobby' && p.loc !== 'queue') G.roomsDirty = true;
  p.loc = null;
}

function detachToken(p, cls) {
  const t = p.tok;
  if (!t || !t.isConnected) return;
  const r = t.getBoundingClientRect();
  Object.assign(t.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0 });
  t.classList.add('leaving', cls);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1000);
}

function finishTreatment(p) {
  p.outcome = 'saved';
  p.where = p.loc;
  p.doctor = S.team[p.loc];
  p.over = ROOMS[p.loc].rank > CAT_RANK[p.truth];
  if (G.selected === p) select(null);
  Input.cancelIf(p.id);
  detachToken(p, 'ok');
  removeFromLocation(p);
  Sound.saved();
}

function goHome(p) {
  p.outcome = 'saved';
  p.where = 'home';
  if (G.selected === p) select(null);
  Input.cancelIf(p.id);
  detachToken(p, 'ok');
  removeFromLocation(p);
}

function die(p) {
  p.s = 0;
  p.outcome = 'died';
  p.where = p.loc;
  p.needAtDeath = p.truth;
  G.dead++;
  Sound.death();
  buzz(220);
  if (G.selected === p) select(null);
  Input.cancelIf(p.id);
  if (p.loc === 'queue') {
    removeFromLocation(p);
    p.where = 'door';
    ticker(`✝ ${p.name} died outside. No space in the lobby.`);
    return;
  }
  if (p.loc === 'lobby') {
    p.dyingT = 1.1;                       // card stays in its slot briefly, greyed out
    p.el.classList.remove('critical', 'selected');
    p.el.classList.add('dead');
    ticker(`✝ ${p.name} died in the lobby`);
    return;
  }
  ticker(`✝ ${p.name} died in ${ROOMS[p.loc].label}`);
  if (p.loc !== 'waiting') p.doctor = S.team[p.loc];
  detachToken(p, 'dead');
  removeFromLocation(p);
}

/* ---------------- player actions ---------------- */

function select(p) {
  if (G.selected) {
    if (G.selected.el) G.selected.el.classList.remove('selected');
    if (G.selected.tok) G.selected.tok.classList.remove('selected');
  }
  G.selected = p;
  const inspect = $('#inspect');
  const holder = $('#inspect-card');
  holder.innerHTML = '';
  inspect.classList.remove('show');
  if (p) {
    p.el.classList.add('selected');
    p.tok.classList.add('selected');
    if (p.loc !== 'lobby') {
      holder.appendChild(p.el);
      inspect.classList.add('show');
      renderInspect();
    }
  }
  $('#screen-game').classList.toggle('armed', !!p);
}

function move(p, room, srcEl) {
  if (!p || p.outcome || p.dyingT !== undefined || G.state !== 'play') return false;
  if (!['lobby', 'resus', 'ward', 'waiting'].includes(p.loc) || p.loc === room) return false;
  let bed = -1;
  if (room !== 'waiting') {
    bed = G.beds[room].indexOf(null);
    if (bed < 0) {
      restartAnim(roomEl(room), 'shake');
      ticker(`⛔ ${ROOMS[room].label} is full. Wait for a free bed or move someone out.`);
      Sound.reject();
      buzz(60);
      return false;
    }
  }
  flyTo(srcEl || (p.loc === 'lobby' ? p.el : p.tok), room, !!srcEl);
  if (G.selected === p) select(null);
  if (p.el.parentNode) p.el.remove();
  removeFromLocation(p);
  if (!p.firstRoom) { p.firstRoom = room; p.firstNeed = p.truth; G.placedCount++; }
  p.loc = room;
  p.progress = 0;
  if (room === 'waiting') { G.waiting.push(p); p.homeT = GO_HOME_AFTER; } else { G.beds[room][bed] = p; p.bed = bed; }
  G.roomsDirty = true;
  restartAnim(roomEl(room), 'got');
  Sound.place();
  buzz(15);
  return true;
}

// Animate a copy (or the disposable drag ghost) flying into the room.
function flyTo(el, room, disposable) {
  const r = el.getBoundingClientRect();
  const t = roomEl(room).getBoundingClientRect();
  const f = disposable ? el : el.cloneNode(true);
  f.classList.remove('selected', 'enter', 'dragging', 'ghost', 'returning', 'critical');
  f.classList.add('flying');
  Object.assign(f.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', transform: 'none' });
  document.body.appendChild(f);
  void f.offsetWidth;
  const dx = t.left + t.width / 2 - (r.left + r.width / 2);
  const dy = t.top + t.height / 2 - (r.top + r.height / 2);
  f.style.transform = `translate(${dx}px, ${dy}px) scale(.15)`;
  f.style.opacity = '0';
  setTimeout(() => f.remove(), 340);
}

/* ---------------- rendering ---------------- */

function render() {
  const mins = SHIFT_START_MIN + G.t * GAME_MIN_PER_SEC;
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  $('#hud-clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('#hud-time').style.width = (Math.min(G.t / ROUND_SECONDS, 1) * 100) + '%';
  $('#hud-arrived').textContent = G.arrived;
  $('#hud-dead').textContent = G.dead;

  let alarm = false;
  const visible = G.lobby.filter((p) => p && !p.outcome);
  if (G.selected && !visible.includes(G.selected)) visible.push(G.selected);
  for (const p of visible) {
    const crit = p.s < ALARM_AT;
    p.el.classList.toggle('critical', crit);
    alarm = alarm || crit;
    const beat = crit ? 0.32 : [1.1, 0.7, 0.45][p.vitals.pulse];
    if (p.beat !== beat) { p.beat = beat; p.heartEl.style.animationDuration = beat + 's'; }
    p.waitEl.textContent = `⏱ ${fmtMin((G.t - p.arrivedAt) * GAME_MIN_PER_SEC)}`;
  }

  const door = $('#door');
  door.classList.toggle('show', G.queue.length > 0);
  door.textContent = `🚑 ×${G.queue.length} at door`;

  if (G.roomsDirty) layoutRooms();
  for (const p of G.patients) {
    if (!p.tok || !(p.loc === 'resus' || p.loc === 'ward' || p.loc === 'waiting')) continue;
    p.tok.style.setProperty('--p', isTreating(p) ? p.progress.toFixed(1) : 0);
    const crit = p.s < ALARM_AT;
    p.tok.classList.toggle('alarm', crit);
    alarm = alarm || crit;
  }
  $('.hud').classList.toggle('alarm', alarm || G.queue.length > 0);

  renderInspect();
}

function renderInspect() {
  if (G.selected && G.selected.loc && G.selected.loc !== 'lobby') {
    const p = G.selected;
    const where = ROOMS[p.loc].label;
    const status = p.loc === 'waiting' ? 'no doctor here'
      : `${docDef(S.team[p.loc]).name} · treatment ${Math.round(isTreating(p) ? p.progress : 0)}%`;
    $('#inspect-cap').textContent = `In ${where}: ${status}. Tap another room to move.`;
  }
}

function layoutRooms() {
  G.roomsDirty = false;
  for (const r of ['resus', 'ward']) {
    const els = $('#beds-' + r).children;
    G.beds[r].forEach((p, i) => {
      const el = els[i];
      if (p) { if (p.tok.parentNode !== el) { el.innerHTML = ''; el.appendChild(p.tok); restartAnim(p.tok, 'in'); } }
      else if (el.firstChild) el.innerHTML = '';
      el.classList.toggle('occ', !!p);
    });
    roomEl(r).classList.toggle('full', !G.beds[r].includes(null));
  }
  const list = $('#waiting-list');
  for (const p of G.waiting) if (p.tok.parentNode !== list) { list.appendChild(p.tok); restartAnim(p.tok, 'in'); }
  for (const t of [...list.children]) if (!G.waiting.some((p) => p.tok === t)) t.remove();
}

function pause() {
  if (G.state !== 'play') return;
  G.state = 'paused';
  Input.cancel();
  $('#pause').classList.add('show');
}

function resume() {
  if (G.state !== 'paused') return;
  $('#pause').classList.remove('show');
  G.state = 'play';
  G.last = performance.now();
  requestAnimationFrame(frame);
}

/* ---------------- end of shift ---------------- */

// The day team takes over whoever is left in the rooms.
function resolveAtHandover(p) {
  const need = p.truth;
  if (isTreating(p)) {
    const skill = skillOf(S.team[p.loc], p.area);
    const time = (100 - p.progress) * TREAT_TIME[p.loc] / (100 * SKILL_SPEED[skill]);
    const sEnd = p.s - DRAIN[need] * G.cfg.drain * SKILL_CARE[skill] * time;
    p.where = p.loc;
    p.doctor = S.team[p.loc];
    p.over = ROOMS[p.loc].rank > CAT_RANK[need];
    p.outcome = sEnd > 0 ? 'saved' : 'died';
    if (p.outcome === 'died') p.needAtDeath = need;
    return;
  }
  p.where = 'handover';
  if (need === 'green' || (need === 'orange' && p.s > 70)) p.outcome = 'saved';
  else { p.outcome = 'died'; p.needAtDeath = need; }
}

function endNight() {
  G.state = 'ended';
  Input.cancel();
  select(null);
  for (const p of G.patients) if (p.loc && !p.outcome) resolveAtHandover(p);
  render();
  banner('HANDOVER', 'The day team takes over. Counting the survivors…', true);
  const night = G.patients;
  setTimeout(() => { if (G.state === 'ended' && G.patients === night) showResults(); }, 1500);
}

// The sign that decided where the patient belonged, in plain words.
function keySign(p) {
  const v = p.vitals;
  const crit = VITALS.find((d) => v[d.k] === 2);
  if (crit) return `${crit.label} ${crit.words[2].toLowerCase()}`;
  if (p.inj.pen && v.pulse >= 1) return 'torso wound + fast pulse';
  const warn = VITALS.find((d) => v[d.k] === 1);
  if (warn) return `${warn.label} ${warn.words[1].toLowerCase()}`;
  if (p.inj.pen) return 'torso wound';
  if (p.inj.major) return 'major injury';
  return 'all signs fine';
}

function explain(p) {
  const need = p.outcome === 'died' ? p.needAtDeath : p.truth;
  const needLabel = `${ROOMS[CAT_ROOM[need]].label} (${keySign(p)})`;
  const docNote = () => {
    if (!p.doctor) return '';
    const d = docDef(p.doctor);
    const sk = skillOf(p.doctor, p.area);
    return sk === 1 ? ` ${d.name} is weak with ${AREAS[p.area].label.toLowerCase()} injuries.` : '';
  };
  if (p.outcome === 'saved') {
    if (p.where === 'home') return 'Minor injury. Went home.';
    if (p.where === 'handover') return need === 'green' ? 'Minor injury. Seen by the day team.' : `Survived until handover. Needed ${needLabel}.`;
    const doc = docDef(p.doctor).name;
    return p.over ? `Survived, but only needed ${needLabel}. Took a ${ROOMS[p.where].label} bed.` : `Treated in ${ROOMS[p.where].label} by ${doc}.`;
  }
  switch (p.where) {
    case 'door': return 'Died outside. The lobby was full.';
    case 'lobby': return `Died in the lobby. Needed ${needLabel}.`;
    case 'handover': return `Still in the wrong place at handover. Needed ${needLabel}.`;
    case 'resus': case 'ward': case 'waiting':
      if (ROOMS[p.where].rank >= CAT_RANK[need]) return `Died during treatment in ${ROOMS[p.where].label}. Too unstable when they got there.${docNote()}`;
      return `Died in ${ROOMS[p.where].label}. Needed ${needLabel}.`;
    default: return `Needed ${needLabel}.`;
  }
}

function showResults() {
  const list = G.patients;
  const n = list.length;
  const saved = list.filter((p) => p.outcome === 'saved').length;
  const rate = n ? saved / n : 0;
  const pass = rate >= PASS_RATE;
  const placed = list.filter((p) => p.firstRoom);
  const right = placed.filter((p) => CAT_ROOM[p.firstNeed] === p.firstRoom).length;
  const under = placed.filter((p) => ROOMS[p.firstRoom].rank < CAT_RANK[p.firstNeed]).length;
  const over = list.filter((p) => p.over).length;
  const lost = list.filter((p) => p.outcome === 'died' && (p.where === 'lobby' || p.where === 'door')).length;
  const accuracy = placed.length ? Math.round(100 * right / placed.length) : 0;

  G.earned = 0;
  if (pass) {
    G.earned = saved * 10 + (rate === 1 ? 50 : 0);
    S.funds += G.earned;
    if (G.night >= S.unlocked) S.unlocked = G.night + 1;
    save();
  }

  $('.res-head').classList.toggle('failed', !pass);
  $('#res-night').textContent = `NIGHT ${G.night} · HANDOVER`;
  $('#res-big').textContent = `${saved}/${n}`;
  $('#res-bar').style.width = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#res-bar').style.width = (rate * 100) + '%'; }));
  $('#res-grade').textContent =
    (rate === 1 ? 'Perfect shift. Every patient made it.'
      : rate >= 0.9 ? 'Excellent triage.'
        : pass ? 'Solid shift.'
          : `Too many losses. Save ${Math.round(PASS_RATE * 100)}% to move on.`)
    + (pass ? ` +💰${G.earned}` : '');

  $('#res-chips').innerHTML = [
    `🎯 ${accuracy}% first calls right`,
    `⬆ ${over} over-triaged`,
    `⬇ ${under} under-triaged`,
    `✝ ${lost} died waiting`,
  ].map((s) => `<span>${s}</span>`).join('');

  const roomTag = (room) => room
    ? `<span class="tag t-${room}">${ROOMS[room].label.toUpperCase()}</span>`
    : '<span class="tag t-none">NOT PLACED</span>';
  const ul = $('#res-list');
  ul.innerHTML = list.map((p, i) => `<li class="res ${p.outcome === 'saved' ? '' : 'bad'}" style="animation-delay:${Math.min(i * 45, 1800)}ms">
      <div class="res-ico">${CAUSES[p.cause].icon}</div>
      <div class="res-name">${p.name}, ${p.age} <small>${p.inj.name}</small></div>
      <div class="res-out">${p.outcome === 'saved' ? '✔' : '✝'}</div>
      <div class="res-vit">${vitalsText(p.vitals)}${p.inj.pen ? ' · torso wound' : ''}${p.inj.major ? ' · major injury' : ''}</div>
      <div class="res-why">${roomTag(p.firstRoom)}${explain(p)}</div>
    </li>`).join('');
  ul.scrollTop = 0;

  const next = nightConfig(pass ? G.night + 1 : G.night);
  $('#res-next').textContent = pass
    ? `Next, night ${G.night + 1}: ${describeNight(next).join(' · ')}`
    : `Retry night ${G.night}: ${describeNight(next).slice(0, 3).join(' · ')}`;
  const btn = $('#btn-continue');
  btn.textContent = pass ? 'Upgrades ▶' : `Retry night ${G.night} ↻`;
  btn.className = pass ? 'btn primary' : 'btn danger';
  btn.onclick = () => {
    if (pass) { G.night++; openShop(() => openTeam()); } else openTeam();
  };
  showScreen('results');
}

/* ---------------- team screen ---------------- */

function openTeam() {
  G.forecast = G.night === 1 ? FORECASTS[0] : pick(FORECASTS);
  const hired = DOCTORS.filter((d) => S.doctors[d.id].hired).map((d) => d.id);
  if (!hired.includes(S.team.resus)) S.team.resus = hired[0];
  if (!hired.includes(S.team.ward) || S.team.ward === S.team.resus) S.team.ward = hired.find((id) => id !== S.team.resus);
  $('#team-night').textContent = G.night;
  $('#forecast').innerHTML = `<small>TONIGHT'S FORECAST</small><b>${G.forecast.title}</b><span>${G.forecast.text}</span>`
    + (G.forecast.areas.length ? `<div class="fc-tags">${G.forecast.areas
      .map((a) => `<em>${AREAS[a].icon} ${AREAS[a].label} skills needed</em>`).join('')}</div>` : '');
  renderTeam();
  showScreen('team');
}

function renderTeam() {
  $('#team-resus').textContent = docDef(S.team.resus).name;
  $('#team-ward').textContent = docDef(S.team.ward).name;
  $('#team-list').innerHTML = DOCTORS.filter((d) => S.doctors[d.id].hired).map((d) => {
    const sk = S.doctors[d.id].skills;
    const role = S.team.resus === d.id ? 'resus' : S.team.ward === d.id ? 'ward' : '';
    return `<div class="doc ${role ? 'on-' + role : ''}">
      <div class="doc-head"><b>${d.name}</b><small>${d.role}</small></div>
      <div class="doc-skills">${Object.keys(AREAS).map((a) => `<span><i>${AREAS[a].icon} ${AREAS[a].label}</i><b class="st st-${sk[a]}">${stars(sk[a])}</b></span>`).join('')}</div>
      <div class="doc-btns">
        <button class="pill p-resus ${role === 'resus' ? 'on' : ''}" data-assign="resus" data-doc="${d.id}">Resus</button>
        <button class="pill p-ward ${role === 'ward' ? 'on' : ''}" data-assign="ward" data-doc="${d.id}">Ward</button>
      </div>
    </div>`;
  }).join('');
}

function assign(room, id) {
  const other = room === 'resus' ? 'ward' : 'resus';
  if (S.team[other] === id) S.team[other] = S.team[room];   // swap
  S.team[room] = id;
  save();
  renderTeam();
}

/* ---------------- upgrade shop ---------------- */

let shopDone = null;

function openShop(after) {
  shopDone = after || (() => { refreshStart(); showScreen('start'); });
  renderShop();
  showScreen('shop');
}

function renderShop() {
  $('#shop-funds').textContent = S.funds;
  const item = (icon, title, desc, cost, action, done) => `<div class="shop-item">
      <div class="si-ico">${icon}</div>
      <div class="si-main"><b>${title}</b><small>${desc}</small></div>
      ${done ? '<span class="si-max">MAX</span>'
        : `<button class="buy" data-buy="${action}" ${S.funds < cost ? 'disabled' : ''}>💰${cost}</button>`}
    </div>`;
  const rb = S.beds.resus - BASE_BEDS.resus;
  const wb = S.beds.ward - BASE_BEDS.ward;
  const next = ANALYSIS[S.analysis + 1];
  let html = '<h3>Hospital</h3>'
    + item('🛏️', `Resus bed (${S.beds.resus} now)`, 'Another bed for critical patients.', UPGRADE_COSTS.resusBed[rb], 'resusBed', rb >= UPGRADE_COSTS.resusBed.length)
    + item('🛏️', `Ward bed (${S.beds.ward} now)`, 'Another bed for urgent patients.', UPGRADE_COSTS.wardBed[wb], 'wardBed', wb >= UPGRADE_COSTS.wardBed.length)
    + item('🔬', next ? next.name : ANALYSIS[S.analysis].name, next ? next.desc : 'Best analysis bought.', next ? next.cost : 0, 'analysis', !next)
    + `<p class="hint">Analysis now: <b>${ANALYSIS[S.analysis].name}</b>. ${ANALYSIS[S.analysis].desc}</p>`
    + '<h3>Doctors</h3>';
  for (const d of DOCTORS) {
    const st = S.doctors[d.id];
    if (!st.hired) {
      html += item('🩺', `Hire ${d.name}`, `${d.role}: ${Object.keys(AREAS).map((a) => `${AREAS[a].icon}${d.skills[a]}`).join(' ')}`, d.cost, 'hire:' + d.id, false);
      continue;
    }
    html += `<div class="shop-doc"><b>${d.name}</b> <small>${d.role}</small><div class="train">${Object.keys(AREAS).map((a) => `
      <button class="train-btn" data-buy="train:${d.id}:${a}" ${st.skills[a] >= 3 || S.funds < UPGRADE_COSTS.train ? 'disabled' : ''}>
        <i>${AREAS[a].icon} ${AREAS[a].label}</i><b class="st st-${st.skills[a]}">${stars(st.skills[a])}</b>
        <small>${st.skills[a] >= 3 ? 'expert' : 'train 💰' + UPGRADE_COSTS.train}</small>
      </button>`).join('')}</div></div>`;
  }
  $('#shop-list').innerHTML = html;
}

function buy(action) {
  const [kind, a, b] = action.split(':');
  let cost = 0;
  if (kind === 'resusBed') cost = UPGRADE_COSTS.resusBed[S.beds.resus - BASE_BEDS.resus];
  if (kind === 'wardBed') cost = UPGRADE_COSTS.wardBed[S.beds.ward - BASE_BEDS.ward];
  if (kind === 'analysis') cost = ANALYSIS[S.analysis + 1] ? ANALYSIS[S.analysis + 1].cost : undefined;
  if (kind === 'hire') cost = docDef(a).cost;
  if (kind === 'train') cost = S.doctors[a].skills[b] < 3 ? UPGRADE_COSTS.train : undefined;
  if (cost === undefined || S.funds < cost) return;
  S.funds -= cost;
  if (kind === 'resusBed') S.beds.resus++;
  if (kind === 'wardBed') S.beds.ward++;
  if (kind === 'analysis') S.analysis++;
  if (kind === 'hire') S.doctors[a].hired = true;
  if (kind === 'train') S.doctors[a].skills[b]++;
  save();
  Sound.place();
  renderShop();
}

/* ---------------- menu ---------------- */

function refreshStart() {
  G.night = Math.min(Math.max(G.night, 1), S.unlocked);
  $('#start-night').textContent = G.night;
  $('#btn-prev').disabled = G.night <= 1;
  $('#btn-next').disabled = G.night >= S.unlocked;
  const feats = describeNight(nightConfig(G.night)).map((f) => `<li>${f}</li>`);
  if (G.night === S.unlocked) feats.push(`<li class="locked">Save ${Math.round(PASS_RATE * 100)}% to unlock night ${G.night + 1}</li>`);
  $('#start-features').innerHTML = feats.join('');
  $('#btn-start').textContent = `Start night ${G.night}`;
  $('#start-funds').textContent = `💰${S.funds}`;
}

function updateSoundBtn() { $('#btn-sound').textContent = Sound.on ? '🔊' : '🔇'; }

function init() {
  Input.init($('#screen-game'), {
    tap(id, el) {
      const p = G.patients[id];
      if (!p || p.outcome || G.state !== 'play') return;
      // With a patient already selected, tapping a token inside a room means "put them here".
      if (el.classList.contains('tok') && G.selected && G.selected !== p) return;
      select(G.selected === p ? null : p);
    },
    drop(id, room, ghost) { return move(G.patients[id], room, ghost); },
    dragStart() { select(null); },
  });
  document.querySelectorAll('.room').forEach((el) => {
    el.addEventListener('click', () => { if (G.selected) move(G.selected, el.dataset.room); });
  });

  $('#btn-start').addEventListener('click', () => { Sound.ensure(); openTeam(); });
  $('#btn-go').addEventListener('click', startNight);
  $('#btn-team-back').addEventListener('click', () => { refreshStart(); showScreen('start'); });
  $('#team-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-assign]');
    if (b) assign(b.dataset.assign, b.dataset.doc);
  });
  $('#btn-shop').addEventListener('click', () => openShop());
  $('#shop-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]');
    if (b && !b.disabled) buy(b.dataset.buy);
  });
  $('#btn-shop-done').addEventListener('click', () => shopDone());
  $('#btn-prev').addEventListener('click', () => { G.night--; refreshStart(); });
  $('#btn-next').addEventListener('click', () => { G.night++; refreshStart(); });
  $('#btn-rules').addEventListener('click', () => showScreen('rules'));
  $('#btn-rules-back').addEventListener('click', () => showScreen('start'));
  $('#btn-reset').addEventListener('click', () => {
    S = defaultSave();
    save();
    G.night = 1;
    refreshStart();
  });
  $('#btn-menu').addEventListener('click', () => { refreshStart(); showScreen('start'); });
  $('#btn-handover').addEventListener('click', () => { if (G.state === 'play' && !pendingInLobby()) endNight(); });
  $('#btn-pause').addEventListener('click', pause);
  $('#btn-resume').addEventListener('click', resume);
  $('#btn-quit').addEventListener('click', () => { G.state = 'menu'; refreshStart(); showScreen('start'); });
  $('#btn-sound').addEventListener('click', () => {
    Sound.on = !Sound.on;
    Store.set('sound', Sound.on);
    Sound.ensure();
    updateSoundBtn();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  updateSoundBtn();
  refreshStart();
}

init();
