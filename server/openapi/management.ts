import managementOpenApi from '../../docs/api/management.openapi.json'

export const managementOpenApiPath = '/api/management/openapi.json'
export const managementOpenApiLinkHeader = [
  `<${managementOpenApiPath}>; rel="service-desc"; type="application/openapi+json"`,
  `<${managementOpenApiPath}>; rel="describedby"; type="application/openapi+json"`,
].join(', ')

export { managementOpenApi }
