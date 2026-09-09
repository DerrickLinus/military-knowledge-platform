// answerWordExport.ts
//
// Word (.docx) generation for exported chat answers. Takes an AnswerExportModel
// (already citation-converted, see answerExport.ts), parses the answer markdown
// with a private marked instance and maps the tokens to native docx structures:
// headings, paragraphs, bullet/numbered lists (with nesting), tables, code
// blocks, blockquotes, links and emphasis runs.
//
// Design notes:
// - The `docx` generator is only needed on the Word path, so it is dynamically
//   imported and cached — the chat bundle does not pay for it up front.
// - A private `new Marked({ gfm, breaks })` instance is used instead of the
//   chat renderer's global marked so tokenisation stays deterministic and
//   formulas ($…$) / Mermaid fences survive as source code, per spec.
// - Unknown tokens fall back to readable text rather than being dropped.

import { Marked, type Token, type Tokens } from 'marked'
import type {
  Document,
  ExternalHyperlink,
  Paragraph,
  Table,
  TextRun,
} from 'docx'
import type { AnswerExportLabels, AnswerExportModel } from './answerExport'

type DocxModule = typeof import('docx')

/** Word body font: Latin via Calibri, CJK via Microsoft YaHei. */
const BODY_FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }
const MONO_FONT = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: 'Microsoft YaHei' }
const CODE_BACKGROUND = 'F2F2F2'
const QUOTE_BAR_COLOR = 'B8B8B8'

const markdownParser = new Marked({ gfm: true, breaks: true })

let docxModulePromise: Promise<DocxModule> | null = null

function loadDocx(): Promise<DocxModule> {
  if (!docxModulePromise) {
    docxModulePromise = import('docx')
  }
  return docxModulePromise
}

type InlineStyle = {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  monospace?: boolean
}

type ParagraphStyle = {
  quote?: boolean
}

type InlineChild = TextRun | ExternalHyperlink
type BlockChild = Paragraph | Table

type BuildContext = {
  docx: DocxModule
  labels: AnswerExportLabels
  orderedListInstance: number
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Readable-text fallback for stray inline/block HTML: tags out, entities decoded. */
function htmlToReadableText(html: string): string {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]*>/g, '')).trim()
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href)
}

function headingLevel(docx: DocxModule, depth: number) {
  const levels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ]
  return levels[Math.min(Math.max(depth, 1), 6) - 1]
}

// ---------------------------------------------------------------------------
// Inline tokens → TextRun / ExternalHyperlink children
// ---------------------------------------------------------------------------

function inlineTokensToChildren(
  ctx: BuildContext,
  tokens: Token[] | undefined,
  style: InlineStyle = {},
): InlineChild[] {
  const { docx } = ctx
  const children: InlineChild[] = []

  const textRun = (text: string, runStyle: InlineStyle = {}) =>
    new docx.TextRun({
      text,
      bold: runStyle.bold,
      italics: runStyle.italics,
      strike: runStyle.strike,
      font: runStyle.monospace ? MONO_FONT : BODY_FONT,
    })

  for (const token of tokens || []) {
    switch (token.type) {
      case 'escape':
      case 'text': {
        const textToken = token as Tokens.Text
        if (textToken.tokens?.length) {
          children.push(...inlineTokensToChildren(ctx, textToken.tokens, style))
        } else {
          children.push(textRun(textToken.text || '', style))
        }
        break
      }
      case 'strong':
        children.push(
          ...inlineTokensToChildren(ctx, (token as Tokens.Strong).tokens, {
            ...style,
            bold: true,
          }),
        )
        break
      case 'em':
        children.push(
          ...inlineTokensToChildren(ctx, (token as Tokens.Em).tokens, {
            ...style,
            italics: true,
          }),
        )
        break
      case 'del':
        children.push(
          ...inlineTokensToChildren(ctx, (token as Tokens.Del).tokens, {
            ...style,
            strike: true,
          }),
        )
        break
      case 'codespan':
        children.push(textRun((token as Tokens.Codespan).text || '', { ...style, monospace: true }))
        break
      case 'br':
        children.push(new docx.TextRun({ break: 1 }))
        break
      case 'link': {
        const link = token as Tokens.Link
        const href = String(link.href || '').trim()
        if (href && isExternalHref(href)) {
          children.push(
            new docx.ExternalHyperlink({
              link: href,
              children: link.tokens?.length
                ? (inlineTokensToChildren(ctx, link.tokens, style) as TextRun[])
                : [textRun(link.text || href, style)],
            }),
          )
        } else if (link.text) {
          children.push(textRun(link.text, style))
        }
        break
      }
      case 'image': {
        // First version: no embedded images. Keep a readable caption and a
        // usable link when the source is a public URL; internal resource://
        // handles are not usable outside the app and degrade to a caption.
        const image = token as Tokens.Image
        const alt = (image.text || '').trim()
        const href = String(image.href || '').trim()
        const caption = alt
          ? `${ctx.labels.imageLabel}: ${alt}`
          : ctx.labels.imageLabel
        if (href && isExternalHref(href)) {
          children.push(
            new docx.ExternalHyperlink({
              link: href,
              children: [new docx.TextRun({ text: caption, style: 'Hyperlink' })],
            }),
          )
        } else {
          children.push(textRun(`[${caption}]`, style))
        }
        break
      }
      case 'html': {
        const readable = htmlToReadableText((token as Tokens.HTML).text || '')
        if (readable) children.push(textRun(readable, style))
        break
      }
      case 'checkbox':
        // Task-list markers are rendered by the list item itself.
        break
      default: {
        const fallback = (token as { text?: string; raw?: string }).text
          ?? (token as { raw?: string }).raw
          ?? ''
        if (fallback) children.push(textRun(String(fallback), style))
        break
      }
    }
  }

  return children
}

// ---------------------------------------------------------------------------
// Block tokens → Paragraph / Table children
// ---------------------------------------------------------------------------

type ParagraphExtras = Record<string, unknown>

function withParagraphStyle(extras: ParagraphExtras, paraStyle: ParagraphStyle | undefined, docx: DocxModule): ParagraphExtras {
  if (!paraStyle?.quote) return extras
  return {
    ...extras,
    indent: { left: 360 },
    border: {
      left: { style: docx.BorderStyle.SINGLE, size: 12, space: 6, color: QUOTE_BAR_COLOR },
    },
  }
}

function codeBlockToParagraphs(ctx: BuildContext, code: Tokens.Code): Paragraph[] {
  const { docx } = ctx
  const lines = String(code.text || '').split('\n')
  return lines.map((line, index) =>
    new docx.Paragraph(
      withParagraphStyle(
        {
          children: [new docx.TextRun({ text: line || ' ', font: MONO_FONT })],
          shading: { type: docx.ShadingType.CLEAR, fill: CODE_BACKGROUND },
          spacing: { after: index === lines.length - 1 ? 120 : 0 },
        },
        undefined,
        docx,
      ),
    ),
  )
}

function listToParagraphs(ctx: BuildContext, list: Tokens.List, depth: number): Paragraph[] {
  const { docx } = ctx
  const out: Paragraph[] = []
  const instance = list.ordered ? ++ctx.orderedListInstance : 0

  for (const item of list.items) {
    let isFirstBlock = true

    for (const block of item.tokens as Token[]) {
      // Only the first block of an item carries the list marker; continuation
      // blocks (loose paragraphs, nested code) stay indented with the item.
      const markerOptions = isFirstBlock
        ? list.ordered
          ? { numbering: { reference: 'answer-export-ordered', level: depth, instance } }
          : { bullet: { level: depth } }
        : { indent: { left: 720 * (depth + 1) } }

      if (block.type === 'text' || block.type === 'paragraph') {
        const textToken = block as Tokens.Text
        const inlineTokens = textToken.tokens?.length
          ? textToken.tokens
          : ([{ type: 'text', text: textToken.text || '' }] as Token[])
        const children = inlineTokensToChildren(ctx, inlineTokens)
        if (item.task && isFirstBlock) {
          children.unshift(new docx.TextRun({ text: item.checked ? '☑ ' : '☐ ' }))
        }
        out.push(
          new docx.Paragraph(
            withParagraphStyle(
              { children, ...markerOptions, spacing: { after: 40 } },
              undefined,
              docx,
            ),
          ),
        )
      } else if (block.type === 'list') {
        out.push(...listToParagraphs(ctx, block as Tokens.List, depth + 1))
      } else if (block.type === 'code') {
        out.push(...codeBlockToParagraphs(ctx, block as Tokens.Code))
      } else {
        const fallback = (block as { text?: string; raw?: string }).text
          ?? (block as { raw?: string }).raw
          ?? ''
        const readable = block.type === 'html'
          ? htmlToReadableText(fallback)
          : String(fallback).trim()
        if (readable) {
          out.push(
            new docx.Paragraph(
              withParagraphStyle(
                { children: [new docx.TextRun({ text: readable })], ...markerOptions },
                undefined,
                docx,
              ),
            ),
          )
        }
      }
      isFirstBlock = false
    }
  }

  return out
}

function tableToDocx(ctx: BuildContext, table: Tokens.Table): BlockChild[] {
  const { docx } = ctx
  const cellParagraph = (cell: Tokens.TableCell, header: boolean) =>
    new docx.Paragraph({
      children: inlineTokensToChildren(ctx, cell.tokens, header ? { bold: true } : {}),
      spacing: { after: 0 },
    })

  const headerRow = new docx.TableRow({
    tableHeader: true,
    children: table.header.map(
      (cell) =>
        new docx.TableCell({
          children: [cellParagraph(cell, true)],
          shading: { type: docx.ShadingType.CLEAR, fill: 'EFEFEF' },
        }),
    ),
  })

  const bodyRows = table.rows.map(
    (row) =>
      new docx.TableRow({
        children: row.map(
          (cell) => new docx.TableCell({ children: [cellParagraph(cell, false)] }),
        ),
      }),
  )

  // A trailing empty paragraph keeps adjacent tables from merging and stops the
  // document from ending directly on a table.
  return [
    new docx.Table({
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      rows: [headerRow, ...bodyRows],
    }),
    new docx.Paragraph({ spacing: { after: 60 } }),
  ]
}

function blockTokensToChildren(
  ctx: BuildContext,
  tokens: Token[] | undefined,
  paraStyle?: ParagraphStyle,
): BlockChild[] {
  const { docx } = ctx
  const out: BlockChild[] = []

  for (const token of tokens || []) {
    switch (token.type) {
      case 'space':
      case 'def':
        break
      case 'heading': {
        const heading = token as Tokens.Heading
        out.push(
          new docx.Paragraph(
            withParagraphStyle(
              {
                heading: headingLevel(docx, heading.depth),
                children: inlineTokensToChildren(ctx, heading.tokens),
              },
              paraStyle,
              docx,
            ),
          ),
        )
        break
      }
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph
        out.push(
          new docx.Paragraph(
            withParagraphStyle(
              { children: inlineTokensToChildren(ctx, paragraph.tokens) },
              paraStyle,
              docx,
            ),
          ),
        )
        break
      }
      case 'list':
        out.push(...listToParagraphs(ctx, token as Tokens.List, 0))
        break
      case 'code':
        out.push(...codeBlockToParagraphs(ctx, token as Tokens.Code))
        break
      case 'blockquote':
        out.push(
          ...blockTokensToChildren(ctx, (token as Tokens.Blockquote).tokens, { quote: true }),
        )
        break
      case 'table':
        out.push(...tableToDocx(ctx, token as Tokens.Table))
        break
      case 'hr':
        out.push(
          new docx.Paragraph({
            border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: 'C0C0C0' } },
            spacing: { after: 120 },
          }),
        )
        break
      case 'html': {
        const readable = htmlToReadableText((token as Tokens.HTML).text || '')
        if (readable) {
          out.push(
            new docx.Paragraph(
              withParagraphStyle(
                { children: [new docx.TextRun({ text: readable })] },
                paraStyle,
                docx,
              ),
            ),
          )
        }
        break
      }
      default: {
        const fallback = (token as { text?: string }).text
          ?? (token as { raw?: string }).raw
          ?? ''
        if (String(fallback).trim()) {
          out.push(
            new docx.Paragraph(
              withParagraphStyle(
                { children: [new docx.TextRun({ text: String(fallback) })] },
                paraStyle,
                docx,
              ),
            ),
          )
        }
        break
      }
    }
  }

  return out
}

function sourceListParagraphs(ctx: BuildContext, model: AnswerExportModel): Paragraph[] {
  const { docx } = ctx
  return model.references.map((source) => {
    const children: InlineChild[] = [new docx.TextRun({ text: `${source.index}. ` })]
    if (source.url && isExternalHref(source.url)) {
      children.push(
        new docx.ExternalHyperlink({
          link: source.url,
          children: [new docx.TextRun({ text: source.title, style: 'Hyperlink' })],
        }),
      )
    } else {
      children.push(new docx.TextRun({ text: source.title }))
    }
    if (source.location) {
      children.push(new docx.TextRun({ text: ` (${source.location})` }))
    }
    return new docx.Paragraph({ children, spacing: { after: 40 } })
  })
}

function buildAnswerWordDocument(docx: DocxModule, model: AnswerExportModel): Document {
  const sectionChildren: BlockChild[] = []

  if (model.question) {
    sectionChildren.push(
      new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_1,
        children: [new docx.TextRun({ text: model.labels.question })],
      }),
      new docx.Paragraph({ children: [new docx.TextRun({ text: model.question })] }),
    )
  }

  if (model.answerMarkdown) {
    const ctx: BuildContext = { docx, labels: model.labels, orderedListInstance: 0 }
    sectionChildren.push(
      new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_1,
        children: [new docx.TextRun({ text: model.labels.answer })],
      }),
      ...blockTokensToChildren(ctx, markdownParser.lexer(model.answerMarkdown) as Token[]),
    )
  }

  if (model.references.length) {
    const ctx: BuildContext = { docx, labels: model.labels, orderedListInstance: 0 }
    sectionChildren.push(
      new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_1,
        children: [new docx.TextRun({ text: model.labels.sources })],
      }),
      ...sourceListParagraphs(ctx, model),
    )
  }

  if (!sectionChildren.length) {
    sectionChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '' })] }))
  }

  return new docx.Document({
    numbering: {
      config: [
        {
          reference: 'answer-export-ordered',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: docx.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: docx.AlignmentType.START,
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22 },
          paragraph: { spacing: { line: 300, after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: docx.convertMillimetersToTwip(210),
              height: docx.convertMillimetersToTwip(297),
            },
          },
        },
        children: sectionChildren,
      },
    ],
  })
}

/** Build the docx Document for a model. Exposed for tests (packed separately). */
export async function buildAnswerWordDocumentForModel(model: AnswerExportModel): Promise<Document> {
  const docx = await loadDocx()
  return buildAnswerWordDocument(docx, model)
}

/** Generate the .docx payload as a Blob (browser) / Buffer-like (node). */
export async function generateAnswerWordBlob(model: AnswerExportModel): Promise<Blob> {
  const docx = await loadDocx()
  const document = buildAnswerWordDocument(docx, model)
  if (typeof docx.Packer.toBlob === 'function') {
    return docx.Packer.toBlob(document)
  }
  const buffer = await docx.Packer.toBuffer(document)
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
