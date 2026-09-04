import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = {
  console,
  Storage: { saveRules() {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") + "\n;this.RulesService = RulesService;",
  ctx
);
const RS = ctx.RulesService;
RS.setAll(JSON.parse(fs.readFileSync(path.join(root, "data", "seed-rules.json"), "utf8")));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const attached = RS.attachLocalRulesToInventory("오늘 날씨가 좋아요", {
  items: [
    {
      name: "해요體（-아요/어요）",
      nameZh: "해요體",
      nameKo: "-아요/어요",
      category: "語尾",
      span: "좋아요",
    },
    {
      name: "主題助詞（는）",
      nameZh: "主題助詞",
      nameKo: "는",
      category: "助詞",
      span: "가",
    },
    {
      name: "可能（-ㄹ 수 있다）",
      nameZh: "可能",
      nameKo: "-ㄹ 수 있다",
      category: "句型",
      span: "수 있",
    },
  ],
});

assert(
  attached.items.some((it) => it.localRuleId === "seed-haeyo"),
  `haeyo attach ${JSON.stringify(attached.items)}`
);
assert(
  attached.items.some((it) => it.localRuleId === "seed-haeyo" && it.name === "禮貌體（-아/어요）"),
  `haeyo title ${JSON.stringify(attached.items)}`
);
assert(
  !attached.items.some((it) => it.localRuleId === "seed-topic"),
  `topic without 은/는 must drop ${JSON.stringify(attached.items)}`
);
assert(
  !attached.items.some((it) => /可能|수 있다/.test(String(it.name || "")) && it.localRuleId),
  `possibility stays missing ${JSON.stringify(attached.items)}`
);

ctx.KiwiService = {
  ruleMatchesHint(rule, hint) {
    return rule.id === "seed-haeche" && hint && hint.kind === "ef-haeche";
  },
};
const despiteKind = RS.attachLocalRulesToInventory("좋아요", {
  items: [
    {
      name: "禮貌體（-아/어요）",
      category: "語尾",
      kiwiKind: "ef-haeche",
      span: "요",
    },
  ],
});
assert(
  !despiteKind.items.some((it) => it.localRuleId === "seed-haeyo"),
  `ef-haeche must not keep 禮貌體 on 좋아요 ${JSON.stringify(despiteKind.items)}`
);
assert(
  !despiteKind.items.some((it) => it.localRuleId === "seed-haeche"),
  `좋아요 is not 해체 ${JSON.stringify(despiteKind.items)}`
);

const alreadyManual = RS.attachLocalRulesToInventory("좋아요", {
  items: [
    {
      name: "舊名",
      manualRuleId: "seed-past",
      span: "좋아",
    },
  ],
});
assert(alreadyManual.items[0].manualRuleId === "seed-past", "manual id kept");
assert(alreadyManual.items[0].name === "過去（-았/었-）", `manual retitled ${alreadyManual.items[0].name}`);

RS.setAll([
  ...RS.getAll(),
  {
    id: "user-supp-monster",
    title: "像怪物一樣（괴물처럼）",
    category: "補充用法",
    explanation: "歌詞補充。",
    structure: "",
  },
]);
const suppAttached = RS.attachLocalRulesToInventory("내 움직임은 특이해", {
  items: [
    {
      name: "像怪物一樣（괴물처럼）",
      nameKo: "괴물처럼",
      nameZh: "像怪物一樣",
      category: "補充用法",
      span: "",
      source: "manual",
      manualRuleId: "user-supp-monster",
    },
    {
      name: "使役（-게 하다）",
      category: "句型",
      span: "특이해",
    },
  ],
});
assert(
  suppAttached.items.some((it) => it.manualRuleId === "user-supp-monster"),
  `supplementary must stay after attach ${JSON.stringify(suppAttached.items)}`
);
assert(
  !suppAttached.items.some((it) => /使役|게 하다/.test(String(it.name || ""))),
  `false 게 하다 still dropped ${JSON.stringify(suppAttached.items)}`
);
assert(
  RS.morphWitness(
    "내 움직임은 특이해",
    { name: "像怪物一樣（괴물처럼）", category: "補充用法" },
    RS.getById("user-supp-monster"),
    []
  ) !== "miss",
  "supplementary morphWitness must not miss"
);

console.log("ok attach local rules");
