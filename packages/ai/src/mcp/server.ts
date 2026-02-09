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
} from './types.js';

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
    try {
      const result = await dispatch(request);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: err.code ?? -32603,
          message: err.message ?? 'Internal error',
          data: err.data,
        },
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
        const params = request.params as { name: string; arguments?: Record<string, unknown> };
        const tool = toolMap.get(params.name);
        if (!tool) {
          throw makeError(-32602, `Unknown tool: ${params.name}`);
        }
        return tool.handler(params.arguments ?? {});
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
        const params = request.params as { uri: string };
        const resource = findResource(params.uri);
        if (!resource) {
          throw makeError(-32602, `Unknown resource: ${params.uri}`);
        }
        const content = await resource.handler(params.uri);
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
        const params = request.params as { name: string; arguments?: Record<string, string> };
        const prompt = promptMap.get(params.name);
        if (!prompt) {
          throw makeError(-32602, `Unknown prompt: ${params.name}`);
        }
        return prompt.handler(params.arguments ?? {});
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

function matchesTemplate(pattern: string, uri: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\\\{[^\\}]+\\\}/g, '([^/]+)');
  return new RegExp(`^${regex}$`).test(uri);
}

function makeError(code: number, message: string): { code: number; message: string } {
  return { code, message };
}
