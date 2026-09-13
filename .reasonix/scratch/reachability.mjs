import { readFileSync } from "node:fs";

const src = readFileSync("assets/js/app.js", "utf8");
const defs = [...src.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
const defBlocks = {};
for (let i = 0; i < defs.length; i += 1) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${defs[i]}\\(`);
  const start = src.search(re);
  let end = src.length;
  for (let j = i + 1; j < defs.length; j += 1) {
    const otherStart = src.search(new RegExp(`(?:async\\s+)?function\\s+${defs[j]}\\(`));
    if (otherStart > start) { end = otherStart; break; }
  }
  defBlocks[defs[i]] = src.slice(start, end);
}

const callees = new Map();
for (const name of defs) callees.set(name, []);
for (const name of defs) {
  for (const other of defs) {
    if (name === other) continue;
    if (new RegExp(`\\b${other}\\s*\\(`).test(defBlocks[name])) callees.get(name).push(other);
  }
}

// Module-level code: strip function definitions (from "function"/"async function" line to the closing "}" line)
const topLevel = src.replace(/^(?:async\s+)?function\s+[^{]*\{[\s\S]*?\n\}/gm, "");
const liveRoots = new Set();
for (const name of defs) {
  if (new RegExp(`\\b${name}\\s*\\(`).test(topLevel)) liveRoots.add(name);
}

const live = new Set();
function mark(name) {
  if (live.has(name)) return;
  live.add(name);
  for (const callee of callees.get(name) || []) mark(callee);
}
for (const root of liveRoots) mark(root);

console.log("LIVE roots:", [...liveRoots].join(", "));
console.log("\nDEAD functions:");
for (const name of defs) {
  if (!live.has(name)) console.log("  " + name);
}
console.log("\nLIVE functions:", [...live].sort().join(", "));
