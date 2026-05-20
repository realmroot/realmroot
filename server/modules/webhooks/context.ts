import type { Context } from 'hono'
import { createDb } from '../../db/client'
import type { ApplicationBindings } from '../applications/context'
import { createWebhookRepository } from './repository'
import { WebhookService } from './service'

export type WebhookBindings = ApplicationBindings

export function createWebhookService(c: Context<{ Bindings: WebhookBindings }>) {
  return new WebhookService(createWebhookRepository(createDb(c.env.DB)))
}
