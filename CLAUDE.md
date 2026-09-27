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
- **Same-name artists.** `notable()` ranks same-name matches by fame (number of Wikipedia language editions, one
  Wikidata query). One 3x better known than the rest: go straight there; otherwise ask among comparable ones only.
- **Descriptions.** `loadBlurb()`: Wikipedia's first 1–2 sentences, else Wikidata's description, MusicBrainz's
  note, Discogs' profile (`shortBlurb` skips sentences broken by unresolved links), else one built from the data.
  Albums use their Wikipedia intro or "1997 album by X".
- **How are these connected?** Header button (`openConnect`). `findPath()` is a bidirectional breadth-first search
  over the member graph (band -> members -> their bands), growing the smaller side, capped at ~150 lookups;
  `openPath()` lays the chain out as the breadcrumb trail. Shareable as `#connect:<id>:<id>`.
- **Listen as you browse.** iTunes Search API 30-second previews (`artistSongs`, `albumSongs`, with a song-search
  fallback for reissued titles). Mini player bottom right survives navigation.
- **Browse.** `#browse` index of curated labels / cities / styles plus free search; `#browse:<type>:<name>` lists
  artists: label = its releases on MusicBrainz; city = Wikidata "location of formation" + MusicBrainz area search
  (untagged results dropped); scene = MusicBrainz tag in the artist's top 3. Ranked by Wikipedia language count.
  City and scene pages (`renderEras`) group bands by the decade they formed with a sticky decade strip; per decade
  the top 3 (if well known) get big photo cards, the next 6 medium, the rest small. `sharedMembers()` (one Wikidata
  SPARQL, sent as POST because the ID list is too long for a URL) badges bands that shared members; hover draws lines
  to them with the names. Label pages still use the plain grid.
- **Story pages.** `#story:trail:<n>` and `#story:connect:<id>:<id>` (`renderStory`). Trails use `TRAILS` waypoints,
  each hop verified with `findPath` (`trailPath`). Each band is a big stop (photo, years, 2-sentence Wikipedia intro,
  Listen / Open / "Other members' bands" side branches via `showBranches`); people between bands are link cards with
  what they did in each (from the band's member list first). A sticky strip at the top is the whole chain, highlights
  the stop you're reading and jumps on click. Connection results offer "See the story" and "Open as a trail".
  Note: `closeTool()` bumps `connectRun`, so call it before capturing the run counter.
- **Family tree.** `openTree()` on bands with 4+ connected bands: line-ups (from member stints) down the middle,
  members' earlier bands left, later/parallel right, SVG connectors to the nearest line-up in time. Paper + Special
  Elite font; print CSS; shareable as `#tree:<id>`.
- **Column navigator.** Each breadcrumb stop is a "stage" with three columns: info, list, and sub (the selected
  member's other bands). Stages sit side by side on one track that slides. The breadcrumb `trail`
  (sessionStorage) drives it, including the selected member (`sel`) per stage. On musician pages a band row opens
  that band directly (no third column).
- **Below the navigator.** The lineup timeline (D3) and the discography for the current stage.
- **Covers.** Cover Art Archive (release-group) first. If that 404s: iTunes, then Deezer (JSONP), then Wikipedia
  (`pilicense=any`), then other editions on Cover Art Archive, then Discogs. Discogs-only releases ask Discogs
  first. Results are cached in localStorage `cover3:<id>`, and misses are only cached when every source actually
  answered.
- **Merged member lists.** MusicBrainz is often incomplete, so `mergeMembers()` also adds whoever Discogs lists for
  the exact artist MusicBrainz links to (never a name guess) and, for bands, the Members rows of the band's own
  Wikipedia infobox. Matched by name; MusicBrainz entries win. Header reads "via MusicBrainz + Discogs".
- **Lineup dates.** When members come back without dates, `fillDates()` rolls over per member: Wikidata (band P527,
  then each member's own P463 via SPARQL), then the Members section of the band's Wikipedia article
  ("Name – vocals (1987–1999, 2017–present)"). Wikipedia can also add missing members. Existing dates always win;
  the list header says "dates via …".
- **Band-wide credits.** Once a band's releases are in, `loadBandCredits()` reads the credits of every album and EP
  (up to 15, background queue, cached) via `recordCredits()`: MusicBrainz, then the Discogs master its release group
  links to. From that: each member's usual role, "on N of M records" on album pages, "Regular collaborators" (2+
  records) on the band page, a stand-in line-up for records with no credits (nearest credited record), and years
  for members with no dates: one stint per run of records (a gap over 3 years starts a new one), drawn faded on
  the timeline. (Line-up cards were tried and dropped in favour of the timeline.)
- **Members from records.** Anyone who plays on at least half of a band's credited records joins its member list
  (Wikipedia's "additional musicians" never do). Singles-only bands use their singles as the records.
- **Core members.** `memberTiers()` splits bands of 5+ members: core = founder (marked, or joined the year the band
  formed), 5+ years in the band, or on 20%+ of the credited records (min 2). Core are ranked first; everyone else
  folds under "Also in the band". Heuristic — someone who mostly played live can land in the fold.
- **One name, one role.** `normRole()` folds source wording into a short set (bass, drums, vocals, producer…);
  `sameName()` matches "David Wm. Sims" = "David Sims" and nicknames ("Jim" = "James"). Album credits use the band
  page's names and order.
- **Album credits source order.** The album's Wikipedia "Personnel" section first (`wikipediaPersonnel()`, keeps its
  band / additional musicians / production groups, names linked to MusicBrainz IDs via Wikidata), then MusicBrainz,
  then Discogs. MusicBrainz/Discogs only add production people Wikipedia leaves out. The band-wide pass uses the
  same order.
- **Album page player and description.** One description at the top: the record's own Wikipedia intro (a guessed
  article is kept only if its first sentence is about a record, so self-titled albums don't show the band's page),
  else a plain line. Label is a link to its browse page. The player is Apple Music's embed (album ID from Wikidata
  P2281, else iTunes search, else the artist's iTunes album list) with a Spotify tab when Wikidata has P2205; full
  songs when signed in to that service in the browser, previews otherwise. Embeds are parked and re-mounted with
  `moveBefore` across re-renders (`parkEmbeds`/`mountEmbeds`) so playback survives. The Apple embed does not render
  in the automation browser (incognito), so check it in normal Chrome.
- **No source credits in the UI.** Per Jonathan, no "via MusicBrainz / Discogs / Wikipedia" lines, photo credits or
  CC BY-SA lines anywhere on the site.
- **Album pages.** Clicking a record opens it as a stop on the trail (`album:<release-group MBID>` or
  `album:dg-master-<id>`): cover, facts, Wikipedia notes · credits (who played on it, then production) · the selected
  person's other bands. Credits: MusicBrainz release + per-track credits, then Discogs credits, then the band's lineup
  the year it came out. Below: tracklist, then the band's discography. The old overlay code (`openAlbum`) is unused.
- **Home page.** Full-screen `hero.mp4` loop (phones and reduced-motion get `hero.jpg`). `hero.mov` is the original
  and is git-ignored (over GitHub's 100 MB limit).
- **Artist photos.** Wikidata P18, then the Wikipedia page image (JPG only), pulled at a standard 960px Commons
  thumbnail width (custom widths are slow). Discogs images are used for Discogs artists.

## Known limits / ideas

- Big bands take 10–40s to fill in the first time (MusicBrainz rate limit). Every API answer is then kept in this
  browser's IndexedDB (`diskCache`, 3 weeks), so repeat visits take a couple of seconds. A shared caching server is
  the next step for public hosting.
- Discogs members have no dates or instruments, so they show as "dates unknown". Discogs release types are
  guessed from the format.
- Bandcamp-only releases get no cover (Bandcamp has no API).
- The single file is about 1,500 lines. Consider splitting it into modules: api, navigator, timeline, overlay.
