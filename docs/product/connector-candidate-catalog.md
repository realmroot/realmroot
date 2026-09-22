# Connector Candidate Catalog

This catalog is the working discovery queue for Resource providers that could
become available through Realmroot Toolbox. It is deliberately broader than
the committed Adapter roadmap: inclusion records user value and ecosystem
demand, not an implementation promise or compatibility claim.

Realmroot does not provide an Agent runtime. A Connector makes an existing
Resource discoverable and callable from Toolbox while Realmroot preserves the
stable Agent, controller approval, exact authority, credential isolation, and
audit boundaries. Providers that implement the Agent-native Resource Server
Profile directly should be integrated natively; an Adapter is a compatibility
bridge for providers that do not.

## How to use this catalog

Priority expresses evaluation order only:

- **P0** — evaluate for the first useful cross-Resource Toolbox portfolio;
- **P1** — high-value follow-on provider or category coverage;
- **P2** — visible backlog that needs demand or a compelling identity model.

State has a narrower meaning:

- **implemented** — a provider module exists in `realmroot/adapters`; this does
  not imply production readiness or complete API coverage;
- **roadmap** — named in the Adapter roadmap but no provider module exists;
- **candidate** — discovered from provider and competitor catalogs and not yet
  accepted into the Adapter roadmap.

Module presence and roadmap membership were checked on 2026-09-22 against the
[provider modules](https://github.com/realmroot/adapters/tree/main/src/providers)
and [Adapter roadmap](https://github.com/realmroot/adapters/blob/main/ROADMAP.md).
Candidate entries are research leads, not verified availability claims. Check
provider availability, retirement plans, and supported API access before
promoting a candidate or starting implementation.

Before a candidate becomes a proposal, its provider report must pass the
[Adapter proposal gate](https://github.com/realmroot/adapters/blob/main/ROADMAP.md#proposal-gate).
Identity fidelity, authorization, revocation, and audit remain more important
than operation count.

## Discovery sources

The selection was compiled on 2026-09-05 from the public catalogs and product
surfaces of:

- [Composio Toolkits](https://docs.composio.dev/toolkits) — broad SaaS and API
  inventory;
- [Pipedream Connect](https://pipedream.com/connect) — managed authentication,
  actions, triggers, and API coverage;
- [Nango integrations](https://nango.dev/) — code-first and self-hostable API
  integrations;
- [StackOne connectors](https://www.stackone.com/) — enterprise systems and
  agent actions;
- [Paragon integrations](https://www.useparagon.com/integrations) — embedded
  B2B SaaS integrations;
- [Merge Agent Handler](https://docs.merge.dev/merge-agent-handler/overview) —
  enterprise tool-calling connectors.

The catalogs are discovery inputs only. Realmroot does not inherit their
support claims, schemas, security properties, or provider mappings.

## Portfolio summary

| Domain | Candidates |
| --- | ---: |
| Developer collaboration and work management | 24 |
| Cloud and infrastructure | 25 |
| Delivery, observability, and security | 22 |
| Google and Microsoft productivity | 20 |
| Communication and customer support | 18 |
| CRM, sales, and marketing | 24 |
| Data, databases, analytics, and search | 20 |
| Finance, commerce, and payments | 18 |
| Files, content, knowledge, and design | 14 |
| HR and recruiting | 15 |
| **Total** | **200** |

## Developer collaboration and work management

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| GitHub | P0 | implemented | installations, repositories, issues, pull requests |
| GitLab | P0 | roadmap | groups, projects, merge requests, issues |
| Bitbucket | P0 | roadmap | workspaces, repositories, pull requests |
| Azure DevOps | P1 | candidate | organizations, projects, repositories, pipelines, work items |
| Linear | P0 | implemented | workspaces, teams, projects, issues, comments |
| Jira | P0 | roadmap | sites, projects, issues, comments |
| Confluence | P0 | roadmap | sites, spaces, pages, comments |
| Asana | P0 | roadmap | workspaces, projects, tasks, comments |
| ClickUp | P1 | candidate | workspaces, spaces, lists, tasks |
| Trello | P1 | candidate | workspaces, boards, lists, cards |
| monday.com | P1 | candidate | workspaces, boards, items, updates |
| Notion | P0 | roadmap | workspaces, pages, databases, comments |
| Coda | P1 | candidate | docs, tables, rows, pages |
| Airtable | P1 | candidate | bases, tables, records, views |
| Basecamp | P2 | candidate | accounts, projects, todos, messages |
| Shortcut | P2 | candidate | workspaces, stories, epics, iterations |
| Height | P2 | candidate | workspaces, lists, tasks, messages |
| YouTrack | P2 | candidate | projects, issues, articles |
| Productboard | P2 | candidate | products, features, notes, objectives |
| Aha! | P2 | candidate | workspaces, products, features, releases |
| Context7 | P0 | implemented | libraries and current documentation |
| Todoist | P0 | implemented | projects and tasks |
| GitBook | P2 | candidate | organizations, spaces, pages |
| Slite | P2 | candidate | organizations, docs, collections |

## Cloud and infrastructure

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Cloudflare | P0 | implemented | accounts, zones, DNS, Workers, storage |
| Amazon Web Services | P0 | roadmap | accounts, roles, regional Resources, audit identity |
| Google Cloud | P0 | roadmap | projects, service accounts, workload identity, Resources |
| Microsoft Azure | P0 | candidate | subscriptions, resource groups, managed Resources |
| Microsoft Entra ID | P0 | roadmap | tenants, applications, service principals, Agent identities |
| Kubernetes | P0 | candidate | clusters, namespaces, workloads, configuration |
| Docker Hub | P1 | candidate | organizations, repositories, images, access tokens |
| Terraform Cloud | P0 | candidate | organizations, workspaces, runs, state versions |
| Pulumi Cloud | P1 | candidate | organizations, stacks, deployments |
| Vercel | P0 | roadmap | teams, projects, deployments, domains |
| Netlify | P1 | candidate | teams, sites, deployments, domains |
| Heroku | P1 | candidate | teams, applications, pipelines, releases |
| Render | P1 | candidate | workspaces, services, deployments |
| Fly.io | P1 | candidate | organizations, applications, machines, volumes |
| DigitalOcean | P1 | candidate | projects, droplets, Kubernetes, databases |
| Vultr | P2 | candidate | accounts, instances, networks, databases |
| Akamai | P2 | candidate | accounts, properties, edge configuration |
| Fastly | P2 | candidate | services, versions, domains, edge configuration |
| Oracle Cloud Infrastructure | P2 | candidate | tenancies, compartments, cloud Resources |
| IBM Cloud | P2 | candidate | accounts, resource groups, cloud Resources |
| Red Hat OpenShift | P1 | candidate | clusters, projects, operators, workloads |
| Argo CD | P0 | candidate | projects, applications, sync and rollout state |
| Rancher | P1 | candidate | environments, clusters, projects, workloads |
| HashiCorp Vault | P0 | candidate | namespaces, auth methods, policies, secret metadata |
| Tailscale | P1 | candidate | tailnets, devices, users, ACL policy |

## Delivery, observability, and security

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| CircleCI | P1 | candidate | organizations, projects, pipelines, workflows |
| Buildkite | P1 | candidate | organizations, pipelines, builds, jobs |
| Jenkins | P1 | candidate | controllers, jobs, builds, credentials metadata |
| TeamCity | P2 | candidate | projects, build configurations, builds |
| Travis CI | P2 | candidate | organizations, repositories, builds |
| Sentry | P0 | candidate | organizations, projects, issues, releases |
| Datadog | P0 | candidate | monitors, incidents, dashboards, logs |
| Grafana Cloud | P0 | candidate | stacks, dashboards, alerts, incidents |
| New Relic | P1 | candidate | accounts, entities, alerts, incidents |
| PagerDuty | P0 | candidate | services, incidents, schedules, escalation policies |
| Opsgenie | P2 | candidate | migration-only evaluation for existing customers; [support ends April 5, 2027](https://www.atlassian.com/software/opsgenie/migration) |
| Better Stack | P1 | candidate | monitors, incidents, status pages, logs |
| Honeycomb | P2 | candidate | environments, datasets, queries, triggers |
| Splunk Cloud | P1 | candidate | indexes, searches, alerts, saved searches |
| Elastic Cloud | P1 | candidate | deployments, Elasticsearch, Kibana, alerts |
| LaunchDarkly | P1 | candidate | projects, environments, flags, segments |
| ConfigCat | P2 | candidate | products, configs, environments, flags |
| PostHog | P1 | candidate | projects, events, insights, feature flags |
| Amplitude | P2 | candidate | organizations, projects, events, cohorts |
| Snyk | P1 | candidate | organizations, projects, targets, issues |
| SonarCloud | P1 | candidate | organizations, projects, analyses, issues |
| Semgrep | P1 | candidate | deployments, projects, findings, policies |

## Google and Microsoft productivity

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Gmail | P0 | candidate | mailboxes, messages, threads, drafts |
| Google Calendar | P0 | candidate | calendars, events, availability |
| Google Drive | P0 | candidate | drives, files, permissions, comments |
| Google Docs | P1 | candidate | documents, content, suggestions |
| Google Sheets | P0 | candidate | spreadsheets, sheets, ranges |
| Google Slides | P1 | candidate | presentations, slides, elements |
| Google Forms | P2 | candidate | forms, questions, responses |
| Google Tasks | P1 | candidate | task lists and tasks |
| Google Contacts | P2 | candidate | people, contacts, contact groups |
| Google Workspace Admin | P1 | candidate | organizations, users, groups, devices |
| Microsoft Outlook Mail | P0 | candidate | mailboxes, messages, folders, drafts |
| Microsoft Outlook Calendar | P0 | candidate | calendars, events, availability |
| Microsoft OneDrive | P0 | candidate | drives, files, permissions |
| Microsoft SharePoint | P0 | candidate | sites, lists, drives, permissions |
| Microsoft Excel | P1 | candidate | workbooks, worksheets, tables, ranges |
| Microsoft Word | P1 | candidate | documents and content |
| Microsoft PowerPoint | P2 | candidate | presentations and slides |
| Microsoft Teams | P0 | roadmap | teams, channels, messages, meetings |
| Microsoft Planner | P1 | candidate | plans, buckets, tasks |
| Microsoft To Do | P2 | candidate | lists and tasks |

## Communication and customer support

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Slack | P0 | roadmap | workspaces, channels, messages, users |
| Discord | P1 | candidate | guilds, channels, messages, members |
| Zoom | P1 | candidate | users, meetings, recordings, webinars |
| Twilio | P1 | candidate | accounts, phone numbers, messages, calls |
| SendGrid | P1 | candidate | senders, messages, templates, suppression lists |
| Mailgun | P2 | candidate | domains, messages, templates, events |
| Postmark | P2 | candidate | servers, messages, templates, streams |
| Intercom | P0 | candidate | workspaces, contacts, conversations, tickets |
| Zendesk | P0 | candidate | accounts, users, tickets, help-center content |
| Freshdesk | P1 | candidate | accounts, contacts, tickets, conversations |
| Front | P1 | candidate | accounts, inboxes, conversations, messages |
| Help Scout | P2 | candidate | mailboxes, customers, conversations |
| Gorgias | P1 | candidate | accounts, customers, tickets, messages |
| Crisp | P2 | candidate | workspaces, contacts, conversations |
| Kustomer | P2 | candidate | organizations, customers, conversations |
| Dialpad | P2 | candidate | offices, users, calls, messages |
| RingCentral | P2 | candidate | accounts, extensions, calls, messages |
| Telegram | P1 | candidate | bots, chats, messages, files |

## CRM, sales, and marketing

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Salesforce | P0 | candidate | organizations, objects, records, metadata |
| HubSpot | P0 | candidate | portals, CRM objects, engagements, pipelines |
| Pipedrive | P1 | candidate | companies, people, deals, activities |
| Zoho CRM | P1 | candidate | organizations, modules, records, workflows |
| Attio | P1 | candidate | workspaces, objects, records, lists |
| Close | P2 | candidate | organizations, leads, contacts, activities |
| Copper | P2 | candidate | companies, people, opportunities, activities |
| Microsoft Dynamics 365 | P1 | candidate | environments, entities, records, processes |
| Apollo.io | P1 | candidate | accounts, contacts, sequences, activities |
| Outreach | P1 | candidate | organizations, prospects, sequences, tasks |
| Salesloft | P1 | candidate | teams, people, cadences, activities |
| Gong | P1 | candidate | workspaces, calls, users, transcripts |
| Clay | P2 | candidate | workspaces, tables, records, enrichment actions |
| Adobe Marketo Engage | P2 | candidate | workspaces, leads, programs, activities |
| Mailchimp | P1 | candidate | accounts, audiences, campaigns, members |
| Klaviyo | P1 | candidate | accounts, profiles, lists, campaigns |
| ActiveCampaign | P2 | candidate | accounts, contacts, lists, automations |
| Brevo | P2 | candidate | accounts, contacts, campaigns, messages |
| Customer.io | P2 | candidate | workspaces, customers, campaigns, messages |
| Braze | P2 | candidate | workspaces, users, segments, campaigns |
| Iterable | P2 | candidate | projects, users, lists, campaigns |
| Segment | P1 | candidate | workspaces, sources, destinations, tracking plans |
| Hightouch | P2 | candidate | workspaces, sources, models, syncs |
| Census | P2 | candidate | workspaces, sources, models, syncs |

## Data, databases, analytics, and search

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Snowflake | P0 | candidate | organizations, accounts, databases, warehouses |
| Databricks | P0 | candidate | workspaces, catalogs, jobs, SQL warehouses |
| Google BigQuery | P1 | candidate | projects, datasets, tables, jobs |
| Supabase | P1 | candidate | organizations, projects, databases, storage |
| Neon | P1 | candidate | organizations, projects, branches, databases |
| MongoDB Atlas | P1 | candidate | organizations, projects, clusters, databases |
| PostgreSQL | P1 | candidate | servers, databases, schemas, query operations |
| MySQL | P2 | candidate | servers, databases, schemas, query operations |
| ClickHouse | P1 | candidate | organizations, services, databases, queries |
| Redis Cloud | P2 | candidate | subscriptions, databases, access controls |
| Pinecone | P1 | candidate | projects, indexes, namespaces, vectors |
| Weaviate | P2 | candidate | clusters, collections, objects, queries |
| Qdrant | P2 | candidate | clusters, collections, points, queries |
| Algolia | P1 | candidate | applications, indexes, records, search |
| Mixpanel | P2 | candidate | organizations, projects, events, reports |
| Looker | P1 | candidate | instances, folders, models, looks, dashboards |
| Tableau | P1 | candidate | sites, projects, workbooks, views |
| Microsoft Power BI | P1 | candidate | workspaces, datasets, reports, dashboards |
| Metabase | P2 | candidate | instances, collections, questions, dashboards |
| Search1API | P0 | implemented | web search, news search, and usage |

## Finance, commerce, and payments

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Stripe | P0 | candidate | accounts, customers, payments, subscriptions |
| PayPal | P1 | candidate | merchants, orders, payments, disputes |
| Adyen | P1 | candidate | merchants, payments, payouts, disputes |
| Square | P1 | candidate | merchants, locations, orders, payments |
| Plaid | P1 | candidate | items, accounts, transactions, identity |
| Brex | P1 | candidate | organizations, accounts, cards, expenses |
| Ramp | P1 | candidate | businesses, cards, transactions, expenses |
| Mercury | P2 | candidate | organizations, accounts, transactions, payments |
| QuickBooks Online | P1 | candidate | companies, customers, invoices, payments |
| Xero | P1 | candidate | organizations, contacts, invoices, payments |
| NetSuite | P1 | candidate | accounts, records, transactions, saved searches |
| Shopify | P0 | candidate | shops, products, orders, customers |
| WooCommerce | P2 | candidate | stores, products, orders, customers |
| BigCommerce | P2 | candidate | stores, catalogs, orders, customers |
| Chargebee | P2 | candidate | sites, customers, subscriptions, invoices |
| Paddle | P2 | candidate | businesses, customers, subscriptions, transactions |
| Coinbase | P2 | candidate | organizations, accounts, assets, transactions |
| Wise | P2 | candidate | profiles, accounts, recipients, transfers |

## Files, content, knowledge, and design

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Fast.io | P0 | implemented | workspaces and profile availability |
| Dropbox | P0 | candidate | teams, namespaces, files, sharing |
| Box | P0 | candidate | enterprises, folders, files, collaborations |
| Egnyte | P2 | candidate | domains, folders, files, permissions |
| Miro | P1 | candidate | organizations, teams, boards, items |
| Figma | P0 | candidate | organizations, teams, projects, files, comments |
| Canva | P1 | candidate | teams, designs, assets, exports |
| Contentful | P1 | candidate | organizations, spaces, environments, entries |
| Sanity | P2 | candidate | organizations, projects, datasets, documents |
| Webflow | P1 | candidate | workspaces, sites, collections, items |
| WordPress | P2 | candidate | sites, posts, pages, media |
| DocuSign | P1 | candidate | accounts, templates, envelopes, recipients |
| PandaDoc | P2 | candidate | workspaces, templates, documents, recipients |
| Loom | P2 | candidate | workspaces, videos, transcripts, comments |

## HR and recruiting

| Provider | Priority | State | Initial Resource focus |
| --- | --- | --- | --- |
| Workday | P0 | candidate | tenants, workers, organizations, staffing events |
| BambooHR | P1 | candidate | companies, employees, time off, reports |
| Rippling | P1 | candidate | companies, workers, groups, applications |
| Deel | P1 | candidate | organizations, people, contracts, payroll |
| Gusto | P2 | candidate | companies, employees, payroll, benefits |
| Greenhouse | P1 | candidate | organizations, candidates, jobs, applications |
| Lever | P1 | candidate | organizations, opportunities, postings, interviews |
| Ashby | P1 | candidate | organizations, candidates, jobs, applications |
| Workable | P2 | candidate | accounts, jobs, candidates, members |
| Personio | P1 | candidate | companies, employees, absences, recruiting |
| HiBob | P1 | candidate | companies, people, time off, lifecycle events |
| ADP | P2 | candidate | organizations, workers, payroll, benefits |
| SAP SuccessFactors | P2 | candidate | tenants, people, jobs, learning records |
| Cornerstone | P2 | candidate | portals, users, learning objects, assignments |
| Culture Amp | P2 | candidate | organizations, employees, surveys, engagement data |

## Evaluation sequence

The initial P0 portfolio should prove useful cross-Resource journeys rather
than isolated demos. The first evaluation batch should cover:

1. **Build and ship:** GitHub, Linear, Cloudflare, Vercel, Argo CD, and Sentry.
2. **Coordinate work:** Slack, Jira, Notion, Google Calendar, and Gmail.
3. **Operate infrastructure:** AWS, Google Cloud, Azure, Kubernetes, Vault, and
   Datadog.
4. **Move business data:** Salesforce, HubSpot, Stripe, Shopify, Snowflake, and
   Google Sheets.
5. **Retrieve knowledge:** Context7, Search1API, Google Drive, SharePoint,
   Dropbox, and Box.

For each provider, evaluation begins with actor semantics and the strongest
available credential model. API breadth is scoped only after the provider's
identity, authorization, revocation, and audit behavior is documented.
