import type { Tool } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ToolSpec } from '../src/tools/spec.js';
import { SESSION_ID_DESCRIPTION, SESSION_ID_FIELD } from '../src/tools/session-selector.js';

/**
 * Derive the JSON-Schema `Tool` definition a spec advertises — independently of the SDK.
 *
 * Per-tool tests use it to assert the advertised contract (required fields, property types) a
 * client sees, without that derivation living in src. `e2e/mcp-wire.test.ts` then checks this
 * derivation against what a real MCP client receives over stdio, which is what makes the
 * independence worth having: if an SDK release changes schema generation, the two sides disagree
 * and the wire gate fails. Keep the conversion options matching what the SDK asks Zod for (`io:
 * 'input'`, 2020-12) or that comparison reports a difference that isn't real.
 */
export const toToolDefinition = (spec: ToolSpec): Tool => {
  // The server adds the optional session selector to every tool at registration (see
  // createMcpServer), so the advertised schema always carries it. Derive it the same way here —
  // through Zod — so the two generations match byte-for-byte and the gate still catches a real
  // SDK schema regression rather than this field.
  const schema = spec.inputSchema.extend({
    [SESSION_ID_FIELD]: z.string().optional().describe(SESSION_ID_DESCRIPTION),
  });
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(schema, {
      io: 'input',
      target: 'draft-2020-12',
    }) as Tool['inputSchema'],
  };
};
