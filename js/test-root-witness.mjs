import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const ctx = {
  console,
  Storage: { saveRules() {} },
  StemDrop: {
    classifyStemDrop(lemma, surface) {
      const L = String(lemma || "");
      const S = String(surface || "");
      if (/하$/.test(L.replace(/다$/, "")) && /해/.test(S)) return null;
      return null;
    },
    KIND_TO_HINT: { ㅎ: "irr-h" },
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
const RS = ctx.RulesService;
const extra = [
  {
    id: "user-mot",
    title: "否定（-지 못하다）",
    category: "句型",
    structure: "詞幹＋지 못하다",
    explanation: "不能。",
  },
  {
    id: "user-ge",
    title: "使役（-게 하다）",
    category: "句型",
    structure: "詞幹＋게 하다",
    explanation: "使役。",
  },
  {
    id: "user-an",
    title: "簡略否定（안）",
    category: "句型",
    structure: "안＋用言",
    explanation: "短形否定。",
  },
  {
    id: "user-iya",
    title: "敘述句（-이야）",
    category: "語尾",
    structure: "名詞＋이야",
    explanation: "平語指定。",
  },
  {
    id: "user-banmal",
    title: "해體（반말）",
    category: "語尾",
    structure: "詞幹＋아/어",
    explanation: "반말。",
  },
];
RS.setAll([
  ...JSON.parse(fs.readFileSync(path.join(root, "data", "seed-rules.json"), "utf8")),
  ...extra,
]);

ctx.KiwiService = {
  ruleMatchesHint(rule, hint) {
    if (hint?.kind === "ef-haeche") {
      return rule.id === "seed-haeche" || /해체|반말|平語/.test(rule.title);
    }
    if (hint?.kind === "ef-haeyo") return rule.id === "seed-haeyo";
    if (hint?.kind === "jkg-ui") return rule.id === "seed-ui";
    if (hint?.kind === "jx-topic") return rule.id === "seed-topic";
    if (hint?.kind === "jko-object") return rule.id === "seed-object";
    if (hint?.kind === "etm-n-eun") return rule.id === "seed-adnominal-eun";
    if (hint?.kind === "etm-l-eul") return rule.id === "seed-adnominal-eul";
    if (hint?.kind === "irr-h") return rule.id === "seed-h-irregular";
    return false;
  },
  seedIdForKind(kind) {
    return (
      {
        "ef-haeche": "seed-haeche",
        "ef-haeyo": "seed-haeyo",
        "jkg-ui": "seed-ui",
        "jx-topic": "seed-topic",
        "jko-object": "seed-object",
        "etm-n-eun": "seed-adnominal-eun",
        "etm-l-eul": "seed-adnominal-eul",
        "irr-h": "seed-h-irregular",
      }[kind] || ""
    );
  },
};

function ids(inv) {
  return (inv.items || [])
    .map((it) => it.localRuleId || it.name)
    .sort()
    .join(" | ");
}

{
  const src = "다시 엉망인 걸";
  const tokens = [
    { form: "다시", tag: "MAG", start: 0, end: 2, word: "다시" },
    { form: "엉망", tag: "NNG", start: 3, end: 5, word: "엉망" },
    { form: "이", tag: "VCP", start: 5, end: 6, word: "인" },
    { form: "ㄴ", tag: "ETM", start: 5, end: 6, word: "인", zeroWidth: true },
    { form: "거", tag: "NNB", start: 7, end: 8, word: "걸" },
    { form: "ㄹ", tag: "JKO", start: 7, end: 8, word: "걸", zeroWidth: true },
  ];
  const attached = RS.attachLocalRulesToInventory(src, {
    tokens,
    items: [
      { name: "賓格（을/를）", category: "助詞", kiwiKind: "jko-object", span: "걸" },
      { name: "未來推測（-(으)ㄹ）", category: "語尾", kiwiKind: "etm-l-eul", span: "걸" },
      { name: "未來推測（-(으)ㄹ）", category: "語尾", span: "걸" },
      { name: "冠形詞形（-ㄴ/은）", category: "語尾", kiwiKind: "etm-n-eun", span: "인" },
    ],
  });
  const names = attached.items.map((it) => it.localRuleId || it.name);
  assert(
    names.includes("seed-object"),
    `걸 JKO should own 賓格 ${ids(attached)}`
  );
  assert(
    names.includes("seed-adnominal-eun"),
    `인 VCP+ㄴ should own 冠形 ${ids(attached)}`
  );
  assert(
    !names.includes("seed-adnominal-eul") &&
      !attached.items.some((it) => /未來推測/.test(it.name || "")),
    `인 걸 must not keep 未來推測 ${ids(attached)}`
  );
  const objLocs = RS.locateApiItemInText(
    src,
    attached.items.find((it) => it.localRuleId === "seed-object"),
    tokens
  );
  assert(
    objLocs.some((l) => src.slice(l.start, l.end).includes("걸") || l.text === "걸"),
    `걸 should locate as 을/를 ${JSON.stringify(objLocs)}`
  );
}

{
  const src = "내 움직임은 특이해 평범치 않아";
  const tokens = [
    { form: "내", tag: "NP", start: 0, end: 1, word: "내" },
    { form: "움직임", tag: "NNG", start: 2, end: 5, word: "움직임" },
    { form: "은", tag: "JX", start: 5, end: 6, word: "은" },
    { form: "특이", tag: "XR", start: 7, end: 9, word: "특이해" },
    { form: "하", tag: "XSA", start: 9, end: 10, word: "해" },
    { form: "해", tag: "EC", start: 9, end: 10, word: "해" },
    { form: "평범", tag: "NNG", start: 11, end: 13, word: "평범치" },
    { form: "하", tag: "XSV", start: 13, end: 14, word: "치" },
    { form: "지", tag: "EC", start: 13, end: 14, word: "치" },
    { form: "않", tag: "VX", start: 15, end: 16, word: "않아" },
    { form: "아", tag: "EF", start: 16, end: 17, word: "아" },
  ];
  const attached = RS.attachLocalRulesToInventory(src, {
    tokens,
    items: [
      { name: "ㅎ 不規則（ㅎ 불규칙）", category: "不規則", span: "특이해" },
      { name: "禮貌體（-아/어요）", category: "語尾", span: "특이해" },
      { name: "否定（-지 않다）", category: "句型", span: "평범치 않아" },
      { name: "否定（-지 못하다）", category: "句型", span: "평범치 않아" },
      { name: "使役（-게 하다）", category: "句型", span: "특이해" },
      { name: "簡略否定（안）", category: "句型", span: "않아" },
      { name: "所有格（의）", category: "助詞", kiwiKind: "jkg-ui", span: "내" },
      { name: "主題（은/는）", category: "助詞", kiwiKind: "jx-topic", span: "은" },
      { name: "平語（해체）", category: "語尾", kiwiKind: "ef-haeche", span: "해" },
      { name: "敘述句（-이야）", category: "語尾", span: "특이해" },
      { name: "해體（반말）", category: "語尾", span: "해" },
    ],
  });
  const owned = new Set(attached.items.map((it) => it.localRuleId).filter(Boolean));
  assert(owned.has("seed-negative"), `지 않다 kept ${ids(attached)}`);
  assert(owned.has("seed-ui"), `내 → 의 ${ids(attached)}`);
  assert(owned.has("seed-topic"), `은 topic ${ids(attached)}`);
  assert(owned.has("seed-haeche"), `해 平語 ${ids(attached)}`);
  assert(!owned.has("seed-h-irregular"), `하다→해 is not ㅎ ${ids(attached)}`);
  assert(!owned.has("seed-haeyo"), `no 요, not 禮貌體 ${ids(attached)}`);
  assert(!owned.has("user-mot"), `no 못 ${ids(attached)}`);
  assert(!owned.has("user-ge"), `no 게 ${ids(attached)}`);
  assert(!owned.has("user-an"), `않아 is not 안 ${ids(attached)}`);
  assert(!owned.has("user-iya"), `no 이야 ${ids(attached)}`);

  const topicLocs = RS.locateApiItemInText(
    src,
    { name: "主題（은/는）", nameKo: "은/는", category: "助詞", kiwiKind: "jx-topic" },
    tokens
  );
  assert(
    topicLocs.some((l) => src.slice(l.start, l.end) === "은"),
    `움직임은 的 은 應能定位 ${JSON.stringify(topicLocs)}`
  );
  const uiLocs = RS.locateApiItemInText(
    src,
    { name: "所有格（의）", nameKo: "의", category: "助詞", kiwiKind: "jkg-ui", span: "내" },
    tokens
  );
  assert(
    uiLocs.some((l) => src.slice(l.start, l.end) === "내"),
    `내 應定位為 의 ${JSON.stringify(uiLocs)}`
  );
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ok root witness");
