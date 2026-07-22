// @vitest-environment node
// ============================================================================
// create-utopia — main() flow tests (mocked prompts + child_process)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface PromptsMockState {
  /** Canned answers keyed by prompt name. */
  answers: Record<string, unknown>;
  /** When true the mock triggers onCancel (simulates Ctrl-C). */
  cancel: boolean;
}

const mockState: PromptsMockState = { answers: {}, cancel: false };

vi.mock('prompts', () => ({
  default: vi.fn(
    async (
      questions: Array<Record<string, any>>,
      opts?: { onCancel?: () => void },
    ): Promise<Record<string, unknown>> => {
      if (mockState.cancel) {
        opts?.onCancel?.();
        return {};
      }
      const values: Record<string, unknown> = {};
      for (const q of questions) {
        // Emulate prompts' dynamic type evaluation so the question-skipping
        // logic in main() is exercised for real.
        const type = typeof q.type === 'function' ? q.type(undefined, values) : q.type;
        if (type === null || type === undefined) continue;
        if (typeof q.message === 'function') q.message(undefined, values);
        let answer =
          q.name in mockState.answers ? mockState.answers[q.name] : (q.initial ?? undefined);
        if (typeof q.validate === 'function') {
          const verdict = q.validate(String(answer ?? ''));
          // Like real prompts, a rejected answer re-prompts; our stand-in
          // falls back to the initial value instead.
          if (verdict !== true) answer = q.initial;
        }
        values[q.name] = answer;
      }
      return values;
    },
  ),
}));

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

import { main, stripAnsi } from './index';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const SCRATCH =
  process.env.CLAUDE_SCRATCHPAD ??
  '/tmp/claude-0/-home-user-utopiajs/4e9c47cd-38d7-56cd-a2c6-8bddac297eab/scratchpad';

let tmpDir: string;
let originalCwd: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(SCRATCH, 'create-utopia-main-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  mockState.answers = {};
  mockState.cancel = false;
  execSyncMock.mockReset();

  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  exitSpy.mockRestore();
  logSpy.mockRestore();
});

function argv(...rest: string[]): string[] {
  return ['node', 'create-utopia', ...rest];
}

function loggedText(): string {
  return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('main()', () => {
  it('scaffolds a project from a positional name without prompting for it', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };

    await main(argv('demo-app'));

    const root = path.join(tmpDir, 'demo-app');
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('demo-app');
    // Git init not requested — execSync never called.
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('sanitizes the positional name for both directory and package name', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };

    await main(argv('My Cool App'));

    const root = path.join(tmpDir, 'my-cool-app');
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
  });

  it('scaffolds into the current directory for "." using its basename as name', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };

    await main(argv('.'));

    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
    // Previously this produced an invalid empty package name.
    expect(pkg.name).toBe(path.basename(tmpDir).toLowerCase());
    expect(fs.existsSync(path.join(tmpDir, 'src', 'App.utopia'))).toBe(true);
    // No dangling `cd ` step when scaffolding in place (bug fix).
    expect(stripAnsi(loggedText())).not.toMatch(/cd\s*$/m);
  });

  it('falls back to defaults when prompts yield no answers', async () => {
    // prompts can return undefined values (e.g. terminal oddities); main()
    // must fall back to typescript + router + git.
    mockState.answers = {
      language: undefined,
      features: undefined,
      cssPreprocessor: undefined,
      initGit: undefined,
    };
    execSyncMock.mockReturnValue(Buffer.from(''));

    await main(argv('defaults-app'));

    const root = path.join(tmpDir, 'defaults-app');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.dependencies['@matthesketh/utopia-router']).toBeDefined();
    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith('git init', expect.anything());
  });

  it('prompts for the project name when no argument is given', async () => {
    mockState.answers = {
      projectName: 'typed-app',
      language: 'typescript',
      features: ['router'],
      initGit: false,
    };

    await main(argv());

    expect(fs.existsSync(path.join(tmpDir, 'typed-app', 'package.json'))).toBe(true);
  });

  it('falls back to a placeholder banner version when package.json is unreadable', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };
    const readSpy = vi.spyOn(fs, 'readFileSync');
    readSpy.mockImplementationOnce(() => {
      throw new Error('unreadable');
    });

    await main(argv('banner-app'));
    readSpy.mockRestore();

    expect(loggedText()).toContain('v0.0.0');
    expect(fs.existsSync(path.join(tmpDir, 'banner-app', 'package.json'))).toBe(true);
  });

  it('rejects an unsalvageable typed project name and falls back to the default', async () => {
    // "." sanitizes to "" which fails validation; the prompt would re-ask and
    // our mock then answers with the initial default.
    mockState.answers = {
      projectName: '.',
      language: 'typescript',
      features: ['router'],
      initGit: false,
    };

    await main(argv());

    const root = path.join(tmpDir, 'utopia-app');
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
  });

  it('falls back to "utopia-app" when even the directory basename is unusable', async () => {
    // A cwd named "_" sanitizes to an empty string, exhausting the basename
    // fallback as well.
    const weird = path.join(tmpDir, '_');
    fs.mkdirSync(weird);
    process.chdir(weird);
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };

    await main(argv('.'));

    const pkg = JSON.parse(fs.readFileSync(path.join(weird, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('utopia-app');
  });

  it('initializes git when requested and reports success', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: true };
    execSyncMock.mockReturnValue(Buffer.from(''));

    await main(argv('git-app'));

    expect(execSyncMock).toHaveBeenCalledWith('git init', expect.anything());
    expect(loggedText()).toContain('Initialized git repository');
  });

  it('reports a warning when git init fails', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: true };
    execSyncMock.mockImplementation(() => {
      throw new Error('no git');
    });

    await main(argv('git-fail-app'));

    expect(loggedText()).toContain('Could not initialize git repository');
  });

  it('exits when the user cancels the prompts', async () => {
    mockState.cancel = true;
    await expect(main(argv())).rejects.toThrow('process.exit(1)');
  });

  it('aborts when the target directory is non-empty and overwrite is declined', async () => {
    const target = path.join(tmpDir, 'busy');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    mockState.answers = {
      overwrite: false,
      language: 'typescript',
      features: ['router'],
      initGit: false,
    };

    await expect(main(argv('busy'))).rejects.toThrow('process.exit(1)');
    // Existing content untouched.
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true);
  });

  it('replaces a non-empty target directory when overwrite is confirmed', async () => {
    const target = path.join(tmpDir, 'busy');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'old.txt'), 'x');
    mockState.answers = {
      overwrite: true,
      language: 'typescript',
      features: ['router'],
      initGit: false,
    };

    await main(argv('busy'));

    expect(fs.existsSync(path.join(target, 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
  });

  it('threads feature selections through to the scaffolder', async () => {
    mockState.answers = {
      language: 'javascript',
      features: ['router', 'css-preprocessor'],
      cssPreprocessor: 'sass',
      initGit: false,
    };

    await main(argv('feature-app'));

    const root = path.join(tmpDir, 'feature-app');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.devDependencies['sass']).toBeDefined();
    expect(pkg.devDependencies['typescript']).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'src', 'main.js'))).toBe(true);
  });

  it('prints next steps including cd when scaffolding a subdirectory', async () => {
    mockState.answers = { language: 'typescript', features: ['router'], initGit: false };

    await main(argv('steps-app'));

    const text = loggedText();
    expect(text).toContain('cd steps-app');
    expect(text).toContain('npm install');
    expect(text).toContain('npm run dev');
  });
});
