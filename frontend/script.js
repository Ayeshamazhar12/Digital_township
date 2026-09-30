/* =========================================================
   Dandiwal Township – script.js
   Sections: 1 Config & helpers · 2 API client · 3 Auth session
             4 Static map geometry · 5 Map rendering · 6 Filters
             7 Plot detail panel · 8 Facilities · 9 Dashboard
             10 Page UI · 11 Init
   ========================================================= */
'use strict';
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const cap = s => s[0].toUpperCase() + s.slice(1);

// Your FastAPI server. Change this when the backend is deployed somewhere
// other than your own machine.
const API_BASE = 'http://127.0.0.1:8000';

/* ---------- 2. API CLIENT ---------- */
// One helper all requests go through: attaches the login token when present
// and turns a non-2xx response into a thrown Error with the server's message.
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
  return data;
}
const Api = {
  plots:        () => api('/plots'),
  facilities:   () => api('/facilities'),
  register:     body => api('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login:        body => api('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  savedPlots:   () => api('/saved-plots'),
  savePlot:     id => api(`/saved-plots/${id}`, { method: 'POST' }),
  unsavePlot:   id => api(`/saved-plots/${id}`, { method: 'DELETE' }),
  inquiries:    () => api('/inquiries'),
  requestVisit: id => api(`/inquiries/${id}`, { method: 'POST' })
}

/* ---------- 3. AUTH SESSION ---------- */
// The token + user are kept in localStorage only so a refresh doesn't log
// you out. The backend is still the only place saved plots/inquiries live.
const session = {
  token: localStorage.getItem('dw_token') || null,
  user:  JSON.parse(localStorage.getItem('dw_user') || 'null')
};
function setSession(token, user) {
  session.token = token; session.user = user;
  localStorage.setItem('dw_token', token); localStorage.setItem('dw_user', JSON.stringify(user));
}
function clearSession() {
  session.token = null; session.user = null;
  localStorage.removeItem('dw_token'); localStorage.removeItem('dw_user');
}
const isLoggedIn = () => !!session.token;

function showAuthGate() {
  $('#authGate').style.display = ''; $('#dashApp').style.display = 'none';
  $('#dashSub').textContent = 'Log in to save plots and request visits.';
}
async function showDashApp() {

  if ($('#authGate')) $('#authGate').style.display = 'none';
  if ($('#dashApp')) $('#dashApp').style.display = '';

  if ($('#dashSub')) $('#dashSub').textContent = 'Your saved plots and visit requests.';

  if ($('#dAvatar')) $('#dAvatar').textContent = session.user.name[0].toUpperCase();

  if ($('#dName')) $('#dName').textContent = session.user.name;
  if ($('#dEmail')) $('#dEmail').textContent = session.user.email;

  if ($('#pfName')) $('#pfName').textContent = session.user.name;
  if ($('#pfEmail')) $('#pfEmail').textContent = session.user.email;

  if ($('#pfPhone')) $('#pfPhone').textContent = session.user.phone || '—';

  await refreshDash();

}

async function handleLogin(e) {
  e.preventDefault();
  const msg = $('#loginMsg'); msg.textContent = '';
  try {
    const data = await Api.login({ email: $('#liEmail').value.trim(), password: $('#liPass').value });
    setSession(data.access_token, data.user);
    await showDashApp(); toast(`Welcome back, ${data.user.name.split(' ')[0]}`);
  } catch (err) { msg.textContent = err.message; }
}
async function handleRegister(e) {
  e.preventDefault();
  const msg = $('#registerMsg'); msg.textContent = '';
  try {
    await Api.register({
      name: $('#reName').value.trim(), email: $('#reEmail').value.trim(),
      phone: $('#rePhone').value.trim(), password: $('#rePass').value
    });
    const data = await Api.login({ email: $('#reEmail').value.trim(), password: $('#rePass').value });
    setSession(data.access_token, data.user);
    await showDashApp(); toast(`Account created — welcome, ${data.user.name.split(' ')[0]}`);
  } catch (err) { msg.textContent = err.message; }
}
function handleLogout() {
  clearSession(); showAuthGate(); toast('Logged out');
}

/* ---------- 4. STATIC MAP GEOMETRY ----------
   Only roads live here — they're pure decoration, not in the database.
   Plot and facility positions come from the API (see loadMapData). */
const ROADS = [
  { x: 150, y: 134, w: 640, h: 36, t: "ROAD 20' WIDE" },
  { x: 0,   y: 462, w: 790, h: 36, t: 'LINK ROAD' },
  { x: 790, y: 0,   w: 36,  h: 560, t: 'DANDIWAL ROAD', v: true },
  { x: 234, y: 170, w: 36,  h: 292, t: "ROAD 20' WIDE", v: true },
  { x: 438, y: 170, w: 36,  h: 292, t: "ROAD 20' WIDE", v: true },
  { x: 642, y: 170, w: 36,  h: 292, t: "ROAD 20' WIDE", v: true }
];
const M_PER_UNIT = 0.164; // map unit → metres (approx.), used for "nearby facilities" distance

let PLOTS = [];      // filled by loadMapData() from GET /plots
let FACILITIES = []; // filled by loadMapData() from GET /facilities
let savedIds = [];   // plot ids saved by the logged-in user (empty when logged out)
const byId = id => PLOTS.find(p => p.id === id);
const nearby = p => FACILITIES
  .map(f => ({ f, m: Math.max(10, Math.round(Math.hypot(p.cx - (f.x + f.w / 2), p.cy - (f.y + f.h / 2)) * M_PER_UNIT / 10) * 10) }))
  .sort((a, b) => a.m - b.m).slice(0, 3);

async function loadMapData() {
  const [plots, facilities] = await Promise.all([Api.plots(), Api.facilities()]);
  // Normalise the API's {map:{x,y,w,h}} shape into flat x/y/w/h/cx/cy fields
  // so every rendering function below can stay exactly as it was.
  PLOTS = plots.map(p => ({
    id: p.id, block: p.block, marla: p.marla, status: p.status,
    price: p.price_lakh, dims: p.dimensions, sqft: p.sqft,
    x: p.map.x, y: p.map.y, w: p.map.w, h: p.map.h,
    cx: p.map.x + p.map.w / 2, cy: p.map.y + p.map.h / 2
  }));
  FACILITIES = facilities.map(f => ({
    id: f.id, name: f.name, icon: f.icon, type: f.type, desc: f.description,
    x: f.map.x, y: f.map.y, w: f.map.w, h: f.map.h
  }));
}

/* ---------- 5. MAP RENDERING (SVG) ---------- */
let zoom = 1;
function renderMap() {
  let s = '<rect width="1000" height="560" fill="#e9efe3"/>';
  s += '<rect x="840" y="20" width="145" height="520" rx="10" fill="#d9cbb0"/><text x="912" y="280" transform="rotate(-90 912 280)" class="rl" style="fill:#7a6a4a">EXISTING ABADI</text>';
  ROADS.forEach(r => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    s += `<rect class="road" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>` +
         `<text class="rl" x="${cx}" y="${cy}" ${r.v ? `transform="rotate(-90 ${cx} ${cy})"` : ''}>${r.t}</text>`;
  });
  FACILITIES.forEach(f => {
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2, big = f.h > 40;
    s += `<g class="fac ${f.type}"><title>${f.name}</title><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8"/>` +
         `<text class="ficon" x="${cx}" y="${big ? cy - 7 : cy}">${f.icon}</text>${big ? `<text class="flbl" x="${cx}" y="${cy + 13}">${f.name}</text>` : ''}</g>`;
  });
  PLOTS.forEach(p => {
    s += `<g class="plot ${p.status}" data-id="${p.id}"><title>Plot ${p.id} · ${p.marla} Marla · PKR ${p.price} Lakh · ${cap(p.status)}</title>` +
         `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3"/>` +
         `<text class="pid" x="${p.cx}" y="${p.cy - 6}">${p.id}</text><text class="psz" x="${p.cx}" y="${p.cy + 10}">${p.marla} Marla</text></g>`;
  });
  $('#mapSvg').innerHTML = s;
  $('#mapSvg').addEventListener('click', e => {
    const g = e.target.closest('.plot'); if (g) showPlot(+g.dataset.id);
  });
}
function setZoom(dir) {
  zoom = dir === 0 ? 1 : Math.min(2.4, Math.max(1, zoom + dir * 0.4));
  $('#mapSvg').style.width = zoom * 100 + '%';
}

/* ---------- 6. FILTERS ----------
   Filtering stays client-side since the whole map is only 41 plots — fetched
   once, then filtered instantly with no extra request. The backend's
   GET /plots already accepts status/marla/block/max_price query params if
   this ever needs to move server-side for a much larger dataset. */
function setupFilters() {
  const prices = PLOTS.map(p => p.price), r = $('#fPrice');
  r.min = Math.floor(Math.min(...prices)); r.max = Math.ceil(Math.max(...prices)); r.value = r.max;
  ['fSearch', 'fStatus', 'fSize', 'fBlock', 'fPrice'].forEach(id => $('#' + id).addEventListener('input', applyFilters));
  $('#fReset').addEventListener('click', () => {
    $('#fSearch').value = ''; ['fStatus', 'fSize', 'fBlock'].forEach(id => $('#' + id).value = 'all'); r.value = r.max; applyFilters();
  });
  applyFilters();
}
function applyFilters() {
  const q = $('#fSearch').value.trim(), st = $('#fStatus').value, sz = $('#fSize').value, bl = $('#fBlock').value, mx = +$('#fPrice').value;
  $('#fPriceVal').textContent = 'PKR ' + mx + ' L';
  let n = 0;
  PLOTS.forEach(p => {
    const ok = (!q || p.id === +q) && (st === 'all' || p.status === st) && (sz === 'all' || p.marla === +sz) &&
               (bl === 'all' || p.block === bl) && p.price <= mx;
    $(`.plot[data-id="${p.id}"]`).classList.toggle('dim', !ok);
    if (ok) n++;
  });
  $('#fCount').textContent = `${n} of ${PLOTS.length} plots match`;
}

/* ---------- 7. PLOT DETAIL PANEL ---------- */
let selectedId = null;
function showPlot(id) {
  const p = byId(id); selectedId = id;
  $$('.plot').forEach(g => g.classList.toggle('sel', +g.dataset.id === id));
  const near = nearby(p).map(n => `<li><span>${n.f.icon} ${n.f.name}</span><b>~${n.m} m</b></li>`).join('');
  $('#panel').innerHTML = `
    <div class="ph"><h3>Plot #${p.id}</h3><span class="badge ${p.status}">${p.status}</span></div>
    <div class="price">PKR ${p.price} <small>Lakh · sample price</small></div>
    <dl class="specs">
      <div><dt>Size</dt><dd>${p.marla} Marla</dd></div><div><dt>Dimensions</dt><dd>${p.dims}</dd></div>
      <div><dt>Area</dt><dd>${p.sqft} sq ft</dd></div><div><dt>Block</dt><dd>Block ${p.block}</dd></div>
    </dl>
    <h5>Nearby facilities</h5><ul class="near">${near}</ul>
    <div class="pbtn">
      <button class="btn btn-green" data-act="save">${savedIds.includes(id) ? '★ Saved' : '☆ Save plot'}</button>
      <button class="btn btn-gold" data-act="visit" ${p.status === 'sold' ? 'disabled' : ''}>Request visit</button>
    </div>`;
}
async function toggleSave(id) {
  if (!isLoggedIn()) { toast('Log in to save plots'); location.hash = '#dashboard'; return; }

  try {
    if (savedIds.includes(id)) {
      await Api.unsavePlot(id);
      savedIds = savedIds.filter(savedId => savedId !== id);
      toast(`Plot #${id} removed from saved`);
    } else {
      await Api.savePlot(id);
      if (!savedIds.includes(id)) savedIds.push(id);
      toast(`Plot #${id} saved to your dashboard`);
    }

    showPlot(id);

    refreshDash().catch(err => {
      console.error('Dashboard refresh failed:', err);
    });

  } catch (err) {
    toast(err.message);
    if (selectedId === id) showPlot(id);
  }
}
async function requestVisit(id) {
  if (!isLoggedIn()) { toast('Log in to request a visit'); location.hash = '#dashboard'; return; }

  try {
    await Api.requestVisit(id);

    showPlot(id);

    toast(`Visit requested for plot #${id}`);

    refreshDash().catch(err => {
      console.error('Dashboard refresh failed:', err);
    });

  } catch (err) {
    toast(err.message);
    if (selectedId === id) showPlot(id);
  }
}
$('#panel').addEventListener('click', e => {
  const a = e.target.dataset.act;
  if (a === 'save') toggleSave(selectedId);
  if (a === 'visit') requestVisit(selectedId);
});

/* ---------- 8. FACILITIES SECTION ---------- */
function renderFacilities() {
  $('#fGrid').innerHTML = FACILITIES.map(f =>
    `<div class="card rv in"><span>${f.icon}</span><h3>${f.name}</h3><p>${f.desc}</p></div>`).join('');
}

/* ---------- 9. USER DASHBOARD ---------- */
async function refreshDash() {
  if (!isLoggedIn()) return;
  const [saved, inq] = await Promise.all([Api.savedPlots(), Api.inquiries()]);
  savedIds = saved.map(p => p.id);
  const sp = saved.map(p => ({ ...p, price: p.price_lakh })); // reuse the `price` field name used elsewhere

  const cards = [
  [sp.length, 'Saved plots'],
  [inq.length, 'Visit requests'],
  [PLOTS.filter(p => p.status === 'available').length, 'Available plots'],
  ['PKR', sp.reduce((a, p) => a + p.price, 0).toFixed(1) + ' L', 'Saved value']
];
  $('#dCards').innerHTML = cards.map(c => `<div class="card"><span>${c[0]}</span><b>${c[1]}</b><small>${c[2]}</small></div>`).join('');
  $('#dActivity').innerHTML = inq.slice(0, 5).map(q =>
    `<li> Visit requested for plot #${q.plot_id} <span class="grow">${new Date(q.requested_at).toLocaleDateString('en-GB')}</span></li>`).join('')
    || '<li class="none">No activity yet. Save a plot or request a visit from the map.</li>';

  $('#dSaved').innerHTML = sp.map(p => `<div class="row"><b>Plot #${p.id}</b><span class="grow">${p.marla} Marla · Block ${p.block} · PKR ${p.price} L</span>` +
    `<span class="badge ${p.status}">${p.status}</span><button class="btn btn-outline" data-go="${p.id}">View</button><button class="btn btn-outline" data-rm="${p.id}">Remove</button></div>`).join('')
    || '<p class="none">No saved plots yet.</p>';

  $('#dInq').innerHTML = inq.map(q => `<div class="row"><b>Plot #${q.plot_id}</b><span class="grow">Requested on ${new Date(q.requested_at).toLocaleDateString('en-GB')}</span><span class="badge reserved">${cap(q.status)}</span></div>`).join('')
    || '<p class="none">No visit requests yet.</p>';
}
$('#dashboard').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.tab) {
    $$('.tab[data-tab]').forEach(b => b.classList.toggle('active', b === t));
    $$('.dpane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + t.dataset.tab));
  }
  if (t.dataset.rm) toggleSave(+t.dataset.rm);
  if (t.dataset.go) { location.hash = '#map'; showPlot(+t.dataset.go); }
  if (t.id === 'logoutBtn') handleLogout();
  if (t.dataset.auth) {
    $$('.atab').forEach(b => b.classList.toggle('active', b === t));
    $('#loginForm').style.display = t.dataset.auth === 'login' ? '' : 'none';
    $('#registerForm').style.display = t.dataset.auth === 'register' ? '' : 'none';
  }
});
if ($('#loginForm')) $('#loginForm').addEventListener('submit', handleLogin);

if ($('#registerForm')) $('#registerForm').addEventListener('submit', handleRegister);

/* ---------- 10. PAGE UI (menu, toast, counters, reveal) ---------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
function countUp(el, to) {
  let n = 0; const step = Math.max(1, Math.ceil(to / 30));
  const t = setInterval(() => { n = Math.min(to, n + step); el.textContent = n; if (n >= to) clearInterval(t); }, 30);
}
function setupPageUI() {
  $('#burger').addEventListener('click', () => $('#menu').classList.toggle('open'));
  $$('#menu a').forEach(a => a.addEventListener('click', () => $('#menu').classList.remove('open')));
  $$('.zoom button').forEach(b => b.addEventListener('click', () => setZoom(+b.dataset.z)));
  $('#cForm').addEventListener('submit', e => { e.preventDefault(); e.target.reset(); toast('Inquiry sent. We will contact you soon.'); });
  countUp($('[data-stat="total"]'), PLOTS.length);
  countUp($('[data-stat="available"]'), PLOTS.filter(p => p.status === 'available').length);
  const io = new IntersectionObserver(es => es.forEach(x => x.isIntersecting && x.target.classList.add('in')), { threshold: .15 });
  $$('.rv').forEach(el => io.observe(el));
}

/* ---------- 11. INIT ---------- */
(async function init() {
  try {
    await loadMapData();
  } catch (err) {
    $('#mapSvg').outerHTML = `<p style="padding:24px">Could not reach the API at ${API_BASE}. Is the FastAPI server running? (${err.message})</p>`;
    setupPageUI();
    return;
  }
  renderMap();
  setupFilters();
  renderFacilities();
  setupPageUI();
  if (isLoggedIn()) await showDashApp(); else showAuthGate();
})();
