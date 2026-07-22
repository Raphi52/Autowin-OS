#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(ROOT, 'docs', 'compute-fabric', 'context-sources.json')
const DEFAULT_OUTPUT = 'artifacts/compute-fabric-context.md'
const MAX_TEST_OUTPUT_CHARS = 24_000
const TEST_TIMEOUT_MS = 180_000
const SCHEMA = 'autowin.compute-fabric-context-sources/v1'

function fail(message) {
  throw new Error(`Compute Fabric context: ${message}`)
}

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT, check: false, skipTests: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      options.check = true
    } else if (argument === '--skip-tests') {
      options.skipTests = true
    } else if (argument === '--output') {
      const value = argv[index + 1]
      if (!value) fail('--output exige un chemin relatif au dépôt')
      options.output = value
      index += 1
    } else {
      fail(`argument inconnu: ${argument}`)
    }
  }
  return options
}

function repoPath(pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) fail(`${label} invalide`)
  if (isAbsolute(pathValue)) fail(`${label} doit être relatif au dépôt: ${pathValue}`)
  const normalizedInput = pathValue.replaceAll('\\', '/')
  const absolute = resolve(ROOT, normalizedInput)
  const rel = relative(ROOT, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${label} sort du dépôt: ${pathValue}`)
  }
  return { relative: rel.replaceAll('\\', '/'), absolute }
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) fail(`champ inconnu dans ${label}: ${unknown}`)
}

function parseStringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} doit être une liste non vide`)
  const items = value.map((entry, index) => repoPath(entry, `${label}[${index}]`).relative)
  if (new Set(items).size !== items.length) fail(`${label} contient un doublon`)
  return items
}

function parseManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('manifeste invalide')
  exactKeys(value, ['schema', 'documents', 'sources', 'tests'], 'le manifeste')
  if (value.schema !== SCHEMA) fail(`schéma inconnu: ${String(value.schema)}`)

  const documents = parseStringList(value.documents, 'documents')
  const tests = parseStringList(value.tests, 'tests')
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    fail('sources doit être une liste non vide')
  }

  const sources = value.sources.map((entry, sourceIndex) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`sources[${sourceIndex}] invalide`)
    }
    exactKeys(entry, ['path', 'why', 'mode', 'ranges'], `sources[${sourceIndex}]`)
    const path = repoPath(entry.path, `sources[${sourceIndex}].path`).relative
    if (typeof entry.why !== 'string' || !entry.why.trim() || entry.why.length > 240) {
      fail(`sources[${sourceIndex}].why invalide`)
    }
    const hasFullMode = entry.mode === 'full'
    const hasRanges = Array.isArray(entry.ranges) && entry.ranges.length > 0
    if (hasFullMode === hasRanges) {
      fail(`sources[${sourceIndex}] exige soit mode=full, soit ranges`)
    }
    if (entry.mode !== undefined && entry.mode !== 'full') {
      fail(`sources[${sourceIndex}].mode inconnu`)
    }
    const ranges = hasRanges
      ? entry.ranges.map((range, rangeIndex) => {
          if (!range || typeof range !== 'object' || Array.isArray(range)) {
            fail(`sources[${sourceIndex}].ranges[${rangeIndex}] invalide`)
          }
          exactKeys(range, ['start', 'end'], `sources[${sourceIndex}].ranges[${rangeIndex}]`)
          if (
            !Number.isSafeInteger(range.start) ||
            !Number.isSafeInteger(range.end) ||
            range.start < 1 ||
            range.end < range.start
          ) {
            fail(`sources[${sourceIndex}].ranges[${rangeIndex}] invalide`)
          }
          return { start: range.start, end: range.end }
        })
      : undefined
    return {
      path,
      why: entry.why.trim(),
      ...(hasFullMode ? { mode: 'full' } : { ranges })
    }
  })

  const sourcePaths = sources.map((entry) => entry.path)
  if (new Set(sourcePaths).size !== sourcePaths.length) fail('sources contient un chemin dupliqué')

  return { schema: SCHEMA, documents, sources, tests }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function classifyGitState(statusCode, headBlob) {
  if (!statusCode) return headBlob ? 'HEAD' : 'untracked'
  if (statusCode === '??') return 'untracked'
  if (statusCode === '!!') return 'ignored'
  return `changed:${statusCode.replaceAll(' ', '.')}`
}

export function computeSourceFingerprint({ schema, commit, branch, files }) {
  const canonicalFiles = files
    .map(({ path, bytes, digest, gitState, headBlob }) => ({
      path,
      bytes,
      digest,
      gitState,
      headBlob: headBlob || null
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return sha256(JSON.stringify({ schema, commit, branch, files: canonicalFiles }))
}

export function findCompletenessGaps({ discovered, sourcePaths, testPaths }) {
  const sourceSet = new Set(sourcePaths)
  const testSet = new Set(testPaths)
  return {
    missingSources: discovered.filter((path) => !sourceSet.has(path)),
    missingTests: discovered.filter((path) => path.includes('.test.') && !testSet.has(path)),
    invisibleTests: testPaths.filter((path) => !sourceSet.has(path))
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  })
}

function git(args) {
  const result = run('git', args)
  if (result.error || result.status !== 0) {
    fail(
      `git ${args.join(' ')}: ${result.error?.message || result.stderr || `exit ${result.status}`}`
    )
  }
  return result.stdout.trim()
}

function gitPathProvenance(path) {
  const statusResult = run('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', path])
  if (statusResult.error || statusResult.status !== 0) {
    fail(`git status ${path}: ${statusResult.error?.message || statusResult.stderr}`)
  }
  const statusCode = statusResult.stdout.slice(0, 2)
  const blobResult = run('git', ['rev-parse', '--verify', `HEAD:${path}`])
  const headBlob = blobResult.status === 0 ? blobResult.stdout.trim() : null
  return { gitState: classifyGitState(statusCode, headBlob), headBlob }
}

function stripAnsi(value) {
  const escapeCharacter = String.fromCharCode(27)
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function boundedTail(value, maxChars) {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return {
    text: `[sortie tronquée aux ${maxChars} derniers caractères]\n${value.slice(-maxChars)}`,
    truncated: true
  }
}

async function requireFile(relativePath, label) {
  const resolved = repoPath(relativePath, label)
  const metadata = await stat(resolved.absolute).catch(() => null)
  if (!metadata?.isFile()) fail(`${label} absent ou non-fichier: ${relativePath}`)
  const raw = await readFile(resolved.absolute)
  return {
    path: resolved.relative,
    absolute: resolved.absolute,
    content: raw.toString('utf8'),
    bytes: raw.length,
    digest: sha256(raw)
  }
}

async function walkRepoFiles(relativeDirectory) {
  const root = repoPath(relativeDirectory, 'répertoire Fabric')
  const files = []

  async function walk(absoluteDirectory) {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = join(absoluteDirectory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) files.push(relative(ROOT, absolute).replaceAll('\\', '/'))
    }
  }

  await walk(root.absolute)
  return files.sort()
}

async function validateCompleteness(manifest) {
  const mainFabricFiles = (await walkRepoFiles('src/main/compute-fabric')).filter((path) =>
    /\.tsx?$/.test(path)
  )
  const discovered = [
    ...mainFabricFiles,
    'src/shared/compute-fabric.ts',
    'src/shared/compute-fabric.test.ts'
  ].sort()
  const gaps = findCompletenessGaps({
    discovered,
    sourcePaths: manifest.sources.map((entry) => entry.path),
    testPaths: manifest.tests
  })
  const details = [
    gaps.missingSources.length ? `sources absentes: ${gaps.missingSources.join(', ')}` : '',
    gaps.missingTests.length ? `tests non exécutés: ${gaps.missingTests.join(', ')}` : '',
    gaps.invisibleTests.length ? `tests non visibles: ${gaps.invisibleTests.join(', ')}` : ''
  ].filter(Boolean)
  if (details.length) fail(`sélection incomplète — ${details.join(' ; ')}`)
  return discovered
}

function sourceLanguage(path) {
  const extension = extname(path).slice(1).toLowerCase()
  return (
    {
      ts: 'ts',
      tsx: 'tsx',
      js: 'js',
      mjs: 'js',
      json: 'json',
      md: 'md'
    }[extension] || 'text'
  )
}

function numberedExcerpt(source, definition) {
  const lines = source.content.split(/\r?\n/)
  const ranges = definition.mode === 'full' ? [{ start: 1, end: lines.length }] : definition.ranges
  const chunks = []
  for (const range of ranges) {
    if (range.end > lines.length) {
      fail(`${source.path}: plage ${range.start}-${range.end} dépasse ${lines.length} lignes`)
    }
    if (chunks.length) chunks.push('…')
    for (let line = range.start; line <= range.end; line += 1) {
      chunks.push(`${line}|${lines[line - 1]}`)
    }
  }
  return { text: chunks.join('\n'), ranges }
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function yamlString(value) {
  return JSON.stringify(String(value))
}

function frontmatterString(content, key) {
  return content.match(new RegExp(`^${key}:\\s*"([^"]+)"$`, 'm'))?.[1] || null
}

function runFabricTests(testPaths, skipTests) {
  if (skipTests) {
    return {
      command: 'skipped by --skip-tests',
      exitCode: null,
      signal: null,
      output: 'Tests non exécutés.',
      truncated: false,
      status: 'NOT_RUN'
    }
  }

  const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const commandArgs = [vitest, 'run', ...testPaths]
  const result = run(process.execPath, commandArgs, { timeout: TEST_TIMEOUT_MS })
  const raw = stripAnsi(`${result.stdout || ''}${result.stderr || ''}`).trim()
  const clipped = boundedTail(raw || '(aucune sortie)', MAX_TEST_OUTPUT_CHARS)
  const exitCode = typeof result.status === 'number' ? result.status : null
  return {
    command: `node node_modules/vitest/vitest.mjs run ${testPaths.join(' ')}`,
    exitCode,
    signal: result.signal || null,
    output: clipped.text,
    truncated: clipped.truncated,
    status: exitCode === 0 ? 'VERIFIED_GREEN' : 'VERIFIED_RED'
  }
}

async function buildBundle(manifest, options) {
  await validateCompleteness(manifest)
  const documents = []
  for (const documentPath of manifest.documents) {
    documents.push(await requireFile(documentPath, 'document'))
  }

  const sources = []
  for (const definition of manifest.sources) {
    const source = await requireFile(definition.path, 'source')
    sources.push({ definition, source, excerpt: numberedExcerpt(source, definition) })
  }

  for (const testPath of manifest.tests) await requireFile(testPath, 'test')

  const manifestSource = await requireFile(
    'docs/compute-fabric/context-sources.json',
    'manifest de contexte'
  )
  const generatorSource = await requireFile(
    'scripts/export-compute-fabric-context.mjs',
    'générateur de contexte'
  )
  const packageSource = await requireFile('package.json', 'package npm')
  const inventory = [
    {
      file: manifestSource,
      inclusion: 'provenance',
      role: 'allowlist de contexte'
    },
    {
      file: generatorSource,
      inclusion: 'provenance',
      role: 'générateur du bundle'
    },
    { file: packageSource, inclusion: 'provenance', role: 'commande npm' },
    ...documents.map((file) => ({
      file,
      inclusion: 'complet',
      role: 'document stable'
    })),
    ...sources.map(({ definition, source, excerpt }) => ({
      file: source,
      inclusion:
        definition.mode === 'full'
          ? 'complet numéroté'
          : excerpt.ranges.map((range) => `${range.start}-${range.end}`).join(', '),
      role: definition.why
    }))
  ].map((entry) => ({ ...entry, ...gitPathProvenance(entry.file.path) }))
  const targetPaths = [
    ...new Set([...inventory.map((entry) => entry.file.path), ...manifest.tests])
  ]
  const commit = git(['rev-parse', 'HEAD'])
  const branch = git(['branch', '--show-current']) || '(detached)'
  const targetedStatus =
    git(['status', '--short', '--', ...targetPaths]) || '(clean for targeted paths)'
  const workspaceStatus = inventory.every((entry) => entry.gitState === 'HEAD')
    ? 'CLEAN'
    : 'DRAFT_DIRTY'
  const sourceFingerprint = computeSourceFingerprint({
    schema: manifest.schema,
    commit,
    branch,
    files: inventory.map(({ file, gitState, headBlob }) => ({
      path: file.path,
      bytes: file.bytes,
      digest: file.digest,
      gitState,
      headBlob
    }))
  })
  const tests = runFabricTests(manifest.tests, options.skipTests)
  const generatedAt = new Date().toISOString()

  const lines = [
    '---',
    `schema: ${yamlString('autowin.compute-fabric-context-bundle/v1')}`,
    `generatedAt: ${yamlString(generatedAt)}`,
    `gitCommit: ${yamlString(commit)}`,
    `gitBranch: ${yamlString(branch)}`,
    `workspaceStatus: ${yamlString(workspaceStatus)}`,
    `sourceFingerprint: ${yamlString(sourceFingerprint)}`,
    `manifestSha256: ${yamlString(manifestSource.digest)}`,
    `generatorSha256: ${yamlString(generatorSource.digest)}`,
    `packageSha256: ${yamlString(packageSource.digest)}`,
    `testStatus: ${yamlString(tests.status)}`,
    `testExitCode: ${tests.exitCode === null ? 'null' : tests.exitCode}`,
    `testOutputTruncated: ${tests.truncated ? 'true' : 'false'}`,
    '---',
    '',
    '# Autowin Compute Fabric — bundle de contexte généré',
    '',
    '> Artefact généré, non éditable. Les sources et tests frais font autorité. Ce fichier ne prouve jamais à lui seul qu’une capacité cible est implémentée.',
    '',
    '## État de génération',
    '',
    `- Généré : \`${generatedAt}\``,
    `- Branche : \`${branch}\``,
    `- Commit : \`${commit}\``,
    `- État de publication : **${workspaceStatus}**`,
    `- Fingerprint canonique des sources : \`${sourceFingerprint}\``,
    `- Tests ciblés : **${tests.status}** (exit \`${tests.exitCode ?? 'non exécuté'}\`)`,
    `- Manifeste de sources : \`${manifestSource.digest}\``,
    `- Générateur : \`${generatorSource.digest}\``,
    `- Package npm : \`${packageSource.digest}\``,
    '',
    ...(workspaceStatus === 'DRAFT_DIRTY'
      ? [
          '> **DRAFT_DIRTY** — ce bundle décrit un worktree non commité. Les hashes restent vérifiables, mais il ne doit pas être présenté comme une publication reproductible depuis HEAD.',
          ''
        ]
      : []),
    '### État Git des fichiers ciblés',
    '',
    '```text',
    targetedStatus,
    '```',
    '',
    '### Replay Compute Fabric',
    '',
    `Commande : \`${tests.command}\``,
    '',
    '```text',
    tests.output,
    '```',
    '',
    '## Inventaire cryptographique',
    '',
    '| Fichier complet | Octets | SHA-256 | État Git | Blob HEAD | Inclusion | Rôle |',
    '|---|---:|---|---|---|---|---|'
  ]

  for (const { file, gitState, headBlob, inclusion, role } of inventory) {
    lines.push(
      `| \`${escapeTable(file.path)}\` | ${file.bytes} | \`${file.digest}\` | ${escapeTable(gitState)} | ${headBlob ? `\`${headBlob}\`` : '—'} | ${escapeTable(inclusion)} | ${escapeTable(role)} |`
    )
  }

  lines.push('', '## Documents stables')
  for (const document of documents) {
    lines.push(
      '',
      `<!-- BEGIN DOCUMENT ${document.path} sha256=${document.digest} -->`,
      '',
      `## Document : \`${document.path}\``,
      '',
      document.content.trimEnd(),
      '',
      `<!-- END DOCUMENT ${document.path} -->`
    )
  }

  lines.push('', '## Extraits de sources faisant autorité')
  for (const { definition, source, excerpt } of sources) {
    lines.push(
      '',
      `<!-- BEGIN SOURCE ${source.path} sha256=${source.digest} -->`,
      '',
      `### \`${source.path}\``,
      '',
      `Rôle : ${definition.why}. Hash du fichier complet : \`${source.digest}\`.`,
      '',
      `\`\`\`\`${sourceLanguage(source.path)}`,
      excerpt.text,
      '````',
      '',
      `<!-- END SOURCE ${source.path} -->`
    )
  }

  lines.push(
    '',
    '## Consigne de fraîcheur',
    '',
    'Avant toute décision ou implémentation ultérieure, comparer le commit, les hashes et le replay ci-dessus à l’état réel du dépôt. Si un hash diffère, régénérer ce bundle ; ne pas restaurer ou configurer une ressource live depuis cette preuve datée.',
    ''
  )

  return {
    content: lines.join('\n'),
    sourceFingerprint,
    workspaceStatus,
    tests
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestText = await readFile(MANIFEST_PATH, 'utf8').catch(() => {
    fail(`manifeste absent: ${MANIFEST_PATH}`)
  })
  let rawManifest
  try {
    rawManifest = JSON.parse(manifestText)
  } catch (error) {
    fail(`JSON du manifeste invalide: ${error.message}`)
  }
  const manifest = parseManifest(rawManifest)
  const output = repoPath(options.output, 'output')

  if (options.check) {
    const snapshot = await buildBundle(manifest, { ...options, skipTests: true })
    const existing = await readFile(output.absolute, 'utf8').catch(() => null)
    if (!existing) fail(`artefact absent: ${output.relative}`)
    const recordedFingerprint = frontmatterString(existing, 'sourceFingerprint')
    if (recordedFingerprint !== snapshot.sourceFingerprint) {
      fail(
        `artefact obsolète: fingerprint ${recordedFingerprint || 'absent'} != ${snapshot.sourceFingerprint}`
      )
    }
    console.log(
      JSON.stringify(
        {
          status: 'ok',
          schema: manifest.schema,
          documents: manifest.documents.length,
          sources: manifest.sources.length,
          tests: manifest.tests.length,
          artifact: output.relative,
          workspaceStatus: snapshot.workspaceStatus,
          sourceFingerprint: snapshot.sourceFingerprint
        },
        null,
        2
      )
    )
    return
  }

  const bundle = await buildBundle(manifest, options)
  await mkdir(dirname(output.absolute), { recursive: true })
  await writeFile(output.absolute, bundle.content, 'utf8')
  console.log(
    JSON.stringify(
      {
        status: 'written',
        output: output.relative,
        bytes: Buffer.byteLength(bundle.content),
        sha256: sha256(bundle.content),
        testStatus: bundle.tests.status,
        workspaceStatus: bundle.workspaceStatus,
        sourceFingerprint: bundle.sourceFingerprint
      },
      null,
      2
    )
  )
}

const invokedAsScript =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
