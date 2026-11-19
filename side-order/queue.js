// Queue rules. No page or storage code here, so they can be tested alone.
(function (root) {
  const NEW_SHOW_EPISODES = 3; // A newly added show brings in only its latest few.
  const SERIAL_AHEAD = 3; // Story shows keep this many upcoming episodes queued.

  function blankState() {
    return { rank: [], modes: {}, order: [], seen: {}, played: {}, pos: {}, backfilled: {}, skip: {}, showQueue: {}, view: 'Main', orderVersion: '', current: null, speed: 1 };
  }

  function indexEpisodes(feed) {
    const map = {};
    for (const show of feed.shows || []) {
      for (const ep of show.episodes || []) map[ep.id] = { ...ep, showId: show.id };
    }
    return map;
  }

  // Calendar day in Pacific time, such as 2026-11-19.
  function dayOf(ep) {
    if (!ep || !ep.date) return '';
    return new Date(ep.date).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }
  // "Newest day first": a later day plays first, and each day plays in hour order.
  function dayBefore(other, ep) {
    const a = dayOf(other), b = dayOf(ep);
    return a > b || (a === b && (other.date || '') < (ep.date || ''));
  }

  function rankOf(state, showId) {
    const i = state.rank.indexOf(showId);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }

  // Ranked placement: below every higher-ranked show. Within its own show the
  // episode goes first (newest-first shows) or last (oldest-first shows).
  function insertEpisode(state, ep, eps) {
    if (state.order.includes(ep.id)) return;
    const myRank = rankOf(state, ep.showId);
    const mode = state.modes[ep.showId] || 'new';
    let at = state.current && state.order[0] === state.current ? 1 : 0;
    for (let i = at; i < state.order.length; i++) {
      const other = eps[state.order[i]];
      if (!other) continue;
      const r = rankOf(state, other.showId);
      const sameShowFirst = r === myRank && (mode === 'old' || (mode === 'day' && dayBefore(other, ep)));
      if (r < myRank || sameShowFirst) at = i + 1;
    }
    state.order.splice(at, 0, ep.id);
  }

  // Bring saved state up to date with the latest feed. Returns the new episodes queued.
  function sync(state, feed) {
    const eps = indexEpisodes(feed);
    const added = [];
    for (const show of feed.shows || []) {
      const isNewShow = !state.rank.includes(show.id);
      if (isNewShow) state.rank.push(show.id);
      // Story shows play from the start; topUp keeps their next episodes queued.
      if (show.serial) {
        if (isNewShow && !state.modes[show.id]) state.modes[show.id] = 'old';
        for (const ep of show.episodes || []) state.seen[ep.id] = 1;
        continue;
      }
      const list = [...(show.episodes || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      // Searches with a start date bring in everything since that date, once.
      const addAll = show.addAll && !state.backfilled[show.id];
      if (addAll) state.backfilled[show.id] = 1;
      // "startDate" in shows.json starts a new show with everything since that date.
      const since = show.startDate ? new Date(show.startDate).getTime() : NaN;
      const fromDate = list.findIndex((ep) => new Date(ep.date).getTime() >= since);
      const startFrom = !isNewShow || addAll ? 0
        : !isNaN(since) ? (fromDate === -1 ? list.length : fromDate)
        : Math.max(0, list.length - NEW_SHOW_EPISODES);
      list.forEach((ep, i) => {
        const fresh = addAll || !state.seen[ep.id];
        state.seen[ep.id] = 1;
        if (fresh && i >= startFrom && !state.played[ep.id] && !state.order.includes(ep.id)) {
          insertEpisode(state, { ...ep, showId: show.id }, eps);
          added.push(ep.id);
        }
      });
    }
    added.push(...topUp(state, feed, eps));
    applyOrder(state, feed, eps);
    applyDayFirst(state, feed, eps);
    // Drop queue entries that aged out of the feed, except the one playing.
    state.order = state.order.filter((id) => eps[id] || id === state.current);
    return added;
  }

  // After re-ranking shows, the queue follows. Order within each show is kept.
  function applyRank(state, feed) {
    const eps = indexEpisodes(feed);
    const playing = state.current && state.order[0] === state.current ? [state.order[0]] : [];
    const rest = state.order.slice(playing.length);
    const sorted = rest
      .map((id, i) => ({ id, i, r: eps[id] ? rankOf(state, eps[id].showId) : Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.id);
    state.order = [...playing, ...sorted];
  }

  // A new ranking from shows.json is applied once; later drags on the phone stay put.
  function applyOrder(state, feed, eps) {
    const o = feed.order;
    if (!o || !o.version || o.version === state.orderVersion) return;
    const ids = o.ids.filter((id) => state.rank.includes(id));
    state.rank = [...ids, ...state.rank.filter((x) => !ids.includes(x))];
    for (const id of o.old || []) state.modes[id] = 'old';
    applyRank(state, feed);
    // Shows switched to oldest first: re-sort their queued episodes by date.
    for (const id of o.old || []) {
      const mine = state.order.filter((x) => eps[x] && eps[x].showId === id && x !== state.current);
      const sorted = [...mine].sort((a, b) => (eps[a].date || '').localeCompare(eps[b].date || ''));
      state.order = reorderSubset(state.order, sorted);
    }
    state.orderVersion = o.version;
  }

  // Shows set to "newest day first" in shows.json: switch once, then re-sort their queued episodes.
  function applyDayFirst(state, feed, eps) {
    const d = feed.dayFirst;
    if (!d || !d.version || d.version === state.dayVersion) return;
    for (const id of d.ids || []) {
      state.modes[id] = 'day';
      const mine = state.order.filter((x) => eps[x] && eps[x].showId === id && x !== state.current);
      const sorted = [...mine].sort((a, b) => (dayBefore(eps[a], eps[b]) ? -1 : dayBefore(eps[b], eps[a]) ? 1 : 0));
      state.order = reorderSubset(state.order, sorted);
    }
    state.dayVersion = d.version;
  }

  // Keep the next few unplayed episodes of each story show in the queue, oldest first.
  function topUp(state, feed, eps = indexEpisodes(feed)) {
    const added = [];
    for (const show of feed.shows || []) {
      if (!show.serial) continue;
      const list = [...(show.episodes || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let queued = list.filter((ep) => state.order.includes(ep.id)).length;
      for (const ep of list) {
        if (queued >= SERIAL_AHEAD) break;
        if (state.played[ep.id] || state.order.includes(ep.id)) continue;
        insertEpisode(state, { ...ep, showId: show.id }, eps);
        added.push(ep.id);
        queued++;
      }
    }
    return added;
  }

  // Which queue a show belongs to: your choice on the phone, then shows.json, then Main.
  function queueOf(state, show) {
    return (show && ((state.showQueue || {})[show.id] || show.queue)) || 'Main';
  }

  // Put a reordered subset back into the full list, in the slots the subset held.
  function reorderSubset(full, subset) {
    const members = new Set(subset);
    let k = 0;
    return full.map((id) => (members.has(id) ? subset[k++] : id));
  }

  function moveToTop(state, id) {
    state.order = [id, ...state.order.filter((x) => x !== id)];
  }

  // Play next: just under the episode playing now, or first if nothing is playing.
  function playNext(state, id) {
    if (id === state.current) return;
    const rest = state.order.filter((x) => x !== id);
    const at = state.current && rest[0] === state.current ? 1 : 0;
    rest.splice(at, 0, id);
    state.order = rest;
  }

  function moveToBottom(state, id) {
    if (id === state.current) return;
    state.order = [...state.order.filter((x) => x !== id), id];
  }

  function finish(state, id) {
    state.played[id] = 1;
    delete state.pos[id];
    state.order = state.order.filter((x) => x !== id);
    if (state.current === id) state.current = null;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  const api = { blankState, indexEpisodes, sync, applyRank, moveToTop, playNext, moveToBottom, dayOf, finish, insertEpisode, fmtTime, topUp, queueOf, reorderSubset };
  if (typeof module !== 'undefined') module.exports = api;
  root.Q = api;
})(typeof window !== 'undefined' ? window : globalThis);
