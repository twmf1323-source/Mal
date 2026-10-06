import { createRequire } from "node:module";
import { KiwiBuilder, Match } from "../vendor/kiwi-nlp/dist/index.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const StemDrop = require("./stem-drop.js");

const cases = [
  ["춥", "추워", "ㅂ"],
  ["돕", "도", "ㅂ"],
  ["좁", "좁", null],
  ["듣", "들", "ㄷ"],
  ["걷", "걸", "ㄷ"],
  ["닫", "닫", null],
  ["짓", "지어", "ㅅ"],
  ["웃", "웃", null],
  ["파랗", "파래", "ㅎ"],
  ["좋", "좋", null],
  ["그렇", "그래", "ㅎ"],
  ["크", "커", "eu"],
  ["쓰", "써", "eu"],
  ["바쁘", "바빠", "eu"],
  ["예쁘", "예뻐", "eu"],
  ["모르", "몰", "르"],
  ["부르", "불", "르"],
  ["빠르", "빨", "르"],
  ["따르", "따라", "eu"],
  ["푸르", "푸르러", "르"],
  ["이르", "이르러", "르"],
  ["푸르", "푸르러요", "르"],
  ["치르", "치러", "eu"],
  ["하", "해", null],
  ["되", "돼", null],
  ["오", "와", null],
  ["먹", "먹", null],
  ["살", "삽", "ㄹ"],
  ["들", "드", "ㄹ"],
  ["알", "아", "ㄹ"],
  ["만들", "만드", "ㄹ"],
  ["살", "살", null],
  ["춥다", "추워", "ㅂ"],
];

let failed = 0;
if (
  !StemDrop.hasReuIrregularSurface("몰라요") ||
  !StemDrop.hasReuIrregularSurface("푸르러요") ||
  StemDrop.hasReuIrregularSurface("따라요")
) {
  failed += 1;
  console.error("FAIL StemDrop.hasReuIrregularSurface");
}
const ext = StemDrop.extendReuHitRange("몰라요", 0, 1);
if (ext.start !== 0 || ext.end !== 2) {
  failed += 1;
  console.error(`FAIL extendReu ${JSON.stringify(ext)}`);
}
for (const [lemma, surface, want] of cases) {
  const got = StemDrop.classifyStemDrop(lemma, surface);
  const kind = got ? got.kind : null;
  if (kind !== want) {
    failed += 1;
    console.error(`FAIL classify ${lemma} vs ${surface}: want ${want}, got ${kind}`);
  }
}

const kiwiExpect = [
  ["추워요", "ㅂ"],
  ["좁아요", null],
  ["들어요", "ㄷ"],
  ["닫아요", null],
  ["지어요", "ㅅ"],
  ["웃어요", null],
  ["몰라요", "르"],
  ["불러요", "르"],
  ["빨라요", "르"],
  ["따라요", "eu"],
  ["푸르러요", "르"],
  ["이르러요", "르"],
  ["치러요", "eu"],
  ["파래요", "ㅎ"],
  ["좋아요", null],
  ["바빠요", "eu"],
  ["커요", "eu"],
  ["도와요", "ㅂ"],
  ["걸었어요", "ㄷ"],
  ["예뻐요", "eu"],
  ["살면", null],
  ["삽니다", "ㄹ"],
  ["빠져드는", "ㄹ"],
  ["더 빠져드는 걸", "ㄹ"],
  ["아니까", "ㄹ"],
  ["만드세요", "ㄹ"],
  ["만드는", "ㄹ"],
  ["와요", null],
  ["해요", null],
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = pathToFileURL(path.join(root, "vendor", "kiwi-nlp", "dist", "kiwi-wasm.wasm")).href;
const modelDir = path.join(root, "vendor", "kiwi", "models", "cong", "base");
const files = [
  "combiningRule.txt",
  "cong.mdl",
  "default.dict",
  "extract.mdl",
  "sj.morph",
  "typo.dict",
  "dialect.dict",
];

const builder = await KiwiBuilder.create(wasmPath);
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

function isPred(tag) {
  const t = String(tag || "").split(/[-+]/)[0];
  return t === "VV" || t === "VA" || t === "VX" || t === "XSV" || t === "XSA" || t === "VCN";
}

for (const [text, want] of kiwiExpect) {
  const tokens = kiwi.tokenize(text, Match.allWithNormalizing);
  let kind = null;
  let detail = "";
  for (const tok of tokens) {
    if (!isPred(tok.tag)) continue;
    const len = Number(tok.length) || 0;
    if (len <= 0) continue;
    const surface = text.slice(tok.position, tok.position + len);
    let hit = StemDrop.classifyStemDrop(tok.str, surface);
    if (!hit) {
      const next = tokens[tokens.indexOf(tok) + 1];
      if (next) {
        const nlen = Number(next.length) || 0;
        const nend = (Number(next.position) || 0) + nlen;
        const wide = text.slice(tok.position, Math.max(tok.position + len, nend));
        if (wide !== surface) hit = StemDrop.classifyStemDrop(tok.str, wide);
      }
    }
    if (hit) {
      kind = hit.kind;
      detail = `${tok.str}/${tok.tag} vs ${surface}`;
      break;
    }
  }
  if (kind !== want) {
    failed += 1;
    const dump = tokens.map((t) => `${t.str}/${t.tag}@${t.position}+${t.length}`).join("  ");
    console.error(`FAIL kiwi ${text}: want ${want}, got ${kind} (${detail}) :: ${dump}`);
  }
}

{
  const quiet = kiwi.tokenize("가만히 바라봐", Match.allWithNormalizing);
  const only = kiwi.tokenize("너만 봐", Match.allWithNormalizing);
  const quietHasJxMan = quiet.some((t) => String(t.tag || "").split(/[-+]/)[0] === "JX" && t.str === "만");
  const onlyHasJxMan = only.some((t) => String(t.tag || "").split(/[-+]/)[0] === "JX" && t.str === "만");
  if (quietHasJxMan) {
    failed += 1;
    console.error(`FAIL kiwi 가만히 不應有 만/JX :: ${quiet.map((t) => `${t.str}/${t.tag}`).join("  ")}`);
  }
  if (!onlyHasJxMan) {
    failed += 1;
    console.error(`FAIL kiwi 너만 應有 만/JX :: ${only.map((t) => `${t.str}/${t.tag}`).join("  ")}`);
  }
}

const SEED_KIND = {
  "irr-b": "seed-b-irregular",
  "irr-d": "seed-d-irregular",
  "irr-s": "seed-s-irregular",
  "irr-reu": "seed-reu-irregular",
  "irr-h": "seed-h-irregular",
  "l-del": "seed-l-deletion",
  "eu-del": "seed-eu-deletion",
};

const rankCtx = {
  StemDrop,
  console,
  Storage: { saveRules() {} },
  KiwiService: {
    ruleMatchesHint(rule, hint) {
      if (hint?.kind === "ef-haeyo") return rule?.id === "seed-haeyo";
      if (hint?.kind === "etm-neun") return rule?.id === "seed-adnominal-neun";
      if (hint?.kind === "jx-man") {
        return rule?.id === "test-man-particle" || /限定助詞/.test(rule?.title || "");
      }
      return Boolean(rule && hint && SEED_KIND[hint.kind] === rule.id);
    },
  },
};
rankCtx.globalThis = rankCtx;
vm.createContext(rankCtx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js", "affix-gate.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js", "rules.js"), "utf8") +
    "\n;this.RulesService = RulesService; this.AffixGate = AffixGate;",
  rankCtx
);
const seed = JSON.parse(fs.readFileSync(path.join(root, "js", "test-fixtures", "legacy-seed-rules.json"), "utf8"));
rankCtx.RulesService.setAll(seed);

const RS = rankCtx.RulesService;
if (
  !RS.hasReuIrregularSurface("몰라요") ||
  !RS.hasReuIrregularSurface("빨라요") ||
  !RS.hasReuIrregularSurface("몰랐어") ||
  !RS.hasReuIrregularSurface("푸르러요") ||
  !RS.hasReuIrregularSurface("이르러요") ||
  RS.hasReuIrregularSurface("따라요") ||
  RS.hasReuIrregularSurface("살아요") ||
  RS.hasReuIrregularSurface("모르겠어요")
) {
  failed += 1;
  console.error("FAIL hasReuIrregularSurface");
}
const reuLocs = RS.locateReuIrregularSurface("너무 빨라요");
if (!reuLocs.some((l) => l.text === "빨라")) {
  failed += 1;
  console.error(`FAIL locateReu ${JSON.stringify(reuLocs)}`);
}
const reuLocsBlue = RS.locateReuIrregularSurface("하늘이 푸르러요");
if (!reuLocsBlue.some((l) => l.text === "푸르러" || l.text === "르러")) {
  failed += 1;
  console.error(`FAIL locateReu 푸르러 ${JSON.stringify(reuLocsBlue)}`);
}
if (
  !RS.hasReuIrregularInSelection("라요", { contextText: "몰라요", spanStart: 1, spanEnd: 3 })
) {
  failed += 1;
  console.error("FAIL hasReuIrregularInSelection 라요 in 몰라요");
}
const reuInv = RS.enrichInventoryWithSurfaceHints("오늘 너무 빨라요", { items: [] });
if (!reuInv.items.some((it) => it.manualRuleId === "seed-reu-irregular")) {
  failed += 1;
  console.error(`FAIL surface-hint 르 ${JSON.stringify(reuInv.items)}`);
}
const reuOwned = RS.findMatchingRule("르 不規則（르 불규칙）");
if (!reuOwned.owned || reuOwned.rule?.id !== "seed-reu-irregular") {
  failed += 1;
  console.error("FAIL findMatchingRule 르 不規則");
}
const reuPos = RS.locateApiItemInText("오늘 너무 빨라요", {
  name: "르 不規則（르 불규칙）",
  span: "빨라요",
});
if (!reuPos.some((l) => l.text === "빨라" || l.text === "빨라요")) {
  failed += 1;
  console.error(`FAIL locateApi 르 ${JSON.stringify(reuPos)}`);
}

const manRule = {
  id: "test-man-particle",
  title: "限定助詞（만）",
  category: "助詞",
  structure: "體詞＋만",
  explanation: "只有、僅僅。",
};
RS.setAll([...seed, manRule]);
if (!RS.isLexicalNotParticle("가만히 바라봐", 1, 2, "만")) {
  failed += 1;
  console.error("FAIL 가만히 的 만 應視為詞彙");
}
if (RS.isLexicalNotParticle("너만 봐", 1, 2, "만")) {
  failed += 1;
  console.error("FAIL 너만 的 만 應視為助詞");
}
if (RS.isLexicalNotParticle("너만의 것", 1, 2, "만")) {
  failed += 1;
  console.error("FAIL 너만의 的 만 應視為助詞");
}
if (!RS.isLexicalNotParticle("기만하다", 1, 2, "만")) {
  failed += 1;
  console.error("FAIL 기만하다 的 만 應視為詞彙");
}
const manScanQuiet = RS.scanSentence("가만히 바라봐");
if (manScanQuiet.some((s) => s.ruleId === "test-man-particle")) {
  failed += 1;
  console.error(`FAIL scan 가만히 不應套 만 ${JSON.stringify(manScanQuiet.filter((s) => s.ruleId === "test-man-particle"))}`);
}
const manScanOnly = RS.scanSentence("너만 봐");
if (!manScanOnly.some((s) => s.ruleId === "test-man-particle" && s.text === "만")) {
  failed += 1;
  console.error(`FAIL scan 너만 應套 만 ${JSON.stringify(manScanOnly)}`);
}
const manApiQuiet = RS.locateApiItemInText("가만히 바라봐", {
  name: "限定助詞（만）",
  span: "만",
});
if (manApiQuiet.length) {
  failed += 1;
  console.error(`FAIL locateApi 가만히 만 ${JSON.stringify(manApiQuiet)}`);
}
const manApiOnly = RS.locateApiItemInText("너만 봐", {
  name: "限定助詞（만）",
  span: "만",
});
if (!manApiOnly.some((l) => l.text === "만")) {
  failed += 1;
  console.error(`FAIL locateApi 너만 ${JSON.stringify(manApiOnly)}`);
}
const manInsideVocab = RS.particleInsideVocabLexeme("가만히 바라봐", 1, 2, [
  { start: 0, end: 3, surface: "가만히", lemma: "가만히" },
]);
if (!manInsideVocab) {
  failed += 1;
  console.error("FAIL vocab 嚴格包住 가만히 的 만");
}
const manAfterVocab = RS.particleInsideVocabLexeme("너만 봐", 1, 2, [
  { start: 0, end: 1, surface: "너", lemma: "너" },
]);
if (manAfterVocab) {
  failed += 1;
  console.error("FAIL vocab 너 不應吃掉後面的 만");
}
const manRankQuiet = RS.rankRulesForSpan("만", {
  minScore: 8,
  maxSuggest: 8,
  kiwiHints: [],
  kiwiAnalyzed: true,
  contextText: "가만히 바라봐",
  spanStart: 1,
  spanEnd: 2,
});
if (manRankQuiet.suggestions.some((s) => s.rule.id === "test-man-particle")) {
  failed += 1;
  console.error("FAIL rank 가만히 不應建議限定助詞");
}
const manRankOnly = RS.rankRulesForSpan("너만", {
  minScore: 8,
  maxSuggest: 8,
  kiwiHints: [{ kind: "jx-man", score: 34, reason: "限定助詞 만（JX）" }],
  kiwiAnalyzed: true,
  contextText: "너만 봐",
  spanStart: 0,
  spanEnd: 2,
});
if (!manRankOnly.suggestions.some((s) => s.rule.id === "test-man-particle")) {
  failed += 1;
  console.error(`FAIL rank 너만 應建議限定助詞 [${manRankOnly.suggestions.map((s) => s.rule.id).join(", ")}]`);
}
RS.setAll(seed);

{
  const src = "붉은색의 달빛에 내 눈물이";
  const spans = RS.scanSentence(src);
  const ids = [...new Set(spans.map((s) => s.ruleId))];
  const reject = [
    "seed-deusi",
    "seed-want",
    "seed-object",
    "seed-topic",
    "seed-topic-contraction-nan",
  ];
  for (const bad of reject) {
    if (ids.includes(bad)) {
      failed += 1;
      console.error(`FAIL scan ${src}: should not include ${bad} in [${ids.join(", ")}]`);
    }
  }
  if (!ids.includes("seed-e") && !ids.includes("seed-subject")) {
    failed += 1;
    console.error(`FAIL scan ${src}: expected 에 or 이/가 in [${ids.join(", ")}]`);
  }
  const topicEun = spans.filter((s) => s.ruleId === "seed-topic" && s.text === "은");
  if (topicEun.length) {
    failed += 1;
    console.error("FAIL 붉은 的 은 不應標成主題");
  }
}

{
  const src = "아직 이곳은 어두울래";
  if (!RS.isAeoInsideLexeme(src, 0, 1)) {
    failed += 1;
    console.error("FAIL 아직 的 아 應視為詞彙");
  }
  if (RS.classifyEunNeunAt(src, src.indexOf("은"), src.indexOf("은") + 1) !== "topic") {
    failed += 1;
    console.error("FAIL 이곳은 應為主題");
  }
  if (RS.classifyEunNeunAt("작은 집", 1, 2) !== "adnominal") {
    failed += 1;
    console.error("FAIL 작은 應為冠形");
  }
  const spans = RS.scanSentence(src);
  const ids = [...new Set(spans.map((s) => s.ruleId))];
  if (ids.includes("seed-haeche")) {
    failed += 1;
    console.error(`FAIL 아직 不應套 해체 ${JSON.stringify(spans.filter((s) => s.ruleId === "seed-haeche"))}`);
  }
  if (ids.includes("seed-adnominal-eun")) {
    failed += 1;
    console.error(`FAIL 이곳은 不應套 冠形 -ㄴ/은 ${JSON.stringify(spans.filter((s) => s.ruleId === "seed-adnominal-eun"))}`);
  }
  if (!ids.includes("seed-topic")) {
    failed += 1;
    console.error(`FAIL 이곳은 應套主題 [${ids.join(", ")}]`);
  }
  const cmd = {
    id: "test-command-aeo",
    title: "命令（-아/어）",
    category: "語尾",
    structure: "詞幹＋아/어",
    explanation: "命令或平語。",
  };
  RS.setAll([...seed, cmd]);
  const spans2 = RS.scanSentence(src);
  if (spans2.some((s) => s.ruleId === "test-command-aeo")) {
    failed += 1;
    console.error("FAIL 아직 不應套 命令 -아/어");
  }
  if (!RS.scanSentence("이거 먹어").some((s) => s.ruleId === "test-command-aeo" || s.ruleId === "seed-haeche")) {
    failed += 1;
    console.error("FAIL 먹어 應能套 아/어 語尾");
  }
  RS.setAll(seed);
}

function hintFor(kind, text) {
  return {
    kind,
    score: 34,
    reason: StemDrop.formatReason({
      kind: StemDrop.HINT_TO_KIND[kind],
      lemma: "?",
      surface: text,
    }),
  };
}

const rankCases = [
  {
    sel: "추워요",
    hints: [hintFor("irr-b", "추워요"), { kind: "ef-haeyo", score: 34, reason: "禮貌體 -아/어요（EF）" }],
    wantTop: "seed-b-irregular",
    wantAlso: ["seed-haeyo"],
    reject: ["seed-h-irregular", "seed-d-irregular"],
  },
  {
    sel: "좋아요",
    hints: [],
    reject: ["seed-h-irregular", "seed-b-irregular"],
  },
  {
    sel: "몰라요",
    hints: [hintFor("irr-reu", "몰라요")],
    wantTop: "seed-reu-irregular",
    reject: ["seed-eu-deletion"],
  },
  {
    sel: "따라요",
    hints: [hintFor("eu-del", "따라요")],
    wantTop: "seed-eu-deletion",
    reject: ["seed-reu-irregular"],
  },
  {
    sel: "와요",
    hints: [],
    reject: ["seed-b-irregular"],
  },
  {
    sel: "빠져드는",
    hints: [hintFor("l-del", "드"), { kind: "etm-neun", score: 36, reason: "動詞冠形 -는（ETM）" }],
    wantTop: "seed-l-deletion",
    wantAlso: ["seed-adnominal-neun"],
    reject: ["seed-d-irregular", "seed-reu-irregular"],
  },
  {
    sel: "빨라요",
    hints: [],
    kiwiAnalyzed: true,
    wantTop: "seed-reu-irregular",
    reject: ["seed-l-deletion", "seed-eu-deletion"],
  },
  {
    sel: "몰라요",
    hints: [hintFor("irr-reu", "몰")],
    kiwiAnalyzed: true,
    wantTop: "seed-reu-irregular",
    reject: ["seed-l-deletion"],
  },
  {
    sel: "라요",
    hints: [{ kind: "ef-haeyo", score: 34, reason: "禮貌體 -아/어요（EF）" }],
    contextText: "몰라요",
    spanStart: 1,
    spanEnd: 3,
    kiwiAnalyzed: true,
    wantTop: "seed-reu-irregular",
    wantAlso: ["seed-haeyo"],
    reject: ["seed-eu-deletion"],
  },
  {
    sel: "푸르러요",
    hints: [],
    kiwiAnalyzed: true,
    wantTop: "seed-reu-irregular",
    reject: ["seed-eu-deletion"],
  },
];

for (const row of rankCases) {
  const ranked = rankCtx.RulesService.rankRulesForSpan(row.sel, {
    minScore: 8,
    maxSuggest: 8,
    kiwiHints: row.hints,
    kiwiAnalyzed: true,
    contextText: row.contextText,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
  });
  const ids = ranked.suggestions.map((s) => s.rule.id);
  if (row.wantTop && !ids.includes(row.wantTop)) {
    failed += 1;
    console.error(`FAIL rank ${row.sel}: missing ${row.wantTop} in [${ids.join(", ")}]`);
  }
  for (const need of row.wantAlso || []) {
    if (!ids.includes(need)) {
      failed += 1;
      console.error(`FAIL rank ${row.sel}: missing ${need} in [${ids.join(", ")}]`);
    }
  }
  for (const bad of row.reject || []) {
    if (ids.includes(bad)) {
      failed += 1;
      console.error(`FAIL rank ${row.sel}: should not suggest ${bad}`);
    }
  }
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`ok ${cases.length} classify + ${kiwiExpect.length} kiwi + ${rankCases.length} rank`);
