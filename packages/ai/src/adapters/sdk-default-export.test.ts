// ============================================================================
// @matthesketh/utopia-ai — SDK default-export fallback
//
// Some SDK builds only expose a default export; the adapters must fall back
// to it when the named export is missing.
// ============================================================================

import { describe, expect, it, vi } from 'vitest';

import { anthropicAdapter } from './anthropic';
import { openaiAdapter } from './openai';

// Note: the named export is declared but undefined — vitest mock namespaces
// throw on access to exports that are not declared at all, so this is the
// closest emulation of an SDK build that only ships a default export.
vi.mock('openai', () => {
  class OpenAIDefault {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'via default export' }, finish_reason: 'stop' }],
        }),
      },
    };
  }
  return { OpenAI: undefined, default: OpenAIDefault };
});

vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicDefault {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'via default export' }],
        stop_reason: 'end_turn',
      }),
    };
  }
  return { Anthropic: undefined, default: AnthropicDefault };
});

describe('SDK default-export fallback', () => {
  it('openai adapter uses the default export when no named export exists', async () => {
    const res = await openaiAdapter({ apiKey: 'sk' }).chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('via default export');
  });

  it('anthropic adapter uses the default export when no named export exists', async () => {
    const res = await anthropicAdapter({ apiKey: 'sk' }).chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('via default export');
  });
});
