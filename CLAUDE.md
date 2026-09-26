# band/tree

Personal project: search any band → every member → every other band they've played in, plus lineup timeline,
discography and album overviews. Owned by the **northernmile** GitHub account ("JH Projects").

## Hard rule: keep this separate from DwellSafe

This project must never touch anything DwellSafe / Prev-ai. Nothing goes in DwellSafe folders, no commits
under `jhills-DS` / `jhills@dwellsafe.ai`, and no pushes to the Prev-ai org.

- Repo-local identity: `JH Projects <103219990+northernmile@users.noreply.github.com>`. Don't change the global
  git config or GitHub Desktop (both are set up for DwellSafe work).
- Remote: `https://northernmile@github.com/northernmile/bandtree.git`, with credentials pinned to northernmile.
- `.git/hooks/pre-push` blocks any remote outside github.com/northernmile and any commit not signed by
  northernmile. Never bypass it (`--no-verify`).
- Before any commit or push, check `git remote -v` and `git config user.email`.

## Run

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

There's no build step, no dependencies to install, and no API keys. All of it lives in `index.html`: inline CSS
and JS, with D3 from cdnjs used for the timeline only.

## How it works

- **Data sources.** MusicBrainz is primary. When it lists no members, it falls back to Wikidata (exact, via the
  MusicBrainz ID; P527/P463 with start/end qualifiers), then Discogs: MusicBrainz's own `discogs` url-rel first,
  otherwise a name search that asks "which one?" via the `choose()` picker and remembers the answer in
  localStorage `dgtwin:<mbid>`. Artists that aren't on MusicBrainz at all open as `discogs:<id>` pages.
- **IDs.** An ID is a bare MusicBrainz UUID, `discogs:<n>`, or `wd:Q<n>` (Wikidata-only, can't be opened).
  `getArtist(id)` maps every source into one shape (MusicBrainz fields plus `.members` / `.bands`).
- **Rate limits.** `makeClient()` builds a single-flight queue per service. MusicBrainz gets about 1 request per
  second; Discogs gets about 1 per 2.5s, or 1 per 1.1s with the user's optional token in localStorage
  `discogsToken`. `priority: true` jumps the queue. Background requests carry `gen` and are dropped once the page
  changes.
- **Column navigator.** Each breadcrumb stop is a "stage" with three columns: info, list, and sub (the selected
  member's other bands). Stages sit side by side on one track that slides. The breadcrumb `trail`
  (sessionStorage) drives it, including the selected member (`sel`) per stage. On musician pages a band row opens
  that band directly (no third column).
- **Below the navigator.** The lineup timeline (D3) and the discography for the current stage.
- **Covers.** Cover Art Archive (release-group) first. If that 404s: iTunes, then Deezer (JSONP), then Wikipedia
  (`pilicense=any`), then other editions on Cover Art Archive, then Discogs. Discogs-only releases ask Discogs
  first. Results are cached in localStorage `cover3:<id>`, and misses are only cached when every source actually
  answered.
- **Album overlay.** Built from the MusicBrainz release plus Wikidata facts, a Wikipedia intro and the Cover Art
  Archive gallery, or from the Discogs master/release for Discogs items. The only links are Apple Music and
  Spotify, on purpose.
- **Artist photos.** Wikidata P18, then the Wikipedia page image (JPG only), pulled at a standard 960px Commons
  thumbnail width (custom widths are slow). Discogs images are used for Discogs artists.

## Known limits / ideas

- Big bands take 10–20s to fill in (MusicBrainz rate limit). A small caching server would fix this for public
  hosting.
- Discogs members have no dates or instruments, so they show as "dates unknown". Discogs release types are
  guessed from the format.
- Bandcamp-only releases get no cover (Bandcamp has no API).
- The single file is about 1,500 lines. Consider splitting it into modules: api, navigator, timeline, overlay.
