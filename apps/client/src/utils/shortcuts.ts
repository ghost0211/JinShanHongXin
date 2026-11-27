export interface ShortcutKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
}

export function isEditableKeyTarget(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    Boolean(el.isContentEditable)
  );
}

export function isInteractiveKeyTarget(target: EventTarget | null | undefined): boolean {
  if (isEditableKeyTarget(target)) return true;
  const el = target as { tagName?: string } | null | undefined;
  const tag = el?.tagName?.toUpperCase();
  return tag === 'BUTTON' || tag === 'A';
}

export function shouldTriggerSettlementNextRound(
  e: ShortcutKeyEventLike,
  opts: {
    hasSettlement: boolean;
    hasMatchWinner: boolean;
    shortcutBlocked?: boolean;
  },
): boolean {
  if (!opts.hasSettlement || opts.hasMatchWinner || opts.shortcutBlocked) {
    return false;
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) {
    return false;
  }
  if (isInteractiveKeyTarget(e.target)) {
    return false;
  }
  return e.key === 'Enter' || e.key === ' ';
}
