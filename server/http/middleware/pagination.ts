import { type PaginationMetadata, paginationMetadataSchema } from '@shared/api/pagination'

export async function responsePagination(response: Response): Promise<PaginationMetadata | null> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) return null
  const text = await response.clone().text()
  if (text.trim().length === 0) return null
  const body: unknown = JSON.parse(text)
  if (typeof body !== 'object' || body === null || !('pagination' in body)) return null
  const parsed = paginationMetadataSchema.safeParse(body.pagination)
  return parsed.success ? parsed.data : null
}

export function paginationLinkHeader(requestUrl: string, pagination: PaginationMetadata): string | null {
  if (pagination.totalPages === 0) return null
  const links: string[] = []
  if (pagination.page > 1) {
    links.push(link(requestUrl, 1, pagination.pageSize, 'first'))
    links.push(link(requestUrl, pagination.page - 1, pagination.pageSize, 'previous'))
  }
  if (pagination.page < pagination.totalPages) {
    links.push(link(requestUrl, pagination.page + 1, pagination.pageSize, 'next'))
    links.push(link(requestUrl, pagination.totalPages, pagination.pageSize, 'last'))
  }
  return links.length ? links.join(', ') : null
}

function link(requestUrl: string, page: number, pageSize: number, relation: string) {
  const url = new URL(requestUrl)
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(pageSize))
  return `<${url.toString()}>; rel="${relation}"`
}
