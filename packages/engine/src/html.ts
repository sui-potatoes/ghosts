/** Personnel names come from local editor input, not authored markup. */
export const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** Counters and turn numbers read as two digits: 03, 12. */
export const pad2 = (n: number) => String(n).padStart(2, "0");
