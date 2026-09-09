// answerExport.ts
//
// Shared content model for exporting a single chat answer to Word (.docx) or
// Markdown (.md). Both formats must contain the same three parts: the question,
// the final answer body, and the citation sources, so the model is built once
// from a synchronous snapshot of the message state and then handed to either
// generator (see answerWordExport.ts for the Word side).
//
// Citation handling: the answer body carries project-specific citation tags
// (`<kb chunk_id="…" doc="…"/>`, `<web url="…" title="…"/>`) plus `[[wiki]]`
// links. Chat rendering turns them into interactive pills; export must instead
// turn them into readable `[n]` markers that point at a unified, de-duplicated
// source list at the end of the document. Source merging reuses the reference
// drawer rules (referenceSources.ts) so the exported list matches what the user
// saw in the UI, but the export numbering is independent: all categories share
// one 1..N sequence instead of the per-category drawer ordinals.

import {
  buildReferenceList,
  getDomainFromUrl,
  normalizeReferenceUrl,
  type KnowledgeReferenceLike,
  type ReferenceListItem,
} from './referenceSources'
import {
  docTitlesMatch,
  parseTagAttributes,
  resolveCitationChunkId,
  type CitationKnowledgeRef,
} from './citationMarkdown'
import { unwrapFinalAnswerWrappers } from './finalAnswer'

export type AnswerExportFormat = 'word' | 'markdown'

/** Localised section labels embedded in the generated documents. */
export type AnswerExportLabels = {
  question: string
  answer: string
  sources: string
  unresolvedCitation: string
  imageLabel: string
}

/** One entry of the unified, de-duplicated source list appended to exports. */
export type AnswerExportSource = {
  index: number
  kind: 'web' | 'document' | 'tool'
  title: string
  url?: string
  /** Existing location info we can carry over (e.g. the tool name for tool results). */
  location?: string
}

/** Fully resolved snapshot of one answer, ready to be rendered to any format. */
export type AnswerExportModel = {
  question: string
  /** Final answer markdown with citation tags replaced by `[n]` markers. */
  answerMarkdown: string
  references: AnswerExportSource[]
  /** File name without extension. */
  filenameBase: string
  labels: AnswerExportLabels
}

const KB_TAG_RE = /<kb\b([^>]*?)\s*\/?>/gi
const WEB_TAG_RE = /<web\b([^>]*?)\s*\/?>/gi
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/
const FILENAME_UNSAFE_RE = /[\\"/:*?<>|\x00-\x1f]/g

/**
 * Unified source table for one export. Builds on the merged reference list
 * (same de-dup as the references drawer) and maintains lookup maps from the
 * citation identifiers used in the answer body to the unified 1..N numbering.
 */
class ExportSourceTable {
  readonly sources: AnswerExportSource[] = []
  private readonly byChunkId = new Map<string, number>()
  private readonly byUrl = new Map<string, number>()
  private readonly citationRefs: CitationKnowledgeRef[]

  constructor(refs: KnowledgeReferenceLike[] | null | undefined) {
    const list = Array.isArray(refs) ? refs.filter(Boolean) : []
    this.citationRefs = list

    for (const item of buildReferenceList(list)) {
      this.registerMergedItem(item)
    }
  }

  private registerMergedItem(item: ReferenceListItem) {
    const index = this.sources.length + 1
    const source: AnswerExportSource = {
      index,
      kind: item.kind,
      title: (item.title || '').trim() || `Source ${index}`,
    }
    if (item.url) source.url = item.url
    if (item.kind === 'tool' && item.domain) source.location = item.domain
    this.sources.push(source)

    for (const chunkId of [item.chunkId, ...(item.chunkIds || [])]) {
      if (chunkId) this.byChunkId.set(chunkId, index)
    }
    if (item.url) this.byUrl.set(normalizeReferenceUrl(item.url), index)
  }

  /** `<web>` tags may carry a URL the aggregate references never contained; keep it as a real source. */
  appendWebSource(url: string, title?: string): number {
    const index = this.sources.length + 1
    const trimmedUrl = url.trim()
    const domain = getDomainFromUrl(trimmedUrl)
    const source: AnswerExportSource = {
      index,
      kind: 'web',
      title: (title || '').trim() || domain || trimmedUrl,
      url: trimmedUrl,
    }
    this.sources.push(source)
    this.byUrl.set(normalizeReferenceUrl(trimmedUrl), index)
    return index
  }

  resolveUrl(url: string): number | undefined {
    return this.byUrl.get(normalizeReferenceUrl(url))
  }

  resolveChunkId(chunkId: string): number | undefined {
    if (!chunkId) return undefined
    return this.byChunkId.get(chunkId)
  }

  resolveDocTitle(doc: string): number | undefined {
    const name = (doc || '').trim()
    if (!name) return undefined
    return this.sources.find(
      (source) => source.kind === 'document' && docTitlesMatch(name, source.title),
    )?.index
  }

  resolveKbCitation(attrs: Record<string, string>): number | undefined {
    const doc = (attrs.doc || '').trim()
    const rawChunkId = attrs.chunk_id || attrs.chunkId || ''
    const kbId = attrs.kb_id || attrs.kbId || ''

    const resolved = resolveCitationChunkId(rawChunkId, { doc, kbId }, this.citationRefs)
    const byChunk = this.resolveChunkId(resolved)
    if (byChunk !== undefined) return byChunk

    // Tool-derived references can surface the knowledge id where the chunk id
    // is expected; both were registered as chunk keys during merge.
    if (kbId) {
      const byKbId = this.resolveChunkId(kbId)
      if (byKbId !== undefined) return byKbId
    }

    return this.resolveDocTitle(doc)
  }
}

function convertCitationLine(
  line: string,
  table: ExportSourceTable,
  labels: AnswerExportLabels,
): string {
  return line
    .replace(WEB_TAG_RE, (_match, attrString: string) => {
      const attrs = parseTagAttributes(attrString)
      const url = (attrs.url || '').trim()
      if (!url) return ''
      const index = table.resolveUrl(url) ?? table.appendWebSource(url, attrs.title)
      return `[${index}]`
    })
    .replace(KB_TAG_RE, (_match, attrString: string) => {
      const attrs = parseTagAttributes(attrString)
      const index = table.resolveKbCitation(attrs)
      if (index !== undefined) return `[${index}]`
      // Unresolvable citation: keep a readable marker instead of silently
      // dropping the reference or guessing a wrong source number.
      const doc = (attrs.doc || '').trim()
      return doc ? `[${doc}]` : `[${labels.unresolvedCitation}]`
    })
    .replace(WIKI_LINK_RE, (_match, inner: string) => {
      // Internal wiki links are navigation, not sources: keep only the text.
      const pipeIdx = inner.indexOf('|')
      const display = (pipeIdx > 0 ? inner.slice(pipeIdx + 1) : inner).trim()
      return display
    })
}

/**
 * Replace citation tags with `[n]` markers outside fenced code blocks.
 * Fenced code keeps tags verbatim (they are content there, not citations).
 */
function convertCitations(
  markdown: string,
  table: ExportSourceTable,
  labels: AnswerExportLabels,
): string {
  let inFence = false
  let fenceChar = ''

  return markdown
    .split('\n')
    .map((line) => {
      const fence = line.match(FENCE_LINE_RE)
      if (fence) {
        const char = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceChar = char
        } else if (char === fenceChar) {
          inFence = false
        }
        return line
      }
      return inFence ? line : convertCitationLine(line, table, labels)
    })
    .join('\n')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local timestamp in `YYYYMMDD-HHmmss` form, used for file naming. */
export function formatExportTimestamp(now: Date = new Date()): string {
  return (
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  )
}

/** Strip characters that are invalid in file names on common platforms. */
export function sanitizeFilenamePart(value: string): string {
  return String(value || '')
    .replace(FILENAME_UNSAFE_RE, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
}

/**
 * `WeKnora-回答-{消息短ID}-{时间戳}`; falls back to the timestamp alone when
 * the message id is missing (spec: WK-002).
 */
export function buildAnswerExportFilenameBase(
  messageId?: string | null,
  now: Date = new Date(),
): string {
  const timestamp = formatExportTimestamp(now)
  const shortId = sanitizeFilenamePart(String(messageId || '')).slice(0, 8)
  return shortId
    ? `WeKnora-回答-${shortId}-${timestamp}`
    : `WeKnora-回答-${timestamp}`
}

/**
 * Build the export snapshot from the *current* message state. Synchronous on
 * purpose: the caller takes the snapshot at click time so a session switch
 * during async document generation cannot mismatch question and answer.
 */
export function buildAnswerExportModel(input: {
  question?: string | null
  answerMarkdown: string
  references?: KnowledgeReferenceLike[] | null
  messageId?: string | null
  labels: AnswerExportLabels
  now?: Date
}): AnswerExportModel {
  const table = new ExportSourceTable(input.references)
  // Strip <answer>/“最终答案：” wrappers the same way the rendered answer does;
  // thinking content never reaches this function (callers pass the final answer).
  const cleaned = unwrapFinalAnswerWrappers(String(input.answerMarkdown || ''))

  return {
    question: String(input.question || '').trim(),
    answerMarkdown: convertCitations(cleaned, table, input.labels).trim(),
    references: table.sources,
    filenameBase: buildAnswerExportFilenameBase(input.messageId, input.now),
    labels: input.labels,
  }
}

function formatSourceLine(source: AnswerExportSource): string {
  let line = source.url ? `[${source.title}](${source.url})` : source.title
  if (source.location) line += ` (${source.location})`
  return line
}

/** Render the model as a standalone UTF-8 Markdown document. */
export function generateAnswerMarkdown(model: AnswerExportModel): string {
  const blocks: string[] = []

  if (model.question) {
    blocks.push(`## ${model.labels.question}\n\n${model.question}\n`)
  }
  if (model.answerMarkdown) {
    blocks.push(`## ${model.labels.answer}\n\n${model.answerMarkdown}\n`)
  }
  if (model.references.length) {
    const lines = model.references.map(
      (source) => `${source.index}. ${formatSourceLine(source)}`,
    )
    blocks.push(`## ${model.labels.sources}\n\n${lines.join('\n')}\n`)
  }

  return blocks.join('\n')
}

/** Trigger a browser download for a generated blob and release the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser time to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
