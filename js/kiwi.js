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

  function hasBatchim(ch) {
    const c = String(ch || "").charCodeAt(0);
    if (c < 0xac00 || c > 0xd7a3) return false;
    return (c - 0xac00) % 28 !== 0;
  }

  /** 副詞／時間處所＋은/는 常被切成一個詞（더는、다시는、이제는） */
  const TOPIC_FUSION_HOSTS = new Set([
    "더",
    "다시",
    "이제",
    "지금",
    "아직",
    "절대",
    "항상",
    "언제나",
    "조금",
    "모두",
    "가끔",
    "늘",
    "자주",
    "전혀",
    "별로",
    "아무",
    "오늘",
    "내일",
    "어제",
    "이번",
    "다음",
    "처음",
    "나중",
    "평소",
    "원래",
    "사실",
    "보통",
    "일단",
    "우선",
    "먼저",
    "특히",
    "정말",
    "진짜",
    "그냥",
    "역시",
    "오히려",
    "어차피",
    "분명히",
    "매일",
    "방금",
    "금방",
    "당장",
    "곧",
    "이미",
    "앞",
    "뒤",
    "후",
    "전",
    "안",
    "밖",
    "속",
    "위",
    "아래",
    "옆",
    "여기",
    "거기",
    "저기",
    "혼자",
    "함께",
    "따로",
    "계속",
    "누구",
    "무엇",
    "어디",
    "언제",
  ]);

  function topicParticleForHost(host) {
    const last = String(host || "").slice(-1);
    return hasBatchim(last) ? "은" : "는";
  }

  function fusedTopicFromForm(form) {
    const f = canonForm(form);
    if (f.length < 2) return null;
    const particle = f.slice(-1);
    if (particle !== "는" && particle !== "은") return null;
    const host = f.slice(0, -1);
    if (!TOPIC_FUSION_HOSTS.has(host)) return null;
    if (topicParticleForHost(host) !== particle) return null;
    return { host, particle, surface: f };
  }

  function fusedTopicSurfaces() {
    return [...TOPIC_FUSION_HOSTS].map((host) => {
      const particle = topicParticleForHost(host);
      return { host, particle, surface: host + particle };
    });
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
    const url = assetUrl("js/kiwi-worker.js?v=koparse1");
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
    const visStart = Number(tok?.start);
    const visEnd = Number(tok?.end);
    if (Number.isFinite(visStart) && Number.isFinite(visEnd) && visEnd > visStart) {
      return { start: visStart, end: visEnd };
    }
    const start = Number(tok?.position ?? tok?.kiwiPosition) || 0;
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
        } else if (form === "던" && isPred(prevTag)) {
          pushUnique(
            hits,
            makeHit("etm-deon", src, tok, {
              reason: "過去回想冠形 -던（ETM）",
              score: 38,
              prevTag,
              prevForm,
            })
          );
        } else if ((form === "ㄴ" || form === "은") && isPred(prevTag)) {
          const viaCopula = baseTag(prevTag) === "VCP";
          pushUnique(
            hits,
            makeHit("etm-n-eun", src, tok, {
              reason: viaCopula
                ? "指定詞冠形 -ㄴ/은（VCP＋ETM，인）"
                : isAdjish(prevTag)
                  ? "形容詞冠形 -ㄴ/은（ETM，含받침）"
                  : "動詞過去冠形 -ㄴ/은（ETM，含받침）",
              score: 38,
              prevTag,
              prevForm,
            })
          );
        } else if ((form === "ㄹ" || form === "을") && isPred(prevTag)) {
          const n2Form = toks[i + 2] ? canonForm(toks[i + 2].str) : "";
          if (nextForm === "수" && /^없/.test(n2Form)) {
            const start = tokenSurfaceRange(src, tok).start;
            const end = tokenSurfaceRange(src, toks[i + 2]).end;
            pushUnique(
              hits,
              makeHit("eul-su-eob", src, tok, {
                start,
                end,
                text: src.slice(start, end),
                reason: "不可能 -ㄹ 수 없다",
                score: 38,
                prevTag,
                prevForm,
              })
            );
          } else if (nextForm === "수" && /^있/.test(n2Form)) {
            const start = tokenSurfaceRange(src, tok).start;
            const end = tokenSurfaceRange(src, toks[i + 2]).end;
            pushUnique(
              hits,
              makeHit("eul-su-it", src, tok, {
                start,
                end,
                text: src.slice(start, end),
                reason: "可能 -ㄹ 수 있다",
                score: 38,
                prevTag,
                prevForm,
              })
            );
          } else if (
            (nextForm === "거" || nextForm === "것") &&
            /^(야|예요|에요|이다|입니다|이야)$/.test(n2Form)
          ) {
            const start = tokenSurfaceRange(src, tok).start;
            const end = tokenSurfaceRange(src, toks[i + 2]).end;
            pushUnique(
              hits,
              makeHit("eul-geoya", src, tok, {
                start,
                end,
                text: src.slice(start, end),
                reason: "將會／打算 -ㄹ 거야",
                score: 38,
                prevTag,
                prevForm,
              })
            );
          } else {
            pushUnique(
              hits,
              makeHit("etm-l-eul", src, tok, {
                reason: "未來／冠形 -(으)ㄹ（ETM，含받침）",
                score: 36,
                prevTag,
                prevForm,
              })
            );
          }
        }
      }

      if (bt === "JX" && form === "만") {
        pushUnique(
          hits,
          makeHit("jx-man", src, tok, { reason: "限定助詞 만（JX）", score: 34, prevTag, prevForm })
        );
      }

      if ((bt === "MAG" || bt === "MAJ") && form === "안") {
        pushUnique(
          hits,
          makeHit("neg-an", src, tok, { reason: "簡略否定 안（MAG）", score: 34, prevTag, prevForm })
        );
      }

      if (bt === "JX" && (form === "은" || form === "는" || form === "ㄴ")) {
        const host = tokenSurfaceRange(src, prev || tok);
        const self = tokenSurfaceRange(src, tok);
        const fused = src.slice(host.start, self.end);
        if (fused === "난" && (prevForm === "나" || form === "ㄴ")) {
          pushUnique(hits, makeHit("contr-nan", src, tok, { start: host.start, end: self.end, text: "난", reason: "나＋는→난", score: 40 }));
        } else if (fused === "넌" && (prevForm === "너" || form === "ㄴ")) {
          pushUnique(hits, makeHit("contr-neon", src, tok, { start: host.start, end: self.end, text: "넌", reason: "너＋는→넌", score: 40 }));
        } else if (fused === "전" && (prevForm === "저" || form === "ㄴ")) {
          pushUnique(hits, makeHit("contr-jeon", src, tok, { start: host.start, end: self.end, text: "전", reason: "저＋는→전", score: 40 }));
        } else if (form === "은" || form === "는") {
          pushUnique(
            hits,
            makeHit("jx-topic", src, tok, { reason: "主題助詞 은/는（JX）", score: 34, prevTag, prevForm })
          );
        }
      }

      const fusedTopic = fusedTopicFromForm(form);
      if (fusedTopic && bt !== "JX" && bt !== "ETM") {
        const self = tokenSurfaceRange(src, tok);
        if (self.end > self.start) {
          pushUnique(
            hits,
            makeHit("jx-topic", src, tok, {
              start: self.end - fusedTopic.particle.length,
              end: self.end,
              text: fusedTopic.particle,
              reason: `${fusedTopic.host}＋${fusedTopic.particle}（融合主題）`,
              score: 36,
              prevTag,
              prevForm,
            })
          );
        }
      }

      // 더/MAG＋는/ETM：Kiwi 常把副詞主題切成「冠形 는」，仍應掛主題
      if ((form === "는" || form === "은") && bt !== "JX") {
        const fusedSplit = fusedTopicFromForm(prevForm + form);
        if (fusedSplit) {
          const self = tokenSurfaceRange(src, tok);
          if (self.end > self.start) {
            pushUnique(
              hits,
              makeHit("jx-topic", src, tok, {
                start: self.start,
                end: self.end,
                text: form,
                reason: `${fusedSplit.host}＋${fusedSplit.particle}（分詞融合主題）`,
                score: 36,
                prevTag,
                prevForm,
              })
            );
          }
        }
      }

      // 움직임은 整詞 NNG：詞尾 은/는 仍是主題（非冠形）
      if (!fusedTopic && (bt === "NNG" || bt === "NNP" || bt === "NP" || bt === "NNB")) {
        const particle = form.slice(-1);
        if ((particle === "는" || particle === "은") && form.length >= 2) {
          const host = form.slice(0, -1);
          if (topicParticleForHost(host) === particle) {
            const self = tokenSurfaceRange(src, tok);
            if (self.end > self.start) {
              pushUnique(
                hits,
                makeHit("jx-topic", src, tok, {
                  start: self.end - particle.length,
                  end: self.end,
                  text: particle,
                  reason: `${host}＋${particle}（詞尾主題）`,
                  score: 34,
                  prevTag,
                  prevForm,
                })
              );
            }
          }
        }
      }

      if (bt === "JKG" && form === "의") {
        pushUnique(hits, makeHit("jkg-ui", src, tok, { reason: "所有格 의（JKG）", score: 34 }));
      }
      if ((form === "내" || form === "네" || form === "제") && nextForm !== "가") {
        const self = tokenSurfaceRange(src, tok);
        pushUnique(
          hits,
          makeHit("jkg-ui", src, tok, {
            start: self.start,
            end: self.end,
            text: form,
            reason: form === "내" ? "나＋의→내" : form === "네" ? "너＋의→네" : "저＋의→제",
            score: 36,
          })
        );
      }

      if (bt === "JKO" && (form === "을" || form === "를" || form === "ㄹ")) {
        const host = tokenSurfaceRange(src, prev || tok);
        const self = tokenSurfaceRange(src, tok);
        const fused = src.slice(host.start, self.end);
        if (fused === "날" && (prevForm === "나" || form === "ㄹ")) {
          pushUnique(hits, makeHit("contr-nal", src, tok, { start: host.start, end: self.end, text: "날", reason: "나＋를→날", score: 40 }));
        } else if (fused === "널" && (prevForm === "너" || form === "ㄹ")) {
          pushUnique(hits, makeHit("contr-neol", src, tok, { start: host.start, end: self.end, text: "널", reason: "너＋를→널", score: 40 }));
        } else if (fused === "절" && (prevForm === "저" || form === "ㄹ")) {
          pushUnique(hits, makeHit("contr-jeol", src, tok, { start: host.start, end: self.end, text: "절", reason: "저＋를→절", score: 40 }));
        } else if (form === "을" || form === "를" || form === "ㄹ") {
          pushUnique(
            hits,
            makeHit("jko-object", src, tok, {
              start: form === "ㄹ" ? host.start : self.start,
              end: self.end,
              text: form === "ㄹ" ? fused || src.slice(host.start, self.end) : form,
              reason: form === "ㄹ" ? "賓格 을/를（JKO，ㄹ받침）" : "賓格 을/를（JKO）",
              score: 34,
            })
          );
        }
      }

      if ((bt === "JKS" || bt === "JKC") && (form === "이" || form === "가")) {
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
          pushUnique(
            hits,
            makeHit("jks-subject", src, tok, {
              reason: bt === "JKC" ? "主格／補格 이/가（JKC）" : "主格 이/가（JKS）",
              score: 34,
            })
          );
        }
      }

      if (bt === "EC" && /^(어|아|여)$/.test(form)) {
        pushUnique(hits, makeHit("ef-haeche", src, tok, { reason: "平語 해체（EC 아/어）", score: 26 }));
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
        if (form === "게") {
          const hostForm = prevForm;
          if (hostForm !== "이" && hostForm !== "그" && hostForm !== "저") {
            pushUnique(hits, makeHit("ec-ge", src, tok, { reason: "副詞化 -게（EC）", score: 34 }));
          }
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
      // 只認已縮約表面 돼／됐。되＋어＝未縮約「되어」，不是這張卡。
      if (
        form === "돼" ||
        form === "됐" ||
        /^(돼|됐)/.test(form) ||
        (prevForm === "되" && /^(돼|됐)/.test(form))
      ) {
        const span = tokenSurfaceRange(src, tok);
        const surf = src.slice(
          prevForm === "되" ? tokenSurfaceRange(src, prev).start : span.start,
          span.end
        );
        if (/돼|됐/.test(surf)) {
          pushUnique(hits, makeHit("vowel-dwae", src, tok, { reason: "母音縮約 되＋어→돼", score: 30 }));
        }
      }

      // 不規則：比原形詞幹與該語素表面；沒脫落就不標。不靠 -I。
      // 르 불규칙：라／러 常在下一個語素（몰+라요），詞幹語素表面可能只有 몰／빨。
      if (isPred(tag) && bt !== "VCP" && typeof StemDrop !== "undefined") {
        const span = tokenSurfaceRange(src, tok);
        if (span.end > span.start) {
          const tokenSurf = src.slice(span.start, span.end);
          let wideEnd = span.end;
          if (next) {
            const ns = tokenSurfaceRange(src, next);
            if (ns.end > wideEnd) wideEnd = ns.end;
          } else if (span.end < src.length && isHangulSyllable(src[span.end])) {
            wideEnd += 1;
          }
          const wideSurf = src.slice(span.start, wideEnd);
          let drop = StemDrop.classifyStemDrop(form, tokenSurf);
          if (!drop && wideSurf !== tokenSurf) {
            drop = StemDrop.classifyStemDrop(form, wideSurf);
          }
          // 하다→해 是母音縮約，不是 ㅎ 불규칙（ㅎ 받침脫落）
          if (drop && drop.kind === "ㅎ" && /하$/.test(String(drop.lemma || form || ""))) {
            drop = null;
          }
          const hintKind = drop && StemDrop.KIND_TO_HINT[drop.kind];
          if (hintKind) {
            let hitStart = span.start;
            let hitEnd = span.end;
            if (drop.kind === "르" && typeof StemDrop.extendReuHitRange === "function") {
              const ext = StemDrop.extendReuHitRange(src, span.start, wideEnd);
              hitStart = ext.start;
              hitEnd = ext.end;
            }
            pushUnique(
              hits,
              makeHit(hintKind, src, tok, {
                start: hitStart,
                end: hitEnd,
                text: srcSlice(src, hitStart, hitEnd),
                reason: StemDrop.formatReason(drop),
                score: 34,
              })
            );
          }
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
    "etm-n-eun": (blob, title) => {
      const t = String(title || "");
      // 形容詞現在冠形 -ㄴ/은，不能只因說明提到「冠形」就命中
      // 過去冠形卡或詞彙卡（如 不同的（다른））。
      const hasMarker = /ㄴ\s*[\/／]\s*은|-ㄴ\/은|[（(]\s*-?ㄴ\s*[\/／]\s*은\s*[）)]/.test(t);
      return hasMarker && /冠形|관형|定語/.test(blob) && !/過去|과거|past/i.test(blob);
    },
    "etm-deon": (blob, title) => /던/.test(String(title || "") + blob) && /冠形|관형|回想|회상|語尾/.test(blob),
    "etm-l-eul": (blob, title) => {
      const t = String(title || "");
      const b = String(blob || "");
      if (/ㄹ\s*탈락|ㄹ\s*脫落/.test(t) || /만하/.test(t)) return false;
      if (/거야|거예요|거다|것이다/.test(t + b)) return false;
      if (/수\s*없|수\s*있|不可能/.test(t + b) && !/未來推測|未來冠形|推測冠形/.test(t)) return false;
      if (/未來推測|未來冠形|推測冠形/.test(b) && !/거야|수\s*없|수\s*있/.test(t)) return true;
      if (
        /\(으\)ㄹ|-을\s*\/\s*ㄹ|-을\/ㄹ/.test(t) &&
        /未來|推測|冠形|관형|定語/.test(b) &&
        !/거야|수\s*없/.test(t)
      ) {
        return true;
      }
      return /未來|推測/.test(t) && /\(으\)ㄹ|을\s*\/\s*ㄹ|-ㄹ/.test(t) && !/거야|수\s*없/.test(t);
    },
    "eul-geoya": (blob, title) => /거야|거예요|거다|것이다/.test(String(title || "") + blob),
    "eul-su-eob": (blob) => /수\s*없|不可能/.test(blob),
    "eul-su-it": (blob, title) => /수\s*있/.test(blob) && !/수\s*없|不可能/.test(String(title || "") + blob),
    "jx-topic": (blob, title) => {
      const t = String(title || "");
      if (/縮約/.test(t) || /冠形詞形|冠形語尾/.test(t)) return false;
      if (!/主題|話題/.test(t)) return false;
      return /은\s*\/\s*는|은\/는/.test(t) || /[（(]\s*-?[은는]\s*[）)]/.test(t);
    },
    "neg-an": (blob, title) =>
      /[（(]\s*안\s*[）)]/.test(title) && /簡略|短形|부사|否定/.test(blob) && !/지\s*않|못/.test(title),
    "jx-man": (blob, title) =>
      /만/.test(title) && /限定|한정|只有|助詞|조사/.test(blob) && !/만하/.test(blob + title),
    "jks-subject": (blob, title) =>
      /主格/.test(title) && /이\s*\/\s*가|이\/가/.test(title) && !/듯이|比喻/.test(title),
    "jko-object": (blob) => /賓格/.test(blob) && /을\s*\/\s*를|을\/를/.test(blob),
    "jkg-ui": (blob, title) =>
      /（의）|\(의\)/.test(title) && /所有格|定語助詞|所有格助詞|屬格|冠形格|관형격/.test(blob) && !/冠形詞形/.test(blob),
    "jkb-e": (blob, title) => /時間地點|處所/.test(blob) && /（에）|\(에\)|^時間地點（에）/.test(title + blob) && !/에서/.test(title),
    "jkb-eseo": (blob) => /에서/.test(blob) && /處所|來源|에서/.test(blob),
    "ef-haeyo": (blob) => /禮貌體|해요體|아\s*\/\s*어요/.test(blob) && !/합니다|습니다/.test(blob),
    "ef-haeche": (blob) => /平語|해체|반말/.test(blob) && !/해요|합니다/.test(blob),
    "ef-hamnida": (blob) => /正式體|합니다|습니다|합쇼/.test(blob),
    "ep-past": (blob) => /過去/.test(blob) && /았|었/.test(blob),
    "ep-si": (blob) => /主體敬語|尊待|-시-/.test(blob) || /（-시-）/.test(blob),
    "ec-ge": (blob, title) =>
      /副詞化|부사화|副詞形/.test(blob) && /게/.test(title + blob) && !/에게/.test(title),
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
    "irr-s": (blob) => /ㅅ\s*不規則|ㅅ\s*불규칙/.test(blob),
    "irr-reu": (blob) => /르\s*不規則|르\s*불규칙/.test(blob),
    "irr-h": (blob) => /ㅎ\s*不規則|ㅎ\s*불규칙/.test(blob),
    "l-del": (blob) => /ㄹ\s*탈락|ㄹ\s*脫落|ㄹ\s*不規則|ㄹ\s*불규칙/.test(blob) && !/르\s*不規則|르\s*불규칙/.test(blob),
    "eu-del": (blob) => /ㅡ\s*탈락|ㅡ\s*脫落|으\s*탈락|으\s*脫落/.test(blob),
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
    "etm-l-eul": "seed-adnominal-eul",
    "etm-deon": "",
    "eul-geoya": "",
    "eul-su-eob": "",
    "eul-su-it": "",
    "jx-topic": "seed-topic",
    "jks-subject": "seed-subject",
    "jko-object": "seed-object",
    "jkg-ui": "seed-ui",
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
    "irr-s": "seed-s-irregular",
    "irr-reu": "seed-reu-irregular",
    "irr-h": "seed-h-irregular",
    "l-del": "seed-l-deletion",
    "eu-del": "seed-eu-deletion",
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
    return (rules || []).filter((r) => {
      if (
        typeof RulesService !== "undefined" &&
        typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(r)
      ) {
        return false;
      }
      return ruleMatchesHint(r, hint);
    });
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
        if (typeof AffixGate !== "undefined" && AffixGate.accept) {
          const loc = {
            start: hit.start,
            end: hit.end > hit.start ? hit.end : hit.start + Math.max(1, span.length),
            text: span,
          };
          const profile = AffixGate.inferProfile(rule, { span, name: rule.title });
          if (
            profile &&
            !AffixGate.accept(src, loc, profile, { tokens, item: { span, name: rule.title } })
          ) {
            continue;
          }
        }
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

  function enrichInventoryFromTokens(query, inventory, tokens, opts = {}) {
    const inv = inventory && typeof inventory === "object" ? inventory : { items: [] };
    if (
      (!Array.isArray(inv.tokens) || !inv.tokens.length) &&
      typeof KoParse !== "undefined" &&
      KoParse.fromKiwi
    ) {
      inv.tokens = KoParse.slimTokens(KoParse.fromKiwi(query, tokens));
    }
    // Kiwi 本身可繼續提供切詞／hover；只有文法掃描模式開啟時才可掛規則卡。
    if (opts.includeGrammar !== false) {
      const extra = buildInventoryItems(query, tokens, RulesService.getAll());
      inv.items = mergeItems(inv.items, extra);
    }
    return inv;
  }

  async function enrichInventory(query, inventory, opts = {}) {
    if (!isEnabled()) return inventory;
    try {
      const tokens = await tokenize(query);
      return enrichInventoryFromTokens(query, inventory, tokens, opts);
    } catch (err) {
      console.warn("[kiwi] enrich skipped", err);
    }
    return inventory;
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
    fusedTopicFromForm,
    fusedTopicSurfaces,
    seedIdForKind: (kind) => SEED_KIND[String(kind || "")] || "",
    findRulesForHint,
    buildInventoryItems,
    mergeItems,
    enrichInventoryFromTokens,
    enrichInventory,
  };
})();
