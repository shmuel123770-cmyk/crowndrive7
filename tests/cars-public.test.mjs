import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePublicCars} from '../netlify/functions/_public-cars.mjs';

test('public cars fallback excludes hidden and invalid records', () => {
  assert.deepEqual(visiblePublicCars({
    available: {status: 'available', make: 'Toyota'},
    rented: {status: 'rented', make: 'Honda'},
    hidden: {status: 'hidden', make: 'Mazda'},
    missing: null,
  }), {
    available: {status: 'available', make: 'Toyota'},
    rented: {status: 'rented', make: 'Honda'},
  });
  assert.deepEqual(visiblePublicCars(null), {});
  assert.deepEqual(visiblePublicCars([]), {});
});
