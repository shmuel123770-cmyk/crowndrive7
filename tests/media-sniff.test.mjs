// The whole point of sniffing is that the declared content type is attacker-controlled. So these
// tests feed REAL leading bytes for each container and assert the sniffer agrees — and, just as
// importantly, that it refuses things that must never come through the audio/document door.
import test from 'node:test';
import assert from 'node:assert/strict';
import {detectedMediaType, AUDIO_TYPES, DOC_TYPES} from '../netlify/functions/_media.mjs';

// Real leading bytes. Padded past the 12-byte floor the sniffer requires.
const pad = buf => Buffer.concat([buf, Buffer.alloc(32)]);
const ascii = s => Buffer.from(s, 'ascii');
const bytes = (...b) => Buffer.from(b);

const WEBM  = pad(bytes(0x1A, 0x45, 0xDF, 0xA3));                       // EBML header
const OGG   = pad(ascii('OggS'));
const WAV   = pad(Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE')]));
const MP3ID = pad(ascii('ID3'));
const MP3FR = pad(bytes(0xFF, 0xFB, 0x90, 0x00));                       // MPEG frame sync
const M4A   = pad(Buffer.concat([Buffer.alloc(4), ascii('ftypM4A ')]));
const PDF   = pad(ascii('%PDF-1.7'));

test('identifies every container a phone recorder or file picker actually produces', () => {
  assert.equal(detectedMediaType(WEBM),  'audio/webm');   // Chrome / Android MediaRecorder
  assert.equal(detectedMediaType(M4A),   'audio/mp4');    // Safari / iOS MediaRecorder
  assert.equal(detectedMediaType(OGG),   'audio/ogg');
  assert.equal(detectedMediaType(WAV),   'audio/wav');
  assert.equal(detectedMediaType(MP3ID), 'audio/mpeg');
  assert.equal(detectedMediaType(MP3FR), 'audio/mpeg');
  assert.equal(detectedMediaType(PDF),   'application/pdf');
});

test('a video mp4 does not sneak in through the audio door', () => {
  // Same ISO-BMFF container as M4A, different brand. Accepting it would let a 200MB film be posted
  // as a "voice note" and played back in an <audio> element.
  const MP4_VIDEO = pad(Buffer.concat([Buffer.alloc(4), ascii('ftypavc1')]));
  assert.equal(detectedMediaType(MP4_VIDEO), '');
});

test('refuses executables, scripts and archives whatever they claim to be', () => {
  const cases = {
    'ELF binary':   pad(bytes(0x7F, 0x45, 0x4C, 0x46)),
    'Windows exe':  pad(ascii('MZ\x90\x00')),
    'zip / office': pad(bytes(0x50, 0x4B, 0x03, 0x04)),
    'shell script': pad(ascii('#!/bin/sh\necho hi')),
    'html':         pad(ascii('<!doctype html><script>')),
    'svg':          pad(ascii('<svg xmlns="http://www.w3.org/2000/svg">')),
  };
  for (const [what, buf] of Object.entries(cases)) {
    assert.equal(detectedMediaType(buf), '', `${what} must not be accepted`);
  }
});

test('an image is not a media file — the two doors stay separate', () => {
  const JPEG = pad(bytes(0xFF, 0xD8, 0xFF, 0xE0));
  const PNG  = pad(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A));
  assert.equal(detectedMediaType(JPEG), '');
  assert.equal(detectedMediaType(PNG), '');
});

test('truncated and empty input is refused rather than guessed at', () => {
  assert.equal(detectedMediaType(Buffer.alloc(0)), '');
  assert.equal(detectedMediaType(ascii('%PD')), '');          // shorter than the 12-byte floor
  assert.equal(detectedMediaType(Buffer.alloc(11)), '');
});

test('every type the sniffer can return is one the endpoint knows how to file', () => {
  // Guards against adding a container to the sniffer and forgetting the allowlists — the endpoint
  // decides where bytes land by asking which set the type is in.
  for (const buf of [WEBM, M4A, OGG, WAV, MP3ID, PDF]) {
    const t = detectedMediaType(buf);
    assert.ok(AUDIO_TYPES.has(t) || DOC_TYPES.has(t), `${t} belongs to neither allowlist`);
  }
});
