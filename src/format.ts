import { checkHostname } from './hostname.js';

const DAYS_IN_MONTH_LIST = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  if (mo < 1 || mo > 12 || d < 1) return false;
  const isLeap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= (mo === 2 && isLeap ? 29 : DAYS_IN_MONTH_LIST[mo - 1]!);
}

function isTime(s: string): boolean {
  const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (!m) return false;
  const h = +m[1]!;
  const mi = +m[2]!;
  const sec = +m[3]!;
  const offH = m[5] === undefined ? 0 : +m[5];
  const offM = m[6] === undefined ? 0 : +m[6];
  if (h > 23 || mi > 59 || sec > 60 || offH > 23 || offM > 59) return false;
  if (sec < 60) return true;
  // A leap second is only valid at 23:59 UTC.
  const sign = m[4] === '-' ? -1 : 1;
  const utcMinute = (((h * 60 + mi - sign * (offH * 60 + offM)) % 1440) + 1440) % 1440;
  return utcMinute === 23 * 60 + 59;
}

function isDateTime(s: string): boolean {
  const i = s.search(/[tT]/);
  return i === 10 && isDate(s.slice(0, 10)) && isTime(s.slice(11));
}

// RFC 3339 appendix A: each unit may only follow the next larger one (P1Y3D and PT1H3S are invalid).
const DURATION_RE =
  /^P(?!$)(?:\d+W|(?:\d+Y(?:\d+M(?:\d+D)?)?|\d+M(?:\d+D)?|\d+D)?(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?)$/;

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function isIpv6(s: string): boolean {
  if (!/^[0-9A-Fa-f:.]+$/.test(s)) return false;
  const half = s.split('::');
  if (half.length > 2) return false;
  const groupList = half.map((h) => (h === '' ? [] : h.split(':')));
  const all = groupList.flat();
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const g = all[i]!;
    if (i === all.length - 1 && g.includes('.')) {
      if (!IPV4_RE.test(g)) return false;
      count += 2;
    } else if (/^[0-9A-Fa-f]{1,4}$/.test(g)) count++;
    else return false;
  }
  return half.length === 2 ? count <= 7 : count === 8;
}

// RFC 3986 / RFC 3987 character classes. `ucschar` and `iprivate` are only allowed in IRIs.
const PCT = '%[0-9A-Fa-f]{2}';
const UNRESERVED = 'A-Za-z0-9\\-._~';
const SUB_DELIM = "!$&'()*+,;=";
const UCSCHAR = '\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF\\u{10000}-\\u{EFFFD}';
const IPRIVATE = '\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}';

function charClassRe(chars: string, iri: boolean): RegExp {
  return new RegExp(`^(?:[${chars}${iri ? UCSCHAR : ''}]|${PCT})*$`, 'u');
}

const PCHAR = UNRESERVED + SUB_DELIM + ':@';
const uriPartRe = {
  userinfo: [charClassRe(UNRESERVED + SUB_DELIM + ':', false), charClassRe(UNRESERVED + SUB_DELIM + ':', true)],
  regName: [charClassRe(UNRESERVED + SUB_DELIM, false), charClassRe(UNRESERVED + SUB_DELIM, true)],
  path: [charClassRe(PCHAR + '/', false), charClassRe(PCHAR + '/', true)],
  query: [charClassRe(PCHAR + '/?', false), charClassRe(PCHAR + '/?' + IPRIVATE, true)],
  fragment: [charClassRe(PCHAR + '/?', false), charClassRe(PCHAR + '/?', true)],
};
const IPVFUTURE_RE = new RegExp(`^v[0-9A-Fa-f]+\\.[${UNRESERVED}${SUB_DELIM}:]+$`);

function isAuthority(auth: string, iri: boolean): boolean {
  const at = auth.lastIndexOf('@');
  if (at !== -1 && !uriPartRe.userinfo[+iri]!.test(auth.slice(0, at))) return false;
  const hostPort = auth.slice(at + 1);
  const m = /^(\[[^\]]*\]|[^:[\]]*)(?::(\d*))?$/.exec(hostPort);
  if (!m) return false;
  const host = m[1]!;
  if (host.startsWith('[')) {
    const inner = host.slice(1, -1);
    return isIpv6(inner) || IPVFUTURE_RE.test(inner);
  }
  return uriPartRe.regName[+iri]!.test(host);
}

/** RFC 3986 URI-reference (or RFC 3987 IRI-reference when `iri`); `requireScheme` restricts to absolute forms. */
export function isUriReference(s: string, iri: boolean, requireScheme: boolean): boolean {
  const m = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/su.exec(s);
  if (!m) return false;
  const [, scheme, authority, path, query, fragment] = m;
  if (requireScheme && scheme === undefined) return false;
  if (authority !== undefined) {
    if (!isAuthority(authority, iri)) return false;
    if (path !== '' && !path!.startsWith('/')) return false;
  } else {
    if (path!.startsWith('//')) return false;
    // A relative reference's first segment cannot contain ":" or it would parse as a scheme.
    if (scheme === undefined && /^[^/]*:/.test(path!)) return false;
  }
  return (
    uriPartRe.path[+iri]!.test(path!) &&
    (query === undefined || uriPartRe.query[+iri]!.test(query)) &&
    (fragment === undefined || uriPartRe.fragment[+iri]!.test(fragment))
  );
}

// RFC 6570 (with the errata allowing "'" in literals).
const TEMPLATE_LITERAL_RE = new RegExp(
  `^(?:[!#$&'()*+,\\-./0-9:;=?@A-Z\\[\\]_a-z~${UCSCHAR}${IPRIVATE}]|${PCT})*$`,
  'u',
);
const VARCHAR = `(?:[A-Za-z0-9_]|${PCT})`;
const TEMPLATE_EXPR_RE = new RegExp(
  `^[+#./;?&]?(?:${VARCHAR}+(?:\\.${VARCHAR}+)*(?::[1-9]\\d{0,3}|\\*)?)(?:,${VARCHAR}+(?:\\.${VARCHAR}+)*(?::[1-9]\\d{0,3}|\\*)?)*$`,
);

function isUriTemplate(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    const literal = s.slice(i, open === -1 ? s.length : open);
    if (literal.includes('}') || !TEMPLATE_LITERAL_RE.test(literal)) return false;
    if (open === -1) return true;
    const close = s.indexOf('}', open);
    if (close === -1 || !TEMPLATE_EXPR_RE.test(s.slice(open + 1, close))) return false;
    i = close + 1;
  }
  return true;
}

const ATEXT = "A-Za-z0-9!#$%&'*+/=?^_`{|}~\\-";
const DOT_ATOM_RE = new RegExp(`^[${ATEXT}]+(?:\\.[${ATEXT}]+)*$`);
const IDN_DOT_ATOM_RE = new RegExp(`^[${ATEXT}\\u0080-\\u{10FFFF}]+(?:\\.[${ATEXT}\\u0080-\\u{10FFFF}]+)*$`, 'u');
const QUOTED_RE = /^"(?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*"$/;
const IDN_QUOTED_RE = /^"(?:[\x20\x21\x23-\x5B\x5D-\x7E\u0080-\u{10FFFF}]|\\[\x20-\x7E\u0080-\u{10FFFF}])*"$/u;

function isEmail(s: string, idn: boolean): boolean {
  const at = s.lastIndexOf('@');
  if (at === -1) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const localOk = idn
    ? IDN_DOT_ATOM_RE.test(local) || IDN_QUOTED_RE.test(local)
    : DOT_ATOM_RE.test(local) || QUOTED_RE.test(local);
  if (!localOk) return false;
  if (domain.startsWith('[')) {
    if (!domain.endsWith(']')) return false;
    const literal = domain.slice(1, -1);
    return IPV4_RE.test(literal) || (/^ipv6:/i.test(literal) && isIpv6(literal.slice(5)));
  }
  return checkHostname(domain, idn);
}

function isRegex(s: string): boolean {
  try {
    new RegExp(s, 'u');
    return true;
  } catch {
    return false;
  }
}

const JSON_POINTER_RE = /^(?:\/(?:[^~]|~[01])*)*$/;

/** Built-in checks for the 19 formats named by the 2020-12 validation vocabulary. */
export const formatMap: Record<string, (s: string) => boolean> = {
  'date-time': isDateTime,
  date: isDate,
  time: isTime,
  duration: (s) => DURATION_RE.test(s),
  email: (s) => isEmail(s, false),
  'idn-email': (s) => isEmail(s, true),
  hostname: (s) => checkHostname(s, false),
  'idn-hostname': (s) => checkHostname(s, true),
  ipv4: (s) => IPV4_RE.test(s),
  ipv6: isIpv6,
  uri: (s) => isUriReference(s, false, true),
  'uri-reference': (s) => isUriReference(s, false, false),
  iri: (s) => isUriReference(s, true, true),
  'iri-reference': (s) => isUriReference(s, true, false),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  'uri-template': isUriTemplate,
  'json-pointer': (s) => JSON_POINTER_RE.test(s),
  'relative-json-pointer': (s) => /^(?:0|[1-9]\d*)(?:#|(?:\/(?:[^~]|~[01])*)*)$/.test(s),
  regex: isRegex,
};
