import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// Source-level structural checks for the WK-002 answer export entry, following
// the answerToolbarCompletion.test.mjs convention: the two answer toolbars are
// plain Vue SFCs without a component test harness, so integration is verified
// against their source shape.

const botMessage = readFileSync(new URL('./botmsg.vue', import.meta.url), 'utf8')
const agentStream = readFileSync(new URL('./AgentStreamDisplay.vue', import.meta.url), 'utf8')
const exportMenu = readFileSync(new URL('./AnswerExportMenu.vue', import.meta.url), 'utf8')

test('both answer toolbars expose the export menu', () => {
  assert.match(botMessage, /<AnswerExportMenu/)
  assert.match(agentStream, /<AnswerExportMenu/)
})

test('plain answers stay excluded from embedded pages', () => {
  assert.match(botMessage, /<AnswerExportMenu v-if="!embeddedMode"/)
})

test('agent export uses the answer event content, not the thinking fallback', () => {
  // getActualContent falls back to the last thinking event when the answer is
  // empty; the export menu must receive event.content directly so thinking
  // never leaks into exported files.
  assert.match(agentStream, /<AnswerExportMenu[^>]*:answer="event\.content"/)
  assert.doesNotMatch(agentStream, /<AnswerExportMenu[^>]*:answer="getActualContent/)
})

test('agent export references follow the drawer aggregation rules', () => {
  assert.match(agentStream, /const exportReferences = computed\(\(\) => getReferencesForDrawer\(\)\)/)
  assert.match(agentStream, /<AnswerExportMenu[^>]*:references="exportReferences"/)
})

test('export only unlocks on fully rendered answers', () => {
  // The plain toolbar renders inside a v-if gated on answerFullyRendered; the
  // agent toolbar gates on answerFullyRendered && event.done.
  assert.match(botMessage, /v-if="answerFullyRendered && \(content \|\| session\.content\)"/)
  assert.match(agentStream, /v-if="answerFullyRendered && event\.done/)
})

test('menu supports hover, click and keyboard interaction', () => {
  assert.match(exportMenu, /@mouseenter="openMenu"/)
  assert.match(exportMenu, /@mouseleave="scheduleMenuClose"/)
  assert.match(exportMenu, /@click\.stop="toggleMenu"/)
  assert.match(exportMenu, /@keydown\.escape\.stop\.prevent="closeMenu\(true\)"/)
  assert.match(exportMenu, /@keydown\.down\.stop\.prevent="focusItem\(1\)"/)
  assert.match(exportMenu, /@keydown\.up\.stop\.prevent="focusItem\(-1\)"/)
  assert.match(exportMenu, /aria-haspopup="menu"/)
  assert.match(exportMenu, /role="menuitem"/)
})

test('menu prevents duplicate generation and snapshots state at click time', () => {
  assert.match(exportMenu, /:disabled="disabled \|\| exporting"/)
  assert.match(exportMenu, /if \(exporting\.value\) return/)
  assert.match(exportMenu, /buildAnswerExportModel\(\{/)
  assert.match(exportMenu, /if \(!model\.answerMarkdown\)/)
})

test('menu uses the shared chat.answerExport i18n keys', () => {
  for (const key of [
    'buttonTitle',
    'word',
    'markdown',
    'emptyContent',
    'success',
    'failed',
    'docLabels.question',
    'docLabels.answer',
    'docLabels.sources',
    'docLabels.unresolvedCitation',
    'docLabels.imageLabel',
  ]) {
    assert.match(exportMenu, new RegExp(`chat\\.answerExport\\.${key.replace('.', '\\.')}`))
  }
})

test('word generation is lazily loaded and markdown is generated inline', () => {
  assert.match(exportMenu, /import \{ generateAnswerWordBlob \} from '@\/utils\/answerWordExport'/)
  assert.match(exportMenu, /import \{[\s\S]*?generateAnswerMarkdown[\s\S]*?\} from '@\/utils\/answerExport'/)
})
