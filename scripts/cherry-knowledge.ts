type JsonObject = Record<string, unknown>

interface CliOptions {
  api: string
  apiKey?: string
  base?: string
  path?: string
  item?: string
  directoryItem?: string
  file?: string
  job?: string
  mode?: string
  fallback?: string
  wait?: boolean
  refreshIfExists?: boolean
}

const DEFAULT_API_BASE = 'http://127.0.0.1:23333'
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function parseArgs(argv: string[]): { command?: string; options: CliOptions } {
  const [command, ...rest] = argv
  const options: CliOptions = {
    api: process.env.CHERRY_KB_API_BASE || process.env.CHERRY_API_BASE || DEFAULT_API_BASE,
    apiKey: process.env.CHERRY_API_KEY
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
      case '--base':
        options.base = readValue()
        break
      case '--path':
        options.path = readValue()
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
      case '--refresh-if-exists':
        options.refreshIfExists = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return { command, options }
}

function usage(): string {
  return [
    'Usage:',
    '  pnpm tsx scripts/cherry-knowledge.ts list [--api http://127.0.0.1:23333] [--api-key key]',
    '  pnpm tsx scripts/cherry-knowledge.ts add-directory --base <baseId> --path <dir> [--refresh-if-exists] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts refresh-directory --base <baseId> --item <itemId> [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts refresh-file --base <baseId> --directory-item <itemId> --file <file> [--fallback error|full-directory] [--wait]',
    '  pnpm tsx scripts/cherry-knowledge.ts job --job <jobId>',
    '',
    'Environment:',
    '  CHERRY_API_KEY      API Server bearer token',
    '  CHERRY_API_BASE     API Server base URL',
    '  CHERRY_KB_API_BASE  API Server base URL, preferred for this script'
  ].join('\n')
}

function requireOption(options: CliOptions, key: keyof CliOptions): string {
  const value = options[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required option --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`)
  }

  return value
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
  while (true) {
    const job = await request(options, 'GET', `/knowledge-bases/jobs/${encodeURIComponent(jobId)}`)
    if (TERMINAL_JOB_STATUSES.has(String(job.status))) {
      return job
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

async function printJobOrWait(options: CliOptions, job: JsonObject): Promise<void> {
  if (options.wait && typeof job.id === 'string') {
    console.log(JSON.stringify(await waitForJob(options, job.id), null, 2))
    return
  }

  console.log(JSON.stringify(job, null, 2))
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2))

  switch (command) {
    case 'list':
      console.log(JSON.stringify(await request(options, 'GET', '/knowledge-bases'), null, 2))
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
