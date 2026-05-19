import { z } from 'zod'

export const assetPurposeSchema = z.enum([
  'avatar',
  'application_logo',
  'organization_logo',
  'branding_logo',
  'favicon',
])

export const uploadedAssetResponseSchema = z.object({
  asset: z.object({
    id: z.string(),
    purpose: assetPurposeSchema,
    publicUrl: z.string(),
    contentType: z.string(),
    byteSize: z.number().int().positive(),
    checksumSha256: z.string(),
    createdAt: z.string(),
  }),
})

export type AssetPurpose = z.infer<typeof assetPurposeSchema>
export type UploadedAssetResponse = z.infer<typeof uploadedAssetResponseSchema>
