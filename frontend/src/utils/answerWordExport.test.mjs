import assert from 'node:assert/strict'
import test from 'node:test'

import JSZip from 'jszip'

import { buildAnswerExportModel } from './answerExport.ts'
import { buildAnswerWordDocumentForModel } from './answerWordExport.ts'
import { Packer } from 'docx'

const LABELS = {
  question: '问题',
  answer: '回答',
  sources: '引用来源',
  unresolvedCitation: '未匹配来源',
  imageLabel: '图片',
}

/** Pack a model and return { zip, xml } of the generated DOCX package. */
async function buildDocx(model) {
  const document = await buildAnswerWordDocumentForModel(model)
  const buffer = await Packer.toBuffer(document)

  // Real Office Open XML package, not just a non-empty blob.
  assert.equal(buffer.slice(0, 2).toString(), 'PK')

  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml').async('string')
  return { zip, xml }
}

function unwrapText(xml) {
  // Collapse the run-level XML so probes read like plain text.
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

test('docx package contains all required parts', async () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: 'A',
    labels: LABELS,
  })
  const { zip } = await buildDocx(model)

  for (const entry of [
    '[Content_Types].xml',
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/_rels/document.xml.rels',
  ]) {
    assert.ok(zip.file(entry), `missing package entry: ${entry}`)
  }
})

test('word document carries question, answer body and unified source list', async () => {
  const model = buildAnswerExportModel({
    question: '什么是防空识别区？',
    answerMarkdown: [
      '## 概述',
      '',
      '防空识别区 <web url="https://example.com/a" title="Example A"/> 是预警区域 <kb chunk_id="chunk-1" doc="作战条例"/>。',
      '',
      '$E=mc^2$ 公式保留源码。',
    ].join('\n'),
    references: [
      {
        id: 'https://example.com/a',
        chunk_type: 'web_search',
        knowledge_title: 'Example A',
        metadata: { url: 'https://example.com/a' },
        content: 'w',
      },
      { id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '作战条例', content: 'c' },
    ],
    labels: LABELS,
  })
  const { xml } = await buildDocx(model)
  const text = unwrapText(xml)

  // Section headings + content.
  assert.match(text, /问题/)
  assert.match(text, /什么是防空识别区？/)
  assert.match(text, /回答/)
  assert.match(text, /概述/)
  assert.match(text, /防空识别区 \[1\] 是预警区域 \[2\]/)
  assert.match(text, /引用来源/)
  assert.match(text, /1\. Example A/)
  assert.match(text, /2\. 作战条例/)

  // Headings and citations map to real Word structures.
  assert.match(xml, /w:pStyle w:val="Heading1"/)
  assert.match(xml, /w:pStyle w:val="Heading2"/)

  // External links are real hyperlinks with a relationship target.
  assert.match(xml, /w:hyperlink[^>]*r:id=/)
})

test('lists, tables, code blocks and quotes become native word structures', async () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: [
      '- 无序一',
      '  - 嵌套项',
      '',
      '1. 有序一',
      '2. 有序二',
      '',
      '| 列A | 列B |',
      '|---|---|',
      '| 值1 | 值2 |',
      '',
      '> 引用内容',
      '',
      '```python',
      "print('<kb chunk_id=\"1\"/>')",
      '```',
    ].join('\n'),
    labels: LABELS,
  })
  const { xml } = await buildDocx(model)
  const text = unwrapText(xml)

  // Table with header + body cells.
  assert.match(xml, /<w:tbl>/)
  assert.match(text, /列A/)
  assert.match(text, /值2/)

  // Lists use Word numbering (bullets and ordered share numPr).
  assert.match(xml, /<w:numPr>/)

  // Code block kept verbatim — citation tag inside the fence survives.
  assert.match(text, /print\('<kb chunk_id="1"\/>'\)/)

  // Quote paragraph carries a left border.
  assert.match(text, /引用内容/)
  assert.match(xml, /w:pBdr>/)
})

test('emphasis and inline code map to word run properties', async () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: '**粗体** *斜体* ~~删除~~ `代码`',
    labels: LABELS,
  })
  const { xml } = await buildDocx(model)

  assert.match(xml, /<w:b\/>/)
  assert.match(xml, /<w:i\/>/)
  assert.match(xml, /<w:strike\/>/)
  assert.match(xml, /Consolas/)
})

test('document uses A4 page size and CJK-capable default font', async () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: 'A',
    labels: LABELS,
  })
  const { zip, xml } = await buildDocx(model)

  // A4 portrait = 11905 x 16837 twips (docx converts 210/297mm with rounding).
  assert.match(xml, /w:pgSz[^>]*w:w="11905"/)
  assert.match(xml, /w:pgSz[^>]*w:h="16837"/)
  assert.match(xml, /w:pgSz[^>]*w:orient="portrait"/)

  const styles = await zip.file('word/styles.xml').async('string')
  assert.match(styles, /Microsoft YaHei/)
  assert.match(styles, /Calibri/)
})

test('thinking-style content is not part of the exported body by construction', async () => {
  // The word generator only ever sees the model's answerMarkdown; verify the
  // wrapper stripping holds through the full pipeline.
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: '<answer>正文</answer>',
    labels: LABELS,
  })
  const { xml } = await buildDocx(model)
  const text = unwrapText(xml)

  assert.match(text, /正文/)
  assert.doesNotMatch(text, /<answer>|answer/)
})
