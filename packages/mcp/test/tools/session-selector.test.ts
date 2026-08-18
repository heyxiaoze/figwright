import { describe, expect, it } from 'vitest';

import {
  extractSessionId,
  SESSION_ID_FIELD,
  stripSessionId,
} from '../../src/tools/session-selector.js';

describe('session selector', () => {
  it('reads a non-empty sessionId from a tool-call argument object', () => {
    expect(extractSessionId({ nodeId: '1:2', sessionId: 'abc-123' })).toBe('abc-123');
  });

  it('returns undefined when no sessionId is present', () => {
    expect(extractSessionId({ nodeId: '1:2' })).toBeUndefined();
  });

  it('returns undefined for an empty or non-string sessionId', () => {
    expect(extractSessionId({ sessionId: '' })).toBeUndefined();
    expect(extractSessionId({ sessionId: 42 })).toBeUndefined();
    expect(extractSessionId({ sessionId: null })).toBeUndefined();
  });

  it('returns undefined for non-object arguments', () => {
    expect(extractSessionId(undefined)).toBeUndefined();
    expect(extractSessionId(null)).toBeUndefined();
    expect(extractSessionId('a string')).toBeUndefined();
    expect(extractSessionId(['a', 'b'])).toBeUndefined();
  });

  it('strips the selector field from an object without mutating the original', () => {
    const original = { nodeId: '1:2', sessionId: 'abc-123', format: 'PNG' };
    const stripped = stripSessionId(original) as Record<string, unknown>;
    expect(stripped).toEqual({ nodeId: '1:2', format: 'PNG' });
    expect(SESSION_ID_FIELD in stripped).toBe(false);
    // The source object is untouched — routing must never mutate the caller's args.
    expect(original).toEqual({ nodeId: '1:2', sessionId: 'abc-123', format: 'PNG' });
  });

  it('leaves arguments unchanged when there is no selector to strip', () => {
    const args = { nodeId: '1:2' };
    expect(stripSessionId(args)).toBe(args);
    expect(stripSessionId('not an object')).toBe('not an object');
    expect(stripSessionId(null)).toBeNull();
  });
});
