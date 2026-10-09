import type { ReaderSettings } from "../types";

const webFonts: Partial<Record<ReaderSettings["font"], string>> = {
  "noto-sans": "Noto Sans JP",
  "noto-serif": "Noto Serif JP",
  "zen-kaku": "Zen Kaku Gothic New",
  shippori: "Shippori Mincho",
  "hiragino-sans": "Noto Sans JP",
  "hiragino-serif": "Noto Serif JP",
};
const stylesheets = new Map<string, Promise<void>>();

/** Load only the selected web font; system fallbacks keep reading available. */
export async function loadReaderFont(
  font: ReaderSettings["font"],
  sample: string,
): Promise<void> {
  const family = webFonts[font];
  if (!family || !document.fonts) return;
  let stylesheet = stylesheets.get(family);
  if (!stylesheet) {
    stylesheet = new Promise<void>((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@400;700&display=swap`;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error("Font stylesheet unavailable"));
      document.head.append(link);
    });
    stylesheets.set(family, stylesheet);
  }
  try {
    await stylesheet;
    await document.fonts.load(`20px "${family}"`, sample || "日本語");
  } catch {
    // Font downloads are optional: the selected family includes system fallbacks.
  }
}
