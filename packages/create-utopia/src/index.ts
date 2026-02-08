#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import { green, cyan, yellow, bold, red, dim } from 'kolorist'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectOptions {
  projectName: string
  language: 'typescript' | 'javascript'
  useRouter: boolean
  useSSR: boolean
  useEmail: boolean
  useAI: boolean
  cssPreprocessor: 'none' | 'sass' | 'less'
  initGit: boolean
}

type CSSPreprocessor = ProjectOptions['cssPreprocessor']

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a string is a legal npm package name.
 * Based on the validate-npm-package-name specification.
 */
function isValidPackageName(name: string): boolean {
  return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)
}

/**
 * Converts an arbitrary string into a valid package name by lowercasing and
 * replacing disallowed characters with hyphens.
 */
function toValidPackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z0-9-~]+/g, '-')
}

/**
 * Returns true when the given directory is empty or contains only `.git`.
 */
function isEmptyDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return true
  const files = fs.readdirSync(dirPath)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/**
 * Recursively copies `src` into `dest`, creating directories as needed.
 * Files whose names are listed in `skip` (relative to src root) are excluded.
 */
function copyDir(src: string, dest: string, skip: Set<string> = new Set(), _root?: string): void {
  const root = _root ?? src
  fs.mkdirSync(dest, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    const relativePath = path.relative(root, srcPath)

    // Skip this entry if it is explicitly listed in the skip set, or if any
    // ancestor directory is listed (e.g. skip "src/routes" skips everything
    // under it).
    const shouldSkip = skip.has(relativePath) || [...skip].some(
      (s) => relativePath.startsWith(s + path.sep),
    )
    if (shouldSkip) continue

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skip, root)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Recursively removes a directory that may contain files that were only
 * partially written. Works like `rm -rf`.
 */
function removeDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return
  fs.rmSync(dirPath, { recursive: true, force: true })
}

/**
 * Reads a text file, applies a replacement map, and writes it back.
 */
function replaceInFile(
  filePath: string,
  replacements: Record<string, string>,
): void {
  let content = fs.readFileSync(filePath, 'utf-8')
  for (const [search, replace] of Object.entries(replacements)) {
    content = content.replaceAll(search, replace)
  }
  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Renames a file if it exists.
 */
function renameFile(dir: string, from: string, to: string): void {
  const srcPath = path.join(dir, from)
  if (fs.existsSync(srcPath)) {
    fs.renameSync(srcPath, path.join(dir, to))
  }
}

// ---------------------------------------------------------------------------
// Scaffolding logic
// ---------------------------------------------------------------------------

function scaffoldProject(root: string, options: ProjectOptions): void {
  const { projectName, language, useRouter, useSSR, useEmail, useAI, cssPreprocessor } = options

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const templateDir = path.resolve(__dirname, '..', 'template')

  // Determine which files/directories to skip when copying the template.
  const skip = new Set<string>()

  if (!useRouter) {
    skip.add(path.join('src', 'routes'))
  }

  if (language === 'javascript') {
    skip.add('tsconfig.json')
  }

  // Skip SSR template files if SSR is not selected.
  if (!useSSR) {
    skip.add(path.join('src', 'entry-server.ts'))
    skip.add(path.join('src', 'entry-client.ts'))
    skip.add('server.js')
  }

  // 1. Copy the template tree
  copyDir(templateDir, root, skip)

  // 2. Replace placeholders
  const pkgJsonPath = path.join(root, 'package.json')
  const indexHtmlPath = path.join(root, 'index.html')

  replaceInFile(pkgJsonPath, { '{{projectName}}': projectName })
  replaceInFile(indexHtmlPath, { '{{projectName}}': projectName })

  // 3. Adjust package.json dependencies based on feature selection
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>
  const deps = pkg['dependencies'] as Record<string, string> | undefined
  const devDeps = pkg['devDependencies'] as Record<string, string> | undefined

  if (!useRouter && deps) {
    delete deps['@matthesketh/utopia-router']
  }

  if (language === 'javascript' && devDeps) {
    delete devDeps['typescript']
  }

  // Add CSS preprocessor dependency
  if (cssPreprocessor === 'sass' && devDeps) {
    devDeps['sass'] = '^1.80.0'
  } else if (cssPreprocessor === 'less' && devDeps) {
    devDeps['less'] = '^4.2.0'
  }

  // Add email dependency
  if (useEmail && deps) {
    deps['@matthesketh/utopia-email'] = '^0.0.4'
  }

  // Add AI dependency
  if (useAI && deps) {
    deps['@matthesketh/utopia-ai'] = '^0.0.4'
  }

  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

  // 4. Handle TypeScript -> JavaScript conversion
  if (language === 'javascript') {
    // Rename .ts files to .js
    renameFile(root, 'vite.config.ts', 'vite.config.js')
    renameFile(path.join(root, 'src'), 'main.ts', 'main.js')

    // Update index.html to reference .js entry
    replaceInFile(indexHtmlPath, { '/src/main.ts': '/src/main.js' })

    // Strip type annotations from vite.config (it's simple enough to work as-is)
    // The template vite.config.ts has no TS-specific syntax so renaming suffices.
  }

  // 5. If SSR is selected, configure the project for server-side rendering
  if (useSSR) {
    // Add SSR dependencies
    const ssrPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>
    const ssrDeps = ssrPkg['dependencies'] as Record<string, string>
    const ssrDevDeps = ssrPkg['devDependencies'] as Record<string, string>
    ssrDeps['@matthesketh/utopia-server'] = '^0.0.4'
    ssrDeps['express'] = '^4.21.0'
    // Move vite to dependencies for the SSR server
    if (ssrDevDeps['vite']) {
      ssrDeps['vite'] = ssrDevDeps['vite']
    }

    // Update scripts for SSR
    const scripts = ssrPkg['scripts'] as Record<string, string>
    scripts['dev'] = 'node server.js'
    scripts['build'] = 'npm run build:client && npm run build:server'
    scripts['build:client'] = 'vite build --outDir dist/client'
    scripts['build:server'] = 'vite build --outDir dist/server --ssr src/entry-server.ts'
    scripts['preview'] = 'NODE_ENV=production node server.js'

    fs.writeFileSync(pkgJsonPath, JSON.stringify(ssrPkg, null, 2) + '\n', 'utf-8')

    // Update index.html to use entry-client and add SSR markers
    const ssrIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <!--ssr-head-->
</head>
<body>
  <div id="app"><!--ssr-outlet--></div>
  <script type="module" src="/src/entry-client.ts"></script>
</body>
</html>
`
    fs.writeFileSync(indexHtmlPath, ssrIndexHtml, 'utf-8')

    // Remove main.ts since we use entry-client.ts and entry-server.ts
    const mainTsPath = path.join(root, 'src', 'main.ts')
    if (fs.existsSync(mainTsPath)) {
      fs.rmSync(mainTsPath)
    }

    // Handle JS renaming for SSR files
    if (language === 'javascript') {
      renameFile(path.join(root, 'src'), 'entry-client.ts', 'entry-client.js')
      renameFile(path.join(root, 'src'), 'entry-server.ts', 'entry-server.js')
      // Update index.html to reference .js
      replaceInFile(indexHtmlPath, { '/src/entry-client.ts': '/src/entry-client.js' })
      // Update server.js to reference .js entry
      replaceInFile(
        path.join(root, 'server.js'),
        { 'entry-server.ts': 'entry-server.js' },
      )
    }
  }

  // 6. If router is not selected, simplify App.utopia
  if (!useRouter) {
    const appPath = path.join(root, 'src', 'App.utopia')
    const simpleApp = `<template>
  <div id="app">
    <h1>Welcome to UtopiaJS</h1>
    <p>Edit <code>src/App.utopia</code> to get started.</p>
  </div>
</template>

<style>
#app {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  color: #333;
}
</style>
`
    fs.writeFileSync(appPath, simpleApp, 'utf-8')

    // Simplify main entry — remove router imports
    const mainPath = path.join(root, 'src', language === 'typescript' ? 'main.ts' : 'main.js')
    const simpleMain = `import { mount } from '@matthesketh/utopia-runtime'
import App from './App.utopia'

mount(App, '#app')
`
    fs.writeFileSync(mainPath, simpleMain, 'utf-8')
  }

  // 7. If AI is selected, scaffold an example chat API route and .env.example
  if (useAI) {
    const ext = language === 'typescript' ? 'ts' : 'js'

    // Create the API route directory structure
    const apiChatDir = path.join(root, 'src', 'routes', 'api', 'chat')
    fs.mkdirSync(apiChatDir, { recursive: true })

    // Write the example chat API endpoint
    const serverFile = path.join(apiChatDir, `+server.${ext}`)
    const serverContent = `import { createAI } from '@matthesketh/utopia-ai';
import { openaiAdapter } from '@matthesketh/utopia-ai/openai';
import { streamSSE } from '@matthesketh/utopia-ai';

const ai = createAI(openaiAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
}));

export async function POST(req${language === 'typescript' ? ': any' : ''}, res${language === 'typescript' ? ': any' : ''}) {
  // Parse request body
  const body = await new Promise${language === 'typescript' ? '<string>' : ''}((resolve) => {
    let data = '';
    req.on('data', (chunk${language === 'typescript' ? ': Buffer' : ''}) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });

  const { messages } = JSON.parse(body);
  const stream = ai.stream({ messages, model: 'gpt-4o' });
  await streamSSE(res, stream);
}
`
    fs.writeFileSync(serverFile, serverContent, 'utf-8')

    // Write .env.example with the OpenAI API key placeholder
    const envExamplePath = path.join(root, '.env.example')
    fs.writeFileSync(envExamplePath, 'OPENAI_API_KEY=sk-your-key-here\n', 'utf-8')
  }
}

/**
 * Initializes a git repository in the given directory.
 */
function initGitRepo(root: string): boolean {
  try {
    execSync('git init', { cwd: root, stdio: 'ignore' })
    execSync('git add -A', { cwd: root, stdio: 'ignore' })
    execSync('git commit -m "Initial commit (created with create-utopia)"', {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Determines the package manager that invoked `create-utopia`.
 * Falls back to "npm" if detection fails.
 */
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  const userAgent = process.env['npm_config_user_agent'] ?? ''
  if (userAgent.startsWith('yarn')) return 'yarn'
  if (userAgent.startsWith('pnpm')) return 'pnpm'
  if (userAgent.startsWith('bun')) return 'bun'
  return 'npm'
}

/**
 * Returns the install and dev commands for the detected package manager.
 */
function getPackageManagerCommands(pm: string): { install: string; dev: string } {
  switch (pm) {
    case 'yarn':
      return { install: 'yarn', dev: 'yarn dev' }
    case 'pnpm':
      return { install: 'pnpm install', dev: 'pnpm dev' }
    case 'bun':
      return { install: 'bun install', dev: 'bun dev' }
    default:
      return { install: 'npm install', dev: 'npm run dev' }
  }
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function printBanner(): void {
  console.log()
  console.log(bold(cyan('  create-utopia')) + dim(' v0.0.4'))
  console.log()
}

function printSuccessBox(projectName: string, root: string): void {
  const pm = detectPackageManager()
  const cmds = getPackageManagerCommands(pm)

  const cwd = process.cwd()
  const cdPath = path.relative(cwd, root)

  const lines = [
    '',
    green('  UtopiaJS Project Ready!'),
    '',
  ]

  const boxWidth = 35
  const top    = `  \u256D${'─'.repeat(boxWidth)}\u256E`
  const bottom = `  \u2570${'─'.repeat(boxWidth)}\u256F`

  console.log()
  console.log(top)
  for (const line of lines) {
    const padding = ' '.repeat(Math.max(0, boxWidth - stripAnsi(line).length))
    console.log(`  \u2502${line}${padding}\u2502`)
  }
  console.log(bottom)
  console.log()
  console.log('  Next steps:')
  if (cdPath !== '.') {
    console.log(cyan(`    cd ${cdPath}`))
  }
  console.log(cyan(`    ${cmds.install}`))
  console.log(cyan(`    ${cmds.dev}`))
  console.log()
  console.log(`  Happy coding! \u{1F680}`)
  console.log()
}

/**
 * Strips ANSI escape codes for length measurement.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001B\[[0-9;]*m/g, '')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  printBanner()

  // Allow the project name to be passed as the first positional argument.
  const argProjectName = process.argv[2]?.trim()
  const defaultProjectName = argProjectName ?? 'utopia-app'

  let response: prompts.Answers<
    'projectName' | 'overwrite' | 'language' | 'features' | 'cssPreprocessor' | 'initGit'
  >

  try {
    response = await prompts(
      [
        {
          type: argProjectName ? null : 'text',
          name: 'projectName',
          message: 'Project name:',
          initial: defaultProjectName,
          validate: (value: string) => {
            const name = toValidPackageName(value)
            if (!isValidPackageName(name)) {
              return 'Invalid package name. Use lowercase letters, numbers, and hyphens.'
            }
            return true
          },
        },
        {
          type: (_prev: unknown, values: Record<string, unknown>) => {
            const name = (values['projectName'] as string | undefined) ?? defaultProjectName
            const targetDir = path.resolve(process.cwd(), name)
            if (!isEmptyDir(targetDir)) return 'confirm'
            return null
          },
          name: 'overwrite',
          message: (_prev: unknown, values: Record<string, unknown>) => {
            const name = (values['projectName'] as string | undefined) ?? defaultProjectName
            return `Target directory "${name}" is not empty. Remove existing files and continue?`
          },
        },
        {
          type: 'select',
          name: 'language',
          message: 'Language:',
          choices: [
            { title: 'TypeScript', value: 'typescript' },
            { title: 'JavaScript', value: 'javascript' },
          ],
          initial: 0,
        },
        {
          type: 'multiselect',
          name: 'features',
          message: 'Features:',
          choices: [
            { title: 'Router (file-based routing)', value: 'router', selected: true },
            { title: 'SSR (server-side rendering)', value: 'ssr', selected: false },
            { title: 'Email (template-based emails)', value: 'email', selected: false },
            { title: 'AI (chat, streaming, adapters)', value: 'ai', selected: false },
            { title: 'CSS Preprocessor', value: 'css-preprocessor', selected: false },
          ],
          instructions: dim('  (use space to toggle, enter to confirm)'),
        },
        {
          type: (_prev: unknown, values: Record<string, unknown>) => {
            const features = values['features'] as string[] | undefined
            return features?.includes('css-preprocessor') ? 'select' : null
          },
          name: 'cssPreprocessor',
          message: 'CSS Preprocessor:',
          choices: [
            { title: 'Sass', value: 'sass' },
            { title: 'Less', value: 'less' },
          ],
          initial: 0,
        },
        {
          type: 'confirm',
          name: 'initGit',
          message: 'Initialize a git repository?',
          initial: true,
        },
      ],
      {
        onCancel: () => {
          console.log()
          console.log(red('  Operation cancelled.'))
          console.log()
          process.exit(1)
        },
      },
    )
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  // Resolve final options
  const projectName: string =
    toValidPackageName((response.projectName as string | undefined) ?? defaultProjectName)

  const overwrite: boolean = (response.overwrite as boolean | undefined) ?? true
  const language = (response.language as 'typescript' | 'javascript') ?? 'typescript'
  const features = (response.features as string[]) ?? ['router']
  const cssPreprocessor: CSSPreprocessor =
    (response.cssPreprocessor as CSSPreprocessor | undefined) ?? 'none'
  const shouldInitGit = (response.initGit as boolean | undefined) ?? true

  const useRouter = features.includes('router')
  const useSSR = features.includes('ssr')
  const useEmail = features.includes('email')
  const useAI = features.includes('ai')

  const root = path.resolve(process.cwd(), projectName)

  // Handle non-empty directory
  if (fs.existsSync(root) && !isEmptyDir(root)) {
    if (!overwrite) {
      console.log(red('  Aborting.'))
      process.exit(1)
    }
    console.log(yellow(`  Removing existing files in ${projectName}...`))
    removeDir(root)
  }

  console.log()
  console.log(`  Scaffolding project in ${cyan(root)}...`)
  console.log()

  const options: ProjectOptions = {
    projectName,
    language,
    useRouter,
    useSSR,
    useEmail,
    useAI,
    cssPreprocessor,
    initGit: shouldInitGit,
  }

  // Scaffold the project
  scaffoldProject(root, options)

  // Print what was created
  const createdFiles = listFiles(root, root)
  for (const file of createdFiles) {
    console.log(`  ${dim('+')} ${file}`)
  }
  console.log()

  // Initialize git
  if (shouldInitGit) {
    const gitSuccess = initGitRepo(root)
    if (gitSuccess) {
      console.log(green('  Initialized git repository.'))
    } else {
      console.log(yellow('  Could not initialize git repository.'))
    }
  }

  // Success!
  printSuccessBox(projectName, root)
}

/**
 * Lists all files in a directory recursively, returning paths relative to
 * the base directory.
 */
function listFiles(dir: string, base: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(base, fullPath)

    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, base))
    } else {
      results.push(relativePath)
    }
  }

  return results
}

// Run
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
