/** Explicit gzip files work on static hosts without Content-Encoding rules. */
export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!new URL(url).pathname.endsWith(".gz"))
    return response.json() as Promise<T>;
  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  // Some hosts set Content-Encoding and fetch has already decompressed the file.
  if (signature[0] !== 0x1f || signature[1] !== 0x8b)
    return new Response(bytes).json() as Promise<T>;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"), { signal });
  return new Response(stream).json() as Promise<T>;
}
