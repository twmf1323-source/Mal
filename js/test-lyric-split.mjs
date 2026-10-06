/**
 * 韓語歌詞本地切行：行長上限、不改寫、不切의／하고 있다
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

function fail(msg) {
  failed += 1;
  console.error("FAIL", msg);
}

function ok(msg) {
  console.log("ok", msg);
}

function load() {
  const ctx = {
    console,
    Storage: {
      loadSettings: () => ({
        apiKey: "",
        baseUrl: "https://example.invalid/v1",
        model: "test-model",
      }),
      DEFAULT_SETTINGS: { baseUrl: "https://example.invalid/v1", model: "test-model" },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, "ai.js"), "utf8"), ctx);
  return ctx.AiService;
}

const AiService = load();
if (!AiService?.enforcePhoneLineLength) {
  fail("AiService.enforcePhoneLineLength missing");
  process.exit(1);
}

function compact(s) {
  return String(s || "").replace(/\s+/g, "");
}

function charLen(s) {
  return Array.from(String(s || "")).length;
}

const HARD = 12;
const short = "당신은 도시로 돌아간다";
const shortLines = AiService.enforcePhoneLineLength([short]);
if (shortLines.length !== 1 || shortLines[0] !== short) fail(`short clause changed: ${JSON.stringify(shortLines)}`);
else ok("≤12 clause kept");

const wall = "선글라스 너머 백금빛 바다 정체 속에서 당신은 도시로 돌아간다";
const lines = AiService.enforcePhoneLineLength([wall]);
if (!lines.length) fail("wall produced no lines");
if (lines.some((l) => charLen(l) > HARD)) fail(`line longer than ${HARD}: ${JSON.stringify(lines)}`);
else ok(`wall split into ${lines.length} lines ≤${HARD}`);
if (compact(lines.join("")) !== compact(wall)) fail("rewrote source characters");
else ok("source characters preserved");
if (lines.some((l) => /의$/.test(l.trim()))) fail(`cut after 의: ${JSON.stringify(lines)}`);
else ok("did not cut after 의");

const progressive = "나는 너를 사랑하고 있다";
const progLines = AiService.enforcePhoneLineLength([progressive]);
if (progLines.some((l) => /고$/.test(l.trim()))) {
  fail(`split 하고 있다: ${JSON.stringify(progLines)}`);
} else ok("kept 하고 있다 together");

const already = ["선글라스 너머", "백금빛 바다"];
const same = AiService.enforcePhoneLineLength(already);
if (same.length !== 2 || same[0] !== already[0] || same[1] !== already[1]) {
  fail(`already-short lines changed: ${JSON.stringify(same)}`);
} else ok("already-short lines kept");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all ok");
