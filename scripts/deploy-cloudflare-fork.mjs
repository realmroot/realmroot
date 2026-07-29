#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'

required('CLOUDFLARE_API_TOKEN')
required('CLOUDFLARE_ACCOUNT_ID')

const repositoryName = required('GITHUB_REPOSITORY').split('/').at(-1)
const workerName = process.env.FLAREAUTH_WORKER_NAME?.trim() || repositoryName
const suffix = workerName.startsWith('flareauth-') ? workerName.slice('flareauth-'.length) : undefined
const settings = {
  workerName,
  databaseName: process.env.FLAREAUTH_D1_DATABASE?.trim() || workerName,
  bucketName:
    process.env.FLAREAUTH_R2_BUCKET?.trim() || (suffix ? `flareauth-assets-${suffix}` : `${workerName}-assets`),
  queueName:
    process.env.FLAREAUTH_EMAIL_QUEUE?.trim() || (suffix ? `flareauth-email-${suffix}` : `${workerName}-email`),
  emailFrom: required('FLAREAUTH_EMAIL_FROM'),
  emailFromName: process.env.FLAREAUTH_EMAIL_FROM_NAME?.trim() || 'FlareAuth',
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
ensureResource(
  ['exec', 'wrangler', 'queues', 'info', settings.queueName],
  ['exec', 'wrangler', 'queues', 'create', settings.queueName],
  `Queue ${settings.queueName}`,
)

run('node', ['scripts/prepare-deployment-config.mjs'], {
  FLAREAUTH_WORKER_NAME: settings.workerName,
  FLAREAUTH_D1_DATABASE: settings.databaseName,
  FLAREAUTH_D1_DATABASE_ID: database.uuid,
  FLAREAUTH_R2_BUCKET: settings.bucketName,
  FLAREAUTH_EMAIL_QUEUE: settings.queueName,
  FLAREAUTH_EMAIL_FROM: settings.emailFrom,
  FLAREAUTH_EMAIL_FROM_NAME: settings.emailFromName,
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
run('pnpm', ['run', 'build'])
const deployArguments = ['exec', 'wrangler', 'deploy', '--config', 'wrangler.deployment.toml']
if (process.env.GITHUB_SHA) {
  deployArguments.push('--message', `Deploy ${required('GITHUB_REPOSITORY')}@${process.env.GITHUB_SHA}`)
}
run('pnpm', deployArguments)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### FlareAuth deployment',
      '',
      `- Worker: \`${settings.workerName}\``,
      `- D1: \`${settings.databaseName}\``,
      `- R2: \`${settings.bucketName}\``,
      `- Queue: \`${settings.queueName}\``,
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
