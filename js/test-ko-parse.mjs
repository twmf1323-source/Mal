import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const ctx = { console, module: { exports: {} }, exports: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/ko-parse.js"), "utf8") + "\n;this.KoParse = KoParse;", ctx);
const KoParse = ctx.KoParse;
if (!KoParse) {
  console.error("FAIL KoParse not loaded");
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const src = "예쁜 꽃을 샀어요";
const kiwiToks = [
  { str: "예쁘", tag: "VA", position: 0, length: 2, wordPosition: 0 },
  { str: "ㄴ", tag: "ETM", position: 2, length: 0, wordPosition: 0 },
  { str: "꽃", tag: "NNG", position: 3, length: 1, wordPosition: 1 },
  { str: "을", tag: "JKO", position: 4, length: 1, wordPosition: 1 },
  { str: "사", tag: "VV", position: 6, length: 1, wordPosition: 2 },
  { str: "았", tag: "EP", position: 7, length: 0, wordPosition: 2 },
  { str: "어요", tag: "EF", position: 7, length: 2, wordPosition: 2 },
];

const tokens = KoParse.fromKiwi(src, kiwiToks);
assert(tokens.length === 7, `fromKiwi length ${tokens.length}`);
assert(tokens[0].word === "예쁜" && tokens[0].lemma === "예쁘다", `stem ${JSON.stringify(tokens[0])}`);
assert(tokens[1].zeroWidth && tokens[1].form === "ㄴ" && tokens[1].word === "쁜", `etm ${JSON.stringify(tokens[1])}`);
assert(tokens[1].start === 1 && tokens[1].end === 2, `etm range ${tokens[1].start}-${tokens[1].end}`);
assert(tokens[3].form === "을" && tokens[3].pos === "助詞", `jko ${JSON.stringify(tokens[3])}`);
assert(tokens[5].zeroWidth && tokens[5].form === "았" && tokens[5].word === "샀", `past ${JSON.stringify(tokens[5])}`);

const vocab = KoParse.tokensToVocab(tokens);
assert(
  vocab.some((w) => w.lemma === "예쁘다") && vocab.some((w) => w.lemma === "사다"),
  `vocab lemmas ${vocab.map((w) => w.lemma).join(",")}`
);
assert(!vocab.some((w) => w.pos === "助詞"), "vocab should skip particles");

const hits = [
  { kind: "etm-n-eun", form: "ㄴ", tag: "ETM", start: 1, end: 2, reason: "形容詞冠形" },
  { kind: "jko-object", form: "을", tag: "JKO", start: 4, end: 5, reason: "賓格" },
  { kind: "ep-past", form: "았", tag: "EP", start: 6, end: 7, reason: "過去" },
  { kind: "ef-haeyo", form: "어요", tag: "EF", start: 7, end: 9, reason: "禮貌體" },
];
const cands = KoParse.deterministicFunctions(src, tokens, { hits });
assert(cands.some((c) => c.name === "冠形詞形（-ㄴ/은）"), `cands names ${cands.map((c) => c.name).join(" | ")}`);
assert(cands.some((c) => c.name === "賓格（을/를）"), "missing object cand");
const etm = cands.find((c) => c.kiwiKind === "etm-n-eun");
assert(etm && etm.tokenFrom === etm.tokenTo && tokens[etm.tokenFrom].form === "ㄴ", `etm token ${JSON.stringify(etm)}`);
const obj = cands.find((c) => c.kiwiKind === "jko-object");
assert(obj && tokens[obj.tokenFrom].form === "을", `obj token ${JSON.stringify(obj)}`);

const items = KoParse.functionsToItems(tokens, [], cands, { mappingFailed: true, src });
const etmItem = items.find((it) => it.name.includes("冠形"));
assert(etmItem && etmItem.span === "쁜", `etm span ${etmItem && etmItem.span}`);
const objItem = items.find((it) => it.name.includes("賓格"));
assert(objItem && objItem.span === "을", `obj span ${objItem && objItem.span}`);

const wide = {
  name: "賓格（을/를）",
  nameKo: "을/를",
  category: "助詞",
  span: "꽃을",
  start: 3,
  end: 5,
  tokenFrom: 2,
  tokenTo: 3,
};
const narrowed = KoParse.narrowItemToMarker(src, wide, tokens);
assert(narrowed.span === "을" && narrowed.start === 4, `narrow ${JSON.stringify(narrowed)}`);

const groups = KoParse.groupEojeol(src, tokens);
assert(groups.length === 3, `eojeol ${groups.length} ${groups.map((g) => g.text).join("|")}`);
assert(groups[0].text === "예쁜" && groups[1].text === "꽃을", `eojeol text ${groups.map((g) => g.text).join("|")}`);
assert(KoParse.phraseRole(groups[0]).kind === "ModP", `phrase0 ${JSON.stringify(KoParse.phraseRole(groups[0]))}`);
assert(KoParse.phraseRole(groups[1]).role === "賓語", `phrase1 ${JSON.stringify(KoParse.phraseRole(groups[1]))}`);
assert(KoParse.phraseRole(groups[2]).kind === "VP", `phrase2 ${JSON.stringify(KoParse.phraseRole(groups[2]))}`);

const hovers = KoParse.hoverLocs(tokens, vocab);
assert(hovers.some((h) => h.surface === "ㄴ" && h.pos === "語尾"), `hover etm ${JSON.stringify(hovers.find((h) => h.form === "ㄴ"))}`);

const mapped = KoParse.parseMappedFunctions({
  t: "買了漂亮的花",
  fn: [{ n: "禮貌體（-아/어요）", a: 6, b: 6, c: "語尾", f: "h" }],
});
assert(mapped.translation === "買了漂亮的花", "translation");
assert(mapped.functions[0].tokenFrom === 6 && mapped.functions[0].tokenTo === 6, "mapped idx");

// 新 API 契約：每個 Kiwi／語素候選必須有穩定 ID 與決策；unknown 仍要補查。
const checklist = KoParse.grammarChecklist(tokens, cands);
assert(checklist.length === 4, `checklist ${JSON.stringify(checklist)}`);
assert(
  checklist.every((x) => /:\d+:\d+$|^morph:\d+$/.test(x.id)),
  `checklist ids ${checklist.map((x) => x.id).join(" | ")}`
);
const contractMapped = KoParse.parseMappedFunctions({
  fn: [
    {
      q: checklist[0].id,
      x: "confirmed",
      g: "ending:adnominal-present",
      n: "冠形詞形（-ㄴ/은）",
      a: checklist[0].tokenFrom,
      b: checklist[0].tokenTo,
      c: "語尾",
      f: "h",
    },
    { q: checklist[1].id, x: "rejected", e: "此處不是該功能" },
    { q: checklist[2].id, x: "unknown", e: "需要補查" },
    {
      q: checklist[3].id,
      x: "reclassified",
      g: "ending:polite",
      n: "禮貌體（-아/어요）",
      a: checklist[3].tokenFrom,
      b: checklist[3].tokenTo,
      c: "語尾",
      f: "h",
    },
  ],
});
assert(contractMapped.decisions.length === 4, "contract decisions");
assert(contractMapped.functions.length === 2, "rejected/unknown must not become grammar items");
assert(
  contractMapped.functions[0].grammarKey === "ending:adnominal-present",
  "stable grammar key"
);
const unresolvedContract = KoParse.unresolvedGrammarChecklist(checklist, contractMapped);
assert(
  unresolvedContract.length === 1 && unresolvedContract[0].id === checklist[2].id,
  `unknown should remain unresolved ${JSON.stringify(unresolvedContract)}`
);
const rejectedFallback = KoParse.functionsToItems(tokens, [], cands, {
  src,
  candidateDecisions: cands.map((c) => ({
    candidateId: KoParse.candidateDecisionId(c),
    status: "rejected",
  })),
});
assert(
  rejectedFallback.some((it) => it.kiwiKind === "jko-object"),
  `API cannot veto JKO 을 ${JSON.stringify(rejectedFallback)}`
);
assert(
  !rejectedFallback.some((it) => it.kiwiKind === "ef-haeyo" || it.kiwiKind === "ep-past"),
  `rejected endings must not leak ${JSON.stringify(rejectedFallback)}`
);

const topicSrc = "더는 마";
const topicToks = KoParse.fromKiwi(topicSrc, [
  { str: "더", tag: "MAG", position: 0, length: 1 },
  { str: "는", tag: "JX", position: 1, length: 1 },
  { str: "마", tag: "VX", position: 3, length: 1 },
]);
const topicCands = [
  {
    name: "主題（은/는）",
    category: "助詞",
    tokenFrom: 1,
    tokenTo: 1,
    kiwiKind: "jx-topic",
    grammarKey: "kiwi:jx-topic",
    needsDisambiguation: true,
  },
];
const topicKept = KoParse.functionsToItems(topicToks, [], topicCands, {
  src: topicSrc,
  candidateDecisions: [
    { candidateId: KoParse.candidateDecisionId(topicCands[0]), status: "rejected" },
  ],
});
assert(
  topicKept.some((it) => it.kiwiKind === "jx-topic" && topicSrc.slice(it.start, it.end) === "는"),
  `rejected 더는 는 must still be kept ${JSON.stringify(topicKept)}`
);
const confirmedCandidate = cands[0];
const confirmedFixed = KoParse.functionsToItems(
  tokens,
  [
    {
      name: "模型換句話說的名稱（錯誤標記）",
      tokenFrom: confirmedCandidate.tokenFrom,
      tokenTo: confirmedCandidate.tokenTo,
      candidateId: KoParse.candidateDecisionId(confirmedCandidate),
      status: "confirmed",
      grammarKey: "model:unstable-name",
    },
  ],
  [confirmedCandidate],
  {
    src,
    candidateDecisions: [
      { candidateId: KoParse.candidateDecisionId(confirmedCandidate), status: "confirmed" },
    ],
  }
);
assert(
  confirmedFixed.length === 1 &&
    confirmedFixed[0].name === confirmedCandidate.name &&
    confirmedFixed[0].grammarKey === `kiwi:${confirmedCandidate.kiwiKind}`,
  `confirmed candidate must keep local stable identity ${JSON.stringify(confirmedFixed)}`
);

const aiItems = KoParse.functionsToItems(tokens, mapped.functions, cands, { src });
assert(
  aiItems.some((it) => it.name === "禮貌體（-아/어요）") && aiItems.some((it) => it.name === "賓格（을/를）"),
  `merge ${aiItems.map((it) => it.name).join(" | ")}`
);

// API 若只回報範圍重疊的裸 -(으)ㄹ，程式仍須保留高信心的
// 「-(으)ㄹ 수 있다」，才能在筆記本沒有該卡時列入尚未收錄。
const possibleSrc = "숨길 수 있게";
const possibleTokens = KoParse.fromKiwi(possibleSrc, [
  { str: "숨기", tag: "VV", position: 0, length: 2, wordPosition: 0 },
  { str: "ㄹ", tag: "ETM", position: 2, length: 0, wordPosition: 0 },
  { str: "수", tag: "NNB", position: 3, length: 1, wordPosition: 1 },
  { str: "있", tag: "VX", position: 5, length: 1, wordPosition: 2 },
  { str: "게", tag: "EC", position: 6, length: 1, wordPosition: 2 },
]);
const possibleCandidates = KoParse.deterministicFunctions(possibleSrc, possibleTokens, {
  hits: [
    {
      kind: "eul-su-it",
      form: "ㄹ",
      tag: "ETM",
      start: 1,
      end: 6,
      reason: "可能 -ㄹ 수 있다",
    },
  ],
});
const possibleItems = KoParse.functionsToItems(
  possibleTokens,
  [
    {
      name: "未來推測（-(으)ㄹ）",
      tokenFrom: 1,
      tokenTo: 1,
      category: "語尾",
      confidence: "high",
    },
    {
      name: "副詞化語尾（-게）",
      tokenFrom: 4,
      tokenTo: 4,
      category: "語尾",
      confidence: "high",
    },
  ],
  possibleCandidates,
  { src: possibleSrc }
);
assert(
  possibleItems.some((it) => it.name === "可能（-ㄹ 수 있다）"),
  `overlapping possibility missing: ${possibleItems.map((it) => it.name).join(" | ")}`
);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ok ko-parse", tokens.length, "tokens", items.length, "items");
