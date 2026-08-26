export interface WikiGraphQueryParams {
  mode?: 'overview' | 'ego'
  center?: string
  depth?: number
  types?: string[]
  knowledge_ids?: string[]
  limit?: number
}

export function buildWikiGraphQuery(params?: WikiGraphQueryParams): string {
  const query = new URLSearchParams()
  if (params) {
    if (params.mode) query.set('mode', params.mode)
    if (params.center) query.set('center', params.center)
    if (params.depth !== undefined) query.set('depth', String(params.depth))
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    if (params.types && params.types.length > 0) {
      query.set('types', params.types.join(','))
    }
    if (params.knowledge_ids && params.knowledge_ids.length > 0) {
      query.set('knowledge_ids', params.knowledge_ids.join(','))
    }
  }
  return query.toString()
}
