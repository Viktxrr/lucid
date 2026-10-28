/*
 * Port of Lucid's real metadata cleaner (src/services/metadata/metadataSanitizer.ts).
 * Same regexes and decision order as the app, so the page shows what the app does.
 * Adds junkRanges() for display: which character ranges of a file name the cleaner drops.
 */
(function (global) {
  const UNKNOWN_ARTIST = 'Unknown Artist';
  const UNTITLED = 'Unknown Title';
  const SEPARATOR = /\s+[-–—]\s+/;
  const TRACK_NUMBER = /^\d{1,3}\s*[-–—._)]\s*/;
  const JUNK_PHRASES = [
    String.raw`(?:official\s+)?(?:hd\s+|hq\s+|4k\s+)?(?:music\s+)?(?:video|audio)`,
    String.raw`official`,
    String.raw`lyrics?(?:\s+video)?`,
    String.raw`visuali[sz]er`,
    String.raw`unreleased(?:\s+song|\s+track)?`,
    String.raw`leak(?:ed)?`,
    String.raw`high\s+quality`,
    String.raw`best\s+quality`,
    String.raw`hq|hd|4k|cdq`,
    String.raw`explicit|clean`,
    String.raw`\d{3}\s*kbps`,
    String.raw`mp3|m4a`,
    String.raw`free\s+download|out\s+now`,
  ];
  const BRACKET_JUNK = `(?:${JUNK_PHRASES.join('|')})`;
  const TRAILING_JUNK = `(?:${[
    String.raw`official\s+(?:music\s+)?(?:video|audio)`,
    String.raw`lyric\s+video`,
    String.raw`unreleased`,
    String.raw`leaked`,
    String.raw`high\s+quality`,
    String.raw`best\s+quality`,
    String.raw`hq|hd|cdq`,
    String.raw`\d{3}\s*kbps`,
    String.raw`visuali[sz]er`,
  ].join('|')})`;
  const BRACKETED_NOISE = new RegExp(String.raw`\s*[(\[{【]\s*${BRACKET_JUNK}\s*[)\]}】]`, 'gi');
  const TRAILING_NOISE = new RegExp(String.raw`(?:\s+[-–—|]\s*|\s+)${TRAILING_JUNK}\s*$`, 'i');
  const EXTENSION = /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|alac|wma)$/i;
  const TOPIC_SUFFIX = /\s+-\s+topic$/i;
  const PLACEHOLDER_ARTISTS = new Set(['unknown', 'unknown artist', 'unbekannt', 'unbekannter künstler', 'artist', 'various',
    'various artists', 'va', 'n/a', 'na', 'none', 'null', 'undefined', 'track', 'audio', '<unknown>']);

  const tidy = (s) => s.replace(/\s+/g, ' ').trim();
  const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function cleanPart(raw) {
    let s = raw.replace(/\s_\s/g, ' - ');
    s = s.replace(/_/g, ' ');
    s = tidy(s).replace(EXTENSION, '');
    s = tidy(s.replace(BRACKETED_NOISE, ''));
    for (let next = s.replace(TRAILING_NOISE, ''); next !== s && next.trim();) {
      s = tidy(next);
      next = s.replace(TRAILING_NOISE, '');
    }
    s = s.replace(TRACK_NUMBER, '');
    return tidy(s);
  }

  function isSuspiciousArtist(artist) {
    if (!artist) return true;
    const a = tidy(artist);
    if (a.length < 3) return true;
    if (PLACEHOLDER_ARTISTS.has(a.toLowerCase())) return true;
    if (/^\d+$/.test(a)) return true;
    if (/^(https?:\/\/|www\.)|\.(com|net|org|to|io|cc|ru)\b/i.test(a)) return true;
    return false;
  }

  function splitArtistTitle(s) {
    const parts = s.split(SEPARATOR).map(tidy).filter(Boolean);
    if (parts.length < 2) return null;
    const [artist, ...rest] = parts;
    return [artist, rest.join(' - ')];
  }

  function fixCase(s) {
    if (s !== s.toLowerCase() || s === s.toUpperCase()) return s;
    return s.replace(/(^|[\s(\-/&])(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase());
  }

  function sameArtist(candidate, artist) {
    const a = normalize(candidate);
    const b = normalize(artist);
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  }

  function sanitizeMetadata(rawTitle, rawArtist, filename) {
    const tagArtist = rawArtist ? tidy(rawArtist).replace(TOPIC_SUFFIX, '') : '';
    const artistOk = !isSuspiciousArtist(tagArtist);
    const title = rawTitle ? cleanPart(rawTitle) : '';
    const file = cleanPart(filename);
    const titleSplit = title ? splitArtistTitle(title) : null;
    const fileSplit = splitArtistTitle(file);
    let artist, finalTitle, artistParsed = false, titleParsed = false;

    if (titleSplit && (!artistOk || sameArtist(titleSplit[0], tagArtist))) {
      artist = artistOk ? tagArtist : titleSplit[0];
      artistParsed = !artistOk;
      finalTitle = titleSplit[1];
      titleParsed = true;
    } else if (title && artistOk) {
      artist = tagArtist;
      finalTitle = title;
    } else if (title) {
      artist = fileSplit ? fileSplit[0] : UNKNOWN_ARTIST;
      artistParsed = !!fileSplit;
      finalTitle = title;
    } else if (fileSplit && (!artistOk || sameArtist(fileSplit[0], tagArtist))) {
      artist = artistOk ? tagArtist : fileSplit[0];
      artistParsed = !artistOk;
      finalTitle = fileSplit[1];
      titleParsed = true;
    } else {
      artist = artistOk ? tagArtist : UNKNOWN_ARTIST;
      finalTitle = file || tidy(filename);
      titleParsed = true;
    }
    artist = tidy(artist);
    finalTitle = tidy(finalTitle);
    return {
      artist: (artistParsed ? fixCase(artist) : artist) || UNKNOWN_ARTIST,
      title: (titleParsed ? fixCase(finalTitle) : finalTitle) || UNTITLED,
    };
  }

  /** Character ranges [start, end) of `name` that the cleaner throws away, for highlighting. */
  function junkRanges(name) {
    const ranges = [];
    const add = (re) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(name))) {
        ranges.push([m.index, m.index + m[0].length]);
        if (!re.global) break;
      }
    };
    const shown = name.replace(/_/g, ' ');
    add(EXTENSION);
    add(new RegExp(BRACKETED_NOISE.source, 'gi'));
    const lead = TRACK_NUMBER.exec(shown);
    if (lead) ranges.push([0, lead[0].length]);
    // trailing junk words, repeated like cleanPart does, on the name without brackets/extension
    let end = shown.length;
    const ext = EXTENSION.exec(shown);
    if (ext) end = ext.index;
    let head = shown.slice(0, end);
    for (;;) {
      const stripped = head.replace(new RegExp(BRACKETED_NOISE.source, 'gi'), (m) => ' '.repeat(m.length));
      const t = TRAILING_NOISE.exec(stripped.replace(/\s+$/, (m) => m));
      if (!t || !stripped.slice(0, t.index).trim()) break;
      ranges.push([t.index, t.index + t[0].length]);
      head = head.slice(0, t.index);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    return merged;
  }

  global.LucidClean = { sanitizeMetadata, junkRanges, cleanPart };
  if (typeof module !== 'undefined') module.exports = global.LucidClean;
})(typeof window !== 'undefined' ? window : globalThis);
