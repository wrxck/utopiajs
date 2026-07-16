// ============================================================================
// @matthesketh/utopia-ai — MCP Public API
// ============================================================================

export type { MCPClient } from '@/mcp/client';
export { createMCPClient } from '@/mcp/client';
export { createMCPHandler } from '@/mcp/handler';
export type { MCPServer } from '@/mcp/server';
export { createMCPServer } from '@/mcp/server';
export type {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  MCPClientConfig,
  MCPContent,
  MCPPromptArgument,
  MCPPromptDefinition,
  MCPPromptHandler,
  MCPPromptResult,
  MCPResourceContent,
  MCPResourceDefinition,
  MCPResourceHandler,
  MCPServerConfig,
  MCPServerInfo,
  MCPToolDefinition,
  MCPToolHandler,
  MCPToolResult,
} from '@/mcp/types';
