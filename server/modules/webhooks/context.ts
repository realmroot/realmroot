import { createWebhookRepository } from '@server/adapters/repos/webhooks'
import { WebhookService } from '@server/usecases/webhooks'
import type { Context } from 'hono'
import { createDb } from '../../db/client'
import type { ApplicationBindings } from '../applications/context'

export type WebhookBindings = ApplicationBindings

export function createWebhookService(c: Context<{ Bindings: WebhookBindings }>) {
  return new WebhookService(createWebhookRepository(createDb(c.env.DB)))
}
