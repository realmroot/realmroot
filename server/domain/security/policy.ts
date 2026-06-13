import type { SecurityPolicy } from '../../../shared/api/security'
import { badRequest } from '../errors'

export function validatePasswordPolicy(
  password: string,
  policy: SecurityPolicy['password'],
  user: { email?: string | null; name?: string | null; username?: string | null } = {},
) {
  if (password.length < policy.minLength) {
    throw badRequest(`Password must be at least ${policy.minLength} characters.`)
  }

  if (characterTypeCount(password) < policy.requiredCharacterTypes) {
    throw badRequest(`Password must include at least ${policy.requiredCharacterTypes} character types.`)
  }

  const normalized = password.toLowerCase()
  if (policy.rejectSequential && hasSequentialRun(normalized)) {
    throw badRequest('Password cannot include sequential or repetitive characters.')
  }

  if (policy.rejectUserInfo) {
    const userParts = [user.email?.split('@')[0], user.name, user.username]
      .filter((value): value is string => Boolean(value && value.length >= 3))
      .map((value) => value.toLowerCase())
    if (userParts.some((part) => normalized.includes(part))) {
      throw badRequest('Password cannot include account profile information.')
    }
  }

  if (policy.rejectCustomWords) {
    const words = policy.customWords.map((word) => word.toLowerCase()).filter((word) => word.length >= 3)
    if (words.some((word) => normalized.includes(word))) {
      throw badRequest('Password cannot include blocked words.')
    }
  }
}

export function validateEmailPolicy(email: string, policy: SecurityPolicy['blocklist']) {
  const normalized = email.trim().toLowerCase()
  const [localPart, domain] = normalized.split('@')

  if (!localPart || !domain) {
    throw badRequest('Email address is invalid.')
  }

  if (policy.blockSubaddressing && localPart.includes('+')) {
    throw badRequest('Email subaddressing is not allowed.')
  }

  const entries = policy.entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  if (entries.includes(normalized) || entries.includes(domain)) {
    throw badRequest('Email address is not allowed.')
  }
}

function characterTypeCount(password: string) {
  return [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^a-zA-Z0-9]/.test(password)].filter(
    Boolean,
  ).length
}

function hasSequentialRun(value: string) {
  for (let index = 0; index <= value.length - 3; index += 1) {
    const first = value.charCodeAt(index)
    const second = value.charCodeAt(index + 1)
    const third = value.charCodeAt(index + 2)

    if (first === second && second === third) return true
    if (second === first + 1 && third === second + 1) return true
    if (second === first - 1 && third === second - 1) return true
  }

  return false
}
