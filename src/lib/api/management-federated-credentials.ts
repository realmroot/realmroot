import type {
  CreateManagementFederatedCredentialRequest,
  CreateManagementFederatedCredentialResponse,
  ListManagementFederatedCredentialsResponse,
  UpdateManagementFederatedCredentialRequest,
} from '@shared/api/management'
import { apiClient, readRpcResponse } from '@/lib/api'

export function listFederatedCredentials(applicationId: string): Promise<ListManagementFederatedCredentialsResponse> {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['federated-credentials'].$get({
      param: { applicationId },
    }),
  )
}

export function createFederatedCredential(
  applicationId: string,
  input: CreateManagementFederatedCredentialRequest,
): Promise<CreateManagementFederatedCredentialResponse> {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['federated-credentials'].$post({
      param: { applicationId },
      json: input,
    }),
  )
}

export function updateFederatedCredential(
  applicationId: string,
  credentialId: string,
  input: UpdateManagementFederatedCredentialRequest,
): Promise<CreateManagementFederatedCredentialResponse> {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['federated-credentials'][':credentialId'].$patch({
      param: { applicationId, credentialId },
      json: input,
    }),
  )
}

export function deleteFederatedCredential(applicationId: string, credentialId: string) {
  return readRpcResponse(
    apiClient.api.applications[':applicationId']['federated-credentials'][':credentialId'].$delete({
      param: { applicationId, credentialId },
    }),
  )
}
