'use strict';

const $ = (s) => document.querySelector(s);

const ROOMS = {
  resus:   { label: 'Resus', rank: 2 },
  ward:    { label: 'Ward', rank: 1 },
  waiting: { label: 'Waiting', rank: 0 },
};
const CAT_RANK = { red: 2, orange: 1, green: 0 };
const CAT_ROOM = { red: 'resus', orange: 'ward', green: 'waiting' };
const DRAIN = { red: 6, orange: 2.4, green: 0.7 };   // stability lost per second while waiting
const QUEUE_DRAIN = 1.5;                            // waiting outside the door is worse
const TREAT = { resus: 10, ward: 7 };               // seconds a bed stays occupied, whoever is in it

const Store = {
  get(k, d) {
    try { const v = localStorage.getItem('baraER.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; }
  },
  set(k, v) { try { localStorage.setItem('baraER.' + k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } },
};

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
  reject() { this.tone(140, 0.22, 'sawtooth', 0.05); },
  death() { this.tone(440, 1.0, 'sine', 0.06); },
  alarm() { for (let i = 0; i < 6; i++) this.tone(i % 2 ? 700 : 950, 0.16, 'square', 0.035, i * 0.18); },
};

function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) { /* unsupported */ } }

const G = {
  night: 1, unlocked: Store.get('night', 1), cfg: null, state: 'menu',
  t: 0, last: 0, patients: [], schedule: [], lobby: [], queue: [], slotEls: [],
  beds: { resus: [], ward: [] }, waiting: [], selected: null, dead: 0, arrived: 0, announced: new Set(),
};
G.night = G.unlocked;

/* ---------------- patient generation ---------------- */

function weightedCause() {
  const keys = Object.keys(CAUSES);
  let r = Math.random() * keys.reduce((s, k) => s + CAUSES[k].weight, 0);
  for (const k of keys) { r -= CAUSES[k].weight; if (r <= 0) return k; }
  return keys[0];
}

function sampleCat(mix) {
  const r = Math.random();
  return r < mix.red ? 'red' : r < mix.red + mix.orange ? 'orange' : 'green';
}

// Arrivals peak around midnight (22:00–02:00 = 10–30 s).
function arrivalTimes(n) {
  const w = (t) => 1 + 1.3 * Math.exp(-((t - 20) ** 2) / (2 * 9 * 9));
  const times = [];
  while (times.length < n) {
    const t = 0.8 + Math.random() * 56;
    if (Math.random() * 2.3 < w(t)) times.push(t);
  }
  return times.sort((a, b) => a - b);
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
  const truth = triage(vitals, inj);
  const male = Math.random() < 0.85;
  return {
    id: 0, at, cause, inj, vitals, truth, tricky,
    name: pick(male ? NAMES_M : NAMES_F), sex: male ? 'M' : 'F', age: ri(17, 58),
    stab: 100, status: 'pending', slot: -1, room: null, burst: ev ? ev.label : null,
    canDeteriorate: truth === 'orange' && Math.random() < cfg.deteriorate, deteriorated: false,
  };
}

function generatePatients(cfg) {
  const events = [];
  for (let b = 0; b < cfg.bursts; b++) events.push({ ...pick(MASS_EVENTS), at: 10 + Math.random() * 38 });
  const burstTotal = events.reduce((s, e) => s + e.size, 0);
  const list = arrivalTimes(Math.max(cfg.patients - burstTotal, 4)).map((t) => makePatient(cfg, t));
  for (const ev of events) {
    for (let i = 0; i < ev.size; i++) list.push(makePatient(cfg, ev.at + i * 0.45, ev));
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
  const tags = (p.inj.pen ? '<em>TORSO WOUND</em>' : '') + (p.inj.major ? '<em>MAJOR INJURY</em>' : '');
  el.innerHTML = `
    <div class="c-top"><span class="c-ico">${CAUSES[p.cause].icon}</span><span class="c-inj">${p.inj.name}</span></div>
    <div class="c-meta"><span>${p.name}, ${p.age}${p.sex}</span>${tags}</div>
    <div class="c-vit">
      ${VITALS.map((d) => `<div class="vt" data-k="${d.k}"><i>${d.icon} ${d.label}</i><b></b></div>`).join('')}
    </div>
    <div class="c-bar"><div class="c-fill"></div></div>`;
  p.el = el;
  p.barEl = el.querySelector('.c-fill');
  updateVitals(p);
  return el;
}

function updateVitals(p, flash) {
  for (const d of VITALS) {
    const val = p.vitals[d.k];
    const cell = p.el.querySelector(`.vt[data-k="${d.k}"]`);
    const old = cell.lastElementChild.textContent;
    cell.lastElementChild.textContent = d.words[val];
    const lvl = G.cfg.hints > 0 ? vitalLevel(d.k, val, p.inj) : '';
    cell.classList.toggle('warn', lvl === 'warn');
    cell.classList.toggle('crit', lvl === 'crit');
    cell.classList.toggle('bad', val > 0);
    if (flash && old !== d.words[val]) restartAnim(cell, 'changed');
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
    G.beds[r].forEach(() => { const b = document.createElement('div'); b.className = 'bed'; c.appendChild(b); });
    roomEl(r).classList.remove('full');
  }
  $('#waiting-count').textContent = '0';
  $('#waiting-people').textContent = '';
  const game = $('#screen-game');
  game.classList.remove('hints-0', 'hints-1', 'hints-2', 'armed');
  game.classList.add('hints-' + G.cfg.hints);
  $('#hud-night').textContent = G.night;
  $('#hud-total').textContent = G.patients.length;
  $('#ticker').textContent = 'Shift starts. Ambulance bay quiet…';
  $('#door').classList.remove('show');
  $('#pause').classList.remove('show');
  document.querySelectorAll('.card.ghost, .card.flying').forEach((e) => e.remove());
}

/* ---------------- round flow ---------------- */

function startNight() {
  Sound.ensure();
  G.cfg = nightConfig(G.night);
  G.t = 0;
  G.patients = generatePatients(G.cfg);
  G.schedule = G.patients.slice();
  G.lobby = new Array(LOBBY_SLOTS).fill(null);
  G.queue = [];
  G.beds = { resus: new Array(G.cfg.resusBeds).fill(null), ward: new Array(G.cfg.wardBeds).fill(null) };
  G.waiting = [];
  G.selected = null;
  G.dead = 0;
  G.arrived = 0;
  G.announced = new Set();
  buildGameDom();
  showScreen('game');
  banner(`NIGHT ${G.night}`, describeNight(G.cfg).slice(0, 2).join(' · '), true);
  G.state = 'play';
  G.last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  if (G.state !== 'play') return;
  const dt = Math.min(Math.max((now - G.last) / 1000, 0), 0.1);
  G.last = now;
  G.t += dt;
  while (G.schedule.length && G.schedule[0].at <= G.t) arrive(G.schedule.shift());
  tickPatients(dt);
  tickBeds(dt);
  render();
  if (G.t >= ROUND_SECONDS) { endNight(); return; }
  requestAnimationFrame(frame);
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
  buildCard(p);
  const slot = G.lobby.indexOf(null);
  if (slot >= 0) putInSlot(p, slot);
  else { p.status = 'queue'; G.queue.push(p); }
}

function putInSlot(p, slot) {
  p.status = 'lobby';
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

function tickPatients(dt) {
  for (const p of G.lobby) {
    if (!p) continue;
    if (p.status === 'dying') {
      p.dyingT -= dt;
      if (p.dyingT <= 0) { p.status = 'died'; freeSlot(p.slot); }
      continue;
    }
    drain(p, dt, 1);
  }
  for (const p of G.queue.slice()) drain(p, dt, QUEUE_DRAIN);
}

function drain(p, dt, mult) {
  p.stab -= DRAIN[p.truth] * G.cfg.drain * mult * dt;
  if (p.canDeteriorate && !p.deteriorated && p.stab < 55) deteriorate(p);
  if (p.stab <= 0) die(p);
}

function deteriorate(p) {
  p.deteriorated = true;
  worsenVitals(p.vitals);
  p.truth = triage(p.vitals, p.inj);
  updateVitals(p, true);
  const meta = p.el.querySelector('.c-meta');
  meta.insertAdjacentHTML('beforeend', '<em class="warnflag">⚠ WORSE</em>');
  if (p.status === 'lobby') ticker(`⚠ ${p.name} is deteriorating!`);
}

function die(p) {
  p.stab = 0;
  G.dead++;
  Sound.death();
  buzz(220);
  if (G.selected === p) select(null);
  Input.cancelIf(p.id);
  if (p.status === 'queue') {
    G.queue.splice(G.queue.indexOf(p), 1);
    p.status = 'died';
    p.diedAtDoor = true;
    ticker(`✝ ${p.name} died outside. No space in the lobby.`);
    return;
  }
  p.status = 'dying';
  p.dyingT = 1.1;
  p.el.classList.remove('critical', 'selected');
  p.el.classList.add('dead');
  ticker(`✝ ${p.name} died in the lobby`);
}

function tickBeds(dt) {
  for (const r of ['resus', 'ward']) {
    G.beds[r].forEach((b, i) => {
      if (!b) return;
      b.left -= dt;
      if (b.left <= 0) G.beds[r][i] = null;
    });
  }
}

function select(p) {
  if (G.selected && G.selected.el) G.selected.el.classList.remove('selected');
  G.selected = p;
  if (p) p.el.classList.add('selected');
  $('#screen-game').classList.toggle('armed', !!p);
}

function place(p, room, srcEl) {
  if (!p || p.status !== 'lobby' || G.state !== 'play') return false;
  if (room !== 'waiting') {
    const i = G.beds[room].indexOf(null);
    if (i < 0) {
      restartAnim(roomEl(room), 'shake');
      ticker(`⛔ ${ROOMS[room].label} is full. Wait for a free bed.`);
      Sound.reject();
      buzz(60);
      return false;
    }
    const total = TREAT[room];
    G.beds[room][i] = { p, left: total, total };
  } else {
    G.waiting.push(p);
    $('#waiting-count').textContent = G.waiting.length;
    $('#waiting-people').textContent = '🧍'.repeat(Math.min(G.waiting.length, 12));
  }
  p.status = 'placed';
  p.room = room;
  p.placeStab = p.stab;
  p.placeTruth = p.truth;
  if (G.selected === p) select(null);
  const fly = srcEl || p.el;
  flyTo(fly, room);
  if (fly !== p.el) p.el.remove();
  freeSlot(p.slot);
  restartAnim(roomEl(room), 'got');
  Sound.place();
  buzz(15);
  return true;
}

function flyTo(el, room) {
  const r = el.getBoundingClientRect();
  const t = roomEl(room).getBoundingClientRect();
  el.classList.remove('selected', 'enter', 'dragging', 'ghost', 'returning', 'critical');
  el.classList.add('flying');
  Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', transform: 'none' });
  document.body.appendChild(el);
  void el.offsetWidth;
  const dx = t.left + t.width / 2 - (r.left + r.width / 2);
  const dy = t.top + t.height / 2 - (r.top + r.height / 2);
  el.style.transform = `translate(${dx}px, ${dy}px) scale(.15)`;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 340);
}

function render() {
  const mins = SHIFT_START_MIN + Math.min(G.t, ROUND_SECONDS) * GAME_MIN_PER_SEC;
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  $('#hud-clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('#hud-time').style.width = (Math.min(G.t / ROUND_SECONDS, 1) * 100) + '%';
  $('#hud-arrived').textContent = G.arrived;
  $('#hud-dead').textContent = G.dead;

  let critical = false;
  for (const p of G.lobby) {
    if (!p || p.status !== 'lobby') continue;
    const s = Math.max(p.stab, 0);
    p.barEl.style.width = s + '%';
    p.barEl.style.backgroundColor = `hsl(${Math.round(s * 1.5)}, 80%, 38%)`;
    const crit = s < 35;
    p.el.classList.toggle('critical', crit);
    critical = critical || crit;
  }
  $('.hud').classList.toggle('alarm', critical || G.queue.length > 0);

  const door = $('#door');
  door.classList.toggle('show', G.queue.length > 0);
  door.textContent = `🚑 ×${G.queue.length} at door`;

  for (const r of ['resus', 'ward']) {
    const els = $('#beds-' + r).children;
    G.beds[r].forEach((b, i) => {
      const el = els[i];
      if (b) {
        if (el.dataset.pid !== String(b.p.id)) {
          el.dataset.pid = b.p.id;
          el.className = 'bed occ';
          el.innerHTML = `<span>${CAUSES[b.p.cause].icon}</span>`;
          restartAnim(el, 'in');
        }
        el.style.setProperty('--p', (100 * (1 - b.left / b.total)).toFixed(1));
      } else if (el.dataset.pid) {
        delete el.dataset.pid;
        el.className = 'bed';
        el.innerHTML = '';
      }
    });
    roomEl(r).classList.toggle('full', !G.beds[r].includes(null));
  }
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

/* ---------------- outcome ---------------- */

// The sign that decided where the patient belonged, in plain words.
function keySign(p) {
  const v = p.vitals;
  const crit = VITALS.find((d) => v[d.k] === 2);
  if (crit) return `${crit.label} ${crit.words[2].toLowerCase()}`;
  if (p.inj.pen && v.pulse >= 1) return 'Torso wound + fast pulse';
  const warn = VITALS.find((d) => v[d.k] === 1);
  if (warn) return `${warn.label} ${warn.words[1].toLowerCase()}`;
  if (p.inj.pen) return 'Torso wound';
  if (p.inj.major) return 'Major injury';
  return 'All signs fine';
}

function evaluate(p) {
  const need = p.status === 'placed' ? p.placeTruth : p.truth;
  const r = { p, need, survived: false, kind: '', why: '' };
  const needLabel = `${ROOMS[CAT_ROOM[need]].label} (${keySign(p).toLowerCase()})`;

  if (p.status === 'died' || p.status === 'dying') {
    r.kind = 'lost';
    r.why = p.diedAtDoor ? 'Died outside. The lobby was full.' : `Crashed in the lobby. Needed ${needLabel}.`;
    return r;
  }
  if (p.status !== 'placed') {
    r.kind = 'lost';
    if (need === 'green') { r.survived = true; r.kind = 'ok'; r.why = 'Never placed, but stable. Went home in the morning.'; }
    else if (need === 'orange' && p.stab > 40) { r.survived = true; r.kind = 'under'; r.why = `Left in the lobby all night. Lucky. Needed ${needLabel}.`; }
    else r.why = `Never placed. Needed ${needLabel}.`;
    return r;
  }

  const gap = CAT_RANK[need] - ROOMS[p.room].rank;
  if (gap <= 0) {
    if (p.placeStab >= 15) {
      r.survived = true;
      r.kind = gap === 0 ? 'correct' : 'over';
      r.why = gap === 0 ? 'Right room, in time.' : `Survived, but only needed ${needLabel}. Wasted a ${ROOMS[p.room].label} bed.`;
    } else {
      r.kind = 'late';
      r.why = 'Right call, but too late. Crashed before treatment.';
    }
  } else if (gap === 1 && need === 'orange' && !p.inj.pen && !p.inj.major && p.placeStab >= 70) {
    r.survived = true;
    r.kind = 'under';
    r.why = `Under-triaged. Needed ${needLabel}, but pulled through.`;
  } else {
    r.kind = 'under';
    r.why = gap === 2 ? 'Critical patient sent to Waiting. No doctor saw them in time.'
      : `Under-triaged. Needed ${needLabel} and couldn't wait.`;
  }
  return r;
}

function endNight() {
  G.state = 'ended';
  Input.cancel();
  select(null);
  render();
  banner('08:00 · SHIFT OVER', 'Counting the survivors…', true);
  setTimeout(showResults, 1500);
}

function showResults() {
  const results = G.patients.map(evaluate);
  const n = results.length;
  const saved = results.filter((r) => r.survived).length;
  const rate = n ? saved / n : 0;
  const pass = rate >= PASS_RATE;
  const count = (k) => results.filter((r) => r.kind === k).length;

  if (pass && G.night >= G.unlocked) {
    G.unlocked = G.night + 1;
    Store.set('night', G.unlocked);
  }

  $('.res-head').classList.toggle('failed', !pass);
  $('#res-night').textContent = `NIGHT ${G.night} · 08:00`;
  $('#res-big').textContent = `${saved}/${n}`;
  $('#res-bar').style.width = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#res-bar').style.width = (rate * 100) + '%'; }));
  $('#res-grade').textContent =
    rate === 1 ? 'Perfect shift. Every patient made it.'
      : rate >= 0.9 ? 'Excellent triage. Next night unlocked.'
        : pass ? 'Solid shift. Next night unlocked.'
          : `Too many losses. Save ${Math.round(PASS_RATE * 100)}% to move on.`;

  const lost = results.filter((r) => r.p.status === 'died' || r.p.status === 'dying').length;
  const placed = results.filter((r) => r.p.status === 'placed').length;
  const accuracy = placed ? Math.round(100 * results.filter((r) => r.p.status === 'placed' && CAT_ROOM[r.need] === r.p.room).length / placed) : 0;
  $('#res-chips').innerHTML = [
    `🎯 ${accuracy}% triage accuracy`,
    `✔ ${count('correct')} right calls`,
    `⬆ ${count('over')} over-triaged`,
    `⬇ ${count('under')} under-triaged`,
    `✝ ${lost} died waiting`,
  ].map((s) => `<span>${s}</span>`).join('');

  const roomTag = (room) => room
    ? `<span class="tag t-${room}">${ROOMS[room].label.toUpperCase()}</span>`
    : '<span class="tag t-none">NOT PLACED</span>';
  const list = $('#res-list');
  list.innerHTML = results.map((r, i) => {
    const v = r.p.vitals;
    return `<li class="res ${r.survived ? '' : 'bad'}" style="animation-delay:${Math.min(i * 45, 1800)}ms">
      <div class="res-ico">${CAUSES[r.p.cause].icon}</div>
      <div class="res-name">${r.p.name}, ${r.p.age} <small>${r.p.inj.name}</small></div>
      <div class="res-out">${r.survived ? '✔' : '✝'}</div>
      <div class="res-vit">${vitalsText(v)}${r.p.inj.pen ? ' · torso wound' : ''}${r.p.inj.major ? ' · major injury' : ''}</div>
      <div class="res-why">${roomTag(r.p.room)}${r.why}</div>
    </li>`;
  }).join('');
  list.scrollTop = 0;

  const next = nightConfig(pass ? G.night + 1 : G.night);
  $('#res-next').textContent = pass
    ? `Next, night ${G.night + 1}: ${describeNight(next).join(' · ')}`
    : `Retry night ${G.night}: ${describeNight(next).slice(0, 3).join(' · ')}`;
  const btn = $('#btn-continue');
  btn.textContent = pass ? `Start night ${G.night + 1} ▶` : `Retry night ${G.night} ↻`;
  btn.className = pass ? 'btn primary' : 'btn danger';
  btn.onclick = () => { if (pass) G.night++; startNight(); };
  showScreen('results');
}

/* ---------------- menu ---------------- */

function refreshStart() {
  G.night = Math.min(Math.max(G.night, 1), G.unlocked);
  $('#start-night').textContent = G.night;
  $('#btn-prev').disabled = G.night <= 1;
  $('#btn-next').disabled = G.night >= G.unlocked;
  const feats = describeNight(nightConfig(G.night)).map((f) => `<li>${f}</li>`);
  if (G.night === G.unlocked) feats.push(`<li class="locked">Save ${Math.round(PASS_RATE * 100)}% to unlock night ${G.night + 1}</li>`);
  $('#start-features').innerHTML = feats.join('');
  $('#btn-start').textContent = `Start night ${G.night}`;
}

function updateSoundBtn() { $('#btn-sound').textContent = Sound.on ? '🔊' : '🔇'; }

function init() {
  Input.init($('#lobby'), {
    tap(id) {
      const p = G.patients[id];
      if (!p || p.status !== 'lobby') return;
      select(G.selected === p ? null : p);
    },
    drop(id, room, ghost) { return place(G.patients[id], room, ghost); },
    dragStart() { select(null); },
  });
  document.querySelectorAll('.room').forEach((el) => {
    el.addEventListener('click', () => { if (G.selected) place(G.selected, el.dataset.room); });
  });

  $('#btn-start').addEventListener('click', startNight);
  $('#btn-prev').addEventListener('click', () => { G.night--; refreshStart(); });
  $('#btn-next').addEventListener('click', () => { G.night++; refreshStart(); });
  $('#btn-rules').addEventListener('click', () => showScreen('rules'));
  $('#btn-rules-back').addEventListener('click', () => showScreen('start'));
  $('#btn-menu').addEventListener('click', () => { refreshStart(); showScreen('start'); });
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
