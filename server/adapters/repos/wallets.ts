import { badRequest } from '@server/domain/errors'
import type { WalletRepository } from '@server/usecases/ports'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { account, verification, walletAddress } from '../../db/schema'

export function createWalletRepository(db: Database): WalletRepository {
  return {
    async findWalletAddress(address, chainId) {
      const [row] = await db
        .select()
        .from(walletAddress)
        .where(and(eq(walletAddress.address, address), eq(walletAddress.chainId, chainId)))

      return row ?? null
    },

    async findAnyWalletAddress(address) {
      const [row] = await db.select().from(walletAddress).where(eq(walletAddress.address, address))
      return row ?? null
    },

    async getSiweNonce(address, chainId) {
      const [row] = await db
        .select({ value: verification.value, expiresAt: verification.expiresAt })
        .from(verification)
        .where(eq(verification.identifier, siweIdentifier(address, chainId)))
        .orderBy(desc(verification.createdAt))

      return row ?? null
    },

    async deleteSiweNonce(address, chainId) {
      await db.delete(verification).where(eq(verification.identifier, siweIdentifier(address, chainId)))
    },

    async linkWalletAddress(userId, input) {
      const existing = await this.findWalletAddress(input.address, input.chainId)
      if (existing) {
        if (existing.userId !== userId) throw badRequest('This wallet is already linked to another account.')
        return existing
      }
      const existingAddress = await this.findAnyWalletAddress(input.address)
      if (existingAddress && existingAddress.userId !== userId) {
        throw badRequest('This wallet is already linked to another account.')
      }

      const [{ value: primaryCount }] = await db
        .select({ value: count() })
        .from(walletAddress)
        .where(eq(walletAddress.userId, userId))

      const [created] = await db
        .insert(walletAddress)
        .values({
          id: createId('wallet'),
          userId,
          address: input.address,
          chainId: input.chainId,
          isPrimary: (primaryCount ?? 0) === 0,
        })
        .returning()

      await db.insert(account).values({
        id: createId('acct'),
        accountId: walletAccountId(input.address, input.chainId),
        providerId: 'siwe',
        userId,
      })

      return created
    },

    async unlinkWalletAddress(userId, accountId) {
      const parsed = parseWalletAccountId(accountId)
      if (!parsed) throw badRequest('Invalid wallet account id.')

      await db
        .delete(walletAddress)
        .where(
          and(
            eq(walletAddress.userId, userId),
            eq(walletAddress.address, parsed.address),
            eq(walletAddress.chainId, parsed.chainId),
          ),
        )
      await db
        .delete(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'siwe'), eq(account.accountId, accountId)))
    },
  }
}

function siweIdentifier(address: string, chainId: number) {
  return `siwe:${address}:${chainId}`
}

export function walletAccountId(address: string, chainId: number) {
  return `${address}:${chainId}`
}

function parseWalletAccountId(value: string) {
  const separator = value.lastIndexOf(':')
  if (separator === -1) return null
  const address = value.slice(0, separator)
  const chainId = Number(value.slice(separator + 1))
  if (!Number.isInteger(chainId) || chainId <= 0) return null
  return { address, chainId }
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}
