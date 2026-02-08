// ============================================================================
// @utopia/ai — MCP Protocol Types
// ============================================================================

import type { JsonSchema } from '../types.js';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MCP Server info
// ---------------------------------------------------------------------------

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion?: string;
}

// ---------------------------------------------------------------------------
// MCP Tools
// ---------------------------------------------------------------------------

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface MCPToolHandler {
  definition: MCPToolDefinition;
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult> | MCPToolResult;
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

export interface MCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
}

// ---------------------------------------------------------------------------
// MCP Resources
// ---------------------------------------------------------------------------

export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceHandler {
  definition: MCPResourceDefinition;
  handler: (uri: string) => Promise<MCPResourceContent> | MCPResourceContent;
}

export interface MCPResourceContent {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

// ---------------------------------------------------------------------------
// MCP Prompts
// ---------------------------------------------------------------------------

export interface MCPPromptDefinition {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPromptHandler {
  definition: MCPPromptDefinition;
  handler: (args: Record<string, string>) => Promise<MCPPromptResult> | MCPPromptResult;
}

export interface MCPPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: MCPContent;
  }>;
}

// ---------------------------------------------------------------------------
// MCP Server config
// ---------------------------------------------------------------------------

export interface MCPServerConfig {
  /** Server name (shown to clients). */
  name: string;
  /** Server version. */
  version?: string;
  /** Tools this server exposes. */
  tools?: MCPToolHandler[];
  /** Resources this server exposes. */
  resources?: MCPResourceHandler[];
  /** Prompts this server exposes. */
  prompts?: MCPPromptHandler[];
}

// ---------------------------------------------------------------------------
// MCP Client config
// ---------------------------------------------------------------------------

export interface MCPClientConfig {
  /** URL of the MCP server. */
  url: string;
  /** Optional headers for authentication. */
  headers?: Record<string, string>;
}
