import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./WikiBrowser.vue', import.meta.url), 'utf8')

test('every Wiki graph fetch carries the active source scope', () => {
  const graphCalls = source.match(/getWikiGraph\(props\.knowledgeBaseId, withWikiGraphScope\(\{/g) || []
  assert.equal(graphCalls.length, 4)
})

test('graph remote search carries the active source scope', () => {
  assert.match(source, /searchWikiPages\(props\.knowledgeBaseId, q, 20, graphKnowledgeScope\(\)\)/)
  assert.match(source, /searchWikiPages\(props\.knowledgeBaseId, value, 1, graphKnowledgeScope\(\)\)/)
})

test('source selector remains available for an empty scoped graph', () => {
  assert.match(source, /v-if="graphReady \|\| !graphLoading" class="wiki-graph-search-container"/)
  assert.match(source, /v-model="graphKnowledgeIDs" multiple filterable clearable/)
})
