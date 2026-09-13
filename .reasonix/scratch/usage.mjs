import { readFileSync } from "node:fs";

const src = readFileSync("assets/js/app.js", "utf8");
const defs = [...src.matchAll(/^function\s+(\w+)/gm)].map((m) => m[1]);
for (const name of defs) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  const count = (src.match(pattern) || []).length;
  console.log(`${String(count).padStart(2)}  ${name}`);
}
