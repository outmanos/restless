// Scrolls to a setting on the page, highlights it for a moment and puts the keyboard there. The controls are
// found by their name, since each setting control is named after its setting.
const HIGHLIGHT_MS = 1800;

export const findSettingElement = (key: string, root: ParentNode = document): HTMLElement | null =>
  root.querySelector<HTMLElement>(
    [`[data-testid="setting-${key}"]`, `[name="${key}"]`, `[data-testid="${key}"]`].join(', '),
  );

export const focusSetting = (key: string, root: ParentNode = document): boolean => {
  const element = findSettingElement(key, root);
  if (!element) {
    return false;
  }
  const target = element.closest<HTMLElement>('.form-control, label, [role="group"]') ?? element;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('setting-found');
  setTimeout(() => target.classList.remove('setting-found'), HIGHLIGHT_MS);
  const focusable = element.matches('input, select, textarea, button')
    ? element
    : element.querySelector('input, select, textarea, button');
  (focusable as HTMLElement | null)?.focus({ preventScroll: true });
  return true;
};
