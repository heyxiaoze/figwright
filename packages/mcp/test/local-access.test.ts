import { afterEach, describe, expect, it, vi } from 'vitest';

// Control the machine's interfaces so the LAN allow-list is deterministic.
vi.mock('node:os', () => ({
  networkInterfaces: vi.fn<() => Record<string, unknown>>(() => ({})),
}));

import { networkInterfaces } from 'node:os';

import { isAllowedHost, localInterfaceHosts } from '../src/local-access.js';

const mockedInterfaces = networkInterfaces as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  mockedInterfaces.mockReset();
});

const seedInterfaces = (
  list: Array<{ address: string; internal?: boolean; cidr?: string }>,
): void => {
  mockedInterfaces.mockReturnValue({ eth0: list });
};

describe('isAllowedHost', () => {
  it('admits only loopback names when bound to loopback', () => {
    expect(isAllowedHost('127.0.0.1')).toBe(true);
    expect(isAllowedHost('localhost:3055')).toBe(true);
    expect(isAllowedHost('[::1]:3055')).toBe(true);
    // The loopback boundary is the whole defence on the default bind; a foreign host must be refused.
    expect(isAllowedHost('evil.example.com')).toBe(false);
    expect(isAllowedHost('192.168.1.10')).toBe(false);
  });

  it('relaxes to admit the loopback set plus the LAN bind host', () => {
    // Bound to a concrete LAN address: that address and loopback are admitted, a stranger is not.
    expect(isAllowedHost('192.168.1.10', '192.168.1.10')).toBe(true);
    expect(isAllowedHost('127.0.0.1', '192.168.1.10')).toBe(true);
    expect(isAllowedHost('10.0.0.99', '192.168.1.10')).toBe(false);
  });

  it('admits this machine’s own interface addresses on a LAN bind', () => {
    seedInterfaces([{ address: '10.0.0.5', cidr: '10.0.0.5/24' }]);

    expect(localInterfaceHosts().has('10.0.0.5')).toBe(true);
    // A peer addressing us by our interface IP is admitted when we're LAN-bound...
    expect(isAllowedHost('10.0.0.5', '10.0.0.5')).toBe(true);
    // ...but a DNS-rebinding attacker (Host = their domain) still is not.
    expect(isAllowedHost('attacker.test', '10.0.0.5')).toBe(false);
  });

  it('skips link-local and internal addresses in the LAN allow-list', () => {
    seedInterfaces([
      { address: '169.254.1.1', cidr: '169.254.1.1/16' },
      { address: 'fe80::1', cidr: 'fe80::1/64' },
      { address: '127.0.0.1', internal: true },
      { address: '10.0.0.5', cidr: '10.0.0.5/24' },
    ]);

    const hosts = localInterfaceHosts();
    expect(hosts.has('169.254.1.1')).toBe(false);
    expect(hosts.has('fe80::1')).toBe(false);
    expect(hosts.has('127.0.0.1')).toBe(false);
    expect(hosts.has('10.0.0.5')).toBe(true);
  });

  it('rejects an absent or empty Host header', () => {
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });
});
