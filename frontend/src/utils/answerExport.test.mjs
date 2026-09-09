import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAnswerExportFilenameBase,
  buildAnswerExportModel,
  formatExportTimestamp,
  generateAnswerMarkdown,
  sanitizeFilenamePart,
} from './answerExport.ts'

const LABELS = {
  question: '问题',
  answer: '回答',
  sources: '引用来源',
  unresolvedCitation: '未匹配来源',
  imageLabel: '图片',
}

test('citation tags convert to unified numbering across source categories', () => {
  const model = buildAnswerExportModel({
    question: 'Q1',
    answerMarkdown: '参见 <web url="https://example.com/a" title="Example A"/> 与 <kb chunk_id="chunk-1" doc="条例"/>。',
    references: [
      {
        id: 'https://example.com/a',
        chunk_type: 'web_search',
        knowledge_title: 'Example A',
        metadata: { url: 'https://example.com/a' },
        content: 'web content',
      },
      {
        id: 'chunk-1',
        knowledge_id: 'doc-1',
        knowledge_title: '条例',
        content: 'doc content',
      },
    ],
    labels: LABELS,
  })

  // Web comes first in the drawer section order, so the web citation is [1]
  // and the document citation is [2] — one shared sequence, not per-category.
  assert.equal(model.answerMarkdown, '参见 [1] 与 [2]。')
  assert.deepEqual(
    model.references.map((r) => [r.index, r.kind, r.title]),
    [
      [1, 'web', 'Example A'],
      [2, 'document', '条例'],
    ],
  )
})

test('duplicate urls and same-document chunks collapse to one source each', () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: 'A <web url="https://example.com/a/"/> B',
    references: [
      {
        id: 'https://example.com/a',
        chunk_type: 'web_search',
        metadata: { url: 'https://example.com/a' },
        content: 'a',
      },
      {
        id: 'https://example.com/a/',
        chunk_type: 'web_search',
        metadata: { url: 'https://example.com/a/' },
        content: 'a-dup',
      },
      { id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '手册', content: 'part 1' },
      { id: 'chunk-2', knowledge_id: 'doc-1', knowledge_title: '手册', content: 'part 2' },
    ],
    labels: LABELS,
  })

  assert.equal(model.references.length, 2)
  // The tag URL (trailing slash) and the reference URL (no slash) normalise to
  // the same source.
  assert.match(model.answerMarkdown, /A \[1\] B/)
})

test('unresolvable kb citations keep readable text instead of vanishing', () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: '引用 <kb chunk_id="no-such-chunk" doc="未知文档"/> 和 <kb chunk_id="no-such-chunk"/>。',
    references: [
      { id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '条例', content: 'c' },
    ],
    labels: LABELS,
  })

  assert.match(model.answerMarkdown, /\[未知文档\]/)
  assert.match(model.answerMarkdown, /\[未匹配来源\]/)
  // No wrong mapping onto the existing source.
  assert.doesNotMatch(model.answerMarkdown, /\[1\]/)
})

test('web tags with unknown urls become real sources instead of dangling markers', () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: 'A <web url="https://extra.example.com/x" title="补充来源"/>。',
    references: [],
    labels: LABELS,
  })

  assert.equal(model.answerMarkdown, 'A [1]。')
  assert.equal(model.references[0].title, '补充来源')
  assert.equal(model.references[0].url, 'https://extra.example.com/x')
})

test('citation tags inside fenced code blocks stay verbatim', () => {
  const answer = [
    '正文 <kb chunk_id="chunk-1" doc="条例"/>',
    '',
    '```js',
    'const tag = \'<kb chunk_id="chunk-1" doc="条例"/>\'',
    '```',
    '',
    '后续 <web url="https://example.com/a"/>',
  ].join('\n')

  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: answer,
    references: [
      { id: 'chunk-1', knowledge_id: 'doc-1', knowledge_title: '条例', content: 'c' },
      {
        id: 'https://example.com/a',
        chunk_type: 'web_search',
        metadata: { url: 'https://example.com/a' },
        content: 'w',
      },
    ],
    labels: LABELS,
  })

  const codeLine = model.answerMarkdown.split('\n').find((l) => l.startsWith('const tag'))
  assert.ok(codeLine.includes('<kb chunk_id="chunk-1"'))
  assert.match(model.answerMarkdown, /正文 \[2\]/)
  assert.match(model.answerMarkdown, /后续 \[1\]/)
})

test('final-answer wrappers are stripped and thinking markers never appear', () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: '<answer>最终答案：实际回答内容</answer>',
    labels: LABELS,
  })

  assert.equal(model.answerMarkdown, '实际回答内容')
})

test('wiki links keep their display text only', () => {
  const model = buildAnswerExportModel({
    question: 'Q',
    answerMarkdown: '参见 [[wiki/adz|防空识别区]] 和 [[裸链接]]。',
    labels: LABELS,
  })

  assert.equal(model.answerMarkdown, '参见 防空识别区 和 裸链接。')
})

test('markdown document contains question, answer and source sections', () => {
  const model = buildAnswerExportModel({
    question: '什么是识别区？',
    answerMarkdown: '回答正文 <web url="https://example.com/a"/>',
    references: [
      {
        id: 'https://example.com/a',
        chunk_type: 'web_search',
        knowledge_title: 'Example A',
        metadata: { url: 'https://example.com/a' },
        content: 'w',
      },
      { id: 't1', chunk_type: 'tool_result', knowledge_title: '工具结果', content: 'o', metadata: { tool: 'wiki_search' } },
    ],
    labels: LABELS,
  })

  const markdown = generateAnswerMarkdown(model)
  assert.match(markdown, /^## 问题\n\n什么是识别区？$/m)
  assert.match(markdown, /^## 回答\n\n回答正文 \[1\]$/m)
  assert.match(markdown, /^## 引用来源\n\n1\. \[Example A\]\(https:\/\/example\.com\/a\)$/m)
  assert.match(markdown, /^2\. 工具结果 \(wiki_search\)$/m)
})

test('missing question or references are omitted without fabrication', () => {
  const model = buildAnswerExportModel({
    answerMarkdown: '只有回答。',
    labels: LABELS,
  })

  const markdown = generateAnswerMarkdown(model)
  assert.doesNotMatch(markdown, /## 问题/)
  assert.doesNotMatch(markdown, /## 引用来源/)
  assert.match(markdown, /## 回答\n\n只有回答。/)
})

test('filename carries short message id and timestamp, falling back to timestamp only', () => {
  const now = new Date(2026, 8, 8, 9, 5, 3)
  assert.equal(
    buildAnswerExportFilenameBase('abcd1234-5678-90ef', now),
    `WeKnora-回答-abcd1234-${formatExportTimestamp(now)}`,
  )
  assert.equal(buildAnswerExportFilenameBase('', now), `WeKnora-回答-${formatExportTimestamp(now)}`)
  assert.equal(buildAnswerExportFilenameBase(null, now), `WeKnora-回答-${formatExportTimestamp(now)}`)
  // Illegal characters are stripped from the id part.
  assert.match(buildAnswerExportFilenameBase('a/b:c*d', now), /^WeKnora-回答-a-b-c-d-/)
})

test('sanitizeFilenamePart strips platform-unsafe characters', () => {
  assert.equal(sanitizeFilenamePart('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j')
  assert.equal(sanitizeFilenamePart('  ..name.. '), 'name')
})
