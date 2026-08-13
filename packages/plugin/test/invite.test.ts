import { describe, expect, it } from 'vitest';

import { buildInvite, parseInvite } from '../ui/lib/invite.js';

describe('invite parser', () => {
  it('parses a valid invite', () => {
    const parsed = parseInvite('figwright://connect?host=192.168.1.50&port=3055&token=abc');
    expect(parsed).toEqual({ host: '192.168.1.50', port: 3055, token: 'abc' });
  });

  it('tolerates surrounding whitespace and param order', () => {
    const parsed = parseInvite('  figwright://connect?token=x&port=3055&host=10.0.0.2  ');
    expect(parsed).toEqual({ host: '10.0.0.2', port: 3055, token: 'x' });
  });

  it('returns null for non-invite strings', () => {
    expect(parseInvite('ws://192.168.1.50:3055')).toBeNull();
    expect(parseInvite('hello')).toBeNull();
    expect(parseInvite('figwright://connect?host=1.2.3.4&port=abc&token=x')).toBeNull();
    expect(parseInvite('figwright://connect?host=1.2.3.4&port=3055')).toBeNull();
  });

  it('builds a round-trippable invite (tokens with special chars)', () => {
    const settings = { host: '0.0.0.0', port: 3055, token: 't ok+/=' };
    const parsed = parseInvite(buildInvite(settings));
    expect(parsed?.host).toBe('0.0.0.0');
    expect(parsed?.port).toBe(3055);
    expect(parsed?.token).toBe('t ok+/=');
  });
});
