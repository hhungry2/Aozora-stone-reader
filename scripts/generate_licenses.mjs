import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packages = [
  "@non-standardworld/stone-engine.js",
  "react",
  "react-dom",
  "scheduler",
  "lucide-react",
];
const notices = [
  "Aozora-stone-reader — Third-party notices",
  "Catalog metadata: Aozora Bunko, CC BY 4.0. Extracted and converted to JSON.",
  "https://www.aozora.gr.jp/guide/kijyunn.html",
  "https://creativecommons.org/licenses/by/4.0/",
  "Book text rights and credits are recorded separately in each book JSON.",
];
for (const name of packages) {
  const directory = resolve("node_modules", name);
  const metadata = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  );
  const license = await readFile(resolve(directory, "LICENSE"), "utf8");
  notices.push(
    `\n${"=".repeat(72)}\n${name} ${metadata.version}\n${"=".repeat(72)}\n${license}`,
  );
}
const txtMiruLicense = await readFile(
  resolve("third_party/TxtMiruOnTheWeb/LICENSE"),
  "utf8",
);
notices.push(
  `\n${"=".repeat(72)}\nTxtMiruOnTheWeb (adapted site adapters and HTML relay)\nhttps://github.com/gearsns/TxtMiruOnTheWeb\nUpstream: da2c63591aa9ac0db1d0823e8f5bfb962eeaef63\n${"=".repeat(72)}\n${txtMiruLicense}`,
);
await writeFile(
  resolve("public/licenses.txt"),
  `${notices.join("\n").trimEnd()}\n`,
);
await copyFile(
  resolve("server/google-apps-script/Code.gs"),
  resolve("public/web-novel-proxy.gs.txt"),
);
