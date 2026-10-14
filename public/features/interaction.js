function fieldKey(element) {
  if (element.id) return '#' + CSS.escape(element.id);
  const attribute = [...element.attributes].find((item) => item.name === 'name' || item.name.startsWith('data-'));
  return attribute ? `[${attribute.name}="${CSS.escape(attribute.value)}"]` : null;
}

export function sizeReviewEditors(root) {
  for (const field of root.querySelectorAll('.queue-view textarea, .merge-wizard textarea')) {
    field.style.height = 'auto';
    field.style.height = Math.max(120, field.scrollHeight + 4) + 'px';
    field.style.overflow = 'hidden';
  }
}

export function preserveInteraction(root, context) {
  const previousContext = root.dataset.interactionContext;
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = active && fieldKey(active);
  const selection =
    active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const fields = [...root.querySelectorAll('input:not([type="file"]):not([type="password"]), textarea')].map(
    (element) => ({ key: fieldKey(element), value: element.value, initial: element.defaultValue })
  );
  return () => {
    root.dataset.interactionContext = context;
    if (context === previousContext) {
      for (const field of fields) {
        const replacement = field.key && root.querySelector(field.key);
        if (replacement && replacement.defaultValue === field.initial) replacement.value = field.value;
      }
      const replacement = focusKey && root.querySelector(focusKey);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        if (selection && replacement.setSelectionRange) replacement.setSelectionRange(...selection);
      }
    }
    sizeReviewEditors(root);
  };
}
