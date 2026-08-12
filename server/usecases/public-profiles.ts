import { notFound } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import type { AgentAuditEventRecord, AgentIdentityRecord } from '@server/usecases/ports'
import { agentSubjectSchema } from '@shared/api/identifiers'
import type {
  AccountProfileLink,
  PublicActivity,
  PublicActivityDay,
  PublicActivityOverview,
  PublicAgentResponse,
  PublicProfileView,
  PublicUserResponse,
} from '@shared/api/public-profiles'

const recentActivityLimit = 10
const publicAgentLimit = 6

const publicActivityCopy: Record<string, { title: string; description: string }> = {
  'agent.identity_enrolled': {
    title: 'Agent identity enrolled',
    description: 'A stable Agent identity was created.',
  },
  'agent.identity_activated': {
    title: 'Agent identity activated',
    description: 'The stable Agent identity became active.',
  },
  'agent.identity_deactivated': {
    title: 'Agent identity deactivated',
    description: 'The stable Agent identity became inactive.',
  },
  'agent.identity_recovered': {
    title: 'Agent identity recovered',
    description: 'Credentials changed while the stable subject was preserved.',
  },
  'agent.host_revoked': {
    title: 'Agent installation revoked',
    description: 'An installation was removed from the stable Agent identity.',
  },
}
const publicActivityActions = Object.keys(publicActivityCopy)

export async function getPublicUserProfile(
  deps: Deps,
  username: string,
  view: PublicProfileView,
  origin: string,
): Promise<PublicUserResponse> {
  const profile = await deps.users.findPublicProfileByUsername(username)
  if (!profile || profile.user.banned) throw notFound('Public User profile was not found.')

  const base = {
    type: 'user' as const,
    id: profile.user.id,
    username: profile.user.username!,
    displayName: profile.user.displayName,
    picture: absoluteUrl(profile.user.image, origin),
    joinedAt: profile.user.createdAt.toISOString(),
    updatedAt: latest(profile.user.updatedAt, profile.profileUpdatedAt).toISOString(),
  }
  if (view === 'summary') return { ...base, view }

  const [identities, activity] = await Promise.all([
    deps.agentIdentities.listOwned({ ownerUserId: profile.user.id }, { limit: publicAgentLimit, offset: 0 }),
    deps.agentAudit.list(
      { limit: recentActivityLimit, offset: 0 },
      { actions: publicActivityActions, ownerUserId: profile.user.id },
    ),
  ])
  return {
    ...base,
    view,
    bio: profile.bio,
    location: profile.location,
    links: profile.links.map(publicLink),
    agentCount: identities.total,
    agents: identities.items.map(({ identity }) => agentSummary(identity)),
    recentActivity: sanitizeRecentActivity(activity.items),
  }
}

export async function getPublicAgentProfile(
  deps: Deps,
  issuer: string,
  identifier: string,
  view: PublicProfileView,
  now = new Date(),
): Promise<PublicAgentResponse> {
  const bySubject = agentSubjectSchema.safeParse(identifier).success
    ? await deps.agentIdentities.findByIssuerSubject(issuer, identifier)
    : null
  const identity = bySubject ?? (await deps.agentIdentities.findByIssuerUsername(issuer, identifier))
  if (!identity) throw notFound('Public Agent profile was not found.')

  const base = {
    type: 'agent' as const,
    issuer: identity.issuer,
    ...agentSummary(identity),
  }
  if (view === 'summary') return { ...base, view }

  const since = activityYearStart(now)
  const [owner, activityDays, recent] = await Promise.all([
    publicOwner(deps, identity),
    deps.agentAudit.summarizeByDay(since, { agentIdentityId: identity.id }),
    deps.agentAudit.list(
      { limit: recentActivityLimit, offset: 0 },
      { actions: publicActivityActions, agentIdentityId: identity.id },
    ),
  ])
  return {
    ...base,
    view,
    owner,
    activity: activityOverview(activityDays, now),
    activityDays,
    recentActivity: sanitizeRecentActivity(recent.items),
  }
}

function agentSummary(identity: AgentIdentityRecord) {
  return {
    subject: identity.subject,
    username: identity.username,
    name: identity.name,
    runtime: identity.runtime ?? null,
    picture: new URL('/agent-picture-v1.svg', identity.issuer).toString(),
    createdAt: identity.createdAt.toISOString(),
    updatedAt: identity.updatedAt.toISOString(),
  }
}

async function publicOwner(deps: Deps, identity: AgentIdentityRecord) {
  if (identity.ownerUserId) {
    const owner = await deps.users.getPublicProfile(identity.ownerUserId)
    return {
      type: 'user' as const,
      id: owner.user.id,
      username: owner.user.username,
      displayName: owner.user.displayName,
      picture: owner.user.image,
    }
  }

  const organization = await deps.authorization.findOrganization(identity.ownerOrganizationId!)
  if (!organization) throw notFound('Agent owner was not found.')
  return {
    type: 'organization' as const,
    id: organization.id,
    slug: organization.slug,
    displayName: organization.displayName ?? organization.name,
    picture: organization.logo,
  }
}

function sanitizeRecentActivity(events: AgentAuditEventRecord[]): PublicActivity[] {
  return events
    .flatMap((event) => {
      const copy = publicActivityCopy[event.action]
      if (!copy) return []
      return [
        {
          action: event.action,
          title: copy.title,
          description: copy.description,
          occurredAt: event.occurredAt.toISOString(),
        },
      ]
    })
    .slice(0, recentActivityLimit)
}

function activityOverview(days: PublicActivityDay[], now: Date): PublicActivityOverview {
  const activeDates = new Set(days.filter((day) => day.count > 0).map((day) => day.date))
  let longestStreak = 0
  let runningStreak = 0
  let previous: Date | null = null
  for (const dateValue of [...activeDates].sort()) {
    const date = new Date(`${dateValue}T00:00:00.000Z`)
    runningStreak = previous && date.getTime() - previous.getTime() === 86_400_000 ? runningStreak + 1 : 1
    longestStreak = Math.max(longestStreak, runningStreak)
    previous = date
  }

  let currentStreak = 0
  const cursor = new Date(now)
  cursor.setUTCHours(0, 0, 0, 0)
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    currentStreak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return {
    total: days.reduce((sum, day) => sum + day.count, 0),
    activeDays: activeDates.size,
    currentStreak,
    longestStreak,
  }
}

function activityYearStart(now: Date) {
  const since = new Date(now)
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - 364)
  return since
}

function publicLink(link: AccountProfileLink) {
  if (link.type === 'website') return link
  const { accountId: _accountId, ...projection } = link
  return projection
}

function absoluteUrl(value: string | null, origin: string) {
  return value ? new URL(value, origin).toString() : null
}

function latest(first: Date, second: Date | null) {
  return second && second > first ? second : first
}
