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
  URL,
  TextDecoder,
  Storage: { loadSettings: () => ({ kiwiEnabled: true }), saveRules() {} },
  StemDrop: { classifyStemDrop() { return null; }, KIND_TO_HINT: {} },
  RulesService: { getAll: () => [] },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "kiwi.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "affix-gate.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") +
    "\n;this.KiwiService = KiwiService; this.RulesService = RulesService; this.AffixGate = AffixGate;",
  ctx
);

const seed = JSON.parse(fs.readFileSync(path.join(root, "data", "seed-rules.json"), "utf8"));
ctx.RulesService.setAll(seed);
const RS = ctx.RulesService;
const KS = ctx.KiwiService;

assert(KS.fusedTopicFromForm("더는")?.particle === "는", "더는 → 는");
assert(KS.fusedTopicFromForm("다시는")?.host === "다시", "다시는");
assert(KS.fusedTopicFromForm("아직은")?.particle === "은", "아직＋은");
assert(!KS.fusedTopicFromForm("가는"), "가는 is not fused topic");
assert(!KS.fusedTopicFromForm("는"), "bare 는");

const src = "더는 망설이지 마 제발 내 심장을 거두어 가";
const hits = KS.analyzeHits(src, [
  { str: "더는", tag: "MAG", position: 0, length: 2 },
  { str: "망설이", tag: "VV", position: 3, length: 3 },
  { str: "지", tag: "EC", position: 6, length: 1 },
  { str: "마", tag: "VX", position: 8, length: 1 },
]);
const topic = hits.find((h) => h.kind === "jx-topic");
assert(topic, `jx-topic hit ${JSON.stringify(hits.map((h) => h.kind + ":" + h.text))}`);
assert(src.slice(topic.start, topic.end) === "는", `topic span ${src.slice(topic.start, topic.end)}`);

const splitHits = KS.analyzeHits("너는 학생", [
  { str: "너", tag: "NP", position: 0, length: 1 },
  { str: "는", tag: "JX", position: 1, length: 1 },
]);
assert(
  splitHits.filter((h) => h.kind === "jx-topic").length === 1,
  `split 너는 should be one topic ${JSON.stringify(splitHits)}`
);

const etmHits = KS.analyzeHits(src, [
  { str: "더", tag: "MAG", position: 0, length: 1 },
  { str: "는", tag: "ETM", position: 1, length: 1 },
  { str: "망설이", tag: "VV", position: 3, length: 3 },
]);
const etmTopic = etmHits.find((h) => h.kind === "jx-topic");
assert(etmTopic, `더+는/ETM must still be topic ${JSON.stringify(etmHits.map((h) => h.kind + ":" + h.text))}`);
assert(src.slice(etmTopic.start, etmTopic.end) === "는", `ETM topic span ${src.slice(etmTopic.start, etmTopic.end)}`);

const adnHits = KS.analyzeHits("가는 사람", [
  { str: "가", tag: "VV", position: 0, length: 1 },
  { str: "는", tag: "ETM", position: 1, length: 1 },
  { str: "사람", tag: "NNG", position: 3, length: 2 },
]);
assert(
  !adnHits.some((h) => h.kind === "jx-topic"),
  `가는 사람 must not be fused topic ${JSON.stringify(adnHits)}`
);

assert(RS.classifyEunNeunAt(src, 1, 2) === "topic", "classify 더는");
assert(RS.classifyEunNeunAt("가는 사람", 1, 2) === "adnominal", "classify 가는");

const magToks = [{ str: "더는", form: "더는", tag: "MAG", start: 0, end: 2, word: "더는" }];
const etmToks = [
  { str: "더", form: "더", tag: "MAG", start: 0, end: 1, word: "더" },
  { str: "는", form: "는", tag: "ETM", start: 1, end: 2, word: "는" },
];
const topicItem = {
  name: "主題（은/는）",
  nameKo: "은/는",
  category: "助詞",
  span: "는",
  kiwiKind: "jx-topic",
  start: 1,
  end: 2,
};
const topicProfile = ctx.AffixGate.inferProfile(RS.getById("seed-topic"), topicItem);
assert(
  ctx.AffixGate.accept(src, { start: 1, end: 2 }, topicProfile, { item: topicItem, tokens: magToks }),
  "AffixGate MAG 더는"
);
assert(
  ctx.AffixGate.accept(src, { start: 1, end: 2 }, topicProfile, { item: topicItem, tokens: etmToks }),
  "AffixGate ETM 는 in 더는"
);
assert(
  !ctx.AffixGate.accept(
    "가는 사람",
    { start: 1, end: 2 },
    topicProfile,
    {
      item: topicItem,
      tokens: [
        { str: "가", form: "가", tag: "VV", start: 0, end: 1, word: "가" },
        { str: "는", form: "는", tag: "ETM", start: 1, end: 2, word: "는" },
        { str: "사람", form: "사람", tag: "NNG", start: 3, end: 5, word: "사람" },
      ],
    }
  ),
  "AffixGate must reject 가는 는"
);

const magLocs = RS.locateApiItemInText(src, topicItem, magToks);
assert(
  magLocs.some((l) => l.start === 1 && l.end === 2),
  `locate MAG 더는 ${JSON.stringify(magLocs)}`
);
const etmLocs = RS.locateApiItemInText(src, topicItem, etmToks);
assert(
  etmLocs.some((l) => l.start === 1 && l.end === 2),
  `locate ETM 더는 ${JSON.stringify(etmLocs)}`
);

const nounSrc = "내 움직임은 특이해서";
const nounHits = KS.analyzeHits(nounSrc, [
  { str: "내", tag: "NP", position: 0, length: 1 },
  { str: "움직임은", tag: "NNG", position: 2, length: 4 },
]);
const nounTopic = nounHits.find((h) => h.kind === "jx-topic");
assert(nounTopic, `움직임은 fused NNG ${JSON.stringify(nounHits)}`);
assert(nounSrc.slice(nounTopic.start, nounTopic.end) === "은", `움직임은 span ${nounSrc.slice(nounTopic.start, nounTopic.end)}`);

const hinted = RS.enrichInventoryWithSurfaceHints(src, { items: [] });
assert(
  hinted.items.some((it) => it.kiwiKind === "jx-topic" && it.span === "는" && it.start === 1),
  `surface hint 더는 ${JSON.stringify(hinted.items)}`
);

const already = RS.enrichInventoryWithSurfaceHints(src, {
  items: [
    {
      name: "主題（은/는）",
      kiwiKind: "jx-topic",
      span: "는",
      start: 1,
      end: 2,
    },
  ],
});
assert(
  already.items.filter((it) => it.kiwiKind === "jx-topic").length === 1,
  `do not duplicate ${JSON.stringify(already.items)}`
);

{
  const customOnly = RS.getAll().filter((r) => r.id !== "seed-topic");
  customOnly.push({
    id: "user-topic",
    title: "主題（은/는）",
    category: "助詞",
    structure: "主題＋（은/는）",
    explanation: "注意與冠形詞形 는 不同。人稱縮約另見專卡。",
  });
  RS.setAll(customOnly);
  const ownedCustom = RS.findInventoryRule({
    name: "主題（은/는）",
    nameZh: "主題",
    nameKo: "은/는",
    category: "助詞",
    kiwiKind: "jx-topic",
  });
  assert(
    ownedCustom?.owned && ownedCustom.rule?.id === "user-topic",
    `custom 主題 must be owned ${JSON.stringify(ownedCustom)}`
  );
  const ownedAlias = RS.findInventoryRule({
    name: "主題助詞（은/는）",
    nameZh: "主題助詞",
    nameKo: "은/는",
    category: "助詞",
    kiwiKind: "jx-topic",
  });
  assert(
    ownedAlias?.owned && ownedAlias.rule?.id === "user-topic",
    `主題助詞 alias must own custom card ${JSON.stringify(ownedAlias)}`
  );
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ok fused topic");
