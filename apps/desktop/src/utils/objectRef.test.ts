import { describe, it, expect } from 'vitest';
import {
  parseObjectRef,
  resolveObjectRefId,
  isRequestableObjectId,
  normalizeObjectId,
} from './objectRef';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('objectRef — ONE parser for every media reference', () => {
  it('resolves the id inside BOTH urn:sha256 forms', () => {
    // The old App.tsx wallpaper resolver only knew the UUID form, so a 64-hex
    // descriptor fell through to a doomed `orbitFetch('urn:sha256:…')`.
    expect(resolveObjectRefId(`urn:sha256:${UUID}`)).toBe(UUID);
    expect(resolveObjectRefId(`urn:sha256:${HEX}`)).toBe(HEX);
  });

  it('resolves the id inside a padded urn (uuid + tail)', () => {
    expect(resolveObjectRefId(`urn:sha256:${UUID}00000000000000000000000000`)).toBe(UUID);
  });

  it('treats a magnet as a descriptor, but resolves the btih inside it', () => {
    // The btih IS the content hash the bytes are stored under (legacy rows:
    // sha256(bytes).slice(0,40)), so a magnet row can find bytes we already
    // hold. It is still not a node path.
    expect(parseObjectRef('magnet:?xt=urn:btih:abc').kind).toBe('magnet');
    expect(resolveObjectRefId('magnet:?xt=urn:btih:abc')).toBeNull();
    const btih40 = '68079ad0993de49691e5a4448c39d4889e7e00d6';
    expect(resolveObjectRefId(`magnet:?xt=urn:btih:${btih40}&dn=x`)).toBe(btih40);
    expect(resolveObjectRefId(`magnet:?xt=urn:btih:${HEX}&dn=x`)).toBe(HEX);
    expect(isRequestableObjectId(`magnet:?xt=urn:btih:${btih40}`)).toBe(false);
  });

  it('treats a malformed urn as a descriptor with no id', () => {
    expect(resolveObjectRefId('urn:sha256:abc')).toBeNull();
    expect(resolveObjectRefId('urn:sha256:')).toBeNull();
  });

  it('a RAW descriptor is never requestable — only the id inside it is', () => {
    expect(isRequestableObjectId(`urn:sha256:${UUID}`)).toBe(false);
    expect(isRequestableObjectId(`urn:sha256:${HEX}`)).toBe(false);
    expect(isRequestableObjectId('magnet:?xt=urn:btih:abc')).toBe(false);
    expect(isRequestableObjectId(UUID)).toBe(true);
    expect(isRequestableObjectId(HEX)).toBe(true);
  });

  it('strips the /api/objects mount', () => {
    expect(resolveObjectRefId('/api/objects/abc123')).toBe('abc123');
    expect(resolveObjectRefId('/api/objects/abc123?x=1')).toBe('abc123');
    expect(normalizeObjectId('/api/objects/abc123')).toBe('abc123');
    expect(normalizeObjectId('abc123')).toBe('abc123');
  });

  it('refuses anything that is not a single path segment', () => {
    expect(isRequestableObjectId('foo/bar')).toBe(false);
    expect(isRequestableObjectId('foo?x=1')).toBe(false);
    expect(isRequestableObjectId('foo#frag')).toBe(false);
    expect(isRequestableObjectId('https://example.com/a.png')).toBe(false);
    expect(isRequestableObjectId('data:image/png;base64,AAA')).toBe(false);
    expect(isRequestableObjectId('')).toBe(false);
    expect(isRequestableObjectId(null)).toBe(false);
  });

  it('classifies the kinds', () => {
    expect(parseObjectRef('').kind).toBe('empty');
    expect(parseObjectRef(UUID).kind).toBe('id');
    expect(parseObjectRef(`urn:sha256:${HEX}`).kind).toBe('urn');
    expect(parseObjectRef('magnet:?xt=urn:btih:abc').kind).toBe('magnet');
    expect(parseObjectRef('https://example.com/a.png').kind).toBe('url');
  });
});
