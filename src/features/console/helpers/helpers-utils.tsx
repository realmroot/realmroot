import {
  type ConnectorResponse,
  type CSSProperties,
  emptyForm,
  type FormState,
  hostedCustomCssSchema,
  type ManagementUserResponse,
  tokenClaimsObjectSchema,
  tt,
  useMutation,
  useState,
  type z,
} from '../console-shared'

export function parseForm<T extends z.ZodType>(schema: T, form: unknown): z.infer<T> {
  const result = schema.safeParse(removeBlankValues(form))
  if (!result.success) throw new Error(tt(result.error.issues[0]?.message ?? 'Invalid form input.'))
  return result.data
}
export function parseMetadata(value: string | undefined) {
  if (!value?.trim()) return undefined
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tt('Provider metadata must be a JSON object.'))
  }
  return parsed as Record<string, unknown>
}
export function parseConnectorMetadata(form: FormState) {
  const metadata = parseMetadata(form.providerMetadata) ?? {}
  for (const [key, value] of Object.entries(form)) {
    if (!key.startsWith('metadata.') || value === '') continue
    const metadataKey = key.replace('metadata.', '')
    metadata[metadataKey] = metadataKey === 'allowUsersWithoutEmail' ? value === 'true' : value
  }
  return Object.keys(metadata).length ? metadata : undefined
}
export function connectorFieldLabel(field: string) {
  return field
    .replace(/URI/g, 'Uri')
    .replace(/ID/g, 'Id')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bUri\b/g, 'URI')
    .replace(/\bId\b/g, 'ID')
}
export function connectorUpdateForm(form: FormState) {
  const input = {
    ...form,
    clientId: nullableFormValue(form.clientId),
    issuer: nullableFormValue(form.issuer),
    authorizationEndpoint: nullableFormValue(form.authorizationEndpoint),
    tokenEndpoint: nullableFormValue(form.tokenEndpoint),
    userInfoEndpoint: nullableFormValue(form.userInfoEndpoint),
    jwksEndpoint: nullableFormValue(form.jwksEndpoint),
  }
  if (form.clientSecret?.trim()) {
    return {
      ...input,
      clientSecret: form.clientSecret.trim(),
    }
  }
  return input
}
export function nullableFormValue(value: string | undefined) {
  return value === '' ? null : value
}
export function connectorToForm(connector: ConnectorResponse | null): FormState {
  if (!connector) return emptyForm
  return {
    slug: connector.slug,
    displayName: connector.displayName,
    enabled: String(connector.enabled),
    clientId: connector.clientId ?? '',
    clientSecret: '',
    issuer: connector.issuer ?? '',
    authorizationEndpoint: connector.authorizationEndpoint ?? '',
    tokenEndpoint: connector.tokenEndpoint ?? '',
    userInfoEndpoint: connector.userInfoEndpoint ?? '',
    jwksEndpoint: connector.jwksEndpoint ?? '',
    scopes: connector.scopes.join(' '),
    providerMetadata: JSON.stringify(connector.providerMetadata, null, 2),
    ...Object.fromEntries(
      Object.entries(connector.providerMetadata).flatMap(([key, value]) =>
        typeof value === 'string' || typeof value === 'boolean' ? [[`metadata.${key}`, String(value)]] : [],
      ),
    ),
  }
}
export function removeBlankValues(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ''))
}
export function shallowEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) return false
  return leftEntries.every(([key, value]) => Object.is(value, right[key]))
}
export function nullableString(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
export function parseTokenClaims(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = JSON.parse(trimmed) as unknown
  return tokenClaimsObjectSchema.parse(parsed)
}
export function parseLineList(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
export function parseCustomData(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tt('Custom data JSON must be an object.'))
  }
  return parsed as Record<string, unknown>
}
export function customCssProperties(css: string): CSSProperties {
  const result = hostedCustomCssSchema.safeParse(css)
  if (!result.success) return {}
  return Object.fromEntries(
    result.data
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(':')
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]
      }),
  ) as CSSProperties
}
export function setValue(setForm: (next: (form: FormState) => FormState) => void, key: string, value: string) {
  setForm((form) => ({
    ...form,
    [key]: value,
  }))
}
export function useAdminMutation<TInput, TOutput>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (input: TInput) => Promise<TOutput>
  onSuccess: (output: TOutput) => Promise<unknown>
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn,
    onMutate: () => setErrorMessage(null),
    onError: (error) => setErrorMessage(error instanceof Error ? tt(error.message) : tt('Request failed.')),
    onSuccess,
  })
  return {
    data: mutation.data,
    error: mutation.error,
    errorMessage,
    isPending: mutation.isPending,
    mutate: (input: TInput) => mutation.mutate(input),
    reset: () => {
      setErrorMessage(null)
      mutation.reset()
    },
  }
}
export function formatDate(value: string | Date | undefined) {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString()
}
export function formatRole(role: ManagementUserResponse['role']) {
  if (Array.isArray(role)) return role.join(', ')
  return role ?? 'user'
}
export function userDisplayName(user: ManagementUserResponse) {
  return user.displayName ?? user.name ?? user.email ?? user.id
}
