// "Add a masjid that is not listed": name, full address and a pin on the map. Goes to the owner for approval; once
// approved it appears for everyone and the person who added it can publish its jamaat times.
import { h, icon, toast } from '../../core/dom.js';
import { cleanText } from '../../core/validate.js';
import { currentPosition } from '../../core/geo.js';
import { areaSearch } from '../location/view.js';

export const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

/** Problems with a submission, or [] — the same rules the database enforces. */
export function submissionProblems(f) {
  const errs = [];
  const len = (v, a, b) => { const n = cleanText(v, 200).length; return n >= a && n <= b; };
  if (!len(f.name, 2, 80)) errs.push('Enter the masjid name.');
  if (!len(f.street, 2, 120)) errs.push('Enter the street and building.');
  if (!len(f.area, 2, 80)) errs.push('Enter the area.');
  if (!len(f.city, 2, 60)) errs.push('Enter the city or town.');
  if (!STATES.includes(f.state)) errs.push('Choose the state.');
  if (!/^[1-9]\d{5}$/.test(String(f.pincode || '').trim())) errs.push('Enter the 6-digit pincode.');
  if (!(f.lat >= 6 && f.lat <= 37.5 && f.lng >= 68 && f.lng <= 97.5)) errs.push('Place the pin on the masjid (inside India).');
  return errs;
}

let leaflet = null;
async function loadLeaflet() {
  if (!document.getElementById('leaflet-css')) document.head.append(h('link', { id: 'leaflet-css', rel: 'stylesheet', href: './vendor/leaflet/leaflet.css' }));
  leaflet ||= import('../../../vendor/leaflet/leaflet-src.esm.js'); // bundled with the app, not from a CDN
  return leaflet;
}

export function addMasjidForm(ctx) {
  const start = ctx.state.loc || { lat: 20.59, lng: 78.96 }; // the user's area, else the middle of India
  const f = { lat: ctx.state.loc ? start.lat : NaN, lng: ctx.state.loc ? start.lng : NaN };
  const err = h('p', { class: 'err-text', role: 'alert' });
  const input = (id, label, attrs = {}) => {
    const el = h('input', { id, autocomplete: 'off', ...attrs });
    return [el, h('div', { class: 'field' }, h('label', { for: id, text: label }), el)];
  };
  const [name, nameF] = input('am-name', 'Masjid name', { maxlength: '80', autocapitalize: 'words', placeholder: 'e.g. Masjid-e-Rahmat' });
  const [street, streetF] = input('am-street', 'Street and building', { maxlength: '120', autocomplete: 'address-line1' });
  const [area, areaF] = input('am-area', 'Area', { maxlength: '80' });
  const [city, cityF] = input('am-city', 'City or town', { maxlength: '60', autocomplete: 'address-level2' });
  const [pin, pinF] = input('am-pin', 'Pincode', { inputmode: 'numeric', maxlength: '6', autocomplete: 'postal-code', pattern: '[1-9][0-9]{5}' });
  const state = h('select', { id: 'am-state' }, h('option', { value: '' }, 'Choose…'), ...STATES.map((s) => h('option', { value: s }, s)));
  const stateF = h('div', { class: 'field' }, h('label', { for: 'am-state', text: 'State' }), state);
  const coords = h('p', { class: 'muted small num', text: Number.isFinite(f.lat) ? '' : 'Tap the map to place the pin on the masjid.' });
  const mapBox = h('div', { class: 'map', role: 'application', 'aria-label': 'Map: tap or drag the pin onto the masjid' });

  let map = null, marker = null;
  const placePin = (lat, lng, zoom) => {
    f.lat = Math.round(lat * 1e6) / 1e6; f.lng = Math.round(lng * 1e6) / 1e6;
    coords.textContent = `Pin: ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`;
    if (marker) marker.setLatLng([f.lat, f.lng]);
    if (map && zoom) map.setView([f.lat, f.lng], zoom);
  };
  queueMicrotask(async () => {
    try {
      const L = await loadLeaflet();
      map = L.map(mapBox, { zoomControl: false, attributionControl: false }).setView([start.lat, start.lng], ctx.state.loc ? 17 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      const pinEl = h('div', { class: 'map-pin', 'aria-hidden': 'true' });
      marker = L.marker([start.lat, start.lng], { draggable: true, keyboard: true, title: 'Masjid location', icon: L.divIcon({ html: pinEl, className: 'map-pin-wrap', iconSize: [28, 40], iconAnchor: [14, 40] }) }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); placePin(p.lat, p.lng); });
      map.on('click', (e) => placePin(e.latlng.lat, e.latlng.lng));
      if (Number.isFinite(f.lat)) placePin(f.lat, f.lng);
    } catch { mapBox.replaceChildren(h('p', { class: 'muted small', text: 'The map could not load. Check your connection and open this again.' })); }
  });

  const here = h('button', { class: 'btn', type: 'button' }, icon('pin'), 'Put the pin where I am');
  here.addEventListener('click', async () => {
    here.disabled = true;
    try { const p = await currentPosition(); placePin(p.lat, p.lng, 18); } catch (e) { err.textContent = e.message; } finally { here.disabled = false; }
  });

  const finder = areaSearch({
    id: 'am-find', placeholder: 'Find the area on the map', near: ctx.state.loc,
    onPick: (r) => {
      placePin(r.lat, r.lng, 17);
      if (!area.value) area.value = r.title;
      if (!city.value && r.city) city.value = r.city;
      if (!state.value && STATES.includes(r.state)) state.value = r.state;
      if (!pin.value && /^[1-9]\d{5}$/.test(r.postcode || '')) pin.value = r.postcode;
    },
  });

  const send = h('button', { class: 'btn primary block', type: 'submit', text: 'Send for approval' });
  const form = h('form', { class: 'card add-masjid', novalidate: true, 'aria-labelledby': 'am-h' },
    h('h2', { id: 'am-h', text: 'Add a masjid' }),
    h('p', { class: 'muted small', text: 'For a masjid that is missing from the list. The app owner checks it; once approved it appears for everyone and you can publish its jamaat times.' }),
    nameF, finder, mapBox, h('p', { class: 'attrib' }, 'Map © OpenStreetMap contributors'), coords, here,
    streetF, areaF, cityF, h('div', { class: 'two' }, stateF, pinF), err, send,
    h('button', { class: 'link', type: 'button', text: 'Cancel', onclick: () => ctx.setPortal({ adding: false }) }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = { name: name.value, street: street.value, area: area.value, city: city.value, state: state.value, pincode: pin.value.trim(), lat: f.lat, lng: f.lng };
    const problems = submissionProblems(v);
    if (problems.length) { err.textContent = problems.join(' '); return; }
    send.disabled = true; err.textContent = '';
    try {
      await ctx.backend.submitMasjid(v);
      toast('Sent for approval. You will be able to publish its times once it is approved.');
      ctx.setPortal({ adding: false, mine: null });
    } catch (ex) { err.textContent = ex.message; }
    finally { send.disabled = false; }
  });
  return form;
}
