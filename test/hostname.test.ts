import { describe, expect, it } from 'vitest';
import { checkHostname, punycodeDecode, punycodeEncode } from '../src/hostname.js';

describe('punycode', () => {
  it.each([
    ['', ''],
    ['abc-', 'abc'],
    ['9n2bp8q', '실례'],
    ['ihqwcrb4cv8a8dqg056pqjye', '他们为什么不说中文'],
    ['ll-0ea', 'l·l'],
    ['-> $1.00 <--', '-> $1.00 <-'],
  ])('round-trips %s', (encoded, decoded) => {
    expect(punycodeDecode(encoded)).toBe(decoded);
    expect(punycodeEncode(decoded)).toBe(encoded);
  });

  it('rejects malformed input', () => {
    expect(punycodeDecode('X')).toBeNull();
    expect(punycodeDecode('é-')).toBeNull();
    expect(punycodeDecode('a-!')).toBeNull();
  });
});

describe('checkHostname', () => {
  it('accepts RFC 1123 names and rejects non-ASCII unless idn', () => {
    expect(checkHostname('www.example.com', false)).toBe(true);
    expect(checkHostname('café.com', false)).toBe(false);
    expect(checkHostname('café.com', true)).toBe(true);
    expect(checkHostname('-a.com', true)).toBe(false);
    expect(checkHostname('a..b', true)).toBe(false);
  });

  it('decodes xn-- labels and applies U-label rules to them', () => {
    expect(checkHostname('xn--9n2bp8q.xn--9t4b11yi5a', false)).toBe(true);
    expect(checkHostname('xn--example-', false)).toBe(false);
    expect(checkHostname('xn--al-0ea', false)).toBe(false);
  });

  it('applies the bidi rule only to bidi domain names', () => {
    expect(checkHostname('0a.com', true)).toBe(true);
    expect(checkHostname('0a.א', true)).toBe(false);
    expect(checkHostname('א.com', true)).toBe(true);
  });
});
