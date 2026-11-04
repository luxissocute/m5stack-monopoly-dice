// Keep the link selected when automatic copying is unavailable.
export async function copyLink(input: HTMLInputElement): Promise<boolean> {
  const text = input.value;
  if (!text) return false;
  input.focus();
  input.select();
  try {
    if (window.labuHost?.copyLink && await window.labuHost.copyLink(text)) return true;
  } catch { /* Fall back to browser copying. */ }
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Clipboard permissions may be unavailable in this browser. */ }
  input.focus();
  input.select();
  try { return document.execCommand('copy'); } catch { return false; }
}
