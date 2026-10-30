/*
 * Connexxions Elite · Mapbox bridge
 * Loads only on the live site. Gives the quote planner a real Mapbox map,
 * driving routes from the Directions API and address/POI search from the
 * Search Box API. If the token is missing or Mapbox fails, the page keeps
 * its built-in map and offline pricing.
 */
(function () {
  'use strict';
  var TOKEN = String(window.CE_MAPBOX_TOKEN || '').trim();
  if (!/^pk\./.test(TOKEN)) return;

  var API = 'https://api.mapbox.com';
  var STYLE = window.CE_MAPBOX_STYLE || 'mapbox://styles/mapbox/light-v11';
  var CENTER = [-81.379, 28.538];
  var BBOX = '-82.9,27.3,-80.3,29.6';
  var EMPTY = { type: 'FeatureCollection', features: [] };

  var comp = null, map = null, loaded = false, accent = '#D42A27';
  var lastOpen = null, markers = {}, shownKey = '', carRaf = 0, flowTimer = 0, scWant = '', scTimer = 0, lastSug = [];
  var rc = {}, rcBusy = {}, sc = {}, scBusy = {};

  // same projection the built-in map uses, so itinerary/pricing code keeps working
  function pr(lon, lat) { return [(lon + 82.25) / 1.75 * 1000, (28.95 - lat) / 0.830482 * 540]; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  var session = uuid();
  function rkey(a, b) { return (+a.lat).toFixed(5) + ',' + (+a.lon).toFixed(5) + '>' + (+b.lat).toFixed(5) + ',' + (+b.lon).toFixed(5); }
  function refresh() { if (comp) { try { comp.forceUpdate(); } catch (e) {} } }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function clean(s) { return String(s || '').replace(/,\s*United States$/, '').trim(); }
  function short(s) { var f = String(s || '').split(',')[0].trim() || 'Address'; return f.length > 24 ? f.slice(0, 23) + '…' : f; }

  /* ---------------- routing ---------------- */
  function roadLabel(st) {
    var ref = String(st.ref || '').split(';')[0].trim(), nm = String(st.name || '');
    if (/turnpike/i.test(nm) || /^(FL\s*)?TPK/i.test(ref)) return "Florida's Turnpike";
    if (ref) return ref.replace(/^I\s*-?\s*/, 'I-').replace(/^(SR|FL)\s*/, 'SR ').replace(/^US\s*/, 'US ').replace(/^CR\s*/, 'CR ');
    return nm || 'Local';
  }
  function isHighway(lbl, st) {
    return /^I-/.test(lbl) || /Turnpike/.test(lbl) || /^SR (408|414|417|429|451|453|528|570)\b/.test(lbl) ||
      /expressway|parkway|beachline|beltway/i.test(String(st.name || ''));
  }
  function toResult(j) {
    var r = j && j.routes && j.routes[0];
    if (!r || !r.geometry) return null;
    var legs = [], hwSec = 0;
    (r.legs || []).forEach(function (lg) {
      (lg.steps || []).forEach(function (st) {
        var g = st.geometry && st.geometry.coordinates;
        if (!st.distance || !g || !g.length) return;
        var lbl = roadLabel(st), hw = isHighway(lbl, st);
        if (!hw && st.distance < 3200) lbl = 'Local';
        if (hw) hwSec += st.duration;
        var last = legs[legs.length - 1];
        if (last && last.name === lbl) { last.km += st.distance / 1000; last.end = g[g.length - 1]; }
        else legs.push({ name: lbl, km: st.distance / 1000, start: g[0], end: g[g.length - 1] });
      });
    });
    legs.forEach(function (l) {
      var A = pr(l.start[0], l.start[1]), B = pr(l.end[0], l.end[1]);
      var dx = B[0] - A[0], dy = A[1] - B[1];
      l.a = A; l.b = B; l.mi = l.km * 0.621371;
      l.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'N' : 'S');
    });
    var top = legs.filter(function (l) { return l.name !== 'Local' && l.mi >= 1; }).sort(function (x, y) { return y.km - x.km; }).slice(0, 2);
    var coords = r.geometry.coordinates, every = Math.max(1, Math.floor(coords.length / 400));
    return {
      mi: Math.max(1, r.distance / 1609.344),
      min: r.duration / 60 + 3,
      hw: hwSec / 60,
      legs: legs,
      pts: coords.filter(function (c, i) { return i % every === 0 || i === coords.length - 1; }).map(function (c) { return pr(c[0], c[1]); }),
      via: legs.filter(function (l) { return top.indexOf(l) >= 0; }).map(function (l) { return l.name; }),
      coords: coords,
      mb: true
    };
  }
  function route(a, b, c) {
    if (c) comp = c;
    if (!a || !b || a.lat == null || b.lat == null) return null;
    var k = rkey(a, b);
    if (rc[k]) return rc[k];
    if (!rcBusy[k]) {
      rcBusy[k] = 1;
      getJSON(API + '/directions/v5/mapbox/driving/' + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat +
        '?alternatives=false&geometries=geojson&overview=full&steps=true&access_token=' + TOKEN)
        .then(function (j) { var res = toResult(j); if (res) { rc[k] = res; refresh(); } })
        .catch(function () { /* keep the built-in estimate */ });
    }
    return null;
  }

  /* ---------------- search ---------------- */
  function runSuggest() {
    var q = scWant, k = q.toLowerCase();
    if (!q || sc[k] || scBusy[k]) return;
    scBusy[k] = 1;
    getJSON(API + '/search/searchbox/v1/suggest?q=' + encodeURIComponent(q) + '&language=en&country=us&limit=5' +
      '&proximity=' + CENTER.join(',') + '&bbox=' + BBOX + '&types=poi,address,street,place,postcode,neighborhood' +
      '&session_token=' + session + '&access_token=' + TOKEN)
      .then(function (j) {
        sc[k] = (j.suggestions || []).map(function (s) {
          var cats = (s.poi_category || []).join(' ') + ' ' + (s.poi_category_ids || []).join(' ');
          var air = /airport/i.test(cats) || /\bairport\b/i.test(s.name || '');
          var full = clean(s.full_address || s.place_formatted || '');
          var isAddr = s.feature_type === 'address' || s.feature_type === 'street';
          var name = isAddr ? (full || s.name) : (s.name + (full ? ', ' + full : ''));
          return {
            kind: air ? 'air' : (isAddr ? 'city' : 'place'),
            label: s.name,
            sub: clean(s.place_formatted || s.full_address || ''),
            place: { name: name, short: short(s.name), lat: null, lon: null, air: air, mbid: s.mapbox_id }
          };
        });
        lastSug = sc[k];
        if (scWant.toLowerCase() === k) refresh();
      })
      .catch(function () { scBusy[k] = 0; });
  }
  function suggest(raw, c) {
    if (c) comp = c;
    var q = String(raw || '').trim();
    if (q.length < 3) return [];
    var st = comp && comp.state;
    if (st && ((st.A && st.A.name === q) || (st.B && st.B.name === q))) return [];
    var k = q.toLowerCase();
    if (sc[k]) { lastSug = sc[k]; return sc[k]; }
    if (scWant !== q) { scWant = q; clearTimeout(scTimer); scTimer = setTimeout(runSuggest, 200); }
    return lastSug;
  }
  function retrieve(p, c, cb) {
    if (c) comp = c;
    getJSON(API + '/search/searchbox/v1/retrieve/' + encodeURIComponent(p.mbid) + '?session_token=' + session + '&access_token=' + TOKEN)
      .then(function (j) {
        var f = j.features && j.features[0];
        if (!f || !f.geometry) throw new Error('no feature');
        var co = f.geometry.coordinates, near = comp && comp.nearest ? comp.nearest(co[1], co[0]) : null;
        session = uuid();
        cb({ name: p.name, short: p.short, lat: co[1], lon: co[0], air: !!(p.air || (near && near.air)), typed: p.name });
      })
      .catch(function () { var r = comp && comp.resolve ? comp.resolve(p.name) : null; if (r) cb(r); });
  }
  function reverse(lat, lon, cb) {
    var base = comp.pinAt(lat, lon);
    getJSON(API + '/search/geocode/v6/reverse?longitude=' + lon + '&latitude=' + lat + '&types=address,street&limit=1&access_token=' + TOKEN)
      .then(function (j) {
        var f = j.features && j.features[0], pp = f && f.properties;
        if (!pp) return cb(base);
        var full = clean(pp.full_address || pp.name);
        cb(Object.assign({}, base, { name: full || base.name, short: short(pp.name || full), approx: 'pinned on the map' }));
      })
      .catch(function () { cb(base); });
  }

  /* ---------------- map ---------------- */
  function line(id, coords) {
    var s = map && map.getSource(id);
    if (s) s.setData(coords && coords.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : EMPTY);
  }
  function addLayers() {
    ['ce-rt', 'ce-ret', 'ce-draft'].forEach(function (id) { map.addSource(id, { type: 'geojson', data: EMPTY }); });
    map.addSource('ce-car', { type: 'geojson', data: EMPTY });
    var round = { 'line-cap': 'round', 'line-join': 'round' };
    var w = function (a, b) { return ['interpolate', ['linear'], ['zoom'], 8, a, 15, b]; };
    map.addLayer({ id: 'ce-draft', type: 'line', source: 'ce-draft', layout: round, paint: { 'line-color': '#0A0A0A', 'line-opacity': 0.45, 'line-width': 2, 'line-dasharray': [1.5, 2] } });
    map.addLayer({ id: 'ce-ret', type: 'line', source: 'ce-ret', layout: round, paint: { 'line-color': '#0A0A0A', 'line-opacity': 0.7, 'line-width': w(2, 3.5), 'line-dasharray': [1, 1.6], 'line-offset': w(5, 9) } });
    map.addLayer({ id: 'ce-rt-case', type: 'line', source: 'ce-rt', layout: round, paint: { 'line-color': '#FFFFFF', 'line-width': w(7, 13) } });
    map.addLayer({ id: 'ce-rt', type: 'line', source: 'ce-rt', layout: round, paint: { 'line-color': accent, 'line-width': w(3.6, 7.5) } });
    map.addLayer({ id: 'ce-rt-flow', type: 'line', source: 'ce-rt', layout: round, paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.9, 'line-width': w(1.2, 2.2), 'line-dasharray': [0, 4, 3] } });
    map.addLayer({ id: 'ce-car', type: 'circle', source: 'ce-car', paint: { 'circle-radius': w(5, 8), 'circle-color': '#FFFFFF', 'circle-stroke-color': accent, 'circle-stroke-width': 3 } });
    // marching dashes along the route
    var seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
    var i = 0;
    flowTimer = setInterval(function () { if (map.getLayer('ce-rt-flow')) map.setPaintProperty('ce-rt-flow', 'line-dasharray', seq[i = (i + 1) % seq.length]); }, 70);
  }
  function startCar(coords) {
    cancelAnimationFrame(carRaf);
    var src = map.getSource('ce-car');
    if (!src || !coords || coords.length < 2) { if (src) src.setData(EMPTY); return; }
    var cum = [0];
    for (var i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * 0.88, coords[i][1] - coords[i - 1][1]));
    var total = cum[cum.length - 1] || 1, dur = 7000, t0 = performance.now(), j = 1;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tick = function (now) {
      var d = (reduce ? 1 : ((now - t0) % dur) / dur) * total;
      if (d < cum[j - 1]) j = 1;
      while (j < cum.length - 1 && cum[j] < d) j++;
      var seg = (cum[j] - cum[j - 1]) || 1, u = Math.min(1, Math.max(0, (d - cum[j - 1]) / seg));
      var p = [coords[j - 1][0] + (coords[j][0] - coords[j - 1][0]) * u, coords[j - 1][1] + (coords[j][1] - coords[j - 1][1]) * u];
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } });
      if (!reduce) carRaf = requestAnimationFrame(tick);
    };
    carRaf = requestAnimationFrame(tick);
  }
  function pinEl(which) {
    var el = document.createElement('div');
    el.className = 'mbm';
    el.innerHTML = '<div class="pinwrap"><span class="pin-lab"></span><span class="pin" style="background:' + (which === 'A' ? accent : '#0A0A0A') + '"><b>' + which + '</b></span></div>';
    el.title = which === 'A' ? 'Drag to move the pickup' : 'Drag to move the drop-off';
    return el;
  }
  function placeMarker(which, p) {
    var m = markers[which];
    if (!p || p.lat == null) { if (m) { m.remove(); delete markers[which]; } return; }
    if (!m) {
      m = markers[which] = new mapboxgl.Marker({ element: pinEl(which), anchor: 'bottom', draggable: true });
      m.on('dragend', function () {
        var ll = m.getLngLat();
        reverse(ll.lat, ll.lng, function (pl) { comp.setPlace(which, pl, which === 'A' ? { pinTo: 'B' } : null); });
      });
      m.setLngLat([p.lon, p.lat]).addTo(map);
    } else m.setLngLat([p.lon, p.lat]);
    var lab = m.getElement().querySelector('.pin-lab');
    if (lab) lab.textContent = p.short || '';
  }
  function addSpots() {
    (comp.places || []).filter(function (p) { return p.dot; }).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mbspot' + (p.air ? ' air' : '');
      b.setAttribute('aria-label', 'Choose ' + p.name);
      b.innerHTML = '<i></i><span>' + p.short + '</span>';
      b.addEventListener('click', function (e) { e.stopPropagation(); comp.pickTarget(Object.assign({ typed: '' }, p)); });
      new mapboxgl.Marker({ element: b, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
    });
  }
  function fit(A, B, R) {
    var wide = comp.state.wide, panel = document.querySelector('.qpanel');
    var left = wide && panel ? panel.offsetWidth + 56 : 48;
    var pad = { top: 72, bottom: 96, left: left, right: 56 };
    if (A && B) {
      var pts = R ? R.coords : [[A.lon, A.lat], [B.lon, B.lat]], b = new mapboxgl.LngLatBounds(pts[0], pts[0]);
      pts.forEach(function (c) { b.extend(c); });
      map.fitBounds(b, { padding: pad, maxZoom: 14, duration: 900 });
    } else if (A || B) {
      var p = A || B;
      map.easeTo({ center: [p.lon, p.lat], zoom: 12, padding: pad, duration: 900 });
    }
  }
  function sync(c) {
    if (c) comp = c;
    if (!loaded || !comp) return;
    var s = comp.state, A = s.A, B = s.B;
    // the phone layout hides the map until a route is chosen: size it again when it appears
    if (s.mOpen !== lastOpen) {
      lastOpen = s.mOpen;
      if (s.mOpen) setTimeout(function () { map.resize(); shownKey = ''; sync(comp); }, 80);
    }
    placeMarker('A', A);
    placeMarker('B', B);
    var k = A && B && A.lat != null && B.lat != null ? rkey(A, B) : '';
    var R = k ? rc[k] : null;
    var key2 = k + (R ? '|mb' : '|draft') + '|' + s.trip + '|' + (A ? 1 : 0) + (B ? 1 : 0);
    if (key2 === shownKey) return;
    var sameRoute = shownKey.split('|')[0] === k && shownKey.split('|')[1] === (R ? 'mb' : 'draft');
    shownKey = key2;
    if (R) { line('ce-rt', R.coords); line('ce-draft', null); line('ce-ret', s.trip === 'round' ? R.coords : null); startCar(R.coords); }
    else if (k) { line('ce-rt', null); line('ce-ret', null); line('ce-draft', [[A.lon, A.lat], [B.lon, B.lat]]); startCar(null); }
    else { line('ce-rt', null); line('ce-ret', null); line('ce-draft', null); startCar(null); }
    if (!sameRoute) fit(A, B, R);
  }
  function attach(c) {
    comp = c;
    accent = (c.props && c.props.accent) || accent;
    if (map || !window.mapboxgl) return;
    var el = document.querySelector('.mbx');
    if (!el) return;
    mapboxgl.accessToken = TOKEN;
    try {
      map = new mapboxgl.Map({
        container: el, style: STYLE, center: CENTER, zoom: 9.2, minZoom: 6.5, maxZoom: 17.5,
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        attributionControl: false, maxBounds: [[-84.2, 26.4], [-78.8, 30.6]]
      });
    } catch (e) { map = null; return; }
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    map.on('load', function () {
      loaded = true;
      addLayers();
      addSpots();
      document.documentElement.classList.add('mb-on');
      map.resize();
      shownKey = '';
      sync(comp);
      refresh();
    });
    map.on('click', function (e) { reverse(e.lngLat.lat, e.lngLat.lng, function (pl) { comp.pickTarget(pl); }); });
    var tools = document.querySelectorAll('.mtools .mbtn');
    if (tools[0]) tools[0].addEventListener('click', function () { if (loaded) map.zoomIn(); });
    if (tools[1]) tools[1].addEventListener('click', function () { if (loaded) map.zoomOut(); });
    if (tools[2]) tools[2].addEventListener('click', function () { if (loaded) { shownKey = ''; sync(comp); } });
    window.addEventListener('resize', function () { if (map) map.resize(); });
  }

  window.CE_MAPBOX = { attach: attach, sync: sync, route: route, suggest: suggest, retrieve: retrieve };
})();
