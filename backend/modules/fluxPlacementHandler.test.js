process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ??= 'service-role-key';
process.env.SUPABASE_STORAGE_BUCKET ??= 'generated-tattoos';

import test from 'node:test';
import assert from 'node:assert/strict';

const { __testables } = await import('./fluxPlacementHandler.js');
const { clamp, chooseAdaptiveScale, pickEngine } = __testables;

test('clamp bounds values correctly', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(20, 0, 10), 10);
});

test('chooseAdaptiveScale boosts thin line tattoos', () => {
  const stats = { coverage: 0.05, thinness: 0.2, solidity: 0.9 };
  const result = chooseAdaptiveScale(stats);
  assert.equal(result.isThinLine, true);
  assert.equal(result.hasHaloSplash, false);
  assert.ok(result.scale >= 1.2 && result.scale <= 1.5);
  assert.equal(Number(result.scale.toFixed(3)), 1.375);
});

test('chooseAdaptiveScale keeps halo-heavy designs neutral', () => {
  const stats = { coverage: 0.25, thinness: 0.05, solidity: 0.4 };
  const result = chooseAdaptiveScale(stats);
  assert.equal(result.hasHaloSplash, true);
  assert.equal(result.scale, 1.0);
});

test('pickEngine switches to fill for thin lines when adaptive is enabled', () => {
  assert.equal(pickEngine('kontext', true, true), 'fill');
  assert.equal(pickEngine('kontext', false, true), 'kontext');
  assert.equal(pickEngine('fill', true, false), 'fill');
});
