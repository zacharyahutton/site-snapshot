'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { URL } = require('url');

function slugFromUrl(websiteUrl) {
  const normalized = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
  const u = new URL(normalized);
  return u.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
}

function resolveWget() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('wget.exe');
    const wingetAlias = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WinGet',
      'Links',
      'wget.exe'
    );
    candidates.push(wingetAlias);
  } else {
    candidates.push('wget');
  }

  for (const c of candidates) {
    if (c.includes(path.sep) || c.includes('/')) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    const which = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [c], {
      encoding: 'utf8',
      shell: false,
    });
    if (which.status === 0) {
      const first = String(which.stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (first && fs.existsSync(first)) return first;
    }
  }
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeMeta(outDir, meta) {
  const lines = [
    '# Mirror META',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| URL | ${meta.url} |`,
    `| Slug | ${meta.slug} |`,
    `| Mode | ${meta.mode} |`,
    `| Engine | ${meta.engine} |`,
    `| Started | ${meta.started} |`,
    `| Finished | ${meta.finished} |`,
    `| Output | \`${meta.outputRel || meta.outDir}\` |`,
    `| Depth | ${meta.depth} |`,
    `| Max pages | ${meta.maxPages} |`,
    `| Status | ${meta.status} |`,
    '',
    '## Purpose',
    '',
    '- Offline study / rebuild planning / inspiration',
    '- Respect the site owner. Do not republish copied content.',
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'META.md'), lines.join('\n'), 'utf8');
}

function runWgetMirror({ url, workDir, depth, noParent, insecure }) {
  const wget = resolveWget();
  if (!wget) {
    const err = new Error('wget not found');
    err.code = 'NO_WGET';
    throw err;
  }

  const args = [
    '--mirror',
    '--convert-links',
    '--adjust-extension',
    '--page-requisites',
    '--no-if-modified-since',
    `--level=${depth}`,
    '-P',
    workDir,
    '--no-verbose',
    '--show-progress',
  ];
  if (noParent) args.push('--no-parent');
  // Expired / self-signed certs (common on unfinished client sites)
  if (insecure) args.push('--no-check-certificate');
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(wget, args, { cwd: workDir, shell: false });
    let stderr = '';
    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
      process.stderr.write(buf);
    });
    child.stdout.on('data', (buf) => process.stdout.write(buf));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        const e = new Error(`wget exited ${code}`);
        e.stderr = stderr;
        e.code = code;
        // wget often returns non-zero for partial failures; still usable if files exist
        const hasFiles = fs.existsSync(workDir) && fs.readdirSync(workDir).length > 0;
        if (hasFiles) return resolve({ code, soft: true });
        return reject(e);
      }
      resolve({ code: code || 0, soft: false });
    });
  });
}

async function runNodeScraper({ url, workDir, maxPages, depth, insecure }) {
  const scrape = require('website-scraper');
  ensureDir(workDir);
  await scrape({
    urls: [url],
    directory: path.join(workDir, 'site'),
    recursive: true,
    maxRecursiveDepth: depth,
    maxDepth: depth,
    requestConcurrency: 3,
    request: insecure
      ? {
          // website-scraper → got options
          https: { rejectUnauthorized: false },
        }
      : undefined,
    urlFilter: (() => {
      let count = 0;
      const origin = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin;
      return (candidate) => {
        if (!String(candidate).startsWith(origin)) return false;
        count += 1;
        return count <= maxPages;
      };
    })(),
  });
  return { engine: 'website-scraper' };
}

async function zipDirectory(sourceDir, zipPath) {
  const archiver = require('archiver');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Mirror a public site into a dated folder under the output root.
 */
async function mirrorSite(options) {
  const started = new Date().toISOString();
  const url = /^https?:\/\//i.test(options.url) ? options.url : `https://${options.url}`;
  const slug = options.slug || slugFromUrl(url);
  const date = options.date || new Date().toISOString().slice(0, 10);
  const mode = options.mode || 'quick'; // quick | full
  const depth = Number(options.depth ?? (mode === 'full' ? 3 : 1));
  const maxPages = Number(options.maxPages ?? (mode === 'full' ? 40 : 8));
  const noParent = options.noParent !== false;
  const doZip = Boolean(options.zip);
  const prefer = options.engine || 'auto'; // auto | wget | node
  const insecure = options.insecure === true;

  const mirrorsRoot =
    options.mirrorsRoot ||
    path.resolve(process.cwd(), 'snapshots');

  const outDir = path.join(mirrorsRoot, `${date}-${slug}`);
  const workDir = path.join(outDir, 'files');
  ensureDir(workDir);

  let engine = prefer;
  let status = 'ok';

  try {
    if (prefer === 'node' || (prefer === 'auto' && !resolveWget())) {
      engine = 'website-scraper';
      await runNodeScraper({ url, workDir, maxPages, depth, insecure });
    } else {
      engine = 'wget';
      try {
        await runWgetMirror({ url, workDir, depth, noParent, insecure });
      } catch (err) {
        // Auto-retry once with cert check disabled (expired SSL common on unfinished sites)
        if (!insecure && /SSL|certificate|CERT/i.test(String(err.message) + String(err.stderr || ''))) {
          process.stderr.write('wget SSL failure; retrying with --no-check-certificate…\n');
          await runWgetMirror({ url, workDir, depth, noParent, insecure: true });
        } else if (prefer === 'wget') {
          throw err;
        } else {
          process.stderr.write(`wget failed (${err.message}); falling back to website-scraper…\n`);
          engine = 'website-scraper';
          await runNodeScraper({
            url,
            workDir,
            maxPages,
            depth,
            insecure: insecure || true,
          });
        }
      }
    }
  } catch (err) {
    status = `failed: ${err.message}`;
    writeMeta(outDir, {
      url,
      slug,
      mode,
      engine,
      started,
      finished: new Date().toISOString(),
      outDir,
      outputRel: path.relative(mirrorsRoot, outDir),
      depth,
      maxPages,
      status,
    });
    throw err;
  }

  let zipPath = null;
  if (doZip) {
    zipPath = path.join(outDir, `${slug}-mirror.zip`);
    await zipDirectory(workDir, zipPath);
  }

  const finished = new Date().toISOString();
  writeMeta(outDir, {
    url,
    slug,
    mode,
    engine,
    started,
    finished,
    outDir,
    outputRel: path.relative(mirrorsRoot, outDir),
    depth,
    maxPages,
    status,
  });

  fs.writeFileSync(
    path.join(outDir, 'SCRAPE-NOTES.md'),
    [
      '# Notes',
      '',
      'Use this file for your own notes about the site: structure, content, things to keep or change.',
      '',
    ].join('\n'),
    'utf8'
  );

  return {
    url,
    slug,
    outDir,
    workDir,
    zipPath,
    engine,
    mode,
    depth,
    maxPages,
    started,
    finished,
  };
}

module.exports = {
  mirrorSite,
  slugFromUrl,
  resolveWget,
};
