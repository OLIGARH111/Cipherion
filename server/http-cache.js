import {createHash} from 'node:crypto';
import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {brotliCompressSync, gzipSync, constants} from 'node:zlib';

// Text responses shrink 3-5x when compressed; images and video are already compressed.
const compressible = /^(text\/|application\/(javascript|json|manifest\+json|xml)|image\/svg\+xml)/;

export function encodingFor(acceptEncoding, type) {
  if (!compressible.test(type || '')) return null;
  const accepted = String(acceptEncoding || '').split(',').map(v => v.trim().split(';'))
    .filter(([, q]) => !/^q=0(\.0*)?$/.test((q || '').trim())).map(([name]) => name.trim().toLowerCase());
  return accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : null;
}

// Static files are compressed once at maximum quality; dynamic JSON uses fast settings.
export function compress(body, encoding, fast = false) {
  if (encoding === 'br') return brotliCompressSync(body, {params: {
    [constants.BROTLI_PARAM_QUALITY]: fast ? 4 : 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
  }});
  return gzipSync(body, {level: fast ? 6 : 9});
}

export function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  return String(ifNoneMatch).split(',').map(v => v.trim().replace(/^W\//, '')).some(v => v === '*' || v === etag);
}

// Files are re-read only when their mtime or size changes, so a deploy or a dev edit is picked up
// while every other request is served from memory with a stable ETag.
export function createStaticFiles() {
  const entries = new Map();
  async function load(file) {
    const info = await stat(file);
    if (!info.isFile()) throw Object.assign(new Error('Not a file'), {code: 'ENOENT'});
    const cached = entries.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const body = await readFile(file);
    const entry = {mtimeMs: info.mtimeMs, size: info.size, body, variants: new Map(),
      etag: '"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"'};
    entries.set(file, entry);
    return entry;
  }
  async function serve(req, res, file, options) { return send(req, res, await load(file), options); }
  function send(req, res, entry, {type, cacheControl}) {
    const encoding = encodingFor(req.headers['accept-encoding'], type);
    const headers = {'Content-Type': type, 'Cache-Control': cacheControl, 'ETag': entry.etag, 'Vary': 'Accept-Encoding'};
    if (etagMatches(req.headers['if-none-match'], entry.etag)) { res.writeHead(304, headers); return res.end(); }
    let body = entry.body;
    if (encoding && body.length > 512) {
      if (!entry.variants.has(encoding)) entry.variants.set(encoding, compress(body, encoding));
      const packed = entry.variants.get(encoding);
      if (packed.length < body.length) { body = packed; headers['Content-Encoding'] = encoding; }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  return {serve, send, load};
}

// The page links every script and stylesheet through /v/<version>/, where the version is a hash of
// all of them. Those URLs never change content, so the browser keeps them for a year and a repeat
// visit makes no request for them at all; a deploy changes the version and therefore every URL at
// once, so old and new modules are never mixed. All modules are announced with modulepreload, so
// the browser fetches the whole import tree in parallel instead of level by level.
const importPattern = /(?:\bfrom\s*|\bimport\s*)['"]\.\/([\w.-]+\.js)['"]/g;
const entryOf = body => ({body, variants: new Map(), etag: '"' + createHash('sha256').update(body).digest('base64url').slice(0, 22) + '"'});
let esbuild;
const loadBundler = () => esbuild ??= import('esbuild').catch(() => null);

// A phone opening ~60 separate files spends most of its start-up on request overhead, even when
// every file comes from the local cache. So all modules are joined into one minified bundle.js and
// all stylesheets into one bundle.css, in page order. If bundling is unavailable or fails, the page
// links the separate files exactly as before. CIPHERION_BUNDLE=0 turns bundling off.
async function bundle(publicDir, text, files, version) {
  if (process.env.CIPHERION_BUNDLE === '0') return null;
  const scripts = [...text.matchAll(/<script type="module" src="\/([\w.-]+\.js)"><\/script>/g)];
  const styles = [...text.matchAll(/<link rel="stylesheet" href="\/([\w.-]+\.css)">/g)];
  if (!scripts.length || scripts.some(m => !files.has(m[1])) || styles.some(m => !files.has(m[1]))) return null;
  const builder = await loadBundler();
  if (!builder) return null;
  try {
    const result = await builder.build({
      stdin: {contents: scripts.map(m => `import './${m[1]}';`).join('\n'), resolveDir: publicDir, sourcefile: 'entry.js', loader: 'js'},
      bundle: true, format: 'esm', minify: true, charset: 'utf8', target: 'es2021', write: false, logLevel: 'silent', legalComments: 'none',
    });
    const js = Buffer.from(result.outputFiles[0].contents);
    const css = Buffer.concat(styles.flatMap(m => [files.get(m[1]).body, Buffer.from('\n')]));
    let page = text;
    styles.forEach((m, i) => { page = page.replace(m[0], i ? '' : `<link rel="stylesheet" href="/v/${version}/bundle.css">`); });
    scripts.forEach((m, i) => { page = page.replace(m[0], i ? '' : `<script type="module" src="/v/${version}/bundle.js"></script>`); });
    return {page, assets: new Map([['bundle.js', entryOf(js)], ['bundle.css', entryOf(css)]])};
  } catch (error) {
    console.error(JSON.stringify({event: 'bundle_failed', message: String(error?.message || error).slice(0, 500)}));
    return null;
  }
}

export function createAppShell(publicDir, staticFiles) {
  let built = null, pending = null, checkedAt = 0;
  async function build() {
    const names = (await readdir(publicDir)).filter(name => /\.(js|css)$/.test(name) && name !== 'sw.js').sort();
    const [html, ...assets] = await Promise.all(['index.html', ...names].map(name => staticFiles.load(join(publicDir, name))));
    const key = html.etag + assets.map(asset => asset.etag).join('') + (process.env.CIPHERION_BUNDLE === '0' ? '-plain' : '');
    if (built?.key === key) return built;
    const version = createHash('sha256').update(key).digest('hex').slice(0, 12);
    const files = new Map(names.map((name, i) => [name, assets[i]]));
    const source = html.body.toString('utf8');
    const bundled = await bundle(publicDir, source, files, version);
    if (bundled) {
      built = {key, version, bundled: true, assets: bundled.assets, ...entryOf(Buffer.from(bundled.page))};
      return built;
    }
    let text = source;
    const entries = [...text.matchAll(/<script type="module" src="\/([\w.-]+\.js)"/g)].map(m => m[1]);
    const seen = new Set(entries), queue = [...entries];
    while (queue.length) for (const [, dep] of files.get(queue.shift())?.body.toString('utf8').matchAll(importPattern) || [])
      if (files.has(dep) && !seen.has(dep)) { seen.add(dep); queue.push(dep); }
    text = text.replace(/(href|src)="\/([\w.-]+\.(?:css|js))"/g, (match, attr, name) => files.has(name) ? `${attr}="/v/${version}/${name}"` : match);
    const preload = [...seen].filter(name => !entries.includes(name)).map(name => `<link rel="modulepreload" href="/v/${version}/${name}">`).join('');
    text = text.replace('</head>', preload + '</head>');
    built = {key, version, bundled: false, assets: new Map(), ...entryOf(Buffer.from(text))};
    return built;
  }
  // File checks are shared for a moment, so one page load (dozens of asset requests) costs one scan.
  function get() {
    if (built && Date.now() - checkedAt < 2000) return Promise.resolve(built);
    pending ||= build().then(result => { checkedAt = Date.now(); return result; }).finally(() => { pending = null; });
    return pending;
  }
  return {get};
}
