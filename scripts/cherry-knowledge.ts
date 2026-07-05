import fs from 'node:fs'
import path from 'node:path'

type JsonObject = Record<string, unknown>

interface CliOptions {
  api: string
  apiKey?: string
  apiKeyFile?: string
  base?: string
  baseName?: string
  config?: string
  path?: string
  paths: string[]
  item?: string
  directoryItem?: string
  file?: string
  job?: string
  mode?: string
  fallback?: string
  wait?: boolean
  refreshExisting?: boolean
  refreshIfExists?: boolean
}

interface DirectoryItem {
  id: string
  content: string
}

interface SyncDirectoryResult {
  path: string
  action: 'added' | 'refreshed' | 'skipped' | 'failed'
  item_id?: string
  job_id?: string
  fallback_job_id?: string
  status?: string
  mode?: string
  reason?: string
  error?: string
}

type DirectorySyncConfig = Record<string, string[]>

const DEFAULT_API_BASE = 'http://127.0.0.1:23333'
const MISSING_DIRECTORY_INDEX_ERROR = 'Directory incremental refresh requires a file index'
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function parseArgs(argv: string[]): { command?: string; options: CliOptions } {
  const [command, ...rest] = argv
  const options: CliOptions = {
    api: process.env.CHERRY_KB_API_BASE || process.env.CHERRY_API_BASE || DEFAULT_API_BASE,
    apiKeyFile: process.env.CHERRY_API_KEY || process.env.CHERRY_API_KEY_FILE,
    paths: []
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const readValue = (): string => {
      const value = rest[i + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`)
      }
      i += 1
      return value
    }

    switch (arg) {
      case '--api':
        options.api = readValue()
        break
      case '--api-key':
        options.apiKey = readValue()
        break
      case '--api-key-file':
        options.apiKeyFile = readValue()
        break
      case '--base':
        options.base = readValue()
        break
      case '--base-name':
        options.baseName = readValue()
        break
      case '--config':
        options.config = readValue()
        break
      case '--path':
        options.path = readValue()
        options.paths.push(options.path)
        break
      case '--item':
        options.item = readValue()
        break
      case '--directory-item':
        options.directoryItem = readValue()
        break
      case '--file':
        options.file = readValue()
        break
      case '--job':
        options.job = readValue()
        break
      case '--mode':
        options.mode = readValue()
        break
      case '--fallback':
        options.fallback = readValue()
        break
      case '--wait':
        options.wait = true
        break
      case '--refresh-existing':
        options.refreshExisting = true
        break
      case '--refresh-if-exists':
        options.refreshIfExists = true
        break
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`)
        }

        if (command === 'sync-directories') {
          options.path ??= arg
          options.paths.push(arg)
          break
        }

        throw new Error(`Unexpected positional argument: ${arg}`)
    }
  }

  if (!options.apiKey && options.apiKeyFile) {
    options.apiKey = readApiKeyFromFile(options.apiKeyFile)
  }

  return { command, options }
}

function usage(): string {
  return [
    'Usage:',
    '  pnpm tsx scripts/cherry-knowledge.ts list [--api http://127.0.0.1:23333] [--api-key-file key.txt]',
    '  pnpm tsx scripts/cherry-knowledge.ts sync-directories --base-name <name> <dir> [dir...] [--refresh-existing] [--mode incremental|full] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts sync-directories --config kb-dirs.yaml [--base-name <name>] [--refresh-existing] [--mode incremental|full] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts add-directory --base <baseId> --path <dir> [--refresh-if-exists] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts refresh-directory --base <baseId> --item <itemId> [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts refresh-file --base <baseId> --directory-item <itemId> --file <file> [--fallback error|full-directory] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts job --job <jobId>',
    '',
    'Environment:',
    '  CHERRY_API_KEY      Path to a file containing the API Server bearer token',
    '  CHERRY_API_KEY_FILE Path to a file containing the API Server bearer token',
    '  CHERRY_API_BASE     API Server base URL',
    '  CHERRY_KB_API_BASE  API Server base URL, preferred for this script'
  ].join('\n')
}

function readApiKeyFromFile(apiKeyFile: string): string {
  const resolvedPath = path.resolve(apiKeyFile)
  let raw: string

  try {
    raw = fs.readFileSync(resolvedPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read API key file: ${resolvedPath}. ${(error as Error).message}`)
  }

  const content = raw.replace(/^\uFEFF/, '').trim()
  if (!content) {
    throw new Error(`API key file is empty: ${resolvedPath}`)
  }

  const tokenMatch = content.match(/cs-sk-[0-9a-fA-F-]{36}/)
  if (tokenMatch) {
    return tokenMatch[0]
  }

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    throw new Error(`API key file is empty: ${resolvedPath}`)
  }

  return firstLine
    .replace(/^CHERRY_API_KEY\s*=\s*/, '')
    .replace(/^Authorization:\s*Bearer\s+/i, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

function readDirectorySyncConfig(configFile: string): DirectorySyncConfig {
  const resolvedPath = path.resolve(configFile)
  let raw: string

  try {
    raw = fs.readFileSync(resolvedPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read sync config file: ${resolvedPath}. ${(error as Error).message}`)
  }

  const content = raw.replace(/^\uFEFF/, '').trim()
  if (!content) {
    throw new Error(`Sync config file is empty: ${resolvedPath}`)
  }

  if (path.extname(resolvedPath).toLowerCase() === '.json' || content.startsWith('{')) {
    return validateDirectorySyncConfig(JSON.parse(content), resolvedPath)
  }

  return validateDirectorySyncConfig(parseSimpleDirectorySyncYaml(content, resolvedPath), resolvedPath)
}

function parseSimpleDirectorySyncYaml(content: string, configFile: string): DirectorySyncConfig {
  const config: DirectorySyncConfig = {}
  let currentBaseName = ''

  for (const [index, originalLine] of content.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const trimmed = originalLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const inlineMatch = originalLine.match(/^([^:\s][^:]*):\s*\[(.*)]\s*$/)
    if (inlineMatch) {
      const baseName = unquoteConfigScalar(inlineMatch[1].trim())
      config[baseName] = splitInlineConfigList(inlineMatch[2]).map(unquoteConfigScalar)
      currentBaseName = baseName
      continue
    }

    const baseMatch = originalLine.match(/^([^:\s][^:]*):\s*$/)
    if (baseMatch) {
      currentBaseName = unquoteConfigScalar(baseMatch[1].trim())
      config[currentBaseName] ??= []
      continue
    }

    const listMatch = originalLine.match(/^\s*-\s+(.+)$/)
    if (listMatch && currentBaseName) {
      config[currentBaseName].push(unquoteConfigScalar(listMatch[1].trim()))
      continue
    }

    throw new Error(`Unsupported sync config syntax at ${configFile}:${lineNumber}: ${originalLine}`)
  }

  return config
}

function splitInlineConfigList(value: string): string[] {
  const items: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''

  for (const char of value) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char
      current += char
      continue
    }

    if (char === quote) {
      quote = ''
      current += char
      continue
    }

    if (char === ',' && !quote) {
      if (current.trim()) {
        items.push(current.trim())
      }
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    items.push(current.trim())
  }

  return items
}

function unquoteConfigScalar(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function validateDirectorySyncConfig(value: unknown, configFile: string): DirectorySyncConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Sync config must be an object/map: ${configFile}`)
  }

  const config: DirectorySyncConfig = {}
  for (const [baseName, paths] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(paths)) {
      throw new Error(`Sync config entry must be a list of folders: ${baseName}`)
    }

    const normalizedPaths = paths
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
    if (normalizedPaths.length === 0) {
      throw new Error(`Sync config entry has no folders: ${baseName}`)
    }

    config[baseName] = normalizedPaths
  }

  if (Object.keys(config).length === 0) {
    throw new Error(`Sync config has no knowledge base entries: ${configFile}`)
  }

  return config
}

function requireOption(options: CliOptions, key: keyof CliOptions): string {
  const value = options[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required option --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`)
  }

  return value
}

function requirePaths(options: CliOptions): string[] {
  if (options.paths.length === 0) {
    throw new Error('Missing folders. Pass folders at the end of the command, repeat --path, or use --config.')
  }

  return options.paths
}

function getApiRoot(api: string): string {
  const trimmed = api.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

async function request(options: CliOptions, method: string, path: string, body?: JsonObject): Promise<JsonObject> {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  }

  if (body) {
    headers['Content-Type'] = 'application/json'
  }

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`
  }

  const response = await fetch(`${getApiRoot(options.api)}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as JsonObject) : {}

  if (!response.ok) {
    const message =
      typeof payload.error === 'object' && payload.error && 'message' in payload.error
        ? String((payload.error as JsonObject).message)
        : response.statusText
    throw new Error(`HTTP ${response.status}: ${message}`)
  }

  return payload
}

async function waitForJob(options: CliOptions, jobId: string): Promise<JsonObject> {
  let lastProgressLine = ''

  while (true) {
    const job = await request(options, 'GET', `/knowledge-bases/jobs/${encodeURIComponent(jobId)}`)
    const progressLine = formatJobProgress(job)
    if (progressLine && progressLine !== lastProgressLine) {
      console.error(progressLine)
      lastProgressLine = progressLine
    }

    if (TERMINAL_JOB_STATUSES.has(String(job.status))) {
      return job
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

function formatJobProgress(job: JsonObject): string {
  const id = typeof job.id === 'string' ? job.id : '<unknown>'
  const status = typeof job.status === 'string' ? job.status : 'unknown'
  const progress = typeof job.progress === 'number' ? `${job.progress}%` : ''
  const processedFiles = typeof job.processed_files === 'number' ? job.processed_files : undefined
  const totalFiles = typeof job.total_files === 'number' ? job.total_files : undefined
  const currentFile = typeof job.current_file === 'string' ? job.current_file : ''

  if (typeof processedFiles === 'number' && typeof totalFiles === 'number') {
    const fileProgress = `${processedFiles}/${totalFiles}`
    return currentFile
      ? `  job ${id} ${status} ${fileProgress} ${progress} :: ${currentFile}`
      : `  job ${id} ${status} ${fileProgress} ${progress}`
  }

  return progress ? `  job ${id} ${status} ${progress}` : `  job ${id} ${status}`
}

async function printJobOrWait(options: CliOptions, job: JsonObject): Promise<void> {
  if (options.wait && typeof job.id === 'string') {
    console.log(JSON.stringify(await waitForJob(options, job.id), null, 2))
    return
  }

  console.log(JSON.stringify(job, null, 2))
}

async function listAllKnowledgeBases(options: CliOptions): Promise<JsonObject[]> {
  const bases: JsonObject[] = []
  const limit = 100
  let offset = 0
  let total: number | null = null

  while (total === null || offset < total) {
    const payload = await request(options, 'GET', `/knowledge-bases?limit=${limit}&offset=${offset}`)
    const pageBases = Array.isArray(payload.knowledge_bases) ? (payload.knowledge_bases as JsonObject[]) : []
    bases.push(...pageBases)

    total = typeof payload.total === 'number' ? payload.total : bases.length
    if (pageBases.length === 0) {
      break
    }

    offset += pageBases.length
  }

  return bases
}

function getStringField(value: JsonObject, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function getDirectoryItems(base: JsonObject): DirectoryItem[] {
  const items = Array.isArray(base.items) ? (base.items as JsonObject[]) : []
  return items.flatMap((item) => {
    const id = getStringField(item, 'id')
    const content = getStringField(item, 'content')
    return item.type === 'directory' && id && content ? [{ id, content }] : []
  })
}

function normalizeComparablePath(targetPath: string): string {
  const normalized = path.normalize(path.resolve(targetPath))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function resolveDirectoryPath(directoryPath: string): Promise<string> {
  const resolvedPath = path.resolve(directoryPath)

  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(resolvedPath)
  } catch {
    throw new Error(`Directory does not exist: ${directoryPath}`)
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${directoryPath}`)
  }

  return resolvedPath
}

async function findDirectoryItem(items: DirectoryItem[], directoryPath: string): Promise<DirectoryItem | undefined> {
  const normalizedPath = normalizeComparablePath(directoryPath)
  const directMatch = items.find((item) => normalizeComparablePath(item.content) === normalizedPath)
  if (directMatch) {
    return directMatch
  }

  for (const item of items) {
    if (await areSameDirectoryPath(item.content, directoryPath)) {
      return item
    }
  }

  return undefined
}

async function areSameDirectoryPath(left: string, right: string): Promise<boolean> {
  if (normalizeComparablePath(left) === normalizeComparablePath(right)) {
    return true
  }

  const [leftRealPath, rightRealPath] = await Promise.all([
    resolveRealComparablePath(left),
    resolveRealComparablePath(right)
  ])
  return leftRealPath === rightRealPath
}

async function resolveRealComparablePath(targetPath: string): Promise<string> {
  const resolvedPath = path.resolve(targetPath)
  try {
    const realPath = await fs.promises.realpath(resolvedPath)
    return normalizeComparablePath(realPath)
  } catch {
    return normalizeComparablePath(resolvedPath)
  }
}

async function findKnowledgeBase(options: CliOptions): Promise<JsonObject> {
  const bases = await listAllKnowledgeBases(options)

  if (options.base) {
    const base = bases.find((candidate) => getStringField(candidate, 'id') === options.base)
    if (!base) {
      throw new Error(`Knowledge base not found by id: ${options.base}`)
    }

    return base
  }

  const baseName = requireOption(options, 'baseName')
  const exactMatches = bases.filter((candidate) => getStringField(candidate, 'name') === baseName)
  const matches =
    exactMatches.length > 0
      ? exactMatches
      : bases.filter((candidate) => getStringField(candidate, 'name')?.toLowerCase() === baseName.toLowerCase())

  if (matches.length === 1) {
    return matches[0]
  }

  if (matches.length > 1) {
    const optionsText = matches
      .map((candidate) => `${getStringField(candidate, 'name') || '<unnamed>'} (${getStringField(candidate, 'id')})`)
      .join(', ')
    throw new Error(`Multiple knowledge bases matched "${baseName}". Use --base <id>. Matches: ${optionsText}`)
  }

  const available = bases
    .map((candidate) => getStringField(candidate, 'name'))
    .filter(Boolean)
    .join(', ')
  throw new Error(`Knowledge base not found by name: ${baseName}${available ? `. Available: ${available}` : ''}`)
}

function getJobId(job: JsonObject): string | undefined {
  return getStringField(job, 'id')
}

function getJobItemId(job: JsonObject): string | undefined {
  return getStringField(job, 'directory_item_id') || getStringField(job, 'item_id')
}

function isMissingDirectoryIndexFailure(job: JsonObject): boolean {
  return String(job.status) === 'failed' && String(job.error || '').includes(MISSING_DIRECTORY_INDEX_ERROR)
}

async function waitForJobIfNeeded(options: CliOptions, job: JsonObject): Promise<JsonObject> {
  const jobId = getJobId(job)
  return options.wait && jobId ? await waitForJob(options, jobId) : job
}

async function syncDirectories(options: CliOptions): Promise<JsonObject> {
  if (options.config) {
    return syncDirectoriesFromConfig(options)
  }

  return syncDirectoryGroup(options)
}

async function syncDirectoriesFromConfig(options: CliOptions): Promise<JsonObject> {
  if (options.base) {
    throw new Error('Use --base-name, not --base, when syncing from --config')
  }

  if (options.paths.length > 0) {
    throw new Error('Do not combine --config with positional folders or --path. Put the folders in the config file.')
  }

  const config = readDirectorySyncConfig(options.config!)
  const entries = Object.entries(config).filter(
    ([baseName]) => !options.baseName || baseName.toLowerCase() === options.baseName.toLowerCase()
  )

  if (entries.length === 0) {
    throw new Error(`Knowledge base "${options.baseName}" was not found in sync config: ${options.config}`)
  }

  const knowledgeBases: JsonObject[] = []
  for (const [baseName, paths] of entries) {
    console.error(`Knowledge base from config: ${baseName}`)
    const result = await syncDirectoryGroup({
      ...options,
      base: undefined,
      baseName,
      config: undefined,
      path: paths[0],
      paths
    })
    knowledgeBases.push(result)
  }

  if (
    knowledgeBases.some((base) =>
      Array.isArray(base.results)
        ? (base.results as SyncDirectoryResult[]).some(
            (result) => result.action === 'failed' || result.status === 'failed'
          )
        : false
    )
  ) {
    process.exitCode = 1
  }

  return {
    config: path.resolve(options.config!),
    knowledge_bases: knowledgeBases
  }
}

async function syncDirectoryGroup(options: CliOptions): Promise<JsonObject> {
  const requestedPaths = requirePaths(options)
  const base = await findKnowledgeBase(options)
  const baseId = requireOption({ ...options, base: getStringField(base, 'id') }, 'base')
  const directoryItems = getDirectoryItems(base)
  const results: SyncDirectoryResult[] = []

  for (const [index, requestedPath] of requestedPaths.entries()) {
    try {
      const directoryPath = await resolveDirectoryPath(requestedPath)
      const existingItem = await findDirectoryItem(directoryItems, directoryPath)

      if (existingItem) {
        if (!options.refreshExisting) {
          results.push({
            path: directoryPath,
            action: 'skipped',
            item_id: existingItem.id,
            reason: 'directory_already_exists'
          })
          continue
        }

        const mode = options.mode || 'incremental'
        console.error(
          `[${index + 1}/${requestedPaths.length}] Refreshing existing directory (${mode}): ${directoryPath}`
        )
        let job = await request(
          options,
          'POST',
          `/knowledge-bases/${encodeURIComponent(baseId)}/directories/${encodeURIComponent(existingItem.id)}/refresh`,
          { mode }
        )
        let completedJob = await waitForJobIfNeeded(options, job)
        const fallbackFromJobId = getJobId(job)

        if (!options.mode && options.wait && isMissingDirectoryIndexFailure(completedJob)) {
          console.error(`  incremental refresh has no directory index; retrying full refresh: ${directoryPath}`)
          job = await request(
            options,
            'POST',
            `/knowledge-bases/${encodeURIComponent(baseId)}/directories/${encodeURIComponent(existingItem.id)}/refresh`,
            { mode: 'full' }
          )
          completedJob = await waitForJobIfNeeded(options, job)
        }

        results.push({
          path: directoryPath,
          action: 'refreshed',
          item_id: existingItem.id,
          job_id: getJobId(job),
          fallback_job_id: getJobId(job) === fallbackFromJobId ? undefined : fallbackFromJobId,
          status: String(completedJob.status || job.status || ''),
          mode: getJobId(job) === fallbackFromJobId ? mode : 'full'
        })
        continue
      }

      console.error(`[${index + 1}/${requestedPaths.length}] Adding directory: ${directoryPath}`)
      const job = await request(options, 'POST', `/knowledge-bases/${encodeURIComponent(baseId)}/directories`, {
        path: directoryPath,
        mode: options.mode || 'enqueue',
        refresh_if_exists: false
      })
      const completedJob = await waitForJobIfNeeded(options, job)
      const itemId = getJobItemId(job) || getJobItemId(completedJob)
      if (itemId) {
        directoryItems.push({ id: itemId, content: directoryPath })
      }

      results.push({
        path: directoryPath,
        action: 'added',
        item_id: itemId,
        job_id: getJobId(job),
        status: String(completedJob.status || job.status || '')
      })
    } catch (error) {
      results.push({
        path: requestedPath,
        action: 'failed',
        error: (error as Error).message
      })
    }
  }

  if (results.some((result) => result.action === 'failed' || result.status === 'failed')) {
    process.exitCode = 1
  }

  return {
    knowledge_base: {
      id: baseId,
      name: getStringField(base, 'name')
    },
    results
  }
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2))

  switch (command) {
    case 'list':
      console.log(JSON.stringify(await request(options, 'GET', '/knowledge-bases'), null, 2))
      return

    case 'sync-directories':
      console.log(JSON.stringify(await syncDirectories(options), null, 2))
      return

    case 'add-directory': {
      const baseId = requireOption(options, 'base')
      const directoryPath = requireOption(options, 'path')
      const job = await request(options, 'POST', `/knowledge-bases/${encodeURIComponent(baseId)}/directories`, {
        path: directoryPath,
        mode: options.mode || 'enqueue',
        refresh_if_exists: options.refreshIfExists || false
      })
      await printJobOrWait(options, job)
      return
    }

    case 'refresh-directory': {
      const baseId = requireOption(options, 'base')
      const itemId = requireOption(options, 'item')
      const job = await request(
        options,
        'POST',
        `/knowledge-bases/${encodeURIComponent(baseId)}/directories/${encodeURIComponent(itemId)}/refresh`,
        { mode: options.mode || 'full' }
      )
      await printJobOrWait(options, job)
      return
    }

    case 'refresh-file': {
      const baseId = requireOption(options, 'base')
      const directoryItemId = requireOption(options, 'directoryItem')
      const filePath = requireOption(options, 'file')
      const job = await request(
        options,
        'POST',
        `/knowledge-bases/${encodeURIComponent(baseId)}/directories/${encodeURIComponent(directoryItemId)}/files/refresh`,
        { path: filePath, fallback: options.fallback || 'error' }
      )
      await printJobOrWait(options, job)
      return
    }

    case 'job': {
      const jobId = requireOption(options, 'job')
      console.log(
        JSON.stringify(await request(options, 'GET', `/knowledge-bases/jobs/${encodeURIComponent(jobId)}`), null, 2)
      )
      return
    }

    default:
      console.log(usage())
      process.exitCode = command ? 1 : 0
  }
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
