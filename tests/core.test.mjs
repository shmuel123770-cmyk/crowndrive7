import test from 'node:test';
import assert from 'node:assert/strict';
import {esc, validPassword, validEmail, statusLabel, verificationLabel, stars} from '../js/core.js';
test('esc prevents html injection', () => assert.equal(esc('<img onerror=1>'), '&lt;img onerror=1&gt;'));
test('password policy', () => { assert.equal(validPassword('StrongPass123'), true); assert.equal(validPassword('Abc123'), true); assert.equal(validPassword('abcdef'), true); assert.equal(validPassword('abc12'), false); assert.equal(validPassword(''), false); });
test('email validity', () => { assert.equal(validEmail('a@b.com'), true); assert.equal(validEmail(' name@example.co.il '), true); assert.equal(validEmail('nope'), false); assert.equal(validEmail('a@b'), false); assert.equal(validEmail('a b@c.com'), false); assert.equal(validEmail(''), false); });
test('status labels', () => assert.equal(statusLabel('approved'), 'אושרה'));
test('verification labels', () => assert.equal(verificationLabel('needs_resubmission'), 'נדרש צילום מחדש'));
test('stars are bounded', () => { assert.equal(stars(5), '★★★★★'); assert.equal(stars(0), '☆☆☆☆☆'); });
