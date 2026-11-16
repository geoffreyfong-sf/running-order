(function () {
  const KEY = 'running-order-v1';
  const SPEEDS = [1, 1.2, 1.5, 1.8, 2];
  const REFRESH_MS = 10 * 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>',
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
  };

  let state = load();
  let feed = { shows: [] };
  let eps = {};
  let shows = {};
  let tab = 'queue';
  let openShow = null;
  let restored = false;
  let lastSave = 0;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved) return { ...Q.blankState(), ...saved };
    } catch (e) { /* Start fresh. */ }
    return Q.blankState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* Keep working in memory. */ }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function iconBtn(cls, label, icon, fn) {
    const b = el('button', cls);
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[icon];
    b.onclick = fn;
    return b;
  }
  function art(show) {
    const i = el('img', 'art');
    i.alt = '';
    i.loading = 'lazy';
    if (show && show.image) i.src = show.image;
    return i;
  }
  // "Today", "Yesterday", "Sat" for this week, otherwise "Nov 9".
  function shortDate(d) {
    const t = d ? new Date(d) : null;
    if (!t || isNaN(t)) return '';
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ago = Math.round((day(new Date()) - day(t)) / 864e5);
    if (ago === 0) return 'Today';
    if (ago === 1) return 'Yesterday';
    if (ago > 1 && ago < 7) return t.toLocaleDateString(undefined, { weekday: 'short' });
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- Feed ----------
  async function refresh() {
    try {
      const res = await fetch('feeds.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      feed = await res.json();
      eps = Q.indexEpisodes(feed);
      shows = Object.fromEntries((feed.shows || []).map((s) => [s.id, s]));
      const added = Q.sync(state, feed);
      save();
      const when = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const result = added.length && state.seenBefore ? `${added.length} new` : 'No new';
      setStatus(`${result}, ${when}\n${checkedText()}`);
      state.seenBefore = true;
      save();
      render();
      restore();
    } catch (e) {
      setStatus('Offline');
      if (!Object.keys(eps).length) render();
    }
  }
  function checkedText() {
    if (!feed.updated) return '';
    return 'List changed ' + new Date(feed.updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function setStatus(t) { $('status').textContent = t; }

  // ---------- Queues ----------
  function qOfEp(id) { return eps[id] ? Q.queueOf(state, shows[eps[id].showId]) : 'Main'; }
  function queueNames() {
    const names = ['Main'];
    const addName = (n) => { if (n && !names.includes(n)) names.push(n); };
    (feed.shows || []).forEach((sh) => addName(Q.queueOf(state, sh)));
    Object.values(state.showQueue || {}).forEach(addName);
    return names;
  }
  function currentView() {
    if (!queueNames().includes(state.view)) state.view = 'Main';
    return state.view;
  }
  function queueBar() {
    const bar = el('div', 'chips');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Queues');
    const view = currentView();
    queueNames().forEach((name) => {
      const count = state.order.filter((id) => eps[id] && qOfEp(id) === name).length;
      const chip = el('button', 'chip', name);
      chip.append(el('span', 'count', count));
      chip.setAttribute('aria-pressed', name === view);
      chip.onclick = () => { state.view = name; openShow = null; save(); render(); $('view').scrollTop = 0; };
      bar.append(chip);
    });
    return bar;
  }

  // ---------- Views ----------
  function render() {
    $('tabQueue').setAttribute('aria-selected', tab === 'queue');
    $('tabShows').setAttribute('aria-selected', tab === 'shows');
    const view = $('view');
    view.replaceChildren();
    if (tab === 'queue') renderQueue(view); else renderShows(view);
    renderPlayer();
  }

  function renderQueue(view) {
    view.append(queueBar());
    const name = currentView();
    const ids = state.order.filter((id) => eps[id] && qOfEp(id) === name);
    if (!ids.length) {
      const box = el('div', 'empty');
      box.append(el('strong', '', feed.shows && feed.shows.length ? `Nothing left in ${name}` : 'No shows yet'));
      box.append(el('span', '', feed.shows && feed.shows.length
        ? 'New episodes land here in your ranked order. To add older ones, open Show rank and tap a show.'
        : 'Add show names to shows.json in your GitHub project. They appear here after the next refresh.'));
      view.append(box);
      return;
    }
    const list = el('ol');
    list.id = 'queue';
    let n = 0;
    ids.forEach((id) => {
      const ep = eps[id];
      const on = id === state.current;
      const li = el('li', 'row' + (on ? ' on' + (audio.paused ? '' : ' playing') : ''));
      li.dataset.id = id;
      const slot = el('div', 'slot');
      if (on) slot.append(el('span', 'tally')); else slot.textContent = ++n;
      const main = el('button', 'main');
      main.append(el('span', 'title', ep.title));
      const show = shows[ep.showId];
      const pos = state.pos[id] || 0;
      const dur = ep.dur || 0;
      const timeText = dur ? (pos > 5 ? `${Q.fmtTime(dur - pos)} left` : Q.fmtTime(dur)) : '';
      const meta = el('span', 'meta');
      const when = el('b', 'when', shortDate(ep.date));
      meta.append(when, [timeText, show && show.title].filter(Boolean).map((x) => ' · ' + x).join(''));
      main.append(meta);
      if (pos > 5 && dur) {
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = Math.min(100, (pos / dur) * 100) + '%';
        bar.append(fill);
        main.append(bar);
      }
      main.setAttribute('aria-label', 'Play ' + ep.title);
      main.onclick = () => (on ? toggle() : play(id));
      const body = el('div', 'body');
      body.append(main);
      if (show && show.watch) {
        const link = el('a', 'watch', show.watchLabel || 'Open show');
        link.href = show.watch;
        link.target = '_blank';
        link.rel = 'noopener';
        body.append(link);
      }
      li.append(slot, art(show), body,
        iconBtn('icon', 'Mark played: ' + ep.title, 'check', () => done(id)),
        gripFor(ep.title));
      list.append(li);
    });
    view.append(list);
    sortable(list, (moved) => {
      const cur = state.current;
      const sub = cur && moved.includes(cur) ? [cur, ...moved.filter((x) => x !== cur)] : moved;
      state.order = Q.reorderSubset(state.order, sub);
      save();
      render();
    });
  }

  function renderShows(view) {
    view.append(queueBar());
    const name = currentView();
    const list = el('ol');
    list.id = 'ranks';
    state.rank.filter((id) => shows[id] && Q.queueOf(state, shows[id]) === name).forEach((id, i) => {
      const show = shows[id];
      const li = el('li');
      li.dataset.id = id;
      const row = el('div', 'row show-row');
      const main = el('button', 'main');
      main.append(el('span', 'title', show.title));
      const waiting = state.order.filter((e) => eps[e] && eps[e].showId === id).length;
      main.append(el('span', 'meta', show.error ? 'Feed could not be read' : `${waiting} in queue`));
      main.setAttribute('aria-expanded', openShow === id);
      main.onclick = () => { openShow = openShow === id ? null : id; render(); };
      const mode = el('button', 'mode', state.modes[id] === 'old' ? 'Oldest first' : 'Newest first');
      mode.setAttribute('aria-label', `${show.title} order: ${mode.textContent}. Tap to change.`);
      mode.onclick = () => {
        state.modes[id] = state.modes[id] === 'old' ? 'new' : 'old';
        resortShow(id);
        save();
        render();
      };
      row.append(el('div', 'slot', i + 1), art(show), main, mode, gripFor(show.title));
      li.append(row);
      if (openShow === id) li.append(backCatalog(show));
      list.append(li);
    });
    view.append(list);
    if (!list.children.length) {
      const box = el('div', 'empty');
      box.append(el('strong', '', 'No shows yet'), el('span', '', 'Add show names to shows.json in your GitHub project.'));
      view.append(box);
    } else {
      const hint = el('p', 'hint', 'Drag shows to rank them within this queue. Tap a show to move it to another queue. ');
      const m = location.hostname.match(/^([^.]+)\.github\.io$/);
      const repo = location.pathname.split('/').filter(Boolean)[0];
      if (m && repo) {
        const a = el('a', '', 'Add a show');
        a.href = `https://github.com/${m[1]}/${repo}/edit/main/shows.json`;
        a.target = '_blank';
        a.rel = 'noopener';
        hint.append(a);
      }
      view.append(hint);
    }
    sortable(list, (ids) => {
      state.rank = Q.reorderSubset(state.rank, ids);
      Q.applyRank(state, feed);
      save();
      render();
    });
  }

  function backCatalog(show) {
    const ul = el('ul', 'back');
    ul.style.listStyle = 'none';
    ul.style.margin = '0';
    ul.append(queueControl(show));
    if (!String(show.feed).startsWith('search:')) ul.append(skipControl(show));
    (show.episodes || []).forEach((ep) => {
      const inQueue = state.order.includes(ep.id);
      const li = el('li', state.played[ep.id] ? 'done' : '');
      li.append(el('span', '', ep.title));
      if (!inQueue) {
        const add = el('button', 'add', state.played[ep.id] ? 'Replay' : 'Add');
        add.setAttribute('aria-label', `Add ${ep.title} to queue`);
        add.onclick = () => {
          delete state.played[ep.id];
          Q.insertEpisode(state, { ...ep, showId: show.id }, eps);
          save();
          render();
        };
        li.append(add);
      }
      ul.append(li);
    });
    return ul;
  }

  function queueControl(show) {
    const li = el('li', 'qpick');
    const id = 'queue-for-' + show.id;
    const label = el('label', '', 'Queue');
    label.htmlFor = id;
    const pick = el('select');
    pick.id = id;
    const NEW = '__new__';
    queueNames().forEach((n) => {
      const o = el('option', '', n);
      o.value = n;
      pick.append(o);
    });
    const o = el('option', '', 'New queue...');
    o.value = NEW;
    pick.append(o);
    pick.value = Q.queueOf(state, show);
    pick.onchange = () => {
      let target = pick.value;
      if (target === NEW) {
        target = (window.prompt('Name the new queue') || '').trim().slice(0, 30);
        if (!target) { pick.value = Q.queueOf(state, show); return; }
      }
      state.showQueue[show.id] = target;
      state.view = target;
      save();
      render();
    };
    li.append(label, pick);
    return li;
  }

  function skipControl(show) {
    const li = el('li', 'skip');
    const secs = state.skip[show.id] || 0;
    const label = el('span', '', secs ? `Skip intro: ${Q.fmtTime(secs)}` : 'Skip intro: off');
    const step = (d, text, name) => {
      const b = el('button', 'stepper', text);
      b.setAttribute('aria-label', `${name} for ${show.title}`);
      b.onclick = () => {
        state.skip[show.id] = Math.min(600, Math.max(0, secs + d));
        save();
        render();
      };
      return b;
    };
    li.append(label, step(-15, '-15s', 'Shorter intro skip'), step(15, '+15s', 'Longer intro skip'));
    return li;
  }

  function resortShow(id) {
    const mine = state.order.filter((x) => eps[x] && eps[x].showId === id && x !== state.current);
    state.order = state.order.filter((x) => !mine.includes(x));
    mine.sort((a, b) => (eps[a].date || '').localeCompare(eps[b].date || ''));
    mine.forEach((x) => Q.insertEpisode(state, eps[x], eps));
  }

  // ---------- Drag to reorder (touch, mouse, and arrow keys) ----------
  function gripFor(name) {
    const g = iconBtn('grip', 'Move ' + name + '. Use arrow keys or drag.', 'grip', () => {});
    return g;
  }
  function sortable(list, onDone) {
    const items = () => [...list.children];
    list.querySelectorAll('.grip').forEach((grip) => {
      const item = grip.closest('[data-id]');
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const visual = item.classList.contains('row') ? item : item.querySelector('.row');
        visual.classList.add('dragging');
        const move = (ev) => {
          const y = ev.clientY;
          for (const other of items()) {
            if (other === item) continue;
            const r = other.getBoundingClientRect();
            const mid = r.top + r.height / 2;
            const itemAbove = item.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING;
            // Move the neighbor, not the dragged row: moving the row ends the drag.
            if (itemAbove && y > mid) { item.before(other); break; }
            if (!itemAbove && y < mid) { item.after(other); break; }
          }
          const box = $('view').getBoundingClientRect();
          if (y < box.top + 40) $('view').scrollTop -= 8;
          if (y > box.bottom - 40) $('view').scrollTop += 8;
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          visual.classList.remove('dragging');
          onDone(items().map((n) => n.dataset.id));
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      grip.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const sib = e.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
        if (!sib) return;
        if (e.key === 'ArrowUp') sib.before(item); else sib.after(item);
        const id = item.dataset.id;
        onDone(items().map((n) => n.dataset.id));
        const again = document.querySelector(`[data-id="${id}"] .grip`);
        if (again) again.focus();
      });
    });
  }

  // ---------- Player ----------
  function play(id) {
    const ep = eps[id];
    if (!ep) return;
    savePos();
    state.current = id;
    Q.moveToTop(state, id);
    audio.src = ep.url;
    audio.playbackRate = state.speed;
    const pos = startAt(id);
    if (pos) audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true });
    audio.play().catch(() => {});
    save();
    render();
    mediaSession(ep);
  }
  // Saved place first; otherwise jump past the show's intro.
  function startAt(id) {
    return state.pos[id] || (eps[id] && state.skip[eps[id].showId]) || 0;
  }
  function toggle() {
    if (!audio.src) { if (state.current) { restored = true; play(state.current); } return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function savePos() {
    if (state.current && audio.src && !isNaN(audio.currentTime) && audio.currentTime > 0) {
      state.pos[state.current] = audio.currentTime;
    }
  }
  // Keep playing within the same queue.
  function next(queue) {
    const id = state.order.find((x) => eps[x] && qOfEp(x) === queue);
    if (id) play(id);
    else { audio.removeAttribute('src'); audio.load(); render(); }
  }
  function done(id) {
    const wasCurrent = id === state.current;
    const queue = qOfEp(id);
    Q.finish(state, id);
    Q.topUp(state, feed, eps);
    save();
    if (wasCurrent) { if (audio.paused) { audio.removeAttribute('src'); audio.load(); render(); } else next(queue); }
    else render();
  }
  function restore() {
    if (restored || !state.current || !eps[state.current]) return;
    restored = true;
    const ep = eps[state.current];
    audio.src = ep.url;
    audio.playbackRate = state.speed;
    const pos = startAt(state.current);
    if (pos) audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true });
    mediaSession(ep);
    renderPlayer();
  }
  function renderPlayer() {
    const ep = state.current && eps[state.current];
    $('player').hidden = !ep;
    if (!ep) return;
    const show = shows[ep.showId];
    $('nowTitle').textContent = ep.title;
    $('nowShow').textContent = show ? show.title : '';
    $('speedBtn').textContent = state.speed + 'x';
    $('playBtn').innerHTML = audio.paused ? ICONS.play : ICONS.pause;
    $('playBtn').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    tick();
  }
  function tick() {
    const ep = state.current && eps[state.current];
    if (!ep) return;
    const dur = isFinite(audio.duration) && audio.duration ? audio.duration : ep.dur || 0;
    const t = audio.currentTime || state.pos[state.current] || 0;
    $('elapsed').textContent = Q.fmtTime(t);
    $('left').textContent = '-' + Q.fmtTime(dur - t);
    if (!$('seek').matches(':active')) $('seek').value = dur ? (t / dur) * 1000 : 0;
  }
  function mediaSession(ep) {
    if (!('mediaSession' in navigator)) return;
    const show = shows[ep.showId];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title,
      artist: show ? show.title : '',
      artwork: show && show.image ? [{ src: show.image, sizes: '512x512' }] : [],
    });
  }
  function jump(d) { audio.currentTime = Math.max(0, audio.currentTime + d); }

  audio.addEventListener('timeupdate', () => {
    tick();
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); savePos(); save(); }
  });
  audio.addEventListener('play', () => { render(); });
  audio.addEventListener('pause', () => { savePos(); save(); render(); });
  audio.addEventListener('ended', () => {
    const id = state.current;
    const queue = qOfEp(id);
    Q.finish(state, id);
    Q.topUp(state, feed, eps);
    save();
    next(queue);
  });
  audio.addEventListener('error', () => { if (audio.src) setStatus('Episode could not load'); });

  $('playBtn').onclick = toggle;
  $('backBtn').onclick = () => jump(-15);
  $('fwdBtn').onclick = () => jump(45);
  $('doneBtn').onclick = () => { if (state.current) done(state.current); };
  $('speedBtn').onclick = () => {
    state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
    audio.playbackRate = state.speed;
    save();
    renderPlayer();
  };
  $('seek').addEventListener('input', () => {
    if (isFinite(audio.duration)) audio.currentTime = ($('seek').value / 1000) * audio.duration;
  });
  $('refreshBtn').onclick = async () => {
    const btn = $('refreshBtn');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    setStatus('Checking...');
    await Promise.all([refresh(), new Promise((r) => setTimeout(r, 700))]);
    btn.classList.remove('busy');
  };
  $('tabQueue').onclick = () => { tab = 'queue'; render(); };
  $('tabShows').onclick = () => { tab = 'shows'; render(); };

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => jump(-15));
    ms.setActionHandler('seekforward', () => jump(45));
    ms.setActionHandler('nexttrack', () => { if (state.current) done(state.current); });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { savePos(); save(); } else refresh();
  });
  setInterval(refresh, REFRESH_MS);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  refresh();
})();
