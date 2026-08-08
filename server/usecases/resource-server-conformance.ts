import { ApiError } from '@server/domain/errors'
import type { Deps } from '@server/usecases/deps'
import { inspectExternalResourceConnector } from '@server/usecases/resource-connectors'
import { type ProtectedResourceMetadata, readProtectedResourceMetadata } from '@server/usecases/resource-metadata'
import {
  type ResourceContractDefinition,
  readResourceContract,
  validateResourceUrl,
} from '@server/usecases/resource-openapi'
import type { AuthorizationDetail } from '@shared/api/authorization-details'
import type { ResourceServerConformanceCheck } from '@shared/api/management'

export interface ResourceServerConformanceResult {
  metadata: ProtectedResourceMetadata
  contract: ResourceContractDefinition
}

export async function requireResourceServerConformance(
  deps: Deps,
  input: { resourceUrl: string; connectorId: string | null; authorizationDetails: AuthorizationDetail[] },
): Promise<ResourceServerConformanceResult> {
  try {
    validateResourceUrl(input.resourceUrl)
  } catch (error) {
    const checks: ResourceServerConformanceCheck[] = [
      check('RESOURCE-HTTPS', errorMessage(error)),
      blocked('RESOURCE-METADATA', 'Metadata validation is blocked until RESOURCE-HTTPS passes.'),
      blocked('API-SERVICE-DESC', 'Service description validation is blocked until RESOURCE-HTTPS passes.'),
      blocked('API-OPENAPI', 'OpenAPI validation is blocked until API-SERVICE-DESC passes.'),
    ]
    if (input.connectorId) {
      try {
        checks.push(
          ...(await inspectExternalResourceConnector(deps, input.connectorId, input.authorizationDetails, null)),
        )
      } catch (connectorError) {
        if (!(connectorError instanceof ApiError)) throw connectorError
        checks.push(check('OIDC-CONNECTION', errorMessage(connectorError)))
      }
    }
    throw conformanceError(checks)
  }

  const [metadataResult, contractResult] = await Promise.allSettled([
    readProtectedResourceMetadata(deps, input.resourceUrl),
    readResourceContract(deps, input.resourceUrl),
  ])
  const checks: ResourceServerConformanceCheck[] = []
  const gatewayFailure = [metadataResult, contractResult].some(
    (result) => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 502,
  )
  const metadata = metadataResult.status === 'fulfilled' ? metadataResult.value : null
  const contract = contractResult.status === 'fulfilled' ? contractResult.value : null

  if (metadataResult.status === 'rejected') {
    checks.push(check('RESOURCE-METADATA', errorMessage(metadataResult.reason)))
  }
  if (!contract) {
    const reason =
      contractResult.status === 'rejected' ? contractResult.reason : new Error('OpenAPI document was empty.')
    const requirement = contractRequirement(reason)
    checks.push(check(requirement, errorMessage(reason)))
    if (requirement === 'API-SERVICE-DESC') {
      checks.push(blocked('API-OPENAPI', 'OpenAPI validation is blocked until API-SERVICE-DESC passes.'))
    }
  }

  if (metadata && contract) {
    const advertised = new Set(metadata.scopesSupported)
    const missing = contract.operations.flatMap((operation) =>
      operation.requiredScopeSets
        .flat()
        .filter((scope) => !advertised.has(scope))
        .map((scope) => `${operation.method} ${operation.path}: ${scope}`),
    )
    if (missing.length) {
      checks.push(
        check(
          'API-OPENAPI',
          `OpenAPI operations require scopes not advertised by RFC 9728 metadata: ${[...new Set(missing)].join(', ')}.`,
        ),
      )
    }
  }

  if (input.connectorId) {
    try {
      checks.push(
        ...(await inspectExternalResourceConnector(deps, input.connectorId, input.authorizationDetails, metadata)),
      )
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      checks.push(check('OIDC-CONNECTION', errorMessage(error)))
    }
  } else if (input.authorizationDetails.length) {
    checks.push(check('RICH-AUTHORIZATION', 'Authorization details require an external API resource connector.'))
  }

  if (checks.length) throw conformanceError(checks, gatewayFailure)
  if (!metadata || !contract) throw new Error('Conformance passed without complete discovery results.')
  return { metadata, contract }
}

function contractRequirement(error: unknown): ResourceServerConformanceCheck['requirement'] {
  if (error instanceof ApiError && error.details?.stage === 'openapi_document') return 'API-OPENAPI'
  return errorMessage(error).includes('OpenAPI document') && !errorMessage(error).includes('advertise')
    ? 'API-OPENAPI'
    : 'API-SERVICE-DESC'
}

function conformanceError(checks: ResourceServerConformanceCheck[], gatewayFailure = false) {
  const status = gatewayFailure ? 502 : 400
  return new ApiError(
    status,
    status === 502 ? 'bad_gateway' : 'bad_request',
    'Resource Server does not satisfy the Realmroot integration profile.',
    { checks },
  )
}

function check(
  requirement: ResourceServerConformanceCheck['requirement'],
  message: string,
): ResourceServerConformanceCheck {
  return { requirement, status: 'failed', message }
}

function blocked(
  requirement: ResourceServerConformanceCheck['requirement'],
  message: string,
): ResourceServerConformanceCheck {
  return { requirement, status: 'blocked', message }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Resource Server validation failed.'
}
