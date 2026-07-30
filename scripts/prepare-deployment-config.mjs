#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'

const sourcePath = process.argv[2] ?? 'wrangler.toml'
const outputPath = process.argv[3] ?? 'wrangler.deployment.toml'

const settings = {
  workerName: requiredName('REALMROOT_WORKER_NAME'),
  databaseName: requiredName('REALMROOT_D1_DATABASE'),
  databaseId: requiredUuid('REALMROOT_D1_DATABASE_ID'),
  bucketName: requiredName('REALMROOT_R2_BUCKET'),
  queueName: requiredName('REALMROOT_EMAIL_QUEUE'),
  emailFrom: requiredEmail('REALMROOT_EMAIL_FROM'),
  emailFromName: requiredText('REALMROOT_EMAIL_FROM_NAME'),
}

let config = readFileSync(sourcePath, 'utf8')
config = replaceOnce(config, /^name = .+$/m, `name = ${tomlString(settings.workerName)}`)
config = removeOptionalLine(config, /^BETTER_AUTH_URL = .+$/m)
config = removeOptionalLine(config, /^TRUSTED_ORIGINS = .+$/m)
config = removeOptionalLine(config, /^WEBAUTHN_RP_ID = .+$/m)
config = removeOptionalLine(config, /^WEBAUTHN_ORIGINS = .+$/m)
config = replaceOnce(config, /^EMAIL_FROM = .+$/m, `EMAIL_FROM = ${tomlString(settings.emailFrom)}`)
config = replaceOnce(config, /^EMAIL_FROM_NAME = .+$/m, `EMAIL_FROM_NAME = ${tomlString(settings.emailFromName)}`)
config = replaceOnce(
  config,
  /^allowed_sender_addresses = .+$/m,
  `allowed_sender_addresses = [${tomlString(settings.emailFrom)}]`,
)
config = replaceOnce(config, /^bucket_name = .+$/m, `bucket_name = ${tomlString(settings.bucketName)}`)
config = replaceOnce(config, /^database_name = .+$/m, `database_name = ${tomlString(settings.databaseName)}`)
config = replaceOnce(config, /^database_id = .+$/m, `database_id = ${tomlString(settings.databaseId)}`)
config = replaceOnce(config, /^queue = .+$/m, `queue = ${tomlString(settings.queueName)}`)

if (!/^keep_vars = true$/m.test(config)) {
  config = replaceOnce(config, /^preview_urls = .+$/m, '$&\nkeep_vars = true')
}

writeFileSync(outputPath, config)
console.log(`Generated ${outputPath} for Worker ${settings.workerName}.`)

function requiredName(key) {
  const value = requiredText(key)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,253}[a-z0-9])?$/.test(value)) {
    throw new Error(`${key} must contain lowercase letters, numbers, or hyphens`)
  }
  return value
}

function requiredUuid(key) {
  const value = requiredText(key)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`${key} must be a UUID`)
  }
  return value
}

function requiredEmail(key) {
  const value = requiredText(key)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error(`${key} must be an email address`)
  }
  return value
}

function requiredText(key) {
  const value = process.env[key]?.trim()
  if (!value) {
    throw new Error(`${key} is required`)
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 31 || codePoint === 127
    })
  ) {
    throw new Error(`${key} must not contain control characters`)
  }
  return value
}

function replaceOnce(content, pattern, replacement) {
  if (!pattern.test(content)) {
    throw new Error(`Deployment config template is missing ${pattern}`)
  }
  return content.replace(pattern, replacement)
}

function removeOptionalLine(content, pattern) {
  return content.replace(pattern, '')
}

function tomlString(value) {
  return JSON.stringify(value)
}
