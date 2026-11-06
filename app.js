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
  function shortDate(d) {
    const t = d ? new Date(d) : null;
    return t && !isNaN(t) ? t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
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
      setStatus(added.length && state.seenBefore ? `${added.length} new` : checkedText());
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
    return 'Updated ' + new Date(feed.updated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function setStatus(t) { $('status').textContent = t; }

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
    if (!state.order.length) {
      const box = el('div', 'empty');
      box.append(el('strong', '', feed.shows && feed.shows.length ? 'You are caught up' : 'No shows yet'));
      box.append(el('span', '', feed.shows && feed.shows.length
        ? 'New episodes land here in your ranked order.'
        : 'Add show names to shows.json in your GitHub project. They appear here after the next refresh.'));
      view.append(box);
      return;
    }
    const list = el('ol');
    list.id = 'queue';
    let n = 0;
    state.order.forEach((id) => {
      const ep = eps[id];
      if (!ep) return;
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
      main.append(el('span', 'meta', [show && show.title, shortDate(ep.date), timeText].filter(Boolean).join(' · ')));
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
    sortable(list, (ids) => {
      const cur = state.current;
      state.order = cur && ids.includes(cur) ? [cur, ...ids.filter((x) => x !== cur)] : ids;
      save();
      render();
    });
  }

  function renderShows(view) {
    const list = el('ol');
    list.id = 'ranks';
    state.rank.filter((id) => shows[id]).forEach((id, i) => {
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
      const hint = el('p', 'hint', 'Drag shows to rank them. The queue follows, and new episodes land by rank. ');
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
      state.rank = [...ids, ...state.rank.filter((x) => !ids.includes(x))];
      Q.applyRank(state, feed);
      save();
      render();
    });
  }

  function backCatalog(show) {
    const ul = el('ul', 'back');
    ul.style.listStyle = 'none';
    ul.style.margin = '0';
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
    const pos = state.pos[id] || 0;
    if (pos) audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true });
    audio.play().catch(() => {});
    save();
    render();
    mediaSession(ep);
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
  function next() {
    const id = state.order.find((x) => eps[x]);
    if (id) play(id);
    else { audio.removeAttribute('src'); audio.load(); render(); }
  }
  function done(id) {
    const wasCurrent = id === state.current;
    Q.finish(state, id);
    save();
    if (wasCurrent) { if (audio.paused) { audio.removeAttribute('src'); audio.load(); render(); } else next(); }
    else render();
  }
  function restore() {
    if (restored || !state.current || !eps[state.current]) return;
    restored = true;
    const ep = eps[state.current];
    audio.src = ep.url;
    audio.playbackRate = state.speed;
    const pos = state.pos[state.current] || 0;
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
    Q.finish(state, id);
    save();
    next();
  });
  audio.addEventListener('error', () => { if (audio.src) setStatus('Episode could not load'); });

  $('playBtn').onclick = toggle;
  $('backBtn').onclick = () => jump(-15);
  $('fwdBtn').onclick = () => jump(30);
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
    await refresh();
    btn.classList.remove('busy');
  };
  $('tabQueue').onclick = () => { tab = 'queue'; render(); };
  $('tabShows').onclick = () => { tab = 'shows'; render(); };

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => jump(-15));
    ms.setActionHandler('seekforward', () => jump(30));
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
