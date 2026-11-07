import { master } from './master.js';

const ops = { master };

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    const result = ops[op](args, (value) => self.postMessage({ id, type: 'progress', value }));
    const transfer = result && result.wav ? [result.wav] : [];
    self.postMessage({ id, type: 'done', result }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
