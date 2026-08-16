// firstToAnswer decides whether an account is treated as an admin, and it arbitrates between two
// transports where one is EXPECTED to fail — that is the whole reason it exists. Promise.race would
// have let the failing one answer for the one still in flight, which is precisely the bug that locked
// the owner out of their own admin area. So these are the properties that must actually hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {firstToAnswer} from '../js/core.js';

const after = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));
const failsAfter = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));

test('takes the first transport to answer', async () => {
  assert.equal(await firstToAnswer(after(5, 'fast'), after(50, 'slow')), 'fast');
});

test('a transport that FAILS first does not settle the question', async () => {
  // The lockout in miniature: the realtime read is refused immediately while plain HTTPS is still
  // fetching the truth. Promise.race would reject here; the admin must still come back as an admin.
  assert.equal(await firstToAnswer(failsAfter(1, 'realtime refused'), after(30, true)), true);
});

test('rejects only once EVERY transport has failed', async () => {
  await assert.rejects(
    firstToAnswer(failsAfter(1, 'realtime refused'), failsAfter(5, 'https offline')),
    error => {
      // Both causes survive into the message — a single "failed" tells you nothing at 2am.
      assert.match(error.message, /realtime refused/);
      assert.match(error.message, /https offline/);
      return true;
    });
});

test('false is an ANSWER, not a failure — a genuine non-admin resolves false and stops there', async () => {
  assert.equal(await firstToAnswer(after(5, false), after(50, true)), false);
});

test('an already-rejected transport does not throw synchronously', async () => {
  // readViaREST can reject in the same tick (no network at all). If that escaped as a synchronous
  // throw it would bypass the caller's own catch and take startPrivate down with it.
  assert.equal(await firstToAnswer(Promise.reject(new Error('immediate')), after(5, true)), true);
});

test('a single failing transport still rejects rather than hanging', async () => {
  await assert.rejects(firstToAnswer(failsAfter(1, 'only one')), /only one/);
});
