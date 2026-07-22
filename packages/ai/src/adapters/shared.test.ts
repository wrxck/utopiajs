// ============================================================================
// @matthesketh/utopia-ai — Shared adapter helper tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  tryParseJSON,
  assertHttpBaseURL,
  nextToolCallId,
  missingPeerDepError,
  messageContentToText,
} from './shared';

describe('tryParseJSON', () => {
  it('parses valid JSON objects', () => {
    expect(tryParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for malformed JSON', () => {
    expect(tryParseJSON('{oops')).toBeUndefined();
  });
});

describe('assertHttpBaseURL', () => {
  it('accepts http and https', () => {
    expect(() => assertHttpBaseURL('http://x', 'P')).not.toThrow();
    expect(() => assertHttpBaseURL('https://x', 'P')).not.toThrow();
  });

  it('rejects other protocols with the provider name in the message', () => {
    expect(() => assertHttpBaseURL('file:///etc', 'MyProvider')).toThrow(
      'MyProvider baseURL must be http(s): file:///etc',
    );
  });

  it('rejects unparseable URLs', () => {
    expect(() => assertHttpBaseURL('not a url', 'P')).toThrow();
  });
});

describe('nextToolCallId', () => {
  it('generates unique call ids', () => {
    const a = nextToolCallId();
    const b = nextToolCallId();
    expect(a).toMatch(/^call_\d+_/);
    expect(a).not.toBe(b);
  });
});

describe('missingPeerDepError', () => {
  it('names the package and adapter with an install hint', () => {
    const err = missingPeerDepError('some-sdk', 'Some');
    expect(err.message).toContain('"some-sdk" package is required for the Some adapter');
    expect(err.message).toContain('npm install some-sdk');
  });
});

describe('messageContentToText', () => {
  it('passes strings through', () => {
    expect(messageContentToText('plain')).toBe('plain');
  });

  it('joins array content, keeping raw strings and text parts, dropping the rest', () => {
    expect(
      messageContentToText([
        'raw ',
        { type: 'text', text: 'typed' },
        { type: 'image', source: 'x' },
      ]),
    ).toBe('raw typed');
  });

  it('extracts a single text object and drops single non-text objects', () => {
    expect(messageContentToText({ type: 'text', text: 'solo' })).toBe('solo');
    expect(messageContentToText({ type: 'image', source: 'x' })).toBe('');
  });
});
