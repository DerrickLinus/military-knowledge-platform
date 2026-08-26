import type { WikiGraphQueryParams } from '@/api/wiki/query'

export const WIKI_GRAPH_MAX_KNOWLEDGE_IDS = 100

export function normalizeWikiGraphKnowledgeIDs(ids: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of ids || []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }
  return normalized
}

export function withWikiGraphScope(
  params: WikiGraphQueryParams,
  knowledgeIDs: readonly string[] | null | undefined,
): WikiGraphQueryParams {
  const normalized = normalizeWikiGraphKnowledgeIDs(knowledgeIDs)
  if (normalized.length === 0) return params
  return { ...params, knowledge_ids: normalized }
}
