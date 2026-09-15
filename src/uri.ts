// RFC 3986 reference resolution. Node's WHATWG `URL` is not used because it normalises
// (lowercases hosts, adds trailing slashes) and cannot resolve relative refs against `urn:` bases.

interface UriPart {
  scheme?: string;
  authority?: string;
  path: string;
  query?: string;
  fragment?: string;
}

// RFC 3986 appendix B.
const URI_RE = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

function parseUri(uri: string): UriPart {
  const m = URI_RE.exec(uri)!;
  return { scheme: m[1], authority: m[2], path: m[3]!, query: m[4], fragment: m[5] };
}

function removeDotSegments(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') {
      if (out.length > 1) out.pop(); // never pop the root
    } else if (seg !== '.') out.push(seg);
  }
  // A trailing "." or ".." leaves a trailing slash, as §5.2.4 requires.
  if (path.endsWith('/.') || path.endsWith('/..')) out.push('');
  return out.join('/');
}

function mergePath(base: UriPart, ref: string): string {
  if (base.authority !== undefined && base.path === '') return '/' + ref;
  const i = base.path.lastIndexOf('/');
  return i === -1 ? ref : base.path.slice(0, i + 1) + ref;
}

function serialise(p: UriPart): string {
  let s = p.scheme !== undefined ? p.scheme + ':' : '';
  if (p.authority !== undefined) s += '//' + p.authority;
  s += p.path;
  if (p.query !== undefined) s += '?' + p.query;
  if (p.fragment !== undefined) s += '#' + p.fragment;
  return s;
}

export function isAbsoluteUri(uri: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri);
}

/** RFC 3986 §5.2.2. With an empty base only absolute and fragment-only refs resolve; others are returned as-is. */
export function resolveUri(ref: string, base: string): string {
  if (base === '' || isAbsoluteUri(ref)) return ref;
  const r = parseUri(ref);
  const b = parseUri(base);
  const t: UriPart = { path: '' };
  if (r.authority !== undefined) {
    t.authority = r.authority;
    t.path = removeDotSegments(r.path);
    t.query = r.query;
  } else {
    if (r.path === '') {
      t.path = b.path;
      t.query = r.query ?? b.query;
    } else {
      t.path = removeDotSegments(r.path.startsWith('/') ? r.path : mergePath(b, r.path));
      t.query = r.query;
    }
    t.authority = b.authority;
  }
  t.scheme = b.scheme;
  t.fragment = r.fragment;
  return serialise(t);
}

/** Splits `uri` into its fragment-less part and its fragment (`undefined` when there is no `#`). */
export function splitFragment(uri: string): [string, string | undefined] {
  const i = uri.indexOf('#');
  return i === -1 ? [uri, undefined] : [uri.slice(0, i), uri.slice(i + 1)];
}

export function escapePointerToken(token: string): string {
  if (!token.includes('~') && !token.includes('/')) return token;
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}
