import { describe, expect, it } from 'vitest';
import { escapePointerToken, isAbsoluteUri, resolveUri, splitFragment, unescapePointerToken } from '../src/uri.js';

describe('resolveUri', () => {
  const base = 'http://a/b/c/d;p?q';

  // RFC 3986 §5.4.1 normal examples.
  it.each([
    ['g:h', 'g:h'],
    ['g', 'http://a/b/c/g'],
    ['./g', 'http://a/b/c/g'],
    ['g/', 'http://a/b/c/g/'],
    ['/g', 'http://a/g'],
    ['//g', 'http://g'],
    ['?y', 'http://a/b/c/d;p?y'],
    ['g?y', 'http://a/b/c/g?y'],
    ['#s', 'http://a/b/c/d;p?q#s'],
    ['g#s', 'http://a/b/c/g#s'],
    [';x', 'http://a/b/c/;x'],
    ['', 'http://a/b/c/d;p?q'],
    ['.', 'http://a/b/c/'],
    ['..', 'http://a/b/'],
    ['../g', 'http://a/b/g'],
    ['../..', 'http://a/'],
    ['../../g', 'http://a/g'],
    ['../../../g', 'http://a/g'],
    ['/./g', 'http://a/g'],
    ['g/../h', 'http://a/b/c/h'],
    ['g;x=1/./y', 'http://a/b/c/g;x=1/y'],
  ])('resolves %s against the RFC base to %s', (ref, expected) => {
    expect(resolveUri(ref, base)).toBe(expected);
  });

  it('handles urn bases, authority-only bases and an empty base', () => {
    expect(resolveUri('#foo', 'urn:uuid:1234')).toBe('urn:uuid:1234#foo');
    expect(resolveUri('x', 'http://host')).toBe('http://host/x');
    expect(resolveUri('http://z/', 'http://a/b')).toBe('http://z/');
    expect(resolveUri('rel', '')).toBe('rel');
    expect(resolveUri('#/x', '')).toBe('#/x');
  });
});

describe('helpers', () => {
  it('isAbsoluteUri requires a scheme', () => {
    expect(isAbsoluteUri('http://a')).toBe(true);
    expect(isAbsoluteUri('urn:x')).toBe(true);
    expect(isAbsoluteUri('a/b')).toBe(false);
    expect(isAbsoluteUri('1http:x')).toBe(false);
  });

  it('splitFragment separates at the first #', () => {
    expect(splitFragment('http://a#b#c')).toEqual(['http://a', 'b#c']);
    expect(splitFragment('http://a')).toEqual(['http://a', undefined]);
    expect(splitFragment('http://a#')).toEqual(['http://a', '']);
  });

  it('escapes and unescapes JSON pointer tokens', () => {
    expect(escapePointerToken('a/b~c')).toBe('a~1b~0c');
    expect(unescapePointerToken('a~1b~0c')).toBe('a/b~c');
    expect(unescapePointerToken('~01')).toBe('~1');
  });
});
