# band/tree

Search any band and explore every member, every band they've played in, and the full discography.

A single static page (`public/index.html`), no build step. Hosted on Cloudflare Pages, where lookups go through a
small caching function (`functions/api/fetch.js`); locally the page asks the sources directly: MusicBrainz (primary), Wikidata, Discogs, Wikipedia, Cover Art Archive,
iTunes and Deezer.

## Run locally

```sh
cd public && python3 -m http.server 8765
```

Then open http://localhost:8765.
