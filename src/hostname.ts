// Hostname (RFC 1123) and IDN hostname (RFC 5890–5893) checks. The Unicode property tables below
// approximate the RFC 5892 derived-property and bidi-class tables with ECMAScript `\p{}` classes;
// exact code-point sets are only used where the RFCs list them explicitly.

// --- Punycode (RFC 3492) -----------------------------------------------------------------------

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function digitValue(c: number): number {
  if (c >= 48 && c <= 57) return c - 22;
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 97;
  return -1;
}

/** Decodes a Punycode body (without the `xn--` prefix); `null` when malformed. */
export function punycodeDecode(input: string): string | null {
  const out: number[] = [];
  const delim = input.lastIndexOf('-');
  for (let i = 0; i < delim; i++) {
    const c = input.charCodeAt(i);
    if (c >= 128) return null;
    out.push(c);
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let pos = delim + 1; pos < input.length;) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit < 0) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (i > 0x7fffffff) return null;
    }
    bias = adapt(i - oldI, out.length + 1, oldI === 0);
    n += Math.floor(i / (out.length + 1));
    if (n > 0x10ffff) return null;
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** Encodes to a Punycode body (without the `xn--` prefix). */
export function punycodeEncode(input: string): string {
  const cpList = [...input].map((c) => c.codePointAt(0)!);
  let out = '';
  for (const cp of cpList) if (cp < 128) out += String.fromCharCode(cp);
  const basicCount = out.length;
  let h = basicCount;
  if (basicCount > 0) out += '-';
  let n = 128;
  let delta = 0;
  let bias = 72;
  while (h < cpList.length) {
    let m = 0x10ffff;
    for (const cp of cpList) if (cp >= n && cp < m) m = cp;
    delta += (m - n) * (h + 1);
    n = m;
    for (const cp of cpList) {
      if (cp < n) delta++;
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
          if (q < t) break;
          out += encodeDigit(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        out += encodeDigit(q);
        bias = adapt(delta, h + 1, h === basicCount);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

function encodeDigit(d: number): string {
  return String.fromCharCode(d < 26 ? d + 97 : d + 22);
}

// --- RFC 5892 code-point validity ---------------------------------------------------------------

const LETTER_DIGIT_RE = /^[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}]$/u;
// RFC 5892 §2.6 exceptions and §2.8 old Hangul jamo, which the general categories alone get wrong.
const PVALID_EXCEPTION_RE = /^[\u00DF\u03C2\u06FD\u06FE\u0F0B\u3007]$/u;
const DISALLOWED_SET = new Set([0x0640, 0x07fa, 0x302e, 0x302f, 0x3031, 0x3032, 0x3033, 0x3034, 0x3035, 0x303b]);
const OLD_HANGUL_JAMO_RE = /^[\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]$/u;
const IGNORABLE_RE = /^\p{Default_Ignorable_Code_Point}$/u;
const CONTEXT_RE = /^(?:[\u00B7\u0375\u05F3\u05F4\u30FB\u0660-\u0669\u06F0-\u06F9]|\u200C|\u200D)$/u;

const VIRAMA_SET = new Set([
  0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d3b, 0x0d3c, 0x0d4d, 0x0dca, 0x0e3a, 0x0eba,
  0x0f84, 0x1039, 0x103a, 0x1714, 0x1715, 0x1734, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0x1bf2, 0x1bf3, 0x2d7f,
  0xa806, 0xa82c, 0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x10a3f, 0x11046, 0x11070, 0x1107f, 0x110b9, 0x11133, 0x11134,
  0x111c0, 0x11235, 0x112ea, 0x1134d, 0x11442, 0x114c2, 0x115bf, 0x1163f, 0x116b6, 0x1172b, 0x11839, 0x1193d, 0x1193e,
  0x119e0, 0x11a34, 0x11a47, 0x11a99, 0x11c3f, 0x11d44, 0x11d45, 0x11d97, 0x11f41, 0x11f42,
]);
// Joining_Type L/D/R approximated by the cursive scripts; T by non-spacing marks.
const JOINING_RE =
  /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mandaic}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Phags_Pa}\p{Script=Adlam}]$/u;
const TRANSPARENT_RE = /^\p{Mn}$/u;

function isJoinedThrough(cpList: number[], i: number, step: number): boolean {
  for (let j = i + step; j >= 0 && j < cpList.length; j += step) {
    const c = String.fromCodePoint(cpList[j]!);
    if (TRANSPARENT_RE.test(c)) continue;
    return JOINING_RE.test(c);
  }
  return false;
}

function isContextValid(cpList: number[], i: number, label: string): boolean {
  const cp = cpList[i]!;
  const prev = cpList[i - 1];
  const next = cpList[i + 1];
  switch (cp) {
    case 0x200c: // ZWNJ: after virama, or between joining characters
      return (
        (prev !== undefined && VIRAMA_SET.has(prev)) ||
        (isJoinedThrough(cpList, i, -1) && isJoinedThrough(cpList, i, 1))
      );
    case 0x200d: // ZWJ
      return prev !== undefined && VIRAMA_SET.has(prev);
    case 0x00b7: // MIDDLE DOT between two "l"
      return prev === 0x6c && next === 0x6c;
    case 0x0375: // GREEK LOWER NUMERAL SIGN before Greek
      return next !== undefined && /\p{Script=Greek}/u.test(String.fromCodePoint(next));
    case 0x05f3: // HEBREW GERESH / GERSHAYIM after Hebrew
    case 0x05f4:
      return prev !== undefined && /\p{Script=Hebrew}/u.test(String.fromCodePoint(prev));
    case 0x30fb: // KATAKANA MIDDLE DOT with Hiragana, Katakana or Han somewhere in the label
      return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(label);
    default: // Arabic-Indic digits cannot mix with Extended Arabic-Indic digits
      return cp <= 0x0669 ? !/[\u06F0-\u06F9]/.test(label) : !/[\u0660-\u0669]/.test(label);
  }
}

function isULabelValid(label: string): boolean {
  if (label.startsWith('-') || label.endsWith('-') || label.slice(2, 4) === '--') return false;
  if (/^\p{M}/u.test(label)) return false;
  const cpList = [...label].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < cpList.length; i++) {
    const c = String.fromCodePoint(cpList[i]!);
    if (CONTEXT_RE.test(c)) {
      if (!isContextValid(cpList, i, label)) return false;
    } else if (PVALID_EXCEPTION_RE.test(c)) continue;
    else if (
      !LETTER_DIGIT_RE.test(c) ||
      DISALLOWED_SET.has(cpList[i]!) ||
      OLD_HANGUL_JAMO_RE.test(c) ||
      IGNORABLE_RE.test(c)
    )
      return false;
  }
  return true;
}

// --- RFC 5893 bidi rule -------------------------------------------------------------------------

type Bidi = 'L' | 'R' | 'AL' | 'AN' | 'EN' | 'ES' | 'CS' | 'ET' | 'ON' | 'BN' | 'NSM';

const BIDI_RE_LIST: [RegExp, Bidi][] = [
  [/^[\p{Mn}\p{Me}]$/u, 'NSM'],
  [/^[\u0600-\u0605\u0660-\u0669\u066B\u066C\u06DD\u0890\u0891\u08E2\u{10D30}-\u{10D39}\u{10E60}-\u{10E7E}]$/u, 'AN'],
  [
    /^[0-9\u00B2\u00B3\u00B9\u06F0-\u06F9\u2070\u2074-\u2079\u2080-\u2089\u2488-\u249B\uFF10-\uFF19\u{1D7CE}-\u{1D7FF}]$/u,
    'EN',
  ],
  [/^[+\-\u207A\u207B\u208A\u208B\u2212\uFB29\uFE62\uFE63\uFF0B\uFF0D]$/u, 'ES'],
  [/^[,.:/\u00A0\u060C\u202F\u2044\uFE50\uFE52\uFE55\uFF0C\uFF0E\uFF0F\uFF1A]$/u, 'CS'],
  [
    /^[#$%\u00A2-\u00A5\u00B0\u00B1\u058F\u0609\u060A\u066A\u09F2\u09F3\u20A0-\u20CF\u2030-\u2034\uFE5F\uFE69\uFE6A\uFF03-\uFF05\uFFE0\uFFE1\uFFE5\uFFE6]$/u,
    'ET',
  ],
  [
    /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\u061C\u{10D00}-\u{10D23}\u{10F30}-\u{10F45}\u{1EC71}-\u{1ECB4}\u{1ED01}-\u{1ED3D}\u{1EE00}-\u{1EEFF}]$/u,
    'AL',
  ],
  [
    /^[\p{Script=Hebrew}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\u200F\u{10800}-\u{10FFF}]$/u,
    'R',
  ],
  [/^[\p{Default_Ignorable_Code_Point}\p{Cc}]$/u, 'BN'],
  [/^[\p{P}\p{S}\p{Z}\p{C}]$/u, 'ON'],
];

function bidiClass(c: string): Bidi {
  for (const [re, cls] of BIDI_RE_LIST) if (re.test(c)) return cls;
  return 'L';
}

const RTL_ALLOWED = new Set<Bidi>(['R', 'AL', 'AN', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM']);
const LTR_ALLOWED = new Set<Bidi>(['L', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM']);

function isBidiLabelValid(label: string): boolean {
  const clsList = [...label].map(bidiClass);
  const first = clsList[0];
  if (first !== 'L' && first !== 'R' && first !== 'AL') return false;
  const allowed = first === 'L' ? LTR_ALLOWED : RTL_ALLOWED;
  if (!clsList.every((c) => allowed.has(c))) return false;
  let last = clsList.length - 1;
  while (last > 0 && clsList[last] === 'NSM') last--;
  const end = clsList[last]!;
  if (first === 'L') return end === 'L' || end === 'EN';
  if (!['R', 'AL', 'EN', 'AN'].includes(end)) return false;
  return !(clsList.includes('EN') && clsList.includes('AN'));
}

// --- Hostname ------------------------------------------------------------------------------------

const ASCII_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** UTS 46 mapping, approximated: drop ignorables (keeping the CONTEXTJ joiners), NFKC, lowercase, NFC. */
function mapIdnLabel(label: string): string {
  return label
    .replace(/\p{Default_Ignorable_Code_Point}/gu, (c) => (c === '\u200C' || c === '\u200D' ? c : ''))
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFC');
}

/**
 * `idn` false: RFC 1123 hostname; ASCII only, `xn--` labels are decoded and checked as U-labels.
 * `idn` true: RFC 5890 IDN hostname; labels are mapped per UTS 46 first.
 */
export function checkHostname(s: string, idn: boolean): boolean {
  if (!idn && /[^\0-\x7F]/.test(s)) return false;
  const labelList = s.split(idn ? /[.\u3002\uFF0E\uFF61]/u : '.');
  const uLabelList: string[] = [];
  let totalLength = labelList.length - 1;
  for (const raw of labelList) {
    const label = idn ? mapIdnLabel(raw) : raw;
    if (label === '') return false;
    let uLabel = label;
    let aLabel = label;
    if (/^xn--/i.test(label)) {
      const decoded = punycodeDecode(label.slice(4));
      if (decoded === null || !/[^\0-\x7F]/.test(decoded)) return false;
      uLabel = decoded;
      aLabel = 'xn--' + punycodeEncode(decoded);
      if (aLabel !== label.toLowerCase()) return false;
    } else if (/[^\0-\x7F]/.test(label)) {
      aLabel = 'xn--' + punycodeEncode(label);
    } else if (!ASCII_LABEL_RE.test(label)) return false;
    if (aLabel.length > 63) return false;
    if (uLabel !== aLabel && !isULabelValid(uLabel)) return false;
    totalLength += aLabel.length;
    uLabelList.push(uLabel);
  }
  if (totalLength > 253) return false;
  const isBidiDomain = uLabelList.some((l) => [...l].some((c) => /^(?:R|AL|AN)$/.test(bidiClass(c))));
  return !isBidiDomain || uLabelList.every(isBidiLabelValid);
}
