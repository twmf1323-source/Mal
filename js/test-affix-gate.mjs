import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const ctx = {
  console,
  Storage: { saveRules() {} },
  StemDrop: {},
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

const seed = JSON.parse(fs.readFileSync(path.join(root, "data", "seed-rules.json"), "utf8"));
const geRule = {
  id: "test-adverbial-ge",
  title: "副詞化語尾（-게）",
  category: "語尾",
  structure: "詞幹＋게",
  explanation: "把用言變成副詞。",
};
const adnTitleRule = {
  id: "test-adn-eul-alias",
  title: "冠形詞形（-(으)ㄹ）",
  category: "語尾",
  structure: "詞幹＋(으)ㄹ＋名詞",
  explanation: "未來／推測冠形。",
};
ctx.RulesService.setAll([...seed, geRule, adnTitleRule]);
const RS = ctx.RulesService;
const AG = ctx.AffixGate;

function fail(msg) {
  failed += 1;
  console.error("FAIL " + msg);
}

{
  const p = AG.inferProfile(RS.getById("seed-honorific"));
  if (!p || p.role !== "honorific-si") fail(`infer honorific ${JSON.stringify(p)}`);
}
{
  const p = AG.inferProfile(RS.getById("seed-adnominal-eul"));
  if (!p || p.role !== "adnominal-l") fail(`infer adn-eul ${JSON.stringify(p)}`);
}
{
  const p = AG.inferProfile(adnTitleRule);
  if (!p || p.role !== "adnominal-l") fail(`infer 冠形詞形 -(으)ㄹ ${JSON.stringify(p)}`);
}
{
  const p = AG.inferProfile(RS.getById("seed-object"));
  if (!p || p.role !== "particle-object") fail(`infer object ${JSON.stringify(p)}`);
}
{
  const p = AG.inferProfile(RS.getById("seed-topic"));
  if (!p || p.role !== "particle") fail(`infer topic ${JSON.stringify(p)}`);
  if (!p.surfaces || !p.surfaces.includes("는") || !p.surfaces.includes("은")) {
    fail(`topic surfaces must include 은/는 ${JSON.stringify(p)}`);
  }
  const src = "나는 학생이다";
  if (!AG.accept(src, { start: 1, end: 2 }, p, { item: { name: "主題（은/는）" } })) {
    fail("는 應通過主題助詞閘門");
  }
  const locs = RS.locateApiItemInText("커피는 마셨어요", {
    name: "主題（는）",
    nameKo: "는",
    category: "助詞",
    span: "는",
  });
  if (!locs.some((l) => l.text === "는" || (l.start === 2 && l.end === 3))) {
    fail(`커피는 應標 는 ${JSON.stringify(locs)}`);
  }
  const fusedSrc = "더는 망설이지 마";
  const magToks = [{ str: "더는", form: "더는", tag: "MAG", start: 0, end: 2, word: "더는" }];
  const etmToks = [
    { str: "더", form: "더", tag: "MAG", start: 0, end: 1, word: "더" },
    { str: "는", form: "는", tag: "ETM", start: 1, end: 2, word: "는" },
  ];
  if (!AG.accept(fusedSrc, { start: 1, end: 2 }, p, { item: { name: "主題（은/는）" }, tokens: magToks })) {
    fail("MAG 더는 的 는 應通過主題助詞閘門");
  }
  if (!AG.accept(fusedSrc, { start: 1, end: 2 }, p, { item: { name: "主題（은/는）" }, tokens: etmToks })) {
    fail("ETM 는 in 더는 應通過主題助詞閘門");
  }
  const fusedLocs = RS.locateApiItemInText(
    fusedSrc,
    { name: "主題（은/는）", nameKo: "은/는", category: "助詞", span: "는", kiwiKind: "jx-topic", start: 1, end: 2 },
    magToks
  );
  if (!fusedLocs.some((l) => l.start === 1 && l.end === 2)) {
    fail(`더는 應標 는 ${JSON.stringify(fusedLocs)}`);
  }
}
{
  const p = AG.inferProfile(RS.getById("seed-subject"));
  if (!p || !p.surfaces || !p.surfaces.includes("가") || !p.surfaces.includes("이")) {
    fail(`subject surfaces must include 이/가 ${JSON.stringify(p)}`);
  }
  if (!p.kiwiTags || !p.kiwiTags.includes("JKC")) {
    fail(`subject tags must include JKC ${JSON.stringify(p)}`);
  }
  const src = "내일 너에겐 없던 말이 돼";
  const toks = [
    { str: "없", form: "없", tag: "VA", start: 7, end: 8, word: "없" },
    { str: "던", form: "던", tag: "ETM", start: 8, end: 9, word: "던" },
    { str: "말", form: "말", tag: "NNG", start: 10, end: 11, word: "말" },
    { str: "이", form: "이", tag: "JKC", start: 11, end: 12, word: "이" },
  ];
  const deonRule = {
    id: "user-deon",
    title: "過去回想冠形詞形語尾（-던）",
    category: "語尾",
    structure: "詞幹＋던＋名詞",
  };
  RS.setAll([...RS.getAll(), deonRule]);
  const deonP = AG.inferProfile(deonRule, { name: deonRule.title, category: "語尾" });
  if (!deonP || !(deonP.kiwiTags || []).includes("ETM")) {
    fail(`던 ending must allow ETM ${JSON.stringify(deonP)}`);
  }
  if (!AG.accept(src, { start: 8, end: 9 }, deonP, { item: { name: deonRule.title }, tokens: toks })) {
    fail("ETM 던 應通過語尾閘門");
  }
  if (!AG.accept(src, { start: 11, end: 12 }, p, { item: { name: "主格（이/가）" }, tokens: toks })) {
    fail("JKC 이 應通過主格閘門");
  }
  const deonLocs = RS.locateApiItemInText(
    src,
    { name: deonRule.title, nameKo: "-던", category: "語尾", span: "던", start: 8, end: 9 },
    toks
  );
  if (!deonLocs.some((l) => src.slice(l.start, l.end) === "던")) {
    fail(`없던 應標 던 ${JSON.stringify(deonLocs)}`);
  }
  const iLocs = RS.locateApiItemInText(
    src,
    { name: "主格（이/가）", nameKo: "이/가", category: "助詞", span: "이", start: 11, end: 12 },
    toks
  );
  if (!iLocs.some((l) => l.start === 11 && l.end === 12)) {
    fail(`말이 應標 이 ${JSON.stringify(iLocs)}`);
  }
}
{
  const p = AG.inferProfile(RS.getById("seed-topic-contraction-nan"));
  if (!p || p.role !== "contraction" || !p.surfaces?.includes("난")) {
    fail(`난 contraction profile ${JSON.stringify(p)}`);
  }
  if (!AG.accept("난 춤 추고", { start: 0, end: 1 }, p, { item: { name: "人稱主題縮約（난）" } })) {
    fail("난 應通過縮約閘門");
  }
  const locs = RS.locateApiItemInText("난 춤 추고", {
    name: "人稱主題縮約（난）",
    nameKo: "난",
    category: "助詞",
    span: "난",
    start: 0,
    end: 1,
  });
  if (!locs.some((l) => l.start === 0 && l.end === 1)) {
    fail(`난 應定位 ${JSON.stringify(locs)}`);
  }
}
{
  const p = AG.inferProfile(RS.getById("seed-adnominal-eun"));
  if (!p || p.role !== "adnominal-n") fail(`adn-n profile ${JSON.stringify(p)}`);
  if (!AG.accept("가위 눌린 너", { start: 4, end: 5 }, p, { item: { name: "冠形詞形（-ㄴ/은）" } })) {
    fail("눌린 的 린 應通過冠形 -ㄴ/은 閘門");
  }
}
{
  const p = AG.inferProfile(RS.getById("seed-haeche"));
  if (!p || p.role !== "haeche") fail(`haeche profile ${JSON.stringify(p)}`);
}

{
  const src = "높고 힘든 삶의 능선에서 때론 포기하고 싶은 꿈";
  const eLocs = RS.locateApiItemInText(src, {
    name: "時間地點（에）",
    nameKo: "에",
    category: "助詞",
  });
  if (eLocs.some((l) => src.slice(l.start, l.start + 2) === "에서")) {
    fail(`에 不應標在 에서 裡 ${JSON.stringify(eLocs)}`);
  }
  const myeonLocs = RS.locateApiItemInText(src, {
    name: "條件（-(으)면）",
    nameKo: "-(으)면",
    category: "連接",
  });
  if (myeonLocs.length) fail(`句中無 면 ${JSON.stringify(myeonLocs)}`);
  const ndeLocs = RS.locateApiItemInText(src, {
    name: "背景對比（-ㄴ데）",
    nameKo: "-ㄴ데",
    category: "連接",
  });
  if (ndeLocs.length) fail(`句中無 ㄴ데 ${JSON.stringify(ndeLocs)}`);
  const topicEun = RS.locateApiItemInText(src, {
    name: "主題（은/는）",
    nameKo: "은/는",
    category: "助詞",
  });
  if (topicEun.some((l) => src.slice(l.start, l.end) === "은" && src.slice(Math.max(0, l.start - 1), l.end + 1).includes("싶은"))) {
    fail(`싶은 的 은 不是主題 ${JSON.stringify(topicEun)}`);
  }
}
{
  const p = AG.inferProfile(geRule);
  if (!p || p.role !== "ending-ge") fail(`infer 게 ${JSON.stringify(p)}`);
}

const shot = "잠시 웃음을 벗게";
{
  const spans = RS.scanSentence(shot);
  const hon = spans.filter((s) => s.ruleId === "seed-honorific");
  if (hon.length) fail(`잠시 不應標敬語 ${JSON.stringify(hon)}`);
  const adn = spans.filter(
    (s) => s.ruleId === "seed-adnominal-eul" || s.ruleId === "test-adn-eul-alias"
  );
  if (adn.length) fail(`웃음을 不應標冠形 ${JSON.stringify(adn)}`);
  const obj = spans.filter((s) => s.ruleId === "seed-object" && s.text === "을");
  if (!obj.length) fail(`웃음을 應標賓格 을 ${JSON.stringify(spans)}`);
  const ge = spans.filter((s) => s.ruleId === "test-adverbial-ge" && s.text === "게");
  if (!ge.length) fail(`벗게 應標 게 ${JSON.stringify(spans.filter((s) => s.ruleId === "test-adverbial-ge"))}`);
}

{
  const hon = RS.locateApiItemInText(shot, {
    name: "主體敬語（-시-）",
    span: "시",
  });
  if (hon.length) fail(`API 시 in 잠시 ${JSON.stringify(hon)}`);
}
{
  const eum = RS.locateApiItemInText(shot, {
    name: "冠形詞形（-(으)ㄹ）",
    span: "음",
    start: shot.indexOf("음"),
    end: shot.indexOf("음") + 1,
  });
  if (eum.length) fail(`API 음 as 冠形 ${JSON.stringify(eum)}`);
}
{
  const eulAdn = RS.locateApiItemInText(shot, {
    name: "未來推測（-(으)ㄹ）",
    span: "을",
  });
  if (eulAdn.length) fail(`벗게 前的 을 不應是冠形 ${JSON.stringify(eulAdn)}`);
}
{
  const obj = RS.locateApiItemInText(shot, {
    name: "賓格（을/를）",
    span: "을",
  });
  if (!obj.some((l) => l.text === "을")) fail(`API 賓格 ${JSON.stringify(obj)}`);
}

{
  const siIdx = shot.indexOf("시");
  const ok = AG.accept(
    shot,
    { start: siIdx, end: siIdx + 1, text: "시" },
    AG.inferProfile(RS.getById("seed-honorific")),
    { manual: true }
  );
  if (!ok) fail("手動套用 잠시 的 시 應允許");
}

{
  const spans = RS.scanSentence("선생님 가세요");
  if (!spans.some((s) => s.ruleId === "seed-honorific")) {
    fail(`가세요 應標敬語 ${JSON.stringify(spans)}`);
  }
}
{
  const spans = RS.scanSentence("하십니다");
  if (!spans.some((s) => s.ruleId === "seed-honorific")) {
    fail(`하십니다 應標敬語 ${JSON.stringify(spans)}`);
  }
}
{
  const spans = RS.scanSentence("가시면 좋아요");
  if (!spans.some((s) => s.ruleId === "seed-honorific" && s.text === "시")) {
    fail(`가시면 應標 시 ${JSON.stringify(spans.filter((s) => s.ruleId === "seed-honorific"))}`);
  }
}

{
  const src = "먹을 것";
  const adn = RS.locateApiItemInText(src, { name: "未來推測（-(으)ㄹ）", span: "을" });
  if (!adn.some((l) => l.text === "을")) fail(`먹을 것 應標冠形 ${JSON.stringify(adn)}`);
  const obj = RS.locateApiItemInText(src, { name: "賓格（을/를）", span: "을" });
  if (obj.length) fail(`먹을 것 不應標賓格 ${JSON.stringify(obj)}`);
}

{
  const src = "밥을 먹어요";
  const obj = RS.locateApiItemInText(src, { name: "賓格（을/를）", span: "을" });
  if (!obj.some((l) => l.text === "을")) fail(`밥을 應標賓格 ${JSON.stringify(obj)}`);
  const adn = RS.locateApiItemInText(src, { name: "未來推測（-(으)ㄹ）", span: "을" });
  if (adn.length) fail(`밥을 먹어요 不應標冠形 ${JSON.stringify(adn)}`);
}

{
  const spans = RS.scanSentence("벗게 웃다");
  if (!spans.some((s) => s.ruleId === "test-adverbial-ge" && s.text === "게")) {
    fail(`벗게 웃다 應標 게 ${JSON.stringify(spans)}`);
  }
}
{
  const spans = RS.scanSentence("이게 좋아");
  if (spans.some((s) => s.ruleId === "test-adverbial-ge")) {
    fail(`이게 不應標副詞化 게 ${JSON.stringify(spans.filter((s) => s.ruleId === "test-adverbial-ge"))}`);
  }
}

{
  const spans = RS.scanSentence("표시만 하세요");
  if (spans.some((s) => s.ruleId === "seed-honorific" && s.text === "시")) {
    fail(`표시 的 시 不應當敬語 ${JSON.stringify(spans.filter((s) => s.ruleId === "seed-honorific"))}`);
  }
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("affix-gate ok");
