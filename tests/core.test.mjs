import test from 'node:test';
import assert from 'node:assert/strict';
import {esc, validPassword, statusLabel, verificationLabel, stars} from '../js/core.js';
test('esc prevents html injection', () => assert.equal(esc('<img onerror=1>'), '&lt;img onerror=1&gt;'));
test('password policy', () => { assert.equal(validPassword('Abc123'), true); assert.equal(validPassword('abcdef'), false); assert.equal(validPassword('ABCDEF'), false); });
test('status labels', () => assert.equal(statusLabel('approved'), 'אושרה'));
test('verification labels', () => assert.equal(verificationLabel('needs_resubmission'), 'נדרש צילום מחדש'));
test('stars are bounded', () => { assert.equal(stars(5), '★★★★★'); assert.equal(stars(0), '☆☆☆☆☆'); });
