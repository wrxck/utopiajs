// ============================================================================
// @matthesketh/utopia-ai — MCP Server
// ============================================================================

import type {
  MCPServerConfig,
  MCPServerInfo,
  MCPToolHandler,
  MCPResourceHandler,
  MCPPromptHandler,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types';

export interface MCPServer {
  /** Handle a JSON-RPC request and return a response. */
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Get server info. */
  info(): MCPServerInfo;
}

/**
 * Create an MCP server that exposes tools, resources, and prompts.
 *
 * ```ts
 * import { createMCPServer } from '@matthesketh/utopia-ai/mcp';
 *
 * const mcp = createMCPServer({
 *   name: 'my-app',
 *   tools: [{
 *     definition: {
 *       name: 'get_user',
 *       description: 'Look up a user by ID',
 *       inputSchema: {
 *         type: 'object',
 *         properties: { id: { type: 'string', description: 'User ID' } },
 *         required: ['id'],
 *       },
 *     },
 *     handler: async ({ id }) => ({
 *       content: [{ type: 'text', text: JSON.stringify({ id, name: 'Alice' }) }],
 *     }),
 *   }],
 * });
 * ```
 */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  const serverInfo: MCPServerInfo = {
    name: config.name,
    version: config.version ?? '1.0.0',
    protocolVersion: '2024-11-05',
  };

  const toolMap = new Map<string, MCPToolHandler>(
    (config.tools ?? []).map((t) => [t.definition.name, t]),
  );

  const resourceMap = new Map<string, MCPResourceHandler>(
    (config.resources ?? []).map((r) => [r.definition.uri, r]),
  );

  const promptMap = new Map<string, MCPPromptHandler>(
    (config.prompts ?? []).map((p) => [p.definition.name, p]),
  );

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Validate JSON-RPC 2.0 envelope.
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid Request: must include jsonrpc "2.0" and a string method',
        },
      };
    }

    try {
      const result = await dispatch(request);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (err: unknown) {
      const rpcErr = err as { code?: number; message?: string; data?: unknown };
      // only surface details for intentional json-rpc errors (those carry a
      // numeric code from makeError). a raw handler exception is collapsed to a
      // generic message so internal details — db errors, file paths, stack
      // text — are not echoed back to the (possibly untrusted) caller.
      if (typeof rpcErr.code === 'number') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: rpcErr.code, message: rpcErr.message ?? 'Error', data: rpcErr.data },
        };
      }
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: 'Internal error' },
      };
    }
  }

  async function dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return {
          protocolVersion: serverInfo.protocolVersion,
          capabilities: {
            tools: toolMap.size > 0 ? {} : undefined,
            resources: resourceMap.size > 0 ? {} : undefined,
            prompts: promptMap.size > 0 ? {} : undefined,
          },
          serverInfo: {
            name: serverInfo.name,
            version: serverInfo.version,
          },
        };

      case 'tools/list':
        return {
          tools: [...toolMap.values()].map((t) => ({
            name: t.definition.name,
            description: t.definition.description,
            inputSchema: t.definition.inputSchema,
          })),
        };

      case 'tools/call': {
        const params = asParamsObject(request.params, 'tools/call');
        const name = params.name;
        if (typeof name !== 'string') {
          throw makeError(-32602, 'tools/call requires a string "name"');
        }
        const tool = toolMap.get(name);
        if (!tool) {
          throw makeError(-32602, `Unknown tool: ${name}`);
        }
        const args = params.arguments ?? {};
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          throw makeError(-32602, 'tool arguments must be an object');
        }
        const argRecord = args as Record<string, unknown>;
        validateAgainstSchema(tool.definition.inputSchema, argRecord, name);
        return tool.handler(argRecord);
      }

      case 'resources/list':
        return {
          resources: [...resourceMap.values()].map((r) => ({
            uri: r.definition.uri,
            name: r.definition.name,
            description: r.definition.description,
            mimeType: r.definition.mimeType,
          })),
        };

      case 'resources/read': {
        const params = asParamsObject(request.params, 'resources/read');
        const uri = params.uri;
        if (typeof uri !== 'string') {
          throw makeError(-32602, 'resources/read requires a string "uri"');
        }
        const resource = findResource(uri);
        if (!resource) {
          throw makeError(-32602, `Unknown resource: ${uri}`);
        }
        const content = await resource.handler(uri);
        return { contents: [content] };
      }

      case 'prompts/list':
        return {
          prompts: [...promptMap.values()].map((p) => ({
            name: p.definition.name,
            description: p.definition.description,
            arguments: p.definition.arguments,
          })),
        };

      case 'prompts/get': {
        const params = asParamsObject(request.params, 'prompts/get');
        const name = params.name;
        if (typeof name !== 'string') {
          throw makeError(-32602, 'prompts/get requires a string "name"');
        }
        const prompt = promptMap.get(name);
        if (!prompt) {
          throw makeError(-32602, `Unknown prompt: ${name}`);
        }
        const args = (params.arguments ?? {}) as Record<string, string>;
        return prompt.handler(args);
      }

      case 'ping':
        return {};

      default:
        throw makeError(-32601, `Method not found: ${request.method}`);
    }
  }

  function findResource(uri: string): MCPResourceHandler | undefined {
    // Exact match first
    if (resourceMap.has(uri)) return resourceMap.get(uri);

    // Template match (e.g. "users://{id}" matches "users://123")
    for (const [pattern, handler] of resourceMap) {
      if (matchesTemplate(pattern, uri)) return handler;
    }

    return undefined;
  }

  return { handleRequest, info: () => serverInfo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Matches regex special characters that need escaping. */
export const REGEX_SPECIAL_CHARS_RE = /[.*+?^${}()|[\]\\]/g;

/** Matches escaped template placeholders like `\{id\}` after regex-escaping. */
export const TEMPLATE_PLACEHOLDER_RE = /\\\{[^\\}]+\\\}/g;

function matchesTemplate(pattern: string, uri: string): boolean {
  const escaped = pattern.replace(REGEX_SPECIAL_CHARS_RE, '\\$&');
  const regex = escaped.replace(TEMPLATE_PLACEHOLDER_RE, '([^/]+)');
  // Dynamic RegExp built from sanitized (escaped) input — safe to construct inline.
  return new RegExp(`^${regex}$`).test(uri);
}

function makeError(code: number, message: string): { code: number; message: string } {
  return { code, message };
}

/** assert request.params is a plain object, else raise an invalid-params error. */
function asParamsObject(params: unknown, ctx: string): Record<string, unknown> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw makeError(-32602, `Invalid params for ${ctx}: expected an object`);
  }
  return params as Record<string, unknown>;
}

/**
 * lightweight check of tool arguments against the declared inputSchema:
 * required keys must be present and primitive types must match. this stops a
 * client (or a prompt-injected model) from sending malformed/wrong-typed args
 * that a handler assumed its schema guaranteed.
 */
function validateAgainstSchema(
  schema: unknown,
  args: Record<string, unknown>,
  toolName: string,
): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as {
    required?: unknown;
    properties?: Record<string, { type?: string }>;
  };

  if (Array.isArray(s.required)) {
    for (const key of s.required) {
      if (typeof key === 'string' && !(key in args)) {
        throw makeError(-32602, `Missing required argument "${key}" for tool "${toolName}"`);
      }
    }
  }

  if (s.properties && typeof s.properties === 'object') {
    for (const [key, prop] of Object.entries(s.properties)) {
      const value = args[key];
      if (value === undefined || value === null) continue;
      const expected = prop?.type;
      if (!expected) continue;
      const ok =
        expected === 'number' || expected === 'integer'
          ? typeof value === 'number'
          : expected === 'array'
            ? Array.isArray(value)
            : expected === 'object'
              ? typeof value === 'object' && !Array.isArray(value)
              : typeof value === expected;
      if (!ok) {
        throw makeError(
          -32602,
          `Argument "${key}" for tool "${toolName}" must be of type ${expected}`,
        );
      }
    }
  }
}
