/** Local book assets use Vite's base; web novels retain their public HTTPS URLs. */
export function readerImageUrl(src: string): string {
  if (/^https:\/\//iu.test(src)) {
    try {
      const url = new URL(src);
      return url.username || url.password ? "" : url.href;
    } catch {
      return "";
    }
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src)) return "";
  return `${import.meta.env.BASE_URL}${src.replace(/^\//u, "")}`;
}
