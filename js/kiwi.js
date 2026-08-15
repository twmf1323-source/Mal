/**
 * Kiwi 形態素層：斷詞、語素對規則、零寬語尾 span
 * 不取代 API 盤點；負責定位／消歧／選字建議
 */
const KiwiService = (() => {
  const CACHE_MAX = 40;
  const MODEL_FILES = [
    "combiningRule.txt",
    "cong.mdl",
    "default.dict",
    "extract.mdl",
    "sj.morph",
    "typo.dict",
    "dialect.dict",
  ];
  const MATCH_ALL_NORM = 8454207;

  let worker = null;
  let mainKiwi = null;
  let status = "idle";
  let errorMsg = "";
  let version = "";
  let seq = 0;
  let initPromise = null;
  const pending = new Map();
  const cache = new Map();
  const listeners = new Set();

  const REMOTE_BASE = "https://twmf1323-source.github.io/Mal/";

  function isFileProtocol() {
    return typeof location !== "undefined" && location.protocol === "file:";
  }

  function assetUrl(rel) {
    const base = isFileProtocol() ? REMOTE_BASE : document.baseURI;
    return new URL(rel, base).href;
  }

  const GITHUB_LFS_MEDIA =
    "https://media.githubusercontent.com/media/twmf1323-source/Mal/main/";

  function looksLikeLfsPointer(buf) {
    if (!buf || buf.byteLength < 40 || buf.byteLength > 800) return false;
    try {
      const head = new TextDecoder("utf-8").decode(buf.slice(0, 80));
      return head.startsWith("version https://git-lfs.github.com/");
    } catch {
      return false;
    }
  }

  function isWasmMagic(buf) {
    const u = new Uint8Array(buf);
    return u.length >= 4 && u[0] === 0x00 && u[1] === 0x61 && u[2] === 0x73 && u[3] === 0x6d;
  }

  async function fetchOne(url, label, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      throw new Error(`${label} 載入失敗（HTTP ${res.status}）`);
    }
    return res.arrayBuffer();
  }

  async function fetchBuffer(url, label, rel) {
    const cred = isFileProtocol() ? "omit" : "same-origin";
    let buf = await fetchOne(url, label, { credentials: cred });
    if (looksLikeLfsPointer(buf)) {
      const media = GITHUB_LFS_MEDIA + String(rel || "").replace(/^\/+/, "");
      buf = await fetchOne(media, label + "（Git LFS）", { credentials: "omit" });
    }
    if (label === "WASM" && !isWasmMagic(buf)) {
      throw new Error("WASM 不是有效的 WebAssembly 檔（可能拿到 Git LFS 指標）");
    }
    return buf;
  }

  async function fetchAssets() {
    const wasmRel = "vendor/kiwi-nlp/dist/kiwi-wasm.wasm";
    const wasm = await fetchBuffer(assetUrl(wasmRel), "WASM", wasmRel);
    const files = {};
    await Promise.all(
      MODEL_FILES.map(async (name) => {
        const rel = "vendor/kiwi/models/cong/base/" + name;
        files[name] = await fetchBuffer(assetUrl(rel), name, rel);
      })
    );
    return { wasm, files };
  }

  function isHangulSyllable(ch) {
    const c = String(ch || "").charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  function canonForm(s) {
    return String(s || "")
      .normalize("NFC")
      .replace(/ᆫ/g, "ㄴ")
      .replace(/ᆯ/g, "ㄹ")
      .replace(/ᆷ/g, "ㅁ")
      .replace(/ᆼ/g, "ㅇ")
      .replace(/ᆻ/g, "ㅆ")
      .replace(/ᆸ/g, "ㅂ")
      .replace(/ᆮ/g, "ㄷ")
      .replace(/ᆺ/g, "ㅅ");
  }

  function baseTag(tag) {
    return String(tag || "").split(/[-+]/)[0];
  }

  function isVerbish(tag) {
    const t = baseTag(tag);
    return t === "VV" || t === "VX" || t === "XSV";
  }

  function isAdjish(tag) {
    const t = baseTag(tag);
    return t === "VA" || t === "XSA" || t === "VCN";
  }

  function isPred(tag) {
    const t = baseTag(tag);
    return isVerbish(t) || isAdjish(t) || t === "VCP";
  }

  function isEnabled() {
    try {
      return Storage.loadSettings().kiwiEnabled !== false;
    } catch {
      return true;
    }
  }

  function getStatus() {
    return { status, error: errorMsg, version, enabled: isEnabled() };
  }

  function setStatus(next, err) {
    status = next;
    if (err !== undefined) errorMsg = String(err || "");
    for (const fn of listeners) {
      try {
        fn(getStatus());
      } catch {
        /* ignore */
      }
    }
  }

  function onStatus(fn) {
    if (typeof fn === "function") listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function failAllPending(err) {
    const error = err instanceof Error ? err : new Error(String(err || "Kiwi 失敗"));
    for (const [, wait] of pending) wait.reject(error);
    pending.clear();
  }

  function callWorker(type, extra = {}, transfer = []) {
    if (!worker) return Promise.reject(new Error("worker 未建立"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, type, ...extra }, transfer);
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  function stopWorker() {
    if (!worker) return;
    try {
      worker.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
  }

  function ensureWorker() {
    if (worker) return worker;
    const url = assetUrl("js/kiwi-worker.js");
    worker = new Worker(url, { type: "module" });
    worker.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === "crash") {
        failAllPending(new Error(msg.error || "Kiwi worker 崩潰"));
        return;
      }
      const wait = pending.get(msg.id);
      if (!wait) return;
      pending.delete(msg.id);
      if (msg.ok) wait.resolve(msg);
      else wait.reject(new Error(msg.error || "Kiwi 失敗"));
    };
    worker.onerror = (ev) => {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      const detail = ev && ev.message && ev.message !== "Script error."
        ? ev.message
        : "無法啟動形態素 Worker（請用 HTTP 開啟本專案資料夾）";
      failAllPending(new Error(detail));
    };
    worker.onmessageerror = () => {
      failAllPending(new Error("Worker 無法讀取模型資料"));
    };
    return worker;
  }

  async function initOnMain(assets) {
    const mod = await import(assetUrl("vendor/kiwi-nlp/dist/index.js"));
    const wasmUrl = URL.createObjectURL(new Blob([assets.wasm], { type: "application/wasm" }));
    try {
      const builder = await mod.KiwiBuilder.create(wasmUrl);
      const modelFiles = {};
      for (const [name, buf] of Object.entries(assets.files || {})) {
        modelFiles[name] = new Uint8Array(buf);
      }
      mainKiwi = await builder.build({
        modelFiles,
        modelType: "cong",
        loadDefaultDict: true,
        loadTypoDict: true,
        loadMultiDict: false,
        integrateAllomorph: true,
      });
      try {
        version = String(builder.version() || "");
      } catch {
        version = "";
      }
    } finally {
      URL.revokeObjectURL(wasmUrl);
    }
  }

  async function initViaWorker(assets) {
    ensureWorker();
    const transfer = [assets.wasm].concat(Object.values(assets.files));
    const msg = await callWorker("init", { wasm: assets.wasm, files: assets.files }, transfer);
    version = msg.version || "";
  }

  function ensureReady() {
    if (!isEnabled()) return Promise.reject(new Error("形態素分析已關閉"));
    if (status === "ready") return Promise.resolve();
    if (initPromise) return initPromise;
    setStatus("loading");
    initPromise = (async () => {
      const assets = await fetchAssets();
      if (isFileProtocol()) {
        await initOnMain(assets);
      } else {
        try {
          await initViaWorker(assets);
        } catch (workerErr) {
          console.warn("[kiwi] worker 失敗，改在主執行緒載入", workerErr);
          stopWorker();
          const retry = await fetchAssets();
          await initOnMain(retry);
        }
      }
      setStatus("ready", "");
    })().catch((err) => {
      initPromise = null;
      stopWorker();
      setStatus("error", err.message || String(err));
      throw err;
    });
    return initPromise;
  }

  function remember(text, tokens) {
    if (cache.has(text)) cache.delete(text);
    cache.set(text, tokens);
    while (cache.size > CACHE_MAX) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }

  async function tokenize(text) {
    const src = String(text || "").normalize("NFC");
    if (!src) return [];
    if (cache.has(src)) return cache.get(src);
    await ensureReady();
    let tokens = [];
    if (mainKiwi) {
      const raw = mainKiwi.tokenize(src, MATCH_ALL_NORM);
      tokens = Array.isArray(raw) ? raw : [];
    } else {
      const msg = await callWorker("tokenize", { text: src });
      tokens = Array.isArray(msg.tokens) ? msg.tokens : [];
    }
    remember(src, tokens);
    return tokens;
  }

  function cachedTokens(text) {
    const src = String(text || "").normalize("NFC");
    return cache.has(src) ? cache.get(src) : null;
  }

  /**
   * 語素在原文的可視區間。len=0（받침語尾）標在宿主音節上。
   */
  function tokenSurfaceRange(text, tok) {
    const src = String(text || "");
    const start = Number(tok?.position) || 0;
    const len = Number(tok?.length) || 0;
    if (len > 0) {
      const end = Math.min(src.length, start + len);
      return { start, end };
    }
    if (start > 0 && isHangulSyllable(src[start - 1])) {
      return { start: start - 1, end: start };
    }
    if (start < src.length && isHangulSyllable(src[start])) {
      return { start, end: start + 1 };
    }
    return { start, end: start };
  }

  function rangesOverlap(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
  }

  function tokenOverlapsSel(text, tok, selStart, selEnd) {
    const r = tokenSurfaceRange(text, tok);
    if (r.end > r.start) return rangesOverlap(r.start, r.end, selStart, selEnd);
    return selStart <= r.start && r.start <= selEnd;
  }

  function makeHit(kind, text, tok, extra = {}) {
    const r = tokenSurfaceRange(text, tok);
    const start = extra.start != null ? extra.start : r.start;
    const end = extra.end != null ? extra.end : r.end;
    return {
      kind,
      form: canonForm(tok.str),
      tag: tok.tag,
      start,
      end,
      text: extra.text || srcSlice(text, start, end),
      reason: extra.reason || kind,
      score: extra.score || 32,
      prevTag: extra.prevTag || "",
      prevForm: extra.prevForm || "",
    };
  }

  function srcSlice(text, start, end) {
    if (end > start) return String(text || "").slice(start, end);
    return "";
  }

  function pushUnique(hits, hit) {
    if (!hit || !hit.kind) return;
    const key = `${hit.kind}:${hit.start}:${hit.end}`;
    if (hits.some((h) => `${h.kind}:${h.start}:${h.end}` === key)) return;
    hits.push(hit);
  }

  /**
   * 把 token 流對成筆記本文法點
   */
  function analyzeHits(text, tokens) {
    const src = String(text || "").normalize("NFC");
    const toks = Array.isArray(tokens) ? tokens : [];
    const hits = [];

    const formAt = (i) => canonForm(toks[i]?.str);
    const tagAt = (i) => toks[i]?.tag || "";

    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      const form = formAt(i);
      const tag = tagAt(i);
      const bt = baseTag(tag);
      const prev = toks[i - 1];
      const next = toks[i + 1];
      const prevForm = prev ? canonForm(prev.str) : "";
      const prevTag = prev ? prev.tag : "";
      const nextForm = next ? canonForm(next.str) : "";
      const nextTag = next ? next.tag : "";

      if (bt === "ETM") {
        if (form === "는" && isVerbish(prevTag)) {
          pushUnique(
            hits,
            makeHit("etm-neun", src, tok, {
              reason: "動詞冠形 -는（ETM）",
              score: 36,
              prevTag,
              prevForm,
            })
          );
        } else if ((form === "ㄴ" || form === "은") && isAdjish(prevTag)) {
          pushUnique(
            hits,
            makeHit("etm-n-eun", src, tok, {
              reason: "形容詞冠形 -ㄴ/은（ETM，含받침）",
              score: 38,
              prevTag,
              prevForm,
            })
          );
        }
      }

      if (bt === "JX" && (form === "은" || form === "는")) {
        const host = tokenSurfaceRange(src, prev || tok);
        const self = tokenSurfaceRange(src, tok);
        const fused = src.slice(host.start, self.end);
        if (fused === "난" && prevForm === "나") {
          pushUnique(hits, makeHit("contr-nan", src, tok, { start: host.start, end: self.end, text: "난", reason: "나＋는→난", score: 40 }));
        } else if (fused === "넌" && prevForm === "너") {
          pushUnique(hits, makeHit("contr-neon", src, tok, { start: host.start, end: self.end, text: "넌", reason: "너＋는→넌", score: 40 }));
        } else if (fused === "전" && prevForm === "저") {
          pushUnique(hits, makeHit("contr-jeon", src, tok, { start: host.start, end: self.end, text: "전", reason: "저＋는→전", score: 40 }));
        } else {
          pushUnique(
            hits,
            makeHit("jx-topic", src, tok, { reason: "主題助詞 은/는（JX）", score: 34, prevTag, prevForm })
          );
        }
      }

      if (bt === "JKO" && (form === "을" || form === "를")) {
        const host = tokenSurfaceRange(src, prev || tok);
        const self = tokenSurfaceRange(src, tok);
        const fused = src.slice(host.start, self.end);
        if (fused === "날" && prevForm === "나") {
          pushUnique(hits, makeHit("contr-nal", src, tok, { start: host.start, end: self.end, text: "날", reason: "나＋를→날", score: 40 }));
        } else if (fused === "널" && prevForm === "너") {
          pushUnique(hits, makeHit("contr-neol", src, tok, { start: host.start, end: self.end, text: "널", reason: "너＋를→널", score: 40 }));
        } else if (fused === "절" && prevForm === "저") {
          pushUnique(hits, makeHit("contr-jeol", src, tok, { start: host.start, end: self.end, text: "절", reason: "저＋를→절", score: 40 }));
        } else {
          pushUnique(hits, makeHit("jko-object", src, tok, { reason: "賓格 을/를（JKO）", score: 34 }));
        }
      }

      if (bt === "JKS" && (form === "이" || form === "가")) {
        const wordLeft = (() => {
          let l = tokenSurfaceRange(src, tok).start;
          while (l > 0 && isHangulSyllable(src[l - 1])) l--;
          return src.slice(l, tokenSurfaceRange(src, tok).end);
        })();
        if (/듯이$|같이$|없이$/.test(wordLeft)) {
          if (/듯이$/.test(wordLeft)) {
            const idx = src.lastIndexOf("듯이", tokenSurfaceRange(src, tok).end);
            if (idx >= 0) {
              pushUnique(hits, makeHit("deusi", src, tok, { start: idx, end: idx + 2, text: "듯이", reason: "듯이（非主格 이）", score: 36 }));
            }
          }
        } else {
          pushUnique(hits, makeHit("jks-subject", src, tok, { reason: "主格 이/가（JKS）", score: 34 }));
        }
      }

      if (bt === "JKB") {
        if (form === "에서") {
          pushUnique(hits, makeHit("jkb-eseo", src, tok, { reason: "處所來源 에서（JKB）", score: 34 }));
        } else if (form === "에") {
          pushUnique(hits, makeHit("jkb-e", src, tok, { reason: "時間地點 에（JKB）", score: 32 }));
        }
      }

      if (bt === "EP") {
        if (/^(았|었|였|ㅆ)$/.test(form)) {
          pushUnique(hits, makeHit("ep-past", src, tok, { reason: "過去 -았/었-（EP）", score: 36 }));
        }
        if (/^(시|으시)$/.test(form)) {
          pushUnique(hits, makeHit("ep-si", src, tok, { reason: "主體敬語 -시-（EP）", score: 34 }));
        }
      }

      if (bt === "EF") {
        if (/요$/.test(form) && /어|아|여/.test(form) && !/습니다|ㅂ니다/.test(form)) {
          pushUnique(hits, makeHit("ef-haeyo", src, tok, { reason: "禮貌體 -아/어요（EF）", score: 34 }));
        } else if (/습니다|ㅂ니다|습니까|ㅂ니까/.test(form)) {
          pushUnique(hits, makeHit("ef-hamnida", src, tok, { reason: "正式體 -습니다（EF）", score: 34 }));
        } else if (/^(어|아|여)$/.test(form)) {
          pushUnique(hits, makeHit("ef-haeche", src, tok, { reason: "平語 해체（EF）", score: 28 }));
        }
        if (/이에요|예요|에요|입니다/.test(form) || (prev && baseTag(prevTag) === "VCP" && /에요|예요|에요/.test(form))) {
          const start = prev && baseTag(prevTag) === "VCP" ? tokenSurfaceRange(src, prev).start : tokenSurfaceRange(src, tok).start;
          const end = tokenSurfaceRange(src, tok).end;
          pushUnique(hits, makeHit("vcp-ieyo", src, tok, { start, end, reason: "指定 이에요/예요", score: 34 }));
        }
      }

      if (bt === "VCP" && /이에요|예요|입니다/.test(form)) {
        pushUnique(hits, makeHit("vcp-ieyo", src, tok, { reason: "指定 이에요/예요", score: 34 }));
      }

      if (bt === "EC") {
        const nextBt = baseTag(nextTag);
        if (form === "고" && nextForm === "있" && nextBt === "VX") {
          const start = tokenSurfaceRange(src, tok).start;
          const end = tokenSurfaceRange(src, next).end;
          pushUnique(hits, makeHit("prog-goitda", src, tok, { start, end, reason: "進行 -고 있다", score: 36 }));
        } else if (form === "고" && /^싶/.test(nextForm)) {
          const start = tokenSurfaceRange(src, tok).start;
          const end = tokenSurfaceRange(src, next).end;
          pushUnique(hits, makeHit("want-gosip", src, tok, { start, end, reason: "希望 -고 싶다", score: 36 }));
        } else if (form === "고") {
          pushUnique(hits, makeHit("ec-go", src, tok, { reason: "並列連接 -고（EC）", score: 32 }));
        }
        if (/^(아서|어서|여서)$/.test(form) || (form === "서" && /어|아|여/.test(prevForm))) {
          pushUnique(hits, makeHit("ec-aseo", src, tok, { reason: "原因連接 -아/어서（EC）", score: 34 }));
        }
        if (form === "는데" || (form === "데" && prevForm === "는")) {
          pushUnique(hits, makeHit("ec-nde-v", src, tok, { reason: "背景對比 -는데", score: 34 }));
        }
        if (form === "은데" || ((form === "ㄴ데" || form === "데") && isAdjish(prevTag))) {
          pushUnique(hits, makeHit("ec-nde-a", src, tok, { reason: "背景對比 -ㄴ/은데", score: 34 }));
        }
        if (form === "인데" || (form === "ㄴ데" && baseTag(prevTag) === "VCP")) {
          pushUnique(hits, makeHit("ec-nde-n", src, tok, { reason: "背景對比 -인데", score: 34 }));
        }
        if (form === "지" && /^않/.test(nextForm)) {
          const start = tokenSurfaceRange(src, tok).start;
          const end = tokenSurfaceRange(src, next).end;
          pushUnique(hits, makeHit("neg-ji", src, tok, { start, end, reason: "否定 -지 않다", score: 36 }));
        }
      }

      if ((form === "줘" || form === "줘요" || form === "주세요") && (isPred(tag) || bt === "VV" || bt === "VX" || bt === "EF" || bt === "EC")) {
        pushUnique(hits, makeHit("ajud", src, tok, { reason: "請托 줘／주세요", score: 36 }));
      }
      if (form === "주" && (bt === "VV" || bt === "VX") && /^(어|여|아|어요|여요)$/.test(nextForm)) {
        const start = tokenSurfaceRange(src, tok).start;
        const end = tokenSurfaceRange(src, next).end;
        pushUnique(hits, makeHit("ajud", src, tok, { start, end, reason: "請托 아/어 주다", score: 36 }));
      }

      if (/^만하/.test(form) || (form === "만" && /^하/.test(nextForm))) {
        const start = tokenSurfaceRange(src, tok).start;
        const end = next && /^하/.test(nextForm) ? tokenSurfaceRange(src, next).end : tokenSurfaceRange(src, tok).end;
        pushUnique(hits, makeHit("manhada", src, tok, { start, end, reason: "值得 -ㄹ 만하다", score: 34 }));
      }

      if (form === "했" || form === "해요" || form === "해서" || form === "했어" || form === "했다") {
        pushUnique(hits, makeHit("vowel-hae", src, tok, { reason: "母音縮約 하＋여→해", score: 30 }));
      } else if (form === "해" && (prevForm === "하" || bt === "VV" || bt === "XSV")) {
        pushUnique(hits, makeHit("vowel-hae", src, tok, { reason: "母音縮約 하＋여→해", score: 30 }));
      }
      if (
        (form === "여" || form === "여요" || form === "여서") &&
        prevForm !== "하" &&
        (prevForm.endsWith("이") || isPred(prevTag))
      ) {
        pushUnique(hits, makeHit("vowel-yeo", src, tok, { reason: "母音縮約 이＋어→여", score: 28 }));
      }
      if (form === "돼" || form === "됐" || (prevForm === "되" && /^(어|었|여)/.test(form))) {
        pushUnique(hits, makeHit("vowel-dwae", src, tok, { reason: "母音縮約 되＋어→돼", score: 30 }));
      }

      if (/-I$/.test(tag) && isPred(tag)) {
        const nxt = nextForm;
        if (/^(워|와|우|오)/.test(nxt) || /워|와/.test(form)) {
          pushUnique(hits, makeHit("irr-b", src, tok, { reason: "ㅂ 不規則", score: 30 }));
        } else if (/르$/.test(form) || /^(라|러|ㄹ라|ㄹ러)/.test(nxt)) {
          pushUnique(hits, makeHit("irr-reu", src, tok, { reason: "르 不規則", score: 30 }));
        } else if (/^(들|걸|물)/.test(nxt) || /ㄷ/.test(form)) {
          pushUnique(hits, makeHit("irr-d", src, tok, { reason: "ㄷ 不規則", score: 28 }));
        }
      }

      if (form === "듯이" || (form === "듯" && nextForm === "이")) {
        const start = tokenSurfaceRange(src, tok).start;
        const end = nextForm === "이" ? tokenSurfaceRange(src, next).end : tokenSurfaceRange(src, tok).end;
        pushUnique(hits, makeHit("deusi", src, tok, { start, end, reason: "比喻 듯이", score: 36 }));
      }
    }

    return hits;
  }

  const HINT_MATCHERS = {
    "etm-neun": (blob, title) => /冠形|관형|定語/.test(blob) && /는/.test(title) && !/ㄴ\s*\/\s*은|-ㄴ/.test(title),
    "etm-n-eun": (blob, title) => /冠形|관형|定語/.test(blob) && (/ㄴ\s*\/\s*은|-ㄴ\/은|／은|-ㄴ/.test(blob) || /形容詞/.test(blob)),
    "jx-topic": (blob) => /主題/.test(blob) && /은\s*\/\s*는|은\/는/.test(blob) && !/縮約|冠形/.test(blob),
    "jks-subject": (blob) => /主格/.test(blob) && /이\s*\/\s*가|이\/가/.test(blob),
    "jko-object": (blob) => /賓格/.test(blob) && /을\s*\/\s*를|을\/를/.test(blob),
    "jkb-e": (blob, title) => /時間地點|處所/.test(blob) && /（에）|\(에\)|^時間地點（에）/.test(title + blob) && !/에서/.test(title),
    "jkb-eseo": (blob) => /에서/.test(blob) && /處所|來源|에서/.test(blob),
    "ef-haeyo": (blob) => /禮貌體|해요體|아\s*\/\s*어요/.test(blob) && !/합니다|습니다/.test(blob),
    "ef-haeche": (blob) => /平語|해체|반말/.test(blob) && !/해요|합니다/.test(blob),
    "ef-hamnida": (blob) => /正式體|합니다|습니다|합쇼/.test(blob),
    "ep-past": (blob) => /過去/.test(blob) && /았|었/.test(blob),
    "ep-si": (blob) => /主體敬語|尊待|-시-/.test(blob) || /（-시-）/.test(blob),
    "ec-go": (blob, title) => /並列/.test(blob) && /고/.test(title) && !/있다|싶다/.test(blob),
    "ec-aseo": (blob) => /原因連接|아\s*\/\s*어서/.test(blob),
    "ec-nde-v": (blob, title) => /背景對比|는데/.test(blob) && /는데/.test(title) && !/은데|인데/.test(title),
    "ec-nde-a": (blob, title) => /背景對比|은데/.test(blob) && /ㄴ\s*\/\s*은데|은데/.test(title),
    "ec-nde-n": (blob, title) => /背景對比|인데/.test(blob) && /인데|ㄴ데/.test(title),
    "vcp-ieyo": (blob) => /指定|이에요|예요/.test(blob),
    "neg-ji": (blob) => /否定/.test(blob) && /지\s*않/.test(blob),
    "prog-goitda": (blob) => /進行/.test(blob) && /고\s*있/.test(blob),
    "want-gosip": (blob) => /希望/.test(blob) && /고\s*싶/.test(blob),
    "ajud": (blob) => /請托|命令/.test(blob) && /줘|주/.test(blob),
    "manhada": (blob) => /值得|만하/.test(blob),
    "vowel-hae": (blob) => /母音縮約/.test(blob) && /하\s*＋\s*여|→해/.test(blob),
    "vowel-yeo": (blob) => /母音縮約/.test(blob) && /이\s*＋\s*어|→여/.test(blob) && !/→해/.test(blob),
    "vowel-dwae": (blob) => /母音縮約/.test(blob) && /되\s*＋\s*어|→돼/.test(blob),
    "irr-b": (blob) => /ㅂ\s*不規則|ㅂ\s*불규칙/.test(blob),
    "irr-d": (blob) => /ㄷ\s*不規則|ㄷ\s*불규칙/.test(blob),
    "irr-reu": (blob) => /르\s*不規則|르\s*불규칙/.test(blob),
    "contr-nan": (blob, title) => /縮約/.test(blob) && /난/.test(title),
    "contr-neon": (blob, title) => /縮約/.test(blob) && /넌/.test(title),
    "contr-jeon": (blob, title) => /縮約/.test(blob) && /전/.test(title) && /主題/.test(blob),
    "contr-nal": (blob, title) => /縮約/.test(blob) && /날/.test(title),
    "contr-neol": (blob, title) => /縮約/.test(blob) && /널/.test(title),
    "contr-jeol": (blob, title) => /縮約/.test(blob) && /절/.test(title),
    "deusi": (blob) => /듯이|比喻/.test(blob),
  };

  const SEED_KIND = {
    "etm-neun": "seed-adnominal-neun",
    "etm-n-eun": "seed-adnominal-eun",
    "jx-topic": "seed-topic",
    "jks-subject": "seed-subject",
    "jko-object": "seed-object",
    "jkb-e": "seed-e",
    "jkb-eseo": "seed-eseo",
    "ef-haeyo": "seed-haeyo",
    "ef-haeche": "seed-haeche",
    "ef-hamnida": "seed-hamnida",
    "ep-past": "seed-past",
    "ep-si": "seed-honorific",
    "ec-go": "seed-go",
    "ec-aseo": "seed-aseo",
    "ec-nde-v": "seed-nde-verb",
    "ec-nde-a": "seed-nde-adj",
    "ec-nde-n": "seed-nde-noun",
    "vcp-ieyo": "seed-ieyo",
    "neg-ji": "seed-negative",
    "prog-goitda": "seed-progressive",
    "want-gosip": "seed-want",
    "ajud": "seed-ajueo-juda",
    "manhada": "seed-manhada",
    "vowel-hae": "seed-vowel-hae",
    "vowel-yeo": "seed-vowel-yeo",
    "vowel-dwae": "seed-vowel-dwae",
    "irr-b": "seed-b-irregular",
    "irr-d": "seed-d-irregular",
    "irr-reu": "seed-reu-irregular",
    "contr-nan": "seed-topic-contraction-nan",
    "contr-neon": "seed-topic-contraction-neon",
    "contr-jeon": "seed-topic-contraction-jeon",
    "contr-nal": "seed-object-contraction-nal",
    "contr-neol": "seed-object-contraction-neol",
    "contr-jeol": "seed-object-contraction-jeol",
    "deusi": "seed-deusi",
  };

  function ruleBlob(rule) {
    return [rule?.title, rule?.category, rule?.structure, rule?.explanation].join("\n");
  }

  function ruleMatchesHint(rule, hint) {
    if (!rule || !hint) return false;
    if (SEED_KIND[hint.kind] && rule.id === SEED_KIND[hint.kind]) return true;
    const fn = HINT_MATCHERS[hint.kind];
    if (!fn) return false;
    return Boolean(fn(ruleBlob(rule), rule.title || ""));
  }

  function findRulesForHint(hint, rules) {
    return (rules || []).filter((r) => ruleMatchesHint(r, hint));
  }

  function hintsForTokensInSpan(text, tokens, start, end) {
    const src = String(text || "");
    const s = Number(start);
    const e = Number(end);
    const rangeOk = Number.isFinite(s) && Number.isFinite(e) && e > s;
    const allHits = analyzeHits(src, tokens);
    if (!rangeOk) return allHits;
    return allHits.filter((h) => {
      const hs = Number.isFinite(h.start) ? h.start : 0;
      const he = Number.isFinite(h.end) ? h.end : hs;
      if (he > hs) return rangesOverlap(hs, he, s, e);
      return s <= hs && hs <= e;
    });
  }

  async function hintsForSpan(text, start, end) {
    const tokens = await tokenize(text);
    return hintsForTokensInSpan(text, tokens, start, end);
  }

  function buildInventoryItems(text, tokens, rules) {
    const src = String(text || "");
    const hits = analyzeHits(src, tokens);
    const list = [];
    const seen = new Set();
    for (const hit of hits) {
      const matched = findRulesForHint(hit, rules);
      for (const rule of matched) {
        const span = hit.text || src.slice(hit.start, hit.end) || rule.title;
        const key = `${rule.id}:${hit.start}:${hit.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const parsed =
          typeof RulesService.parseBilingualTitle === "function"
            ? RulesService.parseBilingualTitle(rule.title) || {}
            : {};
        list.push({
          name: rule.title,
          nameKo: parsed.ko || "",
          nameZh: parsed.zh || "",
          span,
          start: hit.start,
          end: hit.end > hit.start ? hit.end : hit.start + Math.max(1, span.length),
          category: rule.category || "",
          confidence: "high",
          source: "kiwi",
          manualRuleId: rule.id,
          kiwiKind: hit.kind,
          note: hit.reason,
        });
      }
    }
    return list;
  }

  function mergeItems(existing, extra) {
    const out = Array.isArray(existing) ? existing.slice() : [];
    function overlap(a, b) {
      const a0 = Number(a.start);
      const a1 = Number(a.end);
      const b0 = Number(b.start);
      const b1 = Number(b.end);
      if (Number.isFinite(a0) && Number.isFinite(a1) && Number.isFinite(b0) && Number.isFinite(b1)) {
        return rangesOverlap(a0, a1, b0, b1);
      }
      return String(a.span || "") === String(b.span || "") && a.span;
    }
    function sameRule(a, b) {
      if (a.manualRuleId && b.manualRuleId && a.manualRuleId === b.manualRuleId) return true;
      return String(a.name || "") === String(b.name || "");
    }
    for (const item of extra || []) {
      const dup = out.some((it) => sameRule(it, item) && overlap(it, item));
      if (!dup) out.push(item);
    }
    return out;
  }

  async function enrichInventory(query, inventory) {
    if (!isEnabled()) return inventory;
    const inv = inventory && typeof inventory === "object" ? inventory : { items: [] };
    try {
      const tokens = await tokenize(query);
      const extra = buildInventoryItems(query, tokens, RulesService.getAll());
      inv.items = mergeItems(inv.items, extra);
    } catch (err) {
      console.warn("[kiwi] enrich skipped", err);
    }
    return inv;
  }

  function warmup() {
    if (!isEnabled()) return Promise.resolve();
    return ensureReady().catch((err) => {
      console.warn("[kiwi] warmup failed", err);
    });
  }

  return {
    isEnabled,
    getStatus,
    onStatus,
    ensureReady,
    warmup,
    tokenize,
    cachedTokens,
    tokenSurfaceRange,
    analyzeHits,
    hintsForSpan,
    hintsForTokensInSpan,
    ruleMatchesHint,
    findRulesForHint,
    buildInventoryItems,
    mergeItems,
    enrichInventory,
  };
})();
