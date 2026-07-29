import { emergencyRetireAgentIdentity, getAgent, listAllAgents } from '@server/usecases/agent-identities'
import { agentResponseSchema, agentsResponseSchema } from '@shared/api/agent-api'
import { agentAuditEventSchema } from '@shared/api/agents'
import { paginationMetadata, paginationQuerySchema } from '@shared/api/pagination'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/admin'
import { getDeps } from '../../middleware/deps'
import { readQuery } from '../validation'

export const managementAgentsRoute = new Hono()

managementAgentsRoute.use('/agents', requireAdmin())
managementAgentsRoute.use('/agents/*', requireAdmin())
managementAgentsRoute.use('/audit-events', requireAdmin())

managementAgentsRoute.get('/agents', async (c) => {
  return c.json(agentsResponseSchema.parse(await listAllAgents(getDeps(c), readQuery(c, paginationQuerySchema))))
})

managementAgentsRoute.get('/agents/:agentId', async (c) => {
  return c.json(
    agentResponseSchema.parse({
      agent: await getAgent(getDeps(c), c.req.param('agentId')),
    }),
  )
})

managementAgentsRoute.delete('/agents/:agentId', async (c) => {
  await emergencyRetireAgentIdentity(getDeps(c), c.req.param('agentId'))
  return c.body(null, 204)
})

managementAgentsRoute.get('/audit-events', async (c) => {
  const query = readQuery(c, paginationQuerySchema)
  const result = await getDeps(c).agentAudit.list(query)
  return c.json({
    items: result.items.map((event) => agentAuditEventSchema.parse(event)),
    pagination: paginationMetadata({ ...query, total: result.total }),
  })
})
