/* Connexxions Elite · site helpers (live site only): EN/ES, optional engine sound */
(function () {
  'use strict';
  var path = location.pathname, isQuote = /\/quote\//.test(path);
  var ES = /^\/es\//.test(path) || (isQuote && /[?&]lang=es\b/.test(location.search));
  var D = window.CE_ES || { exact: {}, parts: [] };

  /* ---------------- Spanish ---------------- */
  var DAYS = { Mon: 'lun', Tue: 'mar', Wed: 'mié', Thu: 'jue', Fri: 'vie', Sat: 'sáb', Sun: 'dom' };
  var MONTHS = { Jan: 'ene', Feb: 'feb', Mar: 'mar', Apr: 'abr', May: 'may', Jun: 'jun', Jul: 'jul', Aug: 'ago', Sep: 'sep', Oct: 'oct', Nov: 'nov', Dec: 'dic' };
  var MISS = { 'date': 'la fecha', 'pickup time': 'la hora de recogida', 'return date': 'la fecha de regreso', 'return pickup time': 'la hora de recogida de regreso' };
  function core(s) {
    if (D.exact[s] != null) return D.exact[s];
    var m;
    if ((m = s.match(/^Add the (.+)\.$/))) return 'Agrega ' + m[1].split(', ').map(function (x) { return MISS[x] || x; }).join(', ') + '.';
    if ((m = s.match(/^(.+): (.+)\. Price this ride\.?$/))) return (core(m[1]) || m[1]) + ': ' + (core(m[2]) || m[2]) + '. Cotiza este viaje';
    var out = s, hit = false;
    D.parts.forEach(function (p) { if (out.indexOf(p[0]) >= 0) { out = out.split(p[0]).join(p[1]); hit = true; } });
    var o2 = out
      .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})/g, function (_, d, mo, n, y) { return DAYS[d] + ' ' + n + ' ' + MONTHS[mo] + ' ' + y; })
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})/g, function (_, mo, n, y) { return n + ' ' + MONTHS[mo] + ' ' + y; })
      .replace(/(\d)\s?(am|pm)\b/gi, function (_, d, ap) { return d + ' ' + (ap.toLowerCase() === 'am' ? 'a. m.' : 'p. m.'); });
    if (o2 !== s) return o2;
    return hit ? out : null;
  }
  function tr(raw) {
    var t = raw.replace(/\s+/g, ' ').trim();
    if (!t || !/[A-Za-z]/.test(t)) return null;
    var r = core(t);
    if (r == null || r === t) return null;
    var lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    return lead + r + tail;
  }
  var ATTRS = ['aria-label', 'alt', 'placeholder', 'title', 'data-col'];
  function skip(el) { return !el || el.closest('script,style,[translate="no"],.ft-mail') ; }
  function doNode(n) {
    if (n.nodeType === 3) { if (skip(n.parentElement)) return; var r = tr(n.nodeValue); if (r != null) n.nodeValue = r; return; }
    if (n.nodeType !== 1 || skip(n)) return;
    ATTRS.forEach(function (a) { var v = n.getAttribute(a); if (v) { var r = tr(v); if (r != null) n.setAttribute(a, r); } });
    if (n.tagName === 'A') fixLink(n);
    var w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), x;
    while ((x = w.nextNode())) {
      if (x.nodeType === 3) { if (!skip(x.parentElement)) { var rr = tr(x.nodeValue); if (rr != null) x.nodeValue = rr; } }
      else if (!skip(x)) { ATTRS.forEach(function (a) { var v = x.getAttribute(a); if (v) { var r2 = tr(v); if (r2 != null) x.setAttribute(a, r2); } }); if (x.tagName === 'A') fixLink(x); }
    }
  }
  function fixLink(a) {
    var h = a.getAttribute('href') || '';
    if (/\/quote\//.test(h) && !/[?&]lang=es/.test(h)) a.setAttribute('href', h + (h.indexOf('?') >= 0 ? '&' : '?') + 'lang=es');
    else if (isQuote && (h === '../' || h === '/')) a.setAttribute('href', '/es/');
  }
  var queue = [], pending = false;
  function flush() { pending = false; var q = queue; queue = []; q.forEach(doNode); syncLang(); }
  function translateAll() {
    document.title = tr(document.title) || document.title;
    doNode(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') queue.push(m.target);
        else if (m.type === 'attributes') queue.push(m.target);
        else m.addedNodes.forEach(function (n) { queue.push(n); });
      });
      if (!pending) { pending = true; requestAnimationFrame(flush); }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'alt', 'placeholder', 'title', 'data-col', 'href'] });
  }

  /* ---------------- language switch ---------------- */
  function syncLang() {
    var bs = document.querySelectorAll('.lang button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], es = b.textContent.trim() === 'ES';
      var want = String(es === ES);
      if (b.getAttribute('aria-pressed') !== want) b.setAttribute('aria-pressed', want);
      if (!b.__ce) {
        b.__ce = 1;
        b.addEventListener('click', (function (toEs) { return function () {
          try { localStorage.setItem('ce-lang', toEs ? 'es' : 'en'); } catch (e) {}
          if (toEs !== ES) location.href = (toEs ? '/es/' : '/') + location.hash;
        }; })(es));
      }
    }
  }
  function quoteSwitch() {
    if (!isQuote) return;
    var nav = document.querySelector('.hdr nav'); if (!nav || nav.querySelector('.qlang')) return;
    var a = document.createElement('a'); a.className = 'hl qlang'; a.setAttribute('translate', 'no');
    a.textContent = ES ? 'EN' : 'ES';
    var u = new URL(location.href); if (ES) u.searchParams.delete('lang'); else u.searchParams.set('lang', 'es');
    a.href = u.pathname + u.search + u.hash; a.setAttribute('aria-label', ES ? 'English' : 'Español');
    a.style.cssText = 'font-family:var(--mono,monospace);font-size:12px;letter-spacing:.12em;border:1px solid rgba(255,255,255,.2);border-radius:99px;padding:6px 10px';
    a.addEventListener('click', function () { try { localStorage.setItem('ce-lang', ES ? 'en' : 'es'); } catch (e) {} });
    nav.insertBefore(a, nav.firstChild);
  }

  /* ---------------- optional engine sound (off by default) ---------------- */
  var SOUND_KEY = 'ce-sound', soundOn = false, ctx = null;
  try { soundOn = localStorage.getItem(SOUND_KEY) === 'on'; } catch (e) {}
  function engine(rev) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime, dur = rev ? 1.1 : 2.2;
      var master = ctx.createGain(); master.gain.setValueAtTime(0.0001, t); master.gain.exponentialRampToValueAtTime(0.16, t + 0.08); master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(rev ? 900 : 700, t + (rev ? 0.35 : 0.6)); lp.frequency.linearRampToValueAtTime(320, t + dur);
      lp.connect(master); master.connect(ctx.destination);
      // V8-style rumble: two detuned saws whose pitch rises (the rev) and settles (the idle)
      [1, 1.5].forEach(function (mult, i) {
        var o = ctx.createOscillator(); o.type = 'sawtooth';
        var base = 38 * mult, peak = (rev ? 120 : 92) * mult;
        o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(peak, t + (rev ? 0.32 : 0.55)); o.frequency.exponentialRampToValueAtTime(base * 1.15, t + dur * 0.8);
        var g = ctx.createGain(); g.gain.value = i ? 0.35 : 0.6; o.connect(g); g.connect(lp); o.start(t); o.stop(t + dur);
      });
      // a little exhaust texture
      var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
      for (var k = 0; k < len; k++) ch[k] = (Math.random() * 2 - 1) * 0.5;
      var nz = ctx.createBufferSource(); nz.buffer = buf; var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 160; bp.Q.value = 0.8;
      var ng = ctx.createGain(); ng.gain.value = 0.25; nz.connect(bp); bp.connect(ng); ng.connect(lp); nz.start(t); nz.stop(t + dur);
    } catch (e) {}
  }
  function soundButton() {
    if (isQuote || document.querySelector('.ce-snd')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ce-snd'; b.setAttribute('translate', 'no');
    var paint = function () {
      b.setAttribute('aria-pressed', String(soundOn));
      b.setAttribute('aria-label', soundOn ? (ES ? 'Apagar sonido' : 'Turn sound off') : (ES ? 'Activar sonido' : 'Turn sound on'));
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>' + (soundOn ? '<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>' : '<path d="m17 9 5 6M22 9l-5 6"/>') + '</svg><span>' + (soundOn ? (ES ? 'Sonido' : 'Sound on') : (ES ? 'Sin sonido' : 'Sound off')) + '</span>';
    };
    paint();
    b.addEventListener('click', function () { soundOn = !soundOn; try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) {} paint(); if (soundOn) engine(false); });
    document.body.appendChild(b);
  }
  // with sound on, every "get a price" button revs the engine (browsers only allow sound after a tap)
  document.addEventListener('click', function (e) {
    if (!soundOn || isQuote) return;
    var a = e.target.closest && e.target.closest('a.btn-p, .hx-ticket, .qcta-r a, .bcard');
    if (!a) return;
    engine(true);
    var h = a.getAttribute('href') || '';
    if (h && h.charAt(0) !== '#' && !h.startsWith('mailto:') && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); setTimeout(function () { location.href = a.href; }, 650); }
  }, true);
  // if sound is on from an earlier visit, start the engine on the first tap anywhere
  if (soundOn && !isQuote) document.addEventListener('pointerdown', function first() { document.removeEventListener('pointerdown', first, true); if (!document.querySelector('.ce-snd:hover')) engine(false); }, true);

  function boot() {
    if (ES) { document.documentElement.lang = 'es'; translateAll(); }
    quoteSwitch(); syncLang(); soundButton();
    // the page framework renders after load: keep the language buttons in sync for the first seconds
    var n = 0, iv = setInterval(function () { syncLang(); if (++n > 20) clearInterval(iv); }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
