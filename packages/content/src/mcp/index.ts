import type { CollectionConfig, ContentAdapter } from '../types.js';
import { createFilesystemAdapter, validateSlug } from '../adapters/filesystem.js';
import { createContentTools } from './tools.js';

/** JSON-RPC 2.0 types (self-contained — no dependency on @matthesketh/utopia-ai) */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ContentMCPServer {
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  info(): { name: string; version: string };
}

export interface ContentMCPServerConfig {
  contentDir: string;
  collections: CollectionConfig[];
  adapter?: ContentAdapter;
}

/**
 * Create an MCP server for content operations.
 *
 * Exposes tools for listing, reading, creating, updating, deleting, and
 * searching content entries. Also exposes content as MCP resources.
 *
 * ```ts
 * import { createContentMCPServer } from '@matthesketh/utopia-content/mcp';
 *
 * const server = createContentMCPServer({
 *   contentDir: 'content',
 *   collections: [blog, pages],
 * });
 *
 * const response = await server.handleRequest(request);
 * ```
 */
export function createContentMCPServer(config: ContentMCPServerConfig): ContentMCPServer {
  const adapter = config.adapter ?? createFilesystemAdapter(config.contentDir);
  const collectionMap = new Map(config.collections.map((c) => [c.name, { config: c, adapter }]));

  const tools = createContentTools(() => collectionMap);
  const toolMap = new Map(tools.map((t) => [t.definition.name, t]));

  const serverInfo = { name: 'utopia-content', version: '0.6.0' };

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const result = await dispatch(request);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (err: unknown) {
      const rpcErr = err as { code?: number; message?: string };
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: rpcErr.code ?? -32603,
          message: rpcErr.message ?? 'Internal error',
        },
      };
    }
  }

  async function dispatch(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo,
        };

      case 'tools/list':
        return {
          tools: tools.map((t) => ({
            name: t.definition.name,
            description: t.definition.description,
            inputSchema: t.definition.inputSchema,
          })),
        };

      case 'tools/call': {
        const params = request.params as { name: string; arguments?: Record<string, unknown> };
        const tool = toolMap.get(params.name);
        if (!tool) throw { code: -32602, message: `Unknown tool: ${params.name}` };
        return tool.handler(params.arguments ?? {});
      }

      case 'resources/list':
        return {
          resources: Array.from(collectionMap.keys()).flatMap((name) => [
            {
              uri: `content://${name}`,
              name: `${name} collection`,
              description: `List all entries in the ${name} collection`,
              mimeType: 'application/json',
            },
          ]),
        };

      case 'resources/read': {
        const params = request.params as { uri: string };
        const match = params.uri.match(/^content:\/\/([^/]+)(?:\/(.+))?$/);
        if (!match) throw { code: -32602, message: `Invalid resource URI: ${params.uri}` };

        const [, collectionName, slug] = match;
        const col = collectionMap.get(collectionName);
        if (!col) throw { code: -32602, message: `Unknown collection: ${collectionName}` };

        if (slug) {
          validateSlug(slug);
          const entry = await col.adapter.readEntry(col.config, slug);
          if (!entry) throw { code: -32602, message: `Entry not found: ${slug}` };
          return {
            contents: [
              {
                uri: params.uri,
                text: JSON.stringify(
                  { slug: entry.slug, data: entry.data, body: entry.body, html: entry.html },
                  null,
                  2,
                ),
                mimeType: 'application/json',
              },
            ],
          };
        } else {
          const entries = await col.adapter.readEntries(col.config);
          return {
            contents: [
              {
                uri: params.uri,
                text: JSON.stringify(
                  entries.map((e) => ({ slug: e.slug, ...e.data })),
                  null,
                  2,
                ),
                mimeType: 'application/json',
              },
            ],
          };
        }
      }

      case 'ping':
        return {};

      default:
        throw { code: -32601, message: `Method not found: ${request.method}` };
    }
  }

  return { handleRequest, info: () => serverInfo };
}

export { createContentTools } from './tools.js';
export type { ContentToolHandler, ContentToolDefinition, ContentToolResult } from './tools.js';
