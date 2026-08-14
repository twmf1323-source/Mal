/**
 * Kiwi WASM worker — 只做分析；模型／WASM 由主執行緒下載後傳入
 */
import { KiwiBuilder, Match } from "../vendor/kiwi-nlp/dist/index.js";

let kiwi = null;

function reply(id, payload) {
  self.postMessage({ id, ...payload });
}

function slimToken(t) {
  return {
    str: t.str,
    tag: t.tag,
    position: t.position,
    length: t.length,
    score: t.score,
  };
}

function toUint8(data) {
  if (!data) return new Uint8Array();
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

async function init(msg) {
  if (!msg.wasm) throw new Error("未收到 WASM");
  const files = msg.files || {};
  const wasmUrl = URL.createObjectURL(new Blob([msg.wasm], { type: "application/wasm" }));
  try {
    const builder = await KiwiBuilder.create(wasmUrl);
    const modelFiles = {};
    for (const [name, buf] of Object.entries(files)) {
      modelFiles[name] = toUint8(buf);
    }
    kiwi = await builder.build({
      modelFiles,
      modelType: "cong",
      loadDefaultDict: true,
      loadTypoDict: true,
      loadMultiDict: false,
      integrateAllomorph: true,
    });
    let version = "";
    try {
      version = String(builder.version() || "");
    } catch {
      version = "";
    }
    return version;
  } finally {
    URL.revokeObjectURL(wasmUrl);
  }
}

self.addEventListener("unhandledrejection", (ev) => {
  const reason = ev && ev.reason;
  const error = reason && reason.message ? reason.message : String(reason || "worker 未處理的錯誤");
  self.postMessage({ id: null, ok: false, type: "crash", error });
});

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === "init") {
      const version = await init(msg);
      reply(id, { ok: true, type: "inited", version });
      return;
    }
    if (msg.type === "tokenize") {
      if (!kiwi) throw new Error("Kiwi 尚未初始化");
      const text = String(msg.text || "");
      const raw = kiwi.tokenize(text, Match.allWithNormalizing);
      reply(id, { ok: true, type: "tokenized", tokens: (raw || []).map(slimToken) });
      return;
    }
    throw new Error("未知的 worker 指令");
  } catch (err) {
    reply(id, {
      ok: false,
      type: "error",
      error: err && err.message ? err.message : String(err),
    });
  }
};
