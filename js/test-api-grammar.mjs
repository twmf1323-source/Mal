import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Storage: {
    loadSettings: () => ({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
    }),
    DEFAULT_SETTINGS: { baseUrl: "https://example.invalid/v1", model: "test-model" },
    isEnglishVocabSkip: () => false,
  },
  RulesService: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "ko-parse.js"), "utf8") +
    "\n;this.KoParse = KoParse;",
  ctx
);

const tokens = [
  { form: "는", word: "는", pos: "助詞", tag: "JX", start: 0, end: 1 },
  { form: "요", word: "요", pos: "語尾", tag: "EF", start: 1, end: 2 },
];
const candidates = [
  {
    name: "主題（은/는）",
    category: "助詞",
    tokenFrom: 0,
    tokenTo: 0,
    kiwiKind: "jx-topic",
    grammarKey: "kiwi:jx-topic",
    needsDisambiguation: true,
  },
  {
    name: "禮貌體（-아/어요）",
    category: "語尾",
    tokenFrom: 1,
    tokenTo: 1,
    kiwiKind: "ef-haeyo",
    grammarKey: "kiwi:ef-haeyo",
    needsDisambiguation: false,
  },
];
ctx.KoParse.fromKiwi = () => tokens;
ctx.KoParse.deterministicFunctions = () => candidates;
ctx.KiwiService = {
  isEnabled: () => true,
  ensureReady: async () => {},
  tokenize: async () => [{ str: "dummy" }],
};

function apiResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  };
}

vm.runInContext(
  fs.readFileSync(path.join(root, "js", "ai.js"), "utf8") +
    "\n;this.AiService = AiService;",
  ctx
);

const firstId = ctx.KoParse.candidateDecisionId(candidates[0]);
const secondId = ctx.KoParse.candidateDecisionId(candidates[1]);
const calls = [];
const responses = [
  {
    u: "第一輪",
    t: "翻譯",
    fn: [
      {
        q: firstId,
        x: "confirmed",
        g: "particle:topic",
        n: "主題助詞（은/는）",
        a: 0,
        b: 0,
        c: "助詞",
        f: "h",
      },
    ],
  },
  { fn: [{ q: secondId, x: "rejected", e: "此處不成立" }] },
];
ctx.fetch = async (_url, options) => {
  calls.push(JSON.parse(options.body));
  return apiResponse(responses.shift());
};

const repaired = await ctx.AiService.inventoryByKoParse("는요", { skipVocab: true });
if (calls.length !== 2) throw new Error(`expected one repair call, got ${calls.length}`);
if (!repaired.apiRepairUsed || repaired.unresolvedGrammarCount !== 0) {
  throw new Error(`repair did not complete ${JSON.stringify(repaired)}`);
}
if (repaired.apiRejectedCount !== 1 || repaired.items.length !== 1) {
  throw new Error(`rejected candidate leaked into items ${JSON.stringify(repaired)}`);
}
if (!calls[1].messages[1].content.includes(secondId)) {
  throw new Error("repair prompt omitted unresolved ID");
}
if (calls[1].messages[1].content.includes(firstId)) {
  throw new Error("repair prompt repeated an already resolved ID");
}
if (!calls[1].messages[1].content.includes("不要新增 new")) {
  throw new Error("repair prompt did not limit the second pass");
}

const completeCalls = [];
ctx.fetch = async (_url, options) => {
  completeCalls.push(JSON.parse(options.body));
  return apiResponse({
    u: "完整",
    t: "翻譯",
    fn: candidates.map((c, i) => ({
      q: ctx.KoParse.candidateDecisionId(c),
      x: "confirmed",
      g: c.grammarKey,
      n: c.name,
      a: i,
      b: i,
      c: c.category,
      f: "h",
    })),
  });
};
const complete = await ctx.AiService.inventoryByKoParse("는요", { skipVocab: true });
if (completeCalls.length !== 1 || complete.apiRepairUsed) {
  throw new Error(`complete response should not trigger repair ${completeCalls.length}`);
}
if (complete.items.length !== 2 || complete.mappingFailed) {
  throw new Error(`complete response lost grammar items ${JSON.stringify(complete)}`);
}

console.log("ok api grammar contract", calls.length, "calls with repair;", completeCalls.length, "without");
