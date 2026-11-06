// Finds each show in shows.json, reads its feed, and writes feeds.json for the app.
// A feed that fails keeps its last good episodes.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const KEEP = 30; // Episodes kept per show.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', trimValues: true, parseTagValue: false, parseAttributeValue: false, htmlEntities: true });
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseDuration(v) {
  const s = text(v);
  if (!s) return 0;
  return s.split(':').reduce((t, p) => t * 60 + (Number(p) || 0), 0);
}

const dayName = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' });

// Optional limits on a show: "match" (words or pattern in the title) and "days" (such as ["Fri"]).
export function keepEpisode(ep, { match, days } = {}) {
  if (match && !new RegExp(match, 'i').test(ep.title)) return false;
  if (days && days.length && !(ep.date && days.includes(dayName(ep.date)))) return false;
  return true;
}

export function parseFeed(xml, feedUrl, limits = {}) {
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel) throw new Error('Not an RSS podcast feed');
  const images = list(channel['itunes:image']);
  const episodes = list(channel.item)
    .map((item) => {
      const enclosure = list(item.enclosure).find((e) => e['@url']);
      if (!enclosure) return null;
      const date = new Date(text(item.pubDate));
      return {
        id: sha(feedUrl + '|' + (text(item.guid) || enclosure['@url'])),
        title: text(item.title) || 'Untitled episode',
        date: isNaN(date) ? '' : date.toISOString(),
        dur: parseDuration(item['itunes:duration']),
        url: enclosure['@url'],
      };
    })
    .filter((ep) => ep && keepEpisode(ep, limits))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, KEEP);
  return {
    id: sha(feedUrl),
    title: text(channel.title) || feedUrl,
    image: images[0]?.['@href'] || text(channel.image?.url),
    feed: feedUrl,
    episodes,
  };
}

// Pick the Apple Podcasts result for a show name. "by" narrows it to a publisher.
export function pickResult(results, name, by) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const usable = results.filter((r) => r.feedUrl);
  const pool = by ? usable.filter((r) => norm(r.artistName).includes(norm(by))) : usable;
  return pool.find((r) => norm(r.collectionName) === norm(name)) || pool[0] || null;
}

// Use the show's Apple Podcasts ID when a name search lands on the wrong show.
async function lookupFeed(id) {
  const res = await fetch(`https://itunes.apple.com/lookup?entity=podcast&id=${id}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Apple lookup HTTP ' + res.status);
  const hit = ((await res.json()).results || []).find((r) => r.feedUrl);
  if (!hit) throw new Error('No feed for Apple ID ' + id);
  console.log(`Apple ID ${id} is "${hit.collectionName}" by ${hit.artistName}`);
  return hit.feedUrl;
}

async function findFeed(name, by) {
  const url = 'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=' + encodeURIComponent(name);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Apple search HTTP ' + res.status);
  const hit = pickResult((await res.json()).results || [], name, by);
  if (!hit) throw new Error('No podcast found');
  console.log(`"${name}" matched "${hit.collectionName}" by ${hit.artistName}`);
  return hit.feedUrl;
}

// Turn Apple episode search results into a show of everything naming this person or topic.
export function episodesFromSearch(results, term, subscribed, from, since, except = []) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const phrase = norm(term);
  const oldest = since ? new Date(since).getTime() : Date.now() - 365 * 864e5;
  const seen = new Set();
  return results
    .filter((r) => r.episodeUrl && !subscribed.has(r.feedUrl))
    .filter((r) => !except.some((x) => norm(r.collectionName).includes(norm(x))))
    .filter((r) => (from
      ? norm(r.collectionName).includes(norm(from))
      : norm(`${r.trackName} ${r.description} ${r.shortDescription}`).includes(phrase)))
    .filter((r) => new Date(r.releaseDate).getTime() >= oldest)
    .map((r) => ({
      id: sha(`search|${r.episodeGuid || r.episodeUrl}`),
      title: from ? r.trackName : `${r.collectionName}: ${r.trackName}`,
      date: r.releaseDate ? new Date(r.releaseDate).toISOString() : '',
      dur: Math.round((r.trackTimeMillis || 0) / 1000),
      url: r.episodeUrl,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((ep) => {
      const key = norm(from ? ep.title : ep.title.slice(ep.title.indexOf(': ') + 2));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, KEEP);
}

async function searchEpisodes(term, title, subscribed, from, since, except) {
  const url = 'https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=200&term=' + encodeURIComponent(term);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Apple search HTTP ' + res.status);
  const episodes = episodesFromSearch((await res.json()).results || [], term, subscribed, from, since, except);
  console.log(`Search "${term}" found ${episodes.length} episodes`);
  return { id: sha('search:' + term), title, image: '', feed: 'search:' + term, episodes, ...(since ? { addAll: true } : {}) };
}

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

async function readShow(entry, found, prior) {
  const { name, by, match, days, watch, watchLabel, appleId } = typeof entry === 'string' ? { name: entry } : entry;
  const isLink = /^https?:\/\//i.test(name);
  let url = isLink ? name : found[name];
  try {
    if (!url) url = found[name] = appleId ? await lookupFeed(appleId) : await findFeed(name, by);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RunningOrder/1.0 (personal podcast player)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ...parseFeed(await res.text(), url, { match, days }), ...(watch ? { watch, watchLabel } : {}) };
  } catch (e) {
    console.error(`Could not read ${name}: ${e.message}`);
    const keep = { id: sha(url || name), title: name, image: '', feed: url || name, episodes: [], ...prior[url] };
    return { ...keep, error: true };
  }
}

async function main() {
  const { shows: wanted } = await readJson('shows.json', { shows: [] });
  const old = await readJson('feeds.json', { shows: [] });
  const found = await readJson('resolved.json', {}); // Name to feed link, kept so a show stays matched.
  const prior = Object.fromEntries(old.shows.map((s) => [s.feed, s]));

  const shows = new Array(wanted.length);
  await Promise.all(wanted.map(async (entry, i) => {
    if (!entry.search) shows[i] = await readShow(entry, found, prior);
  }));

  // Searches run one at a time so Apple does not refuse them, and they skip shows you already follow.
  const subscribed = new Set(shows.filter(Boolean).map((s) => s.feed));
  for (const [i, entry] of wanted.entries()) {
    if (!entry.search) continue;
    const title = entry.title || entry.search;
    try {
      await new Promise((r) => setTimeout(r, 4000));
      shows[i] = await searchEpisodes(entry.search, title, subscribed, entry.from, entry.since, entry.except);
    } catch (e) {
      console.error(`Could not search ${entry.search}: ${e.message}`);
      const feed = 'search:' + entry.search;
      shows[i] = { id: sha(feed), title, image: '', feed, episodes: [], ...prior[feed], error: true };
    }
  }

  const same = JSON.stringify(shows) === JSON.stringify(old.shows);
  const out = { updated: same && old.updated ? old.updated : new Date().toISOString(), shows };
  await writeFile('feeds.json', JSON.stringify(out));
  await writeFile('resolved.json', JSON.stringify(found, null, 2));
  console.log(`${shows.length} shows, ${same ? 'no changes' : 'updated'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
