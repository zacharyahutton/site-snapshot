# site-snapshot

A small Node.js command line tool that saves a website, with its HTML, CSS, JavaScript and images, into a dated folder so you can browse it offline.

I built it because I kept needing a local copy of a site before planning a rebuild: to see how pages link together, what assets they load, and how the content is structured, without clicking around the live site over and over.

## Features

- Two presets: `quick` (depth 1, about 8 pages) and `full` (depth 3, about 40 pages), or set depth and page limits yourself
- Uses `wget --mirror` when it is installed, and falls back to a pure Node scraper (`website-scraper`) when it is not
- Optional zip of the finished snapshot
- `--insecure` flag for sites with expired or self-signed certificates
- Writes a `META.md` next to every snapshot with the URL, engine, depth, timings and status

## Stack

Node.js 18+, `website-scraper`, `archiver`, and optionally GNU wget.

## How it works

1. `bin/site-snapshot.js` parses the command line flags and calls `mirrorSite()` in `lib/mirror.js`.
2. `mirrorSite()` normalises the URL, builds a slug from the hostname, and creates `snapshots/<date>-<slug>/`.
3. It looks for wget on the PATH (and the WinGet links folder on Windows). If wget is there and the engine is `auto` or `wget`, it runs a recursive mirror with page requisites and converted links.
4. If wget is missing or fails, it runs `website-scraper` with the same depth and page limits.
5. It writes `META.md` and `NOTES.md`, and zips the folder if `--zip` was passed.

## Setup

```bash
git clone https://github.com/zacharyahutton/site-snapshot.git
cd site-snapshot
npm install
```

## Usage

```bash
node bin/site-snapshot.js https://example.com --mode quick
node bin/site-snapshot.js https://example.org --mode full --zip
node bin/site-snapshot.js https://example.org --engine node --max-pages 20 --out ./my-snapshots
```

| Flag | What it does |
|------|--------------|
| `--mode quick\|full` | Preset depth and page limit (default `quick`) |
| `--depth <n>` | Override link depth |
| `--max-pages <n>` | Page cap for the Node engine |
| `--engine auto\|wget\|node` | Force an engine |
| `--slug <name>` | Folder name instead of the hostname |
| `--zip` | Also write a zip |
| `--insecure` | Skip TLS verification |
| `--out <path>` | Output root (default `./snapshots`) |

## Project structure

```
bin/site-snapshot.js   CLI entry point and flag parsing
lib/mirror.js          wget and Node engines, META file, zip
```

## Responsible use

Only snapshot sites you own or have permission to study, and respect robots.txt and the site's terms. This is for offline review, not for republishing someone else's work.

## Roadmap

- Respect robots.txt automatically in the Node engine
- Report of broken links and missing assets after a run
- Tests for flag parsing and slug generation
