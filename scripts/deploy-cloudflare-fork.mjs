#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'

required('CLOUDFLARE_API_TOKEN')
required('CLOUDFLARE_ACCOUNT_ID')

const repositoryName = required('GITHUB_REPOSITORY').split('/').at(-1)
const workerName = process.env.REALMROOT_WORKER_NAME?.trim() || repositoryName
const suffix = workerName.startsWith('realmroot-') ? workerName.slice('realmroot-'.length) : undefined
const settings = {
  workerName,
  databaseName: process.env.REALMROOT_D1_DATABASE?.trim() || workerName,
  bucketName:
    process.env.REALMROOT_R2_BUCKET?.trim() || (suffix ? `realmroot-assets-${suffix}` : `${workerName}-assets`),
}

const databases = JSON.parse(capture('pnpm', ['exec', 'wrangler', 'd1', 'list', '--json']))
let database = databases.find(({ name }) => name === settings.databaseName)
if (!database) {
  run('pnpm', ['exec', 'wrangler', 'd1', 'create', settings.databaseName])
  const updatedDatabases = JSON.parse(capture('pnpm', ['exec', 'wrangler', 'd1', 'list', '--json']))
  database = updatedDatabases.find(({ name }) => name === settings.databaseName)
}
if (!database?.uuid) {
  throw new Error(`Could not resolve D1 database ID for ${settings.databaseName}`)
}

ensureResource(
  ['exec', 'wrangler', 'r2', 'bucket', 'info', settings.bucketName, '--json'],
  ['exec', 'wrangler', 'r2', 'bucket', 'create', settings.bucketName],
  `R2 bucket ${settings.bucketName}`,
)
run('node', ['scripts/prepare-deployment-config.mjs'], {
  REALMROOT_WORKER_NAME: settings.workerName,
  REALMROOT_D1_DATABASE: settings.databaseName,
  REALMROOT_D1_DATABASE_ID: database.uuid,
  REALMROOT_R2_BUCKET: settings.bucketName,
})
run('pnpm', ['run', 'deploy:check', '--', 'wrangler.deployment.toml'])

const secretResult = command('pnpm', ['exec', 'wrangler', 'secret', 'list', '--config', 'wrangler.deployment.toml'])
const secrets = secretResult.status === 0 ? JSON.parse(secretResult.stdout) : []
const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim()
if (configuredSecret) {
  run(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'put', 'BETTER_AUTH_SECRET', '--config', 'wrangler.deployment.toml'],
    {},
    configuredSecret,
  )
} else if (!secrets.some(({ name }) => name === 'BETTER_AUTH_SECRET')) {
  run(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'put', 'BETTER_AUTH_SECRET', '--config', 'wrangler.deployment.toml'],
    {},
    randomBytes(32).toString('base64'),
  )
} else {
  console.log('Reusing existing BETTER_AUTH_SECRET.')
}

const configuredCredentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()
if (configuredCredentialEncryptionKey) {
  run(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'put', 'CREDENTIAL_ENCRYPTION_KEY', '--config', 'wrangler.deployment.toml'],
    {},
    configuredCredentialEncryptionKey,
  )
} else if (!secrets.some(({ name }) => name === 'CREDENTIAL_ENCRYPTION_KEY')) {
  run(
    'pnpm',
    ['exec', 'wrangler', 'secret', 'put', 'CREDENTIAL_ENCRYPTION_KEY', '--config', 'wrangler.deployment.toml'],
    {},
    randomBytes(48).toString('base64'),
  )
} else {
  console.log('Reusing existing CREDENTIAL_ENCRYPTION_KEY.')
}

run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.deployment.toml'])
run('pnpm', ['run', 'build'], { CF_WRANGLER_CONFIG: 'wrangler.deployment.toml' })
const deployArguments = ['exec', 'wrangler', 'deploy', '--config', 'dist/realmroot/wrangler.json']
if (process.env.GITHUB_SHA) {
  deployArguments.push('--message', `Deploy ${required('GITHUB_REPOSITORY')}@${process.env.GITHUB_SHA}`)
}
run('pnpm', deployArguments)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### Realmroot deployment',
      '',
      `- Worker: \`${settings.workerName}\``,
      `- D1: \`${settings.databaseName}\``,
      `- R2: \`${settings.bucketName}\``,
      '',
    ].join('\n'),
  )
}

function ensureResource(infoArguments, createArguments, label) {
  const result = command('pnpm', infoArguments)
  if (result.status === 0) {
    console.log(`Reusing ${label}.`)
    return
  }
  run('pnpm', createArguments)
}

function required(key) {
  const value = process.env[key]?.trim()
  if (!value) {
    throw new Error(`${key} is required`)
  }
  return value
}

function capture(executable, arguments_) {
  const result = command(executable, arguments_)
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    throw new Error(`${executable} ${arguments_.join(' ')} failed`)
  }
  return result.stdout
}

function run(executable, arguments_, extraEnvironment = {}, input) {
  const result = command(executable, arguments_, extraEnvironment, input)
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`${executable} ${arguments_.join(' ')} failed`)
  }
}

function command(executable, arguments_, extraEnvironment = {}, input) {
  const result = spawnSync(executable, arguments_, {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnvironment },
    input,
  })
  if (result.error) {
    throw result.error
  }
  return result
}
