import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
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
  async function serve(req, res, file, {type, cacheControl}) {
    const entry = await load(file);
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
  return {serve};
}
