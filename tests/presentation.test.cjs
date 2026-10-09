const test = require('node:test');
const assert = require('node:assert/strict');
const presentation = require('../public/agent/presentation.js');

test('empty intermediate searches produce no result cards and preserve tool data', () => {
  for (const name of ['search_records', 'gmail_search', 'whatsapp_list_templates']) {
    const result = { items: [] };
    assert.equal(presentation.results({ name, args: {} }, result), '');
    assert.deepEqual(result, { items: [] });
  }
});

test('matching Hub records still render their result cards', () => {
  const record = presentation.results({ name: 'search_records', args: { entity: 'candidates' } }, { items: [{ id: 'alba', name: 'Alba Fernández' }] });
  assert.match(record, /1 resultados/);
  assert.match(record, /Alba Fernández/);
  assert.match(record, /Abrir ficha/);
});

test('Gmail reference emails stay available to the model without automatic chat cards', () => {
  const result = { items: [{ id: 'mail-1', subject: 'Entrevista', snippet: 'Confirmada' }], next_page_token: 'next' };
  const original = structuredClone(result);
  assert.equal(presentation.results({ name: 'gmail_search', args: {} }, result), '');
  assert.deepEqual(result, original);
});
