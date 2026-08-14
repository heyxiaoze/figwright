import { describe, expect, it } from 'vitest';

import { buildInvite, parseInvite } from '../ui/lib/invite.js';

describe('invite parser', () => {
  it('parses a valid invite', () => {
    const parsed = parseInvite('figwright://connect?host=192.168.1.50&port=3055');
    expect(parsed).toEqual({ host: '192.168.1.50', port: 3055 });
  });

  it('tolerates surrounding whitespace and param order', () => {
    const parsed = parseInvite('  figwright://connect?port=3055&host=10.0.0.2  ');
    expect(parsed).toEqual({ host: '10.0.0.2', port: 3055 });
  });

  it('returns null for non-invite strings', () => {
    expect(parseInvite('ws://192.168.1.50:3055')).toBeNull();
    expect(parseInvite('hello')).toBeNull();
    expect(parseInvite('figwright://connect?host=1.2.3.4&port=abc')).toBeNull();
  });

  it('builds a round-trippable invite', () => {
    const settings = { host: '0.0.0.0', port: 3055 };
    const parsed = parseInvite(buildInvite(settings));
    expect(parsed?.host).toBe('0.0.0.0');
    expect(parsed?.port).toBe(3055);
  });
});
