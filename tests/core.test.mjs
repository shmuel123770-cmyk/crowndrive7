import test from 'node:test';
import assert from 'node:assert/strict';
import {esc, validPassword, validEmail, statusLabel, verificationLabel, stars, reconcileMessages} from '../js/core.js';
test('esc prevents html injection', () => assert.equal(esc('<img onerror=1>'), '&lt;img onerror=1&gt;'));
test('password policy', () => { assert.equal(validPassword('StrongPass123'), true); assert.equal(validPassword('Abc123'), true); assert.equal(validPassword('abcdef'), true); assert.equal(validPassword('abc12'), false); assert.equal(validPassword(''), false); });
test('email validity', () => { assert.equal(validEmail('a@b.com'), true); assert.equal(validEmail(' name@example.co.il '), true); assert.equal(validEmail('nope'), false); assert.equal(validEmail('a@b'), false); assert.equal(validEmail('a b@c.com'), false); assert.equal(validEmail(''), false); });
test('status labels', () => assert.equal(statusLabel('approved'), 'אושרה'));
test('verification labels', () => assert.equal(verificationLabel('needs_resubmission'), 'נדרש צילום מחדש'));
test('stars are bounded', () => { assert.equal(stars(5), '★★★★★'); assert.equal(stars(0), '☆☆☆☆☆'); });

// --- optimistic chat sending: the reconcile step -----------------------------------------------
// These cover what a live login would otherwise be needed to exercise: the sender's own bubble must
// appear at once, must not appear twice when the server record arrives, and must never swallow a
// message that really was stored.
const m = (id, text = '') => ({id, text});

test('reconcile: a fresh snapshot draws every message once', () => {
  const {append, resolve, seenAdds} = reconcileMessages([m('a'), m('b')], new Set());
  assert.deepEqual(append.map(x => x.id), ['a', 'b']);
  assert.deepEqual(resolve, []);
  assert.deepEqual(seenAdds, ['a', 'b']);
});

test('reconcile: already-drawn messages are never drawn again', () => {
  const {append, seenAdds} = reconcileMessages([m('a'), m('b')], new Set(['a']));
  assert.deepEqual(append.map(x => x.id), ['b']);
  assert.deepEqual(seenAdds, ['b']);
});

test('reconcile: my own optimistic bubble is swapped, not duplicated', () => {
  // The send returned id "s1", so the placeholder t1 now stands for a real record.
  const {append, resolve, seenAdds} = reconcileMessages(
    [m('other'), m('s1')], new Set(), [{tempId: 't1', realId: 's1'}]);
  assert.deepEqual(append.map(x => x.id), ['other'], 'the other side is drawn');
  assert.deepEqual(resolve, ['t1'], 'my placeholder resolves instead of drawing a second bubble');
  assert.deepEqual(seenAdds, ['other', 's1']);
});

test('reconcile: a send still in flight keeps its placeholder', () => {
  // realId is unknown until the server answers — nothing may resolve yet.
  const {append, resolve} = reconcileMessages([m('other')], new Set(), [{tempId: 't1', realId: null}]);
  assert.deepEqual(append.map(x => x.id), ['other']);
  assert.deepEqual(resolve, []);
});

test('reconcile: a resolved bubble is not resolved a second time', () => {
  const seen = new Set();
  const first = reconcileMessages([m('s1')], seen, [{tempId: 't1', realId: 's1'}]);
  first.seenAdds.forEach(id => seen.add(id));
  const second = reconcileMessages([m('s1')], seen, [{tempId: 't1', realId: 's1'}]);
  assert.deepEqual(first.resolve, ['t1']);
  assert.deepEqual(second.resolve, [], 'the second snapshot must be a no-op');
  assert.deepEqual(second.append, []);
});

test('reconcile: records without an id are skipped, not drawn', () => {
  const {append, seenAdds} = reconcileMessages([{text: 'no id'}, null, m('a')], new Set());
  assert.deepEqual(append.map(x => x.id), ['a']);
  assert.deepEqual(seenAdds, ['a']);
});

test('reconcile: two placeholders resolve independently', () => {
  const {append, resolve} = reconcileMessages(
    [m('s1'), m('s2'), m('other')], new Set(),
    [{tempId: 't1', realId: 's1'}, {tempId: 't2', realId: 's2'}]);
  assert.deepEqual(resolve, ['t1', 't2']);
  assert.deepEqual(append.map(x => x.id), ['other']);
});

test('reconcile: empty snapshot changes nothing', () => {
  const {append, resolve, seenAdds} = reconcileMessages([], new Set(['a']), [{tempId: 't1', realId: null}]);
  assert.deepEqual([append, resolve, seenAdds], [[], [], []]);
});
