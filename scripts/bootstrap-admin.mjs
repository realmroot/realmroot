#!/usr/bin/env node

const baseUrl = requireEnv('REALMROOT_URL').replace(/\/+$/, '')
const email = requireEnv('REALMROOT_ADMIN_EMAIL')
const password = requireEnv('REALMROOT_ADMIN_PASSWORD')
const name = process.env.REALMROOT_ADMIN_NAME || 'Realmroot Admin'
const username = process.env.REALMROOT_ADMIN_USERNAME

const response = await fetch(`${baseUrl}/api/onboarding/admin-users`, {
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
