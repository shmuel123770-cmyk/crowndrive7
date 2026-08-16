// The owner counts the site "jumping eight times" when he opens it. The cause is that every listener
// which reports repaints the screen, and on a slow phone they report seconds apart — far enough apart
// that no debounce can fold them together. The fix is for the renderer to know the opening flood is
// still in progress and batch patiently until it is over.
//
// A previous attempt at this was time-based, and measuring it showed it changed the paint count by
// exactly nothing. So this one is pinned by tests rather than by hope: the flag has to go true while
// listeners are outstanding, go false once they have all answered, survive listeners that answer
// twice or never, and never stick on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFloodTracker} from '../js/core.js';

// A controllable clock — otherwise testing the deadline means waiting twelve real seconds.
const clockAt = start => { let t = start; return {now: () => t, advance: ms => { t += ms; }}; };

test('is idle before anything registers — a page with no listeners must not batch', () => {
  const flood = createFloodTracker();
  assert.equal(flood.active(), false);
  assert.equal(flood.pending(), 0);
});

test('active while listeners are outstanding, idle once they have all reported', () => {
  const flood = createFloodTracker();
  const cars = flood.track(), users = flood.track(), bookings = flood.track();
  assert.equal(flood.active(), true, 'three listeners registered, none reported');
  cars();
  assert.equal(flood.active(), true, 'still two outstanding');
  users();
  assert.equal(flood.active(), true, 'still one outstanding');
  bookings();
  assert.equal(flood.active(), false, 'all reported — back to reacting immediately');
  assert.equal(flood.pending(), 0);
});

test('a listener that reports twice does not double-decrement', () => {
  // Real case: a listener errors, releases, then recovers and delivers. Counting that twice would
  // drive pending below zero and declare the flood over while other listeners are still loading.
  const flood = createFloodTracker();
  const a = flood.track(), b = flood.track();
  a(); a(); a();
  assert.equal(flood.pending(), 1, 'three calls, one listener, one decrement');
  assert.equal(flood.active(), true, 'b has still not reported');
  b();
  assert.equal(flood.pending(), 0);
  assert.equal(flood.active(), false);
});

test('a listener that NEVER answers cannot hold the app in batching mode forever', () => {
  // This is the blocked-transport case the whole app is built around: the SDK calls neither the value
  // handler nor the error handler, so nothing ever releases. Without the deadline the renderer would
  // batch at two seconds a paint for the rest of the session.
  const clock = clockAt(1_000_000);
  const flood = createFloodTracker({windowMs: 12000, now: clock.now});
  flood.track();
  assert.equal(flood.active(), true);
  clock.advance(11_999);
  assert.equal(flood.active(), true, 'still inside the window');
  clock.advance(2);
  assert.equal(flood.active(), false, 'deadline passed — stop waiting on a listener that never spoke');
  assert.equal(flood.pending(), 1, 'it is still outstanding; we simply stopped batching for it');
});

test('the deadline starts at the FIRST registration, not at each one', () => {
  // Otherwise a listener registered late (subscribeOwnFeeds runs after the profile arrives) would
  // extend the window every time, and the flood would never end on a chatty account.
  const clock = clockAt(0);
  const flood = createFloodTracker({windowMs: 1000, now: clock.now});
  flood.track();
  clock.advance(900);
  flood.track();            // a later listener must not push the deadline out
  clock.advance(200);       // now 1100ms since the first
  assert.equal(flood.active(), false, 'window is measured from the first registration');
});

test('listeners registered after the flood ended do not restart it', () => {
  // A user opening a second booking mid-session registers new listeners. That is an interaction, not
  // an opening flood, and must keep repainting immediately rather than going quiet for two seconds.
  const clock = clockAt(0);
  const flood = createFloodTracker({windowMs: 1000, now: clock.now});
  const first = flood.track();
  first();
  assert.equal(flood.active(), false);
  clock.advance(1500);                 // past the deadline
  flood.track();                       // a fresh listener, long after startup
  assert.equal(flood.active(), false, 'the window is closed — this is interaction, not startup');
});
