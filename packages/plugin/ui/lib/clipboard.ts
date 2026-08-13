/**
 * Copy text to the clipboard with a graceful fallback for sandboxed iframes.
 *
 * `navigator.clipboard` is often unavailable (or blocked) inside the Figma plugin UI's iframe, so we
 * fall back to a hidden `<textarea>` + `execCommand('copy')`, which still works there. Returns whether
 * the copy actually succeeded so the caller can surface feedback.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};
