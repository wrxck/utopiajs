// ============================================================================
// @matthesketh/utopia-ai — Missing peer dependency errors
//
// Each SDK mock factory throws, simulating the peer package not being
// installed; the adapters must surface a helpful install hint.
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { openaiAdapter } from './openai';
import { anthropicAdapter } from './anthropic';
import { googleAdapter } from './google';

vi.mock('openai', () => {
  throw new Error('Cannot find module openai');
});
vi.mock('@anthropic-ai/sdk', () => {
  throw new Error('Cannot find module @anthropic-ai/sdk');
});
vi.mock('@google/generative-ai', () => {
  throw new Error('Cannot find module @google/generative-ai');
});

describe('missing peer dependencies', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('openai adapter explains how to install the peer dependency', async () => {
    await expect(openaiAdapter({ apiKey: 'sk' }).chat({ messages })).rejects.toThrow(
      '@matthesketh/utopia-ai: "openai" package is required for the OpenAI adapter. ' +
        'Install it with: npm install openai',
    );
  });

  it('anthropic adapter explains how to install the peer dependency', async () => {
    await expect(anthropicAdapter({ apiKey: 'sk' }).chat({ messages })).rejects.toThrow(
      '@matthesketh/utopia-ai: "@anthropic-ai/sdk" package is required for the Anthropic adapter. ' +
        'Install it with: npm install @anthropic-ai/sdk',
    );
  });

  it('google adapter explains how to install the peer dependency', async () => {
    await expect(googleAdapter({ apiKey: 'g' }).chat({ messages })).rejects.toThrow(
      '@matthesketh/utopia-ai: "@google/generative-ai" package is required for the Google adapter. ' +
        'Install it with: npm install @google/generative-ai',
    );
  });
});
