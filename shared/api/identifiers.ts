import { z } from 'zod'

export const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const uuidV7Schema = z.string().regex(uuidV7Pattern)
export const agentSubjectSchema = z.union([uuidV7Schema, z.string().regex(/^agt_[a-zA-Z0-9_-]+$/)])
