// Londra 10–14 novembre: copilota del viaggio.
// Il programma e i biglietti arrivano cifrati (vault/); la password di gruppo li apre sul telefono.

const app = document.getElementById('app');
const sheetEl = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

/* ---------- archivio locale ---------- */

const LS = {
  get(k, d) { try { const v = localStorage.getItem('ldn.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ldn.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('ldn.' + k); } catch {} },
};

const state = {
  trip: null,
  key: null,
  tab: LS.get('tab', 'now'),
  viewDay: null,
  done: LS.get('done', {}),
  skip: LS.get('skip', {}),
  delay: LS.get('delay', {}),
  polls: {},
  who: LS.get('who', null),
  check: LS.get('check', {}),
  weather: LS.get('weather', null),
};

/* ---------- cifratura ---------- */

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function deriveKey(pw) {
  const meta = await (await fetch('vault/meta.json', { cache: 'no-cache' })).json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(meta.salt), iterations: meta.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function unseal(key, file) {
  const res = await fetch('vault/' + file);
  if (!res.ok) throw new Error('missing ' + file);
  const buf = new Uint8Array(await res.arrayBuffer());
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
}

async function openTrip(key) {
  const plain = await unseal(key, 'trip.bin');
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------- tempo (sempre ora di Londra) ---------- */

const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// La simulazione fissa un orario di Londra e lo fa scorrere da lì.
function now() {
  const sim = LS.get('sim', null);
  let y, mo, d, h, mi, s;
  if (sim) {
    const [dd, tt] = sim.at.split('T');
    [y, mo, d] = dd.split('-').map(Number);
    [h, mi] = tt.split(':').map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + (Date.now() - sim.set));
    [y, mo, d, h, mi, s] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()];
  } else {
    const p = Object.fromEntries(londonFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    [y, mo, d, h, mi, s] = [+p.year, +p.month, +p.day, +p.hour, +p.minute, +p.second];
  }
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { date, min: h * 60 + mi, sec: s, wall: Date.UTC(y, mo - 1, d, h, mi, s), sim: !!sim };
}

const pad = n => String(n).padStart(2, '0');
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const dateWall = (date, min = 0) => { const [y, mo, d] = date.split('-').map(Number); return Date.UTC(y, mo - 1, d) + min * 60000; };
const DOW = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MON = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const shortDate = date => { const t = new Date(dateWall(date)); return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };

function until(mins) {
  if (mins < 1) return 'ora';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `${h} h ${m}` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} g ${h % 24} h`;
}

/* ---------- metro, linee, mappe ---------- */

const LINES = {
  bakerloo: ['Bakerloo', '#B36305'], central: ['Central', '#E32017'], circle: ['Circle', '#FFD300'],
  district: ['District', '#00782A'], hammersmith: ['Hammersmith & City', '#F3A9BB'], jubilee: ['Jubilee', '#A0A5A9'],
  metropolitan: ['Metropolitan', '#9B0056'], northern: ['Northern', '#1B1B1B'], piccadilly: ['Piccadilly', '#003688'],
  victoria: ['Victoria', '#0098D4'], dlr: ['DLR', '#00A4A7'], elizabeth: ['Elizabeth', '#6950A1'],
  rail: ['Treno', '#6B7385'], river: ['Battello', '#2A9FD8'],
};

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const place = k => state.trip.places[k];

function gmaps(k, mode = 'transit') {
  const p = place(k);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.q)}&travelmode=${mode}`;
}
function gmapsRoute(keys) {
  const ps = keys.map(place);
  const mid = ps.slice(1, -1).map(p => p.q).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ps[0].q)}&destination=${encodeURIComponent(ps.at(-1).q)}` +
    (mid ? `&waypoints=${encodeURIComponent(mid)}` : '') + '&travelmode=walking';
}
function citymapper(k) {
  const p = place(k);
  return `https://citymapper.com/directions?endcoord=${p.ll[0]},${p.ll[1]}&endname=${encodeURIComponent(p.n)}&endaddress=${encodeURIComponent(p.q)}`;
}
function appleMaps(k, mode = 'transit') {
  const p = place(k);
  return `https://maps.apple.com/?daddr=${p.ll[0]},${p.ll[1]}&dirflg=${mode === 'walking' ? 'w' : 'r'}`;
}

/* ---------- programma: chi, ritardi, proiezione ---------- */

const visible = (day, who = state.who) => day.items.filter(it => !it.who || !who || it.who === who);

// Ricalcola gli orari della giornata a partire dai ritardi e dalle tappe saltate.
// Le tappe "anchor" hanno orario fisso, quelle "buffer" si accorciano, "closes" taglia alla chiusura.
function project(day) {
  const res = {};
  const runs = day.split ? (state.who ? [state.who] : ['df', 'sei']) : [null];
  const dl = state.delay[day.date];
  for (const who of runs) {
    let cursor = null;
    for (const it of visible(day, who)) {
      const s = hm(it.s), e = hm(it.e), dur = e - s;
      if (state.skip[it.id]) { res[it.id] = { ps: s, pe: e, skipped: true }; continue; }
      const ps = cursor == null ? s : Math.max(s, cursor);
      let pe = it.anchor ? Math.max(e, ps) : it.buffer ? Math.max(ps, e) : ps + dur;
      if (dl && dl.from === it.id) pe += dl.min;
      const r = { ps, pe, late: it.anchor ? ps - s : 0, short: 0, closed: false };
      if (it.hardEnd && pe > e) { r.short = pe - Math.max(e, ps); pe = Math.max(ps, e); }
      if (it.closes) {
        const c = hm(it.closes);
        if (ps >= c) r.closed = true;
        else if (pe > c) { r.short = pe - c; pe = c; }
      }
      r.pe = pe;
      res[it.id] = r;
      cursor = pe;
    }
  }
  return res;
}

function dayIndex(date) { return state.trip.days.findIndex(d => d.date === date); }

// Dove siamo nel programma in questo momento.
function locate(t) {
  const days = state.trip.days;
  if (t.date < days[0].date) return { mode: 'pre' };
  if (t.date > days.at(-1).date) return { mode: 'post' };
  const di = dayIndex(t.date);
  const day = days[di];
  const proj = project(day);
  const list = visible(day, day.split ? (state.who || 'sei') : null).filter(it => !proj[it.id].skipped);
  let cur = list.find(it => !state.done[it.id] && proj[it.id].ps <= t.min && t.min < proj[it.id].pe) || null;
  const from = cur ? list.indexOf(cur) + 1 : 0;
  let next = list.slice(from).find(it => !state.done[it.id] && (cur || proj[it.id].ps > t.min)) || null;
  let nextDay = day, nextProj = proj;
  if (!next && di + 1 < days.length) {
    nextDay = days[di + 1];
    nextProj = project(nextDay);
    next = visible(nextDay, nextDay.split ? (state.who || 'sei') : null).find(it => !nextProj[it.id].skipped && !it.opt) || null;
  }
  let minsToNext = null;
  if (next) minsToNext = Math.round((dateWall(nextDay.date, nextProj[next.id].ps) - t.wall) / 60000);
  return { mode: 'trip', day, proj, cur, next, nextDay, nextProj, minsToNext };
}

// Problemi nel resto della giornata e cosa si può tagliare per rimediare.
function issues(day, proj, fromItem) {
  const items = visible(day, day.split ? (state.who || 'sei') : null);
  const start = fromItem ? items.indexOf(fromItem) : 0;
  const out = [];
  for (let i = Math.max(0, start); i < items.length; i++) {
    const it = items[i], p = proj[it.id];
    if (!p || p.skipped || state.done[it.id]) continue;
    let msg = null;
    if (p.closed) msg = `${it.t}: arrivereste dopo la chiusura delle ${it.closes}.`;
    else if (p.late > 0) msg = `${it.t}: arrivereste alle ${fmt(p.ps)}, con ${p.late} min di ritardo.`;
    else if (p.short > 0 && it.hardEnd) msg = `${it.t}: uscite comunque alle ${it.e}, così il resto della giornata non slitta (${p.short} min in meno qui).`;
    else if (p.short > 0) msg = `${it.t}: restano solo ${p.pe - p.ps} min prima della chiusura (${p.short} in meno).`;
    if (!msg) continue;
    const cuts = items.slice(Math.max(0, start), i)
      .filter(c => c.cut && !state.done[c.id] && !proj[c.id].skipped && c !== fromItem)
      .map(c => ({ it: c, gain: hm(c.e) - hm(c.s) }));
    out.push({ it, msg, cuts });
  }
  return out;
}

/* ---------- meteo (Open-Meteo, senza chiave) ---------- */

const WMO = c => c === 0 ? 'sereno' : c <= 2 ? 'poco nuvoloso' : c === 3 ? 'coperto' : c <= 48 ? 'nebbia'
  : c <= 57 ? 'pioggerella' : c <= 67 ? 'pioggia' : c <= 77 ? 'neve' : c <= 82 ? 'rovesci' : 'temporale';

async function refreshWeather() {
  if (state.weather && Date.now() - state.weather.at < 3600e3) return;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&timezone=Europe%2FLondon&forecast_days=16' +
      '&hourly=temperature_2m,precipitation_probability,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset';
    const j = await (await fetch(url)).json();
    state.weather = { at: Date.now(), hourly: j.hourly, daily: j.daily };
    LS.set('weather', state.weather);
    render();
  } catch {}
}

function weatherAt(date, min) {
  const w = state.weather;
  if (!w || !w.hourly) return null;
  const i = w.hourly.time.indexOf(`${date}T${pad(Math.floor(min / 60))}:00`);
  if (i < 0 || w.hourly.temperature_2m[i] == null) return null;
  return { temp: Math.round(w.hourly.temperature_2m[i]), rain: w.hourly.precipitation_probability[i], code: w.hourly.weather_code[i] };
}
function weatherDay(date) {
  const w = state.weather;
  if (!w || !w.daily) return null;
  const i = w.daily.time.indexOf(date);
  if (i < 0 || w.daily.temperature_2m_max[i] == null) return null;
  return {
    max: Math.round(w.daily.temperature_2m_max[i]), min: Math.round(w.daily.temperature_2m_min[i]),
    rain: w.daily.precipitation_probability_max[i], code: w.daily.weather_code[i],
    sunset: (w.daily.sunset[i] || '').slice(11, 16),
  };
}

/* ---------- utilità di rendering ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lineChips(lines) {
  if (!lines || !lines.length) return '';
  return `<span class="chips">${lines.map(l => `<span class="chip" style="--c:${LINES[l][1]}">${esc(LINES[l][0])}</span>`).join('')}</span>`;
}

function modeLabel(it) {
  if (it.mode === 'walking') return 'A piedi';
  if (it.lines && it.lines.length) return it.lines.map(l => LINES[l][0]).join(' + ');
  return 'Mezzi pubblici';
}

// Il "binario" della timeline: linee colorate per i tratti in metro, puntini per i tratti a piedi, fermate per le visite.
function track(it, p, isCur) {
  const cls = ['track'];
  if (isCur) cls.push('is-cur');
  let rail;
  if (it.k === 'move' && it.lines && it.lines.length) {
    rail = `<span class="rail lines">${it.lines.map(l => `<i style="--c:${LINES[l][1]}"></i>`).join('')}</span>`;
  } else if (it.k === 'move' || it.k === 'walk') {
    rail = '<span class="rail walk"></span>';
  } else {
    rail = '<span class="rail plain"></span><span class="node"></span>';
  }
  return `<span class="${cls.join(' ')}" aria-hidden="true">${rail}${isCur ? '<span class="here"></span>' : ''}</span>`;
}

function timeCell(it, p) {
  const s = hm(it.s);
  if (p && !p.skipped && p.ps !== s) return `<span class="t-new">${fmt(p.ps)}</span><s class="t-old">${it.s}</s>`;
  return `<span>${it.s}</span>`;
}

function whoBadge(day, it) {
  if (!it.who || !day.split) return '';
  return `<span class="who who-${it.who}">${it.who === 'df' ? 'Davide e Frensy' : 'I 6'}</span>`;
}

function timeline(day, proj, items, curId) {
  return `<ol class="tl">${items.map(it => {
    const p = proj[it.id] || {};
    const cls = ['tl-row', 'k-' + it.k];
    if (state.done[it.id]) cls.push('is-done');
    if (p.skipped) cls.push('is-skip');
    if (it.id === curId) cls.push('is-cur');
    if (it.opt) cls.push('is-opt');
    const flags = [];
    if (it.opt) flags.push('<span class="flag">facoltativo</span>');
    if (it.anchor) flags.push('<span class="flag flag-fixed">orario fisso</span>');
    if (it.booking) flags.push('<span class="flag flag-ticket">biglietto</span>');
    if (p.skipped) flags.push('<span class="flag">saltato</span>');
    if (p.late > 0 || p.closed) flags.push('<span class="flag flag-warn">a rischio</span>');
    else if (p.short > 0) flags.push('<span class="flag flag-warn">ridotto</span>');
    return `<li class="${cls.join(' ')}">
      <button class="tl-btn" data-item="${it.id}" data-day="${day.date}">
        <span class="tl-time">${timeCell(it, p)}</span>
        ${track(it, p, it.id === curId)}
        <span class="tl-body">
          <span class="tl-title">${esc(it.t)}</span>
          <span class="tl-meta">${whoBadge(day, it)}${it.k === 'move' ? lineChips(it.lines) : ''}${flags.join('')}</span>
        </span>
      </button>
    </li>`;
  }).join('')}</ol>`;
}

/* ---------- schermata: password ---------- */

function renderLogin(error) {
  app.innerHTML = `
    <main class="login">
      <section class="board board-login" aria-label="Londra 10–14 novembre">
        <div class="board-row"><span class="b-label">1</span><span class="b-title">Londra</span><span class="b-min">10–14 nov</span></div>
        <div class="board-row dim"><span class="b-label">2</span><span class="b-title">Queen's Park</span><span class="b-min">8 amici</span></div>
      </section>
      <form class="login-form" id="login">
        <label for="pw">Password del gruppo</label>
        <input id="pw" name="pw" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus>
        ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
        <button class="btn btn-primary" type="submit">Apri il programma</button>
        <p class="fine">Il programma e i biglietti sono cifrati: senza la password nessuno li può leggere. Basta inserirla una volta per telefono.</p>
      </form>
    </main>`;
  document.getElementById('login').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Apro…';
    try {
      // Si perdonano maiuscole e spazi in più che le tastiere dei telefoni aggiungono da sole.
      const key = await deriveKey(e.target.pw.value.trim().replace(/\s+/g, ' ').toLowerCase());
      state.trip = await openTrip(key);
      state.key = key;
      LS.set('key', toB64(await crypto.subtle.exportKey('raw', key)));
      start();
    } catch (err) {
      renderLogin(err.name === 'OperationError' ? 'Password non corretta.' : 'Serve la connessione a internet per il primo accesso.');
    }
  });
}

/* ---------- schermata: adesso ---------- */

function boardHTML(t, loc) {
  const w = weatherAt(t.date, t.min);
  const top = `<div class="board-top">
      <span>${esc(shortDate(t.date).toUpperCase())}</span>
      <span class="clock">${fmt(t.min)}<span class="blink">:</span>${pad(t.sec)}</span>
      <span>${w ? `${w.temp}° ${w.rain >= 30 ? `☂${w.rain}%` : ''}` : 'LONDRA'}</span>
    </div>`;

  if (loc.mode === 'pre') {
    const first = state.trip.days[0], it = first.items[0];
    const mins = Math.round((dateWall(first.date, hm(it.s)) - t.wall) / 60000);
    return `<section class="board">${top}
      <div class="board-row big"><span class="b-label">TRA</span><span class="b-title">${until(mins)}</span></div>
      <div class="board-row"><span class="b-label">1</span><span class="b-title">Gatwick</span><span class="b-min">${it.s} mar 10</span></div>
      ${ticker('Prima di partire: controllate la checklist nella scheda Info')}
    </section>`;
  }
  if (loc.mode === 'post') {
    return `<section class="board">${top}
      <div class="board-row big"><span class="b-label">FINE</span><span class="b-title">Bentornati</span></div>
      ${ticker('Grazie per aver viaggiato con noi')}
    </section>`;
  }

  const { cur, next, proj, nextProj, minsToNext } = loc;
  let curRow = '';
  if (cur) {
    const p = proj[cur.id];
    const total = Math.max(1, p.pe - p.ps), done = Math.min(total, Math.max(0, t.min - p.ps));
    const dots = 16, lit = Math.round(done / total * dots);
    curRow = `<div class="board-row big"><span class="b-label">ORA</span><span class="b-title">${esc(cur.t)}</span></div>
      <div class="board-progress" role="img" aria-label="Mancano ${p.pe - t.min} minuti, fino alle ${fmt(p.pe)}">
        <span class="dots">${Array.from({ length: dots }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</span>
        <span class="b-min">fino ${fmt(p.pe)}</span>
      </div>`;
  } else {
    curRow = `<div class="board-row big"><span class="b-label">ORA</span><span class="b-title">${next ? 'Tempo libero' : 'Giornata finita'}</span></div>`;
  }
  let nextRow = '';
  if (next) {
    const when = loc.nextDay !== loc.day ? `${fmt(nextProj[next.id].ps)} dom` : until(minsToNext);
    nextRow = `<div class="board-row"><span class="b-label">1</span><span class="b-title">${esc(next.t)}</span><span class="b-min">${when}</span></div>`;
  }
  const msg = urgentMessage(t, loc);
  return `<section class="board">${top}${curRow}${nextRow}${msg ? ticker(msg) : ''}</section>`;
}

function ticker(msg) {
  return `<div class="board-msg"><span class="marquee"><span>${esc(msg)}</span><span aria-hidden="true">${esc(msg)}</span></span></div>`;
}

function urgentMessage(t, loc) {
  const iss = issues(loc.day, loc.proj, loc.cur);
  if (iss.length) return iss[0].msg;
  const it = loc.cur || loc.next;
  if (it && it.warn) return `${it.t}: ${it.warn}`;
  if (it && it.closes) return `${it.t} chiude alle ${it.closes}`;
  const wd = weatherDay(t.date);
  const sunset = wd?.sunset || state.trip.sunset;
  const sm = hm(sunset);
  if (t.min < sm && sm - t.min <= 90) return `Tramonto alle ${sunset}: approfittate dei panorami`;
  if (it && it.tips) return it.tips[0];
  return '';
}

function navBlock(loc) {
  const { cur, next } = loc;
  const target = cur && (cur.k === 'move' || cur.k === 'walk' || cur.route) ? cur : next;
  const here = cur ? cur.to : null;
  const parts = [];
  if (target && !(target === next && target.to === here && !target.route)) {
    const p = place(target.to), mode = target.mode || 'transit';
    parts.push(`<a class="btn btn-go" href="${gmaps(target.to, mode)}" target="_blank" rel="noopener">
        <span class="go-k">Portami a</span>
        <span class="go-t">${esc(p.n)}</span>
        <span class="go-m">${esc(modeLabel(target))} · Google Maps</span>
      </a>
      <div class="go-alt">
        <a class="btn btn-ghost" href="${citymapper(target.to)}" target="_blank" rel="noopener">Citymapper</a>
        ${isIOS ? `<a class="btn btn-ghost" href="${appleMaps(target.to, mode)}" target="_blank" rel="noopener">Mappe Apple</a>` : ''}
        ${target.route ? `<a class="btn btn-ghost" href="${gmapsRoute(target.route)}" target="_blank" rel="noopener">Percorso a piedi</a>` : ''}
      </div>`);
  }
  parts.push(`<div class="go-alt">
      <a class="btn btn-ghost" href="${gmaps(state.trip.home, 'transit')}" target="_blank" rel="noopener">Torna a casa</a>
      <a class="btn btn-ghost" href="https://tfl.gov.uk/tube-dlr-overground/status/" target="_blank" rel="noopener">Stato metro</a>
    </div>`);
  return `<section class="nav">${parts.join('')}</section>`;
}

function itemCard(day, it, p, heading) {
  const booking = it.booking && state.trip.bookings.find(b => b.id === it.booking);
  return `<article class="card item-card">
    <p class="eyebrow">${heading}</p>
    <h2>${esc(it.t)}</h2>
    <p class="when">${timeCell(it, p)}<span> – ${p && p.pe !== hm(it.e) ? `<b>${fmt(p.pe)}</b>` : it.e}</span>${whoBadge(day, it)}</p>
    ${it.warn ? `<p class="warn">${esc(it.warn)}</p>` : ''}
    ${it.d ? `<p>${esc(it.d)}</p>` : ''}
    ${it.k === 'move' ? `<p>${lineChips(it.lines)}</p>` : ''}
    ${it.tips ? `<ul class="tips">${it.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${it.food ? `<div class="food"><b>Da mangiare</b><p>${esc(it.food)}</p></div>` : ''}
    ${booking ? `<button class="btn btn-ticket" data-booking="${booking.id}">Mostra biglietto · ${esc(booking.t)}</button>` : ''}
  </article>`;
}

function renderNow() {
  const t = now();
  const loc = locate(t);
  let body = '';

  if (loc.mode === 'pre') {
    const todo = state.trip.checklist.length - Object.values(state.check).filter(Boolean).length;
    body = `
      <article class="card">
        <p class="eyebrow">Prima di partire</p>
        <h2>${todo ? `${todo} cose da controllare` : 'Checklist completata'}</h2>
        <button class="btn btn-ghost" data-tab="info">Apri la checklist</button>
      </article>
      ${pollsSection()}
      <article class="card">
        <p class="eyebrow">Prova l'app</p>
        <h2>Come se foste già a Londra</h2>
        <p>Scegli un momento del viaggio e guarda cosa ti mostrerebbe l'app. Per tornare all'ora vera tocca la barra in alto.</p>
        <div class="go-alt">
          <button class="btn btn-ghost" data-sim="2026-11-11T10:05">Mer 11 · 10:05</button>
          <button class="btn btn-ghost" data-sim="2026-11-12T13:20">Gio 12 · 13:20</button>
          <button class="btn btn-ghost" data-sim="2026-11-13T14:00">Ven 13 · 14:00</button>
        </div>
      </article>
      <h3 class="sec">Il viaggio</h3>
      <ul class="days">${state.trip.days.map(d => `<li><button data-goday="${d.date}"><b>${esc(d.label)}</b><span>${esc(d.title)}</span></button></li>`).join('')}</ul>`;
  } else if (loc.mode === 'post') {
    body = `<article class="card"><h2>Il viaggio è finito</h2><p>Il programma resta consultabile nella scheda Programma.</p></article>`;
  } else {
    const { day, proj, cur, next } = loc;
    const split = day.split && !state.who && [cur, next].some(x => x && x.who);
    const delay = state.delay[day.date];
    const anchorFor = cur || next;
    const iss = issues(day, proj, cur);
    body = `
      ${split ? `<article class="card pick">
        <p class="eyebrow">Stamattina vi dividete</p>
        <h2>Tu con chi sei?</h2>
        <div class="go-alt">
          <button class="btn btn-primary" data-who="sei">${esc(day.split.sei)}</button>
          <button class="btn btn-primary" data-who="df">${esc(day.split.df)}</button>
        </div></article>` : ''}
      ${pollsSection()}
      ${navBlock(loc)}
      ${cur ? itemCard(day, cur, proj[cur.id], 'Adesso') : ''}
      ${cur ? `<div class="row-actions">
          <button class="btn btn-ghost" data-done="${cur.id}">Fatto, passa al prossimo</button>
          ${cur.cut || cur.opt ? `<button class="btn btn-ghost" data-skip="${cur.id}">Salta</button>` : ''}
        </div>` : ''}
      ${!cur && next ? itemCard(loc.nextDay, next, loc.nextProj[next.id], loc.nextDay === day ? 'Prossima tappa' : 'Domani') : ''}
      ${anchorFor && loc.nextDay === day || cur ? `<section class="card late">
        <p class="eyebrow">Siete in ritardo?</p>
        ${delay ? `<p>Ritardo segnato: <b>+${delay.min} min</b> da «${esc(day.items.find(i => i.id === delay.from)?.t || '')}».</p>` : '<p>Segna il ritardo e l\'app ricalcola il resto della giornata.</p>'}
        <div class="go-alt">
          ${[10, 20, 30, 45].map(m => `<button class="btn btn-ghost" data-delay="${m}" data-from="${anchorFor.id}">+${m}</button>`).join('')}
          ${delay ? '<button class="btn btn-ghost" data-delay="0">Azzera</button>' : ''}
        </div>
        ${iss.length ? `<div class="issues">${iss.map(x => `
          <div class="issue">
            <p class="warn">${esc(x.msg)}</p>
            ${x.cuts.length ? `<p class="fine">Per recuperare tempo potete saltare:</p><div class="go-alt">${x.cuts.map(c =>
              `<button class="btn btn-ghost" data-skip="${c.it.id}">${esc(c.it.t)} · ${c.gain} min</button>`).join('')}</div>` : ''}
          </div>`).join('')}
          <details id="planb" ${state.planbOpen ? 'open' : ''}><summary>Il piano B della giornata</summary><p>${esc(day.planB)}</p></details>
        </div>` : ''}
        ${groupFeed()}
      </section>` : ''}
      <h3 class="sec">Il resto di oggi <button class="link" data-goday="${day.date}">Tutta la giornata</button></h3>
      ${timeline(day, proj, visible(day).filter(it => !state.done[it.id] && (proj[it.id].pe > t.min || it === cur)), cur?.id)}
    `;
  }

  return `${boardHTML(t, loc)}<div class="wrap">${body}</div>`;
}

/* ---------- schermata: programma ---------- */

function renderPlan() {
  const t = now();
  const days = state.trip.days;
  const date = state.viewDay || (dayIndex(t.date) >= 0 ? t.date : days[0].date);
  const day = days[dayIndex(date)];
  const proj = project(day);
  const loc = locate(t);
  const wd = weatherDay(day.date);
  return `
    <header class="plan-head">
      <nav class="daytabs" aria-label="Giorni">${days.map(d => `<button data-goday="${d.date}" class="${d.date === date ? 'on' : ''}" ${d.date === date ? 'aria-current="date"' : ''}>
        <span>${esc(d.label.split(' ')[0].slice(0, 3))}</span><b>${d.date.slice(8)}</b></button>`).join('')}</nav>
    </header>
    <div class="wrap">
      <p class="eyebrow">${esc(day.label)}</p>
      <h1>${esc(day.title)}</h1>
      <p class="lede">${esc(day.intro)}</p>
      ${wd ? `<p class="wx">${wd.min}°–${wd.max}° · ${WMO(wd.code)} · pioggia ${wd.rain}% · tramonto ${wd.sunset}</p>` : `<p class="wx">Tramonto intorno alle ${state.trip.sunset} · previsioni meteo disponibili a 16 giorni dal viaggio</p>`}
      ${day.split ? `<div class="seg" role="group" aria-label="Chi sei venerdì mattina">
        ${[['sei', day.split.sei], ['df', day.split.df], [null, 'Tutti']].map(([k, l]) => `<button data-who="${k ?? ''}" class="${state.who === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` : ''}
      ${timeline(day, proj, visible(day), loc.mode === 'trip' && loc.day === day ? loc.cur?.id : null)}
      <aside class="planb"><b>Se qualcosa slitta</b><p>${esc(day.planB)}</p></aside>
    </div>`;
}

/* ---------- schermata: biglietti ---------- */

function renderTickets() {
  const label = { ok: 'Confermato', todo: 'Da prenotare', free: 'Senza prenotazione' };
  return `<div class="wrap">
    <h1>Biglietti</h1>
    <p class="lede">Sono salvati sul telefono e si aprono anche senza connessione. Al controllo alzate la luminosità dello schermo.</p>
    ${state.trip.bookings.map(b => `<article class="card ticket">
      <div class="ticket-head"><h2>${esc(b.t)}</h2><span class="status st-${b.status}">${label[b.status]}</span></div>
      <p class="when">${esc(b.when)}</p>
      ${b.note ? `<p>${esc(b.note)}</p>` : ''}
      ${b.files.some(f => f.codes) ? `<button class="btn btn-ticket" data-codes="${b.id}">Mostra gli ${b.files.reduce((n, f) => n + (f.codes?.length || 0), 0)} codici, uno alla volta</button>` : ''}
      ${b.files.length ? `<div class="go-alt">${b.files.map((f, i) => `<button class="btn ${b.files.some(x => x.codes) ? 'btn-ghost' : 'btn-ticket'}" data-file="${b.id}:${i}">${esc(f.name)}</button>`).join('')}</div>`
        : b.status === 'ok' ? '<p class="fine">Il file del biglietto non è ancora stato caricato nell\'app.</p>' : ''}
    </article>`).join('')}
  </div>`;
}

const blobUrl = async (id, type) => URL.createObjectURL(new Blob([await unseal(state.key, id + '.bin')], { type }));
let scan = null;
let wakeLock = null;

// Modalità ingresso: un codice alla volta, grande, con il nome o il numero del biglietto.
async function showCodes(bookingId, start = 0) {
  const b = state.trip.bookings.find(x => x.id === bookingId);
  const all = b.files.flatMap(f => f.codes || []);
  openSheet(`<p class="eyebrow">${esc(b.t)}</p><p class="fine">Apro i biglietti…</p>`);
  try {
    const codes = [];
    for (const c of all) codes.push({ label: c.label, holder: c.holder, url: await blobUrl(c.id, 'image/png') });
    scan = { b, codes, i: Math.min(start, codes.length - 1) };
    renderScan();
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  } catch {
    openSheet(`<h2>${esc(b.t)}</h2><p class="warn">I biglietti non si aprono. Collegatevi a internet una volta per scaricarli sul telefono, poi riprovate.</p>`);
  }
}

function renderScan() {
  const { b, codes, i } = scan;
  const c = codes[i];
  openSheet(`<p class="eyebrow">${esc(b.t)} · ${esc(b.when)}</p>
    <div class="scan" data-swipe>
      <img class="scan-code" src="${c.url}" alt="Codice di ${esc(c.holder || c.label)}">
      <p class="scan-label">${esc(c.holder || c.label)}</p>
      ${c.holder ? `<p class="scan-sub">${esc(c.label)}</p>` : ''}
      <p class="scan-count">${i + 1} di ${codes.length}</p>
    </div>
    <div class="scan-nav">
      <button class="btn btn-ghost" data-scan="-1" ${i === 0 ? 'disabled' : ''}>Precedente</button>
      <button class="btn btn-primary" data-scan="1" ${i === codes.length - 1 ? 'disabled' : ''}>Successivo</button>
    </div>
    <p class="fine">Alzate la luminosità dello schermo. Scorrete per passare da un biglietto all'altro.</p>
    <div class="go-alt">${b.files.map((f, k) => `<button class="btn btn-ghost" data-file="${b.id}:${k}">Documento completo${b.files.length > 1 ? ` · ${esc(f.name)}` : ''}</button>`).join('')}</div>`, true);
}

async function showFile(bookingId, idx) {
  const b = state.trip.bookings.find(x => x.id === bookingId);
  const f = b.files[idx];
  openSheet(`<p class="eyebrow">${esc(b.t)}</p><h2>${esc(f.name)}</h2><p class="fine">Apro il biglietto…</p>`);
  try {
    const urls = [];
    if (f.pages) for (const id of f.pages) urls.push(await blobUrl(id, 'image/png'));
    else if (f.mime.startsWith('image/')) urls.push(await blobUrl(f.id, f.mime));
    const orig = await blobUrl(f.id, f.mime);
    openSheet(`<p class="eyebrow">${esc(b.t)}</p><h2>${esc(f.name)}</h2>
      <div class="ticket-view">${urls.map((u, i) => `<img src="${u}" alt="${esc(f.name)}, pagina ${i + 1}">`).join('')}</div>
      <div class="go-alt">
        ${f.codes ? `<button class="btn btn-ghost" data-codes="${b.id}">Torna ai codici</button>` : ''}
        <a class="btn btn-ghost" href="${orig}" download="${esc(f.name)}" target="_blank">Apri il file originale</a>
      </div>`, true);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  } catch {
    openSheet(`<h2>${esc(f.name)}</h2><p class="warn">Il file non si apre. Collegatevi a internet una volta per scaricarlo sul telefono, poi riprovate.</p>`);
  }
}

function showBooking(bookingId) {
  const b = state.trip.bookings.find(x => x.id === bookingId);
  if (b.files.some(f => f.codes)) showCodes(b.id);
  else if (b.files.length) showFile(b.id, 0);
  else { state.tab = 'tickets'; LS.set('tab', 'tickets'); closeSheet(); render(); }
}

let touchX = null;
sheetEl.addEventListener('touchstart', e => { touchX = e.target.closest('[data-swipe]') ? e.touches[0].clientX : null; }, { passive: true });
sheetEl.addEventListener('touchend', e => {
  if (touchX == null || !scan) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) moveScan(dx < 0 ? 1 : -1);
  touchX = null;
});
function moveScan(step) {
  const i = scan.i + step;
  if (i < 0 || i >= scan.codes.length) return;
  scan.i = i;
  renderScan();
}

/* ---------- schermata: info ---------- */

function renderInfo() {
  const home = place(state.trip.home);
  const sim = LS.get('sim', null);
  return `<div class="wrap">
    <h1>Info</h1>
    <article class="card">
      <p class="eyebrow">La base</p>
      <h2>${esc(home.q)}</h2>
      <p>${home.note ? `${esc(home.note)} · ` : ''}Queen's Park · Bakerloo line</p>
      <div class="go-alt">
        <a class="btn btn-primary" href="${gmaps(state.trip.home, 'transit')}" target="_blank" rel="noopener">Torna a casa</a>
        <button class="btn btn-ghost" data-copy="${esc(home.q)}">Copia indirizzo</button>
      </div>
    </article>
    <article class="card">
      <p class="eyebrow">Emergenze</p>
      <div class="go-alt">
        <a class="btn btn-danger" href="tel:999">999 · Emergenze</a>
        <a class="btn btn-ghost" href="tel:111">111 · Medico non urgente</a>
      </div>
    </article>
    <h3 class="sec">Checklist</h3>
    <ul class="check">${state.trip.checklist.map((c, i) => `<li><label><input type="checkbox" data-check="${i}" ${state.check[i] ? 'checked' : ''}><span>${esc(c)}</span></label></li>`).join('')}</ul>
    <p class="fine">Le spunte restano solo su questo telefono.</p>
    <h3 class="sec">Regole del gruppo</h3>
    <ul class="rules">${state.trip.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    <h3 class="sec">Link utili</h3>
    <ul class="links">${state.trip.links.map(l => `<li><a href="${esc(l.u)}" target="_blank" rel="noopener"><b>${esc(l.t)}</b><span>${esc(l.d)}</span></a></li>`).join('')}</ul>
    <h3 class="sec">Impostazioni</h3>
    ${sync.on ? `<article class="card">
      <p class="eyebrow">Il gruppo</p>
      <h2>Sei ${esc(LS.get('me', ''))}</h2>
      <button class="btn btn-ghost" id="changeMe">Cambia nome</button>
      ${groupFeed(8)}
    </article>` : ''}
    <article class="card">
      <label class="field">Prova un altro momento del viaggio
        <input type="datetime-local" id="simAt" min="2026-11-09T00:00" max="2026-11-15T23:59" value="${sim ? sim.at : '2026-11-12T13:20'}">
      </label>
      <div class="go-alt">
        <button class="btn btn-ghost" id="simGo">Simula</button>
        ${sim ? '<button class="btn btn-ghost" data-sim="">Torna all\'ora vera</button>' : ''}
      </div>
      <div class="go-alt">
        <button class="btn btn-ghost" id="resetProgress">${sync.on ? 'Azzera spunte e ritardi del gruppo' : 'Azzera spunte e ritardi'}</button>
        <button class="btn btn-ghost" id="logout">Esci da questo telefono</button>
      </div>
      <p class="fine">Versione ${esc(window.__ver || '')}</p>
    </article>
  </div>`;
}

/* ---------- sheet di dettaglio ---------- */

function openSheet(html, wide) {
  sheetEl.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-card ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="sheet-x" data-close aria-label="Chiudi">×</button>${html}</div>`;
  sheetEl.hidden = false;
  sheetEl.querySelector('.sheet-x').focus();
}
function closeSheet() {
  sheetEl.hidden = true; sheetEl.innerHTML = ''; scan = null;
  wakeLock?.release().catch(() => {}); wakeLock = null;
}

function itemSheet(date, id) {
  const day = state.trip.days[dayIndex(date)];
  const it = day.items.find(i => i.id === id);
  const p = project(day)[id];
  const mode = it.mode || 'transit';
  openSheet(`${itemCard(day, it, p, esc(day.label))}
    <div class="go-alt">
      <a class="btn btn-primary" href="${gmaps(it.to, mode)}" target="_blank" rel="noopener">Portami a ${esc(place(it.to).n)}</a>
      <a class="btn btn-ghost" href="${citymapper(it.to)}" target="_blank" rel="noopener">Citymapper</a>
      ${isIOS ? `<a class="btn btn-ghost" href="${appleMaps(it.to, mode)}" target="_blank" rel="noopener">Mappe Apple</a>` : ''}
      ${it.route ? `<a class="btn btn-ghost" href="${gmapsRoute(it.route)}" target="_blank" rel="noopener">Percorso a piedi</a>` : ''}
    </div>
    <div class="go-alt">
      ${state.done[id] ? `<button class="btn btn-ghost" data-undone="${id}">Segna come da fare</button>` : `<button class="btn btn-ghost" data-done="${id}">Segna come fatto</button>`}
      ${p.skipped ? `<button class="btn btn-ghost" data-unskip="${id}">Rimetti nel programma</button>` : `<button class="btn btn-ghost" data-skip="${id}">Salta questa tappa</button>`}
    </div>`);
}

/* ---------- shell, eventi, avvio ---------- */

function render() {
  if (!state.trip) return;
  const sim = LS.get('sim', null);
  const t = now();
  const screens = { now: renderNow, plan: renderPlan, tickets: renderTickets, info: renderInfo };
  const scrollY = window.scrollY;
  const focusId = document.activeElement?.id;
  app.innerHTML = `
    ${sim ? `<button class="simbar" data-sim="">Simulazione · ${esc(shortDate(t.date))} ${fmt(t.min)} · tocca per tornare all'ora vera</button>` : ''}
    <main class="screen screen-${state.tab}">${sync.on && !LS.get('me', null) ? renderWhoAmI() : screens[state.tab]()}</main>
    <nav class="tabs" aria-label="Sezioni">
      ${[['now', 'Adesso'], ['plan', 'Programma'], ['tickets', 'Biglietti'], ['info', 'Info']].map(([k, l]) =>
        `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}" ${state.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}
    </nav>`;
  window.scrollTo(0, scrollY);
  if (focusId) document.getElementById(focusId)?.focus();
}

function toast(msg, action) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  if (action) toastEl.querySelector('button').onclick = action.run;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, action ? 10000 : 3500);
}

function save() {
  if (!sync.on) { LS.set('done', state.done); LS.set('skip', state.skip); LS.set('delay', state.delay); }
  LS.set('who', state.who); LS.set('check', state.check);
}

/* ---------- stato condiviso del gruppo ---------- */

// Fatto, saltato e ritardi sono eventi: ogni telefono li cifra con la chiave del gruppo e li manda al worker,
// poi ricostruisce lo stato rileggendo il registro nell'ordine del server.
const sync = {
  on: false, url: null, token: null,
  events: LS.get('events', []), cursor: LS.get('cursor', 0), outbox: LS.get('outbox', []),
  last: LS.get('synced', null), error: null,
};

function applyEvent(s, ev) {
  if (ev.t === 'done') s.done[ev.id] = true;
  else if (ev.t === 'undone') delete s.done[ev.id];
  else if (ev.t === 'skip') s.skip[ev.id] = true;
  else if (ev.t === 'unskip') delete s.skip[ev.id];
  else if (ev.t === 'delay') { if (ev.min) s.delay[ev.date] = { from: ev.from, min: ev.min }; else delete s.delay[ev.date]; }
  else if (ev.t === 'reset') { s.done = {}; s.skip = {}; s.delay = {}; }
  else if (ev.t === 'poll') s.polls[ev.pid] = { pid: ev.pid, q: ev.q, opts: ev.opts, by: ev.by, at: ev.at, votes: {}, closed: null };
  else if (ev.t === 'vote' && s.polls[ev.pid] && !s.polls[ev.pid].closed) {
    if (ev.opt == null) delete s.polls[ev.pid].votes[ev.by]; else s.polls[ev.pid].votes[ev.by] = ev.opt;
  }
  else if (ev.t === 'pollclose' && s.polls[ev.pid]) s.polls[ev.pid].closed = { by: ev.by, at: ev.at };
}

const allEvents = () => [...sync.events.map(e => e.ev), ...sync.outbox];

function rebuild() {
  const s = { done: {}, skip: {}, delay: {}, polls: {} };
  for (const ev of allEvents()) applyEvent(s, ev);
  Object.assign(state, s);
}

function act(ev) {
  ev = { ...ev, by: LS.get('me', null), at: Date.now(), uid: crypto.randomUUID() };
  if (!sync.on) { applyEvent(state, ev); save(); render(); return; }
  sync.outbox.push(ev);
  LS.set('outbox', sync.outbox);
  rebuild(); render();
  syncNow();
}

async function sealEvent(ev) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key, new TextEncoder().encode(JSON.stringify(ev)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function openEvent(data) {
  try {
    const buf = b64(data);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, state.key, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { return null; }
}

const itemTitle = id => { for (const d of state.trip.days) { const it = d.items.find(i => i.id === id); if (it) return it.t; } return id; };

function describe(ev) {
  const who = ev.by || 'Qualcuno';
  switch (ev.t) {
    case 'done': return `${who} ha segnato «${itemTitle(ev.id)}» come fatto`;
    case 'undone': return `${who} ha rimesso «${itemTitle(ev.id)}» tra le cose da fare`;
    case 'skip': return `${who} ha saltato «${itemTitle(ev.id)}»`;
    case 'unskip': return `${who} ha rimesso «${itemTitle(ev.id)}» nel programma`;
    case 'delay': return ev.min ? `${who} ha segnato un ritardo di ${ev.min} min` : `${who} ha azzerato il ritardo`;
    case 'reset': return `${who} ha azzerato il programma`;
    case 'poll': return `${who} chiede: «${ev.q}»`;
    case 'pollclose': { const p = state.polls[ev.pid]; return p ? `${who} ha chiuso «${p.q}»: ${pollWinner(p)}` : ''; }
  }
  return '';
}

// L'evento che annulla ev, calcolato sul registro fino a quel punto.
function inverse(ev) {
  if (ev.t === 'done') return { t: 'undone', id: ev.id };
  if (ev.t === 'skip') return { t: 'unskip', id: ev.id };
  if (ev.t === 'undone') return { t: 'done', id: ev.id };
  if (ev.t === 'unskip') return { t: 'skip', id: ev.id };
  if (ev.t === 'delay') {
    const list = allEvents();
    const prev = list.slice(0, list.findIndex(e => e.uid === ev.uid)).filter(e => e.t === 'delay' && e.date === ev.date).at(-1);
    return { t: 'delay', date: ev.date, from: prev?.from, min: prev?.min || 0 };
  }
  return null;
}

const clockOf = ms => { const p = Object.fromEntries(londonFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.hour}:${p.minute}`; };

function syncStatus() {
  const pending = sync.outbox.filter(e => !e.sent).length;
  if (pending) return `<span class="sync-dot off"></span>${navigator.onLine === false ? 'Senza rete' : 'In invio'}: ${pending} ${pending === 1 ? 'modifica' : 'modifiche'} in attesa`;
  if (sync.error) return '<span class="sync-dot off"></span>Collegamento con il gruppo non riuscito, riprovo tra poco';
  return `<span class="sync-dot"></span>Aggiornato con il gruppo${sync.last ? ` alle ${clockOf(sync.last)}` : ''}`;
}

function groupFeed(limit = 3) {
  if (!sync.on) return '';
  const list = allEvents().filter(e => e.t !== 'vote').slice(-limit).reverse();
  return `<div class="feed">
    <p class="sync">${syncStatus()}</p>
    ${list.length ? `<ul>${list.map(e => `<li><span class="feed-t">${clockOf(e.at)}</span><span>${esc(describe(e))}</span>
      ${inverse(e) ? `<button class="link" data-undo="${e.uid}">Annulla</button>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

let syncBusy = false, syncAgain = false, lastStatus = '';
async function syncNow() {
  if (!sync.on) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true;
  let changed = false;
  try {
    do { syncAgain = false; changed = (await syncOnce()) || changed; } while (syncAgain);
    sync.error = null; sync.last = Date.now(); LS.set('synced', sync.last);
  } catch (e) {
    sync.error = String(e);
  } finally {
    syncBusy = false;
  }
  const status = syncStatus();
  if ((changed || status !== lastStatus) && sheetEl.hidden && !document.querySelector('input:focus')) render();
  lastStatus = status;
}

async function syncOnce() {
  const auth = { Authorization: 'Bearer ' + sync.token };
  for (const ev of sync.outbox) {
    if (ev.sent) continue;
    const r = await fetch(sync.url + '/events', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: await sealEvent(ev) }) });
    if (!r.ok) throw new Error('invio ' + r.status);
    ev.sent = true;
    LS.set('outbox', sync.outbox);
  }
  // Al primo collegamento in assoluto non si annuncia lo storico: solo le novità successive.
  const primed = sync.last != null || sync.cursor > 0;
  const fresh = [];
  for (;;) {
    const r = await fetch(`${sync.url}/events?since=${sync.cursor}`, { headers: auth, cache: 'no-store' });
    if (!r.ok) throw new Error('lettura ' + r.status);
    const { events } = await r.json();
    for (const row of events) {
      sync.cursor = row.id;
      const ev = await openEvent(row.data);
      if (ev) { sync.events.push({ id: row.id, ev }); fresh.push(ev); }
    }
    if (events.length < 500) break;
  }
  LS.set('cursor', sync.cursor);
  if (!fresh.length) return false;
  const seen = new Set(fresh.map(e => e.uid));
  sync.outbox = sync.outbox.filter(e => !seen.has(e.uid));
  LS.set('events', sync.events); LS.set('outbox', sync.outbox);
  rebuild();
  const me = LS.get('me', null);
  const others = fresh.filter(e => e.by !== me);
  if (primed && others.length) announce(others);
  return true;
}

async function initSync() {
  if (!state.trip.sync?.url) return;
  const raw = b64(LS.get('key', ''));
  const salted = new Uint8Array([...raw, ...new TextEncoder().encode('londra-sync')]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', salted));
  let bin = ''; for (const b of digest) bin += String.fromCharCode(b);
  sync.token = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  sync.url = state.trip.sync.url.replace(/\/$/, '');
  sync.on = true;
  rebuild();
  render();
  syncNow();
  setInterval(() => { if (!document.hidden) syncNow(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('online', syncNow);
}

/* ---------- sondaggi lampo ---------- */

function pollTally(p) {
  const c = p.opts.map(() => []);
  for (const [who, i] of Object.entries(p.votes)) c[i]?.push(who);
  return c;
}

function pollWinner(p) {
  const c = pollTally(p);
  const max = Math.max(...c.map(x => x.length));
  if (!max) return 'nessun voto';
  const w = p.opts.filter((_, i) => c[i].length === max);
  return w.length > 1 ? `pareggio tra ${w.map(x => `«${x}»`).join(' e ')}` : `vince «${w[0]}» (${max} ${max === 1 ? 'voto' : 'voti'})`;
}

const pollFull = p => p && !p.closed && Object.keys(p.votes).length >= state.trip.people.length;

function pollCard(p, me) {
  const c = pollTally(p);
  const n = Object.keys(p.votes).length, total = state.trip.people.length;
  const mine = p.votes[me];
  return `<article class="card poll ${p.closed ? 'is-closed' : ''}" id="poll-${p.pid}">
    <p class="eyebrow">${p.closed ? 'Sondaggio chiuso' : `Sondaggio · ${esc(p.by || 'Qualcuno')} chiede`}</p>
    <h2>${esc(p.q)}</h2>
    <div class="poll-opts">${p.opts.map((o, i) => `
      <button class="poll-opt ${mine === i ? 'on' : ''}" data-vote="${p.pid}:${i}" ${p.closed ? 'disabled' : ''} aria-pressed="${mine === i}">
        <span class="poll-bar" style="width:${Math.round(c[i].length / total * 100)}%"></span>
        <span class="poll-label">${esc(o)}</span><span class="poll-n">${c[i].length}</span>
        ${c[i].length ? `<span class="poll-who">${esc(c[i].join(', '))}</span>` : ''}
      </button>`).join('')}</div>
    <p class="fine">${p.closed
      ? `${esc(pollWinner(p))} · chiuso da ${esc(p.closed.by || 'qualcuno')}`
      : `${n} su ${total} hanno votato · ${mine == null ? 'tocca un\'opzione per votare' : 'tocca di nuovo per togliere il voto'}`}</p>
    ${p.closed ? '' : `<button class="link" data-closepoll="${p.pid}">Chiudi il sondaggio</button>`}
  </article>`;
}

// I sondaggi aperti, e quelli chiusi nell'ultima ora, stanno in cima alla schermata Adesso.
function pollsSection() {
  if (!sync.on) return '';
  const me = LS.get('me', null);
  const list = Object.values(state.polls)
    .filter(p => !p.closed || Date.now() - p.closed.at < 3600e3)
    .sort((a, b) => b.at - a.at);
  return `<section class="polls">
    ${list.map(p => pollCard(p, me)).join('')}
    <button class="btn btn-ghost btn-ask" data-newpoll>Chiedi al gruppo · sondaggio lampo</button>
  </section>`;
}

function pollTemplates() {
  const t = now();
  const loc = locate(t);
  const list = [
    { q: 'Dove ceniamo?', opts: ['Il posto del programma', 'Takeaway e mangiamo in giro', 'Cerchiamo altro qui vicino'] },
    { q: 'Pausa caffè?', opts: ['Sì, adesso', 'Tra poco', 'No, andiamo avanti'] },
    { q: 'A che ora rientriamo stasera?', opts: ['Subito dopo cena', 'Verso le 23', 'Più tardi'] },
  ];
  if (loc.mode === 'trip') {
    const next = visible(loc.day).find(it => it.cut && !state.done[it.id] && !state.skip[it.id] && hm(it.s) >= t.min);
    if (next) list.unshift({ q: `Saltiamo «${next.t}»?`, opts: ['Sì, saltiamola', 'No, ci andiamo'] });
    if (loc.day.date === '2026-11-13') list.push({ q: 'Per Canary Wharf: battello o DLR?', opts: ['Battello', 'DLR o metro'] });
  }
  return list;
}

function newPollSheet(prefill) {
  const opts = prefill?.opts?.length ? prefill.opts : ['', ''];
  openSheet(`<p class="eyebrow">Sondaggio lampo</p>
    <h2>Chiedi al gruppo</h2>
    <p class="fine">Parti da un'idea pronta o scrivi la tua domanda.</p>
    <div class="tpl">${pollTemplates().map((x, i) => `<button class="tpl-btn" data-tpl="${i}">${esc(x.q)}</button>`).join('')}</div>
    <form id="pollForm" class="poll-form">
      <label class="field">Domanda<input name="q" maxlength="120" required value="${esc(prefill?.q || '')}" placeholder="Dove ceniamo?"></label>
      ${opts.map((o, i) => `<label class="field">Opzione ${i + 1}<input name="o" maxlength="60" value="${esc(o)}" ${i < 2 ? 'required' : ''}></label>`).join('')}
      ${opts.length < 6 ? '<button type="button" class="link" data-addopt>Aggiungi un\'opzione</button>' : ''}
      <button class="btn btn-primary" type="submit">Invia al gruppo</button>
    </form>`);
}

function pollFormValues() {
  const f = document.getElementById('pollForm');
  return { q: f.q.value.trim(), opts: [...f.querySelectorAll('[name=o]')].map(i => i.value.trim()) };
}

document.addEventListener('submit', e => {
  if (e.target.id !== 'pollForm') return;
  e.preventDefault();
  const { q, opts } = pollFormValues();
  const clean = [...new Set(opts.filter(Boolean))];
  if (!q || clean.length < 2) { toast('Servono una domanda e almeno due opzioni diverse'); return; }
  closeSheet();
  act({ t: 'poll', pid: crypto.randomUUID().slice(0, 8), q, opts: clean });
  toast('Sondaggio inviato al gruppo');
});

// Cosa dire quando arrivano novità dagli altri: un nuovo sondaggio batte tutto, i singoli voti restano silenziosi.
function announce(evs) {
  const me = LS.get('me', null);
  const poll = evs.filter(e => e.t === 'poll').at(-1);
  if (poll && state.polls[poll.pid] && state.polls[poll.pid].votes[me] == null) {
    toast(`${poll.by || 'Qualcuno'} chiede: ${poll.q}`, { label: 'Vota', run: () => goToPoll(poll.pid) });
    return;
  }
  const full = evs.filter(e => e.t === 'vote').map(e => state.polls[e.pid]).find(pollFull);
  if (full) { toast(`Hanno votato tutti: ${pollWinner(full)}`); return; }
  const rest = evs.filter(e => e.t !== 'vote').at(-1);
  if (rest) toast(describe(rest));
}

function goToPoll(pid) {
  toastEl.hidden = true;
  state.tab = 'now'; LS.set('tab', 'now'); closeSheet(); render();
  document.getElementById('poll-' + pid)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderWhoAmI() {
  return `<div class="wrap whoami">
    <p class="eyebrow">Una cosa sola</p>
    <h1>Chi sei?</h1>
    <p class="lede">Quando segni un ritardo o salti una tappa, gli altri vedono chi l'ha fatto.</p>
    <div class="names">${state.trip.people.map(n => `<button class="btn" data-me="${esc(n)}">${esc(n)}</button>`).join('')}</div>
  </div>`;
}

document.addEventListener('click', e => {
  const el = e.target.closest('button, a, [data-close]');
  if (!el || !state.trip) return;
  const d = el.dataset;
  if ('close' in d) { closeSheet(); return; }
  if (d.tab) { state.tab = d.tab; LS.set('tab', d.tab); closeSheet(); render(); window.scrollTo(0, 0); return; }
  if (d.goday) { state.viewDay = d.goday; state.tab = 'plan'; LS.set('tab', 'plan'); render(); window.scrollTo(0, 0); return; }
  if (d.item) { itemSheet(d.day, d.item); return; }
  if (d.done) { closeSheet(); act({ t: 'done', id: d.done }); toast(sync.on ? 'Segnato come fatto per tutto il gruppo' : 'Segnato come fatto'); return; }
  if (d.undone) { closeSheet(); act({ t: 'undone', id: d.undone }); return; }
  if (d.skip) { closeSheet(); act({ t: 'skip', id: d.skip }); toast('Tappa saltata: orari ricalcolati'); return; }
  if (d.unskip) { closeSheet(); act({ t: 'unskip', id: d.unskip }); return; }
  if (d.undo) { const ev = allEvents().find(e => e.uid === d.undo); const inv = ev && inverse(ev); if (inv) act(inv); return; }
  if (d.me) { LS.set('me', d.me); render(); window.scrollTo(0, 0); return; }
  if ('newpoll' in d) { newPollSheet(); return; }
  if (d.tpl) { newPollSheet(pollTemplates()[+d.tpl]); return; }
  if ('addopt' in d) { const v = pollFormValues(); newPollSheet({ q: v.q, opts: [...v.opts, ''] }); document.querySelectorAll('#pollForm [name=o]')[v.opts.length]?.focus(); return; }
  if (d.vote) {
    const [pid, i] = d.vote.split(':');
    const mine = state.polls[pid]?.votes[LS.get('me', null)];
    act({ t: 'vote', pid, opt: mine === +i ? null : +i });
    if (pollFull(state.polls[pid])) toast(`Hanno votato tutti: ${pollWinner(state.polls[pid])}`);
    return;
  }
  if (d.closepoll) {
    const p = state.polls[d.closepoll];
    if (p && confirm(`Chiudere «${p.q}»? Risultato: ${pollWinner(p)}.`)) act({ t: 'pollclose', pid: p.pid });
    return;
  }
  if (d.who !== undefined) { state.who = d.who || null; save(); render(); return; }
  if (d.delay !== undefined) {
    const date = now().date;
    const prev = state.delay[date];
    const min = +d.delay === 0 ? 0 : (prev && prev.from === d.from ? prev.min : 0) + +d.delay;
    act({ t: 'delay', date, from: d.from, min });
    return;
  }
  if (d.sim !== undefined) {
    if (d.sim) LS.set('sim', { at: d.sim, set: Date.now() }); else LS.del('sim');
    state.tab = 'now'; LS.set('tab', 'now'); render(); window.scrollTo(0, 0); return;
  }
  if (d.booking) { showBooking(d.booking); return; }
  if (d.codes) { showCodes(d.codes); return; }
  if (d.scan) { moveScan(+d.scan); return; }
  if (d.file) { const [b, i] = d.file.split(':'); showFile(b, +i); return; }
  if (d.copy) { navigator.clipboard?.writeText(d.copy).then(() => toast('Indirizzo copiato')); return; }
  if (el.id === 'simGo') { const v = document.getElementById('simAt').value; if (v) { LS.set('sim', { at: v, set: Date.now() }); state.tab = 'now'; render(); window.scrollTo(0, 0); } return; }
  if (el.id === 'resetProgress') {
    if (confirm(sync.on ? 'Azzerare spunte, tappe saltate e ritardi per tutto il gruppo?' : 'Azzerare spunte, tappe saltate e ritardi su questo telefono?')) {
      act({ t: 'reset' }); toast('Programma ripristinato');
    }
    return;
  }
  if (el.id === 'changeMe') { LS.del('me'); render(); window.scrollTo(0, 0); return; }
  if (el.id === 'logout') {
    if (confirm('Uscire? Per rientrare servirà di nuovo la password.')) { LS.del('key'); location.reload(); }
  }
});

document.addEventListener('change', e => {
  const c = e.target.dataset?.check;
  if (c !== undefined) { state.check[c] = e.target.checked; save(); }
});
document.addEventListener('toggle', e => { if (e.target.id === 'planb') state.planbOpen = e.target.open; }, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !sheetEl.hidden) closeSheet();
  if (scan && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) moveScan(e.key === 'ArrowRight' ? 1 : -1);
});

// Ogni secondo aggiorna solo l'orologio; il resto della schermata si ridisegna al cambio del minuto.
let lastMinute = null;
function tick() {
  const t = now();
  const clock = document.querySelector('.clock');
  if (clock) clock.innerHTML = `${fmt(t.min)}<span class="blink">:</span>${pad(t.sec)}`;
  const key = t.date + t.min;
  if (key !== lastMinute && sheetEl.hidden && !document.querySelector('input:focus')) { lastMinute = key; render(); }
}

function start() {
  initSync();
  render();
  refreshWeather();
  setInterval(tick, 1000);
  setInterval(refreshWeather, 15 * 60e3);
}

async function boot() {
  if ('serviceWorker' in navigator) {
    const reg = navigator.serviceWorker.register('sw.js').catch(() => null);
    // Cerca nuove versioni anche se l'app resta aperta a lungo: all'apertura, al ritorno in primo piano e ogni 5 minuti.
    const check = () => reg.then(r => r?.update()).catch(() => {});
    setInterval(() => { if (!document.hidden) check(); }, 5 * 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    // Al primo avvio il service worker prende il controllo senza che ci sia nulla da aggiornare: quel primo cambio si ignora.
    let firstClaim = !navigator.serviceWorker.controller;
    let reloading = false;
    // Con una nuova versione l'app si ricarica da sola, ma mai mentre si mostra un biglietto o si sta scrivendo.
    const reloadWhenIdle = () => {
      if (sheetEl.hidden && !document.querySelector('input:focus')) location.reload();
      else setTimeout(reloadWhenIdle, 2000);
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (firstClaim) { firstClaim = false; return; }
      if (reloading) return;
      reloading = true;
      reloadWhenIdle();
    });
  }
  fetch('version.txt', { cache: 'no-cache' }).then(r => r.text()).then(v => { window.__ver = v.trim(); }).catch(() => {});
  const raw = LS.get('key', null);
  if (raw) {
    try {
      state.key = await crypto.subtle.importKey('raw', b64(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
      state.trip = await openTrip(state.key);
      return start();
    } catch { LS.del('key'); }
  }
  renderLogin();
}

boot();
