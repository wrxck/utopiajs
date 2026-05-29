// ============================================================================
// @matthesketh/utopia-ai — MCP Public API
// ============================================================================

export { createMCPServer } from './server';
export type { MCPServer } from './server';

export { createMCPClient } from './client';
export type { MCPClient } from './client';

export { createMCPHandler } from './handler';

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
} from './types';
