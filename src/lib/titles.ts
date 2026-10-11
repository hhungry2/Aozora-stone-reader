const titleBrackets = new Map([
  ["（", "）"],
  ["(", ")"],
  ["〈", "〉"],
  ["《", "》"],
  ["「", "」"],
  ["『", "』"],
  ["［", "］"],
  ["[", "]"],
  ["【", "】"],
  ["〔", "〕"],
]);

/** Remove balanced brackets enclosing the whole display title. */
export function displayTitle(title: string): string {
  let value = title.trim();
  while (value.length > 2) {
    const opening = value[0];
    const closing = titleBrackets.get(opening);
    if (!closing || !value.endsWith(closing)) break;
    let depth = 0;
    let enclosed = true;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === opening) depth += 1;
      else if (value[index] === closing) depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        enclosed = false;
        break;
      }
    }
    const inner = value.slice(1, -1).trim();
    if (!enclosed || depth !== 0 || !inner) break;
    value = inner;
  }
  return value;
}
