// Deterministic, render-pure seed derived from a string (used for stable
// fallback counts in the feed instead of Math.random during render).
export function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
