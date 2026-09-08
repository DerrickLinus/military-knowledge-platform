import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWikiGraphQuery } from '../../../api/wiki/query'
import {
  normalizeWikiGraphKnowledgeIDs,
  withWikiGraphScope,
} from './wikiGraphScope'

test('normalizes source-scope knowledge IDs without changing their order', () => {
  assert.deepEqual(
    normalizeWikiGraphKnowledgeIDs([' doc-1 ', '', 'doc-2', 'doc-1']),
    ['doc-1', 'doc-2'],
  )
})

test('omits knowledge_ids for an unscoped graph request', () => {
  const params = withWikiGraphScope({ mode: 'overview', limit: 500 }, [])
  assert.equal(buildWikiGraphQuery(params), 'mode=overview&limit=500')
})

test('serializes source scope with existing graph filters', () => {
  const params = withWikiGraphScope(
    { mode: 'ego', center: 'entity/user', depth: 1, types: ['entity', 'concept'], limit: 500 },
    ['doc-1', 'doc-2'],
  )
  const query = new URLSearchParams(buildWikiGraphQuery(params))
  assert.equal(query.get('mode'), 'ego')
  assert.equal(query.get('center'), 'entity/user')
  assert.equal(query.get('types'), 'entity,concept')
  assert.equal(query.get('knowledge_ids'), 'doc-1,doc-2')
})
