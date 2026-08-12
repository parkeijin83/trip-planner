/* ---------- storage ---------- */
const STORE_KEY = 'tp_data_v1';

function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error(e); }
  return { trips: [], activeTripId: null, geocache: {} };
}
function saveData() { localStorage.setItem(STORE_KEY, JSON.stringify(DATA)); }

let DATA = loadData();
if (!DATA.geocache) DATA.geocache = {};

/* ---------- state ---------- */
let selectedDay = null;      // "YYYY-MM-DD"
let editingEventId = null;   // null = new
let editingFlightId = null;  // null = new
let pendingAttachments = [];
let map = null, markersLayer = null, routeLines = [], walkerMarker = null, walkerAnim = null;
let routePoints = [];
let routeStepIndex = -1;
let dayUnresolvedCount = 0;
let lastRenderedStepIndex = null;
const firedAlarms = new Set();

/* ---------- utils ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const TYPE_ICON = { '항공': '✈️', '숙소': '🏨', '식당': '🍽️', '카페': '☕', '명소': '📍', '이동': '🚇', '쇼핑': '🛍️', '기타': '📝' };
const MOVE_ICON = { '도보': '🚶', '지하철': '🚇', '버스': '🚌', '트램': '🚋', '기차': '🚆', '택시': '🚕', '항공': '✈️', '자전거': '🚲' };

function setupIconGrid(gridId, { clearable = true } = {}) {
  document.querySelectorAll(`#${gridId} .icon-opt`).forEach(btn => {
    btn.addEventListener('click', () => {
      const grid = btn.parentElement;
      if (clearable && btn.classList.contains('selected')) {
        btn.classList.remove('selected');
        return;
      }
      grid.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}
function getIconGridValue(gridId) {
  return document.querySelector(`#${gridId} .icon-opt.selected`)?.dataset.value || '';
}
function setIconGridValue(gridId, value) {
  document.querySelectorAll(`#${gridId} .icon-opt`).forEach(b => b.classList.toggle('selected', b.dataset.value === value));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
const SEOUL = [37.5665, 126.9780];

function populateTimeSelect(hSel, mSel) {
  hSel.innerHTML = '<option value="">--</option>' + Array.from({ length: 24 }, (_, h) => `<option value="${pad(h)}">${pad(h)}</option>`).join('');
  mSel.innerHTML = '<option value="">--</option>' + Array.from({ length: 12 }, (_, i) => pad(i * 5)).map(m => `<option value="${m}">${m}</option>`).join('');
}
function setTimeSelectValue(hSel, mSel, timeStr) {
  const [h, m] = (timeStr || '').split(':');
  hSel.value = h || '';
  mSel.value = m || '';
}
function getTimeSelectValue(hSel, mSel) {
  if (hSel.value === '' || mSel.value === '') return '';
  return `${hSel.value}:${mSel.value}`;
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayCount(trip) {
  const a = new Date(trip.startDate + 'T00:00:00');
  const b = new Date(trip.endDate + 'T00:00:00');
  return Math.round((b - a) / 86400000) + 1;
}
function dayList(trip) {
  const n = dayCount(trip);
  const cities = (trip.cities && trip.cities.length) ? trip.cities : [];
  const list = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(trip.startDate, i);
    const dow = DOW[new Date(date + 'T00:00:00').getDay()];
    let city = '';
    if (cities.length === 1) city = cities[0];
    else if (cities.length > 1) city = cities[Math.min(i, cities.length - 1)];
    list.push({ date, dow, city });
  }
  return list;
}
function fmtMD(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
function fmtTripDates(trip) {
  const n = dayCount(trip);
  const nights = n - 1;
  return `${fmtMD(trip.startDate)} – ${fmtMD(trip.endDate)} · ${nights}박 ${n}일`;
}

function getActiveTrip() {
  return DATA.trips.find(t => t.id === DATA.activeTripId) || null;
}

/* ---------- trip management ---------- */
function renderTripSelect() {
  const sel = $('tripSelect');
  sel.innerHTML = '';
  if (!DATA.trips.length) {
    const opt = document.createElement('option');
    opt.textContent = '여행 없음 · ＋ 눌러 만들기';
    sel.appendChild(opt);
    return;
  }
  DATA.trips.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.title;
    if (t.id === DATA.activeTripId) opt.selected = true;
    sel.appendChild(opt);
  });
}
$('tripSelect').addEventListener('change', (e) => {
  DATA.activeTripId = e.target.value;
  saveData();
  onTripChanged();
});

$('btnNewTrip').addEventListener('click', () => {
  $('tName').value = '';
  $('tStart').value = '';
  $('tEnd').value = '';
  $('tNote').value = '';
  $('tCities').value = '';
  openModal('tripModal');
});

$('btnSaveTrip').addEventListener('click', () => {
  const title = $('tName').value.trim();
  const start = $('tStart').value;
  const end = $('tEnd').value;
  if (!title || !start || !end) { toast('제목과 날짜를 입력해주세요'); return; }
  if (end < start) { toast('종료일이 시작일보다 빠를 수 없어요'); return; }
  const trip = {
    id: uid(),
    title,
    subtitle: $('tNote').value.trim(),
    startDate: start,
    endDate: end,
    cities: $('tCities').value.split(',').map(s => s.trim()).filter(Boolean),
    headerPhoto: null,
    ended: false,
    flights: [],
    days: {}
  };
  DATA.trips.push(trip);
  DATA.activeTripId = trip.id;
  saveData();
  closeModal('tripModal');
  onTripChanged();
  toast('여행이 생성되었어요');
});

$('btnToggleEnded').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  trip.ended = !trip.ended;
  saveData();
  renderHeader();
});

/* ---------- header ---------- */
function renderHeader() {
  const trip = getActiveTrip();
  const header = $('tripHeader');
  if (!trip) {
    $('tripTitle').textContent = '여행을 선택하거나 새로 만들어보세요';
    $('tripDates').textContent = '';
    header.style.backgroundImage = '';
    return;
  }
  $('tripTitle').textContent = trip.title;
  $('tripDates').textContent = fmtTripDates(trip) + (trip.subtitle ? ' · ' + trip.subtitle : '');
  const btn = $('btnToggleEnded');
  btn.textContent = trip.ended ? '🏁 여행 종료' : '✈️ 여행 중';
  btn.classList.toggle('ended', trip.ended);
  if (trip.headerPhoto) {
    header.style.backgroundImage = `linear-gradient(rgba(20,20,30,.35),rgba(20,20,30,.35)), url(${trip.headerPhoto})`;
    header.style.backgroundSize = 'cover';
    header.style.backgroundPosition = 'center';
  } else {
    header.style.backgroundImage = '';
  }
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'overview') {
      setTimeout(() => { if (map) map.invalidateSize(); renderMapForSelectedDay(); }, 50);
    }
  });
});

/* ---------- flights ---------- */
function renderFlights() {
  const trip = getActiveTrip();
  const list = $('flightList');
  list.innerHTML = '';
  if (!trip || !trip.flights.length) {
    list.innerHTML = '<p class="empty-note">등록된 항공편이 없어요</p>';
    return;
  }
  trip.flights.slice().sort((a, b) => (a.dep || '').localeCompare(b.dep || '')).forEach(fl => {
    const div = document.createElement('div');
    div.className = 'flight-card';
    div.innerHTML = `
      <div class="flight-tag">${escapeHtml(fl.tag || '항공편')} ${fl.no ? '· ' + escapeHtml(fl.no) : ''}</div>
      <div class="flight-route">
        <span>${escapeHtml(fl.fromCode || '?')}</span><span>✈️</span><span>${escapeHtml(fl.toCode || '?')}</span>
      </div>
      <div class="flight-meta">${escapeHtml(fl.fromCity || '')} ${fmtDT(fl.dep)} → ${escapeHtml(fl.toCity || '')} ${fmtDT(fl.arr)}</div>
      ${fl.note ? `<div class="flight-meta">📌 ${escapeHtml(fl.note)}</div>` : ''}
    `;
    div.addEventListener('click', () => openFlightModal(fl.id));
    list.appendChild(div);
  });
}
function fmtDT(v) {
  if (!v) return '';
  const [d, t] = v.split('T');
  if (!d) return v;
  return fmtMD(d) + ' ' + (t || '');
}

$('btnAddFlight').addEventListener('click', () => openFlightModal(null));

function splitDateTime(v) {
  if (!v) return { date: '', h: '', m: '' };
  const [date, time] = v.split('T');
  const [h, m] = (time || '').split(':');
  return { date: date || '', h: h || '', m: m || '' };
}
['flFromCode', 'flToCode'].forEach(id => {
  $(id).addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  });
});

/* ---------- ticket auto-fill (PDF / image) ---------- */
const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}
async function extractPdfText(file) {
  await loadScript('https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}
async function extractImageText(file) {
  await loadScript('https://unpkg.com/tesseract.js@5/dist/tesseract.min.js');
  const { data } = await Tesseract.recognize(file, 'eng');
  return data.text;
}
const MONTH_MAP = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const CODE_BLACKLIST = new Set(['PDF', 'USD', 'KRW', 'EUR', 'GMT', 'UTC', 'ETK', 'ETC', 'AM', 'PM', 'THE', 'AND', 'FOR', 'KEY', 'SSR', 'SEQ', 'REF', 'PNR', 'ADT', 'CHD', 'INF', 'NBR', 'NO1']);
function normalizeDate(y, m, d) {
  y = parseInt(y, 10); if (y < 100) y += 2000;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function roundTo5(t) {
  const [h, m] = t.split(':').map(Number);
  let total = ((h * 60 + Math.round(m / 5) * 5) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
function extractDates(upper) {
  const dates = [];
  let m;
  const isoRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = isoRe.exec(upper))) dates.push(normalizeDate(m[1], m[2], m[3]));
  const dmyRe = /\b(\d{1,2})\s*[-/ ]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[-/ ']?\s*(\d{2,4})\b/g;
  while ((m = dmyRe.exec(upper))) dates.push(normalizeDate(m[3], MONTH_MAP[m[2]], m[1]));
  return dates;
}
function extractTimes(text) {
  const times = [];
  let m;
  const re24 = /\b([01]\d|2[0-3]):([0-5]\d)\b/g;
  while ((m = re24.exec(text))) times.push(`${m[1]}:${m[2]}`);
  return times;
}
function extractFlightNo(upper) {
  const m = upper.match(/\b([A-Z]{2})[\s-]?(\d{2,4})\b/);
  return m ? `${m[1]}${m[2]}` : '';
}
function extractAirportCodes(upper) {
  const pair = upper.match(/\b([A-Z]{3})\s*(?:-|–|—|→|>|TO)\s*([A-Z]{3})\b/);
  if (pair) return [pair[1], pair[2]];
  const all = [...upper.matchAll(/\b([A-Z]{3})\b/g)].map(x => x[1]).filter(c => !CODE_BLACKLIST.has(c));
  const uniq = [...new Set(all)];
  return [uniq[0] || '', uniq[1] || ''];
}
function parseTicketText(text) {
  const upper = text.toUpperCase();
  const dates = extractDates(upper);
  const times = extractTimes(text);
  const [fromCode, toCode] = extractAirportCodes(upper);
  return {
    flNo: extractFlightNo(upper),
    fromCode, toCode,
    depDate: dates[0] || '',
    arrDate: dates[1] || dates[0] || '',
    depTime: times[0] || '',
    arrTime: times[1] || ''
  };
}
$('flAutoFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  toast('티켓 인식 중... 잠시만요');
  try {
    const text = f.type === 'application/pdf' ? await extractPdfText(f) : await extractImageText(f);
    const info = parseTicketText(text);
    const filled = [];
    if (info.flNo) { $('flNo').value = info.flNo; filled.push('편명'); }
    if (info.fromCode) { $('flFromCode').value = info.fromCode; filled.push('출발코드'); }
    if (info.toCode) { $('flToCode').value = info.toCode; filled.push('도착코드'); }
    if (info.depDate) { $('flDepDate').value = info.depDate; filled.push('출발일'); }
    if (info.depTime) { setTimeSelectValue($('flDepH'), $('flDepM'), roundTo5(info.depTime)); filled.push('출발시간'); }
    if (info.arrDate) { $('flArrDate').value = info.arrDate; }
    if (info.arrTime) { setTimeSelectValue($('flArrH'), $('flArrM'), roundTo5(info.arrTime)); filled.push('도착시간'); }
    toast(filled.length ? `인식됨: ${filled.join(', ')} · 확인 후 저장하세요` : '인식하지 못했어요, 직접 입력해주세요');
  } catch (err) {
    console.error('ticket parse failed', err);
    toast('인식 중 오류가 발생했어요');
  }
  e.target.value = '';
});

function openFlightModal(id) {
  const trip = getActiveTrip();
  if (!trip) { toast('먼저 여행을 만들어주세요'); return; }
  editingFlightId = id;
  const fl = id ? trip.flights.find(f => f.id === id) : null;
  $('flAutoFile').value = '';
  $('flTag').value = fl?.tag || '출발';
  $('flNo').value = fl?.no || '';
  $('flFromCode').value = fl?.fromCode || '';
  $('flToCode').value = fl?.toCode || (id ? '' : 'ICN');
  $('flFromCity').value = fl?.fromCity || '';
  $('flToCity').value = fl?.toCity || '';
  const dep = splitDateTime(fl?.dep);
  $('flDepDate').value = dep.date;
  $('flDepH').value = dep.h;
  $('flDepM').value = dep.m;
  const arr = splitDateTime(fl?.arr);
  $('flArrDate').value = arr.date;
  $('flArrH').value = arr.h;
  $('flArrM').value = arr.m;
  $('flNote').value = fl?.note || '';
  $('btnDeleteFlight').style.display = id ? '' : 'none';
  openModal('flightModal');
}
$('btnSaveFlight').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  const depDate = $('flDepDate').value;
  const depTime = getTimeSelectValue($('flDepH'), $('flDepM'));
  const arrDate = $('flArrDate').value;
  const arrTime = getTimeSelectValue($('flArrH'), $('flArrM'));
  const data = {
    tag: $('flTag').value,
    no: $('flNo').value.trim(),
    fromCode: $('flFromCode').value.trim().toUpperCase(),
    toCode: $('flToCode').value.trim().toUpperCase(),
    fromCity: $('flFromCity').value.trim(),
    toCity: $('flToCity').value.trim(),
    dep: (depDate && depTime) ? `${depDate}T${depTime}` : '',
    arr: (arrDate && arrTime) ? `${arrDate}T${arrTime}` : '',
    note: $('flNote').value.trim()
  };
  if (!data.dep) { toast('출발 날짜·시간을 모두 선택해주세요'); return; }
  if (editingFlightId) {
    Object.assign(trip.flights.find(f => f.id === editingFlightId), data);
  } else {
    trip.flights.push({ id: uid(), ...data });
  }
  saveData();
  closeModal('flightModal');
  renderFlights();
});
$('btnDeleteFlight').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip || !editingFlightId) return;
  trip.flights = trip.flights.filter(f => f.id !== editingFlightId);
  saveData();
  closeModal('flightModal');
  renderFlights();
});

/* ---------- documents (aggregated attachments) ---------- */
function renderDocs() {
  const trip = getActiveTrip();
  const list = $('docList');
  list.innerHTML = '';
  if (!trip) { list.innerHTML = '<p class="empty-note">여행을 먼저 만들어주세요</p>'; return; }
  const docs = [];
  Object.keys(trip.days).forEach(date => {
    trip.days[date].forEach(ev => {
      (ev.attachments || []).forEach(a => docs.push({ ...a, date, evName: ev.name }));
    });
  });
  if (!docs.length) { list.innerHTML = '<p class="empty-note">아직 첨부된 서류가 없어요</p>'; return; }
  docs.forEach(d => {
    const a = document.createElement('a');
    a.className = 'doc-item';
    a.href = d.dataUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<span>${d.name && d.name.toLowerCase().includes('.pdf') ? '📄' : '🖼️'}</span>
      <span class="doc-name">${escapeHtml(d.name)} <span class="hint">· ${fmtMD(d.date)} ${escapeHtml(d.evName || '')}</span></span>
      <span class="doc-open">열기 ›</span>`;
    list.appendChild(a);
  });
}

/* ---------- day tabs + schedule ---------- */
function ensureSelectedDay(trip) {
  const days = dayList(trip);
  if (!days.length) { selectedDay = null; return; }
  const t = todayStr();
  if (days.some(d => d.date === selectedDay)) return;
  const inRange = days.find(d => d.date === t);
  selectedDay = inRange ? inRange.date : days[0].date;
}

function renderDayTabs() {
  const trip = getActiveTrip();
  const wraps = [$('dayTabs'), $('dayTabsOverview')];
  wraps.forEach(w => w.innerHTML = '');
  if (!trip) return;
  const days = dayList(trip);
  wraps.forEach(wrap => {
    days.forEach(d => {
      const el = document.createElement('div');
      el.className = 'day-tab' + (d.date === selectedDay ? ' active' : '');
      el.innerHTML = `<div class="dow">${d.dow}</div><div class="dnum">${fmtMD(d.date)}</div>${d.city ? `<div class="dcity">${escapeHtml(d.city)}</div>` : ''}`;
      el.addEventListener('click', () => {
        selectedDay = d.date;
        renderDayTabs();
        renderEvents();
        if ($('tab-overview').classList.contains('active')) renderMapForSelectedDay();
      });
      wrap.appendChild(el);
    });
  });
}

function currencyTotals(events) {
  const totals = {};
  events.forEach(ev => {
    if (ev.amount) {
      const cur = ev.currency || '원';
      totals[cur] = (totals[cur] || 0) + Number(ev.amount);
    }
  });
  return totals;
}

function renderEvents() {
  const trip = getActiveTrip();
  const list = $('eventList');
  list.innerHTML = '';
  if (!trip || !selectedDay) {
    $('dayTotal').textContent = '';
    return;
  }
  const events = (trip.days[selectedDay] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const totals = currencyTotals(events);
  const totalStr = Object.keys(totals).map(cur => `${totals[cur].toLocaleString()}${cur}`).join(' · ');
  $('dayTotal').innerHTML = totalStr ? `오늘 지출 합계 <b>${totalStr}</b>` : '';

  if (!events.length) {
    list.innerHTML = '<p class="empty-note">이 날은 아직 일정이 없어요</p>';
    return;
  }
  events.forEach(ev => {
    const div = document.createElement('div');
    div.className = 'event-card';
    div.innerHTML = `
      <div class="event-top">
        <span class="event-time">${ev.time ? escapeHtml(ev.time) : '--:--'}</span>
        <span class="event-type">${TYPE_ICON[ev.type] || '📝'} ${escapeHtml(ev.type)}${ev.move ? ' · ' + (MOVE_ICON[ev.move] || '🚶') + ' ' + escapeHtml(ev.move) : ''}${ev.alarm ? ' · 🔔 ' + escapeHtml(ev.alarm) : ''}</span>
      </div>
      <div class="event-name">${escapeHtml(ev.name)}</div>
      ${ev.note ? `<div class="event-note">${escapeHtml(ev.note)}</div>` : ''}
      ${ev.amount ? `<div class="event-amount">💰 ${Number(ev.amount).toLocaleString()}${escapeHtml(ev.currency || '원')}</div>` : ''}
      ${(ev.attachments && ev.attachments.length) ? `<div class="event-attach">${ev.attachments.map(a => `<a class="attach-chip" target="_blank" rel="noopener" href="${a.dataUrl}">📎 ${escapeHtml(a.name)}</a>`).join('')}</div>` : ''}
      <div class="event-actions">
        <button class="goto">🧭 길찾기</button>
        <button class="map">📍 지도보기</button>
        <button class="cal">📅 캘린더</button>
        <button class="edit">✏️ 편집</button>
        <button class="del">🗑 삭제</button>
      </div>
    `;
    div.querySelector('.goto').addEventListener('click', () => openDirections(ev));
    div.querySelector('.map').addEventListener('click', () => focusEventOnMap(ev));
    div.querySelector('.cal').addEventListener('click', () => downloadIcsForEvent(ev));
    div.querySelector('.edit').addEventListener('click', () => openEventModal(ev.id));
    div.querySelector('.del').addEventListener('click', () => deleteEvent(ev.id));
    list.appendChild(div);
  });
}

function openDirections(ev) {
  if (ev.mapUrl) { window.open(ev.mapUrl, '_blank'); return; }
  const q = ev.place || ev.name;
  window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), '_blank');
}

function deleteEvent(id) {
  const trip = getActiveTrip();
  if (!trip || !selectedDay) return;
  if (!confirm('이 일정을 삭제할까요?')) return;
  trip.days[selectedDay] = (trip.days[selectedDay] || []).filter(e => e.id !== id);
  saveData();
  renderEvents();
  renderDocs();
}

$('btnAddEvent').addEventListener('click', () => {
  if (!getActiveTrip()) { toast('먼저 여행을 만들어주세요'); return; }
  if (!selectedDay) { toast('날짜를 선택해주세요'); return; }
  openEventModal(null);
});

function openEventModal(id) {
  const trip = getActiveTrip();
  editingEventId = id;
  const ev = id ? (trip.days[selectedDay] || []).find(e => e.id === id) : null;
  $('eventModalTitle').textContent = id ? '일정 편집' : '일정 추가';
  setIconGridValue('fTypeGrid', ev?.type || '기타');
  setTimeSelectValue($('fTimeH'), $('fTimeM'), ev?.time || '');
  const dateSel = $('fDate');
  dateSel.innerHTML = '';
  dayList(trip).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.date;
    opt.textContent = `${fmtMD(d.date)} (${d.dow})${d.city ? ' · ' + d.city : ''}`;
    if (d.date === selectedDay) opt.selected = true;
    dateSel.appendChild(opt);
  });
  $('fName').value = ev?.name || '';
  $('fPlace').value = ev?.place || '';
  $('fMapUrl').value = ev?.mapUrl || '';
  setIconGridValue('fMoveGrid', ev?.move || '');
  $('fAmount').value = ev?.amount ?? '';
  $('fCurrency').value = ev?.currency || '원';
  setTimeSelectValue($('fAlarmH'), $('fAlarmM'), ev?.alarm || '');
  $('fNote').value = ev?.note || '';
  pendingAttachments = ev?.attachments ? ev.attachments.slice() : [];
  renderAttachPreview();
  $('attachInput').value = '';
  $('btnDeleteEvent').style.display = id ? '' : 'none';
  openModal('eventModal');
}

function renderAttachPreview() {
  const wrap = $('attachPreview');
  wrap.innerHTML = '';
  pendingAttachments.forEach(a => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `📎 ${escapeHtml(a.name)} <button type="button">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      pendingAttachments = pendingAttachments.filter(x => x.id !== a.id);
      renderAttachPreview();
    });
    wrap.appendChild(chip);
  });
}

$('attachInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (f.size > 4 * 1024 * 1024) { toast(`${f.name}이(가) 너무 커요 (4MB 이하 권장)`); continue; }
    const dataUrl = await fileToDataUrl(f);
    pendingAttachments.push({ id: uid(), name: f.name, dataUrl });
  }
  renderAttachPreview();
});
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

$('btnClearAlarm').addEventListener('click', () => { $('fAlarmH').value = ''; $('fAlarmM').value = ''; });

$('btnSaveEvent').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip || !selectedDay) return;
  const name = $('fName').value.trim();
  if (!name) { toast('이름을 입력해주세요'); return; }
  const targetDate = $('fDate').value || selectedDay;
  const data = {
    type: getIconGridValue('fTypeGrid') || '기타',
    time: getTimeSelectValue($('fTimeH'), $('fTimeM')),
    name,
    place: $('fPlace').value.trim(),
    mapUrl: $('fMapUrl').value.trim(),
    move: getIconGridValue('fMoveGrid'),
    amount: $('fAmount').value ? Number($('fAmount').value) : null,
    currency: $('fCurrency').value,
    alarm: getTimeSelectValue($('fAlarmH'), $('fAlarmM')) || null,
    note: $('fNote').value.trim(),
    attachments: pendingAttachments
  };
  if (!trip.days[targetDate]) trip.days[targetDate] = [];
  if (editingEventId) {
    if (targetDate !== selectedDay) {
      trip.days[selectedDay] = trip.days[selectedDay].filter(e => e.id !== editingEventId);
      trip.days[targetDate].push({ id: editingEventId, ...data });
      selectedDay = targetDate;
    } else {
      Object.assign(trip.days[selectedDay].find(e => e.id === editingEventId), data);
    }
  } else {
    trip.days[targetDate].push({ id: uid(), ...data });
    selectedDay = targetDate;
  }
  saveData();
  closeModal('eventModal');
  renderDayTabs();
  renderEvents();
  renderDocs();
});
$('btnDeleteEvent').addEventListener('click', () => {
  if (!editingEventId) return;
  closeModal('eventModal');
  deleteEvent(editingEventId);
});

/* ---------- modals ---------- */
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
});

/* ---------- settings ---------- */
$('btnSettings').addEventListener('click', () => {
  const trip = getActiveTrip();
  $('sTitle').value = trip ? trip.title : '';
  $('sCities').value = trip ? trip.cities.join(', ') : '';
  openModal('settingsModal');
});
$('btnSaveTitle').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  const v = $('sTitle').value.trim();
  if (!v) return;
  trip.title = v;
  saveData();
  renderHeader();
  renderTripSelect();
  toast('제목이 저장되었어요');
});
$('btnSaveCities').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  trip.cities = $('sCities').value.split(',').map(s => s.trim()).filter(Boolean);
  saveData();
  renderDayTabs();
  if ($('tab-overview').classList.contains('active')) renderMapForSelectedDay();
  toast('도시가 저장되었어요');
});
$('sHeaderPhoto').addEventListener('change', async (e) => {
  const trip = getActiveTrip();
  const f = e.target.files[0];
  if (!trip || !f) return;
  trip.headerPhoto = await fileToDataUrl(f);
  saveData();
  renderHeader();
});
$('btnResetPhoto').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  trip.headerPhoto = null;
  saveData();
  renderHeader();
});
$('btnNotifPerm').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요'); return; }
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? '알림이 허용되었어요' : '알림이 거부되었어요');
});
$('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trip-planner-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('btnImport').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const parsed = JSON.parse(r.result);
      if (!parsed.trips) throw new Error('invalid');
      DATA = parsed;
      if (!DATA.geocache) DATA.geocache = {};
      saveData();
      onTripChanged();
      closeModal('settingsModal');
      toast('불러오기 완료');
    } catch (err) {
      toast('파일을 읽을 수 없어요');
    }
  };
  r.readAsText(f);
});
$('btnResetAll').addEventListener('click', () => {
  if (!confirm('정말 모든 데이터를 삭제할까요? 되돌릴 수 없어요.')) return;
  DATA = { trips: [], activeTripId: null, geocache: {} };
  saveData();
  onTripChanged();
  closeModal('settingsModal');
});

/* ---------- ICS export ---------- */
function icsDT(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-');
  const [hh, mm] = (timeStr || '00:00').split(':');
  return `${y}${m}${d}T${pad(hh)}${pad(mm)}00`;
}
function icsEscape(s) { return String(s || '').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n'); }
function buildIcsEvent(date, ev) {
  const dtStart = icsDT(date, ev.time || '09:00');
  return [
    'BEGIN:VEVENT',
    `UID:${ev.id}@trip-planner`,
    `DTSTAMP:${icsDT(todayStr(), '00:00')}`,
    `DTSTART:${dtStart}`,
    `SUMMARY:${icsEscape((TYPE_ICON[ev.type] || '') + ' ' + ev.name)}`,
    ev.place ? `LOCATION:${icsEscape(ev.place)}` : '',
    ev.note ? `DESCRIPTION:${icsEscape(ev.note)}` : '',
    ev.alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:일정 알림', 'TRIGGER:PT0M', 'END:VALARM'].join('\n') : '',
    'END:VEVENT'
  ].filter(Boolean).join('\n');
}
function downloadIcs(filename, veventsText) {
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//trip-planner//KR', veventsText, 'END:VCALENDAR'].join('\n');
  const blob = new Blob([body], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function downloadIcsForEvent(ev) {
  downloadIcs(`${ev.name}.ics`, buildIcsEvent(selectedDay, ev));
}
$('btnExportIcs').addEventListener('click', () => {
  const trip = getActiveTrip();
  if (!trip) return;
  const chunks = [];
  Object.keys(trip.days).forEach(date => {
    trip.days[date].forEach(ev => { if (ev.alarm) chunks.push(buildIcsEvent(date, ev)); });
  });
  if (!chunks.length) { toast('알람이 설정된 일정이 없어요'); return; }
  downloadIcs(`${trip.title}-alarms.ics`, chunks.join('\n'));
  toast('캘린더 파일을 내보냈어요');
});

/* ---------- alarm checker (while app is open) ---------- */
setInterval(() => {
  const trip = getActiveTrip();
  if (!trip) return;
  const now = new Date();
  const date = todayStr();
  const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  (trip.days[date] || []).forEach(ev => {
    if (ev.alarm === hhmm) {
      const key = ev.id + hhmm;
      if (firedAlarms.has(key)) return;
      firedAlarms.add(key);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🔔 ' + ev.name, { body: ev.place || ev.note || '일정 시간이에요' });
      } else {
        toast(`🔔 ${ev.name} 시간이에요`);
      }
    }
  });
}, 20000);

/* ---------- map / overview ---------- */
async function geocodeRaw(q) {
  if (Object.prototype.hasOwnProperty.call(DATA.geocache, q)) return DATA.geocache[q];
  let result = null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const arr = await res.json();
    if (arr && arr[0]) result = { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
  } catch (e) {
    console.error('geocode failed', e);
    return null; // network error: don't cache as a permanent miss
  }
  DATA.geocache[q] = result;
  saveData();
  return result;
}
async function geocode(query, context) {
  if (!query) return null;
  let p = await geocodeRaw(query);
  if (!p && context) p = await geocodeRaw(`${query} ${context}`);
  return p;
}

function initMap() {
  if (map) return;
  map = L.map('map').setView(SEOUL, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function pathLength(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return d;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function greatCirclePath(lat1, lon1, lat2, lon2, numPoints = 64) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lon1), phi2 = toRad(lat2), lam2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2));
  if (d === 0) return [[lat1, lon1]];
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const phii = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lami = Math.atan2(y, x);
    points.push([toDeg(phii), toDeg(lami)]);
  }
  // unwrap longitude so the line doesn't jump across the antimeridian
  for (let i = 1; i < points.length; i++) {
    while (points[i][1] - points[i - 1][1] > 180) points[i][1] -= 360;
    while (points[i][1] - points[i - 1][1] < -180) points[i][1] += 360;
  }
  return points;
}
function pathLengthKm(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversineKm(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  return d;
}
function pointAtFraction(path, frac) {
  if (path.length === 1) return path[0];
  const total = pathLength(path);
  if (total === 0) return path[0];
  let target = total * frac;
  for (let i = 1; i < path.length; i++) {
    const segLen = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (target <= segLen || i === path.length - 1) {
      const segT = segLen === 0 ? 0 : Math.min(target / segLen, 1);
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * segT, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * segT];
    }
    target -= segLen;
  }
  return path[path.length - 1];
}
function animateWalker(path, durationMs, iconEmoji) {
  if (walkerAnim) cancelAnimationFrame(walkerAnim);
  const icon = L.divIcon({ className: 'walker-icon', html: iconEmoji, iconSize: [22, 22], iconAnchor: [11, 11] });
  if (!walkerMarker) {
    walkerMarker = L.marker(path[0], { icon, zIndexOffset: 2000 }).addTo(map);
  } else {
    walkerMarker.setIcon(icon);
    walkerMarker.setLatLng(path[0]);
  }
  walkerMarker.setOpacity(1);
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / durationMs, 1);
    walkerMarker.setLatLng(pointAtFraction(path, t));
    if (t < 1) {
      walkerAnim = requestAnimationFrame(step);
    } else {
      setTimeout(() => walkerMarker && walkerMarker.setOpacity(0), 300);
    }
  }
  walkerAnim = requestAnimationFrame(step);
}

const ROUTE_PROFILE = { '도보': 'foot', '자전거': 'bike', '택시': 'driving', '버스': 'driving' };
async function fetchRoutePath(fromLat, fromLon, toLat, toLon, profile) {
  const key = `osrm:${profile}:${fromLat.toFixed(5)},${fromLon.toFixed(5)};${toLat.toFixed(5)},${toLon.toFixed(5)}`;
  if (Object.prototype.hasOwnProperty.call(DATA.geocache, key)) return DATA.geocache[key];
  let result = null;
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      result = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
    console.error('route fetch failed', e);
    return null; // network error: don't cache as a permanent miss
  }
  DATA.geocache[key] = result;
  saveData();
  return result;
}

function extractLatLngFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)[,\s]\+?(-?\d{1,3}\.\d+)/,
    /\/(-?\d{1,3}\.\d+),\+?(-?\d{1,3}\.\d+)(?:[,?/]|$)/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  return null;
}

async function renderMapForSelectedDay() {
  const trip = getActiveTrip();
  initMap();
  markersLayer.clearLayers();
  routeLines.forEach(l => map.removeLayer(l));
  routeLines = [];
  routePoints = [];
  routeStepIndex = -1;
  dayUnresolvedCount = 0;
  lastRenderedStepIndex = null;
  if (walkerAnim) cancelAnimationFrame(walkerAnim);
  if (walkerMarker) { map.removeLayer(walkerMarker); walkerMarker = null; }
  if (!trip || !selectedDay) { renderStepBar(); return; }
  const cityContext = dayList(trip).find(d => d.date === selectedDay)?.city || '';
  const events = (trip.days[selectedDay] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  for (const ev of events) {
    const fromUrl = extractLatLngFromUrl(ev.mapUrl);
    const q = ev.place || ev.name;
    const p = fromUrl || await geocode(q, cityContext);
    if (p) routePoints.push({ ev, lat: p.lat, lon: p.lon });
    else dayUnresolvedCount++;
  }
  for (let i = 0; i < routePoints.length; i++) {
    if (i === 0) { routePoints[i].legPath = null; continue; }
    const from = routePoints[i - 1], to = routePoints[i];
    const profile = ROUTE_PROFILE[to.ev.move];
    let path = profile ? await fetchRoutePath(from.lat, from.lon, to.lat, to.lon, profile) : null;
    if (!path || path.length < 2) path = greatCirclePath(from.lat, from.lon, to.lat, to.lon);
    routePoints[i].legPath = path;
  }
  routePoints.forEach((pt, i) => {
    const icon = L.divIcon({
      className: 'route-pin-wrap',
      html: `<div class="route-pin-outer"><div class="pulse-ring"></div><div class="route-pin type-${escapeHtml(pt.ev.type)}"><span class="emoji">${TYPE_ICON[pt.ev.type] || '📝'}</span><span class="num">${i + 1}</span></div></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 36]
    });
    const m = L.marker([pt.lat, pt.lon], { icon }).addTo(markersLayer);
    m.bindTooltip(`${pt.ev.time ? pt.ev.time + ' ' : ''}${escapeHtml(pt.ev.name)}`, { permanent: true, direction: 'top', offset: [0, -26], className: 'route-pin-label' });
    m.on('click', () => { routeStepIndex = i; renderStepBar(); });
    pt.marker = m;
    if (pt.legPath) {
      routeLines.push(L.polyline(pt.legPath, { color: '#2b6cb0', weight: 3, dashArray: '6,6' }).addTo(map));
    }
  });
  if (routePoints.length) {
    // Use leg-path points (not just raw pin coords) so antimeridian-crossing routes fit tightly instead of the whole globe.
    const latlngs = [[routePoints[0].lat, routePoints[0].lon]];
    routePoints.forEach(p => { if (p.legPath) latlngs.push(...p.legPath); });
    map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  } else {
    map.setView(SEOUL, 12);
  }
  renderStepBar();
}

function focusEventOnMap(ev) {
  document.querySelector('.tab-btn[data-tab="overview"]').click();
  setTimeout(() => {
    const i = routePoints.findIndex(p => p.ev.id === ev.id);
    if (i >= 0) { routeStepIndex = i; renderStepBar(); }
    else toast('지도 위치를 찾을 수 없어요');
  }, 150);
}

function renderStepBar() {
  const bar = $('routeProgressBar');
  const summary = $('routeStepSummary');
  const counter = $('routeStepCounter');
  const n = routePoints.length;
  routePoints.forEach(pt => {
    const el = pt.marker.getElement();
    if (el) el.querySelector('.route-pin-outer')?.classList.remove('active');
    pt.marker.getTooltip()?.getElement()?.classList.remove('active');
  });
  if (!n) {
    bar.style.width = '0%';
    counter.innerHTML = '';
    summary.innerHTML = dayUnresolvedCount > 0
      ? `📍 일정 ${dayUnresolvedCount}개의 위치를 못 찾았어요 · <span class="sub">일정 편집 → 지도 검색어를 더 정확히 입력해보세요</span>`
      : '일정을 추가하면 동선이 여기 표시돼요';
    $('btnStepPrev').disabled = true;
    $('btnStepNext').disabled = true;
    return;
  }
  const cur = routeStepIndex === -1 ? 0 : Math.min(routeStepIndex + 1, n);
  counter.innerHTML = `오늘의 여정 <b>${cur}</b> / <b>${n}</b> · <span class="sub">실제 이동 경로</span>`;
  $('btnStepPrev').disabled = routeStepIndex <= -1;
  $('btnStepNext').disabled = routeStepIndex >= n;
  if (routeStepIndex === -1) {
    bar.style.width = '0%';
    summary.innerHTML = `오늘 일정 ${n}개 · <span class="sub">다음을 눌러 시작해요</span>`;
    if (walkerMarker) walkerMarker.setOpacity(0);
    lastRenderedStepIndex = routeStepIndex;
    return;
  }
  if (routeStepIndex >= n) {
    bar.style.width = '100%';
    summary.innerHTML = `🎉 오늘의 동선 끝! <span class="sub">즐거운 여행 되세요</span>`;
    if (walkerMarker) walkerMarker.setOpacity(0);
    lastRenderedStepIndex = routeStepIndex;
    return;
  }
  bar.style.width = `${((routeStepIndex + 1) / n) * 100}%`;
  const pt = routePoints[routeStepIndex];
  summary.innerHTML = `${pt.ev.time ? escapeHtml(pt.ev.time) + ' ' : ''}${escapeHtml(pt.ev.name)}${pt.ev.move ? `<span class="sub">${MOVE_ICON[pt.ev.move] || '🚶'} ${escapeHtml(pt.ev.move)}</span>` : ''}`;
  const el = pt.marker.getElement();
  if (el) el.querySelector('.route-pin-outer')?.classList.add('active');
  pt.marker.getTooltip()?.getElement()?.classList.add('active');
  const legMeters = pt.legPath ? pathLengthKm(pt.legPath) * 1000 : 0;
  const walkDurationMs = Math.min(4200, Math.max(1600, legMeters * 4));
  const movingForward = lastRenderedStepIndex === routeStepIndex - 1;
  lastRenderedStepIndex = routeStepIndex;
  if (movingForward && pt.legPath) {
    // Zoom to fit both endpoints of this leg (the curve/route between them) while the icon animates across it.
    // fitBounds (simple pan+zoom) is used instead of flyToBounds — Leaflet's "fly" curve computes bogus
    // intermediate zoom/center (briefly zoom 0 at a wrong wrapped longitude) for very long antimeridian-crossing legs.
    animateWalker(pt.legPath, walkDurationMs, MOVE_ICON[pt.ev.move] || '🚶');
    map.fitBounds(L.latLngBounds(pt.legPath), { padding: [50, 50], maxZoom: 17, animate: true, duration: walkDurationMs / 1000 });
  } else {
    if (walkerMarker) walkerMarker.setOpacity(0);
    map.setView([pt.lat, pt.lon], Math.min(Math.max(map.getZoom(), 15), 16), { animate: true, duration: 0.5 });
  }
  pt.marker.openTooltip();
}

$('btnStepPrev').addEventListener('click', () => {
  if (!routePoints.length) return;
  routeStepIndex = Math.max(-1, routeStepIndex - 1);
  renderStepBar();
});
$('btnStepNext').addEventListener('click', () => {
  if (!routePoints.length) return;
  routeStepIndex = Math.min(routePoints.length, routeStepIndex + 1);
  renderStepBar();
});
$('btnStepNow').addEventListener('click', () => {
  if (!routePoints.length) { toast('표시할 동선이 없어요'); return; }
  const nowHM = pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
  let idx = routePoints.findIndex(p => (p.ev.time || '') > nowHM);
  idx = idx === -1 ? routePoints.length - 1 : Math.max(0, idx - 1);
  routeStepIndex = idx;
  renderStepBar();
});

/* ---------- trip change ---------- */
function onTripChanged() {
  renderTripSelect();
  const trip = getActiveTrip();
  if (trip) ensureSelectedDay(trip); else selectedDay = null;
  renderHeader();
  renderFlights();
  renderDocs();
  renderDayTabs();
  renderEvents();
  if ($('tab-overview').classList.contains('active')) renderMapForSelectedDay();
}

/* ---------- init ---------- */
(function init() {
  populateTimeSelect($('fTimeH'), $('fTimeM'));
  populateTimeSelect($('fAlarmH'), $('fAlarmM'));
  populateTimeSelect($('flDepH'), $('flDepM'));
  populateTimeSelect($('flArrH'), $('flArrM'));
  setupIconGrid('fTypeGrid', { clearable: false });
  setupIconGrid('fMoveGrid', { clearable: true });
  if (!DATA.activeTripId && DATA.trips.length) DATA.activeTripId = DATA.trips[0].id;
  onTripChanged();
})();
