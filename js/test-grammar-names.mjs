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
RS.setAll(JSON.parse(fs.readFileSync(path.join(root, "js", "test-fixtures", "legacy-seed-rules.json"), "utf8")));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const canon = (name, extra) => RS.canonicalInventoryName(name, extra || {});

assert(canon("은/는（主題）") === "主題（은/는）", `flip ${canon("은/는（主題）")}`);
assert(canon("主題助詞（은/는）") === "主題（은/는）", `topic ${canon("主題助詞（은/는）")}`);
assert(canon("主題助詞(-은/는)") === "主題（은/는）", `topic half ${canon("主題助詞(-은/는)")}`);
assert(canon("해요體（-아/어요）") === "禮貌體（-아/어요）", `haeyo ${canon("해요體（-아/어요）")}`);
assert(canon("해요體（-아요/어요）") === "禮貌體（-아/어요）", `ayo ${canon("해요體（-아요/어요）")}`);
assert(canon("합니다體（-습니다）") === "正式體（-습니다）", "hamnida");
assert(canon("主格助詞（이/가）") === "主格（이/가）", "subject");
assert(canon("賓格助詞（을/를）") === "賓格（을/를）", "object");
assert(canon("過去（-았/었어요）") === "過去（-았/었-）", `past ${canon("過去（-았/었어요）")}`);
assert(canon("命令／請托（-아/어 줘）") === "請托（-아/어 줘）", `ajud ${canon("命令／請托（-아/어 줘）")}`);
assert(canon("母音縮約（해）") === "母音縮約（하＋여→해）", `hae ${canon("母音縮約（해）")}`);
assert(canon("母音縮約（여）") === "母音縮約（이＋어→여）", "yeo");
assert(canon("-아/어요（禮貌體）") === "禮貌體（-아/어요）", `flip polite ${canon("-아/어요（禮貌體）")}`);
assert(canon("可能（-ㄹ 수 있다）") === "可能（-ㄹ 수 있다）", "possibility keeps own name");
assert(canon("對比（은/는）") === "對比（은/는）", `contrast not topic ${canon("對比（은/는）")}`);
assert(canon("主題助詞", { nameKo: "은/는" }) === "主題（은/는）", "split fields");
assert(canon("", { grammarKey: "particle:topic" }) === "主題（은/는）", "grammar key");
assert(RS.formatFunctionTitle("主格(이/가)") === "主格（이/가）", "fullwidth");

const topicOwned = RS.findInventoryRule({
  name: "主題助詞（은/는）",
  nameZh: "主題助詞",
  nameKo: "은/는",
  category: "助詞",
});
assert(topicOwned?.owned && topicOwned.rule?.id === "seed-topic", `topic owned ${JSON.stringify(topicOwned)}`);

const politeOwned = RS.findInventoryRule({
  name: "해요體（-아요/어요）",
  nameZh: "해요體",
  nameKo: "-아요/어요",
  category: "語尾",
});
assert(politeOwned?.owned && politeOwned.rule?.id === "seed-haeyo", `polite owned ${JSON.stringify(politeOwned)}`);

const pastOwned = RS.findInventoryRule({
  name: "過去時制（-았/었）",
  nameZh: "過去時制",
  nameKo: "-았/었",
  category: "時態",
});
assert(pastOwned?.owned && pastOwned.rule?.id === "seed-past", `past owned ${JSON.stringify(pastOwned)}`);

const possible = RS.findInventoryRule({
  name: "可能（-ㄹ 수 있다）",
  nameZh: "可能",
  nameKo: "-ㄹ 수 있다",
  category: "句型",
});
assert(!possible?.owned, `possibility must stay missing ${JSON.stringify(possible)}`);

assert(canon("定語助詞（의）") === "所有格（의）", `ui det ${canon("定語助詞（의）")}`);
assert(canon("所有格助詞（의）") === "所有格（의）", `ui poss ${canon("所有格助詞（의）")}`);
assert(canon("屬格（의）") === "所有格（의）", `ui gen ${canon("屬格（의）")}`);
assert(canon("冠形格助詞（의）") === "所有格（의）", "ui gwan");
const uiOwnedA = RS.findInventoryRule({
  name: "定語助詞（의）",
  nameZh: "定語助詞",
  nameKo: "의",
  category: "助詞",
});
assert(uiOwnedA?.owned && uiOwnedA.rule?.id === "seed-ui", `ui owned A ${JSON.stringify(uiOwnedA)}`);
const uiOwnedB = RS.findInventoryRule({
  name: "所有格助詞（의）",
  nameZh: "所有格助詞",
  nameKo: "의",
  category: "助詞",
});
assert(uiOwnedB?.owned && uiOwnedB.rule?.id === "seed-ui", `ui owned B ${JSON.stringify(uiOwnedB)}`);
const adnNotUi = RS.findInventoryRule({
  name: "冠形詞形（-ㄴ/은）",
  nameZh: "冠形詞形",
  nameKo: "-ㄴ/은",
  category: "語尾",
});
assert(adnNotUi?.owned && adnNotUi.rule?.id === "seed-adnominal-eun", `adn ${JSON.stringify(adnNotUi)}`);

assert(canon("主題（는）") === "主題（은/는）", `neun ${canon("主題（는）")}`);
assert(canon("主題助詞（는）") === "主題（은/는）", `neun alias ${canon("主題助詞（는）")}`);
assert(canon("主格（가）") === "主格（이/가）", `ga ${canon("主格（가）")}`);
assert(canon("賓格（를）") === "賓格（을/를）", `reul ${canon("賓格（를）")}`);
const neunOwned = RS.findInventoryRule({
  name: "主題（는）",
  nameZh: "主題",
  nameKo: "는",
  category: "助詞",
});
assert(neunOwned?.owned && neunOwned.rule?.id === "seed-topic", `neun owned ${JSON.stringify(neunOwned)}`);
const adnNeunOwned = RS.findInventoryRule({
  name: "冠形詞形（는）",
  nameZh: "冠形詞形",
  nameKo: "는",
  category: "語尾",
});
assert(
  adnNeunOwned?.owned && adnNeunOwned.rule?.id === "seed-adnominal-neun",
  `adn neun ${JSON.stringify(adnNeunOwned)}`
);

const uniqueUi = RS.findInventoryRule({
  name: "領屬（의）",
  nameZh: "領屬",
  nameKo: "의",
  category: "助詞",
});
assert(uniqueUi?.owned && uniqueUi.rule?.id === "seed-ui", `unique marker 의 ${JSON.stringify(uniqueUi)}`);
const contrastTopic = RS.findInventoryRule({
  name: "對比（은/는）",
  nameZh: "對比",
  nameKo: "은/는",
  category: "助詞",
});
assert(
  contrastTopic?.owned && contrastTopic.rule?.id === "seed-topic",
  `unique 은/는 ${JSON.stringify(contrastTopic)}`
);

ctx.KiwiService = {
  ruleMatchesHint(rule, hint) {
    return rule.id === "seed-haeche" && hint && hint.kind === "ef-haeche";
  },
};
const kiwiKindMustNotVeto = RS.findInventoryRule({
  name: "禮貌體（-아/어요）",
  nameZh: "禮貌體",
  nameKo: "-아/어요",
  category: "語尾",
  kiwiKind: "ef-haeche",
});
assert(
  kiwiKindMustNotVeto?.owned && kiwiKindMustNotVeto.rule?.id === "seed-haeche",
  `kiwiKind identity wins over Chinese title ${JSON.stringify(kiwiKindMustNotVeto)}`
);
const aliasWithBadKind = RS.findInventoryRule({
  name: "해요體（-아/어요）",
  nameZh: "해요體",
  nameKo: "-아/어요",
  category: "語尾",
  kiwiKind: "ef-haeche",
});
assert(
  aliasWithBadKind?.owned && aliasWithBadKind.rule?.id === "seed-haeche",
  `kiwiKind identity wins over unique marker ${JSON.stringify(aliasWithBadKind)}`
);
const politeNoKind = RS.findInventoryRule({
  name: "禮貌體（-아/어요）",
  nameZh: "禮貌體",
  nameKo: "-아/어요",
  category: "語尾",
});
assert(
  politeNoKind?.owned && politeNoKind.rule?.id === "seed-haeyo",
  `exact polite title without kind ${JSON.stringify(politeNoKind)}`
);

const dwaeRule = RS.getById("seed-vowel-dwae");
assert(dwaeRule && RS.isVowelContractionRule(dwaeRule), "dwae rule");
assert(RS.sentenceHasVowelSurface("돼요 좋아요", "돼"), "돼요 is dwae surface");
assert(!RS.sentenceHasVowelSurface("난 춤 추고 놀래 가위 눌린 너의", "돼"), "no 돼 in lyric");
assert(!RS.sentenceHasVowelSurface("되어 있다", "돼"), "되어 is not contraction 돼");
assert(!RS.isValidVowelSurface("돼", "어"), "bare 어 is not dwae");
assert(!RS.isValidVowelSurface("돼", "되어"), "되어 span is not dwae");
assert(RS.isValidVowelSurface("돼", "돼요"), "돼요 span is dwae");

console.log(
  "ok grammar names",
  canon("主題助詞（은/는）"),
  canon("해요體（-아요/어요）"),
  canon("母音縮約（해）")
);
