import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let rulesRead = 0;
const ctx = {
  console,
  URL,
  TextDecoder,
  Storage: { loadSettings: () => ({ kiwiEnabled: true }) },
  RulesService: {
    getAll: () => {
      rulesRead += 1;
      throw new Error("grammar rules must not be read while grammar modes are off");
    },
  },
  KoParse: {
    fromKiwi: (_query, tokens) => tokens,
    slimTokens: (tokens) => tokens.map((t) => ({ ...t })),
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "kiwi.js"), "utf8") +
    "\n;this.KiwiService = KiwiService;",
  ctx
);

const inventory = { items: [], vocab: [], mode: "manual", grammarEnabled: false };
const result = ctx.KiwiService.enrichInventoryFromTokens(
  "줘",
  inventory,
  [{ str: "주", tag: "VV", position: 0, length: 1 }],
  { includeGrammar: false }
);

if (rulesRead !== 0) throw new Error(`read ${rulesRead} local rule collections`);
if (result.items.length !== 0) throw new Error(`attached grammar in manual mode ${JSON.stringify(result.items)}`);
if (!Array.isArray(result.tokens) || result.tokens.length !== 1) {
  throw new Error("Kiwi token data should remain available for hover/morphology");
}

console.log("ok grammar mode gate");
