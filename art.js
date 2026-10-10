'use strict';
// Inline SVG art: patient faces, the ambulance and the stretcher used when moving patients.

const SKIN = ['#4a2c1d', '#5c3a24', '#6e4528', '#7f5232', '#94613b', '#b07a4f', '#d4a07a', '#e8c39e'];
const SKIN_W = [3, 4, 4, 3, 2, 2, 1, 1];
const SHIRTS = ['#3d5a80', '#e07a5f', '#81b29a', '#f2cc8f', '#6d597a', '#264653', '#c1121f', '#8d99ae', '#f4a261'];
const WRAPS = ['#e63946', '#f4a261', '#2a9d8f', '#ffb703', '#8338ec', '#06d6a0'];
const INK = '#2a1a12';

function weightedPick(arr, w) {
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
  return arr[0];
}

// A random appearance, fixed for the patient's whole night.
function makeLook(sex, age, inj) {
  const grey = age >= 48;
  const styles = sex === 'M' ? ['crop', 'crop', 'beard', grey ? 'bald' : 'crop'] : ['puff', 'braids', 'wrap', 'bun'];
  let mark = null;
  if (inj.head) mark = 'bandage';
  else if (inj.cause === 'burn') mark = 'soot';
  else if (inj.cause === 'assault' || inj.cause === 'road' || inj.cause === 'fall') mark = 'plaster';
  return {
    skin: weightedPick(SKIN, SKIN_W),
    hair: grey ? '#9a9a9a' : '#1b1410',
    style: pick(styles),
    shirt: pick(SHIRTS),
    wrap: pick(WRAPS),
    mark,
  };
}

// ok, worried, pain, out (unconscious) or dead, read straight off the vital signs.
function moodOf(v, dead) {
  if (dead) return 'dead';
  if (v.mind === 2) return 'out';
  const worst = Math.max(v.pulse, v.bp, v.mind, v.oxy);
  return worst === 2 ? 'pain' : worst === 1 ? 'worried' : 'ok';
}

function hairBack(L) {
  switch (L.style) {
    case 'puff': return `<circle cx="20" cy="12" r="10.5" fill="${L.hair}"/>`;
    case 'braids': return `<path d="M9 16 Q8 30 11 36 L14 36 Q12 26 13 17Z M31 16 Q32 30 29 36 L26 36 Q28 26 27 17Z" fill="${L.hair}"/>`;
    case 'bun': return `<circle cx="20" cy="6" r="4.5" fill="${L.hair}"/>`;
    default: return '';
  }
}

function hairFront(L) {
  switch (L.style) {
    case 'crop': case 'beard': case 'braids': case 'bun':
      return `<path d="M9.6 18 Q9 6.5 20 6.8 Q31 6.5 30.4 18 Q28 11.8 20 11.6 Q12 11.8 9.6 18Z" fill="${L.hair}"/>`;
    case 'puff':
      return `<path d="M9.6 17 Q10 9 20 9.5 Q30 9 30.4 17 Q27 12.5 20 12.6 Q13 12.5 9.6 17Z" fill="${L.hair}"/>`;
    case 'wrap':
      return `<path d="M8.8 18 Q7.5 3.5 20 4.5 Q32.5 3.5 31.2 18 Q27 11 20 11 Q13 11 8.8 18Z" fill="${L.wrap}"/>`
        + `<circle cx="27" cy="6" r="3.2" fill="${L.wrap}"/><path d="M12 10 Q20 6 28 10" stroke="rgba(255,255,255,.45)" stroke-width="1.2" fill="none"/>`;
    default: return '';
  }
}

// A feature line. On dark skin it gets a faint light halo so it stays readable at small sizes.
function line(d, dark, w = 1.4) {
  const halo = dark ? `<path d="${d}" stroke="rgba(255,255,255,.4)" stroke-width="${w + 1.4}" stroke-linecap="round" fill="none"/>` : '';
  return `${halo}<path d="${d}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
}

function eyes(m, dark) {
  const open = (y) => `<ellipse cx="16" cy="${y}" rx="2.1" ry="1.8" fill="#fff"/><ellipse cx="24" cy="${y}" rx="2.1" ry="1.8" fill="#fff"/>`
    + `<circle cx="16" cy="${y}" r="1.25" fill="${INK}"/><circle cx="24" cy="${y}" r="1.25" fill="${INK}"/>`;
  switch (m) {
    case 'ok': return open(19);
    case 'worried': return open(19.3) + line('M13.6 16.2 L17.6 14.8 M22.4 14.8 L26.4 16.2', dark);
    case 'pain': return line('M14.4 17.8 L17.2 19.2 L14.4 20.4 M25.6 17.8 L22.8 19.2 L25.6 20.4', dark)
      + line('M13.6 15.4 L17.6 16.2 M22.4 16.2 L26.4 15.4', dark);
    case 'out': return line('M14.3 19.3 Q16 20.9 17.7 19.3 M22.3 19.3 Q24 20.9 25.7 19.3', dark);
    case 'dead': return line('M14.6 17.8 L17.4 20.6 M17.4 17.8 L14.6 20.6 M22.6 17.8 L25.4 20.6 M25.4 17.8 L22.6 20.6', dark);
    default: return '';
  }
}

function mouth(m, dark) {
  switch (m) {
    case 'ok': return line('M16.8 25.2 Q20 27.8 23.2 25.2', dark, 1.3);
    case 'worried': return line('M17.2 26.6 Q20 25.2 22.8 26.6', dark, 1.3);
    case 'pain': return `<rect x="16.6" y="24.4" width="6.8" height="3.4" rx="1.5" fill="${INK}"/><path d="M17.4 26 H22.6" stroke="#fff" stroke-width=".9"/>`;
    case 'out': return `<ellipse cx="20" cy="26.2" rx="1.5" ry="1.1" fill="${INK}"/>`;
    case 'dead': return line('M17 26 H23', dark, 1.3);
    default: return '';
  }
}

function mark(L) {
  switch (L.mark) {
    case 'bandage': return '<path d="M9.8 14.6 Q20 10.2 30.2 14.6 L30.3 17.4 Q20 13 9.7 17.4Z" fill="#fff" stroke="#c9d3ce" stroke-width=".5"/>'
      + '<circle cx="24.5" cy="13.6" r="1.3" fill="#d7263d" opacity=".8"/>';
    case 'soot': return '<ellipse cx="14" cy="23" rx="2.6" ry="1.6" fill="#1a1a1a" opacity=".35"/><ellipse cx="25" cy="14" rx="2.4" ry="1.3" fill="#1a1a1a" opacity=".3"/>';
    case 'plaster': return '<g transform="rotate(-25 25.5 23)"><rect x="22.5" y="21.8" width="6" height="2.5" rx="1" fill="#f1d3a8" stroke="#c9a77c" stroke-width=".4"/>'
      + '<path d="M25.5 21.8 V24.3" stroke="#c9a77c" stroke-width=".4"/></g>';
    default: return '';
  }
}

function faceSVG(L, m) {
  const beard = L.style === 'beard'
    ? `<path d="M10.8 21 Q11.5 31.5 20 31.8 Q28.5 31.5 29.2 21 Q27.5 27.6 20 28.2 Q12.5 27.6 10.8 21Z" fill="${L.hair}" opacity=".9"/>` : '';
  const dark = SKIN.indexOf(L.skin) < 3;
  const sweat = m === 'pain' ? '<path d="M30.5 11 Q32.6 14.2 30.5 15.3 Q28.4 14.2 30.5 11Z" fill="#6cc4ff"/>' : '';
  return `<svg viewBox="0 0 40 40" aria-hidden="true">
    ${hairBack(L)}
    <path d="M7 41 Q7 31.5 20 31.5 Q33 31.5 33 41Z" fill="${L.shirt}"/>
    <rect x="17" y="27" width="6" height="6" fill="${L.skin}"/>
    <circle cx="10" cy="20" r="2.3" fill="${L.skin}"/><circle cx="30" cy="20" r="2.3" fill="${L.skin}"/>
    <ellipse cx="20" cy="19" rx="10.2" ry="11.6" fill="${L.skin}"/>
    ${beard}${hairFront(L)}${mark(L)}${eyes(m, dark)}${mouth(m, dark)}${sweat}
  </svg>`;
}

// Faces the left: it drives in from the right towards the hospital door.
const AMBULANCE_SVG = `<svg viewBox="0 0 64 34" aria-hidden="true">
  <g transform="translate(64 0) scale(-1 1)">
    <rect x="2" y="6" width="42" height="21" rx="3" fill="#fff" stroke="#9fb3a9" stroke-width=".8"/>
    <path d="M44 11.5 H53.5 L61.5 19 V27 H44Z" fill="#fff" stroke="#9fb3a9" stroke-width=".8"/>
    <path d="M47 14 H53 L58 19 H47Z" fill="#9fd3ff"/>
    <rect x="2" y="18.5" width="59.5" height="3" fill="#d7263d"/>
    <path d="M15.5 9 h4 v3 h3 v4 h-3 v3 h-4 v-3 h-3 v-4 h3Z" fill="#d7263d" transform="translate(4 -1) scale(.8)"/>
    <rect class="amb-light a" x="22" y="3" width="5" height="3" rx="1"/>
    <rect class="amb-light b" x="28" y="3" width="5" height="3" rx="1"/>
    <circle cx="13" cy="27.5" r="4.6" fill="#222"/><circle cx="13" cy="27.5" r="1.8" fill="#aaa"/>
    <circle cx="51" cy="27.5" r="4.6" fill="#222"/><circle cx="51" cy="27.5" r="1.8" fill="#aaa"/>
  </g>
</svg>`;

function stretcherSVG(color) {
  return `<svg viewBox="0 0 64 30" aria-hidden="true">
    <path d="M8 19 L14 26 M56 19 L50 26 M14 19 L8 26 M50 19 L56 26" stroke="#7d8f86" stroke-width="1.6"/>
    <circle cx="8" cy="27" r="2.6" fill="#333"/><circle cx="56" cy="27" r="2.6" fill="#333"/>
    <circle cx="14" cy="27" r="2.6" fill="#333"/><circle cx="50" cy="27" r="2.6" fill="#333"/>
    <rect x="3" y="16" width="58" height="3" rx="1.5" fill="#9fb3a9"/>
    <rect x="4" y="11" width="56" height="6" rx="3" fill="#fff" stroke="#c9d3ce" stroke-width=".6"/>
    <rect x="22" y="7.5" width="37" height="8.5" rx="4" fill="${color}"/>
  </svg>`;
}
