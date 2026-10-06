import { createRequire } from "node:module";
import { KiwiBuilder, Match } from "../vendor/kiwi-nlp/dist/index.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const StemDrop = require("./stem-drop.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const ctx = {
  StemDrop,
  console,
  Storage: { saveRules() {} },
  KiwiService: {
    ruleMatchesHint(rule, hint) {
      if (hint?.kind === "etm-l-eul") {
        return (
          rule?.id === "seed-adnominal-eul" ||
          /未來推測（-\(으\)ㄹ）/.test(rule?.title || "")
        );
      }
      if (hint?.kind === "etm-neun") return rule?.id === "seed-adnominal-neun";
      return false;
    },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "affix-gate.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") +
    "\n;this.RulesService = RulesService; this.AffixGate = AffixGate;",
  ctx
);
const seed = JSON.parse(fs.readFileSync(path.join(root, "js", "test-fixtures", "legacy-seed-rules.json"), "utf8"));
ctx.RulesService.setAll(seed);

const RS = ctx.RulesService;
const future = RS.getById("seed-adnominal-eul");
if (!future || !RS.isFutureEulRule(future)) {
  failed += 1;
  console.error("FAIL seed-adnominal-eul not recognized as future eul");
}
if (RS.isFutureEulRule(RS.getById("seed-l-deletion"))) {
  failed += 1;
  console.error("FAIL ㄹ 脫落 should not be future eul");
}
if (RS.isFutureEulRule(RS.getById("seed-manhada"))) {
  failed += 1;
  console.error("FAIL 만하다 should not be future eul");
}
if (!RS.hasRieulBatchim("줄") || !RS.hasRieulBatchim("갈") || RS.hasRieulBatchim("먹")) {
  failed += 1;
  console.error("FAIL hasRieulBatchim");
}

const keys = RS.normalizeGrammarKey("-(으)ㄹ");
// expand via rank / needles
const needles = RS.collectRuleNeedles(future);
if (!needles.includes("을")) {
  failed += 1;
  console.error(`FAIL needles missing 을: [${needles.join(", ")}]`);
}

const rankCases = [
  {
    sel: "줄",
    queryLike: "줄 사람",
    hints: [{ kind: "etm-l-eul", score: 36, reason: "未來／冠形 -(으)ㄹ" }],
    kiwiAnalyzed: true,
    want: "seed-adnominal-eul",
    reject: ["seed-l-deletion", "seed-object"],
  },
  {
    sel: "먹을",
    hints: [{ kind: "etm-l-eul", score: 36, reason: "未來／冠形 -(으)ㄹ" }],
    kiwiAnalyzed: true,
    want: "seed-adnominal-eul",
  },
  {
    sel: "줄",
    hints: [],
    kiwiAnalyzed: true,
    reject: ["seed-adnominal-eul"],
  },
];

for (const row of rankCases) {
  const ranked = RS.rankRulesForSpan(row.sel, {
    minScore: 8,
    maxSuggest: 8,
    kiwiHints: row.hints,
    kiwiAnalyzed: row.kiwiAnalyzed,
  });
  const ids = ranked.suggestions.map((s) => s.rule.id);
  if (row.want && !ids.includes(row.want)) {
    failed += 1;
    console.error(`FAIL rank ${row.sel}: missing ${row.want} in [${ids.join(", ")}]`);
  }
  for (const bad of row.reject || []) {
    if (ids.includes(bad)) {
      failed += 1;
      console.error(`FAIL rank ${row.sel}: should not suggest ${bad} in [${ids.join(", ")}]`);
    }
  }
}

const builder = await KiwiBuilder.create(
  pathToFileURL(path.join(root, "vendor", "kiwi-nlp", "dist", "kiwi-wasm.wasm")).href
);
const files = [
  "combiningRule.txt",
  "cong.mdl",
  "default.dict",
  "extract.mdl",
  "sj.morph",
  "typo.dict",
  "dialect.dict",
];
const modelDir = path.join(root, "vendor", "kiwi", "models", "cong", "base");
const modelFiles = Object.fromEntries(
  files.map((name) => [name, new Uint8Array(fs.readFileSync(path.join(modelDir, name)))])
);
const kiwi = await builder.build({
  modelFiles,
  modelType: "cong",
  loadDefaultDict: true,
  loadTypoDict: true,
  loadMultiDict: false,
  integrateAllomorph: true,
});

function canonForm(s) {
  return String(s || "")
    .normalize("NFC")
    .replace(/ᆯ/g, "ㄹ");
}
function baseTag(tag) {
  return String(tag || "").split(/[-+]/)[0];
}
function isPred(tag) {
  const t = baseTag(tag);
  return t === "VV" || t === "VA" || t === "VX" || t === "XSV" || t === "XSA" || t === "VCN" || t === "VCP";
}

function hasEtmLEul(text) {
  const tokens = kiwi.tokenize(text, Match.allWithNormalizing);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const form = canonForm(tok.str);
    const prev = tokens[i - 1];
    if (baseTag(tok.tag) === "ETM" && (form === "ㄹ" || form === "을") && prev && isPred(prev.tag)) {
      return true;
    }
  }
  return false;
}

const kiwiCases = [
  ["줄 사람", true],
  ["갈 사람", true],
  ["먹을 거", true],
  ["할 줄 알아", true],
  ["줄", false],
  ["줄 알았어", false],
  ["가는 사람", false],
  ["예쁜 옷", false],
];

for (const [text, want] of kiwiCases) {
  const got = hasEtmLEul(text);
  if (got !== want) {
    failed += 1;
    const dump = kiwi
      .tokenize(text, Match.allWithNormalizing)
      .map((t) => `${t.str}/${t.tag}@${t.position}+${t.length}`)
      .join("  ");
    console.error(`FAIL kiwi ${text}: want etm-l-eul=${want}, got ${got} :: ${dump}`);
  }
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`ok eul seed + rank + ${kiwiCases.length} kiwi`);
