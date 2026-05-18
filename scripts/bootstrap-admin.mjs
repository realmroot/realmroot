#!/usr/bin/env node

const baseUrl = requireEnv('FLAREAUTH_URL').replace(/\/+$/, '')
const email = requireEnv('FLAREAUTH_ADMIN_EMAIL')
const password = requireEnv('FLAREAUTH_ADMIN_PASSWORD')
const name = process.env.FLAREAUTH_ADMIN_NAME || 'FlareAuth Admin'
const username = process.env.FLAREAUTH_ADMIN_USERNAME

const response = await fetch(`${baseUrl}/api/setup/admin`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    email,
    password,
    name,
    ...(username ? { username } : {}),
  }),
})

const body = await response.text()

if (!response.ok) {
  throw new Error(`Admin bootstrap failed with ${response.status}: ${body}`)
}

console.log(body)

function requireEnv(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}
