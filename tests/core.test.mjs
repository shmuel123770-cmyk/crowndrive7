import test from 'node:test';import assert from 'node:assert/strict';
import {esc,validPassword,statusLabel} from '../js/core.js';
test('esc prevents html injection',()=>assert.equal(esc('<img onerror=1>'),'&lt;img onerror=1&gt;'));
test('password policy',()=>{assert.equal(validPassword('Abc123'),true);assert.equal(validPassword('abcdef'),false);assert.equal(validPassword('ABCDEF'),false)});
test('status labels',()=>assert.equal(statusLabel('approved'),'אושרה'));
