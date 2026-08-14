import { KiwiBuilder, Match } from "../vendor/kiwi-nlp/dist/index.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

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

const samples = ["예쁜 옷", "가는 사람", "나는 학생", "작은 집", "갔어요"];

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
});

for (const text of samples) {
  const tokens = kiwi.tokenize(text, Match.allWithNormalizing);
  const line = tokens.map((t) => `${t.str}/${t.tag}@${t.position}+${t.length}`).join("  ");
  console.log(text, "=>", line);
}
