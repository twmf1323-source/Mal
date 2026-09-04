import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

const ctx = {
  console,
  Storage: { saveRules() {} },
  StemDrop: {},
  KiwiService: { ruleMatchesHint() { return false; } },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "js/affix-gate.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(root, "js/rules.js"), "utf8") +
    "\n;this.RulesService = RulesService; this.AffixGate = AffixGate;",
  ctx
);
const RS = ctx.RulesService;
const seed = JSON.parse(fs.readFileSync(path.join(root, "data/seed-rules.json"), "utf8"));
RS.setAll(seed);

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const geoya = {
  id: "user-geoya",
  title: "將會／打算（-(으)ㄹ 거야）",
  category: "句型",
  structure: "詞幹＋(으)ㄹ＋거야",
  explanation: "表示未來的打算或推測。",
};
const suEob = {
  id: "user-su-eob",
  title: "不可能（-ㄹ 수 없다）",
  category: "句型",
  structure: "詞幹＋ㄹ 수 없다",
  explanation: "表示沒有能力或不可能。",
};
RS.setAll([...seed, geoya, suEob]);

const src = "아무도 날 볼 수 없게";
assert(RS.inferEulFrame(geoya)?.id === "geoya", "geoya frame");
assert(RS.inferEulFrame(suEob)?.id === "su-eob", "su-eob frame");
assert(!RS.isFutureEulRule(geoya), "geoya is not bare future eul");
assert(!RS.isFutureEulRule(suEob), "수 없다 is not bare future eul");
assert(RS.eulFrameWitness(src, geoya) === "miss", "no 거야 in sentence");
assert(RS.eulFrameWitness(src, suEob) === "hit", "수 없 is present");

const geoyaLocs = RS.locateApiItemInText(src, { name: geoya.title, nameKo: "-(으)ㄹ 거야" });
assert(!geoyaLocs.length, `거야 should not locate in 볼 수 없게: ${JSON.stringify(geoyaLocs)}`);

const suLocs = RS.locateApiItemInText(src, { name: suEob.title, nameKo: "-ㄹ 수 없다", span: "수 없" });
assert(suLocs.length && suLocs.some((l) => src.slice(l.start, l.end).includes("수")), `수 없 locate ${JSON.stringify(suLocs)}`);

const future = RS.getById("seed-adnominal-eul");
const futLocs = RS.locateApiItemInText(src, { name: future.title, span: "볼" });
assert(!futLocs.length, `bare ㄹ should not mark 볼 before 수 없: ${JSON.stringify(futLocs)}`);

const matchGeoya = RS.findMatchingRule({ name: "未來推測（-(으)ㄹ）" });
assert(matchGeoya.rule?.id !== "user-geoya", `bare ㄹ must not own 거야 card (got ${matchGeoya.rule?.title})`);

const dropped = RS.dropMissingEulFrames(src, [
  { name: geoya.title, source: "api" },
  { name: suEob.title, source: "api" },
  { name: future.title, source: "kiwi" },
]);
assert(
  !dropped.some((it) => /거야/.test(it.name)) &&
    dropped.some((it) => /不可能/.test(it.name)) &&
    !dropped.some((it) => it.name === future.title),
  `drop 거야／裸ㄹ keep 不可能: ${dropped.map((it) => it.name).join(" | ")}`
);

const srcGeoya = "내일 갈 거야";
assert(RS.eulFrameWitness(srcGeoya, geoya) === "hit", "갈 거야 should witness");
const okLocs = RS.locateApiItemInText(srcGeoya, { name: geoya.title, nameKo: "-(으)ㄹ 거야" });
assert(okLocs.length && srcGeoya.slice(okLocs[0].start, okLocs[0].end).includes("거"), `갈 거야 locate ${JSON.stringify(okLocs)}`);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ok eul-frame");
