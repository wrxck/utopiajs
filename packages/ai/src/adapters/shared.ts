// ============================================================================
// @matthesketh/utopia-ai — Internal helpers shared by the provider adapters
//
// Not part of the public API: nothing here is re-exported from a package
// entry point.
// ============================================================================

import type { MessageContent } from '../types';

/** Parse a JSON object string, returning undefined when malformed. */
export function tryParseJSON(str: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/** Only http(s) base URLs are permitted (no file:, etc.). */
export function assertHttpBaseURL(url: string, provider: string): void {
  if (!/^https?:$/.test(new URL(url).protocol)) {
    throw new Error(`${provider} baseURL must be http(s): ${url}`);
  }
}

/** Monotonic counter for generating unique synthetic tool call IDs. */
let toolCallCounter = 0;

/** Generate a unique synthetic tool-call id for providers without native ids. */
export function nextToolCallId(): string {
  return `call_${++toolCallCounter}_${Date.now().toString(36)}`;
}

/** Standard error for a missing optional peer dependency. */
export function missingPeerDepError(pkg: string, adapterName: string): Error {
  return new Error(
    `@matthesketh/utopia-ai: "${pkg}" package is required for the ${adapterName} adapter. ` +
      `Install it with: npm install ${pkg}`,
  );
}

/** Flatten any MessageContent shape into plain text (drops non-text parts). */
export function messageContentToText(content: MessageContent | MessageContent[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : 'text' in c ? c.text : '')).join('');
  }
  return 'text' in content ? content.text : '';
}
