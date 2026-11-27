import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isEditableKeyTarget,
  isInteractiveKeyTarget,
  shouldTriggerSettlementNextRound,
} from '../src/utils/shortcuts.ts';

test('settlement next-round shortcut triggers only when unblocked and on non-interactive targets', () => {
  const docTarget = { tagName: 'DIV', isContentEditable: false };

  // Normal round settlement with no overlaid modal: Enter and Space trigger next round
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: 'Enter', target: docTarget },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: false },
    ),
    true,
  );
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: ' ', target: null },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: false },
    ),
    true,
  );

  // Overlaid modal (Settings, Rules, ScoreDetail, LastTrick, etc.) suspends the shortcut
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: 'Enter', target: docTarget },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: true },
    ),
    false,
  );
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: ' ', target: docTarget },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: true },
    ),
    false,
  );

  // Match-over, missing settlement, modifier keys, repeat, or interactive focus do not trigger
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: 'Enter', target: docTarget },
      { hasSettlement: true, hasMatchWinner: true, shortcutBlocked: false },
    ),
    false,
  );
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: 'Enter', target: docTarget },
      { hasSettlement: false, hasMatchWinner: false, shortcutBlocked: false },
    ),
    false,
  );
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: 'Enter', ctrlKey: true, target: docTarget },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: false },
    ),
    false,
  );
  assert.equal(
    shouldTriggerSettlementNextRound(
      { key: ' ', repeat: true, target: docTarget },
      { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: false },
    ),
    false,
  );

  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) {
    assert.equal(
      shouldTriggerSettlementNextRound(
        { key: 'Enter', target: { tagName } },
        { hasSettlement: true, hasMatchWinner: false, shortcutBlocked: false },
      ),
      false,
    );
  }
  assert.equal(isEditableKeyTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableKeyTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isInteractiveKeyTarget({ tagName: 'BUTTON' }), true);
  assert.equal(isInteractiveKeyTarget({ tagName: 'DIV' }), false);
});
