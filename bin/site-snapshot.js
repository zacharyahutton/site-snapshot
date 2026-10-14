#!/usr/bin/env node
'use strict';

const path = require('path');
const { mirrorSite } = require('../lib/mirror');

function usage() {
  console.log(`site-snapshot: save a website for offline review

Usage:
  node bin/site-snapshot.js <url> [options]

Options:
  --mode quick|full     Default: quick (depth 1, ~8 pages) | full (depth 3, ~40)
  --depth <n>           Override recursion depth
  --max-pages <n>       Cap for Node scraper fallback
  --slug <name>         Folder slug (default from hostname)
  --engine auto|wget|node
  --zip                 Also write a zip of the mirror files
  --insecure            Skip TLS cert verification (expired/self-signed SSL)
  --out <abs-path>      Output folder (default ./snapshots)

Examples:
  node bin/site-snapshot.js https://example.com --mode quick
  node bin/site-snapshot.js https://example.org --mode full --zip
  node bin/site-snapshot.js https://self-signed.example --mode quick --insecure
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--zip') args.zip = true;
    else if (a === '--insecure') args.insecure = true;
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--depth') args.depth = Number(argv[++i]);
    else if (a === '--max-pages') args.maxPages = Number(argv[++i]);
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--engine') args.engine = argv[++i];
    else if (a === '--out') args.mirrorsRoot = argv[++i];
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._[0]) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const result = await mirrorSite({
    url: args._[0],
    mode: args.mode,
    depth: args.depth,
    maxPages: args.maxPages,
    slug: args.slug,
    engine: args.engine,
    zip: args.zip,
    insecure: args.insecure,
    mirrorsRoot: args.mirrorsRoot,
  });

  console.log('\n=== Snapshot complete ===');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nOpen: ${path.join(result.outDir, 'META.md')}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
