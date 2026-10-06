import { KiwiBuilder, Match } from "../vendor/kiwi-nlp/dist/index.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const builder = await KiwiBuilder.create(
  pathToFileURL(path.join(root, "vendor", "kiwi-nlp", "dist", "kiwi-wasm.wasm")).href
);
const modelDir = path.join(root, "vendor", "kiwi", "models", "cong", "base");
const modelFiles = Object.fromEntries(
  ["combiningRule.txt", "cong.mdl", "default.dict", "extract.mdl", "sj.morph", "typo.dict", "dialect.dict"].map(
    (name) => [name, new Uint8Array(fs.readFileSync(path.join(modelDir, name)))]
  )
);
const kiwi = await builder.build({
  modelFiles,
  modelType: "cong",
  loadDefaultDict: true,
  loadTypoDict: true,
  loadMultiDict: false,
  integrateAllomorph: true,
});

const ctx = {
  console,
  TextDecoder,
  URL,
  setTimeout,
  clearTimeout,
  Storage: { loadSettings: () => ({ kiwiEnabled: true }) },
  RulesService: { getAll: () => [] },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "kiwi.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "ko-parse.js"), "utf8") +
    "\n;this.KiwiService = KiwiService; this.KoParse = KoParse;",
  ctx
);

const source = "이 별을 숨길 수 있게";
const result = kiwi.tokenize(source, Match.allWithNormalizing);
const rawTokens = result?.[0]?.tokens || result?.tokens || result || [];
const tokens = ctx.KoParse.fromKiwi(source, rawTokens);
const candidates = ctx.KoParse.deterministicFunctions(source, tokens);
const possible = candidates.find((c) => c.kiwiKind === "eul-su-it");
if (!possible || possible.name !== "可能（-ㄹ 수 있다）") {
  console.error("FAIL possibility candidate", candidates);
  process.exit(1);
}

const items = ctx.KoParse.functionsToItems(
  tokens,
  [{ name: "未來推測（-(으)ㄹ）", tokenFrom: possible.tokenFrom, tokenTo: possible.tokenFrom, category: "語尾" }],
  candidates,
  { src: source }
);
if (!items.some((item) => item.name === "可能（-ㄹ 수 있다）")) {
  console.error("FAIL overlapping possibility item", items);
  process.exit(1);
}

// 種子筆記本目前沒有「可能」卡，必須維持未配對，交給畫面列為尚未收錄。
const ruleCtx = {
  console,
  StemDrop: require("./stem-drop.js"),
  Storage: { saveRules() {} },
  KiwiService: ctx.KiwiService,
};
ruleCtx.globalThis = ruleCtx;
vm.createContext(ruleCtx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "affix-gate.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") +
    "\n;this.RulesService = RulesService; this.AffixGate = AffixGate;",
  ruleCtx
);
ruleCtx.RulesService.setAll(
  JSON.parse(fs.readFileSync(path.join(root, "js", "test-fixtures", "legacy-seed-rules.json"), "utf8"))
);
const falseOwned = ruleCtx.RulesService.findInventoryRule({
  name: "可能（-ㄹ 수 있다）",
  nameZh: "可能",
  nameKo: "-ㄹ 수 있다",
  span: "길 수 있",
  category: "句型",
});
if (falseOwned?.owned) {
  console.error("FAIL possibility should be missing, matched", falseOwned.rule?.title);
  process.exit(1);
}
const strictTopicOwned = ruleCtx.RulesService.findInventoryRule({
  name: "主題助詞（은/는）",
  nameZh: "主題助詞",
  nameKo: "은/는",
  category: "助詞",
  kiwiKind: "jx-topic",
});
if (!strictTopicOwned?.owned || strictTopicOwned.rule?.id !== "seed-topic") {
  console.error("FAIL strict topic inventory match", strictTopicOwned);
  process.exit(1);
}
const stableKeyTopicOwned = ruleCtx.RulesService.findInventoryRule({
  name: "主題助詞（은/는）",
  nameZh: "主題助詞",
  nameKo: "은/는",
  category: "助詞",
  grammarKey: "kiwi:jx-topic",
});
if (!stableKeyTopicOwned?.owned || stableKeyTopicOwned.rule?.id !== "seed-topic") {
  console.error("FAIL stable grammar key inventory match", stableKeyTopicOwned);
  process.exit(1);
}

// 붉은 的形態是形容詞現在冠形 -ㄴ/은；不可寬鬆錯配到過去冠形或 다른 詞彙卡。
const redSource = "붉은 달아, ay ay ay ah";
const redResult = kiwi.tokenize(redSource, Match.allWithNormalizing);
const redRawTokens = redResult?.[0]?.tokens || redResult?.tokens || redResult || [];
const redTokens = ctx.KoParse.fromKiwi(redSource, redRawTokens);
const redCandidate = ctx.KoParse
  .deterministicFunctions(redSource, redTokens)
  .find((c) => c.kiwiKind === "etm-n-eun");
if (!redCandidate) {
  console.error("FAIL red adnominal candidate");
  process.exit(1);
}
const falseRules = [
  {
    id: "bad-past-adnominal",
    title: "過去冠形詞形語尾（-ㄴ）",
    category: "語尾",
    explanation: "動詞過去冠形",
    structure: "動詞詞幹＋ㄴ",
  },
  {
    id: "bad-dareun",
    title: "不同的（다른）",
    category: "其他",
    explanation: "形容詞冠形",
    structure: "다르다＋ㄴ→다른",
  },
];
ruleCtx.RulesService.setAll(falseRules);
const redFalseItems = ctx.KoParse.functionsToItems(
  redTokens,
  [
    {
      name: "過去冠形詞形語尾（-ㄴ）",
      tokenFrom: redCandidate.tokenFrom,
      tokenTo: redCandidate.tokenTo,
      category: "語尾",
    },
    {
      name: "不同的（다른）",
      tokenFrom: redCandidate.tokenFrom,
      tokenTo: redCandidate.tokenTo,
      category: "其他",
    },
  ],
  [redCandidate],
  { src: redSource }
);
for (const item of redFalseItems.filter((it) => /過去冠形|不同的/.test(it.name))) {
  if (item.kiwiKind !== "etm-n-eun") {
    console.error("FAIL missing morphology witness", item);
    process.exit(1);
  }
  const matched = ruleCtx.RulesService.findInventoryRule(item);
  if (matched?.owned) {
    console.error("FAIL API false card survived", item.name, matched.rule?.title);
    process.exit(1);
  }
}
const falseRedMatch = ruleCtx.RulesService.findInventoryRule({
  name: redCandidate.name,
  nameZh: "冠形詞形",
  nameKo: "-ㄴ/은",
  span: "은",
  category: "語尾",
  kiwiKind: "etm-n-eun",
});
if (falseRedMatch?.owned) {
  console.error("FAIL red adnominal false match", falseRedMatch.rule?.title);
  process.exit(1);
}
if (ruleCtx.RulesService.ruleHasLiteralSurfaceWitness(falseRules[1], redSource)) {
  console.error("FAIL 다른 literal witness");
  process.exit(1);
}

// API 只回報句尾「-(으)ㄹ래」時，不能連帶丟掉前面未處理的主題助詞 은。
const topicSource = "Moon 제발 이곳은 혼자일래";
const topicResult = kiwi.tokenize(topicSource, Match.allWithNormalizing);
const topicRawTokens = topicResult?.[0]?.tokens || topicResult?.tokens || topicResult || [];
const topicTokens = ctx.KoParse.fromKiwi(topicSource, topicRawTokens);
const topicCandidates = ctx.KoParse.deterministicFunctions(topicSource, topicTokens);
const topicCandidate = topicCandidates.find((c) => c.kiwiKind === "jx-topic");
if (!topicCandidate) {
  console.error("FAIL topic candidate", topicCandidates);
  process.exit(1);
}
const topicItems = ctx.KoParse.functionsToItems(
  topicTokens,
  [
    {
      name: "意圖與意志語尾（을래）",
      tokenFrom: topicTokens.length - 1,
      tokenTo: topicTokens.length - 1,
      category: "語尾",
    },
  ],
  topicCandidates,
  { src: topicSource }
);
if (!topicItems.some((item) => item.name === "主題（은/는）")) {
  console.error("FAIL omitted topic fallback", topicItems);
  process.exit(1);
}
console.log("ok possibility", possible.tokenFrom, possible.tokenTo, items.map((item) => item.name).join(" | "));
