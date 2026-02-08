// ============================================================================
// @matthesketh/utopia-ai — MCP Client
// ============================================================================

import type {
  MCPClientConfig,
  MCPToolDefinition,
  MCPToolResult,
  MCPResourceDefinition,
  MCPResourceContent,
  MCPPromptDefinition,
  MCPPromptResult,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types.js';
import type { ToolHandler } from '../ai.js';

export interface MCPClient {
  /** Initialize the connection and get server capabilities. */
  initialize(): Promise<{ protocolVersion: string; serverInfo: { name: string; version: string } }>;
  /** List available tools from the server. */
  listTools(): Promise<MCPToolDefinition[]>;
  /** Call a tool on the server. */
  callTool(name: string, args?: Record<string, unknown>): Promise<MCPToolResult>;
  /** List available resources. */
  listResources(): Promise<MCPResourceDefinition[]>;
  /** Read a resource by URI. */
  readResource(uri: string): Promise<MCPResourceContent>;
  /** List available prompts. */
  listPrompts(): Promise<MCPPromptDefinition[]>;
  /** Get a prompt with arguments. */
  getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptResult>;
  /**
   * Convert server tools into ToolHandler[] compatible with `ai.run()`.
   * This bridges MCP servers directly into the AI tool-calling loop.
   */
  toToolHandlers(): Promise<ToolHandler[]>;
}

/**
 * Create an MCP client that connects to an MCP server over HTTP.
 *
 * ```ts
 * import { createMCPClient } from '@matthesketh/utopia-ai/mcp';
 *
 * const client = createMCPClient({ url: 'http://localhost:3001/mcp' });
 * await client.initialize();
 *
 * const tools = await client.listTools();
 * const result = await client.callTool('get_weather', { city: 'NYC' });
 *
 * // Bridge MCP tools into AI tool loop
 * const ai = createAI(openaiAdapter({ apiKey: '...' }));
 * const toolHandlers = await client.toToolHandlers();
 * const response = await ai.run({
 *   messages: [{ role: 'user', content: 'What is the weather?' }],
 *   tools: toolHandlers,
 * });
 * ```
 */
export function createMCPClient(config: MCPClientConfig): MCPClient {
  let requestId = 0;

  async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++requestId,
      method,
      params,
    };

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP server error ${response.status}: ${text}`);
    }

    const result: JsonRpcResponse = await response.json();

    if (result.error) {
      const err = new Error(result.error.message) as any;
      err.code = result.error.code;
      err.data = result.error.data;
      throw err;
    }

    return result.result;
  }

  return {
    async initialize() {
      const result = await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'utopia-mcp-client', version: '1.0.0' },
      });
      return result as any;
    },

    async listTools() {
      const result = await rpc('tools/list') as any;
      return result.tools ?? [];
    },

    async callTool(name: string, args?: Record<string, unknown>) {
      const result = await rpc('tools/call', { name, arguments: args });
      return result as MCPToolResult;
    },

    async listResources() {
      const result = await rpc('resources/list') as any;
      return result.resources ?? [];
    },

    async readResource(uri: string) {
      const result = await rpc('resources/read', { uri }) as any;
      return result.contents?.[0] ?? result;
    },

    async listPrompts() {
      const result = await rpc('prompts/list') as any;
      return result.prompts ?? [];
    },

    async getPrompt(name: string, args?: Record<string, string>) {
      const result = await rpc('prompts/get', { name, arguments: args });
      return result as MCPPromptResult;
    },

    async toToolHandlers(): Promise<ToolHandler[]> {
      const tools = await this.listTools();

      return tools.map((tool): ToolHandler => ({
        definition: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
        handler: async (args: Record<string, unknown>) => {
          const result = await this.callTool(tool.name, args);
          if (result.isError) {
            throw new Error(
              result.content.map((c) => c.text ?? '').join('\n') || 'Tool call failed',
            );
          }
          return result.content.map((c) => c.text ?? '').join('\n');
        },
      }));
    },
  };
}
