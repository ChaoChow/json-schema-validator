import { describe, expect, it } from 'vitest';
import { formatMap } from '../src/format.js';

// The official suite exercises each format in depth; these pin the entry points and a few RFC corners.
describe('formatMap', () => {
  it('covers the 19 formats named by the 2020-12 validation vocabulary', () => {
    expect(Object.keys(formatMap).sort()).toEqual(
      [
        'date-time',
        'date',
        'time',
        'duration',
        'email',
        'idn-email',
        'hostname',
        'idn-hostname',
        'ipv4',
        'ipv6',
        'uri',
        'uri-reference',
        'iri',
        'iri-reference',
        'uuid',
        'uri-template',
        'json-pointer',
        'relative-json-pointer',
        'regex',
      ].sort(),
    );
  });

  it.each<[string, string, boolean]>([
    ['date', '2020-02-29', true],
    ['date', '2100-02-29', false],
    ['time', '23:59:60Z', true],
    ['time', '23:59:60+01:00', false],
    ['time', '15:59:60-08:00', true],
    ['date-time', '1963-06-19t08:30:06.283185z', true],
    ['date-time', '1963-06-19 08:30:06Z', false],
    ['duration', 'P1Y2M3DT4H5M6S', true],
    ['duration', 'P1Y3D', false],
    ['duration', 'P2W', true],
    ['email', '"joe bloggs"@example.com', true],
    ['email', 'joe.bloggs@[IPv6:::1]', true],
    ['email', 'a@b@c.org', false],
    ['idn-email', '실례@실례.테스트', true],
    ['ipv4', '192.168.0.1', true],
    ['ipv4', '192.168.0.01', false],
    ['ipv6', '1:2::192.168.0.1', true],
    ['ipv6', '1::d6::42', false],
    ['uri', 'urn:oasis:names:specification:docbook:dtd:xml:4.1.2', true],
    ['uri', '/abc', false],
    ['uri', 'http://example.com/%A', false],
    ['uri-reference', './this:that', true],
    ['uri-reference', '1:b', false],
    ['iri', 'http://ƒøø.ßår/?∂éœ=πîx#πîüx', true],
    ['iri-reference', '\\\\WINDOWS\\filëßåré', false],
    ['uuid', '2EB8AA08-AA98-11EA-B4AA-73B441D16380', true],
    ['uuid', 'urn:uuid:2eb8aa08-aa98-11ea-b4aa-73b441d16380', false],
    ['uri-template', 'http://example.com/dictionary/{term:1}/{term}', true],
    ['uri-template', '{v:0}', false],
    ['json-pointer', '/foo/bar~0/baz~1/%a', true],
    ['json-pointer', '#/', false],
    ['relative-json-pointer', '0#', true],
    ['relative-json-pointer', '01#', false],
    ['regex', '([abc])+\\s+$', true],
    ['regex', '^(abc]', false],
  ])('%s: %s -> %s', (format, value, expected) => {
    expect(formatMap[format]!(value)).toBe(expected);
  });
});
