import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS, filterToolSpecs, WRITE_TOOL_NAMES } from '../../src/tools/registry.js';

describe('filterToolSpecs', () => {
  it('returns every spec when not read-only', () => {
    const result = filterToolSpecs(ALL_TOOL_SPECS, { readonly: false });
    expect(result).toHaveLength(ALL_TOOL_SPECS.length);
  });

  it('drops every write tool in read-only mode', () => {
    const result = filterToolSpecs(ALL_TOOL_SPECS, { readonly: true });

    // No write tool survives.
    expect(result.some(spec => spec.kind === 'write')).toBe(false);

    // Exactly the non-write specs (reads + server-local helpers) remain.
    const nonWrites = ALL_TOOL_SPECS.filter(spec => spec.kind !== 'write');
    expect(result).toHaveLength(nonWrites.length);

    // The count of hidden tools matches the derived write set.
    expect(ALL_TOOL_SPECS.length - result.length).toBe(WRITE_TOOL_NAMES.size);
  });

  it('keeps ping and context helpers visible in read-only mode', () => {
    const result = filterToolSpecs(ALL_TOOL_SPECS, { readonly: true });
    const byName = new Map(result.map(spec => [spec.name, spec]));

    // ping is a read tool — always advertised so the plugin can verify connectivity.
    expect(byName.has('ping')).toBe(true);

    // A representative write is gone.
    const anyWrite = ALL_TOOL_SPECS.find(spec => spec.kind === 'write');
    expect(anyWrite).toBeDefined();
    if (anyWrite) expect(byName.has(anyWrite.name)).toBe(false);
  });

  it('does not mutate the input array', () => {
    const before = ALL_TOOL_SPECS.length;
    filterToolSpecs(ALL_TOOL_SPECS, { readonly: true });
    filterToolSpecs(ALL_TOOL_SPECS, { readonly: false });
    expect(ALL_TOOL_SPECS.length).toBe(before);
  });
});
