// Queue rules. No page or storage code here, so they can be tested alone.
(function (root) {
  const NEW_SHOW_EPISODES = 3; // A newly added show brings in only its latest few.

  function blankState() {
    return { rank: [], modes: {}, order: [], seen: {}, played: {}, pos: {}, current: null, speed: 1 };
  }

  function indexEpisodes(feed) {
    const map = {};
    for (const show of feed.shows || []) {
      for (const ep of show.episodes || []) map[ep.id] = { ...ep, showId: show.id };
    }
    return map;
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
      if (r < myRank || (r === myRank && mode === 'old')) at = i + 1;
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
      const list = [...(show.episodes || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const startFrom = isNewShow ? Math.max(0, list.length - NEW_SHOW_EPISODES) : 0;
      list.forEach((ep, i) => {
        const fresh = !state.seen[ep.id];
        state.seen[ep.id] = 1;
        if (fresh && i >= startFrom && !state.played[ep.id]) {
          insertEpisode(state, { ...ep, showId: show.id }, eps);
          added.push(ep.id);
        }
      });
    }
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

  function moveToTop(state, id) {
    state.order = [id, ...state.order.filter((x) => x !== id)];
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

  const api = { blankState, indexEpisodes, sync, applyRank, moveToTop, finish, insertEpisode, fmtTime };
  if (typeof module !== 'undefined') module.exports = api;
  root.Q = api;
})(typeof window !== 'undefined' ? window : globalThis);
