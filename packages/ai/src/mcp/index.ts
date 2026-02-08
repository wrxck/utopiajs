// ============================================================================
// @matthesketh/utopia-ai — MCP Public API
// ============================================================================

export { createMCPServer } from './server.js';
export type { MCPServer } from './server.js';

export { createMCPClient } from './client.js';
export type { MCPClient } from './client.js';

export { createMCPHandler } from './handler.js';

export type {
  MCPServerConfig,
  MCPServerInfo,
  MCPToolDefinition,
  MCPToolHandler,
  MCPToolResult,
  MCPContent,
  MCPResourceDefinition,
  MCPResourceHandler,
  MCPResourceContent,
  MCPPromptDefinition,
  MCPPromptArgument,
  MCPPromptHandler,
  MCPPromptResult,
  MCPClientConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
} from './types.js';
