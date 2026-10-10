'use strict';
// One-finger input: drag a patient (lobby card or room token) onto a room,
// or tap a patient and then tap a room.

const Input = (() => {
  const DRAG_THRESHOLD = 8;
  let drag = null;
  let handlers = {};

  function roomAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.room') : null;
  }

  function onDown(e) {
    const el = e.target.closest('[data-drag]');
    if (!el || el.classList.contains('dead') || drag) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = {
      id: +el.dataset.id, el, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top,
      w: r.width, h: r.height, active: false, hover: null, ghost: null,
    };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* window listeners still catch it */ }
  }

  function begin(x, y) {
    drag.active = true;
    const g = drag.el.cloneNode(true);
    g.classList.remove('selected', 'enter');
    g.classList.add('ghost');
    Object.assign(g.style, { width: drag.w + 'px', height: drag.h + 'px' });
    document.body.appendChild(g);
    drag.ghost = g;
    drag.el.classList.add('dragging');
    move(x, y);
    if (handlers.dragStart) handlers.dragStart(drag.id);
  }

  function move(x, y) {
    drag.ghost.style.left = (x - drag.offX) + 'px';
    drag.ghost.style.top = (y - drag.offY) + 'px';
    const room = roomAt(x, y);
    if (room !== drag.hover) {
      if (drag.hover) drag.hover.classList.remove('drop-hover');
      if (room) room.classList.add('drop-hover');
      drag.hover = room;
    }
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
      begin(e.clientX, e.clientY);
    } else {
      move(e.clientX, e.clientY);
    }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    if (!d.active) { if (handlers.tap) handlers.tap(d.id, d.el); return; }
    if (d.hover) d.hover.classList.remove('drop-hover');
    d.el.classList.remove('dragging');
    const room = d.hover ? d.hover.dataset.room : null;
    if (room && handlers.drop && handlers.drop(d.id, room, d.ghost)) return;
    snapBack(d);
  }

  function snapBack(d) {
    if (!d.el.isConnected) { d.ghost.remove(); return; }
    const r = d.el.getBoundingClientRect();
    d.ghost.classList.add('returning');
    d.ghost.style.left = r.left + 'px';
    d.ghost.style.top = r.top + 'px';
    setTimeout(() => d.ghost.remove(), 180);
  }

  function cancel() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.hover) d.hover.classList.remove('drop-hover');
    d.el.classList.remove('dragging');
    if (d.ghost) d.ghost.remove();
  }

  function cancelIf(id) { if (drag && drag.id === id) cancel(); }

  function init(rootEl, h) {
    handlers = h;
    rootEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
  }

  return { init, cancel, cancelIf };
})();
