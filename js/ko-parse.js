/**
 * 韓語形態素後處理（對齊日語 SchoolParse + Mirinae Explorer）
 * Kiwi 負責切語素；這裡還原區間、決定性文法候選、對卡、詞彙、句層。
 */
const KoParse = (() => {
  const CONTENT_POS = new Set(["名詞", "代詞", "數詞", "動詞", "形容詞", "副詞", "冠形詞"]);
  const SKIP_HOVER_POS = new Set(["記號", "改行"]);

  const POS_FROM_TAG = {
    NNG: "名詞",
    NNP: "名詞",
    NNB: "名詞",
    NR: "數詞",
    NP: "代詞",
    VV: "動詞",
    VX: "動詞",
    XSV: "動詞",
    VA: "形容詞",
    XSA: "形容詞",
    VCN: "形容詞",
    VCP: "指定詞",
    MAG: "副詞",
    MAJ: "副詞",
    MM: "冠形詞",
    IC: "感嘆詞",
    JKS: "助詞",
    JKO: "助詞",
    JKB: "助詞",
    JKG: "助詞",
    JKV: "助詞",
    JC: "助詞",
    JX: "助詞",
    EP: "語尾",
    EF: "語尾",
    EC: "語尾",
    ETN: "語尾",
    ETM: "語尾",
    XPN: "接辭",
    XSN: "接辭",
    SF: "記號",
    SP: "記號",
    SS: "記號",
    SE: "記號",
    SO: "記號",
    SW: "記號",
    SH: "外語",
    SL: "外語",
    SN: "數詞",
  };

  const KIND_META = {
    "etm-neun": { name: "冠形詞形（-는）", category: "語尾" },
    "etm-n-eun": { name: "冠形詞形（-ㄴ/은）", category: "語尾" },
    "etm-l-eul": { name: "未來推測（-(으)ㄹ）", category: "語尾" },
    "etm-deon": { name: "過去回想冠形詞形語尾（-던）", category: "語尾" },
    "eul-geoya": { name: "將會／打算（-(으)ㄹ 거야）", category: "句型" },
    "eul-su-eob": { name: "不可能（-ㄹ 수 없다）", category: "句型" },
    "eul-su-it": { name: "可能（-ㄹ 수 있다）", category: "句型" },
    "jx-topic": { name: "主題（은/는）", category: "助詞", note: "JX 은/는 即主題／對比，與冠形 ETM 는 不同" },
    "jx-man": { name: "限定（만）", category: "助詞" },
    "neg-an": { name: "簡略否定（안）", category: "句型" },
    "jks-subject": { name: "主格（이/가）", category: "助詞", disamb: true, note: "이/가：主格／補語待消歧" },
    "jko-object": { name: "賓格（을/를）", category: "助詞" },
    "jkg-ui": { name: "所有格（의）", category: "助詞" },
    "jkb-e": { name: "時間地點（에）", category: "助詞", disamb: true, note: "에：時間／地點／對象待消歧" },
    "jkb-eseo": { name: "處所來源（에서）", category: "助詞" },
    "ef-haeyo": { name: "禮貌體（-아/어요）", category: "語尾" },
    "ef-haeche": { name: "平語（해체）", category: "語尾" },
    "ef-hamnida": { name: "正式體（-습니다）", category: "語尾" },
    "ep-past": { name: "過去（-았/었-）", category: "時態" },
    "ep-si": { name: "主體敬語（-시-）", category: "敬語" },
    "ec-ge": { name: "副詞化（-게）", category: "語尾" },
    "ec-go": { name: "並列連接（-고）", category: "連接", disamb: true, note: "고：並列／順序待消歧" },
    "ec-aseo": { name: "原因連接（-아/어서）", category: "連接" },
    "ec-nde-v": { name: "背景對比（-는데）", category: "連接" },
    "ec-nde-a": { name: "背景對比（-ㄴ/은데）", category: "連接" },
    "ec-nde-n": { name: "背景對比（-ㄴ데/인데）", category: "連接" },
    "vcp-ieyo": { name: "指定（이에요/예요）", category: "語尾" },
    "neg-ji": { name: "否定（-지 않다）", category: "句型" },
    "prog-goitda": { name: "進行（-고 있다）", category: "句型" },
    "want-gosip": { name: "希望（-고 싶다）", category: "句型" },
    "ajud": { name: "請托（-아/어 줘）", category: "句型" },
    "manhada": { name: "值得（-ㄹ 만하다）", category: "句型" },
    "vowel-hae": { name: "母音縮約（하＋여→해）", category: "其他" },
    "vowel-yeo": { name: "母音縮約（이＋어→여）", category: "其他" },
    "vowel-dwae": { name: "母音縮約（되＋어→돼）", category: "其他" },
    "irr-b": { name: "ㅂ 不規則（ㅂ 불규칙）", category: "不規則" },
    "irr-d": { name: "ㄷ 不規則（ㄷ 불규칙）", category: "不規則" },
    "irr-s": { name: "ㅅ 不規則（ㅅ 불규칙）", category: "不規則" },
    "irr-reu": { name: "르 不規則（르 불규칙）", category: "不規則" },
    "irr-h": { name: "ㅎ 不規則（ㅎ 불규칙）", category: "不規則" },
    "l-del": { name: "ㄹ 脫落（ㄹ 탈락）", category: "不規則" },
    "eu-del": { name: "ㅡ 脫落（ㅡ 탈락）", category: "不規則" },
    "contr-nan": { name: "人稱主題縮約（난）", category: "助詞" },
    "contr-neon": { name: "人稱主題縮約（넌）", category: "助詞" },
    "contr-jeon": { name: "人稱主題縮約（전）", category: "助詞" },
    "contr-nal": { name: "人稱賓格縮約（날）", category: "助詞" },
    "contr-neol": { name: "人稱賓格縮約（널）", category: "助詞" },
    "contr-jeol": { name: "人稱賓格縮約（절）", category: "助詞" },
    deusi: { name: "比喻（듯이）", category: "其他" },
  };

  /** Kiwi 詞性已確定的助詞：API 否決也要保留（더는 的 는 常被誤否決） */
  const API_CANNOT_VETO = new Set([
    "jx-topic",
    "jko-object",
    "jkg-ui",
    "jx-man",
    "jkb-eseo",
    "contr-nan",
    "contr-neon",
    "contr-jeon",
    "contr-nal",
    "contr-neol",
    "contr-jeol",
  ]);

  const HOST_KINDS = new Set([
    "vowel-hae",
    "vowel-yeo",
    "vowel-dwae",
    "irr-b",
    "irr-d",
    "irr-s",
    "irr-reu",
    "irr-h",
    "l-del",
    "eu-del",
    "contr-nan",
    "contr-neon",
    "contr-jeon",
    "contr-nal",
    "contr-neol",
    "contr-jeol",
  ]);

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

  function kiwiPos(tag) {
    const t = baseTag(tag);
    if (POS_FROM_TAG[t]) return POS_FROM_TAG[t];
    if (/^W_/.test(t)) return "記號";
    if (/^J/.test(t)) return "助詞";
    if (/^E/.test(t)) return "語尾";
    if (/^N/.test(t)) return "名詞";
    return "其他";
  }

  function lemmaFromKiwi(form, tag) {
    const f = String(form || "").trim();
    const t = baseTag(tag);
    if (["VV", "VA", "VX", "XSV", "XSA", "VCN"].includes(t)) {
      if (!f) return "";
      return /다$/.test(f) ? f : `${f}다`;
    }
    if (t === "VCP") return "이다";
    return f;
  }

  function splitRuleName(name) {
    let s = String(name || "").trim();
    if (typeof RulesService !== "undefined" && typeof RulesService.canonicalInventoryName === "function") {
      s = RulesService.canonicalInventoryName(s) || s;
    } else {
      const m0 = s.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
      if (m0) s = `${m0[1].trim()}（${m0[2].trim()}）`;
    }
    const m = s.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/);
    if (m) {
      const zh = m[1].trim();
      const ko = m[2].trim();
      return { name: `${zh}（${ko}）`, nameZh: zh, nameKo: ko };
    }
    return { name: s, nameZh: s, nameKo: "" };
  }

  /**
   * Kiwi 語素 → 帶原文區間的分析 token。
   * length=0（받침語尾）視覺區間落在宿主音節上，form 仍是語素本身（ㄴ／ㄹ／ㅆ）。
   */
  function fromKiwi(source, kiwiTokens) {
    const src = String(source ?? "").normalize("NFC");
    const raw = Array.isArray(kiwiTokens) ? kiwiTokens : [];
    const out = [];
    for (const kt of raw) {
      if (!kt) continue;
      const form = canonForm(kt.str ?? kt.form ?? "");
      const tag = String(kt.tag || "");
      const kiwiPosition = Number(kt.position) || 0;
      const kiwiLength = Number(kt.length) || 0;
      let start = kiwiPosition;
      let end = kiwiPosition + kiwiLength;
      let word = kiwiLength > 0 ? src.slice(start, Math.min(src.length, end)) : form;
      let zeroWidth = kiwiLength === 0;
      if (zeroWidth) {
        if (kiwiPosition > 0 && isHangulSyllable(src[kiwiPosition - 1])) {
          start = kiwiPosition - 1;
          end = kiwiPosition;
          word = src.slice(start, end);
        } else if (kiwiPosition < src.length && isHangulSyllable(src[kiwiPosition])) {
          start = kiwiPosition;
          end = kiwiPosition + 1;
          word = src.slice(start, end);
        } else {
          start = kiwiPosition;
          end = kiwiPosition;
          word = form;
        }
      }
      if (!form && !word) continue;
      out.push({
        word: word || form,
        form: form || word,
        pos: kiwiPos(tag),
        tag,
        lemma: lemmaFromKiwi(form, tag),
        start,
        end,
        length: kiwiLength,
        zeroWidth,
        kiwiPosition,
        wordPosition: Number.isFinite(Number(kt.wordPosition)) ? Number(kt.wordPosition) : null,
        score: Number(kt.score) || 0,
      });
    }
    return out;
  }

  function toKiwiShape(t) {
    return {
      str: t.form || t.word || t.str || "",
      tag: t.tag || "",
      position: Number.isFinite(t.kiwiPosition) ? t.kiwiPosition : Number(t.position) || 0,
      length: Number.isFinite(t.length) ? t.length : Number(t.kiwiLength) || 0,
      wordPosition: t.wordPosition,
      score: t.score,
    };
  }

  function rangesOverlap(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
  }

  function visualEnd(t) {
    if (!t) return 0;
    if (Number.isFinite(t.end) && t.end > t.start) return t.end;
    return (Number(t.start) || 0) + 1;
  }

  function tokenIndexForHit(tokens, hit) {
    const form = canonForm(hit.form);
    const tag = baseTag(hit.tag);
    const hs = Number(hit.start);
    const he = Number.isFinite(Number(hit.end)) && Number(hit.end) > hs ? Number(hit.end) : hs + 1;
    let formOverlap = -1;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const te = visualEnd(t);
      const overlap =
        rangesOverlap(t.start, te, hs, he) ||
        (Number.isFinite(t.kiwiPosition) && t.kiwiPosition >= hs && t.kiwiPosition <= he);
      const sameForm = form && canonForm(t.form) === form;
      const sameTag = tag && baseTag(t.tag) === tag;
      if (sameForm && sameTag && overlap) return i;
      if (sameForm && overlap && formOverlap < 0) formOverlap = i;
    }
    return formOverlap;
  }

  function tokenRangeForHit(tokens, hit) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return null;
    const hs = Number(hit.start);
    const he = Number.isFinite(Number(hit.end)) && Number(hit.end) > hs ? Number(hit.end) : hs + 1;
    const overlapping = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const te = visualEnd(t);
      if (rangesOverlap(t.start, te, hs, he)) overlapping.push(i);
      else if (t.zeroWidth && Number.isFinite(t.kiwiPosition) && t.kiwiPosition >= hs && t.kiwiPosition <= he) {
        overlapping.push(i);
      }
    }
    const single = tokenIndexForHit(list, hit);
    if (overlapping.length >= 2 && he - hs > 1) {
      return { from: overlapping[0], to: overlapping[overlapping.length - 1] };
    }
    if (single >= 0) return { from: single, to: single };
    if (overlapping.length) return { from: overlapping[0], to: overlapping[overlapping.length - 1] };
    return null;
  }

  function localTitleForKind(kind) {
    const meta = KIND_META[kind];
    if (!meta) return "";
    try {
      if (typeof KiwiService !== "undefined" && KiwiService.findRulesForHint && typeof RulesService !== "undefined") {
        const dummy = { kind };
        const matched = KiwiService.findRulesForHint(dummy, RulesService.getAll());
        if (matched && matched[0] && matched[0].title) return matched[0].title;
      }
    } catch {
      /* ignore */
    }
    return meta.name;
  }

  function hitToFunction(tokens, hit) {
    if (!hit || !hit.kind) return null;
    const meta = KIND_META[hit.kind] || { name: hit.reason || hit.kind, category: "其他" };
    const range = tokenRangeForHit(tokens, hit);
    if (!range) return null;
    const name = localTitleForKind(hit.kind) || meta.name;
    return {
      name,
      tokenFrom: range.from,
      tokenTo: range.to,
      note: hit.reason || meta.note || "",
      confidence: meta.disamb ? "medium" : "high",
      needsDisambiguation: Boolean(meta.disamb),
      category: meta.category || "",
      kiwiKind: hit.kind,
      grammarKey: `kiwi:${hit.kind}`,
    };
  }

  function candidateDecisionId(candidate) {
    if (!candidate) return "";
    const kind = String(candidate.kiwiKind || candidate.kind || "candidate").trim() || "candidate";
    const from = Number(candidate.tokenFrom ?? candidate.from);
    const to = Number(candidate.tokenTo ?? candidate.to ?? from);
    if (!Number.isFinite(from)) return "";
    return `${kind}:${from}:${Number.isFinite(to) ? to : from}`;
  }

  function deterministicFunctions(src, tokens, opts = {}) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return [];
    const kiwiToks = list.map(toKiwiShape);
    const hits = Array.isArray(opts.hits)
      ? opts.hits
      : typeof KiwiService !== "undefined" && typeof KiwiService.analyzeHits === "function"
        ? KiwiService.analyzeHits(String(src || ""), kiwiToks)
        : [];
    const out = [];
    const seen = new Set();
    for (const hit of hits || []) {
      const fn = hitToFunction(list, hit);
      if (!fn) continue;
      const key = `${fn.kiwiKind}:${fn.tokenFrom}:${fn.tokenTo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fn);
    }
    return out;
  }

  function compactTokenLines(tokens) {
    return (tokens || [])
      .map((t, i) => {
        const bits = [`${i}`, (t.form || t.word || "").replace(/\n/g, "\\n"), t.pos || "", t.tag || ""];
        if (t.lemma && t.lemma !== t.form) bits.push(`原=${t.lemma}`);
        if (t.zeroWidth) bits.push("零寬");
        if (t.word && t.word !== t.form) bits.push(`面=${t.word}`);
        return bits.join(" ");
      })
      .join("\n");
  }

  function compactCandidateLines(cands) {
    return (cands || [])
      .map((c) => {
        const flag = c.needsDisambiguation ? "消歧" : "高信心";
        const id = candidateDecisionId(c);
        return `${id} ${c.tokenFrom}-${c.tokenTo} ${c.name} [${flag}]${c.note ? " " + c.note : ""}`;
      })
      .join("\n");
  }

  function grammarChecklist(tokens, candidates) {
    const list = [];
    const coveredMorphs = new Set();
    for (const c of candidates || []) {
      const id = candidateDecisionId(c);
      if (!id) continue;
      const from = Number(c.tokenFrom);
      const to = Number(c.tokenTo);
      list.push({
        id,
        type: "candidate",
        tokenFrom: from,
        tokenTo: to,
        label: c.name || c.kiwiKind || id,
      });
      if (Number.isFinite(from) && Number.isFinite(to)) {
        for (let i = from; i <= to; i++) coveredMorphs.add(i);
      }
    }
    (tokens || []).forEach((t, i) => {
      if (coveredMorphs.has(i)) return;
      if (t.pos !== "助詞" && t.pos !== "語尾") return;
      list.push({
        id: `morph:${i}`,
        type: "morph",
        tokenFrom: i,
        tokenTo: i,
        label: `${t.form || t.word || "?"}/${t.tag || t.pos}`,
      });
    });
    return list;
  }

  function compactChecklistLines(checklist) {
    return (checklist || [])
      .map((x) => `${x.id} ${x.tokenFrom}-${x.tokenTo} ${x.label}`)
      .join("\n");
  }

  function unresolvedGrammarChecklist(checklist, mapped) {
    const decisions = Array.isArray(mapped?.decisions) ? mapped.decisions : [];
    const decided = new Set(
      decisions
        .filter((d) => String(d?.status || "").toLowerCase() !== "unknown")
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    return (checklist || []).filter((target) => !decided.has(target.id));
  }

  function rangeOverlapsIdx(aFrom, aTo, bFrom, bTo) {
    return !(aTo < bFrom || aFrom > bTo);
  }

  function isHostLexemeGrammar(name, category, kiwiKind) {
    if (kiwiKind && HOST_KINDS.has(kiwiKind)) return true;
    const n = String(name || "");
    const c = String(category || "");
    if (c === "不規則") return true;
    return /不規則|탈락|脫落|母音縮約|人稱.*縮約/.test(n);
  }

  function markerNeedles(nameKo, name) {
    const names = splitRuleName(name || "");
    const raw = String(nameKo || names.nameKo || "").trim();
    return raw
      .split(/[／\/、,＋+]/)
      .map((s) =>
        s
          .trim()
          .replace(/^[-−–—〜～]+/, "")
          .replace(/[-−–—]+$/, "")
          .replace(/[()（）]/g, "")
      )
      .filter(Boolean)
      .filter((p) => !/^(으|시)$/.test(p) || p.length > 0)
      .sort((a, b) => b.length - a.length);
  }

  function narrowOffsets(src, start, end, needles, tokens, from, to) {
    const text = String(src || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (!needles.length) return null;
    const slice = text.slice(start, end);

    if (tokens && tokens.length && Number.isFinite(from) && Number.isFinite(to)) {
      const lo = Math.max(0, Math.min(from, to));
      const hi = Math.min(tokens.length - 1, Math.max(from, to));
      for (const needle of needles) {
        const nForm = canonForm(needle);
        for (let i = hi; i >= lo; i--) {
          const form = canonForm(tokens[i].form);
          const word = String(tokens[i].word || "");
          if (
            (form === nForm || word === needle || word.endsWith(needle)) &&
            Number.isFinite(tokens[i].start) &&
            Number.isFinite(tokens[i].end) &&
            tokens[i].end > tokens[i].start
          ) {
            return {
              start: tokens[i].start,
              end: tokens[i].end,
              tokenFrom: i,
              tokenTo: i,
              span: text.slice(tokens[i].start, tokens[i].end) || needle,
            };
          }
        }
      }
    }

    for (const needle of needles) {
      if (!needle || slice.length <= needle.length) continue;
      if (slice.endsWith(needle)) {
        return { start: end - needle.length, end, span: needle };
      }
      const idx = slice.lastIndexOf(needle);
      if (idx >= 0) {
        return { start: start + idx, end: start + idx + needle.length, span: needle };
      }
    }
    return null;
  }

  function narrowItemToMarker(src, item, tokens) {
    if (!item) return item;
    if (isHostLexemeGrammar(item.name, item.category, item.kiwiKind)) return item;
    const needles = markerNeedles(item.nameKo, item.name);
    if (!needles.length) return item;
    const start = Number(item.start);
    const end = Number(item.end);
    const from = Number(item.tokenFrom);
    const to = Number(item.tokenTo);
    const hit = narrowOffsets(src, start, end, needles, tokens, from, to);
    if (!hit) return item;
    if (hit.start === start && hit.end === end) return item;
    return {
      ...item,
      start: hit.start,
      end: hit.end,
      span: hit.span || String(src || "").slice(hit.start, hit.end),
      tokenFrom: Number.isFinite(hit.tokenFrom) ? hit.tokenFrom : item.tokenFrom,
      tokenTo: Number.isFinite(hit.tokenTo) ? hit.tokenTo : item.tokenTo,
    };
  }

  function functionToItem(tokens, fn, srcHint) {
    const n = tokens.length;
    if (!n) return null;
    let from = Number(fn.tokenFrom);
    let to = Number(fn.tokenTo);
    if (!Number.isFinite(from)) from = 0;
    if (!Number.isFinite(to)) to = from;
    from = Math.max(0, Math.min(n - 1, from));
    to = Math.max(0, Math.min(n - 1, to));
    if (to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const slice = tokens.slice(from, to + 1);
    const src = String(srcHint || "") || reconstructSrcFromTokens(tokens) || slice.map((t) => t.word).join("");
    const vis = slice.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start);
    const start = vis.length ? vis[0].start : slice[0].start;
    const end = vis.length ? vis[vis.length - 1].end : slice[slice.length - 1].end;
    const span = Number.isFinite(start) && Number.isFinite(end) && end > start ? src.slice(start, end) : slice.map((t) => t.form || t.word).join("");
    const names = splitRuleName(fn.name);
    if (!names.name) return null;
    const posHint = slice.find((t) => t.pos === "助詞" || t.pos === "語尾" || t.pos === "動詞")?.pos;
    const category = fn.category || guessCategory(names.name, posHint);
    const item = {
      name: names.name,
      nameZh: names.nameZh,
      nameKo: names.nameKo,
      category,
      span,
      start,
      end,
      note: String(fn.note || "").trim(),
      confidence: ["high", "medium", "low"].includes(fn.confidence) ? fn.confidence : "medium",
      tokenFrom: from,
      tokenTo: to,
    };
    if (fn.kiwiKind) item.kiwiKind = fn.kiwiKind;
    if (fn.grammarKey) item.grammarKey = String(fn.grammarKey);
    if (fn.candidateId) item.candidateId = String(fn.candidateId);
    return narrowItemToMarker(src, item, tokens);
  }

  function reconstructSrcFromTokens(tokens) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return "";
    const maxEnd = list.reduce((m, t) => Math.max(m, Number(t.end) || 0), 0);
    if (!maxEnd) return list.map((t) => t.word || "").join("");
    const chars = Array(maxEnd).fill("");
    for (const t of list) {
      if (!Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end <= t.start) continue;
      const w = String(t.word || "");
      for (let i = 0; i < t.end - t.start && i < w.length; i++) {
        if (!chars[t.start + i]) chars[t.start + i] = w[i];
      }
    }
    return chars.join("");
  }

  function guessCategory(name, posHint) {
    const n = String(name || "");
    if (/不規則|탈락|脫落/.test(n)) return "不規則";
    if (/過去|았|었/.test(n) && /時態|過去/.test(n)) return "時態";
    if (/敬語|-시-/.test(n)) return "敬語";
    if (/連接|는데|아서|고/.test(n) && /連接|並列|原因|背景/.test(n)) return "連接";
    if (/進行|否定|希望|請托|值得|句型/.test(n)) return "句型";
    if (/助詞|主題|主格|賓格|所有格|限定|縮約/.test(n) || posHint === "助詞") return "助詞";
    if (posHint === "語尾" || /語尾|禮貌|平語|正式|冠形|指定/.test(n)) return "語尾";
    return "其他";
  }

  function functionsToItems(tokens, aiFunctions, candidates, opts = {}) {
    const list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return [];
    const src = String(opts.src || "");
    const items = [];
    const ranges = [];

    function addFn(fn) {
      const item = functionToItem(list, fn, src);
      if (!item) return;
      const dup = items.some(
        (it) => it.name === item.name && it.start === item.start && it.end === item.end
      );
      if (dup) return;
      items.push(item);
      ranges.push({
        from: item.tokenFrom,
        to: item.tokenTo,
        name: item.name,
        kiwiKind: item.kiwiKind || "",
      });
    }

    for (const fn of Array.isArray(aiFunctions) ? aiFunctions : []) {
      // API 可能在正確語素區間選到錯誤卡名。若有「完全相同 token 區間」的
      // 高信心 Kiwi 候選，把其形態種類附回 API 項目，供本地卡做嚴格功能驗證。
      // 需要語境消歧的候選不附加，避免把主題／對比等 API 判定強制改名。
      const linked = (candidates || []).find(
        (c) => candidateDecisionId(c) === String(fn?.candidateId || "").trim()
      );
      const witness =
        linked ||
        (candidates || []).find(
          (c) =>
            !c.needsDisambiguation &&
            Number(c.tokenFrom) === Number(fn.tokenFrom) &&
            Number(c.tokenTo) === Number(fn.tokenTo)
        );
      const linkedStatus = String(fn?.status || "confirmed");
      const confirmedOrReclass =
        linked && (linkedStatus === "confirmed" || linkedStatus === "reclassified");
      const canKeepKind = witness && linkedStatus !== "reclassified";
      addFn(
        confirmedOrReclass
          ? {
              ...fn,
              name: linked.name || fn.name,
              category: linked.category || fn.category,
              kiwiKind: linked.kiwiKind,
              grammarKey: linked.grammarKey || `kiwi:${linked.kiwiKind}`,
            }
          : canKeepKind && !fn.kiwiKind
          ? {
              ...fn,
              kiwiKind: witness.kiwiKind,
              grammarKey: fn.grammarKey || witness.grammarKey || `kiwi:${witness.kiwiKind}`,
            }
          : fn
      );
    }

    const decisionRows = Array.isArray(opts.candidateDecisions) ? opts.candidateDecisions : [];
    const resolvedCandidateIds = new Set(
      decisionRows
        .filter((d) => String(d?.status || "").toLowerCase() !== "unknown")
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    const rejectedIds = new Set(
      decisionRows
        .filter((d) => {
          const s = String(d?.status || "").toLowerCase();
          return s === "rejected" || s === "unknown";
        })
        .map((d) => String(d?.candidateId || "").trim())
        .filter(Boolean)
    );
    const mappingFailed = Boolean(opts.mappingFailed);
    for (const c of candidates || []) {
      const cid = candidateDecisionId(c);
      if (rejectedIds.has(cid) && API_CANNOT_VETO.has(c.kiwiKind)) {
        addFn(c);
        continue;
      }
      if (resolvedCandidateIds.has(cid)) continue;
      if (!mappingFailed && c.needsDisambiguation) {
        // API 若已處理同一語素，視為已完成主題／對比、主格／補語等消歧；
        // 若 API 完全漏掉該語素，仍保留 Kiwi 的中信心候選作為補漏提醒。
        const resolvedByApi = ranges.some(
          (r) =>
            !r.kiwiKind &&
            rangeOverlapsIdx(c.tokenFrom, c.tokenTo, r.from, r.to)
        );
        if (resolvedByApi) continue;
      }
      // 韓語文法經常巢狀重疊（例：숨길 수 있게 同時含 -(으)ㄹ 與
      // -(으)ㄹ 수 있다）。區間重疊不代表是同一個文法；只排除同名／
      // 同 Kiwi 種類的候選，避免 API 漏報時把高信心候選一起丟掉。
      const covered = ranges.some(
        (r) =>
          (c.kiwiKind && r.kiwiKind && c.kiwiKind === r.kiwiKind) ||
          String(c.name || "").trim() === String(r.name || "").trim()
      );
      if (covered) continue;
      addFn(c);
    }

    items.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return items;
  }

  function parseMappedFunctions(parsed) {
    const raw = Array.isArray(parsed?.functions)
      ? parsed.functions
      : Array.isArray(parsed?.fn)
        ? parsed.fn
        : Array.isArray(parsed?.f) && parsed.f.length && parsed.f[0] && (parsed.f[0].n || parsed.f[0].name)
          ? parsed.f
          : Array.isArray(parsed?.items)
            ? parsed.items
            : Array.isArray(parsed)
              ? parsed
              : [];
    const normalizedRows = raw
      .map((fn) => {
        let name = String(fn?.name || fn?.n || "").trim();
        if (typeof RulesService !== "undefined" && typeof RulesService.canonicalInventoryName === "function") {
          name =
            RulesService.canonicalInventoryName(name, {
              grammarKey: fn?.grammarKey || fn?.g,
              kiwiKind: fn?.kiwiKind,
            }) || name;
        }
        const candidateId = String(fn?.candidateId || fn?.q || fn?.id || "").trim();
        let status = String(fn?.status || fn?.x || (name ? "confirmed" : "")).toLowerCase();
        if (status === "confirm") status = "confirmed";
        if (status === "reject") status = "rejected";
        if (status === "reclassify") status = "reclassified";
        if (!name && status !== "rejected" && status !== "unknown") return null;
        const tokenFrom = Number(fn.tokenFrom ?? fn.from ?? fn.a);
        const tokenTo = Number(fn.tokenTo ?? fn.to ?? fn.b ?? tokenFrom);
        if (!Number.isFinite(tokenFrom) && status !== "rejected" && status !== "unknown") return null;
        let confidence = String(fn.confidence || fn.f || "medium").toLowerCase();
        if (confidence === "h") confidence = "high";
        else if (confidence === "m") confidence = "medium";
        else if (confidence === "l") confidence = "low";
        if (!["high", "medium", "low"].includes(confidence)) confidence = "medium";
        const grammarKey = String(fn.grammarKey || fn.g || fn.key || "").trim();
        if (
          candidateId &&
          (status === "confirmed" || status === "reclassified") &&
          !grammarKey
        ) {
          status = "unknown";
        }
        return {
          name,
          tokenFrom,
          tokenTo: Number.isFinite(tokenTo) ? tokenTo : tokenFrom,
          note: String(fn.note || fn.e || fn.d || "").trim(),
          confidence,
          category: String(fn.category || fn.c || "").trim(),
          grammarKey,
          candidateId,
          status: ["confirmed", "rejected", "reclassified", "unknown"].includes(status)
            ? status
            : "unknown",
        };
      })
      .filter(Boolean);
    const extraDecisions = Array.isArray(parsed?.decisions)
      ? parsed.decisions
      : Array.isArray(parsed?.d)
        ? parsed.d
        : [];
    const decisionRows = [...normalizedRows, ...extraDecisions.map((d) => ({
      candidateId: String(d?.candidateId || d?.q || d?.id || "").trim(),
      status: String(d?.status || d?.x || "rejected").toLowerCase(),
      note: String(d?.note || d?.e || d?.reason || "").trim(),
      tokenFrom: Number(d?.tokenFrom ?? d?.from ?? d?.a),
      tokenTo: Number(d?.tokenTo ?? d?.to ?? d?.b ?? d?.tokenFrom ?? d?.a),
    }))]
      .filter((d) => d.candidateId);
    const decisionsById = new Map();
    for (const d of decisionRows) {
      let status = String(d.status || "unknown").toLowerCase();
      if (status === "confirm") status = "confirmed";
      if (status === "reject") status = "rejected";
      if (status === "reclassify") status = "reclassified";
      if (!["confirmed", "rejected", "reclassified", "unknown"].includes(status)) {
        status = "unknown";
      }
      decisionsById.set(d.candidateId, {
        candidateId: d.candidateId,
        status,
        note: d.note || "",
        tokenFrom: d.tokenFrom,
        tokenTo: d.tokenTo,
      });
    }
    const decisions = [...decisionsById.values()];
    const functions = normalizedRows.filter(
      (fn) => fn.name && (fn.status === "confirmed" || fn.status === "reclassified")
    );
    return {
      functions,
      decisions,
      translation: String(parsed?.translation || parsed?.t || "").trim(),
      summary: String(parsed?.summary || parsed?.u || "").trim(),
    };
  }

  function kgnPos(token) {
    return token.pos || "其他";
  }

  function tokensToVocab(tokens) {
    const out = [];
    const seen = new Set();
    for (const t of tokens || []) {
      if (!CONTENT_POS.has(t.pos)) continue;
      const surface = t.word;
      if (!surface || /^\s+$/.test(surface)) continue;
      const key = `${surface}:${t.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lemma = String(t.lemma || "").trim();
      const needsLemma = /動詞|形容|指定/.test(t.pos);
      out.push({
        surface,
        lemma: needsLemma ? lemma : lemma && lemma !== surface ? lemma : lemma || surface,
        gloss: "",
        pos: kgnPos(t),
        start: t.start,
        end: t.end,
      });
    }
    return out;
  }

  function hoverLocs(tokens, vocabList) {
    const vocab = Array.isArray(vocabList) ? vocabList : [];
    const out = [];
    for (const t of tokens || []) {
      if (SKIP_HOVER_POS.has(t.pos)) continue;
      if (t.word == null || t.word === "") continue;
      if (!Number.isFinite(t.start) || !Number.isFinite(t.end) || t.end <= t.start) continue;
      if (/^\s+$/.test(t.word)) continue;
      // 只有實詞 token 可以承接 API 單字資料。語尾／助詞與宿主音節
      // 視覺重疊時，不可誤借宿主的 gloss／詞性。
      const canCarryVocab = CONTENT_POS.has(t.pos);
      const exact = canCarryVocab
        ? vocab.find(
            (w) =>
              (w.surface === t.word || w.surface === t.form || w.lemma === t.lemma) &&
              (!Number.isFinite(w.start) || Math.abs(Number(w.start) - t.start) <= 1)
          )
        : null;
      const overlap = canCarryVocab
        ? vocab.find((w) => {
            const ws = Number(w.start);
            const we = Number(w.end);
            if (!Number.isFinite(ws) || !Number.isFinite(we)) return false;
            if (we <= t.start || ws >= t.end) return false;
            return we - ws <= t.end - t.start + 1;
          })
        : null;
      const hit =
        exact ||
        overlap ||
        (canCarryVocab
          ? vocab.find((w) => w.surface === t.word || w.lemma === t.lemma)
          : null);
      const lemma = (hit && hit.lemma) || t.lemma || "";
      out.push({
        start: t.start,
        end: t.end,
        surface: t.form && t.zeroWidth ? t.form : t.word,
        lemma,
        gloss: (hit && hit.gloss) || "",
        pos: (hit && hit.pos) || kgnPos(t),
        tag: t.tag || "",
        form: t.form || "",
      });
    }
    return out;
  }

  function slimTokens(tokens) {
    return (Array.isArray(tokens) ? tokens : []).slice(0, 240).map((t) => ({
      word: String(t.word ?? ""),
      form: String(t.form || ""),
      pos: String(t.pos || ""),
      tag: String(t.tag || ""),
      lemma: String(t.lemma || ""),
      start: Number.isFinite(t.start) ? t.start : null,
      end: Number.isFinite(t.end) ? t.end : null,
      length: Number.isFinite(t.length) ? t.length : 0,
      zeroWidth: Boolean(t.zeroWidth),
      kiwiPosition: Number.isFinite(t.kiwiPosition) ? t.kiwiPosition : null,
      wordPosition: Number.isFinite(t.wordPosition) ? t.wordPosition : null,
    }));
  }

  function groupEojeol(src, tokens) {
    const text = String(src || "");
    const list = Array.isArray(tokens) ? tokens.filter((t) => t && (t.form || t.word)) : [];
    if (!list.length) return [];

    const hasWp = list.every((t) => Number.isFinite(t.wordPosition));
    const groups = [];
    if (hasWp) {
      let cur = null;
      for (const t of list) {
        if (!cur || cur.wordPosition !== t.wordPosition) {
          cur = { wordPosition: t.wordPosition, tokens: [t] };
          groups.push(cur);
        } else {
          cur.tokens.push(t);
        }
      }
    } else {
      let cur = null;
      for (const t of list) {
        if (!cur) {
          cur = { tokens: [t] };
          groups.push(cur);
          continue;
        }
        const prev = cur.tokens[cur.tokens.length - 1];
        const gapStart = visualEnd(prev);
        const gap = text.slice(gapStart, t.start);
        if (t.start >= gapStart && /^\s+$/.test(gap)) {
          cur = { tokens: [t] };
          groups.push(cur);
        } else {
          cur.tokens.push(t);
        }
      }
    }

    return groups.map((g) => {
      const vis = g.tokens.filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start);
      const start = vis.length ? vis[0].start : g.tokens[0].start;
      const end = vis.length ? vis[vis.length - 1].end : visualEnd(g.tokens[g.tokens.length - 1]);
      return {
        text: text.slice(start, end) || g.tokens.map((t) => t.word || t.form).join(""),
        start,
        end,
        tokens: g.tokens,
      };
    });
  }

  function phraseRole(group) {
    const toks = group.tokens || [];
    const tags = toks.map((t) => baseTag(t.tag));
    const forms = toks.map((t) => canonForm(t.form));
    if (tags.includes("JKS") || tags.includes("JKC")) return { role: "主語", kind: "NP" };
    if (tags.includes("JKO")) return { role: "賓語", kind: "NP" };
    if (tags.includes("JX") && forms.some((f) => f === "은" || f === "는")) return { role: "主題", kind: "NP" };
    if (tags.includes("JKB")) return { role: "處所／補語", kind: "PP" };
    if (tags.includes("JKG")) return { role: "所有", kind: "NP" };
    if (tags.includes("ETM")) return { role: "冠形修飾", kind: "ModP" };
    if (tags.includes("MAG") || tags.includes("MAJ")) return { role: "副詞", kind: "AdvP" };
    const pred = tags.some((t) => ["VV", "VA", "VX", "XSV", "XSA", "VCP", "VCN"].includes(t));
    if (pred) return { role: tags.includes("EF") ? "述語" : "謂詞", kind: "VP" };
    if (tags.some((t) => ["NNG", "NNP", "NP", "NR", "NNB"].includes(t))) return { role: "名詞組", kind: "NP" };
    return { role: "", kind: "" };
  }

  function posShort(pos, tag) {
    const t = baseTag(tag);
    if (t === "ETM") return "冠形";
    if (t === "EF") return "終結";
    if (t === "EP") return "先語末";
    if (t === "EC") return "連接";
    if (t === "JKS" || t === "JKC") return "主格";
    if (t === "JKO") return "賓格";
    if (t === "JX") return "助詞";
    if (t === "JKB") return "副助詞";
    if (t === "JKG") return "所有";
    return pos || "";
  }

  function analysisModel(src, tokens, vocabList, items) {
    const words = groupEojeol(src, tokens);
    const vocab = Array.isArray(vocabList) ? vocabList : [];
    const grams = Array.isArray(items) ? items : [];
    return {
      words: words.map((w) => {
        const phrase = phraseRole(w);
        const morphs = w.tokens.map((t) => {
          const gram = grams.find(
            (g) =>
              Number.isFinite(g.start) &&
              Number.isFinite(g.end) &&
              rangesOverlap(t.start, visualEnd(t), g.start, g.end)
          );
          const v = vocab.find((x) => {
            const a = Number(x.start);
            const b = Number(x.end);
            if (Number.isFinite(a) && Number.isFinite(b)) {
              return rangesOverlap(t.start, visualEnd(t), a, b);
            }
            return x.surface === t.word || x.lemma === t.lemma;
          });
          return {
            form: t.form || t.word,
            word: t.word,
            pos: t.pos,
            tag: t.tag,
            lemma: t.lemma,
            start: t.start,
            end: t.end,
            zeroWidth: Boolean(t.zeroWidth),
            roleLabel: gram ? splitRuleName(gram.name).nameZh || gram.name : posShort(t.pos, t.tag),
            grammarName: gram ? gram.name : "",
            gloss: (v && v.gloss) || "",
          };
        });
        const gloss = morphs.map((m) => m.gloss).find(Boolean) || "";
        return { ...w, phrase, morphs, gloss };
      }),
    };
  }

  return {
    KIND_META,
    fromKiwi,
    toKiwiShape,
    tokensToVocab,
    deterministicFunctions,
    hitToFunction,
    functionsToItems,
    parseMappedFunctions,
    compactTokenLines,
    compactCandidateLines,
    candidateDecisionId,
    grammarChecklist,
    compactChecklistLines,
    unresolvedGrammarChecklist,
    hoverLocs,
    slimTokens,
    kgnPos,
    narrowItemToMarker,
    markerNeedles,
    groupEojeol,
    phraseRole,
    analysisModel,
    splitRuleName,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = KoParse;
}
