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
    saveRules() {},
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") + "\n;this.RulesService = RulesService;",
  ctx
);
ctx.RulesService.setAll(
  JSON.parse(fs.readFileSync(path.join(root, "js", "test-fixtures", "legacy-seed-rules.json"), "utf8"))
);

ctx.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  const user = body.messages.find((m) => m.role === "user")?.content || "";
  if (!user.includes("禁止（-지 마）")) {
    throw new Error("batch prompt missing missing-rule name");
  }
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                r: [
                  {
                    n: "禁止（-지 마）",
                    c: "句型",
                    e: "動詞詞幹後接 지 마 表示禁止。",
                    s: "詞幹＋지 마",
                  },
                ],
              }),
            },
          },
        ],
      }),
  };
};

vm.runInContext(
  fs.readFileSync(path.join(root, "js", "ai.js"), "utf8") + "\n;this.AiService = AiService;",
  ctx
);

const inv = await ctx.AiService.fillMissingRuleDrafts({
  items: [
    { name: "해요體（-아/어요）", category: "語尾", span: "해요" },
    { name: "禁止（-지 마）", category: "句型", span: "지 마" },
  ],
});

if (inv.items[0].localRuleId !== "seed-haeyo") {
  throw new Error(`owned item should attach, not generate ${JSON.stringify(inv.items[0])}`);
}
if (inv.items[0].draft) {
  throw new Error("owned item must not get a generated draft");
}
if (!inv.items[1].draft || inv.items[1].draft.structure !== "詞幹＋지 마") {
  throw new Error(`missing item should get draft ${JSON.stringify(inv.items[1])}`);
}
if (inv.items[1].localRuleId) {
  throw new Error("unrecorded item should stay missing");
}

const preserved = await ctx.AiService.fillMissingRuleDrafts({
  items: [
    {
      name: "禁止（-지 마）",
      draft: { title: "禁止（-지 마）", explanation: "已有", structure: "詞幹＋지 마" },
    },
  ],
});
if (preserved.items[0].draft.explanation !== "已有") {
  throw new Error("existing draft must not be overwritten");
}

console.log("ok fill missing drafts");
