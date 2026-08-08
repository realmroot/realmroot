import type {
  PublicActivity,
  PublicActivityDay,
  PublicAgentResponse,
  PublicUserResponse,
} from '@shared/api/public-profiles'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Bot,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Grid3X3,
  Link2,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { toast } from 'sonner'
import { ProductAccountMenu } from '@/components/product-account-menu'
import { RealmrootWordmark } from '@/components/realmroot-brand'
import { Button } from '@/components/ui/button'
import { ApiRequestError } from '@/lib/api'
import { authClient, signOut } from '@/lib/auth-client'
import { tt } from '@/lib/i18n'
import { getPublicAgentProfile, getPublicUserProfile } from './api'
import './public-profiles.css'

export function PublicUserProfilePage({ username }: { username: string }) {
  const query = useQuery({
    queryKey: ['public-profile', 'user', username],
    queryFn: () => getPublicUserProfile(username),
  })
  if (query.isLoading) return <PublicProfileState title="Loading public profile…" />
  if (query.error) return <PublicProfileFailure error={query.error} kind="User" retry={() => void query.refetch()} />
  if (!query.data || query.data.view !== 'full') return <PublicProfileState title="Unable to load User profile" />
  return <PublicProfileShell profile={query.data} />
}

export function PublicAgentProfilePage({ subject }: { subject: string }) {
  const query = useQuery({
    queryKey: ['public-profile', 'agent', subject],
    queryFn: () => getPublicAgentProfile(subject),
  })
  if (query.isLoading) return <PublicProfileState title="Loading public profile…" />
  if (query.error) return <PublicProfileFailure error={query.error} kind="Agent" retry={() => void query.refetch()} />
  if (!query.data || query.data.view !== 'full') return <PublicProfileState title="Unable to load Agent profile" />
  return <PublicProfileShell profile={query.data} />
}

function PublicProfileShell({
  profile,
}: {
  profile: Extract<PublicUserResponse | PublicAgentResponse, { view: 'full' }>
}) {
  useEffect(() => {
    document.title = `${profile.type === 'user' ? profile.displayName : profile.name} · Realmroot`
  }, [profile])
  return (
    <div className="publicProfileShell">
      <a className="skipLink" href="#public-profile-content">
        Skip to profile content
      </a>
      <header className="publicProfileTopbar">
        <Link aria-label="Realmroot home" to="/">
          <RealmrootWordmark context="Profiles" />
        </Link>
        <PublicProfileNavigation />
      </header>
      <main className="publicProfileMain" id="public-profile-content">
        <div className={`publicProfileCover ${profile.type}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <article className="publicProfileCard">
          <div className="publicProfileLayout">
            <IdentityRail profile={profile} />
            <div className="publicProfileContent">
              {profile.type === 'user' ? (
                <>
                  <PublicAgents profile={profile} />
                  <ActivityFeed activity={profile.recentActivity} />
                </>
              ) : (
                <>
                  <ActivityOverview profile={profile} />
                  <ActivityHeatmap activity={profile.activityDays} total={profile.activity.total} />
                  <ActivityFeed activity={profile.recentActivity} />
                </>
              )}
            </div>
          </div>
        </article>
      </main>
      <footer className="publicProfileFooter">
        <span>Powered by Realmroot</span>
      </footer>
    </div>
  )
}

function PublicProfileNavigation() {
  const navigate = useNavigate()
  const session = authClient.useSession()
  if (session.isPending || session.error) return null

  async function signOutFromPublicProfile() {
    try {
      await signOut()
      toast.success(tt('Signed out'))
      await navigate({ to: '/auth/sign-in' })
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? tt(mutationError.message) : tt('Account update failed.'))
    }
  }

  if (session.data?.user) {
    return (
      <nav aria-label="Public profile navigation">
        <ProductAccountMenu
          onSignOut={() => void signOutFromPublicProfile()}
          primaryAction={{ icon: UserRound, label: 'Account Center', to: '/profile' }}
          profile={{
            displayName: session.data.user.name,
            email: session.data.user.email,
            image: session.data.user.image,
          }}
        />
      </nav>
    )
  }

  return (
    <nav aria-label="Public profile navigation">
      <Button asChild size="sm" variant="outline">
        <Link to="/auth/sign-in">Sign in</Link>
      </Button>
    </nav>
  )
}

function IdentityRail({ profile }: { profile: Extract<PublicUserResponse | PublicAgentResponse, { view: 'full' }> }) {
  const isUser = profile.type === 'user'
  return (
    <aside className="publicProfileRail">
      <ProfileAvatar name={isUser ? profile.displayName : profile.name} picture={profile.picture} type={profile.type} />
      <div className="publicProfileHeading">
        <span className="publicProfileType">
          {isUser ? <CircleUserRound /> : <Bot />}
          {isUser ? 'User profile' : 'Agent identity'}
        </span>
        <h1>{isUser ? profile.displayName : profile.name}</h1>
        <p className={isUser ? undefined : 'publicProfileMono'}>{isUser ? `@${profile.username}` : profile.subject}</p>
        {isUser && profile.bio ? <p className="publicProfileBio">{profile.bio}</p> : null}
      </div>
      <dl className="publicProfileMeta">
        <div>
          <dt>{isUser ? 'Joined' : 'Created'}</dt>
          <dd>{formatMonthYear(isUser ? profile.joinedAt : profile.createdAt)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatRelativeDate(profile.updatedAt)}</dd>
        </div>
      </dl>
      {isUser ? <UserPresence profile={profile} /> : <AgentOwner profile={profile} />}
      <details className="publicProfileTechnical">
        <summary>
          {isUser ? 'Public identity' : 'Stable identity'} <ChevronRight />
        </summary>
        <dl>
          {isUser ? null : <ProfileDetail label="Issuer" value={profile.issuer} />}
          <ProfileDetail label={isUser ? 'User ID' : 'Subject'} value={isUser ? profile.id : profile.subject} />
        </dl>
      </details>
    </aside>
  )
}

function UserPresence({ profile }: { profile: Extract<PublicUserResponse, { view: 'full' }> }) {
  if (!profile.location && profile.links.length === 0) return null
  return (
    <section className="publicProfilePresence">
      <h2>Links &amp; identities</h2>
      {profile.location ? (
        <div className="publicProfilePresenceItem">
          <span className="publicProfilePresenceIcon">
            <MapPin />
          </span>
          <span>
            <strong>{profile.location}</strong>
            <small>Location</small>
          </span>
        </div>
      ) : null}
      {profile.links.map((link) => (
        <a href={link.url} key={`${link.type}:${link.url}`} rel="noreferrer" target="_blank">
          <span className="publicProfilePresenceIcon">
            <Link2 />
          </span>
          <span>
            <strong>{link.label}</strong>
            <small>{new URL(link.url).hostname}</small>
          </span>
          <ArrowUpRight />
        </a>
      ))}
    </section>
  )
}

function AgentOwner({ profile }: { profile: Extract<PublicAgentResponse, { view: 'full' }> }) {
  const label =
    profile.owner.type === 'user' && profile.owner.username ? `@${profile.owner.username}` : profile.owner.type
  const content = (
    <>
      <ProfileAvatar compact name={profile.owner.displayName} picture={profile.owner.picture} type="user" />
      <span>
        <strong>{profile.owner.displayName}</strong>
        <small>{label}</small>
      </span>
      {profile.owner.type === 'user' && profile.owner.username ? <ChevronRight /> : null}
    </>
  )
  return (
    <section className="publicProfileOwner">
      <h2>Owner</h2>
      {profile.owner.type === 'user' && profile.owner.username ? (
        <Link params={{ username: profile.owner.username }} to="/u/$username">
          {content}
        </Link>
      ) : (
        <div>{content}</div>
      )}
    </section>
  )
}

function PublicAgents({ profile }: { profile: Extract<PublicUserResponse, { view: 'full' }> }) {
  return (
    <section className="publicProfileAgents">
      <header>
        <div>
          <h2>Public Agents</h2>
          <p>Stable Agent identities owned by this User</p>
        </div>
        <span>{profile.agentCount} Agents</span>
      </header>
      {profile.agents.length ? (
        <div>
          {profile.agents.map((agent) => (
            <Link key={agent.subject} params={{ subject: agent.subject }} to="/agents/$subject">
              <span className="publicProfileAgentAvatar">
                <Bot />
              </span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.subject}</small>
                <em>Updated {formatRelativeDate(agent.updatedAt)}</em>
              </span>
              <ChevronRight />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyProfileSection>No public Agents yet.</EmptyProfileSection>
      )}
    </section>
  )
}

function ActivityOverview({ profile }: { profile: Extract<PublicAgentResponse, { view: 'full' }> }) {
  const items = [
    {
      label: 'Total activity',
      value: profile.activity.total,
      unit: 'activities',
      note: `${profile.activity.activeDays} active days`,
      icon: <Grid3X3 />,
    },
    {
      label: 'Current streak',
      value: profile.activity.currentStreak,
      unit: 'days',
      note: profile.activity.currentStreak ? 'Active today' : 'No active streak',
      icon: <Sparkles />,
    },
    {
      label: 'Longest streak',
      value: profile.activity.longestStreak,
      unit: 'days',
      note: 'Past 12 months',
      icon: <ShieldCheck />,
    },
  ]
  return (
    <section className="publicActivityOverview">
      <header>
        <h2>Activity overview</h2>
        <p>Consistency across public and anonymized Agent activity</p>
      </header>
      <div>
        {items.map((item) => (
          <article className={item.label === 'Current streak' ? 'isCurrent' : undefined} key={item.label}>
            <header>
              <span>{item.label}</span>
              <i>{item.icon}</i>
            </header>
            <div className="publicActivityValue">
              <strong>{item.value}</strong>
              <span>{item.unit}</span>
            </div>
            <footer>{item.note}</footer>
          </article>
        ))}
      </div>
    </section>
  )
}

function ActivityHeatmap({ activity, total }: { activity: PublicActivityDay[]; total: number }) {
  const cells = heatmapCells(activity)
  return (
    <section className="publicProfileHeatmap">
      <header>
        <div>
          <h2>{total} activities in the last year</h2>
          <p>Private context is never included</p>
        </div>
        <span>{new Date().getUTCFullYear()}</span>
      </header>
      <div className="publicHeatmapScroll">
        <div className="publicHeatmapGrid" aria-label="Agent activity heatmap" role="img">
          {cells.map((cell) => (
            <span
              className={`heatLevel${activityLevel(cell.count)}`}
              key={cell.date}
              title={`${cell.date}: ${cell.count} activities`}
            />
          ))}
        </div>
      </div>
      <footer>
        <span>Activity is aggregated in UTC.</span>
        <div className="publicHeatmapLegend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i className={`heatLevel${level}`} key={level} />
          ))}
          <span>More</span>
        </div>
      </footer>
    </section>
  )
}

function ActivityFeed({ activity }: { activity: PublicActivity[] }) {
  const groups = groupActivity(activity)
  return (
    <section className="publicActivityFeed">
      <header>
        <div>
          <h2>Recent activity</h2>
          <p>Public details only; private activity contributes counts without context.</p>
        </div>
      </header>
      {groups.length ? (
        groups.map(([month, items]) => (
          <div className="publicActivityMonth" key={month}>
            <h3>{month}</h3>
            <div>
              {items.map((item) => (
                <article key={`${item.action}:${item.occurredAt}`}>
                  <span className="publicActivityIcon">
                    <CalendarDays />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                  <time dateTime={item.occurredAt}>{formatShortDate(item.occurredAt)}</time>
                </article>
              ))}
            </div>
          </div>
        ))
      ) : (
        <EmptyProfileSection>No public activity yet.</EmptyProfileSection>
      )}
    </section>
  )
}

function ProfileAvatar({
  compact = false,
  name,
  picture,
  type,
}: {
  compact?: boolean
  name: string
  picture: string | null
  type: 'user' | 'agent'
}) {
  return (
    <span
      className={`publicProfileAvatar ${type}${compact ? ' isCompact' : ''}`}
      aria-label={`${name} avatar`}
      role="img"
    >
      {picture ? <img alt="" src={picture} /> : type === 'agent' ? <Bot /> : initials(name)}
    </span>
  )
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
      </dd>
    </div>
  )
}

function EmptyProfileSection({ children }: { children: ReactNode }) {
  return <div className="publicProfileEmpty">{children}</div>
}

function PublicProfileState({ title }: { title: string }) {
  return (
    <div className="publicProfileShell">
      <header className="publicProfileTopbar">
        <RealmrootWordmark context="Profiles" />
      </header>
      <main className="publicProfileState">
        <CircleUserRound />
        <h1>{title}</h1>
        <p>The profile may be unavailable or no longer public.</p>
      </main>
    </div>
  )
}

function PublicProfileFailure({ error, kind, retry }: { error: Error; kind: 'Agent' | 'User'; retry: () => void }) {
  if (error instanceof ApiRequestError && error.status === 404) {
    return <PublicProfileState title={`${kind} profile not found`} />
  }
  return (
    <div className="publicProfileShell">
      <header className="publicProfileTopbar">
        <RealmrootWordmark context="Profiles" />
      </header>
      <main className="publicProfileState">
        <CircleUserRound />
        <h1>Unable to load {kind} profile</h1>
        <p>The profile could not be loaded. Try again.</p>
        <Button onClick={retry}>Retry</Button>
      </main>
    </div>
  )
}

function heatmapCells(activity: PublicActivityDay[]) {
  const counts = new Map(activity.map((day) => [day.date, day.count]))
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  cursor.setUTCDate(cursor.getUTCDate() - 364)
  return Array.from({ length: 365 }, () => {
    const date = cursor.toISOString().slice(0, 10)
    const cell = { date, count: counts.get(date) ?? 0 }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    return cell
  })
}

function activityLevel(count: number) {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

function groupActivity(activity: PublicActivity[]): Array<[string, PublicActivity[]]> {
  const groups = new Map<string, PublicActivity[]>()
  for (const item of activity) {
    const month = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(item.occurredAt),
    )
    groups.set(month, [...(groups.get(month) ?? []), item])
  }
  return [...groups]
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value))
}

function formatRelativeDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return 'Today'
  return formatShortDate(value)
}
