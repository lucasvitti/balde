import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeCriterionResults } from '../src/policy/evaluation-result.mjs';

test('Incomplete or malformed AI evidence never approves missing evaluation criteria', () => {
  const criteria = [
    { id: 'scope', text: 'Scope declared' },
    { id: 'source', text: 'Source supported' }
  ];
  for (const response of [
    null,
    {},
    { results: [null] },
    { results: [{ id: 'scope', verdict: 'pass' }] },
    {
      results: [
        { id: 'scope', verdict: 'unknown' },
        { id: 'source', verdict: 'pass' }
      ]
    }
  ]) {
    assert.equal(gradeCriterionResults(criteria, response).overall, 'pending');
  }
  assert.equal(gradeCriterionResults([], { results: [] }).overall, 'pending');
  assert.equal(gradeCriterionResults(criteria, { results: [{ id: 'scope', verdict: 'fail' }] }).overall, 'fail');
  assert.equal(
    gradeCriterionResults(criteria, {
      results: [
        { id: 'scope', verdict: 'pass' },
        { id: 'source', verdict: 'pass' }
      ]
    }).overall,
    'pass'
  );
});
