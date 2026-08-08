const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`

const consoleGroups = [
  { items: [{ id: 'dashboard', label: 'Dashboard', icon: 'grid' }] },
  {
    label: 'Identity',
    items: [
      { id: 'users', label: 'Users', icon: 'users' },
      { id: 'agents', label: 'Agents', icon: 'bot' },
      { id: 'organizations', label: 'Organizations', icon: 'building', contexts: ['realm'] },
    ],
  },
  {
    label: 'Develop',
    items: [
      { id: 'applications', label: 'Applications', icon: 'app' },
      { id: 'api-resources', label: 'Resource servers', icon: 'key' },
      { id: 'webhooks', label: 'Webhooks', icon: 'webhook' },
    ],
  },
  {
    label: 'Authorization',
    items: [
      { id: 'roles', label: 'Roles', icon: 'role' },
      { id: 'role-assignments', label: 'Role assignments', icon: 'link' },
    ],
  },
  {
    label: 'Authentication',
    contexts: ['realm'],
    items: [
      { id: 'connectors', label: 'Identity providers', icon: 'cable' },
      { id: 'sign-in-experience', label: 'Sign-in & registration', icon: 'fingerprint' },
      { id: 'security', label: 'Security policies', icon: 'shield' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { id: 'branding', label: 'Experience', icon: 'palette', contexts: ['realm'] },
      { id: 'settings', label: 'Settings', icon: 'settings', pages: { realm: 'realm-settings', organization: 'organization-settings' } },
    ],
  },
]

const consoleUtilities = [
  { label: 'Management API', icon: 'code' },
  { label: 'Help & documentation', icon: 'help' },
]

const authVariants = [
  ['sign-in', 'Sign in'],
  ['sign-up', 'Sign up'],
  ['recovery', 'Recovery'],
  ['verification', 'Email verification'],
  ['mfa', 'MFA'],
  ['consent', 'OAuth consent'],
  ['device', 'Device approval'],
  ['agent-login', 'Agent login'],
  ['agent-identity', 'Agent enrollment'],
  ['resource-access', 'Resource access'],
  ['callback', 'Callback'],
  ['onboarding', 'First admin'],
]

const accountVariants = [
  ['overview', 'Overview', 'grid'],
  ['profile', 'Profile', 'users'],
  ['security', 'Sign-in & security', 'shield'],
  ['applications', 'Applications', 'app'],
  ['agents', 'Agents', 'bot'],
  ['organizations', 'Organizations', 'building'],
]

const publicProfileVariants = [
  ['user', 'User Profile'],
  ['agent', 'Agent Profile'],
]

const accountNavGroups = [
  { label: 'Your account', pages: ['overview', 'profile', 'security'] },
  { label: 'Access & authority', pages: ['applications', 'agents', 'organizations'] },
]

const state = {
  surface: 'console',
  consolePage: 'dashboard',
  authVariant: 'sign-in',
  resourceLifetime: 'date',
  accountPage: 'overview',
  publicProfile: 'user',
  consoleContext: 'realm',
  consoleFilters: {},
  resourceMode: 'native',
  accountOrganizationOpen: false,
  accountOrganization: 'payments',
  detailTabs: {
    agent: 'overview',
    user: 'overview',
    application: 'overview',
    organization: 'overview',
    resource: 'overview',
    role: 'overview',
    branding: 'theme',
    connectors: 'methods',
    security: 'sign-in',
    realmSettings: 'general',
    webhooks: 'endpoints',
  },
  accountTabs: {
    profile: 'details',
    security: 'sign-in',
    applications: 'authorized',
    agents: 'identities',
    organization: 'overview',
  },
}

const prototype = document.querySelector('#prototype')
const variantPicker = document.querySelector('#variantPicker')

document.querySelectorAll('[data-surface]').forEach((button) => {
  button.addEventListener('click', () => {
    state.surface = button.dataset.surface
    document.querySelectorAll('[data-surface]').forEach((candidate) => {
      const active = candidate === button
      candidate.classList.toggle('is-active', active)
      candidate.setAttribute('aria-selected', String(active))
    })
    render()
  })
})

function productBrand(context) {
  return `<div class="product-brand"><span class="rr-mark"><i></i><i></i><i></i></span><strong>realmroot</strong><em>${context}</em></div>`
}

function productTopbar(context, account = 'SL') {
  const contextControl = context === 'Console'
    ? `<label class="console-context-switcher"><span>Context</span><select data-console-context aria-label="Console context"><option value="realm" ${state.consoleContext === 'realm' ? 'selected' : ''}>Acme Realm</option><option value="organization" ${state.consoleContext === 'organization' ? 'selected' : ''}>Payments Team</option></select></label>`
    : `<div class="deployment-context">${icon('shield')}<span>identity.acme.dev</span></div>`
  return `<header class="product-topbar">
    <div class="product-topbar-start">${context === 'Console' ? `<button class="icon-button mobile-nav-button" data-mobile-console-nav type="button" aria-label="Open navigation">${icon('grid')}</button>` : ''}${productBrand(context)}</div>
    <div class="top-actions">
      <button class="icon-button" type="button" aria-label="Search">${icon('search')}</button>
      ${contextControl}
      <button class="avatar" type="button" aria-label="Account menu">${account}</button>
    </div>
  </header>`
}

function consoleContextName() {
  return state.consoleContext === 'realm' ? 'Acme Realm' : 'Payments Team'
}

function render() {
  if (state.surface === 'console') renderConsole()
  if (state.surface === 'auth') renderAuth()
  if (state.surface === 'account') renderAccount()
  if (state.surface === 'profiles') renderPublicProfile()
  renderVariantPicker()
}

function renderVariantPicker() {
  if (state.surface === 'console') {
    variantPicker.innerHTML = ''
    return
  }
  const variants = state.surface === 'auth' ? authVariants : state.surface === 'profiles' ? publicProfileVariants : accountVariants
  const selected = state.surface === 'auth' ? state.authVariant : state.surface === 'profiles' ? state.publicProfile : state.accountPage
  variantPicker.innerHTML = variants
    .map(([id, label]) => `<button class="${id === selected ? 'is-active' : ''}" data-variant="${id}" type="button">${label}</button>`)
    .join('')
  variantPicker.querySelectorAll('[data-variant]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.surface === 'auth') state.authVariant = button.dataset.variant
      else if (state.surface === 'profiles') state.publicProfile = button.dataset.variant
      else state.accountPage = button.dataset.variant
      render()
    })
  })
}

function publicProfileTopbar() {
  return `<header class="public-profile-topbar">
    <a class="public-profile-brand" href="#" aria-label="Realmroot home">${productBrand('Profiles')}</a>
    <nav aria-label="Public profile navigation"><a href="#">OpenID configuration</a><button class="button" type="button">Sign in</button></nav>
  </header>`
}

function publicProfileDetail(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`
}

function profileRailMeta(firstLabel, firstValue) {
  return `<dl class="rail-meta"><div><dt>${firstLabel}</dt><dd>${firstValue}</dd></div><div><dt>Last activity</dt><dd><i></i>Today</dd></div></dl>`
}

function profileOwner() {
  return `<section class="rail-owner"><h2>Owner</h2><a href="#" data-public-user><span class="rail-owner-avatar">JS</span><span><strong>Jane Stone</strong><small>@jane</small></span>${icon('arrow')}</a></section>`
}

function profileAgents() {
  return `<section class="profile-agents"><header><div><h2>Public Agents</h2><p>Agent identities owned by this User</p></div><span>2 Agents</span></header><div><a href="#" data-public-agent><span class="profile-agent-avatar">${icon('bot')}</span><span><strong>Sales Copilot</strong><small class="mono">agt_01J8A2</small><em>247 activities this year</em></span>${icon('arrow')}</a><a href="#" data-public-agent><span class="profile-agent-avatar">${icon('bot')}</span><span><strong>Research Assistant</strong><small class="mono">agt_01J7Q9</small><em>86 activities this year</em></span>${icon('arrow')}</a></div></section>`
}

function profileHeatmap(total, seed) {
  const cells = Array.from({ length: 371 }, (_, index) => {
    const score = (index * seed + Math.floor(index / 7) * 5 + (index % 7) * 3) % 23
    const level = index % 17 === 0 || score < 5 ? 0 : score < 10 ? 1 : score < 15 ? 2 : score < 20 ? 3 : 4
    return `<span class="heat-level-${level}" title="${level === 0 ? 'No public activity' : `${level} activity level`}"></span>`
  }).join('')
  return `<section class="profile-heatmap"><header><div><h2>${total} activities in the last year</h2><p>Public activity and anonymized private counts</p></div><button class="button" type="button">2026 ${icon('arrow')}</button></header><div class="heatmap-scroll"><div class="heatmap-months"><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span></div><div class="heatmap-body"><div class="heatmap-days"><span>Mon</span><span>Wed</span><span>Fri</span></div><div class="heatmap-grid" aria-label="Activity heatmap">${cells}</div></div></div><footer><span>Activity is aggregated in UTC.</span><div class="heatmap-legend"><span>Less</span>${[0, 1, 2, 3, 4].map((level) => `<i class="heat-level-${level}"></i>`).join('')}<span>More</span></div></footer></section>`
}

function profileActivityOverview(items) {
  return `<section class="activity-overview"><header><h2>Activity overview</h2><p>Consistency across public activity</p></header><div>${items.map(([label, value, unit, range, note, iconName]) => `<article class="${label === 'Current streak' ? 'is-current' : ''}"><header><span>${label}</span><i>${icon(iconName)}</i></header><div class="activity-stat-value"><strong>${value}</strong><span>${unit}</span></div><p>${range}</p><footer>${label === 'Current streak' ? '<i></i>' : ''}${note}</footer></article>`).join('')}</div></section>`
}

function profileActivityTimeline(groups) {
  return `<section class="profile-activity-feed"><header><div><h2>Recent activity</h2><p>Public details only; private activity contributes counts without context.</p></div></header>${groups.map(([month, items]) => `<div class="activity-month"><h3>${month}</h3><div>${items.map(([title, description, date, iconName]) => `<article><span class="activity-feed-icon">${icon(iconName)}</span><div><strong>${title}</strong><p>${description}</p></div><time>${date}</time></article>`).join('')}</div></div>`).join('')}<button class="button activity-more" type="button">Show more activity</button></section>`
}

function renderPublicProfile() {
  prototype.innerHTML = `<div class="public-profile-shell">${publicProfileTopbar()}${state.publicProfile === 'agent' ? publicAgentProfile() : publicUserProfile()}<footer class="public-profile-footer"><span>Powered by Realmroot</span><nav><a href="#">Report profile</a><a href="#">Privacy</a><a href="#">Terms</a></nav></footer></div>`
  prototype.querySelectorAll('[data-public-agent]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault()
    state.publicProfile = 'agent'
    render()
  }))
  prototype.querySelectorAll('[data-public-user]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault()
    state.publicProfile = 'user'
    render()
  }))
}

function publicUserProfile() {
  return `<main class="public-profile-main">
    <div class="public-profile-cover user"><span></span><span></span><span></span></div>
    <article class="public-profile-card activity-profile-card"><div class="profile-activity-layout">
      <aside class="profile-identity-rail">
        <div class="public-profile-avatar user" aria-label="Jane Stone avatar">JS</div>
        <div class="rail-heading"><span class="rail-type">${icon('users')}User profile</span><h1>Jane Stone</h1><p>@jane</p></div>
        ${profileRailMeta('Joined', 'Jun 18, 2024')}
        <section class="rail-presence"><h2>Links &amp; identities</h2><a href="#"><span class="rail-presence-icon">${icon('link')}</span><span><strong>jane.dev</strong><small>Personal website</small></span>${icon('arrow')}</a><a href="#"><span class="rail-presence-icon">${icon('users')}</span><span><strong>@janestone <em>${icon('shield')}Linked</em></strong><small>GitHub</small></span>${icon('arrow')}</a></section>
        <details class="rail-technical"><summary>Technical identity ${icon('arrow')}</summary><dl>${publicProfileDetail('Subject', '<code>usr_01J8A2K7</code>')}${publicProfileDetail('Updated', 'Aug 7, 2026')}</dl></details>
      </aside>
      <div class="profile-activity-content">
        ${profileAgents()}
        ${profileActivityTimeline([['August 2026', [['Approved a new Agent identity', 'Sales Copilot was enrolled in the personal space.', 'Aug 7', 'bot'], ['Updated Agent access', 'Access configuration changed for a private Resource.', 'Aug 5', 'key'], ['Revoked Resource access', 'An Agent grant was revoked.', 'Aug 2', 'lock']]], ['July 2026', [['Recovered an Agent identity', 'A stable identity was recovered without changing its subject.', 'Jul 28', 'shield'], ['Updated an Organization role', 'A public Organization role definition changed.', 'Jul 19', 'role']]]])}
      </div>
    </div>
    </article>
  </main>`
}

function publicAgentProfile() {
  return `<main class="public-profile-main agent-profile">
    <div class="public-profile-cover agent"><span></span><span></span><span></span></div>
    <article class="public-profile-card activity-profile-card"><div class="profile-activity-layout">
      <aside class="profile-identity-rail">
        <div class="public-profile-avatar agent" aria-label="Sales Copilot avatar">${icon('bot')}</div>
        <div class="rail-heading"><span class="rail-type">${icon('bot')}Agent identity</span><h1>Sales Copilot</h1><p class="mono">agt_01J8A2</p></div>
        ${profileRailMeta('Created', 'Jun 18, 2026')}
        ${profileOwner()}
        <details class="rail-technical"><summary>Stable identity ${icon('arrow')}</summary><dl>${publicProfileDetail('Issuer', '<code>identity.acme.dev/api/auth</code>')}${publicProfileDetail('Subject', '<code>agt_01J8A2</code>')}${publicProfileDetail('Profile', '<code>ai_agent</code>')}</dl></details>
      </aside>
      <div class="profile-activity-content">
        ${profileActivityOverview([['Total activity', '247', 'activities', 'Past 12 months', '112 active days', 'grid'], ['Current streak', '14', 'days', 'Jul 26 – Today', 'Active today', 'link'], ['Longest streak', '32', 'days', 'Apr 8 – May 9', 'Spring 2026', 'shield']])}
        ${profileHeatmap(247, 11)}
        ${profileActivityTimeline([['August 2026', [['Agent identity activated', 'The stable Agent identity became active.', 'Aug 7', 'bot'], ['Access configuration changed', 'Approved authority changed for a private Resource.', 'Aug 6', 'key'], ['Additional installation approved', 'A new installation joined this stable identity.', 'Aug 3', 'app']]], ['July 2026', [['Resource access revoked', 'Previously approved access was revoked.', 'Jul 28', 'lock'], ['Agent identity recovered', 'Credentials changed while the stable subject was preserved.', 'Jul 14', 'shield']]]])}
      </div>
    </div>
    </article>
  </main>`
}

function renderConsole() {
  const visibleConsoleGroups = consoleGroups
    .filter((group) => !group.contexts || group.contexts.includes(state.consoleContext))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.contexts || item.contexts.includes(state.consoleContext)),
    }))
    .filter((group) => group.items.length > 0)
  prototype.innerHTML = `${productTopbar('Console')}
    <div class="console-layout">
      <aside class="console-sidebar">
        <nav aria-label="Console navigation">
          ${visibleConsoleGroups
            .map(
              (group) => `<div class="nav-group">${group.label ? `<p>${group.label}</p>` : ''}${group.items
                .map((item) => {
                  const page = item.pages?.[state.consoleContext] ?? item.id
                  return `<button class="nav-item ${page === activeConsoleNav() ? 'is-active' : ''}" data-console-page="${page}" type="button">${icon(item.icon)}<span class="nav-label">${item.label}</span>${item.tier ? `<span class="nav-tier">${item.tier}</span>` : ''}</button>`
                })
                .join('')}</div>`,
            )
            .join('')}
        </nav>
        <div class="console-sidebar-footer">
          ${consoleUtilities.map((item) => `<button class="nav-item ${item.id === activeConsoleNav() ? 'is-active' : ''}" ${item.id ? `data-console-page="${item.id}"` : ''} type="button">${icon(item.icon)}<span class="nav-label">${item.label}</span></button>`).join('')}
        </div>
      </aside>
      <main class="console-main">${consolePage(state.consolePage)}</main>
    </div>`
  prototype.querySelector('[data-console-context]')?.addEventListener('change', (event) => {
    state.consoleContext = event.target.value
    state.consolePage = 'dashboard'
    renderConsole()
  })
  prototype.querySelectorAll('[data-console-page]').forEach((button) => {
    button.addEventListener('click', () => {
      state.consolePage = button.dataset.consolePage
      renderConsole()
    })
  })
  prototype.querySelectorAll('[data-console-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      state.consoleFilters[`${state.consoleContext}:${state.consolePage}:${select.dataset.consoleFilter}`] = select.value
      renderConsole()
    })
  })
  prototype.querySelector('[data-mobile-console-nav]')?.addEventListener('click', () => {
    prototype.querySelector('.console-sidebar')?.classList.toggle('is-mobile-open')
  })
  prototype.querySelectorAll('[data-route]').forEach((row) => {
    row.addEventListener('click', () => {
      state.consolePage = row.dataset.route
      if (row.dataset.resourceMode) {
        state.resourceMode = row.dataset.resourceMode
        state.detailTabs.resource = 'overview'
      }
      if (row.dataset.route === 'role-detail') state.detailTabs.role = 'overview'
      renderConsole()
    })
  })
  prototype.querySelectorAll('[data-detail-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const [group, tab] = button.dataset.detailTab.split(':')
      state.detailTabs[group] = tab
      renderConsole()
    })
  })
  const activeDetailTab = prototype.querySelector('.subtabs .is-active')
  if (activeDetailTab && activeDetailTab.parentElement.scrollWidth > activeDetailTab.parentElement.clientWidth) {
    activeDetailTab.parentElement.scrollLeft = Math.max(0, activeDetailTab.offsetLeft - 16)
  }
  prototype.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      state.consolePage = button.dataset.back
      renderConsole()
    })
  })
  prototype.querySelectorAll('[data-drawer]').forEach((button) => {
    button.addEventListener('click', () => openDrawer(button.dataset.drawer))
  })
  prototype.querySelectorAll('[data-open-organization-console]').forEach((button) => {
    button.addEventListener('click', () => {
      state.consoleContext = 'organization'
      state.consolePage = 'dashboard'
      renderConsole()
    })
  })
  prototype.querySelectorAll('[data-config-form]').forEach((form) => {
    const save = form.querySelector('.config-save')
    const discard = form.querySelector('.config-discard')
    const statusText = form.querySelector('.config-form-status')
    const markDirty = () => {
      save.disabled = false
      discard.disabled = false
      statusText.textContent = 'Unsaved changes'
      form.closest('.experience-editor')?.querySelector('.experience-preview-status')?.replaceChildren('Previewing unsaved changes')
    }
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      const update = () => {
        markDirty()
        updateExperiencePreview(control.closest('[data-preview-binding]'), control.value)
      }
      control.addEventListener('input', update)
      control.addEventListener('change', update)
    })
    form.querySelectorAll('.switch').forEach((control) => {
      control.addEventListener('click', () => {
        control.classList.toggle('on')
        control.closest('.config-control').querySelector('.config-state').textContent = control.classList.contains('on') ? 'Enabled' : 'Disabled'
        markDirty()
        updateExperiencePreview(control.closest('[data-preview-binding]'), control.classList.contains('on'))
      })
    })
    discard.addEventListener('click', () => renderConsole())
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      save.disabled = true
      discard.disabled = true
      statusText.textContent = 'All changes saved'
      form.closest('.experience-editor')?.querySelector('.experience-preview-status')?.replaceChildren('Saved version')
    })
  })
  prototype.querySelectorAll('[data-preview-navigate]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const preview = link.closest('.experience-preview')
      preview.querySelectorAll('[data-preview-panel]').forEach((panel) => { panel.hidden = panel.dataset.previewPanel !== link.dataset.previewNavigate })
    })
  })
}

function updateExperiencePreview(field, value) {
  const binding = field?.dataset.previewBinding
  const preview = field?.closest('.experience-editor')?.querySelector('.experience-preview')
  if (!binding || !preview) return
  if (binding === 'public-signup') preview.querySelector('[data-preview-signup-link]').hidden = !value
  if (binding === 'username-signin') preview.querySelector('[data-preview-identifier-label]').textContent = value ? 'Email or username' : 'Email'
  if (binding === 'product-name') preview.querySelectorAll('[data-preview-product]').forEach((element) => { element.textContent = value })
  if (binding === 'theme-preset') {
    const selected = field.querySelector('input:checked')
    const colors = selected?.dataset.themeColors?.split('|')
    field.querySelector('[data-custom-theme]').hidden = selected?.value !== 'custom'
    if (colors?.length === 5) {
      ;['--preview-brand', '--preview-bg', '--preview-surface', '--preview-text', '--preview-line'].forEach((token, index) => {
        preview.style.setProperty(token, colors[index])
      })
    }
  }
  const themeTokens = {
    'theme-primary': '--preview-brand',
    'theme-background': '--preview-bg',
    'theme-surface': '--preview-surface',
    'theme-text': '--preview-text',
    'theme-border': '--preview-line',
  }
  if (themeTokens[binding] && CSS.supports('color', value)) preview.style.setProperty(themeTokens[binding], value)
  if (binding.startsWith('method-')) {
    const method = binding.replace('method-', '')
    preview.querySelectorAll(`[data-preview-method="${method}"]`).forEach((element) => { element.hidden = !value })
    const alternatives = preview.querySelector('[data-preview-alt-methods]')
    alternatives.hidden = ![...alternatives.querySelectorAll('[data-preview-method]')].some((element) => !element.hidden)
  }
  if (['terms-url', 'privacy-url', 'support-url'].includes(binding)) preview.querySelector(`[data-preview-link="${binding.replace('-url', '')}"]`).href = value
  if (binding === 'logo-url') preview.querySelector('[data-preview-logo]').title = value
}

function activeConsoleNav() {
  const aliases = {
    'agent-detail': 'agents',
    'user-detail': 'users',
    'application-detail': 'applications',
    'organization-detail': 'organizations',
    'api-resource-detail': 'api-resources',
    'role-detail': 'roles',
  }
  return aliases[state.consolePage] ?? state.consolePage
}

function pageFrame({ section, title, description, action = '', tabs = '', content, tier = '' }) {
  return `<div class="page">
    <div class="breadcrumbs"><span>Console</span><span>/</span><span>${consoleContextName()}</span><span>/</span><span>${section}</span></div>
    <header class="page-header"><div><div class="page-title-line"><h1>${title}</h1>${tier ? `<span class="page-tier">${tier}</span>` : ''}</div><p>${description}</p></div>${action ? `<div class="page-actions">${action}</div>` : ''}</header>
    ${tabs}${content}
  </div>`
}

function button(label, options = {}) {
  const iconName = options.icon ?? null
  return `<button class="button ${options.variant ?? ''}" ${options.drawer ? `data-drawer="${options.drawer}"` : ''} type="button">${iconName ? icon(iconName) : ''}${label}</button>`
}

function searchToolbar(filters = [], action = '', showTableOptions = true) {
  return `<div class="toolbar"><div class="toolbar-group"><label class="search-wrap">${icon('search')}<input class="input" aria-label="Search" placeholder="Search" /></label>${filters
    .map((filter) => {
      const config = typeof filter === 'string' ? { label: filter, options: [filter], value: filter } : filter
      return `<select class="select" aria-label="${config.label}" ${config.key ? `data-console-filter="${config.key}"` : ''}>${config.options.map((option) => `<option ${option === config.value ? 'selected' : ''}>${option}</option>`).join('')}</select>`
    })
    .join('')}</div><div class="toolbar-actions">${action}${showTableOptions ? `<button class="icon-button" type="button" aria-label="Table options">${icon('more')}</button>` : ''}</div></div>`
}

function consoleFilterValue(key, defaultValue) {
  return state.consoleFilters[`${state.consoleContext}:${state.consolePage}:${key}`] ?? defaultValue
}

function ownerFilter() {
  const defaultValue = state.consoleContext === 'organization' ? 'Payments Team' : 'Any owner'
  return {
    key: 'owner',
    label: 'Owner',
    value: consoleFilterValue('owner', defaultValue),
    options: ['Any owner', 'Payments Team', 'Acme Platform', 'Family Archive', 'Jane Stone'],
  }
}

function organizationFilter() {
  const defaultValue = state.consoleContext === 'organization' ? 'Payments Team' : 'Any organization'
  return {
    key: 'organization',
    label: 'Organization',
    value: consoleFilterValue('organization', defaultValue),
    options: ['Any organization', 'Payments Team', 'Acme Platform', 'Family Archive'],
  }
}

function assignmentContextFilter() {
  return {
    key: 'assignment-context',
    label: 'Context',
    value: consoleFilterValue('assignment-context', state.consoleContext === 'organization' ? 'Payments Team' : 'Any context'),
    options: ['Any context', 'Realm-wide', 'Payments Team', 'Family Archive'],
  }
}

function status(label, tone = '') {
  return `<span class="status ${tone}">${label}</span>`
}

function dataTable(headers, rows) {
  return `<div class="data-table"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows
    .map(
      (row) => `<tr ${row.route ? `data-route="${row.route}" tabindex="0"` : ''}${row.resourceMode ? ` data-resource-mode="${row.resourceMode}"` : ''}>${row.cells
        .map((cell) => `<td>${cell}</td>`)
        .join('')}</tr>`,
    )
    .join('')}</tbody></table></div>`
}

function cell(title, meta) {
  return `<div class="cell-title"><strong>${title}</strong>${meta ? `<span>${meta}</span>` : ''}</div>`
}

function settingRow(label, description, value, control = '') {
  return `<div class="setting-row"><div class="setting-label"><strong>${label}</strong>${description ? `<span>${description}</span>` : ''}</div><div class="setting-value">${value}</div><div class="setting-control">${control}</div></div>`
}

function settingsCard(title, description, rows) {
  return `<section class="settings-card"><header><h2>${title}</h2><p>${description}</p></header>${rows.join('')}</section>`
}

function switchControl(on = true, label = 'setting') {
  return `<button class="switch ${on ? 'on' : ''}" type="button" aria-label="Toggle ${label}"></button>`
}

function configToggle(label, description, on = true, binding = '') {
  return `<div class="config-field" ${binding ? `data-preview-binding="${binding}"` : ''}><div class="config-field-copy"><strong>${label}</strong>${description ? `<span>${description}</span>` : ''}</div><div class="config-control"><span class="config-state">${on ? 'Enabled' : 'Disabled'}</span>${switchControl(on, label)}</div></div>`
}

function configInput(label, description, value, type = 'text', multiline = false, binding = '') {
  const id = `config-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  const control = multiline
    ? `<textarea id="${id}" rows="4">${value}</textarea>`
    : `<input id="${id}" type="${type}" value="${value}">`
  return `<div class="config-field" ${binding ? `data-preview-binding="${binding}"` : ''}><label class="config-field-copy" for="${id}"><strong>${label}</strong>${description ? `<span>${description}</span>` : ''}</label><div class="config-control config-control-wide">${control}</div></div>`
}

function configSelect(label, description, value, options) {
  const id = `config-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  return `<div class="config-field"><label class="config-field-copy" for="${id}"><strong>${label}</strong>${description ? `<span>${description}</span>` : ''}</label><div class="config-control config-control-wide"><select id="${id}">${options.map((option) => `<option ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select></div></div>`
}

function configValue(label, description, value, action = '') {
  return `<div class="config-field"><div class="config-field-copy"><strong>${label}</strong>${description ? `<span>${description}</span>` : ''}</div><div class="config-control config-value-control"><span>${value}</span>${action}</div></div>`
}

function themeOption(value, label, description, colors, checked = false) {
  return `<label class="theme-option"><input type="radio" name="color-scheme" value="${value}" data-theme-colors="${colors.join('|')}" ${checked ? 'checked' : ''}><span class="theme-swatches" aria-hidden="true">${colors.map((color) => `<i style="background:${color}"></i>`).join('')}</span><strong>${label}</strong><small>${description}</small></label>`
}

function themePicker() {
  const aqua = ['#007B83', '#F3F8F8', '#FFFFFF', '#162427', '#DDE5E5']
  return `<div class="theme-picker-field" data-preview-binding="theme-preset"><div class="theme-options">
    ${themeOption('clear-aqua', 'Clear Aqua', 'Crisp, technical, and calm.', aqua, true)}
    ${themeOption('sage', 'Sage', 'Natural, grounded, and quiet.', ['#4F7259', '#F5F8F4', '#FFFFFF', '#1E2920', '#DDE6DD'])}
    ${themeOption('indigo', 'Indigo', 'Confident with a cooler edge.', ['#4F5FBF', '#F5F6FC', '#FFFFFF', '#1C2340', '#DDE0EF'])}
    ${themeOption('custom', 'Custom', 'Tune the core semantic colors.', aqua)}
  </div><div class="custom-theme-fields" data-custom-theme hidden>
    ${configInput('Primary', 'Actions, links, and focus states.', aqua[0], 'text', false, 'theme-primary')}
    ${configInput('Page background', 'The canvas behind hosted content.', aqua[1], 'text', false, 'theme-background')}
    ${configInput('Surface', 'Authentication and consent surfaces.', aqua[2], 'text', false, 'theme-surface')}
    ${configInput('Text', 'Primary content and headings.', aqua[3], 'text', false, 'theme-text')}
    ${configInput('Border', 'Fields, dividers, and boundaries.', aqua[4], 'text', false, 'theme-border')}
  </div></div>`
}

function configForm(sections) {
  return `<form class="config-form" data-config-form>${sections.map(([title, description, fields]) => `<section class="config-section ${title || description ? '' : 'config-section-plain'}">${title || description ? `<header>${title ? `<h2>${title}</h2>` : ''}${description ? `<p>${description}</p>` : ''}</header>` : ''}<div class="config-fields">${fields.join('')}</div></section>`).join('')}<footer class="config-form-footer"><span class="config-form-status" aria-live="polite">All changes saved</span><div><button class="button config-discard" disabled type="button">Discard</button><button class="button primary config-save" disabled type="submit">Save changes</button></div></footer></form>`
}

function experienceEditor(form) {
  return `<div class="experience-editor">${form}${experiencePreview()}</div>`
}

function experiencePreview() {
  return `<aside class="experience-preview" style="--preview-brand:#007B83;--preview-bg:#F3F8F8;--preview-surface:#FFFFFF;--preview-text:#162427;--preview-line:#DDE5E5"><header><div><strong>Live preview</strong><span class="experience-preview-status">Saved version</span></div></header><div class="experience-preview-canvas"><div class="preview-auth"><div class="preview-brand"><span data-preview-logo>A</span><strong data-preview-product>Acme Identity</strong></div><section data-preview-panel="sign-in"><h3>Sign in to <span data-preview-product>Acme Identity</span></h3><p>Use your Acme identity to continue.</p><label data-preview-identifier-label>Email or username</label><i>jane@acme.dev</i><div class="preview-password" data-preview-method="password"><label>Password</label><i>••••••••••</i><a class="preview-task-link" data-preview-navigate="recovery" href="#">Forgot password?</a><button type="button">Sign in</button></div><div class="preview-methods" data-preview-alt-methods><span>Other sign-in methods</span><button data-preview-method="passkey" type="button">Continue with passkey</button><button data-preview-method="email-code" type="button">Continue with email code</button><button data-preview-method="social" type="button">Continue with Google</button><button data-preview-method="social" type="button">Continue with GitHub Enterprise</button></div><small data-preview-signup-link>No account yet? <a data-preview-navigate="sign-up" href="#">Create account</a></small></section><section data-preview-panel="sign-up" hidden><h3>Create your <span data-preview-product>Acme Identity</span> account</h3><p>Create your Acme identity.</p><label>Email</label><i>jane@acme.dev</i><label>Password</label><i>••••••••••</i><button type="button">Create account</button><small>Already have an account? <a data-preview-navigate="sign-in" href="#">Sign in</a></small></section><section data-preview-panel="recovery" hidden><h3>Recover your account</h3><p>Recover access to your Acme identity.</p><label>Email</label><i>jane@acme.dev</i><button type="button">Continue</button><small><a data-preview-navigate="sign-in" href="#">Back to sign in</a></small></section><footer><a data-preview-link="privacy" href="https://realmroot.dev/privacy">Privacy</a><a data-preview-link="terms" href="https://realmroot.dev/terms">Terms</a><a data-preview-link="support" href="https://realmroot.dev/support">Support</a></footer></div></div></aside>`
}

function detailTabs(group, active, tabs) {
  return `<div class="subtabs" role="tablist">${tabs
    .map(([id, label, tier]) => `<button class="${id === active ? 'is-active' : ''}" data-detail-tab="${group}:${id}" role="tab" aria-selected="${id === active}" type="button">${label}${tier ? `<span class="tab-tier">${tier}</span>` : ''}</button>`)
    .join('')}</div>`
}

function consolePage(id) {
  const pages = {
    dashboard: renderDashboard,
    users: renderUsers,
    organizations: renderOrganizations,
    agents: renderAgents,
    applications: renderApplications,
    'sign-in-experience': renderSignInSettings,
    branding: renderHostedExperience,
    connectors: renderConnectors,
    'api-resources': renderApiResources,
    roles: renderRoles,
    'role-assignments': renderRoleAssignments,
    security: renderSecurity,
    webhooks: renderWebhooks,
    'realm-settings': renderRealmSettings,
    'organization-settings': renderOrganizationSettings,
    'agent-detail': renderAgentDetail,
    'user-detail': renderUserDetail,
    'application-detail': renderApplicationDetail,
    'organization-detail': renderOrganizationDetail,
    'api-resource-detail': renderApiResourceDetail,
    'role-detail': renderRoleDetail,
  }
  return (pages[id] ?? renderDashboard)()
}

function renderDashboard() {
  if (state.consoleContext === 'organization') {
    return pageFrame({
      section: 'Dashboard',
      title: 'Payments Team',
      description: 'Manage the identities, applications, APIs, and authority associated with this Organization.',
      content: `<div class="metric-grid">
        <article class="metric"><span>Members</span><strong>12</strong><small>3 Owners or Administrators</small></article>
        <article class="metric"><span>Applications</span><strong>4</strong><small>3 available to all Realm users</small></article>
        <article class="metric"><span>Resource servers</span><strong>3</strong><small>8 published scopes</small></article>
      </div>
      <div class="dashboard-grid">
        <article class="panel"><div class="panel-header"><div><h2>Organization activity</h2><p>Changes to resources and authority</p></div><a class="auth-link" href="#">View all →</a></div><ul class="attention-list">
          <li><i class="row-icon">${icon('app')}</i>${cell('Expense Portal audience updated', 'All Realm users · 18 min ago')}<button class="icon-button">${icon('more')}</button></li>
          <li><i class="row-icon">${icon('key')}</i>${cell('Billing API contract validated', '8 scopes · 2 hours ago')}<button class="icon-button">${icon('more')}</button></li>
          <li><i class="row-icon">${icon('role')}</i>${cell('Finance operator assigned', 'Morgan Lee · Yesterday')}<button class="icon-button">${icon('more')}</button></li>
        </ul></article>
        <article class="panel"><div class="panel-header"><div><h2>Needs attention</h2><p>Organization configuration and access</p></div></div><ul class="attention-list">
          <li><i class="row-icon">${icon('users')}</i>${cell('Member invitation pending', 'alex@acme.dev · expires in 3 days')}<button class="icon-button">${icon('more')}</button></li>
          <li><i class="row-icon">${icon('bot')}</i>${cell('Agent access request', 'Billing Reconciler · 6 min ago')}<button class="icon-button">${icon('more')}</button></li>
        </ul></article>
      </div>`,
    })
  }
  return pageFrame({
    section: 'Dashboard',
    title: 'Dashboard',
    description: 'Get an overview about your identity service performance.',
    content: `<div class="metric-grid">
      <article class="metric"><span>Total users</span><strong>1,284</strong><small>Tenant identities available to hosted auth.</small></article>
      <article class="metric"><span>New users today</span><strong>18</strong><small><b>+8.2%</b> from yesterday</small></article>
      <article class="metric"><span>New users past 7 days</span><strong>126</strong><small>Users created in the past seven days.</small></article>
    </div>
    <div class="dashboard-grid">
      <article class="panel"><div class="panel-header"><div><h2>Daily active users</h2><p>Identity activity over the last 30 days</p></div>${button('30 days')}</div><div class="chart"><svg viewBox="0 0 640 200" preserveAspectRatio="none"><path class="area" d="M0 165 C60 148 75 120 130 128 S210 104 258 116 S330 73 382 90 S458 55 500 66 S565 31 640 44 L640 200 L0 200Z"/><path class="line" d="M0 165 C60 148 75 120 130 128 S210 104 258 116 S330 73 382 90 S458 55 500 66 S565 31 640 44"/></svg></div></article>
      <article class="panel"><div class="panel-header"><div><h2>Needs attention</h2><p>Security and authorization work</p></div><a class="auth-link" href="#">View all →</a></div><ul class="attention-list">
        <li><i class="row-icon">${icon('bot')}</i>${cell('Agent access request', 'Sales Copilot · 6 min ago')}<button class="icon-button">${icon('more')}</button></li>
        <li><i class="row-icon">${icon('key')}</i>${cell('Credential expires soon', 'Billing API · 2 days')}<button class="icon-button">${icon('more')}</button></li>
        <li><i class="row-icon">${icon('shield')}</i>${cell('MFA policy draft', 'Not yet enforced')}<button class="icon-button">${icon('more')}</button></li>
      </ul></article>
    </div>`,
  })
}

function renderUsers() {
  const selectedOrganization = consoleFilterValue('organization', state.consoleContext === 'organization' ? 'Payments Team' : 'Any organization')
  const rows = [
    { organizations: ['Payments Team', 'Acme Platform'], cells: [cell('Jane Stone', 'usr_01J8K4'), 'Realm administrator', cell('jane@acme.dev', 'Verified'), 'Payments Team · Acme Platform', 'Jul 24, 2026', status('Active'), icon('arrow')], route: 'user-detail' },
    { organizations: ['Payments Team'], cells: [cell('Marcus Chen', 'usr_01J8H2'), 'User', cell('marcus@acme.dev', 'Verified'), 'Payments Team', 'Jul 20, 2026', status('Active'), icon('more')] },
    { organizations: ['Family Archive'], cells: [cell('Priya Shah', 'usr_01J7Z9'), 'User', cell('priya@acme.dev', 'Unverified'), 'Family Archive', 'Jul 18, 2026', status('Active'), icon('more')] },
    { organizations: [], cells: [cell('Test Account', 'usr_01J6W1'), 'User', cell('test@acme.dev', 'Verified'), '—', 'Jul 02, 2026', status('Banned', 'danger'), icon('more')] },
  ]
  const visibleRows = selectedOrganization === 'Any organization' ? rows : rows.filter((row) => row.organizations.includes(selectedOrganization))
  return pageFrame({
    section: 'Identity / Users',
    title: 'Users',
    description: 'Manage the human identities that sign in, join organizations, and delegate authority.',
    action: button('New user', { variant: 'primary', icon: 'plus', drawer: 'New user' }),
    content: `${searchToolbar([organizationFilter(), 'Any realm access', 'Any status'])}${dataTable(
      ['User', 'Realm access', 'Email', 'Organizations', 'Created', 'Status', ''],
      visibleRows,
    )}`,
  })
}

function renderOrganizations() {
  return pageFrame({
    section: 'Identity / Organizations',
    title: 'Organizations',
    description: 'Review shared identity spaces, membership scale, ownership, and lifecycle across this Realm.',
    action: button('Provision organization', { variant: 'primary', icon: 'plus', drawer: 'New organization' }),
    content: `${searchToolbar(['Any creation source', 'Any status'])}${dataTable(
      ['Organization', 'Members', 'Agents', 'Apps & resource servers', 'Created by', 'Status', ''],
      [
        { cells: [cell('Acme Platform', 'org_system'), '4', '2', '6 apps · 5 resource servers', 'First admin bootstrap', status('Active'), icon('more')] },
        { route: 'organization-detail', cells: [cell('Payments Team', 'org_01J8A2'), '12', '3', '4 apps · 3 resource servers', 'Jane Stone · self-service', status('Active'), icon('arrow')] },
        { cells: [cell('Family Archive', 'org_01J6B8'), '5', '0', '—', 'Priya Shah · self-service', status('Active'), icon('more')] },
      ],
    )}`,
  })
}

function renderAgents() {
  const selectedOwner = consoleFilterValue('owner', state.consoleContext === 'organization' ? 'Payments Team' : 'Any owner')
  const rows = [
    { owner: 'Payments Team', route: 'agent-detail', cells: [cell('Billing Reconciler', 'did:rr:agent:01J7…K8'), 'Finance operator', '1', status('Active'), 'Organization', 'Payments Team', '6 min ago', icon('arrow')] },
    { owner: 'Jane Stone', cells: [cell('Sales Copilot', 'did:rr:agent:01J8…A2'), '—', '3', status('Active'), 'User', 'Jane Stone', '12 min ago', icon('more')] },
    { owner: 'Payments Team', cells: [cell('Legacy Billing Bot', 'did:rr:agent:01J5…Q3'), '—', '0', status('Inactive', 'neutral'), 'Organization', 'Payments Team', 'Jul 12, 2026', icon('more')] },
  ]
  const visibleRows = selectedOwner === 'Any owner' ? rows : rows.filter((row) => row.owner === selectedOwner)
  return pageFrame({
    section: 'Identity / Agents',
    title: 'Agents',
    description: 'Review stable Agent identities belonging to people and Organizations across this Realm.',
    content: `${searchToolbar(['Any owner type', ownerFilter(), 'Any status'])}${dataTable(
      ['Agent', 'Roles', 'Access grants', 'Status', 'Owner type', 'Owner', 'Last activity', ''],
      visibleRows,
    )}`,
  })
}

function renderApplications() {
  const selectedOwner = consoleFilterValue('owner', state.consoleContext === 'organization' ? 'Payments Team' : 'Any owner')
  const rows = [
    { owner: 'Payments Team', route: 'application-detail', cells: [cell('Expense Portal', 'expense_web_01'), 'Web application', 'All Realm users', status('Enabled'), 'Payments Team', icon('arrow')] },
    { owner: 'Acme Platform', cells: [cell('Acme Storefront', 'storefront_web'), 'Web application', 'All Realm users', status('Enabled'), 'Acme Platform', icon('more')] },
    { owner: 'Payments Team', cells: [cell('Payments CLI', 'payments_cli'), 'Native application', 'Selected Organizations', status('Enabled'), 'Payments Team', icon('more')] },
    { owner: 'Payments Team', cells: [cell('Billing Worker', 'billing_worker'), 'Machine-to-machine', 'Payments Team only', status('Enabled'), 'Payments Team', icon('more')] },
  ]
  const visibleRows = selectedOwner === 'Any owner' ? rows : rows.filter((row) => row.owner === selectedOwner)
  return pageFrame({
    section: 'Develop / Applications',
    title: 'Applications',
    description: 'Review every client registered in this Realm, its owner, and who may use it.',
    action: button('New application', { variant: 'primary', icon: 'plus', drawer: 'New application' }),
    content: `${searchToolbar([ownerFilter(), 'Any type', 'Any audience'])}${dataTable(
      ['Application', 'Type', 'Audience', 'Status', 'Owner', ''],
      visibleRows,
    )}`,
  })
}

function renderSignInSettings() {
  const content = experienceEditor(configForm([
    ['Registration and identifiers', 'Control account creation and accepted sign-in identifiers.', [
      configToggle('Public sign-up', 'Allow people to create an account without an invitation.', true, 'public-signup'),
      configToggle('Username sign-in', 'Allow a username in addition to verified email.', true, 'username-signin'),
    ]],
    ['Available sign-in methods', 'Choose which configured connectors appear on hosted sign-in.', [
      configToggle('Password', 'Use the built-in credential connector.', true, 'method-password'),
      configToggle('Passkey', 'Offer passwordless WebAuthn sign-in.', true, 'method-passkey'),
      configToggle('Email code', 'Send a one-time code to a verified email address.', true, 'method-email-code'),
      configToggle('Social login', 'Show every enabled social and workforce connector.', true, 'method-social'),
    ]],
  ]))
  return pageFrame({
    section: 'Authentication / Sign-in & registration',
    title: 'Sign-in & registration',
    description: 'Control who can create an account and which configured methods appear at sign-in.',
    content,
  })
}

function renderHostedExperience() {
  const active = state.detailTabs.branding
  const tabs = detailTabs('branding', active, [
    ['theme', 'Color scheme', 'Pro'],
    ['assets', 'Brand assets', 'Pro'],
    ['legal', 'Legal & support'],
  ])
  const bodies = {
    theme: experienceEditor(configForm([['Color scheme', 'Choose a tested scheme or create a custom theme.', [
      themePicker(),
    ]]])),
    assets: experienceEditor(configForm([['Brand assets', 'Identity shown across sign-in, consent, and Account Center.', [
      configInput('Product name', '', 'Acme Identity', 'text', false, 'product-name'),
      configInput('Logo URL', 'Square SVG or PNG over HTTPS.', 'https://acme.dev/identity.svg', 'url', false, 'logo-url'),
      configInput('Favicon URL', '', 'https://acme.dev/favicon.svg', 'url', false, 'favicon-url'),
    ]]])),
    legal: experienceEditor(configForm([['Legal & support', 'Set the footer destinations shared by Realmroot-hosted pages.', [
      configInput('Terms URL', '', 'https://realmroot.dev/terms', 'url', false, 'terms-url'),
      configInput('Privacy URL', '', 'https://realmroot.dev/privacy', 'url', false, 'privacy-url'),
      configInput('Support URL', '', 'https://realmroot.dev/support', 'url', false, 'support-url'),
    ]]])),
  }
  return pageFrame({
    section: 'Experience / Hosted experience',
    title: 'Hosted experience',
    description: 'Shape the visual identity and trusted destinations shared by Realmroot-hosted pages.',
    tabs,
    content: bodies[active],
  })
}

function renderConnectors() {
  const active = state.detailTabs.connectors
  const tabs = detailTabs('connectors', active, [
    ['methods', 'Builtin connectors'],
    ['oidc', 'OIDC connectors'],
  ])
  const bodies = {
    methods: dataTable(
      ['Provider', 'Type', 'Configuration', 'Status', ''],
      [
        { cells: [cell('Email and password', 'credential'), 'Credential', 'Tenant policy', status('Enabled'), icon('more')] },
        { cells: [cell('Email code', 'email-code'), 'One-time code', 'Tenant policy', status('Enabled'), icon('more')] },
        { cells: [cell('Passkey', 'passkey'), 'WebAuthn', 'RP ID · identity.acme.dev', status('Enabled'), button('Configure', { variant: 'ghost', drawer: 'Configure Passkey' })] },
        { cells: [cell('Google', 'google'), 'OAuth', 'Client configured', status('Enabled'), icon('more')] },
        { cells: [cell('Phone', 'phone'), 'OTP', 'Provider required', status('Disabled', 'neutral'), icon('more')] },
        { cells: [cell('Web3 wallet', 'siwe'), 'SIWE', 'Chains 1, 137', status('Disabled', 'neutral'), icon('more')] },
      ],
    ),
    oidc: dataTable(
      ['Name', 'Issuer', 'Client ID', 'Login', 'Status'],
      [
        { cells: [cell('GitHub Enterprise', 'github-enterprise'), 'https://github.acme.dev', '<span class="mono">realmroot-prod</span>', 'Enabled', status('Ready')] },
        { cells: [cell('Billing Cloud', 'billing-cloud'), 'https://auth.billing.dev', '<span class="mono">rr_billing</span>', 'Disabled', status('Ready')] },
      ],
    ),
  }
  return pageFrame({
    section: 'Authentication / Identity providers',
    title: 'Identity providers',
    description: 'Connect the external identity systems people can use to enter this realm.',
    action: active === 'oidc' ? button('Add OIDC connector', { variant: 'primary', icon: 'plus', drawer: 'Add OIDC connector' }) : '',
    tabs,
    content: bodies[active],
  })
}

function renderApiResources() {
  const selectedOwner = consoleFilterValue('owner', state.consoleContext === 'organization' ? 'Payments Team' : 'Any owner')
  const rows = [
    { owner: 'Payments Team', route: 'api-resource-detail', resourceMode: 'native', cells: [cell('Billing API', 'api_01J8B2'), 'Native', 'Realm-wide', status('Enabled'), 'Payments Team', icon('arrow')] },
    { owner: 'Payments Team', route: 'api-resource-detail', resourceMode: 'external', cells: [cell('CRM API', 'api_01J7C4'), 'External · CRM Cloud', 'Payments Team only', status('Enabled'), 'Payments Team', icon('arrow')] },
    { owner: 'Acme Platform', cells: [cell('Customer API', 'api_01J6D7'), 'Native', 'Realm-wide', status('Enabled'), 'Acme Platform', icon('more')] },
    { owner: 'Payments Team', cells: [cell('Legacy Documents', 'api_01J5L9'), 'Native', 'Selected Organizations', status('Draft', 'neutral'), 'Payments Team', icon('more')] },
  ]
  const visibleRows = selectedOwner === 'Any owner' ? rows : rows.filter((row) => row.owner === selectedOwner)
  return pageFrame({
    section: 'Develop / Resource servers',
    title: 'Resource servers',
    description: 'Review protected APIs across the Realm, who may request access, and who manages them.',
    action: button('New resource server', { variant: 'primary', icon: 'plus', drawer: 'New resource server' }),
    content: `${searchToolbar([ownerFilter(), 'Any access eligibility', 'Any authorization'])}${dataTable(
      ['Resource server', 'Authorization', 'Access eligibility', 'Status', 'Owner', ''],
      visibleRows,
    )}`,
  })
}

function renderRoles() {
  return pageFrame({
    section: 'Authorization / Roles',
    title: 'Roles',
    description: 'Define reusable permission sets and review how they are assigned across this Realm.',
    action: button('New role', { variant: 'primary', icon: 'plus', drawer: 'New role' }),
    content: `${searchToolbar(['Any resource server'])}${dataTable(
      ['Role', 'Permissions', 'Assignments', 'Updated', ''],
      [
        { route: 'role-detail', cells: [cell('Finance operator', 'finance.operator'), '3 scopes · 2 resource servers', '8 assignments · 3 contexts', 'Jul 29, 2026', icon('arrow')] },
        { cells: [cell('Support operator', 'support.operator'), '4 scopes · 2 resource servers', '6 assignments · Realm-wide', 'Jul 28, 2026', icon('more')] },
        { cells: [cell('Archive contributor', 'archive.contributor'), '2 scopes · 1 resource server', '4 assignments · 2 contexts', 'Jul 22, 2026', icon('more')] },
      ],
    )}`,
  })
}

function renderRoleAssignments() {
  const selectedContext = consoleFilterValue('assignment-context', state.consoleContext === 'organization' ? 'Payments Team' : 'Any context')
  const rows = [
    { context: 'Payments Team', cells: [cell('Morgan Lee', 'usr_01J7M8'), cell('Finance operator', 'finance.operator'), 'Payments Team', 'Never', status('Active'), 'Jane Stone', 'Jul 29, 2026', icon('more')] },
    { context: 'Payments Team', cells: [cell('Billing Reconciler', 'did:rr:agent:01J7…P8'), cell('Finance operator', 'finance.operator'), 'Payments Team', 'Aug 31, 2026', status('Active'), 'Jane Stone', 'Jul 24, 2026', icon('more')] },
    { context: 'Realm-wide', cells: [cell('Jane Stone', 'usr_01J8K4'), cell('Support operator', 'support.operator'), 'Realm-wide', 'Never', status('Active'), 'Sam Rivera', 'Jul 23, 2026', icon('more')] },
    { context: 'Realm-wide', cells: [cell('Billing Worker', 'billing_worker'), cell('Finance operator', 'finance.operator'), 'Realm-wide', 'Never', status('Active'), 'Morgan Lee', 'Jul 22, 2026', icon('more')] },
    { context: 'Family Archive', cells: [cell('Priya Shah', 'usr_01J7Z9'), cell('Archive contributor', 'archive.contributor'), 'Family Archive', 'Never', status('Active'), 'Jane Stone', 'Jul 18, 2026', icon('more')] },
  ]
  const visibleRows = selectedContext === 'Any context' ? rows : rows.filter((row) => row.context === selectedContext)
  return pageFrame({
    section: 'Authorization / Role assignments',
    title: 'Role assignments',
    description: 'Review who holds each Role, where it applies, and when that authority expires.',
    action: button('Assign role', { variant: 'primary', icon: 'plus', drawer: 'Assign role' }),
    content: `${searchToolbar(['Any role', 'Any subject type', assignmentContextFilter(), 'Any status'])}${dataTable(
      ['Subject', 'Role', 'Context', 'Expires', 'Status', 'Assigned by', 'Updated', ''],
      visibleRows,
    )}`,
  })
}

function renderSecurity() {
  const active = state.detailTabs.security
  const tabs = detailTabs('security', active, [['sign-in', 'Sign-in security'], ['mfa', 'MFA'], ['abuse', 'Abuse prevention']])
  const content = {
    'sign-in': configForm([
      ['Password protection', 'Apply a small set of protections to every password credential.', [
        configSelect('Minimum length', '', '12 characters', ['8 characters', '10 characters', '12 characters', '16 characters']),
        configToggle('Block compromised passwords', 'Reject passwords found in known breach datasets.'),
      ]],
      ['Session security', 'Control session duration and when fresh authentication is required.', [
        configSelect('Session lifetime', '', '7 days', ['1 day', '7 days', '14 days', '30 days']),
        configSelect('Session renewal interval', 'Refresh active session state at this interval.', '24 hours', ['1 hour', '12 hours', '24 hours', '7 days']),
        configSelect('Fresh authentication window', 'Require a recent sign-in before sensitive actions.', '24 hours', ['Every time', '1 hour', '12 hours', '24 hours']),
        configSelect('Session cache duration', 'Cache encrypted session state at the edge.', '5 minutes', ['1 minute', '5 minutes', '15 minutes']),
        configToggle('Revoke sessions after password reset', 'End existing sessions when a password is recovered or reset.'),
      ]],
      ['Identity verification', 'Decide when an email address becomes trusted identity data.', [
        configToggle('Require verified email', 'Do not release email claims until verification is complete.'),
      ]],
      ['Sign-in notifications', 'Warn people about unusual activity on their account.', [
        configToggle('Suspicious sign-in notifications', 'Notify people when a sign-in has unusual device or location signals.'),
      ]],
    ]),
    mfa: configForm([
      ['Enforcement', 'Define who must enroll and when another factor is required.', [
        configSelect('Requirement', '', 'Required for administrators', ['Optional', 'Required for administrators', 'Required for everyone']),
        configSelect('Trusted device duration', 'Skip repeat challenges on a trusted browser.', '30 days', ['Never', '7 days', '30 days', '90 days']),
      ]],
    ['Available factors', 'Choose the strong authentication and recovery factors people can enroll.', [
      configToggle('Passkeys', 'Allow configured WebAuthn credentials to satisfy strong authentication.'),
      configToggle('Authenticator app', 'Allow time-based one-time codes.'),
      configToggle('Recovery codes', 'Issue single-use codes when a factor is enrolled.'),
    ]],
    ]),
    abuse: configForm([
      ['Challenge policy', 'Choose when Realmroot requests human verification.', [
        configToggle('Adaptive challenges', 'Challenge risky sign-up, sign-in, and recovery attempts.'),
        configSelect('Default provider', 'Used when a hosted flow requires verification.', 'Cloudflare Turnstile', ['Cloudflare Turnstile', 'hCaptcha', 'reCAPTCHA Enterprise']),
        configSelect('Provider failure behavior', 'Choose how authentication behaves when verification is unavailable.', 'Fail closed', ['Fail closed', 'Allow low-risk requests']),
      ]],
      ['Verification providers', 'Store multiple Provider configurations and choose the active default above.', [
        configValue('Cloudflare Turnstile', 'Site key 0x4AAAAAAA…', status('Ready'), button('Manage', { variant: 'ghost', drawer: 'Configure Turnstile' })),
        configValue('hCaptcha', 'No credentials stored.', status('Not configured', 'neutral'), button('Add', { variant: 'ghost', drawer: 'Configure hCaptcha' })),
        configValue('reCAPTCHA Enterprise', 'No credentials stored.', status('Not configured', 'neutral'), button('Add', { variant: 'ghost', drawer: 'Configure reCAPTCHA Enterprise' })),
      ]],
      ['Registration restrictions', 'Reduce low-quality or unwanted account creation.', [
        configToggle('Block disposable email domains', 'Reject addresses from known temporary email services.'),
        configValue('Blocked domains', 'Additional domains maintained by this realm.', '3 domains', button('Manage', { variant: 'ghost', drawer: 'Manage blocked domains' })),
      ]],
    ]),
  }
  return pageFrame({ section: 'Authentication / Security policies', title: 'Security policies', description: 'Set the protections that guard identity, sessions, and hosted authentication.', tabs, content: content[active] })
}

function renderWebhooks() {
  const active = state.detailTabs.webhooks
  const organizationContext = state.consoleContext === 'organization'
  const tabs = detailTabs('webhooks', active, [['endpoints', 'Endpoints'], ['requests', 'Requests']])
  const endpointRows = organizationContext
    ? [
        { cells: [cell('Organization changes', 'webhook_01J8W2'), 'https://hooks.acme.dev/payments', 'member.*, role.*, application.*', status('Enabled'), '••••••••', icon('more')] },
        { cells: [cell('API governance', 'webhook_01J7G5'), 'https://siem.acme.dev/payments', 'api.*, grant.*', status('Enabled'), '••••••••', icon('more')] },
      ]
    : [
        { cells: [cell('Identity events', 'webhook_01J8I3'), 'https://hooks.acme.dev/identity', 'user.created, user.updated', status('Enabled'), '••••••••', icon('more')] },
        { cells: [cell('Security audit', 'webhook_01J7S9'), 'https://siem.acme.dev/realmroot', 'session.*, organization.*', status('Enabled'), '••••••••', icon('more')] },
      ]
  const requestRows = organizationContext
    ? [
        { cells: [cell('role.assignment.created', 'req_01J8'), 'Organization changes', '204', 'Jul 31, 10:42', status('Delivered')] },
        { cells: [cell('resource.access_eligibility.updated', 'req_01J7'), 'API governance', '202', 'Jul 31, 10:38', status('Delivered')] },
      ]
    : [
        { cells: [cell('user.created', 'req_01J8'), 'Identity events', '204', 'Jul 31, 10:42', status('Delivered')] },
        { cells: [cell('organization.created', 'req_01J7'), 'Security audit', '202', 'Jul 31, 10:38', status('Delivered')] },
        { cells: [cell('session.revoked', 'req_01J6'), 'Security audit', '503', 'Jul 31, 09:16', status('Failed', 'danger')] },
      ]
  return pageFrame({
    section: 'Develop / Webhooks',
    title: 'Webhooks',
    description: `Send signed ${organizationContext ? 'Organization' : 'Realm'} events to downstream systems and inspect each delivery attempt.`,
    action: button('Create endpoint', { variant: 'primary', icon: 'plus', drawer: 'Create webhook endpoint' }),
    tabs,
    content: `${searchToolbar(['Any status'])}${active === 'endpoints' ? dataTable(['Endpoint', 'Destination', 'Events', 'Status', 'Secret', ''], endpointRows) : dataTable(['Event', 'Endpoint', 'HTTP status', 'Time', 'Status'], requestRows)}`,
  })
}

function renderRealmSettings() {
  const active = state.detailTabs.realmSettings
  const tabs = detailTabs('realmSettings', active, [
    ['general', 'General'],
    ['email', 'Email delivery'],
    ['developer', 'Developer'],
    ['deployment', 'Deployment'],
  ])
  const content = {
    general: configForm([
      ['Realm URL', 'Define the canonical public origin for this realm.', [
        configInput('Public realm URL', 'Used by discovery, callbacks, and hosted authentication.', 'https://identity.acme.dev', 'url'),
        configValue('Issuer path', 'Stable protocol path appended to the public realm URL.', '<span class="mono">/api/auth</span>'),
      ]],
      ['Browser trust', 'Control which browser origins may call Realmroot directly.', [
        configValue('Trusted origins', 'Exact origins; wildcards are not accepted.', '2 origins', button('Manage', { variant: 'ghost', drawer: 'Manage trusted origins' })),
      ]],
      ['Organization creation', 'Control who may create an Organization. Account Center visibility is derived from memberships, invitations, and this permission.', [
        configSelect('Organization creation', 'Choose who may create a new Organization. This does not grant Console access.', 'Any verified user', ['Realm administrators only', 'Approved users', 'Any verified user']),
      ]],
    ]),
    developer: configForm([
      ['', '', [
        configSelect('Console access', 'Choose which Organization members may register and manage technical resources.', 'Selected organizations', ['Realm operators only', 'Selected organizations', 'All organizations']),
        configSelect('Eligible access levels', 'Members must also hold one of these Organization access levels.', 'Owner, Admin, Developer', ['Owner only', 'Owner and Admin', 'Owner, Admin, Developer']),
        configValue('Included organizations', 'Used only when Console access is set to Selected organizations.', '1 of 3 organizations', button('Manage', { variant: 'ghost', drawer: 'Choose organizations' })),
      ]],
    ]),
    email: configForm([['Sender identity', 'Configure the sender shown on verification, recovery, and security email.', [
      configInput('From address', '', 'noreply@acme.dev', 'email'),
      configInput('From name', '', 'Acme Identity'),
      configInput('Reply-to address', 'Optional address for user replies.', 'support@acme.dev', 'email'),
      configSelect('Default locale', '', 'English (United States)', ['English (United States)', '简体中文', '日本語']),
    ]]]),
    deployment: `<div class="runtime-settings"><section class="config-section"><header><h2>Runtime</h2><p>Identify the code and infrastructure serving this realm.</p></header><div class="config-fields">
      ${configValue('Platform', '', 'Cloudflare Workers')}
      ${configValue('Database', '', 'Cloudflare D1')}
      ${configValue('Environment', '', status('Production'))}
      ${configValue('Realmroot version', '', '<span class="mono">1.0.1</span>')}
    </div></section><section class="config-section"><header><h2>Protocol endpoints</h2><p>Canonical endpoints exposed by this deployment.</p></header><div class="config-fields">
      ${configValue('Auth issuer', '', '<span class="mono">https://identity.acme.dev/api/auth</span>')}
      ${configValue('OIDC discovery', '', '<span class="mono">/api/auth/.well-known/openid-configuration</span>')}
      ${configValue('JWKS URI', '', '<span class="mono">/api/auth/jwks</span>')}
      ${configValue('Management API', '', '<span class="mono">/api</span>')}
    </div></section></div>`,
  }
  return pageFrame({
    section: 'Configuration / Settings',
    title: 'Realm settings',
    description: 'Manage Realm origins, collaboration policies, delivery settings, and deployment readiness.',
    tabs,
    content: content[active],
  })
}

function renderOrganizationSettings() {
  return pageFrame({
    section: 'Configuration / Settings',
    title: 'Organization settings',
    description: 'Manage Payments Team identity, defaults, and lifecycle.',
    action: button('Edit organization', { drawer: 'Edit organization' }),
    content: detailRows([
      settingRow('Name', '', 'Payments Team'),
      settingRow('Slug', '', '<span class="mono">payments</span>'),
      settingRow('Organization ID', '', '<span class="mono">org_01J8A2</span>'),
      settingRow('Created by', '', 'Jane Stone'),
      settingRow('Created', '', 'Jun 18, 2026'),
      settingRow('Delete organization', 'Applications, resource servers, Agent identities, Role assignments, and active grants must be transferred or removed first.', '', button('Delete organization', { variant: 'danger', drawer: 'Delete organization' })),
    ]),
  })
}

function detailSection(title, description, rows, action = '') {
  return `<section class="detail-section"><header><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${action}</header><div class="detail-rows">${rows.join('')}</div></section>`
}

function detailRows(rows) {
  return `<div class="detail-rows detail-rows-standalone">${rows.join('')}</div>`
}

function detailTableSection(title, description, table) {
  return `<section class="detail-section detail-table-section"><header><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</header>${table}</section>`
}

function detailPageFrame({ section, back, title, description, meta, badge, badgeTone = 'neutral', typeLabel = '', hideTypeLabel = false, tabs = '', content, action = '' }) {
  const crumbs = section.split(' / ')
  const cleanHeader = typeLabel || hideTypeLabel
  const heading = cleanHeader
    ? `<div class="detail-heading-copy"><div class="page-title-line"><h1>${title}</h1><span class="object-badge ${badgeTone}">${badge}</span></div><div class="detail-context">${hideTypeLabel ? '' : `<span>${typeLabel}</span><i aria-hidden="true"></i>`}<span class="detail-meta mono">${meta}</span></div><p>${description}</p></div>`
    : `<div class="detail-heading"><span class="object-mark">${title.slice(0, 1)}</span><div class="detail-heading-copy"><div class="page-title-line"><h1>${title}</h1><span class="object-badge ${badgeTone}">${badge}</span></div><span class="detail-meta mono">${meta}</span><p>${description}</p></div></div>`
  return `<div class="page detail-page">
    <div class="breadcrumbs"><span>Console</span><span>/</span><span>${consoleContextName()}</span>${crumbs.map((crumb, index) => `<span>/</span>${index === crumbs.length - 1 ? `<button data-back="${back}" type="button">${crumb}</button>` : `<span>${crumb}</span>`}`).join('')}</div>
    <header class="page-header detail-header ${cleanHeader ? 'detail-header-clean' : ''}">${heading}${action ? `<div class="page-actions">${action}</div>` : ''}</header>
    ${tabs}${content}
  </div>`
}

function renderAgentDetail() {
  const active = state.detailTabs.agent
  const bodies = {
    overview: detailRows([settingRow('Owner', '', 'Payments Team'), settingRow('Assigned roles', '', 'Finance operator · Payments Team'), settingRow('Access grants', '', '1 active'), settingRow('Hosts', '', '2 active'), settingRow('Created', '', 'Jul 24, 2026'), settingRow('Last activity', '', '6 min ago')]),
    access: `${searchToolbar(['Any type', 'Any status'])}${dataTable(
      ['Type', 'Resource', 'Scopes', 'Lifetime', 'Status', ''],
      [
        { cells: [cell('Access request', 'req_01J9C2'), 'CRM API', '<span class="mono">contacts.write</span>', 'Until Aug 31', status('Pending', 'warning'), icon('more')] },
        { cells: [cell('Grant', 'grt_01J8A4'), 'Billing API', '<span class="mono">invoices.read</span>', 'Persistent', status('Active'), icon('more')] },
        { cells: [cell('Grant', 'grt_01J7P8'), 'Documents API', '<span class="mono">documents.read</span>', 'One target token', status('Used', 'neutral'), icon('more')] },
      ],
    )}`,
    hosts: dataTable(
      ['Host', 'Credential', 'Created', 'Last used', 'Status', ''],
      [
        { cells: [cell('Billing production Worker', 'host_01J8H3'), 'Workload credential', 'Jul 24, 2026', '6 min ago', status('Active'), icon('more')] },
        { cells: [cell('Reconciliation runner', 'host_01J8K7'), 'DPoP key', 'Jul 27, 2026', '2 hours ago', status('Active'), icon('more')] },
      ],
    ),
    activity: `${searchToolbar(['Any event', 'Any result'])}${dataTable(
      ['Event', 'Resource', 'Decision by', 'Time', 'Result'],
      [
        { cells: [cell('resource.access.requested', 'evt_01J9'), 'CRM API', 'Awaiting decision', '6 min ago', status('Pending', 'warning')] },
        { cells: [cell('resource.access.approved', 'evt_01J8'), 'Billing API', 'Jane Stone', 'Jul 29, 2026', status('Allowed')] },
        { cells: [cell('resource.access.denied', 'evt_01J7'), 'CRM API', 'Jane Stone', 'Jul 27, 2026', status('Denied', 'danger')] },
      ],
    )}`,
    settings: detailRows([settingRow('Delete Agent', 'Hides this Agent and revokes active grants. It cannot be restored.', '', button('Delete Agent', { variant: 'danger', drawer: 'Delete Agent' }))]),
  }
  return detailPageFrame({ section: 'Identity / Agents', back: 'agents', title: 'Billing Reconciler', description: 'Stable Agent identity belonging to Payments Team.', meta: 'did:rr:agent:01J7…K8', badge: 'Active', badgeTone: 'success', typeLabel: 'Agent identity', tabs: detailTabs('agent', active, [['overview', 'Overview'], ['access', 'Requests & grants'], ['hosts', 'Hosts'], ['activity', 'Activity'], ['settings', 'Settings']]), content: bodies[active], action: button('Edit agent', { drawer: 'Edit agent' }) })
}

function renderUserDetail() {
  const active = state.detailTabs.user
  const bodies = {
    overview: `${detailRows([settingRow('Username', '', '<span class="mono">jane</span>'), settingRow('Primary email', '', 'jane@acme.dev · Verified'), settingRow('Realm access', '', 'Realm administrator'), settingRow('Created', '', 'Jul 24, 2026'), settingRow('Last sign-in', '', 'Today at 09:48')])}`,
    security: `<div class="detail-sections">${detailSection('Authentication factors', 'Enrolled strong-authentication and recovery methods.', [settingRow('Authenticator app', '', 'Enrolled'), settingRow('Recovery codes', '', 'Generated'), settingRow('Password', '', 'Changed Jul 18')])}${detailSection('Passkeys', 'Hardware-backed credentials registered to this account.', [settingRow('MacBook Pro', 'Platform · backed up', 'Added Jul 24', button('Remove', { variant: 'ghost' })), settingRow('YubiKey 5C', 'Cross-platform', 'Added Jul 26', button('Remove', { variant: 'ghost' }))])}${detailSection('Linked identities', 'External identities that can sign in to this account.', [settingRow('Google', 'jane@acme.dev', 'Linked Jul 24', button('Unlink', { variant: 'ghost' })), settingRow('GitHub Enterprise', 'jstone', 'Linked Jul 25', button('Unlink', { variant: 'ghost' }))])}</div>`,
    sessions: dataTable(
      ['Device', 'Location', 'Created', 'Expires', 'Status', ''],
      [
        { cells: [cell('Chrome · macOS', 'Current device'), 'Toronto · 142.113.8.21', 'Today at 09:48', 'Aug 07', status('Current'), ''] },
        { cells: [cell('Safari · iPhone', 'Mobile'), 'Toronto · 142.113.9.48', 'Jul 30, 2026', 'Aug 04', status('Active'), button('Revoke', { variant: 'ghost' })] },
      ],
    ),
    applications: dataTable(
      ['Application', 'Granted scopes', 'Authorized', ''],
      [
        { cells: [cell('Acme Dashboard', 'Web application'), '<span class="mono">openid · profile · email</span>', 'Jul 24, 2026', button('Revoke', { variant: 'ghost' })] },
        { cells: [cell('Realmroot CLI', 'Native application'), '<span class="mono">openid · offline_access</span>', 'Jul 28, 2026', button('Revoke', { variant: 'ghost' })] },
      ],
    ),
    agents: dataTable(
      ['Agent', 'Access grants', 'Hosts', 'Last activity', 'Status', ''],
      [
        { cells: [cell('Sales Copilot', 'did:rr:agent:01J8…A2'), '3', '2', '12 min ago', status('Active'), icon('more')] },
        { cells: [cell('Research Assistant', 'did:rr:agent:01J7…F9'), '0', '1', 'Yesterday', status('Active'), icon('more')] },
      ],
    ),
    operations: `<div class="detail-sections">${detailSection('Recovery', 'Help the user regain account access.', [settingRow('Send password reset', 'Email a hosted recovery flow.', '', button('Send reset', { drawer: 'Send password reset' }))])}${detailSection('Danger zone', 'Security-sensitive account actions require confirmation.', [settingRow('Ban user', 'Block all future sign-ins until an administrator reverses it.', '', button('Ban user', { variant: 'danger', drawer: 'Ban user' })), settingRow('Delete user', 'Permanently remove the account and its active sessions.', '', button('Delete user', { variant: 'danger', drawer: 'Delete user' }))])}</div>`,
  }
  return detailPageFrame({ section: 'Identity / Users', back: 'users', title: 'Jane Stone', description: 'Human identity with authentication, sessions, Agent identities, and application consent.', meta: 'usr_01J8K4', badge: 'Active', badgeTone: 'success', typeLabel: 'User account', tabs: detailTabs('user', active, [['overview', 'Overview'], ['security', 'Authentication'], ['sessions', 'Sessions'], ['agents', 'Agents'], ['applications', 'Authorized apps'], ['operations', 'Settings']]), content: bodies[active], action: button('Edit user', { drawer: 'Edit user' }) })
}

function renderApplicationDetail() {
  const active = state.detailTabs.application
  const authorizationTabLink = '<button class="inline-action" data-detail-tab="application:authorizations" type="button">View authorizations</button>'
  const bodies = {
    overview: detailRows([settingRow('Owner', '', 'Payments Team'), settingRow('Audience', '', 'All active Realm users'), settingRow('OAuth flow', '', 'Authorization code · PKCE required'), settingRow('Active authorizations', '', `1,042 · ${authorizationTabLink}`), settingRow('Last authorization', '', '8 min ago'), settingRow('Created', '', 'Jun 18, 2026')]),
    oauth: `<div class="detail-sections">${detailSection('Redirects and origins', 'Callbacks and browser origins accepted by this client.', [settingRow('Redirect URIs', '', '<span class="mono">https://app.acme.dev/auth/callback</span>'), settingRow('Post sign-out redirects', '', '<span class="mono">https://app.acme.dev</span>'), settingRow('CORS origins', '', '<span class="mono">https://app.acme.dev</span>')], button('Edit', { drawer: 'Edit OAuth redirects' }))}${detailSection('Authorization', 'OAuth grants and client protections used by this Web application.', [settingRow('Grant types', '', 'Authorization code · Refresh token'), settingRow('PKCE', '', 'Required'), settingRow('Client authentication', '', 'Client secret'), settingRow('Client secret', 'Raw secrets are shown only when created.', 'Last rotated Jul 18', button('Rotate secret', { drawer: 'Rotate client secret' }))], button('Edit', { drawer: 'Edit OAuth authorization' }))}${detailSection('Token claims', 'Claims this application receives after authorization.', [settingRow('Access token', 'Protected API authorization.', 'roles'), settingRow('ID token', 'Identity data returned to this client.', 'groups'), settingRow('UserInfo', 'Claims returned from the UserInfo endpoint.', 'groups')], button('Edit', { drawer: 'Edit token claims' }))}</div>`,
    authorizations: `${searchToolbar(['Any context', 'Any status'])}${dataTable(
      ['User', 'Context', 'Granted scopes', 'Authorized', 'Last used', 'Status', ''],
      [
        { cells: [cell('Jane Stone', 'jane@acme.dev'), 'Payments Team', '<span class="mono">openid · profile · invoices.read</span>', 'Jul 24, 2026', '8 min ago', status('Active'), button('Revoke', { variant: 'ghost', drawer: 'Revoke application authorization' })] },
        { cells: [cell('Marcus Chen', 'marcus@acme.dev'), 'Personal', '<span class="mono">openid · profile</span>', 'Jul 20, 2026', 'Yesterday', status('Active'), button('Revoke', { variant: 'ghost', drawer: 'Revoke application authorization' })] },
        { cells: [cell('Priya Shah', 'priya@acme.dev'), 'Family Archive', '<span class="mono">openid · profile</span>', 'Jul 18, 2026', 'Jul 27, 2026', status('Revoked', 'neutral'), ''] },
      ],
    )}`,
    settings: `<div class="detail-sections">${detailSection('Audience', 'Choose who may use this application and whether it can act in an Organization context.', [settingRow('Who can sign in', '', 'All active Realm users'), settingRow('External users', '', 'Not allowed'), settingRow('Organization context', '', 'Optional')], button('Edit', { drawer: 'Edit application audience' }))}${detailSection('User consent', 'Control whether users must review and approve the access this application requests.', [settingRow('Consent requirement', 'Users approve this application on first use and again when it requests additional scopes.', 'Required')], button('Edit', { drawer: 'Edit consent policy' }))}${detailSection('Status', 'Control whether this client can begin new authorization flows.', [settingRow('Application status', 'Disabling prevents new sign-ins and token requests while preserving configuration and history.', status('Enabled'), button('Disable application', { variant: 'danger', drawer: 'Disable application' }))])}${detailSection('Danger zone', 'Permanently remove this client after active credentials and authorizations are revoked.', [settingRow('Delete application', 'Removes consent records, secrets, and application configuration.', '', button('Delete application', { variant: 'danger', drawer: 'Delete application' }))])}</div>`,
  }
  return detailPageFrame({ section: 'Develop / Applications', back: 'applications', title: 'Expense Portal', description: 'Internal employee expense application.', meta: 'expense_web_01', badge: 'Enabled', badgeTone: 'success', typeLabel: 'Web application', tabs: detailTabs('application', active, [['overview', 'Overview'], ['oauth', 'OAuth'], ['authorizations', 'Authorizations'], ['settings', 'Settings']]), content: bodies[active] ?? bodies.overview, action: button('Edit details', { drawer: 'Edit application' }) })
}

function renderOrganizationDetail() {
  const active = state.detailTabs.organization
  const bodies = {
    overview: detailRows([settingRow('Created by', '', 'Jane Stone · self-service'), settingRow('Created', '', 'Jun 18, 2026'), settingRow('Owners', '', '2'), settingRow('Members', '', '12'), settingRow('Agent identities', '', '3'), settingRow('Last activity', '', '12 min ago')]),
    members: `${searchToolbar(['Any access level', 'Any status'])}${dataTable(
      ['Member', 'Email', 'Access level', 'Joined', 'Status'],
      [
        { cells: [cell('Jane Stone', 'usr_01J8K4'), 'jane@acme.dev', 'Owner', 'Jun 18, 2026', status('Active')] },
        { cells: [cell('Morgan Lee', 'usr_01J7M8'), 'morgan@acme.dev', 'Developer', 'Jun 20, 2026', status('Active')] },
        { cells: [cell('Sam Rivera', 'usr_01J6S3'), 'sam@acme.dev', 'Member', 'Jul 02, 2026', status('Active')] },
      ],
    )}`,
    agents: dataTable(
      ['Agent', 'Roles', 'Access grants', 'Hosts', 'Last activity', 'Status', ''],
      [
        { cells: [cell('Billing Reconciler', 'did:rr:agent:01J7…K8'), 'Finance operator', '1', '2', '6 min ago', status('Active'), icon('more')] },
        { cells: [cell('Expense Auditor', 'did:rr:agent:01J6…F4'), 'Document auditor', '0', '1', 'Yesterday', status('Active'), icon('more')] },
      ],
    ),
    activity: dataTable(
      ['Event', 'Actor', 'Change', 'Time'],
      [
        { cells: [cell('organization.role.assigned', 'evt_01J9T8'), 'Jane Stone', 'Assigned Finance operator to Morgan Lee', 'Jul 29, 2026 · 15:22'] },
        { cells: [cell('organization.access_level.changed', 'evt_01J8A3'), 'Jane Stone', 'Changed Morgan Lee to Administrator', 'Jul 26, 2026 · 10:18'] },
        { cells: [cell('organization.member.invited', 'evt_01J7B6'), 'Morgan Lee', 'Invited sam@acme.dev as Member', 'Jul 02, 2026 · 09:04'] },
      ],
    ),
    settings: detailRows([settingRow('Included in Console access', 'Used when Realm Console access is limited to selected Organizations.', status('Included'), button('Manage', { drawer: 'Choose organizations' })), settingRow('Organization status', 'Suspending blocks new Organization operations while preserving audit history.', status('Active'), button('Suspend')), settingRow('Creation source', '', 'Self-service'), settingRow('Delete organization', 'Resolve ownership, active grants, and dependencies before deletion.', '', button('Delete organization', { variant: 'danger', drawer: 'Delete organization' }))]),
  }
  return detailPageFrame({ section: 'Identity / Organizations', back: 'organizations', title: 'Payments Team', description: 'Shared identity and authorization space with twelve active members and three Agent identities.', meta: 'payments · org_01J8A2', badge: 'Active', badgeTone: 'success', typeLabel: 'Organization', tabs: detailTabs('organization', active, [['overview', 'Overview'], ['members', 'Members'], ['agents', 'Agents'], ['activity', 'Activity'], ['settings', 'Settings']]), content: bodies[active], action: '<button class="button primary" data-open-organization-console type="button">Open Organization Console</button>' })
}

function renderApiResourceDetail() {
  return state.resourceMode === 'external' ? renderExternalApiResourceDetail() : renderNativeApiResourceDetail()
}

function renderNativeApiResourceDetail() {
  const active = state.detailTabs.resource
  const bodies = {
    overview: `${detailRows([settingRow('Owner', '', 'Payments Team'), settingRow('Access eligibility', '', 'All Realm actors'), settingRow('Authorization', '', 'Native · Realmroot-issued tokens'), settingRow('Protected resource URL', '', '<span class="mono">https://api.acme.dev/billing</span>'), settingRow('OpenAPI contract', '', `${status('Available')} · validated Jul 31, 2026 at 10:42`), settingRow('OpenAPI document', '', '<span class="mono">https://api.acme.dev/billing/openapi.json</span>'), settingRow('API surface', '', '3 resources · 5 operations · 3 scopes')])}`,
    resources: `${dataTable(
      ['Resource', 'Operations', 'Required scopes'],
      [
        { cells: [cell('Invoices', '2 operations'), '<span class="operation-list"><span><b>GET</b><span class="mono">/invoices</span></span><span><b>GET</b><span class="mono">/invoices/{invoiceId}</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">invoices.read</span></span>'] },
        { cells: [cell('Payments', '2 operations'), '<span class="operation-list"><span><b>POST</b><span class="mono">/payments</span></span><span><b>POST</b><span class="mono">/payments/{paymentId}/capture</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">payments.write</span></span>'] },
        { cells: [cell('Customers', '1 operation'), '<span class="operation-list"><span><b>GET</b><span class="mono">/customers/{customerId}</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">customers.read</span></span>'] },
      ],
    )}`,
    access: `<div class="detail-sections">${detailTableSection('Roles using this API', 'Reusable Realm roles that include one or more scopes from this API.', dataTable(
      ['Role', 'Eligible scopes', 'Assignments', 'Status', ''],
      [
        { cells: [cell('Finance operator', 'finance.operator'), '2 scopes', '8 actors', status('Active'), icon('more')] },
        { cells: [cell('Expense submitter', 'expense.submitter'), '1 scope', '12 actors', status('Active'), icon('more')] },
      ],
    ))}${detailTableSection('Recent active grants', 'Most recently issued delegated access for this resource.', dataTable(
      ['Agent', 'Scopes', 'Lifetime', 'Granted by', 'Status'],
      [
        { cells: [cell('Expense Auditor', 'did:rr:agent:01J6…F4'), '<span class="mono">invoices.read</span>', 'Persistent', 'Morgan Lee', status('Active')] },
        { cells: [cell('Billing Reconciler', 'did:rr:agent:01J7…P8'), '<span class="mono">invoices.read · payments.write</span>', 'Until Aug 31', 'Jane Stone', status('Active')] },
      ],
    ))}</div>`,
    settings: `<div class="detail-sections">${detailSection('Access eligibility', 'Choose which Realm actors may request this Resource server’s scopes. Roles and grants still determine what they may do.', [settingRow('Eligible actors', 'Allow all Realm actors, only the owning Organization, or selected Organizations.', 'All Realm actors', button('Edit eligibility')), settingRow('Eligible Agents', 'Allow eligible Agent identities to discover and request access.', '', switchControl(true))])}${detailSection('Danger zone', 'Actions that revoke active authorization while preserving audit history.', [settingRow('Delete resource server', 'Existing grants, requests, and token leases will be revoked. It cannot be restored.', '', button('Delete resource server', { variant: 'danger', drawer: 'Delete resource server' }))])}</div>`,
  }
  return detailPageFrame({ section: 'Develop / Resource servers', back: 'api-resources', title: 'Billing API', description: 'Protected authorization boundary owned by Payments Team and available across the Realm.', meta: 'billing · api_01J8B2', badge: 'Enabled', badgeTone: 'success', typeLabel: 'Native resource server', tabs: detailTabs('resource', active, [['overview', 'Overview'], ['resources', 'Resources'], ['access', 'Roles & grants'], ['settings', 'Settings']]), content: bodies[active], action: button('Edit resource server', { drawer: 'Edit resource server' }) })
}

function renderExternalApiResourceDetail() {
  const active = state.detailTabs.resource
  const bodies = {
    overview: `<div class="detail-sections">${detailSection('Resource status', 'Current ownership, access eligibility, contract discovery, and authorization readiness.', [settingRow('Owner', '', 'Payments Team'), settingRow('Access eligibility', '', 'Payments Team only'), settingRow('Authorization', '', 'External · CRM Cloud-issued tokens'), settingRow('Protected resource URL', '', '<span class="mono">https://crm.example.dev</span>'), settingRow('OpenAPI contract', '', `${status('Available')} · validated Jul 31, 2026 at 10:38`), settingRow('OpenAPI document', '', '<span class="mono">https://crm.example.dev/openapi.json</span>'), settingRow('API surface', '', '7 resources · 12 operations · 8 scopes')])}${detailSection('External authorization', 'Realmroot brokers approved Agent authority through the selected connector.', [settingRow('OIDC connector', '', 'CRM Cloud'), settingRow('Issuer', '', '<span class="mono">https://auth.crm.example.dev</span>'), settingRow('Token endpoint', '', '<span class="mono">https://auth.crm.example.dev/oauth/token</span>'), settingRow('Capabilities', '', 'Token exchange · DPoP · Revocation')])}</div>`,
    resources: `${dataTable(
      ['Resource', 'Operations', 'Required scopes'],
      [
        { cells: [cell('Contacts', '3 operations'), '<span class="operation-list"><span><b>GET</b><span class="mono">/contacts</span></span><span><b>POST</b><span class="mono">/contacts</span></span><span><b>PATCH</b><span class="mono">/contacts/{contactId}</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">contacts.read</span><span class="scope-chip mono">contacts.write</span></span>'] },
        { cells: [cell('Companies', '2 operations'), '<span class="operation-list"><span><b>GET</b><span class="mono">/companies</span></span><span><b>GET</b><span class="mono">/companies/{companyId}</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">companies.read</span></span>'] },
        { cells: [cell('Deals', '2 operations'), '<span class="operation-list"><span><b>GET</b><span class="mono">/deals</span></span><span><b>GET</b><span class="mono">/deals/{dealId}</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">deals.read</span></span>'] },
        { cells: [cell('Activities', '1 operation'), '<span class="operation-list"><span><b>GET</b><span class="mono">/activities</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">activities.read</span></span>'] },
        { cells: [cell('Owners', '1 operation'), '<span class="operation-list"><span><b>GET</b><span class="mono">/owners</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">owners.read</span></span>'] },
        { cells: [cell('Pipelines', '1 operation'), '<span class="operation-list"><span><b>GET</b><span class="mono">/pipelines</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">pipelines.read</span></span>'] },
        { cells: [cell('Webhooks', '2 operations'), '<span class="operation-list"><span><b>GET</b><span class="mono">/webhooks</span></span><span><b>POST</b><span class="mono">/webhooks</span></span></span>', '<span class="scope-list"><span class="scope-chip mono">webhooks.manage</span></span>'] },
      ],
    )}`,
    connections: `${dataTable(
      ['Account', 'Authorized scopes', 'Credential', 'Status', 'Owner'],
      [
        { cells: [cell('jane@crm.example.dev', 'connection_01J8J4'), '8 scopes', 'Expires Aug 28', status('Connected'), 'Payments Team'] },
        { cells: [cell('ops@crm.example.dev', 'connection_01J7O6'), '6 scopes', 'No expiry', status('Connected'), 'Payments Team'] },
        { cells: [cell('support@crm.example.dev', 'connection_01J6S8'), '3 scopes', 'Expires Aug 12', status('Connected'), 'Northstar Labs'] },
      ],
    )}`,
    access: `<div class="detail-sections">${detailTableSection('Roles using this API', 'Reusable Realm roles that include one or more scopes from this external API.', dataTable(
      ['Role', 'Eligible scopes', 'Assignments', 'Status', ''],
      [
        { cells: [cell('CRM operator', 'crm.operator'), '6 scopes', '8 subjects', status('Active'), icon('more')] },
        { cells: [cell('CRM reader', 'crm.reader'), '4 scopes', '14 subjects', status('Active'), icon('more')] },
      ],
    ))}${detailTableSection('Recent active grants', 'Approved Agent authority bound to a resource account connection.', dataTable(
      ['Agent', 'Account', 'Scopes', 'Lifetime', 'Status'],
      [
        { cells: [cell('Sales Copilot', 'did:rr:agent:01J8…A2'), 'jane@crm.example.dev', '<span class="mono">contacts.read · contacts.write</span>', 'Until Aug 31', status('Active')] },
        { cells: [cell('Support Triage', 'did:rr:agent:01J6…F4'), 'support@crm.example.dev', '<span class="mono">contacts.read</span>', 'Persistent', status('Active')] },
      ],
    ))}</div>`,
    settings: `<div class="detail-sections">${detailSection('Access eligibility', 'Choose which Realm actors may request this Resource server’s scopes. Roles and grants still determine what they may do.', [settingRow('Eligible actors', 'Allow all Realm actors, only the owning Organization, or selected Organizations.', 'Payments Team only', button('Edit eligibility')), settingRow('Eligible Agents', 'Allow eligible Agent identities to discover and request access.', '', switchControl(true))])}${detailSection('Danger zone', 'Actions that revoke Realmroot grants and connected authority while preserving audit history.', [settingRow('Delete resource server', 'Connections, grants, requests, and active token leases will be revoked. It cannot be restored.', '', button('Delete resource server', { variant: 'danger', drawer: 'Delete external resource server' }))])}</div>`,
  }
  return detailPageFrame({ section: 'Develop / Resource servers', back: 'api-resources', title: 'CRM API', description: 'External CRM authorization boundary owned and used inside Payments Team.', meta: 'crm · api_01J7C4', badge: 'Enabled', badgeTone: 'success', typeLabel: 'External resource server', tabs: detailTabs('resource', active, [['overview', 'Overview'], ['resources', 'Resources'], ['connections', 'Connections'], ['access', 'Roles & grants'], ['settings', 'Settings']]), content: bodies[active], action: button('Edit resource server', { drawer: 'Edit external resource server' }) })
}

function renderRoleDetail() {
  const active = state.detailTabs.role
  const selectedContext = consoleFilterValue('assignment-context', state.consoleContext === 'organization' ? 'Payments Team' : 'Any context')
  const assignmentRows = [
    { context: 'Payments Team', cells: [cell('Morgan Lee', 'usr_01J7M8'), 'User', 'Payments Team', 'Jane Stone', 'Jul 29, 2026', 'Never', icon('more')] },
    { context: 'Payments Team', cells: [cell('Billing Reconciler', 'did:rr:agent:01J7…P8'), 'Agent', 'Payments Team', 'Jane Stone', 'Jul 24, 2026', 'Aug 31, 2026', icon('more')] },
    { context: 'Realm-wide', cells: [cell('Billing Worker', 'billing_worker'), 'Application', 'Realm-wide', 'Morgan Lee', 'Jul 22, 2026', 'Never', icon('more')] },
    { context: 'Family Archive', cells: [cell('Priya Shah', 'usr_01J7Z9'), 'User', 'Family Archive', 'Jane Stone', 'Jul 18, 2026', 'Never', icon('more')] },
  ]
  const visibleAssignments = selectedContext === 'Any context' ? assignmentRows : assignmentRows.filter((row) => row.context === selectedContext)
  const bodies = {
    overview: detailRows([settingRow('Permissions', '', '3 scopes · 2 resource servers'), settingRow('Assignments', '', '8 assignments · 3 contexts · 1 expires this month'), settingRow('Created by', '', 'Jane Stone'), settingRow('Created', '', 'Jul 18, 2026')]),
    scopes: `${searchToolbar(['Any resource server'], button('Edit permissions', { drawer: 'Edit permissions' }), false)}${dataTable(
      ['Scope', 'Resource server', 'Description', 'Protected resources', 'Operations'],
      [
        { cells: ['<span class="mono">invoices.read</span>', 'Billing API', 'Read invoices and payment status.', 'Invoices', '2 operations'] },
        { cells: ['<span class="mono">payments.write</span>', 'Billing API', 'Create and reconcile payments.', 'Payments', '2 operations'] },
        { cells: ['<span class="mono">contracts.approve</span>', 'Documents API', 'Approve governed contracts.', 'Contracts', '1 operation'] },
      ],
    )}`,
    assignments: `${searchToolbar(['Any subject type', assignmentContextFilter(), 'Any status'], button('Assign role', { variant: 'primary', icon: 'plus', drawer: 'Assign role' }))}${dataTable(
      ['Subject', 'Type', 'Context', 'Assigned by', 'Assigned', 'Expires', ''],
      visibleAssignments,
    )}`,
    activity: dataTable(
      ['Event', 'Actor', 'Change', 'Time'],
      [
        { cells: [cell('role.assignment.created', 'evt_01J9R4'), 'Jane Stone', 'Assigned Morgan Lee', 'Jul 29, 2026 · 15:22'] },
        { cells: [cell('role.permissions.updated', 'evt_01J8S7'), 'Jane Stone', 'Added <span class="mono">contracts.approve</span>', 'Jul 25, 2026 · 09:36'] },
        { cells: [cell('role.created', 'evt_01J7U2'), 'Jane Stone', 'Created reusable Realm role', 'Jul 18, 2026 · 16:08'] },
      ],
    ),
    settings: detailRows([settingRow('Delete role', 'Existing assignments must be removed first.', '', button('Delete role', { variant: 'danger', drawer: 'Delete role' }))]),
  }
  return detailPageFrame({
    section: 'Authorization / Roles',
    back: 'roles',
    title: 'Finance operator',
    description: 'Reusable permission set for users, applications, and Agents across the Realm.',
    meta: 'finance.operator',
    badge: 'Custom',
    hideTypeLabel: true,
    tabs: detailTabs('role', active, [['overview', 'Overview'], ['scopes', 'Permissions'], ['assignments', 'Assignments'], ['activity', 'Activity'], ['settings', 'Settings']]),
    content: bodies[active],
    action: button('Edit role', { drawer: 'Edit role' }),
  })
}

function openDrawer(title) {
  const activeOrganizationName = state.surface === 'account' && state.accountOrganization === 'family' ? 'Family Archive' : 'Payments Team'
  const defaultOwner = state.consoleContext === 'organization' ? 'Payments Team' : 'Acme Platform'
  const definitions = {
    'New user': [['Display name', 'Jane Stone'], ['Email', 'jane@acme.dev'], ['Initial password', '••••••••••'], ['Role', 'User']],
    'New organization': [['Name', 'New organization'], ['Slug', 'new-organization']],
    'New application': [['Owner', defaultOwner], ['Application name', 'New application'], ['Description', 'Application description'], ['Application type', 'Web application'], ['Audience', 'All active Realm users'], ['Redirect URIs', 'https://app.acme.dev/auth/callback']],
    'Add OIDC connector': [['Name', 'GitHub Enterprise'], ['Provider ID', 'github-enterprise'], ['Issuer', 'https://github.acme.dev'], ['Client ID', 'realmroot-prod'], ['Client secret', '••••••••••'], ['Scopes', 'openid profile email'], ['Registration mode', 'Manual']],
    'New resource server': [['Owner', defaultOwner], ['Name', 'New API'], ['Protected resource URL', 'https://api.acme.dev/resource'], ['Authorization model', 'Native (Realmroot)'], ['Access eligibility', 'Realm-wide'], ['Initial status', 'Disabled draft']],
    'New role': [['Key', 'support.operator'], ['Name', 'Support operator'], ['Description', 'Operate shared workflows across the Realm']],
    'Invite organization member': [['Email', 'new.member@acme.dev'], ['Access level', 'Member']],
    'Choose organizations': [['Included organizations', 'Payments Team']],
    'Edit resource server': [['Name', 'Billing API'], ['Identifier', 'billing'], ['Description', 'Invoices, payments, and billing customer records.'], ['Protected resource URL', 'https://api.acme.dev/billing']],
    'Delete resource server': [['Resource server', 'Billing API'], ['Confirmation', 'Type DELETE']],
    'Delete external resource server': [['Resource server', 'Projects API'], ['Confirmation', 'Type DELETE']],
    'Edit external resource server': [['Name', 'CRM API'], ['Identifier', 'crm'], ['Description', 'Contacts, companies, deals, and CRM activity.'], ['Protected resource URL', 'https://crm.example.dev'], ['OIDC connector', 'CRM Cloud']],
    'Edit agent': [['Display name', 'Billing Reconciler'], ['Picture URL', '/agent-picture-v1.svg']],
    'Edit user': [['Display name', 'Jane Stone'], ['Username', 'jane'], ['Primary email', 'jane@acme.dev'], ['Realm access', 'Realm administrator']],
    'Send password reset': [['User', 'Jane Stone'], ['Email', 'jane@acme.dev']],
    'Ban user': [['User', 'Jane Stone'], ['Reason', 'Security review'], ['Confirmation', 'Type BAN']],
    'Delete user': [['User', 'Jane Stone'], ['Confirmation', 'Type DELETE']],
    'Edit application': [['Name', 'Expense Portal'], ['Description', 'Internal employee expense application.']],
    'Edit application audience': [['Audience', 'All active Realm users'], ['External users', 'Not allowed'], ['Organization context', 'Optional']],
    'Edit consent policy': [],
    'Edit OAuth redirects': [['Redirect URIs', 'https://app.acme.dev/auth/callback'], ['Post sign-out redirects', 'https://app.acme.dev'], ['CORS origins', 'https://app.acme.dev']],
    'Edit OAuth authorization': [['Grant types', 'Authorization code, Refresh token'], ['PKCE', 'Required'], ['Client authentication', 'Client secret']],
    'Edit token claims': [['Access token claims', 'roles'], ['ID token claims', 'groups'], ['UserInfo claims', 'groups']],
    'Rotate client secret': [['Application', 'Expense Portal'], ['Confirmation', 'Type ROTATE']],
    'Revoke application authorization': [['User', 'Jane Stone'], ['Application', 'Expense Portal'], ['Confirmation', 'Type REVOKE']],
    'Disable application': [['Application', 'Expense Portal'], ['Confirmation', 'Type DISABLE']],
    'Delete application': [['Application', 'Expense Portal'], ['Confirmation', 'Type DELETE']],
    'Edit organization': [['Name', activeOrganizationName], ['Slug', activeOrganizationName === 'Family Archive' ? 'family-archive' : 'payments']],
    'Delete organization': [['Organization', activeOrganizationName], ['Confirmation', 'Type DELETE']],
    'Edit role': [['Name', 'Finance operator'], ['Description', 'Operate finance workflows across eligible resource servers.']],
    'Edit permissions': [],
    'Assign role': [['Subject type', 'User'], ['Subject', 'Morgan Lee'], ['Context', state.consoleContext === 'organization' ? 'Payments Team' : 'Realm-wide'], ['Expires', 'Never']],
    'Delete role': [['Role', 'Finance operator'], ['Confirmation', 'Type DELETE']],
    'Create webhook endpoint': [['Endpoint URL', 'https://hooks.acme.dev/identity'], ['Events', 'user.created, user.updated'], ['Status', 'Enabled']],
    'Change avatar': [['Avatar image', 'Choose PNG, JPEG or WebP up to 2 MB']],
    'Edit display name': [['Display name', 'Jane Stone']],
    'Edit username': [['Username', 'jane']],
    'Change email': [['New email', 'jane@acme.dev'], ['Current password', '••••••••••']],
    'Change password': [['Current password', '••••••••••'], ['New password', '••••••••••'], ['Confirm new password', '••••••••••']],
    'Add passkey': [['Passkey name', 'MacBook Pro']],
    'Delete Agent': [['Agent', 'Billing Reconciler'], ['Confirmation', 'Type DELETE']],
    'Manage blocked domains': [['Blocked domains', 'example.org, mailinator.com, disposable.test']],
    'Manage trusted origins': [['Trusted origins', 'https://app.acme.dev, https://admin.acme.dev']],
    'Configure Passkey': [['Relying party name', 'Acme Identity'], ['Relying party ID', 'identity.acme.dev'], ['Allowed origins', 'https://identity.acme.dev, https://login.acme.dev']],
    'Configure Turnstile': [['Site key', '0x4AAAAAAA...'], ['Secret key', '••••••••••••••••']],
    'Configure hCaptcha': [['Site key', ''], ['Secret key', '']],
    'Configure reCAPTCHA Enterprise': [['Project ID', ''], ['Site key', ''], ['API key', '']],
  }
  const fields = definitions[title] ?? [['Name', ''], ['Description', '']]
  const destructive = title.startsWith('Delete') || title.startsWith('Ban') || title.startsWith('Disable') || title.startsWith('Revoke')
  let submitLabel = 'Create'
  if (title.startsWith('Edit') || title.startsWith('Change') || title.startsWith('Manage') || title.startsWith('Configure')) submitLabel = 'Save changes'
  if (title.startsWith('Send')) submitLabel = 'Send reset email'
  if (title.startsWith('Rotate')) submitLabel = 'Rotate secret'
  if (title.startsWith('Revoke')) submitLabel = 'Revoke authorization'
  if (title.startsWith('Disable')) submitLabel = 'Disable application'
  if (title.startsWith('Delete resource') || title.startsWith('Delete external')) submitLabel = 'Delete resource'
  if (title === 'Delete Agent') submitLabel = 'Delete Agent'
  if (title.startsWith('Delete') || title.startsWith('Ban')) submitLabel = title
  if (title === 'Invite organization member') submitLabel = 'Send invitation'

  let drawerDescription = 'Complete the required details.'
  if (title.startsWith('Send')) drawerDescription = 'Send a new hosted recovery link to this user.'
  if (title.startsWith('Rotate')) drawerDescription = 'Create a replacement secret and invalidate the current credential.'
  if (title.startsWith('Ban')) drawerDescription = 'This blocks future sign-ins until an administrator reverses it.'
  if (title.startsWith('Revoke')) drawerDescription = 'This user will need to authorize the application again before it can access their data.'
  if (title.startsWith('Disable')) drawerDescription = 'This prevents new sign-ins and token requests while preserving configuration and history.'
  if (title.startsWith('Delete')) drawerDescription = 'This permanently removes the object after its dependencies are resolved.'
  if (title === 'New organization') drawerDescription = 'Create a shared identity and authorization space.'
  if (title === 'New application') drawerDescription = 'Choose an owner, then register the client and its audience.'
  if (title === 'New resource server') drawerDescription = 'Choose an owner, then register the protected API and its access eligibility.'
  if (title === 'New role') drawerDescription = 'Create a reusable Realm permission set. Permissions are added after creation.'
  if (title === 'Assign role') drawerDescription = 'Choose a subject and whether this Role applies Realm-wide or in one Organization context.'
  if (title === 'Choose organizations') drawerDescription = 'Choose which Organizations can be opened when Console access is set to Selected organizations.'
  if (title === 'Invite organization member') drawerDescription = `Invite a member and choose their ${activeOrganizationName} access level.`
  if (title === 'Edit permissions') drawerDescription = 'Choose scopes exposed by resource servers in this Realm.'
  if (title === 'Edit consent policy') drawerDescription = 'Choose whether this application needs explicit approval before receiving requested access.'
  const confirmationDialog = ['Rotate client secret', 'Revoke application authorization', 'Disable application', 'Delete application'].includes(title)
  const layer = document.createElement('div')
  layer.className = confirmationDialog ? 'dialog-layer' : 'drawer-layer'
  const formBody = `<div class="form-stack">${fields
    .map(([label, value]) => `<div class="field"><label>${label}</label><input value="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" /></div>`)
    .join('')}</div>`
  const permissionOptions = `<label class="scope-option"><input type="checkbox" checked /><span><strong class="mono">invoices.read</strong><small>Billing API · Read invoices and payment status</small></span></label>
      <label class="scope-option"><input type="checkbox" checked /><span><strong class="mono">payments.write</strong><small>Billing API · Create and reconcile payments</small></span></label>
      <label class="scope-option"><input type="checkbox" checked /><span><strong class="mono">contracts.approve</strong><small>Documents API · Approve governed contracts</small></span></label>
      <label class="scope-option"><input type="checkbox" /><span><strong class="mono">contacts.read</strong><small>CRM API · Read contacts and account details</small></span></label>`
  const permissionSelector = `<div class="scope-selector"><div class="scope-selector-source"><span>Permissions</span><strong>Resource server scopes</strong><small>Select scopes exposed by resource servers in this Realm.</small><div class="scope-permission-controls"><label class="search-wrap">${icon('search')}<input class="input" aria-label="Search scopes" placeholder="Search scopes" /></label><label class="scope-resource-filter"><span>Resource server</span><select><option>Any resource server</option><option>Billing API</option><option>CRM API</option><option>Documents API</option></select></label></div></div><div class="scope-options">
      ${permissionOptions}
    </div></div>`
  const consentPolicySelector = `<div class="consent-policy-editor"><fieldset class="consent-policy-options"><legend>User consent</legend><label><input type="radio" name="consent-policy" value="required" checked><span><strong>Require user consent</strong><small>Ask users to approve access on first use and whenever the application requests additional scopes.</small></span></label><label><input type="radio" name="consent-policy" value="skipped"><span><strong>Do not require user consent</strong><small>Continue authorization without routine approval. Use only for applications controlled by a trusted party.</small></span></label></fieldset><div class="consent-policy-warning" hidden>${icon('shield')}<p><strong>This grants access without user review.</strong><span>The application can receive any requested scope allowed by its OAuth configuration.</span></p></div></div>`
  const drawerBody = title === 'Edit permissions' ? permissionSelector : title === 'Edit consent policy' ? consentPolicySelector : formBody
  const containerClass = confirmationDialog ? 'dialog' : 'drawer'
  layer.innerHTML = `<section class="${containerClass}" role="dialog" aria-modal="true" aria-label="${title}"><header><div><h2>${title}</h2><p>${drawerDescription}</p></div><button class="icon-button" data-close-drawer type="button" aria-label="Close">×</button></header>${drawerBody}<footer><button class="button" data-close-drawer type="button">Cancel</button>${button(submitLabel, { variant: destructive ? 'danger' : 'primary' })}</footer></section>`
  prototype.append(layer)
  const consentPolicyWarning = layer.querySelector('.consent-policy-warning')
  layer.querySelectorAll('input[name="consent-policy"]').forEach((input) => {
    input.addEventListener('change', () => {
      consentPolicyWarning.hidden = input.value !== 'skipped' || !input.checked
    })
  })
  layer.addEventListener('click', (event) => {
    if (event.target === layer || event.target.closest('[data-close-drawer]')) layer.remove()
  })
}

function renderAuth() {
  prototype.innerHTML = `<div class="auth-shell">${authVariant(state.authVariant)}</div>`
  prototype.querySelectorAll('[name="resource-lifetime"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.resourceLifetime = input.value
      renderAuth()
    })
  })
}

function authBrand() {
  return `<a class="auth-brand" href="#"><span class="rr-mark"><i></i><i></i><i></i></span><span>Realmroot</span></a>`
}

function authPageFooter() {
  return `<footer class="auth-page-footer"><nav aria-label="Hosted authentication links"><a href="#">Privacy</a><a href="#">Terms</a><a href="#">Support</a></nav><span>Secured by Realmroot</span></footer>`
}

function authFrame({ eyebrow, title, description, content, layout = 'compact', contextEyebrow = 'Secure access', contextTitle = 'Your identity stays at the root.', contextDescription = 'One identity surface for users, applications, APIs, and delegated agents.', trustItems = ['Explicit application and resource authority', 'Passkeys and MFA ready', 'Tenant policies enforced'] }) {
  const task = `<div class="auth-task"><header class="auth-task-header">${layout === 'split' ? '' : authBrand()}<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></header><div class="auth-content">${content}</div></div>`
  const frame = layout === 'split'
    ? `<section class="auth-frame auth-frame-split"><aside class="auth-context">${authBrand()}<div class="auth-context-copy"><p class="eyebrow">${contextEyebrow}</p><h2>${contextTitle}</h2><p>${contextDescription}</p><ul class="trust-list">${trustItems.map((item) => `<li>${item}</li>`).join('')}</ul></div><div class="auth-legal">identity.acme.dev</div></aside>${task}</section>`
    : `<section class="auth-frame auth-frame-${layout}">${task}</section>`
  return `<div class="auth-stage auth-stage-${layout}">${frame}${authPageFooter()}</div>`
}

function field(label, value = '', type = 'text', help = '') {
  return `<div class="field"><label>${label}</label><input type="${type}" value="${value}" />${help ? `<small>${help}</small>` : ''}</div>`
}

function authMethod(label, iconName, mark = '') {
  return `<button class="auth-method-button" type="button"><span class="auth-method-icon">${iconName ? icon(iconName) : mark}</span><span>${label}</span>${icon('arrow')}</button>`
}

function requestSummary(mark, title, description) {
  return `<div class="request-summary"><span class="object-mark">${mark}</span><div><strong>${title}</strong><span>${description}</span></div></div>`
}

function approvalList(items) {
  return `<dl class="decision-facts">${items.map(([label, value, mono = false, wide = false]) => `<div class="${wide ? 'wide' : ''}"><dt>${label}</dt><dd class="${mono ? 'mono' : ''}">${value}</dd></div>`).join('')}</dl>`
}

function consentPermission(iconName, title, description) {
  return `<li><span class="consent-permission-icon">${icon(iconName)}</span><div><strong>${title}</strong><span>${description}</span></div></li>`
}

function consentScopes(items) {
  return `<details class="consent-scope-details"><summary>View technical details <span>${items.length} scopes ${icon('arrow')}</span></summary><div>${items.map((scope) => `<code>${scope}</code>`).join('')}</div></details>`
}

function resourceScopes(items) {
  return `<section class="resource-scopes"><header><strong>Exact scopes</strong><span>${items.length} scopes</span></header><ul class="resource-scope-list" tabindex="0" aria-label="Requested resource scopes">${items.map(([scope, description]) => `<li><code>${scope}</code><span>${description}</span></li>`).join('')}</ul></section>`
}

function lifetimeOption(value, title, description) {
  return `<label><input ${state.resourceLifetime === value ? 'checked' : ''} name="resource-lifetime" type="radio" value="${value}"><span><strong>${title}</strong><small>${description}</small></span></label>`
}

function resourceLifetime() {
  return `<fieldset class="lifetime-options"><legend>Grant lifetime</legend>${lifetimeOption('single', 'One target token', 'Single use')}${lifetimeOption('date', 'Until a date', 'Time limited')}${lifetimeOption('persistent', 'Persistent', 'Until revoked')}</fieldset><div class="lifetime-detail" aria-live="polite">${state.resourceLifetime === 'date' ? `<label for="resource-expiry">Access expires</label><input id="resource-expiry" min="2026-08-01" type="date" value="2026-08-31">` : ''}</div>`
}

function authVariant(id) {
  const variants = {
    'sign-in': () => authFrame({ eyebrow: 'Hosted sign-in', title: 'Sign in to Acme', description: 'Use your work identity to continue.', layout: 'split', content: `<form class="form-stack">${field('Email or username', 'jane@acme.dev')}${field('Password', '••••••••••', 'password')}<div class="auth-form-link"><a class="auth-link" href="#">Forgot password?</a></div>${button('Sign in', { variant: 'primary', icon: 'key' })}</form><div class="divider">Other sign-in methods</div><div class="auth-methods">${authMethod('Continue with passkey', 'fingerprint')}${authMethod('Continue with Google', '', 'G')}${authMethod('Continue with email code', 'app')}${authMethod('Continue with GitHub', '', 'GH')}</div><p class="auth-prompt">No account yet? <a class="auth-link" href="#">Create account</a></p>` }),
    'sign-up': () => authFrame({ eyebrow: 'Create account', title: 'Create an account for Acme', description: 'Set up your hosted identity to continue.', layout: 'split', content: `<form class="form-stack">${field('Display name', 'Jane Stone')}${field('Email', 'jane@acme.dev', 'email')}${field('Username', 'jane')}${field('Password', '••••••••••', 'password', '12 characters · 3 character types')}${button('Create account', { variant: 'primary' })}</form><p class="auth-prompt">Already have an account? <a class="auth-link" href="#">Sign in</a></p>` }),
    recovery: () => authFrame({ eyebrow: 'Account recovery', title: 'Set a new password', description: 'Enter the code sent to your email.', layout: 'split', content: `<div class="identity-summary"><div><span>Recovery email</span><strong>jane@acme.dev</strong></div><a class="auth-link" href="#">Change</a></div><form class="form-stack">${field('One-time code', '184 293')}${field('New password', '••••••••••', 'password', '12 characters minimum')}${button('Reset password', { variant: 'primary' })}</form><div class="auth-secondary-links"><a class="auth-link" href="#">Resend code in 24s</a><a class="auth-link" href="#">Back to sign in</a></div>` }),
    verification: () => authFrame({ eyebrow: 'Email verification', title: 'Verify your email', description: 'Enter the code sent to jane@acme.dev.', layout: 'focused', content: `<form class="form-stack">${field('Verification code', '620 417')}${button('Verify email', { variant: 'primary' })}</form><div class="auth-secondary-links"><a class="auth-link" href="#">Resend code</a><a class="auth-link" href="#">Use another email</a></div>` }),
    mfa: () => authFrame({ eyebrow: 'Two-step verification', title: 'Verify your sign-in', description: 'Enter the current code from your authenticator app.', layout: 'focused', content: `<form class="form-stack">${field('Authenticator code', '284 019')}${button('Verify code', { variant: 'primary', icon: 'lock' })}</form><p class="auth-prompt"><a class="auth-link" href="#">Use a backup code instead</a></p>` }),
    consent: () => authFrame({ eyebrow: 'Authorization request', title: 'Acme Dashboard wants to access your Realmroot account', description: 'Published by Acme, Inc. · Verified application', layout: 'decision', content: `<div class="consent-account"><span class="avatar">JS</span><div><span>Continue as</span><strong>Jane Stone</strong><small>jane@acme.dev</small></div><a class="auth-link" href="#">Switch account</a></div><section class="consent-permissions"><h2>This will allow Acme Dashboard to:</h2><ul>${consentPermission('users', 'See your basic profile', 'Your name, profile picture, and verified email address.')}${consentPermission('building', 'View your organization access', 'Your organization memberships and assigned roles.')}${consentPermission('bot', 'View your Agent identities', 'Agent identities owned by your account.')}${consentPermission('app', 'Keep access when you are away', 'The application can refresh its access without asking again.')}</ul></section>${consentScopes(['openid', 'profile', 'email', 'offline_access', 'organizations.read', 'roles.read', 'agents.read'])}<p class="consent-control-note">You can revoke this access at any time in <a class="auth-link" href="#">Account Center</a>.</p><div class="auth-actions">${button('Cancel')}${button('Allow', { variant: 'primary' })}</div><p class="consent-app-legal">Review Acme Dashboard’s <a href="#">Privacy Policy</a> and <a href="#">Terms of Service</a>.</p>` }),
    device: () => authFrame({ eyebrow: 'Device login', title: 'Approve this device', description: 'Make sure this code matches the device requesting access.', layout: 'decision', content: `<div class="identity-summary"><div><span>Signed in as</span><strong>Jane Stone · jane@acme.dev</strong></div><a class="auth-link" href="#">Switch</a></div><div class="device-code"><span>Device code</span><strong class="mono">ABCD-1234</strong></div><div class="auth-actions">${button('Deny', { variant: 'danger' })}${button('Approve device', { variant: 'primary' })}</div>` }),
    'agent-login': () => authFrame({ eyebrow: 'Agent identity', title: 'Approve Agent login', description: 'Bind this Host to an existing stable Agent identity.', layout: 'decision', content: `${requestSummary('S', 'Sales Copilot', 'Stable Agent · requesting login')}${approvalList([['Host', 'macbook-pro-14', true], ['Login code', 'RR-A7K4-19P2', true]])}<div class="auth-notice"><strong>Identity only</strong><span>No capabilities or external API access are requested.</span></div><div class="auth-actions">${button('Deny', { variant: 'danger' })}${button('Approve login', { variant: 'primary' })}</div>` }),
    'agent-identity': () => authFrame({ eyebrow: 'Stable Agent identity', title: 'Approve Agent enrollment', description: 'Create a durable issuer and subject for this Agent.', layout: 'decision', content: `${requestSummary('B', 'Billing Reconciler', 'New stable Agent identity')}${approvalList([['Home space', 'Organization · Acme'], ['Enrollment intent', 'intent_01J8K4Y9', true]])}<div class="auth-actions">${button('Deny', { variant: 'danger' })}${button('Approve identity', { variant: 'primary' })}</div>` }),
    'resource-access': () => authFrame({ eyebrow: 'API authorization', title: 'Approve resource access', description: 'Confirm the target, account, scopes, and lifetime.', layout: 'decision', content: `${requestSummary('S', 'Sales Copilot', 'Stable Agent · requesting API access')}${approvalList([['Resource', 'CRM API'], ['Resource account', 'jane@crm.example.dev · Connected']])}${resourceScopes([['contacts.read', 'Read contacts'], ['contacts.write', 'Create and update contacts'], ['companies.read', 'Read company records'], ['deals.read', 'Read sales opportunities'], ['activities.read', 'Read notes and activities'], ['owners.read', 'Read record owners'], ['pipelines.read', 'Read pipeline definitions'], ['webhooks.manage', 'Manage event subscriptions']])}${resourceLifetime()}<div class="auth-actions">${button('Deny', { variant: 'danger' })}${button('Approve exact access', { variant: 'primary' })}</div>` }),
    callback: () => authFrame({ eyebrow: 'Complete', title: 'Sign-in complete', description: 'You can continue to Acme Dashboard.', layout: 'message', content: `<div class="auth-result-icon">${icon('shield')}</div><span class="auth-result-status">Authorization response validated</span>${button('Continue', { variant: 'primary', icon: 'arrow' })}` }),
    onboarding: () => authFrame({ eyebrow: 'First-run onboarding', title: 'Create the first admin', description: 'Set up the Realm operator and its private platform Organization.', layout: 'split', contextEyebrow: 'Realm setup', contextTitle: 'Start your realm with explicit ownership.', contextDescription: 'The first admin controls Realm policy. A private platform Organization owns the initial Applications and APIs without exposing developer access to users.', trustItems: ['One issuer and policy boundary', 'Organization and Console policies stay independent', 'Every technical resource has an owner'], content: `<form class="form-stack">${field('Display name', 'Realm administrator')}${field('Email', 'admin@acme.dev', 'email')}${field('Username', 'realm-admin')}${field('Platform organization', 'Acme Platform')}${field('Password', '••••••••••', 'password', '12 characters minimum')}${button('Create Realm', { variant: 'primary' })}</form>` }),
  }
  return (variants[id] ?? variants['sign-in'])()
}

function renderAccount() {
  prototype.innerHTML = `<div class="account-shell">${accountTopbar()}
    <div class="account-layout"><aside class="account-sidebar"><div class="account-person"><span class="avatar">JS</span><div><strong>Jane Stone</strong><span>jane@acme.dev</span></div></div><nav class="account-nav" aria-label="Account Center">${accountNavGroups
      .map((group) => `<div class="account-nav-group"><p>${group.label}</p>${group.pages.map((id) => {
        const [, label, iconName] = accountVariants.find(([pageId]) => pageId === id)
        return `<button class="${id === state.accountPage ? 'is-active' : ''}" data-account-page="${id}" type="button">${icon(iconName)}<span>${label}</span></button>`
      }).join('')}</div>`)
      .join('')}</nav><div class="account-sidebar-meta"><span>Default realm</span><strong>identity.acme.dev</strong></div></aside><main class="account-main">${accountPage(state.accountPage)}</main></div></div>`
  prototype.querySelectorAll('[data-account-page]').forEach((button) => {
    button.addEventListener('click', () => {
      state.accountPage = button.dataset.accountPage
      state.accountOrganizationOpen = false
      renderAccount()
      renderVariantPicker()
    })
  })
  prototype.querySelectorAll('[data-account-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const [group, tab] = button.dataset.accountTab.split(':')
      state.accountTabs[group] = tab
      renderAccount()
      renderVariantPicker()
    })
  })
  prototype.querySelectorAll('[data-account-organization]').forEach((button) => {
    button.addEventListener('click', () => {
      state.accountOrganizationOpen = true
      state.accountOrganization = button.dataset.accountOrganization || 'payments'
      state.accountTabs.organization = 'overview'
      renderAccount()
    })
  })
  prototype.querySelectorAll('[data-account-organizations-back]').forEach((button) => {
    button.addEventListener('click', () => {
      state.accountOrganizationOpen = false
      renderAccount()
    })
  })
  prototype.querySelectorAll('[data-open-organization-console]').forEach((button) => {
    button.addEventListener('click', () => {
      state.surface = 'console'
      state.consoleContext = 'organization'
      state.consolePage = 'dashboard'
      document.querySelectorAll('[data-surface]').forEach((candidate) => {
        const active = candidate.dataset.surface === 'console'
        candidate.classList.toggle('is-active', active)
        candidate.setAttribute('aria-selected', String(active))
      })
      render()
    })
  })
  prototype.querySelectorAll('[data-drawer]').forEach((button) => button.addEventListener('click', () => openDrawer(button.dataset.drawer)))
}

function accountTopbar() {
  return `<header class="product-topbar account-topbar">${productBrand('Account Center')}<div class="top-actions"><button class="button" data-open-organization-console type="button">Open Payments Team Console</button><button class="icon-button" type="button" aria-label="Help & documentation">?</button><button class="avatar" type="button" aria-label="Account menu">JS</button></div></header>`
}

function accountRows(rows) {
  return `<div class="account-rows">${rows.join('')}</div>`
}

function accountTabs(group, tabs) {
  const active = state.accountTabs[group]
  return `<div class="account-tabs" role="tablist">${tabs.map(([id, label]) => `<button class="${id === active ? 'is-active' : ''}" data-account-tab="${group}:${id}" type="button" role="tab" aria-selected="${id === active}">${label}</button>`).join('')}</div>`
}

function accountTabPanel(content) {
  return `<div class="account-tab-panel">${content}</div>`
}

function accountOverviewBlock(title, content) {
  return `<section class="account-overview-block"><header><h2>${title}</h2></header>${content}</section>`
}

function accountEntityList(cards) {
  return `<div class="account-entity-list">${cards.join('')}</div>`
}

function accountPage(id) {
  if (id === 'overview') return accountOverview()
  if (id === 'security') return accountSecurity()
  if (id === 'applications') return accountApplications()
  if (id === 'agents') return accountAgents()
  if (id === 'organizations') return accountOrganizations()
  return accountProfile()
}

function accountOverview() {
  const attention = accountOverviewBlock('Needs your attention', accountRows([
      settingRow('Sales Copilot requests CRM API', 'contacts.read · contacts.write · persistent access', status('Approval required', 'warning'), button('Review request', { variant: 'primary' })),
      settingRow('Backup codes are 8 months old', 'Generate a new recovery set and store it somewhere safe.', 'Recommended', button('Regenerate')),
    ]))
  const activity = accountOverviewBlock('Recent activity', accountRows([
      settingRow('Passkey sign-in', 'Chrome on macOS · Toronto', 'Today, 10:42'),
      settingRow('Agent access approved', 'Research Assistant · Documents API · documents.read', 'Yesterday, 16:08'),
      settingRow('Application authorized', 'Realmroot CLI · openid offline_access', 'Jul 28, 09:14'),
    ]))
  return `<div class="profile-hero"><div><h1>Good morning, Jane.</h1><p>Review your identity, security, and delegated authority in this realm.</p></div></div>
  <div class="metric-grid account-metrics"><article class="metric"><span>Security</span><strong>Strong</strong><small>Passkey and MFA are enabled.</small></article><article class="metric"><span>Active Agents</span><strong>2</strong><small>3 delegated access grants</small></article><article class="metric"><span>Organizations</span><strong>2</strong><small>1 Organization you administer</small></article></div>
  <div class="account-overview-flow">${attention}${activity}</div>`
}

function accountProfile() {
  const active = state.accountTabs.profile
  const panels = {
    details: accountTabPanel(accountRows([
      settingRow('Avatar', '', 'JS', button('Change', { drawer: 'Change avatar' })),
      settingRow('Display name', 'Shown across trusted applications.', 'Jane Stone', button('Edit', { drawer: 'Edit display name' })),
      settingRow('Username', 'Public account handle.', 'jane', button('Edit', { drawer: 'Edit username' })),
      settingRow('Email', 'Used for sign-in and account notifications.', 'jane@acme.dev · Verified', button('Change', { drawer: 'Change email' })),
    ])),
    preferences: accountTabPanel(accountRows([
      settingRow('Language', '', 'English', button('Change')),
      settingRow('Time zone', '', 'America/Toronto', button('Change')),
    ])),
    account: accountTabPanel(accountRows([
      settingRow('Export account data', 'Receive a machine-readable copy of your profile and grants.', 'Not requested', button('Request export')),
      settingRow('Close account', 'Requires organization and Agent ownership checks.', '', button('Close account', { variant: 'danger' })),
    ])),
  }
  return `<div class="profile-hero"><div><h1>Profile</h1><p>Manage the identity information Realmroot shares with trusted applications.</p></div></div>${accountTabs('profile', [['details', 'Identity details'], ['preferences', 'Preferences'], ['account', 'Account']])}${panels[active]}`
}

function accountSecurity() {
  const active = state.accountTabs.security
  const panels = {
    'sign-in': accountTabPanel(accountRows([
      settingRow('Password', '12 characters minimum · changed Jul 18, 2026', 'Active', button('Change password', { drawer: 'Change password' })),
      settingRow('Google', 'jane@acme.dev · linked Jul 24', status('Connected'), button('Manage')),
      settingRow('GitHub Enterprise', 'jstone · linked Jul 25', status('Connected'), button('Manage')),
      settingRow('Ethereum wallet', '0x71C…4A9 · linked Jul 29', status('Connected'), button('Manage')),
      settingRow('Add sign-in method', 'Connect another provider enabled by this realm.', '', button('Connect')),
    ])),
    mfa: accountTabPanel(accountRows([
      settingRow('TOTP authenticator', 'Enrolled Jul 24, 2026', status('Enabled'), button('Disable', { variant: 'danger' })),
      settingRow('Backup codes', '8 unused recovery codes', 'Generated', button('Regenerate')),
    ])),
    passkeys: accountTabPanel(accountRows([
      settingRow('MacBook Pro', 'Platform · backed up · added Jul 24', 'Last used today', button('Remove', { variant: 'ghost' })),
      settingRow('YubiKey 5C', 'Cross-platform · not backed up · added Jul 26', 'Last used Jul 30', button('Remove', { variant: 'ghost' })),
      settingRow('Add passkey', 'Create another hardware-backed credential.', '', button('Add passkey', { variant: 'primary', drawer: 'Add passkey' })),
    ])),
    sessions: accountTabPanel(accountRows([
      settingRow('Chrome · macOS', 'Toronto · 142.113.8.21', 'Current · expires Aug 07'),
      settingRow('Safari · iPhone', 'Toronto · 142.113.9.48', 'Expires Aug 04', button('Revoke', { variant: 'ghost' })),
      settingRow('Other sessions', 'Sign out every other active session.', '', button('Revoke other sessions', { variant: 'danger' })),
    ])),
  }
  return `<div class="profile-hero"><div><h1>Sign-in & security</h1><p>Control credentials, recovery methods, sign-in identities, and active sessions.</p></div></div>${accountTabs('security', [['sign-in', 'Sign-in'], ['mfa', 'MFA'], ['passkeys', 'Passkeys'], ['sessions', 'Sessions']])}${panels[active]}`
}

function accountApplications() {
  const active = state.accountTabs.applications
  const panels = {
    authorized: accountTabPanel(accountRows([
      settingRow('Acme Dashboard', 'First-party · last used today', '<span class="mono">openid profile email</span>', button('Review')),
      settingRow('Realmroot CLI', 'Native application · last used Jul 30', '<span class="mono">openid offline_access</span>', button('Review')),
      settingRow('Linear', 'Third-party · last used Jul 27', '<span class="mono">openid profile</span>', button('Review')),
    ])),
    activity: accountTabPanel(accountRows([
      settingRow('Realmroot CLI approved', 'openid offline_access', 'Jul 28, 09:14'),
      settingRow('Grafana Cloud revoked', 'openid profile email', 'Jul 21, 12:30'),
    ])),
  }
  return `<div class="profile-hero"><div><h1>Applications</h1><p>Review applications you have authorized to act with your identity.</p></div></div>${accountTabs('applications', [['authorized', 'Authorized apps'], ['activity', 'Activity']])}${panels[active]}`
}

function accountAgents() {
  const active = state.accountTabs.agents
  const panels = {
    identities: accountTabPanel(accountEntityList([
      settingsCard('Sales Copilot', 'did:rr:agent:01J8…A2', [
        settingRow('Account capabilities', 'Read-only account access.', '<span class="mono">profile.read apps.read</span>', button('Review')),
        settingRow('CRM API grant', 'Connected as jane@crm.example.dev · persistent.', '<span class="mono">contacts.read</span>', button('View')),
        settingRow('Billing API grant', 'Native authorization · expires Aug 08.', '<span class="mono">invoices.read</span>', button('View')),
        settingRow('Lifecycle', '2 active grants · last active 6 minutes ago.', status('Active'), button('Manage Agent')),
      ]),
      settingsCard('Research Assistant', 'did:rr:agent:01J7…F9', [
        settingRow('Account capabilities', 'Read-only account access.', '<span class="mono">profile.read</span>', button('Review')),
        settingRow('Documents API grant', 'One target token · consumed Jul 30.', '<span class="mono">documents.read</span>', status('Completed', 'neutral')),
        settingRow('Lifecycle', 'No active API grants · last active yesterday.', status('Active'), button('Manage Agent')),
      ]),
    ])),
    requests: accountTabPanel(accountRows([
      settingRow('Sales Copilot → CRM API', 'Use jane@crm.example.dev · contacts.read contacts.write · persistent', status('Pending', 'warning'), button('Review request', { variant: 'primary' })),
    ])),
    activity: accountTabPanel(accountRows([
      settingRow('Access request created', 'Sales Copilot · CRM API · contacts.write', '6 min ago'),
      settingRow('Access grant completed', 'Research Assistant · Documents API', 'Yesterday'),
      settingRow('Capability revoked', 'Sales Copilot · sessions.read', 'Jul 29'),
    ])),
  }
  return `<div class="profile-hero"><div><h1>Agents</h1><p>Govern stable Agent identities and every authority delegated from your personal space.</p></div></div>${accountTabs('agents', [['identities', 'My Agents'], ['requests', 'Requests · 1'], ['activity', 'Activity']])}${panels[active]}`
}

function accountOrganizations() {
  if (state.accountOrganizationOpen) return accountOrganizationDetail()
  return `<div class="profile-hero account-hero-action"><div><h1>Organizations</h1><p>Create shared spaces and manage the Organizations where you belong.</p></div>${button('New organization', { variant: 'primary', icon: 'plus', drawer: 'New organization' })}</div>${accountTabPanel(accountEntityList([
    settingsCard('Payments Team', 'org_01J8A2', [
      settingRow('Access level', 'Controls Organization administration.', 'Owner'),
      settingRow('Assigned roles', 'Controls API authority in this Organization context.', 'Finance operator'),
      settingRow('Joined', '', 'Jun 18, 2026'),
      settingRow('Organization', 'Manage profile, members, invitations, and available Organization tools.', '12 members', '<div class="setting-actions"><button class="button" data-account-organization type="button">Manage</button><button class="button primary" data-open-organization-console type="button">Open Console</button></div>'),
    ]),
    settingsCard('Family Archive', 'org_01J6B8', [
      settingRow('Access level', 'Controls Organization administration.', 'Owner'),
      settingRow('Assigned roles', 'Controls shared product authority inside this Organization.', 'Archive contributor'),
      settingRow('Joined', '', 'Apr 07, 2026'),
      settingRow('Organization', 'Manage family members, invitations, and shared access.', '5 members', '<button class="button" data-account-organization="family" type="button">Manage</button>'),
    ]),
  ]))}`
}

function accountOrganizationDetail() {
  if (state.accountOrganization === 'family') return accountFamilyOrganizationDetail()
  const active = state.accountTabs.organization
  const panels = {
    overview: accountTabPanel(accountRows([
      settingRow('Your access level', 'Controls Organization administration.', 'Owner'),
      settingRow('Your assigned roles', 'Controls API authority in this Organization context.', 'Finance operator'),
      settingRow('Members', '', '12'),
      settingRow('Agent identities', '', '3'),
      settingRow('Applications & resource servers', '', '4 applications · 3 resource servers'),
      settingRow('Created', '', 'Jun 18, 2026'),
    ])),
    members: accountTabPanel(`${searchToolbar(['Any access level', 'Any status'], button('Invite member', { variant: 'primary', icon: 'plus', drawer: 'Invite organization member' }))}${dataTable(
      ['Member', 'Access level', 'Assigned roles', 'Status', ''],
      [
        { cells: [cell('Jane Stone', 'jane@acme.dev'), 'Owner', 'Finance operator', status('Active'), icon('more')] },
        { cells: [cell('Morgan Lee', 'morgan@acme.dev'), 'Developer', 'Finance operator', status('Active'), icon('more')] },
        { cells: [cell('Sam Rivera', 'sam@acme.dev'), 'Member', 'Expense submitter', status('Active'), icon('more')] },
      ],
    )}`),
    agents: accountTabPanel(accountRows([
      settingRow('Billing Reconciler', 'Stable Agent identity · 2 active hosts.', '1 active grant', button('Review')),
      settingRow('Expense Auditor', 'Stable Agent identity · 1 active host.', 'No access grants', button('Review')),
    ])),
    authority: accountTabPanel(accountRows([
      settingRow('Finance operator', '3 scopes across Billing API and Documents API.', '2 assignments in Payments Team', button('Open in Console')),
      settingRow('Expense submitter', '2 scopes from Expense API.', '12 assignments in Payments Team', button('Open in Console')),
    ])),
    activity: accountTabPanel(accountRows([
      settingRow('Member invited', 'Alex Chen · Developer', 'Jul 29, 2026 · Jane Stone'),
      settingRow('Role assigned', 'Finance operator → Morgan Lee', 'Jul 29, 2026 · Jane Stone'),
      settingRow('API access eligibility changed', 'Billing API → Realm-wide', 'Jul 25, 2026 · Morgan Lee'),
    ])),
    settings: accountTabPanel(accountRows([
      settingRow('Name', '', 'Payments Team', button('Edit', { drawer: 'Edit organization' })),
      settingRow('Leave organization', 'Owners must transfer ownership before leaving.', '', button('Leave', { variant: 'danger' })),
      settingRow('Delete organization', 'Resolve owned resources and active authority first.', '', button('Delete', { variant: 'danger', drawer: 'Delete organization' })),
    ])),
  }
  return `<button class="account-back" data-account-organizations-back type="button">${icon('arrow')} Organizations</button><div class="profile-hero account-hero-action"><div><h1>Payments Team</h1><p>Manage members, Agent identities, shared authority, and Organization settings.</p></div><button class="button primary" data-open-organization-console type="button">Open Console</button></div>${accountTabs('organization', [['overview', 'Overview'], ['members', 'Members'], ['agents', 'Agents'], ['authority', 'Role assignments'], ['activity', 'Activity'], ['settings', 'Settings']])}${panels[active]}`
}

function accountFamilyOrganizationDetail() {
  const active = state.accountTabs.organization
  const panels = {
    overview: accountTabPanel(accountRows([
      settingRow('Your access level', 'Controls Organization administration.', 'Owner'),
      settingRow('Your assigned role', 'Controls shared product authority.', 'Archive contributor'),
      settingRow('Members', '', '5'),
      settingRow('Created', '', 'Apr 07, 2026'),
    ])),
    members: accountTabPanel(`${searchToolbar(['Any access level', 'Any status'], button('Invite member', { variant: 'primary', icon: 'plus', drawer: 'Invite organization member' }))}${dataTable(
      ['Member', 'Access level', 'Shared role', 'Status', ''],
      [
        { cells: [cell('Jane Stone', 'jane@acme.dev'), 'Owner', 'Archive contributor', status('Active'), icon('more')] },
        { cells: [cell('Alex Stone', 'alex@example.com'), 'Member', 'Archive viewer', status('Active'), icon('more')] },
        { cells: [cell('Mia Stone', 'mia@example.com'), 'Member', 'Archive viewer', status('Active'), icon('more')] },
      ],
    )}`),
    authority: accountTabPanel(accountRows([
      settingRow('Archive contributor', 'Upload and organize shared family records.', '2 members'),
      settingRow('Archive viewer', 'View shared records without modifying them.', '3 members'),
    ])),
    activity: accountTabPanel(accountRows([
      settingRow('Member invited', 'Mia Stone · Member', 'Jul 26, 2026 · Jane Stone'),
      settingRow('Shared role assigned', 'Archive viewer → Alex Stone', 'Jul 21, 2026 · Jane Stone'),
    ])),
    settings: accountTabPanel(accountRows([
      settingRow('Name', '', 'Family Archive', button('Edit', { drawer: 'Edit organization' })),
      settingRow('Leave organization', 'Owners must transfer ownership before leaving.', '', button('Leave', { variant: 'danger' })),
      settingRow('Delete organization', 'Remove all memberships and shared authority first.', '', button('Delete', { variant: 'danger', drawer: 'Delete organization' })),
    ])),
  }
  return `<button class="account-back" data-account-organizations-back type="button">${icon('arrow')} Organizations</button><div class="profile-hero"><div><h1>Family Archive</h1><p>Manage family members, shared authority, and Organization settings.</p></div></div>${accountTabs('organization', [['overview', 'Overview'], ['members', 'Members'], ['authority', 'Shared access'], ['activity', 'Activity'], ['settings', 'Settings']])}${panels[active]}`
}

render()
