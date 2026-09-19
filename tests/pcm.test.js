import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../extension/pcm-worklet.js', import.meta.url), 'utf8');
function worklet() {
  let Processor;
  const messages = [];
  const scope = vm.createContext({
    currentFrame: 0, Int16Array, ArrayBuffer, DataView,
    AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) }; },
    registerProcessor: (name, value) => { assert.equal(name, 'pcm-capture'); Processor = value; },
  });
  vm.runInContext(code, scope);
  return { processor: new Processor(), scope, messages };
}
test('PCM little endian clamps amplitude and flushes final partial buffer', () => {
  const { processor, scope, messages } = worklet();
  scope.currentFrame = 3200;
  processor.process([[new Float32Array([-2, -.5, 0, .5, 2])]]);
  assert.equal(messages.length, 0);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(messages[0].startFrame, 3200);
  const view = new DataView(messages[0].samples);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true)), [-32768, -16384, 0, 16383, 32767]);
  assert.equal(messages[1].flushed, true);
});
test('PCM emits 100ms packets with sample frame timestamps and no overlap', () => {
  const { processor, scope, messages } = worklet();
  for (let i = 0; i < 25; i++) {
    scope.currentFrame = i * 128;
    processor.process([[new Float32Array(128).fill(.25)]]);
  }
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(message => message.startFrame), [0, 1600]);
  assert.deepEqual(messages.map(message => message.samples.byteLength), [3200, 3200]);
});
