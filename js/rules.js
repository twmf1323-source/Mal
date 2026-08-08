/**
 * 規則 CRUD 與本地搜尋
 * 模型：雙語標題 中文（韓語）+ 分類 + 詳細說明
 * 不做變化格子；不規則各自成卡
 */
const RulesService = (() => {
  let rules = [];

  const SUPPLEMENTARY_CATEGORY = "補充用法";

  const CATEGORIES = [
    { key: "", label: "（未分類）" },
    { key: "語尾", label: "語尾" },
    { key: "助詞", label: "助詞" },
    { key: "不規則", label: "不規則" },
    { key: "時態", label: "時態" },
    { key: "敬語", label: "敬語" },
    { key: "連接", label: "連接" },
    { key: "句型", label: "句型" },
    { key: "其他", label: "其他" },
    { key: SUPPLEMENTARY_CATEGORY, label: "補充用法" },
  ];

  /** 成語／特定用法等：特殊色、列表最後、不句中上色 */
  function isSupplementaryUsage(ruleOrCat) {
    const c =
      typeof ruleOrCat === "string"
        ? ruleOrCat
        : ruleOrCat && typeof ruleOrCat === "object"
          ? ruleOrCat.category
          : "";
    return String(c || "").trim() === SUPPLEMENTARY_CATEGORY;
  }

  /** 種子檔順序（同分類內維持此序；母音縮約 해→여→돼 接在 ㅡ 脫落之後） */
  const SEED_ID_ORDER = [
    "seed-haeyo",
    "seed-hamnida",
    "seed-past",
    "seed-topic",
    "seed-topic-contraction-nan",
    "seed-topic-contraction-neon",
    "seed-topic-contraction-jeon",
    "seed-adnominal-neun",
    "seed-adnominal-eun",
    "seed-subject",
    "seed-deusi",
    "seed-object",
    "seed-object-contraction-nal",
    "seed-object-contraction-neol",
    "seed-object-contraction-jeol",
    "seed-e",
    "seed-eseo",
    "seed-go",
    "seed-aseo",
    "seed-nde-verb",
    "seed-nde-adj",
    "seed-nde-noun",
    "seed-progressive",
    "seed-negative",
    "seed-b-irregular",
    "seed-d-irregular",
    "seed-s-irregular",
    "seed-reu-irregular",
    "seed-h-irregular",
    "seed-eu-deletion",
    "seed-vowel-hae",
    "seed-vowel-yeo",
    "seed-vowel-dwae",
    "seed-honorific",
    "seed-ieyo",
    "seed-want",
    "seed-manhada",
    "seed-ajueo-juda",
  ];

  function categoryRank(cat) {
    const key = String(cat || "");
    if (key === SUPPLEMENTARY_CATEGORY) return 10000;
    const keys = CATEGORIES.map((c) => c.key).filter(
      (k) => k && k !== SUPPLEMENTARY_CATEGORY
    );
    const i = keys.indexOf(key);
    if (i >= 0) return i;
    if (!key) return keys.length + 1;
    return keys.length;
  }

  function seedRank(id) {
    const i = SEED_ID_ORDER.indexOf(String(id || ""));
    return i >= 0 ? i : -1;
  }

  /**
   * 筆記本顯示順序：分類（語尾→助詞→不規則…）→ 種子原序 → 標題
   * （不再用「最近更新」置頂，避免母音縮約等被遷移／編輯頂到最前）
   */
  function compareRules(a, b) {
    const cr = categoryRank(a?.category) - categoryRank(b?.category);
    if (cr !== 0) return cr;
    const sa = seedRank(a?.id);
    const sb = seedRank(b?.id);
    const aSeed = sa >= 0;
    const bSeed = sb >= 0;
    if (aSeed && bSeed && sa !== sb) return sa - sb;
    if (aSeed !== bSeed) return aSeed ? -1 : 1;
    const byTitle = String(a?.title || "").localeCompare(String(b?.title || ""), "zh-Hant");
    if (byTitle !== 0) return byTitle;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  }

  function setAll(next) {
    rules = Array.isArray(next)
      ? next.map((r) => {
          const n = normalizeRule(r, null);
          n.id = r.id || n.id;
          n.created_at = r.created_at || n.created_at;
          n.updated_at = r.updated_at || n.updated_at;
          return n;
        })
      : [];
    rules.sort(compareRules);
    Storage.saveRules(rules);
    return rules;
  }

  function getAll() {
    return rules.slice().sort(compareRules);
  }

  function getById(id) {
    return rules.find((r) => r.id === id) || null;
  }

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function normalizeRule(input, existing = null) {
    const now = new Date().toISOString();
    const isUpdate = Boolean(existing);

    return {
      id: existing?.id || input?.id || uid(),
      title: (input?.title || existing?.title || "").trim() || "未命名規則",
      category: String(input?.category ?? existing?.category ?? "").trim(),
      explanation: (input?.explanation ?? existing?.explanation ?? "").trim(),
      /** 可視化結構式，如：詞幹＋지 않다、主詞＋（이/가） */
      structure: String(
        input?.structure ?? input?.pattern ?? existing?.structure ?? existing?.pattern ?? ""
      ).trim(),
      // 已廢止查詢關鍵字（本地掃描已取消）；不再寫入
      keywords: [],
      created_at: existing?.created_at || input?.created_at || now,
      updated_at: isUpdate ? now : input?.updated_at || existing?.updated_at || now,
    };
  }

  /**
   * 把 structure 字串拆成零件（以 ＋ + 分隔）供可視化
   * @returns {string[]}
   */
  function parseStructureParts(structure) {
    const s = String(structure || "").trim();
    if (!s) return [];
    // 若含結果箭頭，先去掉箭頭右側再拆（僅回傳左側零件；完整鏈請用 parseStructureTokens）
    const left = s.split(/\s*(?:→|⟶|➜|->|⇒)\s*/)[0] || s;
    return left
      .split(/\s*[＋+]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /**
   * 單條變化鏈 token（＋ 組合、→ 結果）
   * @returns {{ op: 'part'|'plus'|'arrow', text?: string, role?: string }[]}
   */
  function parseStructureChain(segment) {
    const raw = String(segment || "").trim().normalize("NFC");
    if (!raw) return [];

    const ARROW = /\s*(?:→|⟶|➜|->|⇒)\s*/;
    const sides = raw.split(ARROW);
    const tokens = [];

    function roleOfPart(text, asResult) {
      const p = String(text || "").trim();
      if (!p) return "neutral";
      if (asResult) return "result";
      if (
        /^(詞幹|語幹|主詞|主題|受詞|名詞|動詞|形容詞|處所|時間|語尾|動作|對象|人稱|開音節|閉音節|開|閉)/.test(
          p
        )
      ) {
        return "slot";
      }
      if (/脫\s*|變|ㅂ→|ㄷ→|ㅅ→|ㅎ→|르→|ㅆ받침|融合/.test(p)) return "transform";
      if (/^(나|너|저|우리|너희|저희|내|네|제|이것|그것|저것)$/.test(p)) {
        return "base";
      }
      if (
        /^(은|는|이|가|을|를|에|에서|의|와|과|도|만|으로|로|께|한테|에게)$/.test(p) ||
        /[\uAC00-\uD7A3]/.test(p) ||
        /[()（）\-〜~\/／]/.test(p)
      ) {
        if (/^(은|는|이|가|을|를|에|의|와|과|도|만)$/.test(p)) return "affix";
        return "affix";
      }
      return "neutral";
    }

    function pushPlusJoined(seg, asResult) {
      const parts = String(seg || "")
        .split(/\s*[＋+]\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      parts.forEach((p, i) => {
        if (i > 0) tokens.push({ op: "plus" });
        tokens.push({ op: "part", text: p, role: roleOfPart(p, asResult) });
      });
    }

    if (sides.length >= 2) {
      pushPlusJoined(sides[0], false);
      tokens.push({ op: "arrow", text: "→" });
      pushPlusJoined(sides.slice(1).join("→").trim(), true);
    } else {
      pushPlusJoined(raw, false);
    }
    return tokens;
  }

  /**
   * 判斷一支結構式是開音節／閉音節／一般
   * @returns {'open'|'closed'|'normal'}
   */
  function detectBranchKind(branchStr, tokens) {
    const s = String(branchStr || "");
    const flat = (tokens || [])
      .filter((t) => t.op === "part")
      .map((t) => t.text || "")
      .join(" ");
    const blob = `${s} ${flat}`;
    // 閉優先於開，避免「開／閉」字樣誤判
    if (/閉音節|^閉[：:]|閉音節|(?:^|[／\s＋+])閉(?:音節)?(?=[＋+\s：:]|$)/.test(blob)) {
      return "closed";
    }
    if (/開音節|^開[：:]|開音節|(?:^|[／\s＋+])開(?:音節)?(?=[＋+\s：:]|$)/.test(blob)) {
      return "open";
    }
    // 含 ㅆ받침／融合 且無「閉」→ 視為開音節寫法
    if (/ㅆ받침|融合/.test(blob) && !/閉/.test(blob)) return "open";
    return "normal";
  }

  /**
   * 結構式：可多條變化並排，用 ／ 或「兩側有空白的 /」分開
   * （아/어、았/었 中間無空白的 / 不會被拆成兩支）
   * @returns {{ branches: { tokens: object[], kind: string, label: string }[] }}
   */
  function parseStructureBranches(structure) {
    const raw = String(structure || "").trim().normalize("NFC");
    if (!raw) return { branches: [] };

    // 全形 ／、｜，或「  /  」作為「不同變化方式」分隔
    const parts = raw
      .split(/\s*[／｜|]\s*|(?<=\S)\s+\/\s+(?=\S)/)
      .map((s) => s.trim())
      .filter(Boolean);

    const branchStrs = parts.length ? parts : [raw];
    return {
      branches: branchStrs.map((b) => {
        const tokens = parseStructureChain(b);
        const kind = detectBranchKind(b, tokens);
        return {
          tokens,
          kind,
          label: kind === "open" ? "開音節" : kind === "closed" ? "閉音節" : "",
        };
      }),
    };
  }

  /**
   * 相容舊 API：回傳第一支（或合併）token 流
   */
  function parseStructureTokens(structure) {
    const { branches } = parseStructureBranches(structure);
    if (!branches.length) return [];
    if (branches.length === 1) return branches[0].tokens;
    // 多支時扁平並插入 slash 標記
    const flat = [];
    branches.forEach((br, i) => {
      if (i > 0) flat.push({ op: "slash", text: "／" });
      flat.push(...br.tokens);
    });
    return flat;
  }

  function create(input) {
    const rule = normalizeRule(input);
    rules = [rule, ...rules];
    Storage.saveRules(rules);
    return rule;
  }

  function update(id, input) {
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("找不到規則：" + id);
    const rule = normalizeRule(input, rules[idx]);
    rules = rules.slice();
    rules[idx] = rule;
    Storage.saveRules(rules);
    return rule;
  }

  function remove(id) {
    const before = rules.length;
    rules = rules.filter((r) => r.id !== id);
    if (rules.length === before) return false;
    Storage.saveRules(rules);
    return true;
  }

  function normalizeToken(raw) {
    return String(raw || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "");
  }

  /**
   * 韓語文法標記正規化（比對用）
   * 消掉 API／本地常見寫法差：前後 - ~、全形／、空白、可選 (으)
   * 例：-았/었- ≡ -았/었 ≡ 았/었；-(으)시- ≡ (으)시 ≡ 으시
   */
  function normalizeGrammarKey(raw) {
    let s = String(raw || "")
      .trim()
      .normalize("NFC")
      .replace(/\s+/g, "")
      .replace(/[／]/g, "/")
      .replace(/[|｜]/g, "/")
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")")
      .replace(/[・·‧•･]/g, "·")
      .replace(/[＋]/g, "+")
      .replace(/[～〜~─–—－]/g, "-");
    // 反覆去掉首尾裝飾線
    s = s.replace(/^[-]+/, "").replace(/[-]+$/, "");
    return s;
  }

  /**
   * 標題整段正規化（中文＋韓語標記）供「等同標題」比對
   */
  function normalizeTitleKey(title) {
    const p = parseBilingualTitle(title);
    const zh = normalizeToken(p.zh)
      .replace(/[・·‧•･]/g, "")
      .replace(/[（(].*$/, ""); // 保險：只留中文段
    const ko = normalizeGrammarKey(p.ko || "");
    if (zh && ko) return `${zh}(${ko})`;
    return zh || ko || normalizeToken(title);
  }

  /**
   * 中文名軟比對：過去式≡過去、連接語尾⊂／≈並列連接 等
   * （須搭配韓語標記，不可單靠中文判已收錄）
   */
  function zhNamesRelated(a, b) {
    const na = normalizeToken(a).replace(/[・·‧•･]/g, "");
    const nb = normalizeToken(b).replace(/[・·‧•･]/g, "");
    if (!na || !nb) return false;
    if (na === nb) return true;
    const strip = (s) =>
      s
        .replace(
          /(助詞|語尾|連結|連接|接續|句型|時制|時態|形態|活用|敬語|不規則|縮約|體|体|形|式|時)$/g,
          ""
        )
        .replace(/^(長形|短形|動詞|形容詞|名詞|人稱|主體|指定詞)/, "");
    const sa = strip(na);
    const sb = strip(nb);
    if (!sa || !sb) return na.includes(nb) || nb.includes(na);
    if (sa === sb) return true;
    // 一方包含另一方，且較短方 ≥2
    const shorter = sa.length <= sb.length ? sa : sb;
    const longer = sa.length > sb.length ? sa : sb;
    if (shorter.length >= 2 && longer.includes(shorter)) {
      // 避免「不」命中「不規則」：較長最多多 6 字（助詞／語尾等已 strip）
      if (longer.length <= shorter.length + 8) return true;
    }
    // 常見別名表（正規化後）
    const ALIAS_GROUPS = [
      ["過去", "過去時", "過去式", "過去時制"],
      ["進行", "進行時", "進行式", "進行形"],
      ["否定", "長形否定", "否定形"],
      ["希望", "願望", "想要"],
      ["並列", "並列連接", "羅列"],
      ["原因", "原因連接", "因果"],
      ["主題", "主題助詞", "話題", "話題助詞"],
      ["主格", "主格助詞", "主語"],
      ["賓格", "賓格助詞", "受詞", "目的格"],
      ["敬語", "主體敬語", "尊敬"],
      ["冠形", "冠形詞形", "定語", "管形"],
      ["請托", "命令", "命令請托", "給我"],
      ["值得", "還可以", "值得還可以"],
    ];
    for (const g of ALIAS_GROUPS) {
      const hitA = g.some((x) => na === x || na.includes(x) || sa === x);
      const hitB = g.some((x) => nb === x || nb.includes(x) || sb === x);
      if (hitA && hitB) return true;
    }
    return false;
  }

  /** 可選 (으) 展開：-(으)시- → 시／으시；(으)ㄹ만하다 → ㄹ만하다／을만하다 */
  function expandOptionalEuKeys(marker) {
    const keys = new Set();
    const base = normalizeGrammarKey(marker);
    if (!base) return keys;
    keys.add(base);
    if (/\(으\)/.test(base)) {
      keys.add(base.replace(/\(으\)/g, ""));
      keys.add(base.replace(/\(으\)/g, "으"));
    }
    // 已寫成 으시／을 而無括號時，也登錄去 으 短形（僅語尾常見）
    if (/^으시/.test(base)) keys.add(base.replace(/^으/, ""));
    if (/^을/.test(base) && base.length >= 2) keys.add(base.replace(/^을/, "ㄹ"));
    return keys;
  }

  /**
   * 文法別名鍵：API 與本地標題寫法不一仍可對上
   * 例：ㅡ 탈락 ↔ 으 탈락 ↔ ㅡ 脫落；-았/었- ↔ 았/었
   */
  function expandAliasKeys(tokenOrBlob) {
    const t = normalizeToken(tokenOrBlob);
    const keys = new Set();
    if (!t) return keys;
    keys.add(t);

    const g = normalizeGrammarKey(tokenOrBlob);
    if (g) {
      keys.add(g);
      expandOptionalEuKeys(g).forEach((k) => keys.add(k));
    }

    const isEuDrop =
      /ㅡ\s*탈락|ㅡ\s*脫落|으\s*탈락|으\s*脫落|eu\s*delet|母音\s*ㅡ|ㅡ탈락|으탈락|ㅡ脫落|으脫落/i.test(
        String(tokenOrBlob || "")
      ) ||
      /^(ㅡ|으)?(탈락|脫落)$/.test(t) ||
      t === "ㅡ탈락" ||
      t === "으탈락" ||
      t === "ㅡ脫落" ||
      t === "으脫落" ||
      t === "ㅡ탈락불규칙" ||
      t === "으탈락불규칙" ||
      g === "ㅡ탈락" ||
      g === "으탈락" ||
      g === "ㅡ脫落" ||
      g === "으脫落";

    if (isEuDrop) {
      [
        "ㅡ탈락",
        "으탈락",
        "ㅡ脫落",
        "으脫落",
        "ㅡ탈락",
        "ㅡ脫落（ㅡ탈락）",
        "ㅡ탈락（ㅡ탈락）",
        "으脫落（으탈락）",
      ].forEach((k) => keys.add(normalizeToken(k)));
      keys.add("eu脫落");
      keys.add("eu탈락");
    }

    // 統一 ㅡ / 으 寫法後再比一次
    const unified = t.replace(/으/g, "ㅡ");
    if (unified !== t) keys.add(unified);
    const asEuSyllable = t.replace(/ㅡ/g, "으");
    if (asEuSyllable !== t) keys.add(asEuSyllable);
    if (g) {
      const gu = g.replace(/으/g, "ㅡ");
      if (gu !== g) keys.add(gu);
    }

    return keys;
  }

  function blobsMatchEuDeletion(...blobs) {
    return blobs.some((b) =>
      /ㅡ\s*탈락|ㅡ\s*脫落|으\s*탈락|으\s*脫落|eu\s*delet|ㅡ탈락|으탈락/i.test(String(b || ""))
    );
  }

  function isEuDeletionRule(rule) {
    if (!rule) return false;
    return blobsMatchEuDeletion(rule.title, rule.structure, rule.explanation);
  }

  function isEuDeletionItem(item) {
    if (!item) return false;
    return blobsMatchEuDeletion(
      item.name,
      item.nameZh,
      item.nameKo,
      item.span,
      item.note,
      item.category
    );
  }

  /**
   * 不規則種類（禁止統稱「不規則」對上任意一張）
   * @returns {'ㅂ'|'ㄷ'|'ㅅ'|'르'|'ㅎ'|'eu'|'generic'|null}
   */
  function extractIrregularKind(...blobs) {
    const s = blobs.map((b) => String(b || "")).join("\n");
    if (!s.trim()) return null;
    // 具體種類優先
    if (/ㅡ\s*탈락|ㅡ\s*脫落|으\s*탈락|으\s*脫落|eu\s*delet/i.test(s)) return "eu";
    if (/ㅂ\s*不規則|ㅂ\s*불규칙|\bㅂ\b.*不規則|不規則.*ㅂ|ㅂ\s*irreg/i.test(s)) return "ㅂ";
    if (/ㄷ\s*不規則|ㄷ\s*불규칙|\bㄷ\b.*不規則|不規則.*ㄷ/i.test(s)) return "ㄷ";
    if (/ㅅ\s*不規則|ㅅ\s*불규칙|\bㅅ\b.*不規則|不規則.*ㅅ/i.test(s)) return "ㅅ";
    if (/르\s*不規則|르\s*불규칙|ㄹ\s*르|reu\s*irreg/i.test(s)) return "르";
    if (/ㅎ\s*不規則|ㅎ\s*불규칙|\bㅎ\b.*不規則|不規則.*ㅎ/i.test(s)) return "ㅎ";
    // 括號韓語段僅 ㅂ／ㄷ…
    const p = parseBilingualTitle(blobs[0] || "");
    if (p.ko) {
      const ko = p.ko.replace(/\s/g, "");
      if (/^ㅂ/.test(ko) && /불규칙|不規則/.test(s)) return "ㅂ";
      if (/^ㄷ/.test(ko) && /불규칙|不規則/.test(s)) return "ㄷ";
      if (/^ㅅ/.test(ko) && /불규칙|不規則/.test(s)) return "ㅅ";
      if (/^르|^ㄹ/.test(ko) && /불규칙|不規則/.test(s)) return "르";
      if (/^ㅎ/.test(ko) && /불규칙|不規則/.test(s)) return "ㅎ";
    }
    // 僅有統稱
    if (/不規則|불규칙|irregular/i.test(s)) return "generic";
    return null;
  }

  function ruleIrregularKind(rule) {
    if (!rule) return null;
    return extractIrregularKind(rule.title, rule.structure, rule.explanation, rule.category);
  }

  /** 解析「中文（韓語）」→ { full, zh, ko } */
  function parseBilingualTitle(title) {
    const full = String(title || "").trim();
    const m = full.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    if (m) {
      return { full, zh: m[1].trim(), ko: m[2].trim() };
    }
    return { full, zh: full, ko: "" };
  }

  function titleKeys(title) {
    const p = parseBilingualTitle(title);
    const keys = new Set();
    const add = (x) => {
      expandAliasKeys(x).forEach((k) => keys.add(k));
    };
    if (p.full) add(p.full);
    if (p.zh) add(p.zh);
    if (p.ko) add(p.ko);
    return keys;
  }

  function ruleMatchKeys(rule) {
    // 僅標題／括號韓語（不再使用 keywords）
    const keys = titleKeys(rule.title);
    const p = parseBilingualTitle(rule.title);
    const addKoParts = (koRaw) => {
      if (!koRaw) return;
      expandAliasKeys(koRaw).forEach((k) => keys.add(k));
      const g = normalizeGrammarKey(koRaw);
      if (g) {
        expandAliasKeys(g).forEach((k) => keys.add(k));
        expandOptionalEuKeys(g).forEach((k) => expandAliasKeys(k).forEach((x) => keys.add(x)));
      }
      // 斜線擇一：-아/어요 → 아、어요（皆去裝飾）
      String(koRaw)
        .split(/[\/／,，|｜\s]+/)
        .forEach((part) => {
          const t = normalizeGrammarKey(part);
          if (t.length >= 1) expandAliasKeys(t).forEach((k) => keys.add(k));
        });
    };
    if (p.ko) addKoParts(p.ko);
    // 結構式：只納入「較具辨識度」的韓語片段（≥2 且非通則 아/어），避免誤加分
    if (rule.structure) {
      const GENERIC_STRUCT = new Set([
        "아/어",
        "아",
        "어",
        "여",
        "요",
        "詞幹",
        "語幹",
        "主詞",
        "主題",
        "受詞",
        "名詞",
        "動詞",
        "形容詞",
        "開音節",
        "閉音節",
        "語尾",
        "動作",
        "對象",
        "融合",
        "ㅆ받침",
      ]);
      String(rule.structure)
        .split(/[＋+\s→⟶➜⇒／|,，()（）]+/)
        .forEach((part) => {
          const t = normalizeGrammarKey(part);
          if (
            t &&
            t.length >= 2 &&
            t.length <= 12 &&
            /[\uAC00-\uD7A3]/.test(t) &&
            !GENERIC_STRUCT.has(t) &&
            !/^아\/어/.test(t)
          ) {
            expandAliasKeys(t).forEach((k) => keys.add(k));
          }
        });
    }
    // 正規化後的完整標題鍵
    const tk = normalizeTitleKey(rule.title);
    if (tk) expandAliasKeys(tk).forEach((k) => keys.add(k));
    // 母音縮約專項：同時登錄短名鍵（해／여／돼）與公式結果，方便 API 舊式 n 對上
    const vForm = extractVowelContractionForm(rule.title, rule.structure);
    if (vForm) {
      const c = canonicalVowelForm(vForm) || vForm;
      expandAliasKeys(c).forEach((k) => keys.add(k));
      expandAliasKeys("母音縮約").forEach((k) => keys.add(k));
      // 相容舊標題「母音縮約（해）」整段
      if (c === "해") expandAliasKeys("母音縮約（해）").forEach((k) => keys.add(k));
      if (c === "여") expandAliasKeys("母音縮約（여）").forEach((k) => keys.add(k));
      if (c === "돼") expandAliasKeys("母音縮約（돼）").forEach((k) => keys.add(k));
    }
    if (isEuDeletionRule(rule)) {
      expandAliasKeys("ㅡ 탈락").forEach((k) => keys.add(k));
    }
    return keys;
  }

  /**
   * 人稱＋助詞縮約形（난＝나＋는，날＝나＋를…）
   * 走「一般族」比對：有專卡則加分優先；不再當獨立嚴格門檻整項否決
   */
  const PARTICLE_CONTRACTIONS = {
    // 主題 은/는
    난: { type: "topic", full: "나는", base: "나", particle: "는" },
    넌: { type: "topic", full: "너는", base: "너", particle: "는" },
    전: { type: "topic", full: "저는", base: "저", particle: "는" },
    우린: { type: "topic", full: "우리는", base: "우리", particle: "는" },
    그건: { type: "topic", full: "그것은", base: "그것", particle: "는" },
    이건: { type: "topic", full: "이것은", base: "이것", particle: "는" },
    저건: { type: "topic", full: "저것은", base: "저것", particle: "는" },
    // 賓格 을/를
    날: { type: "object", full: "나를", base: "나", particle: "를" },
    널: { type: "object", full: "너를", base: "너", particle: "를" },
    절: { type: "object", full: "저를", base: "저", particle: "를" },
    우릴: { type: "object", full: "우리를", base: "우리", particle: "를" },
    // 主格 이/가（口語）
    내가: { type: "subject", full: "내가", base: "내", particle: "가" },
    네가: { type: "subject", full: "네가", base: "네", particle: "가" },
    제가: { type: "subject", full: "제가", base: "제", particle: "가" },
  };

  /**
   * 母音縮約分系（互不混用）：
   * - 해／했：하＋여→해（하다 系）
   * - 여：이＋어→여（詞幹末音節 이，如 보이다→보여）— 與 해 不同系
   * - 돼／됐：되＋어→돼
   * - 와：오＋아；워：우＋어
   */
  const VOWEL_CONTRACTIONS = {
    해: { type: "vowel", full: "하여", base: "하", ending: "여", note: "하다系", family: "hae" },
    여: { type: "vowel", full: "이어", base: "이", ending: "어", note: "이＋어→여", family: "yeo" },
    돼: { type: "vowel", full: "되어", base: "되", ending: "어", note: "되다系", family: "dwae" },
    와: { type: "vowel", full: "오아", base: "오", ending: "아", note: "오＋아", family: "wa" },
    워: { type: "vowel", full: "우어", base: "우", ending: "어", note: "우＋어", family: "wo" },
    했: { type: "vowel", full: "하였", base: "하", ending: "였", note: "하다過去", family: "hae" },
    됐: { type: "vowel", full: "되었", base: "되", ending: "었", note: "되다過去", family: "dwae" },
  };

  /** 同系別名：해↔했；여 獨立；돼↔됐（해≠여） */
  function vowelFormAliases(form) {
    const f = String(form || "").trim();
    const fam = VOWEL_CONTRACTIONS[f]?.family || "";
    if (fam === "hae") return ["해", "했"];
    if (fam === "yeo") return ["여"];
    if (fam === "dwae") return ["돼", "됐"];
    if (fam === "wa") return ["와"];
    if (fam === "wo") return ["워"];
    return f ? [f] : [];
  }

  /**
   * 縮約結果音節（해／여／돼…）後方可接的語尾／請托開頭
   * 允許 여줘、해줘、돼요 等連寫，避免被當成「詞中誤命中」
   */
  function isAllowedAfterVowelResult(afterChar) {
    if (afterChar == null || afterChar === "") return true;
    if (!isHangulSyllable(afterChar)) return true; // 空白、標點
    // 요서도야지＝常見語尾；줘／죠＝請托／縮約；라／네＝終結／感嘆
    return /^[요서도야지줘죠라네]$/.test(afterChar);
  }

  /**
   * 句中表面 → 縮約形（보이다→보여 抓 여；해요 抓 해；속삭여줘 抓 여）
   * 依詞尾／連寫判斷；해 與 여 互斥（보여≠해）
   */
  function inferVowelFormFromSurface(text) {
    const s = String(text || "").trim().normalize("NFC");
    if (!s) return "";
    // 돼 系（含 돼줘 等連寫）
    if (
      s === "돼" ||
      /됐|돼요|돼서/.test(s) ||
      /돼(?:요|서|도|야|지|줘|죠)?$/.test(s) ||
      /돼(?:줘|죠)/.test(s)
    ) {
      return "돼";
    }
    // 해 系（하다）— 必須在 여 之前判斷；含 해줘
    if (
      s === "해" ||
      /했|하여/.test(s) ||
      /해(?:요|서|도|야|지|줘|죠)?$/.test(s) ||
      /해\s*줘|해줘/.test(s)
    ) {
      return "해";
    }
    // 여 系：이＋어→여（보여、기다려、여요、속삭여줘…）
    if (
      s === "여" ||
      /여(?:요|서|도|야|지|줘|죠)?$/.test(s) ||
      /여(?:줘|줘요|죠|라)/.test(s)
    ) {
      return "여";
    }
    // 詞中仍可見 …여＋語尾／請托（속삭여줘：詞尾是 줘 但含 여줘）
    if (/여(?:요|서|도|야|지|줘|죠)/.test(s) && !/해|했|하여|하\s*[＋+]/.test(s)) {
      return "여";
    }
    if (s === "와" || /와(요|서)?$/.test(s)) return "와";
    if (s === "워" || /워(요|서)?$/.test(s)) return "워";
    return "";
  }

  /**
   * 表面／括號 → 標準形（比對用）
   * 여＝이＋어 系；해＝하＋여 系 — 不可互轉
   */
  function canonicalVowelForm(raw) {
    const s = String(raw || "").trim().normalize("NFC");
    if (!s) return "";
    if (/돼|됐|되어|되\s*[＋+]\s*어/.test(s)) return "돼";
    // 이＋어→여（結構式或僅「여」）
    if (
      /^여$|^여요$|^여서$/.test(s) ||
      s === "여" ||
      /이\s*[＋+]\s*어/.test(s) ||
      (/→\s*여/.test(s) && !/하\s*[＋+]|하여|해/.test(s))
    ) {
      return "여";
    }
    // 하＋여→해（結構式中的「여」是中間形，結果是 해）
    if (/해|했|하여|하\s*[＋+]\s*여/.test(s)) return "해";
    if (/^와|오\s*[＋+]\s*아/.test(s)) return "와";
    if (/^워|우\s*[＋+]\s*어/.test(s)) return "워";
    // 句中表面（보여 等）
    const fromSurf = inferVowelFormFromSurface(s);
    if (fromSurf) return fromSurf;
    for (const f of Object.keys(VOWEL_CONTRACTIONS)) {
      if (s === f || normalizeToken(s) === f) return f;
    }
    return "";
  }

  function vowelFormFamily(form) {
    const c = canonicalVowelForm(form) || form;
    return VOWEL_CONTRACTIONS[c]?.family || VOWEL_CONTRACTIONS[form]?.family || form || "";
  }

  /** 兩形是否同系（해↔했；여 僅 여；해≠여） */
  function vowelFormsCompatible(a, b) {
    const fa = vowelFormFamily(a);
    const fb = vowelFormFamily(b);
    return Boolean(fa && fb && fa === fb);
  }

  function extractVowelContractionForm(...blobs) {
    const joined = blobs.map((s) => String(s || "")).join("\n");

    // 1) 括號內容：優先「套用範圍」式（하＋여→해／이＋어→여／되＋어→돼），再接受舊式（해）（여）（돼）
    const parenMatches = joined.matchAll(/[（(]([^）)]{1,40})[）)]/g);
    for (const m of parenMatches) {
      const inner = m[1].trim();
      // —— 專項公式（必須先判，避免 하＋여→해 被中間的 여 誤判）——
      // 하다 系：하＋여→해（勿用裸「→해」誤傷其他）
      if (
        /하\s*[＋+]\s*여/.test(inner) ||
        (/하여\s*→\s*해/.test(inner) && !/이\s*[＋+]\s*어/.test(inner)) ||
        (/→\s*해/.test(inner) && /하|하여/.test(inner) && !/이\s*[＋+]\s*어/.test(inner))
      ) {
        return "해";
      }
      // 이 系：이＋어→여（無 하＋）
      if (/이\s*[＋+]\s*어/.test(inner) && !/하\s*[＋+]|하여|→\s*해/.test(inner)) return "여";
      // 되다 系
      if (
        (/되\s*[＋+]\s*어|되어\s*→\s*돼|→\s*돼/.test(inner) || /돼|됐/.test(inner)) &&
        /되|돼|됐|되어/.test(inner) &&
        !/하\s*[＋+]\s*여|이\s*[＋+]\s*어/.test(inner)
      ) {
        return "돼";
      }
      // —— 舊式短名 ——
      if (/^[-~〜]?\s*여\s*$/.test(inner) || inner === "여") return "여";
      if (/^[-~〜]?\s*해\s*$/.test(inner) || inner === "해" || /^해요$|^해서$/.test(inner)) return "해";
      if (/^[-~〜]?\s*돼\s*$/.test(inner) || inner === "돼") return "돼";
      // 其餘括號內容
      if (/해|했|하여|하\s*[＋+]\s*여/.test(inner) && !/돼|되\s*[＋+]\s*어/.test(inner)) {
        if (/→\s*여\s*$/.test(inner) && !/해|했|하\s*[＋+]/.test(inner)) return "여";
        return "해";
      }
      if (/이\s*[＋+]\s*어/.test(inner) && !/하\s*[＋+]|해|했/.test(inner)) return "여";
      if (/돼|되\s*[＋+]\s*어|되어|됐/.test(inner) && !/하\s*[＋+]\s*여|하여/.test(inner)) {
        return "돼";
      }
      const c = canonicalVowelForm(inner);
      if (c) return c;
      for (const f of Object.keys(VOWEL_CONTRACTIONS)) {
        if (new RegExp(`(^|[^\\uAC00-\\uD7A3])${f}([^\\uAC00-\\uD7A3]|$)`).test(inner)) {
          return f;
        }
      }
    }

    // 2) 句中 span 表面（보여→여，해요→해）— 優先於模糊關鍵字
    for (const b of blobs) {
      const fromSurf = inferVowelFormFromSurface(b);
      if (fromSurf) return fromSurf;
    }

    // 3) 母音縮約語境下的孤立關鍵字
    if (/母音\s*縮約|모음\s*축약|元音\s*縮約|vowel\s*contract|縮約|축약/i.test(joined)) {
      for (const form of ["됐", "돼", "했", "해요", "해", "여", "와", "워"]) {
        const re = new RegExp(`(^|[^\\uAC00-\\uD7A3])${form}([^\\uAC00-\\uD7A3]|$)`);
        if (blobs.some((b) => re.test(String(b || "")) || normalizeToken(b) === form)) {
          if (form === "했" || form === "해요") return "해";
          if (form === "됐") return "돼";
          return form;
        }
      }
    }

    // 4) span／nameKo
    for (const b of blobs) {
      const t = String(b || "").trim();
      if (!t) continue;
      if (/母音|모음|縮約|축약/.test(joined) && /^여$/.test(t)) return "여";
      const c = canonicalVowelForm(t);
      if (c) return c;
    }
    return "";
  }

  function detectVowelContractionQuery(name, nameKo, nameZh, span) {
    const blobs = [name, nameKo, nameZh, span].map((s) => String(s || ""));
    const joined = blobs.join("\n");
    const isVowelFamily =
      /母音\s*縮約|모음\s*축약|元音\s*縮約|vowel\s*contract/i.test(joined) ||
      (/縮約|축약/.test(joined) &&
        /하\s*[＋+]|이\s*[＋+]|되\s*[＋+]|하여|이어|되어|해요|돼요|해|돼|했|됐|여/.test(joined));

    // 括號形優先；若 span 明確與括號衝突，以句中表面為準（避免 API 把 보여 標成 해）
    let formFromTitle = extractVowelContractionForm(name, nameKo, nameZh);
    let formFromSpan = span ? inferVowelFormFromSurface(span) || extractVowelContractionForm(span) : "";
    let form = formFromTitle || formFromSpan;
    if (
      formFromTitle &&
      formFromSpan &&
      vowelFormFamily(formFromTitle) !== vowelFormFamily(formFromSpan)
    ) {
      // 句中 보여／여… 對上 여；해／해요 對上 해 — 表面勝標題
      form = formFromSpan;
    }
    if (!form) form = extractVowelContractionForm(...blobs);

    if (form && VOWEL_CONTRACTIONS[form]) {
      return { form, ...VOWEL_CONTRACTIONS[form], explicit: true, family: "vowel" };
    }
    // 標準形可能是 했→仍歸 hae 表
    if (form && vowelFormFamily(form)) {
      const canon = canonicalVowelForm(form) || form;
      if (VOWEL_CONTRACTIONS[canon]) {
        return { form: canon, ...VOWEL_CONTRACTIONS[canon], explicit: true, family: "vowel" };
      }
    }
    if (isVowelFamily) {
      return { form: "", type: "vowel", explicit: false, family: "vowel" };
    }
    return null;
  }

  function ruleMentionsVowelContraction(rule, form) {
    if (!rule || !form) return false;
    const formC = canonicalVowelForm(form) || form;
    const aliases = vowelFormAliases(formC);
    if (!aliases.length) aliases.push(formC);

    const title = rule.title || "";
    const structure = rule.structure || "";
    const blob = [title, structure, rule.explanation || ""].join("\n");
    const p = parseBilingualTitle(title);
    const ko = normalizeToken(p.ko);
    const ruleForm =
      extractVowelContractionForm(title, structure) ||
      canonicalVowelForm(p.ko) ||
      ko;
    const ruleFam = vowelFormFamily(ruleForm);
    const qFam = vowelFormFamily(formC);

    // 跨系一律不認（含 해≠여、해≠돼）
    if (qFam && ruleFam && qFam !== ruleFam) return false;

    // 標題括號：舊式短名 或 專項公式（하＋여→해 等）
    if (
      qFam === "hae" &&
      (/[（(]\s*해\s*[）)]/.test(title) ||
        /[（(][^）)]*하\s*[＋+]\s*여[^）)]*[）)]/.test(title) ||
        /[（(][^）)]*→\s*해[^）)]*[）)]/.test(title))
    ) {
      return true;
    }
    if (
      qFam === "yeo" &&
      (/[（(]\s*여\s*[）)]/.test(title) ||
        /[（(][^）)]*이\s*[＋+]\s*어[^）)]*[）)]/.test(title)) &&
      !/하\s*[＋+]\s*여|→\s*해/.test(title)
    ) {
      return true;
    }
    if (
      qFam === "dwae" &&
      (/[（(]\s*돼\s*[）)]/.test(title) ||
        /[（(][^）)]*되\s*[＋+]\s*어[^）)]*[）)]/.test(title) ||
        /[（(][^）)]*→\s*돼[^）)]*[）)]/.test(title))
    ) {
      return true;
    }
    if (/[（(]\s*와\s*[）)]/.test(title) && qFam === "wa") return true;
    if (/[（(]\s*워\s*[）)]/.test(title) && qFam === "wo") return true;

    // 韓語段全等／同系別名
    for (const a of aliases) {
      if (ko === a) return true;
      if (new RegExp(`[（(]\\s*${a}\\s*[）)]`).test(title)) return true;
    }
    if (ko && vowelFormsCompatible(ko, formC)) return true;

    // 結構式（各系專屬，勿用「→여」去對 해）
    const compact = blob.replace(/\s/g, "");
    if (qFam === "hae" && /하[＋+]여|하여→해|→해/.test(compact) && !/이[＋+]어/.test(compact)) {
      return true;
    }
    if (qFam === "yeo" && /이[＋+]어|이어→여|→여/.test(compact) && !/하[＋+]여|→해/.test(compact)) {
      return true;
    }
    if (qFam === "dwae" && /되[＋+]어|되어→돼|→돼/.test(compact)) return true;
    if (qFam === "wa" && /오[＋+]아|→와/.test(compact)) return true;
    if (qFam === "wo" && /우[＋+]어|→워/.test(compact)) return true;

    // 標題／結構含同系字 + 縮約語境（仍擋跨系）
    for (const a of aliases) {
      const re = new RegExp(`(^|[^\\uAC00-\\uD7A3])${a}([^\\uAC00-\\uD7A3]|$)`);
      if (
        (re.test(title) || re.test(structure)) &&
        /母音|모음|縮約|축약/.test(title + structure)
      ) {
        return true;
      }
    }
    return false;
  }

  function detectContractionQuery(name, nameKo, nameZh) {
    const blobs = [name, nameKo, nameZh].map((s) => String(s || ""));
    const joined = blobs.join("\n");
    // 明確縮約用語
    const isContractionTopic =
      /縮約|축약|contraction|줄임/i.test(joined) &&
      (/주제|主題|은\s*\/\s*는|은\/는|는/.test(joined) || /난|넌|전|우린/.test(joined));
    const isContractionObject =
      /縮約|축약|contraction|줄임/i.test(joined) &&
      (/賓格|목적|을\s*\/\s*를|을\/를|를/.test(joined) || /날|널|절|우릴/.test(joined));

    // 標題／Ko 中出現縮約形本體
    for (const form of Object.keys(PARTICLE_CONTRACTIONS)) {
      const re = new RegExp(
        `(^|[^\\uAC00-\\uD7A3])${form}([^\\uAC00-\\uD7A3]|$)`
      );
      if (blobs.some((b) => re.test(b) || normalizeToken(b) === form)) {
        return { form, ...PARTICLE_CONTRACTIONS[form], explicit: true };
      }
    }

    if (isContractionTopic) return { form: "", type: "topic", explicit: false };
    if (isContractionObject) return { form: "", type: "object", explicit: false };
    return null;
  }

  function ruleMentionsContraction(rule, form, type) {
    const blob = [rule.title, rule.explanation, rule.structure].join("\n");
    if (form && blob.includes(form)) return true;
    if (form) return false;
    if (/縮約|축약|줄임/.test(blob) && type === "topic" && /주제|主題/.test(blob)) {
      return true;
    }
    if (/縮約|축약|줄임/.test(blob) && type === "object" && /賓格/.test(blob)) {
      return true;
    }
    return false;
  }

  /**
   * 判斷本地是否已有對應規則（API「已收錄」用）
   *
   * 路由策略：
   * -【嚴格族】僅：母音縮約（해≠여≠돼）、不規則（須具體種類）
   * -【一般族】其餘一律走寬鬆正規化比對（含人稱縮約 난／날 等，不當獨立嚴格門）
   *
   * @returns {{ owned: boolean, rule: object|null, score: number }}
   */
  function findMatchingRule(nameOrItem) {
    const name =
      typeof nameOrItem === "string"
        ? nameOrItem
        : nameOrItem?.name || nameOrItem?.title || "";
    const nameKo =
      typeof nameOrItem === "object" ? nameOrItem?.nameKo || nameOrItem?.ko || "" : "";
    const nameZh =
      typeof nameOrItem === "object" ? nameOrItem?.nameZh || nameOrItem?.zh || "" : "";

    const nameNorm = normalizeToken(name);
    const nameTitleKey = normalizeTitleKey(name);
    const parsed = parseBilingualTitle(name);
    const koRaw = nameKo || parsed.ko || "";
    const zhRaw = nameZh || parsed.zh || "";
    const koNorm = normalizeToken(koRaw);
    const koKey = normalizeGrammarKey(koRaw);
    const zhNorm = normalizeToken(zhRaw).replace(/[・·‧•･]/g, "");
    const span =
      typeof nameOrItem === "object" ? String(nameOrItem?.span || "").trim() : "";

    // 易與他卡混淆的單音節標記（一般路徑：不可單靠 1 字 ko 判已收錄）
    const AMBIGUOUS_SHORT_KO = new Set([
      "는",
      "은",
      "이",
      "가",
      "을",
      "를",
      "의",
      "도",
      "만",
      "와",
      "과",
      "에",
      "고",
      "서",
      "시",
    ]);

    // ══════════════════════════════════════════
    // 【嚴格族 1】母音縮約：해 ≠ 여 ≠ 돼
    // ══════════════════════════════════════════
    const vContr = detectVowelContractionQuery(
      name,
      nameKo || parsed.ko,
      nameZh || parsed.zh,
      span
    );
    if (vContr && vContr.form) {
      const wantFam = vowelFormFamily(vContr.form);
      const wantForm = canonicalVowelForm(vContr.form) || vContr.form;
      let best = null;
      let bestScore = 0;
      for (const rule of rules) {
        let score = 0;
        if (nameNorm && normalizeToken(rule.title) === nameNorm) score += 30;
        else if (nameTitleKey && normalizeTitleKey(rule.title) === nameTitleKey) score += 28;
        if (ruleMentionsVowelContraction(rule, wantForm)) score += 22;
        const rp = parseBilingualTitle(rule.title);
        const ruleKo = normalizeToken(rp.ko);
        const ruleForm =
          extractVowelContractionForm(rule.title, rule.structure) ||
          canonicalVowelForm(rp.ko) ||
          ruleKo;
        const ruleFam = vowelFormFamily(ruleForm);
        if (ruleKo === wantForm || ruleForm === wantForm) {
          score += 24;
        } else if (vowelFormsCompatible(ruleKo, wantForm) || vowelFormsCompatible(ruleForm, wantForm)) {
          score += 18;
        }
        if (wantFam === "hae" && (ruleKo === "해요" || ruleKo === "해")) score += 12;
        if (wantFam === "yeo" && (ruleKo === "여" || ruleKo === "여요")) score += 12;
        if (wantFam === "dwae" && (ruleKo === "돼" || ruleKo === "돼요")) score += 12;
        if (
          /母音縮約|모음축약/.test(rp.zh || "") &&
          ruleMentionsVowelContraction(rule, wantForm)
        ) {
          score += 8;
        }
        if (wantFam && ruleFam && wantFam !== ruleFam) score -= 50;
        if (score > bestScore) {
          bestScore = score;
          best = rule;
        }
      }
      if (bestScore >= 12 && best) {
        return { owned: true, rule: best, score: bestScore };
      }
      return { owned: false, rule: null, score: bestScore };
    }
    // vContr 有家族無形 → 落到一般比對（仍擋裸「母音縮約」泛稱）

    // ══════════════════════════════════════════
    // 【嚴格族 2】不規則：須 ㅂ/ㄷ/ㅅ/르/ㅎ/ㅡ탈락 同種
    // ══════════════════════════════════════════
    const itemBlobEarly = [name, nameKo, nameZh, span].join("\n");
    const irrKind = extractIrregularKind(name, nameKo, nameZh, span, itemBlobEarly);
    if (irrKind === "generic") {
      // 統稱「不規則」→ 未收錄（促使寫具體種類）
      return { owned: false, rule: null, score: 0 };
    }
    if (irrKind && irrKind !== "generic") {
      let best = null;
      let bestScore = 0;
      for (const rule of rules) {
        const rk = ruleIrregularKind(rule);
        if (rk !== irrKind && !(irrKind === "eu" && isEuDeletionRule(rule))) continue;
        if (rk === "generic") continue;
        let score = 0;
        if (rk === irrKind || (irrKind === "eu" && isEuDeletionRule(rule))) score += 24;
        if (nameNorm && normalizeToken(rule.title) === nameNorm) score += 25;
        else if (nameTitleKey && normalizeTitleKey(rule.title) === nameTitleKey) score += 24;
        const rp = parseBilingualTitle(rule.title);
        const rKoKey = normalizeGrammarKey(rp.ko);
        if (koKey && rKoKey && koKey === rKoKey && koKey.length >= 1) score += 16;
        else if (koNorm && normalizeToken(rp.ko) === koNorm && koNorm.length >= 1) score += 16;
        if (rk && rk !== irrKind && rk !== "generic") score -= 40;
        if (score > bestScore) {
          bestScore = score;
          best = rule;
        }
      }
      if (bestScore >= 16 && best) {
        return { owned: true, rule: best, score: bestScore };
      }
      return { owned: false, rule: null, score: bestScore };
    }

    // ══════════════════════════════════════════
    // 【一般族】寬鬆正規化（含人稱縮約 난／날…）
    // 主鍵：正規化後韓語標記；中文別名加分
    // 人稱縮約：有專卡則優先加分，不再「對不上就整項判未收錄」
    // ══════════════════════════════════════════
    const contr = detectContractionQuery(name, nameKo || parsed.ko, nameZh || parsed.zh);

    const queryKeys = new Set();
    const addQ = (x) => expandAliasKeys(x).forEach((k) => queryKeys.add(k));
    if (nameNorm) addQ(nameNorm);
    if (nameTitleKey) addQ(nameTitleKey);
    if (koNorm) addQ(koNorm);
    if (koKey) {
      addQ(koKey);
      expandOptionalEuKeys(koKey).forEach((k) => addQ(k));
    }
    // 人稱縮約形本體入鍵（난／날…），方便對上專卡標題
    if (contr?.form) addQ(contr.form);

    const zhIsGenericVowel =
      /^(母音縮約|모음축약|元音縮約)$/i.test(zhNorm || "") ||
      /^(母音縮約|모음축약)$/i.test(nameNorm || "");
    const zhIsGenericIrr = /^(不規則|불규칙|irregular)$/i.test(zhNorm || "");
    if (zhNorm && !zhIsGenericVowel && !zhIsGenericIrr) addQ(zhNorm);
    if (koRaw) {
      String(koRaw)
        .split(/[\/／,，\s|｜]+/)
        .forEach((part) => {
          const t = normalizeGrammarKey(part);
          if (t) addQ(t);
        });
    }
    if (isEuDeletionItem(typeof nameOrItem === "object" ? nameOrItem : { name })) {
      expandAliasKeys("ㅡ 탈락").forEach((k) => queryKeys.add(k));
    }

    let best = null;
    let bestScore = 0;

    for (const rule of rules) {
      if (isSupplementaryUsage(rule)) continue; // 補充用法不自動句中標註
      const rKeys = ruleMatchKeys(rule);
      let score = 0;
      const ruleIrr = ruleIrregularKind(rule);
      const rp = parseBilingualTitle(rule.title);
      const rKoKey = normalizeGrammarKey(rp.ko);
      const rTitleKey = normalizeTitleKey(rule.title);
      const rZh = normalizeToken(rp.zh).replace(/[・·‧•･]/g, "");

      // —— 標題全等／正規化全等 ——
      if (nameNorm && normalizeToken(rule.title) === nameNorm) {
        score += 30;
      } else if (nameTitleKey && rTitleKey && nameTitleKey === rTitleKey) {
        score += 28;
      }

      // —— 人稱縮約（一般路徑加分，非嚴格門檻）——
      if (contr) {
        if (contr.form && ruleMentionsContraction(rule, contr.form, contr.type)) {
          score += 20; // 專卡（人稱主題縮約（난）等）
        } else if (!contr.form && ruleMentionsContraction(rule, "", contr.type)) {
          score += 10;
        }
        // 有明確形時：完整助詞卡略扣，避免 난 優先貼到 은/는（仍可由標題分扳回）
        if (
          contr.form &&
          !ruleMentionsContraction(rule, contr.form, contr.type) &&
          ((contr.type === "topic" && /은\s*\/\s*는|은\/는/.test(rule.title + (rule.structure || ""))) ||
            (contr.type === "object" && /을\s*\/\s*를|을\/를/.test(rule.title + (rule.structure || ""))))
        ) {
          score -= 4;
        }
      }

      // —— 中文：全等或軟別名 ——
      if (zhNorm && zhNorm.length >= 2 && !zhIsGenericVowel && !zhIsGenericIrr) {
        if (rZh === zhNorm) {
          score += 16;
        } else if (zhNamesRelated(zhNorm, rZh)) {
          score += 12;
        }
      }

      // —— 韓語標記（主鍵，從寬）——
      if (koKey && rKoKey && koKey === rKoKey) {
        if (koKey.length >= 2) {
          score += 18; // 正規化後 ≥2 字全等 → 通常已夠門檻
        } else if (/^(해|여|돼|와|워|했|됐)$/.test(koKey)) {
          score += 16;
        } else if (!AMBIGUOUS_SHORT_KO.has(koKey)) {
          score += 12;
        } else {
          score += 6; // 는／이／고… 需中文或其它分
        }
      } else if (koKey && rKoKey && koKey.length >= 2 && rKoKey.length >= 2) {
        const qEu = expandOptionalEuKeys(koKey);
        const rEu = expandOptionalEuKeys(rKoKey);
        let euHit = false;
        for (const q of qEu) {
          if (rEu.has(q)) {
            euHit = true;
            break;
          }
        }
        if (euHit) {
          score += 16;
        } else {
          const qParts = [...koKey.split("/")].map((x) => normalizeGrammarKey(x)).filter(Boolean);
          const rParts = [...rKoKey.split("/")].map((x) => normalizeGrammarKey(x)).filter(Boolean);
          let overlap = 0;
          for (const qp of qParts) {
            if (rParts.includes(qp)) {
              overlap += 1;
              continue;
            }
            for (const rp2 of rParts) {
              if (
                qp.length >= 2 &&
                rp2.length >= 2 &&
                (qp.endsWith(rp2) || rp2.endsWith(qp) || qp.includes(rp2) || rp2.includes(qp))
              ) {
                overlap += 0.5;
                break;
              }
            }
          }
          const denom = Math.max(qParts.length, rParts.length, 1);
          const ratio = overlap / denom;
          if (ratio >= 0.5 && overlap >= 1) score += 14;
          else if (overlap >= 1) score += 6;
        }
      } else if (koNorm && normalizeToken(rp.ko) === koNorm && koNorm.length >= 1) {
        score += koNorm.length >= 2 ? 16 : 6;
      }

      // 中文軟相關 + 韓語接近 → 加分
      if (
        score < 28 &&
        zhNorm &&
        !zhIsGenericVowel &&
        !zhIsGenericIrr &&
        zhNamesRelated(zhNorm, rZh) &&
        koKey &&
        rKoKey &&
        (koKey === rKoKey ||
          (koKey.length >= 2 &&
            rKoKey.length >= 2 &&
            (rKoKey.includes(koKey) || koKey.includes(rKoKey))))
      ) {
        score += 8;
      }

      // 鍵交集（탈락 等）
      for (const q of queryKeys) {
        if (
          q &&
          rKeys.has(q) &&
          (q.includes("탈락") || q.includes("脫落") || q === "ㅡ탈락" || q === "으탈락")
        ) {
          score += 12;
        }
      }

      for (const q of queryKeys) {
        if (!q) continue;
        if (/^(不規則|불규칙|irregular)$/i.test(q)) continue;
        const isShort = q.length <= 1 && !/^[ㅡ으ㅂㄷㅅㅎ]$/.test(q);
        if (rKeys.has(q)) {
          // 人稱縮約形（난 等）完全命中鍵 → 略高於一般短字
          if (contr?.form && q === contr.form) {
            score += 12;
          } else {
            score += isShort ? 4 : 10;
          }
          continue;
        }
        if (isShort) continue;
        for (const rk of rKeys) {
          if (!rk || rk.length < 2) continue;
          if (
            ruleIrr &&
            ruleIrr !== "generic" &&
            /不規則|불규칙/.test(q) &&
            /不規則|불규칙/.test(rk) &&
            !q.includes("ㅂ") &&
            !q.includes("ㄷ") &&
            !q.includes("ㅅ") &&
            !q.includes("르") &&
            !q.includes("ㅎ") &&
            !q.includes("탈락") &&
            !q.includes("脫落")
          ) {
            continue;
          }
          if (rk === q) {
            score += 10;
          } else if (q.length >= 2 && (rk.includes(q) || q.includes(rk))) {
            const shorter = rk.length <= q.length ? rk : q;
            const longer = rk.length > q.length ? rk : q;
            if (shorter.length >= 2 && longer.length <= shorter.length + 6) {
              score += 3;
            }
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = rule;
      }
    }

    // 一般族門檻：≥10；正規化 ko≥2 全等通常 ≥18
    if (bestScore >= 10 && best) {
      return { owned: true, rule: best, score: bestScore };
    }
    return { owned: false, rule: null, score: bestScore };
  }

  /**
   * 把規則標題韓語段／關鍵字展開成可搜尋的表面片段
   * 處理：前後 - ~、아/어 擇一、空白有無
   */
  function expandNeedles(raw) {
    const out = new Set();
    const base = String(raw || "").trim().normalize("NFC");
    if (!base) return [];

    const stripDecor = (s) =>
      String(s || "")
        .replace(/^[-~〜～─–—]+/, "")
        .replace(/[-~〜～─–—]+$/, "")
        .trim();

    const add = (s) => {
      const t = String(s || "").trim().normalize("NFC");
      if (!t) return;
      out.add(t);
      const noSpace = t.replace(/\s+/g, "");
      if (noSpace) out.add(noSpace);
      const stripped = stripDecor(t);
      if (stripped && stripped !== t) {
        out.add(stripped);
        out.add(stripped.replace(/\s+/g, ""));
      }
    };

    add(base);
    // 斜線／逗號分隔的擇一寫法
    for (const part of base.split(/[\/／|｜,，]/)) {
      add(part);
    }
    // 標題韓語段可能是「-아/어요」整段
    const stripped = stripDecor(base);
    if (stripped !== base) {
      for (const part of stripped.split(/[\/／|｜,，]/)) {
        add(part);
      }
    }

    return [...out].filter((n) => isUsableNeedle(n));
  }

  /** 可用於句中標記的 needle（允許單音節韓文，如 고·았·은） */
  function isUsableNeedle(n) {
    if (!n) return false;
    // 純標點／過短英數不要
    if (/^[-~〜～./／\s]+$/.test(n)) return false;
    if (n.length >= 2) return true;
    // 單字元：韓文音節即可（助詞／語尾常是 1 字）
    return /[\uAC00-\uD7A3]/.test(n);
  }

  /** 母音縮約結果形 → 句中常見表面（標題改為公式後仍要能本地掃描） */
  function vowelSurfaceNeedles(form) {
    const c = canonicalVowelForm(form) || form;
    if (c === "해" || vowelFormFamily(c) === "hae") {
      return ["해", "해요", "해서", "했어", "했다", "하였", "했", "해줘"];
    }
    if (c === "여" || vowelFormFamily(c) === "yeo") {
      // 含連寫 여줘（속삭여줘）；「보여」作範例詞
      return ["여", "여요", "여서", "여줘", "보여", "이어"];
    }
    if (c === "돼" || vowelFormFamily(c) === "dwae") {
      return ["돼", "돼요", "돼서", "됐어", "됐다", "됐", "돼줘"];
    }
    if (c === "와" || vowelFormFamily(c) === "wa") return ["와", "와요", "와서"];
    if (c === "워" || vowelFormFamily(c) === "wo") return ["워", "워요", "워서"];
    return c ? [c] : [];
  }

  /**
   * 片段是否為該母音縮約系的合法表面（拒 純 게／純 줘 等誤 span）
   * 例：해 系接受 해요／했어／해줘；여 系接受 보여／속삭여／속삭여줘
   * 不接受：單獨 줘、부드럽게 的 게
   */
  function isValidVowelSurface(form, surface) {
    const s = String(surface || "").trim().normalize("NFC");
    if (!s || !/[\uAC00-\uD7A3]/.test(s)) return false;
    const c = canonicalVowelForm(form) || form;
    const fam = vowelFormFamily(c);
    if (!fam) return false;

    // 純請托／副詞語尾：不是母音縮約表面
    if (/^(줘|줘요|주세요|주|게|고|도)$/.test(s)) return false;

    // 表面本身可推成同系（含 속삭여줘 → 여）
    const fromSurf = inferVowelFormFromSurface(s);
    if (fromSurf && vowelFormFamily(fromSurf) === fam) return true;

    // 等於或含已知表面／詞尾
    const needles = vowelSurfaceNeedles(c);
    for (const n of needles) {
      if (!n) continue;
      if (s === n) return true;
      if (s.length >= n.length && (s.endsWith(n) || s.includes(n))) {
        if (n.length === 1) {
          // 單字 여／해：須出現且後方合法（或詞尾）
          const idx = s.indexOf(n);
          if (idx < 0) continue;
          const after = s[idx + 1];
          if (isAllowedAfterVowelResult(after)) return true;
          continue;
        }
        return true;
      }
    }

    // 後備：片段內含該系結果字（했어요、속삭여줘）
    if (fam === "hae" && /해|했|하여/.test(s) && !/^여|여요|여서|여줘/.test(s)) return true;
    if (fam === "yeo" && /여/.test(s) && !/해|했|하여|하\s*[＋+]/.test(s)) return true;
    if (fam === "dwae" && /돼|됐|되어/.test(s)) return true;

    return false;
  }

  /**
   * 單字縮約音節命中是否可用（여＋줘、해＋요 等連寫算合法）
   */
  function filterVowelSyllableLocs(src, locs) {
    return (locs || []).filter((l) => {
      const after = src[l.end];
      return isAllowedAfterVowelResult(after);
    });
  }

  /** 句中是否出現該系至少一處合法表面 */
  function sentenceHasVowelSurface(text, form) {
    const src = String(text || "").normalize("NFC");
    if (!src) return false;
    const c = canonicalVowelForm(form) || form;
    const fam = vowelFormFamily(c);
    if (!fam) return false;

    const needles = vowelSurfaceNeedles(c).sort((a, b) => b.length - a.length);
    for (const n of needles) {
      if (!n || !src.includes(n)) continue;
      let locs = locateNeedle(src, n);
      if (n.length === 1) {
        locs = filterVowelSyllableLocs(src, locs);
      }
      if (locs.length) return true;
    }

    // 後備：整句／子串可被推成同系（속삭여줘 即使 needle 過濾漏網）
    if (inferVowelFormFromSurface(src) && vowelFormFamily(inferVowelFormFromSurface(src)) === fam) {
      return true;
    }
    // 掃每個含該結果字的窗口
    const core = c === "해" || fam === "hae" ? "해" : c === "여" || fam === "yeo" ? "여" : c === "돼" || fam === "dwae" ? "돼" : c;
    if (core && core.length === 1) {
      for (let i = 0; i < src.length; i++) {
        if (src[i] !== core) continue;
        if (!isAllowedAfterVowelResult(src[i + 1])) continue;
        // 取含前後的片段再驗
        const win = src.slice(Math.max(0, i - 4), Math.min(src.length, i + 3));
        if (isValidVowelSurface(c, win) || isValidVowelSurface(c, src.slice(i, i + 2))) {
          return true;
        }
      }
    }
    return false;
  }

  /** 規則是否為母音縮約專項卡 */
  function isVowelContractionRule(rule) {
    if (!rule) return false;
    const form = extractVowelContractionForm(rule.title, rule.structure);
    return Boolean(form && vowelFormFamily(form));
  }

  /** 收集一則規則的所有搜尋針（標題韓語段；母音縮約／請托 等補句中表面） */
  function collectRuleNeedles(rule) {
    const raws = [];
    const p = parseBilingualTitle(rule.title);
    if (p.ko) raws.push(p.ko);
    if (rule.structure) raws.push(String(rule.structure));
    const needles = new Set();
    for (const r of raws) {
      for (const n of expandNeedles(r)) {
        // 略過純公式碎片（하、여 中間形）若整段含 ＋／→
        if (/[＋+→]/.test(r) && n.length <= 1) continue;
        if (/[＋+→]/.test(n)) continue;
        // 去掉前綴 - ～
        const stripped = String(n).replace(/^[-~〜～─–—\s]+/, "").trim();
        if (stripped) needles.add(stripped);
        needles.add(n);
      }
    }
    // 母音縮約（하＋여→해）等：括號不是單一表面，補 해／해요…
    const vForm = extractVowelContractionForm(rule.title, rule.structure);
    if (vForm) {
      for (const s of vowelSurfaceNeedles(vForm)) {
        if (s) needles.add(s);
      }
    }
    // 命令／請托 -아/어 주다：標題常寫「-아/어 줘」抽象式，句中是 줘／주세요
    const blob = [rule.title, rule.structure, rule.explanation || ""].join("\n");
    if (
      /命令|請托|拜托|아\s*\/\s*어\s*주|어\s*주|아\s*주|주다|給我|請.?給|benefact/i.test(blob) ||
      /줘|주세요|줘요/.test(blob)
    ) {
      ["줘", "줘요", "주세요", "주셔", "해 줘", "해줘"].forEach((s) => needles.add(s));
    }
    return [...needles].filter((n) => isUsableNeedle(n));
  }

  /**
   * 在原文中找 needle；若直接找不到，用「忽略空白」的正規化對位
   * @returns {{ start: number, end: number, text: string }[]}
   */
  function locateNeedle(src, needle) {
    const found = [];
    if (!src || !needle) return found;
    const n = String(needle).normalize("NFC");

    // 1) 原文精確
    let from = 0;
    while (from < src.length) {
      const idx = src.indexOf(n, from);
      if (idx < 0) break;
      found.push({ start: idx, end: idx + n.length, text: src.slice(idx, idx + n.length) });
      from = idx + Math.max(1, n.length);
    }
    if (found.length) return found;

    // 2) 忽略空白：建 norm ↔ 原文索引映射
    const map = [];
    let norm = "";
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (/\s/.test(ch)) continue;
      map.push(i);
      norm += ch;
    }
    norm = norm.normalize("NFC");
    const nNorm = n.replace(/\s+/g, "").normalize("NFC");
    if (!nNorm || nNorm.length < 1) return found;

    from = 0;
    while (from <= norm.length - nNorm.length) {
      const idx = norm.indexOf(nNorm, from);
      if (idx < 0) break;
      const start = map[idx];
      const endChar = map[idx + nNorm.length - 1];
      if (start == null || endChar == null) break;
      const end = endChar + 1;
      found.push({ start, end, text: src.slice(start, end) });
      from = idx + nNorm.length;
    }
    return found;
  }

  function isHangulSyllable(ch) {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  /* —— Hangul jamo／開音節融合（方案 B）—— */
  const JONG_SS = 20; // 받침 ㅆ
  /** 詞彙本身帶 ㅆ 받침、不是「開音節＋았/었」融合的音節 */
  const LEXICAL_SS_SYLLABLES = new Set(["있"]);

  function decomposeHangul(ch) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    const jong = code % 28;
    const jung = Math.floor(code / 28) % 21;
    const cho = Math.floor(code / 28 / 21);
    return { cho, jung, jong, code };
  }

  /** 去掉받침 → 開音節（갔→가，했→해） */
  function stripBatchim(ch) {
    const d = decomposeHangul(ch);
    if (!d || d.jong === 0) return ch;
    return String.fromCharCode(0xac00 + d.code - d.jong);
  }

  /**
   * 規則是否應對「ㅆ받침過去融合」敏感
   * （過去 -았/었- 等；開音節時標記併入前字）
   */
  function ruleWantsPastFusion(rule) {
    if (!rule) return false;
    const title = rule.title || "";
    // 母音縮約說明裡會提到「過去 하＋였→했」，但本身不是過去標記卡
    if (/母音\s*縮約|모음\s*축약|元音\s*縮約/i.test(title)) return false;
    const blob = [title, rule.category, rule.structure, rule.explanation].join("\n");
    if (/冠形|主題助詞|관형/.test(blob) && !/過去|과거|았|었/.test(blob)) return false;
    // 標題明確是過去，或結構／說明以過去標記為主題
    if (/過去|과거/.test(title) && /았|었|였|ㅆ/.test(blob)) return true;
    return /(?:^|[^가-힣])(?:았|었|였)|ㅆ받침|았\s*\/\s*었|았\/었/.test(blob) &&
      /過去|과거|時態|시제/.test(blob);
  }

  function isPastRelatedNeedle(needle) {
    const n = String(needle || "");
    return /았|었|였|ㅆ받침/.test(n);
  }

  /**
   * 掃描開音節＋았/었 併成 ㅆ받침 的位置（가＋았→갔，하＋였→했）
   * @returns {{ start, end, text, kind, openStem, note }[]}
   */
  function findPastSsFusions(src) {
    const text = String(src || "");
    const results = [];
    // 融合後常見後接（語尾／連結）
    const PAST_FOLLOW =
      /^(어|아|여|요|다|고|지|습|습니|네|죠|군|구|는|니|면|며|서|도|만|을|를|으|ㅂ|았|었|던|을까|을래|으면|어서|아서)/;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (!isHangulSyllable(ch)) continue;
      const d = decomposeHangul(ch);
      if (!d || d.jong !== JONG_SS) continue;
      if (LEXICAL_SS_SYLLABLES.has(ch)) continue;

      const afterTrim = text.slice(i + 1).replace(/^\s+/, "");
      if (!afterTrim || /^[.!?,，。…·~]/.test(afterTrim)) {
        // 句末單獨「갔」過弱，略過
        continue;
      }
      if (!PAST_FOLLOW.test(afterTrim)) continue;

      const openStem = stripBatchim(ch);
      let note;
      if (ch === "했") {
        note = `開音節融合：${ch} ← 하＋였（ㅆ받침）`;
      } else if (ch === "됐") {
        note = `開音節融合：${ch} ← 되＋었（ㅆ받침）`;
      } else {
        note = `開音節融合：${ch} ← ${openStem}＋았/었（ㅆ받침）`;
      }

      results.push({
        start: i,
        end: i + 1,
        text: ch,
        kind: "past-ss",
        openStem,
        note,
      });
    }
    return results;
  }

  /** 為過去類規則補上融合 span */
  function fusionLocsForRule(src, rule) {
    if (!ruleWantsPastFusion(rule)) return [];
    return findPastSsFusions(src).map((f) => ({
      start: f.start,
      end: f.end,
      text: f.text,
      fusionNote: f.note,
      kind: f.kind,
    }));
  }

  /** 는 前的同一詞詞幹（連續韓文） */
  function hangulStemBefore(src, start) {
    let i = start - 1;
    while (i >= 0 && isHangulSyllable(src[i])) i--;
    return src.slice(i + 1, start);
  }

  /**
   * 規則是否涉及「는」歧義：主題助詞 은/는 vs 冠形詞形 -는
   * @returns {'topic'|'adnominal'|null}
   */
  function ruleNeunSense(rule) {
    if (!rule) return null;
    const blob = [rule.title, rule.category, rule.explanation, rule.structure].join("\n");
    // 冠形（定語）形：동사의 관형사형 -는
    if (/冠形|관형|定語形|修飾形|adnominal|attributive/i.test(blob)) return "adnominal";
    if (/主題助詞|화제\s*조사|topic\s*particle/i.test(blob)) return "topic";
    if (rule.category === "助詞" && /은\s*\/\s*는|은\/는/.test(rule.title)) return "topic";
    // 標題韓語段為單純 -는 且分類為語尾／活用 → 冠形
    const ko = parseBilingualTitle(rule.title).ko;
    if (/^-?는$/.test(ko.replace(/\s/g, "")) && /語尾|活用|連接/.test(rule.category || "")) {
      return "adnominal";
    }
    return null;
  }

  /**
   * 判斷句中某個「는」比較像主題助詞還是冠形詞形
   * @returns {'topic'|'adnominal'|'unknown'}
   */
  function classifyNeunAt(src, start, end) {
    const surface = src.slice(start, end);
    if (surface !== "는") return "unknown";

    const stem = hangulStemBefore(src, start);
    const after = src.slice(end);
    const afterTrim = after.replace(/^\s+/, "");

    // —— 強特徵：主題 ——
    // 人稱／指示代詞 + 는
    if (/^(나|너|저|우리|너희|저희|당신)$/.test(stem)) return "topic";
    // 這／那＋는（이것+은 較多，但 그건／난 等縮約另議）
    if (/^(그것|이것|저것|그거|이거|저거|여기|거기|저기)$/.test(stem)) return "topic";

    // 冠形後常見中心語（사람／것／때…）
    const ADN_HEAD =
      /^(사람|것|거|때|곳|날|집|분|중|듯|수|줄|편|말|일|길|쪽|책|영화|음식|친구|학생|소식|이야기|문제|방법|이유|동안|사이|만큼|쪽|방향|기분|소리|모습|일|점|부분|경우)/;

    if (ADN_HEAD.test(afterTrim)) return "adnominal";

    // 常見動詞／存在詞詞幹 + 는 → 冠形
    const verbStemRe =
      /^(가|오|하|보|사|먹|읽|듣|걷|살|죽|놀|울|웃|입|벗|씻|쓰|끄|켜|열|닫|주|받|찾|있|없|타|매|찍|눕|앉|서|뛰|날|되|돼|돕|묻|싣|짓|낫|모르|부르|빠르|가르치|배우|생각하|좋아하|공부하|이야기하|출발하|도착하|시작하|끝나|만들|올리|내리|기다리|다니|생기|없어지)/;

    if (stem && (verbStemRe.test(stem) || /하$/.test(stem))) {
      // 있는데／는지 等接續，不當成冠形中心
      if (/^(데|지|걸|게|군|구|데\.|데요|데요)/.test(afterTrim)) return "unknown";
      // 뒤에 명사·관형 수식 대상
      if (afterTrim && isHangulSyllable(afterTrim[0])) {
        if (!/^(요|다|습니다|ㅂ니다|네요|죠|세요|ㅂ시다)/.test(afterTrim)) {
          return "adnominal";
        }
      }
      // 문말·문장부호 직전이면 불완전 관형일 수 있음
      if (!afterTrim || /^[.!?,，。…·~]/.test(afterTrim)) return "adnominal";
    }

    // —— 主題：뒤에 부사·동사 서술 전형 ——
    if (
      /^(안|못|잘|진짜|정말|매우|아주|너무|더|덜|좀|또|그냥|바로|이미|아직|항상|자주|가끔|다|전부|모두|별로|전혀|왜|어떻게|언제|어디|누가|뭘|무엇)/.test(
        afterTrim
      )
    ) {
      return "topic";
    }
    // 나는 학생이에요／커피는 마셨어요
    if (
      afterTrim &&
      isHangulSyllable(afterTrim[0]) &&
      stem.length >= 2 &&
      !verbStemRe.test(stem) &&
      !/하$/.test(stem)
    ) {
      return "topic";
    }
    if (!afterTrim || /^[.!?,，。…·~\s]/.test(afterTrim)) {
      if (stem.length >= 1 && !verbStemRe.test(stem) && !/하$/.test(stem)) return "topic";
    }

    // 單音節非動詞詞幹 + 는 + 敘述 → 主題（예: 차는）
    if (stem.length === 1 && !verbStemRe.test(stem) && afterTrim && isHangulSyllable(afterTrim[0])) {
      return "topic";
    }

    return "unknown";
  }

  /**
   * 以「이／가」等結尾、但不是主格助詞的固定詞／副詞
   * 例：듯이 的 이 ≠ 主格 이
   */
  const LEXICAL_ENDING_WITH_PARTICLE = {
    이: [
      "듯이",
      "같이",
      "없이",
      "굳이",
      "특히",
      "역시",
      "다시",
      "즉시",
      "갑자기",
      "천천히",
      "간단히",
      "분명히",
      "충분히",
      "완전히",
      "조용히",
      "솔직히",
      "확실히",
    ],
    가: [],
    // 만：連接／數量詞內的 만，不是「只有」助詞
    만: ["다만", "하지만", "천만", "백만", "일만", "수만", "얼마만"],
    // 도：部分副詞／連接不是「也」
    도: ["그래도", "하도"],
  };

  function isLexicalNotParticle(src, start, end, particle) {
    const p = String(particle || "").normalize("NFC");
    if (!p || end - start !== p.length) return false;

    // 往左／右擴成連續韓文區塊
    let left = start;
    while (left > 0 && isHangulSyllable(src[left - 1])) left--;
    let right = end;
    while (right < src.length && isHangulSyllable(src[right])) right++;
    const word = src.slice(left, right);

    const list = LEXICAL_ENDING_WITH_PARTICLE[p] || [];
    for (const w of list) {
      if (word === w || word.endsWith(w)) return true;
    }

    // —— 을／를：賓格一定黏在體詞後；後面常直接接謂語（무공백）——
    // 不可用「後面還有韓文＝詞中間」過濾，否則 영화를봤어요 會整段被丟掉
    if (p === "을" || p === "를") {
      // 前面必須有體詞音節
      if (start <= left) return true; // 句首孤 를 不像賓格
      return false;
    }

    // —— 은／는：主題助詞同樣可無空格接後文 ——
    if (p === "은" || p === "는") {
      if (start <= left) return true;
      return false; // 細分交由 classifyNeunAt
    }

    // —— 만／도：黏在體詞後；句首孤字不像助詞 ——
    if (p === "만" || p === "도") {
      if (start <= left) return true;
      return false;
    }

    // 主格 이：듯／같／없＋이 → 듯이／같이／없이
    if (p === "이" && start >= 1) {
      const prev = src[start - 1];
      if (prev === "듯" || prev === "같" || prev === "없") return true;
    }

    // 主格 가：…다가 接續
    if (p === "가" && start >= 1 && src[start - 1] === "다") {
      return true;
    }

    // 이 在詞首黏著：이것、이런、이야기…（非「名詞＋主格이」）
    if (p === "이" && start === left && right > end) {
      if (!/^\s/.test(src[end] || "")) return true;
    }

    // 가 在詞首：가다 等 — 主格가 必須前有體詞
    if (p === "가" && start <= left) return true;

    // 이 作主格時前面要有體詞
    if (p === "이" && start <= left) return true;

    return false;
  }

  function ruleIsSubjectParticle(rule) {
    if (!rule) return false;
    const t = rule.title || "";
    return /主格助詞|주격|이\s*\/\s*가|이\/가/.test(t) || rule.category === "助詞" && /이\/가/.test(t);
  }

  function ruleIsObjectParticle(rule) {
    if (!rule) return false;
    return /賓格助詞|목적격|을\s*\/\s*를|을\/를/.test(rule.title || "");
  }

  /**
   * 依規則語意過濾位置：는 歧義、이/가 非助詞固定詞等
   */
  function filterLocsForRule(src, locs, rule, needle) {
    const n = String(needle || "").normalize("NFC");
    const sense = ruleNeunSense(rule);

    return locs.filter((loc) => {
      // 듯이 等：單音節助詞針落在固定詞內 → 丟棄
      if (n.length <= 2 && isLexicalNotParticle(src, loc.start, loc.end, n)) {
        return false;
      }
      // 主格規則特別嚴
      if (ruleIsSubjectParticle(rule) && (n === "이" || n === "가")) {
        if (isLexicalNotParticle(src, loc.start, loc.end, n)) return false;
      }

      if (n === "는" && sense) {
        const role = classifyNeunAt(src, loc.start, loc.end);
        if (role === "unknown") return sense === "topic";
        return role === sense;
      }
      return true;
    });
  }

  /**
   * 助詞／語尾類：上色應落在語素本身，不要整段名詞（치마를→를，짧은→은，너만→만）
   * FOCUS：偵測焦點用（含 에서／으로 等較長形）
   * SHRINK：無焦點時的尾綴收縮，勿含 로（바로→로 誤縮）
   */
  const PARTICLE_LIKE = [
    "를",
    "을",
    "은",
    "는",
    "이",
    "가",
    "의",
    "에서",
    "에",
    "도",
    "만",
    "와",
    "과",
    "으로",
    "로",
    "께",
    "한테",
    "에게",
    "부터",
    "까지",
    "처럼",
    "보다",
  ];
  const PARTICLE_LIKE_SHRINK = ["를", "을", "은", "는", "이", "가", "의", "에", "도", "만", "와", "과"];

  /**
   * 從標題／nameKo 抽出「應上色的語素」（括號韓語、斜線擇一）
   * 例：限定助詞（만）→ ["만"]；은/는 → ["은","는"]
   */
  function extractGrammarMorphemes(...sources) {
    const out = [];
    const seen = new Set();
    const push = (s) => {
      const t = String(s || "")
        .trim()
        .normalize("NFC")
        .replace(/^[-~〜～─–—\s]+/, "")
        .replace(/[-~〜～─–—\s]+$/, "");
      if (!t || seen.has(t)) return;
      // 只要含韓文的短語素
      if (!/[\uAC00-\uD7A3]/.test(t)) return;
      if (t.length > 6) return;
      seen.add(t);
      out.push(t);
    };
    for (const raw of sources) {
      const s = String(raw || "").trim();
      if (!s) continue;
      const parsed = parseBilingualTitle(s);
      if (parsed.ko) {
        parsed.ko.split(/[\/／|｜,，\s]+/).forEach(push);
        push(parsed.ko.replace(/[\/／|｜,，\s]+/g, ""));
      }
      // 無括號時整段當 Ko
      if (!parsed.ko && /^[\uAC00-\uD7A3\/／|｜,，\-\s~〜]+$/.test(s)) {
        s.split(/[\/／|｜,，\s]+/).forEach(push);
      }
      // 裸 nameKo
      String(s)
        .match(/[\uAC00-\uD7A3]{1,6}/g)
        ?.forEach(push);
    }
    return out;
  }

  /** 音節是否有 ㄴ 받침（예쁜·큰 的 -ㄴ 冠形，不是獨立字 은） */
  function hasNieunBatchim(ch) {
    const c = String(ch || "");
    if (!c || c.length < 1) return false;
    const code = c.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    const jong = (code - 0xac00) % 28;
    return jong === 4; // ㄴ
  }

  /**
   * 冠形 -ㄴ/은 定位：은 獨立音節 或 末字 ㄴ받침
   * 例：작은→은；예쁜／큰→末音節（batchim ㄴ）
   */
  function locateAdnominalNEun(text, item, rule) {
    const src = String(text || "");
    const hits = [];
    const seen = new Set();
    const push = (start, end, needle) => {
      if (start < 0 || end <= start || end > src.length) return;
      const k = start + "-" + end;
      if (seen.has(k)) return;
      seen.add(k);
      hits.push({
        start,
        end,
        text: src.slice(start, end),
        needle: needle || src.slice(start, end),
      });
    };

    // 1) 獨立音節 은（작은、좋은）— 排除主題助詞語境可選寬鬆
    for (const loc of locateNeedle(src, "은")) {
      if (isLexicalNotParticle(src, loc.start, loc.end, "은")) continue;
      // 冠形 은 前應有詞幹；後常接名詞
      const after = src.slice(loc.end).replace(/^\s+/, "");
      const beforeOk = loc.start > 0 && isHangulSyllable(src[loc.start - 1]);
      if (!beforeOk) continue;
      // 若像主題（은 後直接是動詞敘述且前是體詞）仍可能誤中；有 span 時再篩
      push(loc.start, loc.end, "은");
    }

    // 2) API span：예쁜、큰、짧은
    const spanHint = String(item?.span || "").trim().normalize("NFC");
    function addFromSurface(surface, baseIdx) {
      if (!surface || baseIdx < 0) return;
      const last = surface[surface.length - 1];
      const lastStart = baseIdx + surface.length - 1;
      const lastEnd = baseIdx + surface.length;
      if (last === "은") {
        push(lastStart, lastEnd, "은");
      } else if (hasNieunBatchim(last)) {
        // 標最後一個音節（含 ㄴ받침）
        push(lastStart, lastEnd, "ㄴ");
      } else if (last === "는") {
        // 動詞冠形 -는 有時混在 span
        push(lastStart, lastEnd, "는");
      } else if (/[\uAC00-\uD7A3]/.test(surface)) {
        push(baseIdx, baseIdx + surface.length, surface);
      }
    }

    if (spanHint && src.includes(spanHint)) {
      let from = 0;
      while (from < src.length) {
        const idx = src.indexOf(spanHint, from);
        if (idx < 0) break;
        addFromSurface(spanHint, idx);
        from = idx + Math.max(1, spanHint.length);
      }
    }

    // 3) 掃連續韓文詞：詞尾 은 或 ㄴ받침，且後面像名詞中心語
    const ADN_HEAD =
      /^(사람|것|거|때|곳|날|집|분|중|듯|수|줄|편|말|일|길|쪽|책|영화|음식|친구|학생|소식|이야기|문제|방법|이유|동안|사이|기분|소리|모습|점|부분|경우|옷|색|맛|집|방|길|물|밥|차|꽃|나무|하늘|마음)/;
    let i = 0;
    while (i < src.length) {
      if (!isHangulSyllable(src[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && isHangulSyllable(src[j])) j++;
      const word = src.slice(i, j);
      const last = word[word.length - 1];
      const after = src.slice(j).replace(/^\s+/, "");
      const looksAdn = !after || ADN_HEAD.test(after) || (after && isHangulSyllable(after[0]));
      if (looksAdn && word.length >= 1) {
        if (last === "은" && word.length >= 2) {
          push(j - 1, j, "은");
        } else if (hasNieunBatchim(last)) {
          // 큰 사람（單音節+ㄴ받침）或 예쁜；有中心語／span 時才標
          if (
            word.length >= 2 ||
            ADN_HEAD.test(after) ||
            (spanHint && (spanHint === word || spanHint.endsWith(last)))
          ) {
            push(j - 1, j, "ㄴ");
          }
        }
      }
      i = j;
    }

    // span 優先
    if (spanHint && src.includes(spanHint)) {
      const s0 = src.indexOf(spanHint);
      const s1 = s0 + spanHint.length;
      const inside = hits.filter((h) => h.start >= s0 && h.end <= s1);
      if (inside.length) return inside;
      const near = hits.filter((h) => h.start >= s0 && h.start <= s1 + 1);
      if (near.length) return near;
    }
    return hits;
  }

  function detectParticleFocus(itemBlob, rule, item) {
    const b = String(itemBlob || "");
    const t = rule?.title || "";
    const joined = `${b}\n${t}`;
    if (/賓格|을\s*\/\s*를|을\/를/.test(joined) || ruleIsObjectParticle(rule)) {
      return ["를", "을"];
    }
    if (/主格|이\s*\/\s*가|이\/가/.test(joined) || ruleIsSubjectParticle(rule)) {
      return ["이", "가"];
    }
    if (/主題助詞|은\s*\/\s*는|은\/는/.test(joined) || (/主題/.test(t) && /助詞/.test(joined))) {
      return ["은", "는"];
    }
    // 冠形：動詞 -는 vs 形容詞 -ㄴ/은 分開
    if (/冠形|관형|定語|adnominal|attributive/i.test(joined)) {
      const ko = parseBilingualTitle(t || item?.name || "").ko || String(item?.nameKo || "");
      const onlyNeun =
        /^-?는$/.test(ko.replace(/\s/g, "")) ||
        (/는/.test(joined) && !/ㄴ\s*\/\s*은|-ㄴ|／은|\/은|-은/.test(joined) && !/ㄴ\/은/.test(joined));
      const onlyNEun =
        /ㄴ\s*\/\s*은|-ㄴ\/은|／은|-은|形容詞.*冠形|冠形.*形容/.test(joined) ||
        /^-?ㄴ\s*\/\s*은$/.test(ko.replace(/\s/g, "")) ||
        /^-?은$/.test(ko.replace(/\s/g, ""));
      if (onlyNEun && !onlyNeun) return ["은", "ㄴ"]; // 形容詞冠形
      if (onlyNeun && !onlyNEun) return ["는"]; // 動詞冠形
      // 泛稱「冠形」兩者都試
      return ["은", "는", "ㄴ"];
    }
    // 限定／也／所有… 等單助詞（너만→만，나도→도）— 用括號韓語或明確中文名，避免泛稱「보조사」誤判
    if (
      /[（(]\s*만\s*[）)]/.test(joined) ||
      /限定助詞|한정\s*조사|只有（만）|助詞（만）/.test(joined) ||
      (/(?:^|[\s、,，])만(?:$|[\s、,，/／])/.test(String(item?.nameKo || "")) &&
        /助詞|조사|限定|only/i.test(joined))
    ) {
      return ["만"];
    }
    if (
      /[（(]\s*도\s*[）)]/.test(joined) ||
      /助詞（도）|也（도）|同樣（도）|보조사（도）/.test(joined)
    ) {
      return ["도"];
    }
    if (/所有格|所有助詞|[（(]\s*의\s*[）)]|助詞（의）/.test(joined)) {
      return ["의"];
    }
    if (/[（(]\s*에\s*\/\s*에서\s*[）)]|에\/에서|處所助詞/.test(joined)) {
      return ["에서", "에"];
    }
    if (/[（(]\s*에서\s*[）)]/.test(joined)) return ["에서"];
    if (/[（(]\s*에\s*[）)]/.test(joined) && /助詞|처소|處所|方向|時間/.test(joined)) {
      return ["에"];
    }
    if (/共同|와\s*\/\s*과|와\/과|[（(]\s*와\s*\/\s*과\s*[）)]|助詞（와\/과）/.test(joined)) {
      return ["와", "과"];
    }
    if (/手段|工具|으로\s*\/\s*로|으로\/로|[（(]\s*으로\s*\/\s*로\s*[）)]/.test(joined)) {
      return ["으로", "로"];
    }
    if (/[（(]\s*부터\s*[）)]/.test(joined)) return ["부터"];
    if (/[（(]\s*까지\s*[）)]/.test(joined)) return ["까지"];
    if (/[（(]\s*처럼\s*[）)]/.test(joined)) return ["처럼"];
    if (/[（(]\s*보다\s*[）)]/.test(joined)) return ["보다"];
    if (/[（(]\s*께\s*[）)]/.test(joined)) return ["께"];
    if (/[（(]\s*한테\s*[）)]|[（(]\s*에게\s*[）)]|한테\/에게/.test(joined)) {
      return ["한테", "에게"];
    }

    // 後備：標題／nameKo 本身就是已知助詞語素 → 只標該語素（너만 的 만）
    const morphs = extractGrammarMorphemes(
      rule?.title,
      item?.name,
      item?.nameKo
    );
    const particleMorphs = morphs.filter((m) => PARTICLE_LIKE.includes(m));
    // 標題韓語段拆開後「全部」都是助詞（만、도、와/과…）
    if (particleMorphs.length > 0) {
      const nonParticle = morphs.filter((m) => !PARTICLE_LIKE.includes(m) && m.length <= 4);
      if (nonParticle.length === 0) {
        return [...new Set(particleMorphs)].sort((a, b) => b.length - a.length);
      }
    }
    const koOnly = String(item?.nameKo || "")
      .trim()
      .normalize("NFC")
      .replace(/^[-~〜]+/, "")
      .replace(/[-~〜]+$/, "");
    if (PARTICLE_LIKE.includes(koOnly)) return [koOnly];
    const titleKo = parseBilingualTitle(rule?.title || item?.name || "").ko;
    if (titleKo) {
      const parts = titleKo
        .split(/[\/／|｜,，\s]+/)
        .map((p) => p.replace(/^[-~〜]+/, "").replace(/[-~〜]+$/, "").trim())
        .filter(Boolean);
      if (parts.length && parts.every((p) => PARTICLE_LIKE.includes(p))) {
        return parts.sort((a, b) => b.length - a.length);
      }
      if (parts.length === 1 && PARTICLE_LIKE.includes(parts[0])) return parts;
    }

    return null;
  }

  /**
   * 若命中片段以助詞／語尾結尾，縮小到該語素（치마를→를，짧은→은，너만→만）
   */
  function shrinkToEnding(text, loc, endings) {
    if (!loc || !endings?.length) return loc;
    const slice = text.slice(loc.start, loc.end);
    const sorted = endings.filter(Boolean).sort((a, b) => b.length - a.length);
    for (const e of sorted) {
      if (e === "ㄴ") continue; // 자모 alone 難對表面
      if (slice.endsWith(e)) {
        const start = loc.end - e.length;
        return {
          start,
          end: loc.end,
          text: text.slice(start, loc.end),
          needle: e,
        };
      }
    }
    return loc;
  }

  /**
   * 命中宿主詞後，若緊接／尾綴為目標助詞，改標助詞（span「너」+ 만 → 만）
   */
  function preferParticleNearLoc(text, loc, endings) {
    if (!loc || !endings?.length) return loc;
    const shrunk = shrinkToEnding(text, loc, endings);
    if (shrunk !== loc && shrunk.needle) return shrunk;

    // 宿主本身不含助詞：看緊接在後的語素（너|만）
    for (const e of endings.filter(Boolean).sort((a, b) => b.length - a.length)) {
      if (e === "ㄴ") continue;
      const after = text.slice(loc.end, loc.end + e.length);
      if (after === e) {
        // 同一連續韓文區塊內（너만）或允許無空白黏著
        return {
          start: loc.end,
          end: loc.end + e.length,
          text: e,
          needle: e,
        };
      }
    }
    return loc;
  }

  /**
   * 在文中找助詞／語尾音節（可多處）；通過語境過濾
   */
  function locateParticleSyllables(text, endings, rule) {
    const hits = [];
    for (const needle of endings) {
      if (!needle || needle === "ㄴ" || !text.includes(needle)) continue;
      let locs = locateNeedle(text, needle);
      locs = filterLocsForRule(text, locs, rule || { title: "", category: "" }, needle);
      locs = locs.filter((l) => !isLexicalNotParticle(text, l.start, l.end, needle));
      for (const l of locs) {
        hits.push({ ...l, needle });
      }
    }
    // 去重
    const seen = new Set();
    return hits.filter((h) => {
      const k = h.start + "-" + h.end;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * 依 span 提示篩選助詞命中：在 span 內 → 緊接 span 後 → 同一詞尾
   * 例：span「너」文法 만 → 取 너 後的 만；span「너만」→ 取內部 만
   */
  function pickHitsNearSpan(text, hits, spanHint) {
    if (!hits?.length) return [];
    const hint = String(spanHint || "").trim();
    if (!hint || !text.includes(hint)) return hits;

    const s0 = text.indexOf(hint);
    const s1 = s0 + hint.length;
    const inside = hits.filter((h) => h.start >= s0 && h.end <= s1);
    if (inside.length) return inside;

    // span 是宿主（치마／너）：助詞緊接在後
    const after = hits.filter((h) => h.start >= s0 && h.start <= s1 + 1 && h.start >= s1 - 1);
    // 更寬鬆：同一連續韓文詞內、落在 span 右側
    let left = s0;
    while (left > 0 && isHangulSyllable(text[left - 1])) left--;
    let right = s1;
    while (right < text.length && isHangulSyllable(text[right])) right++;
    const sameWord = hits.filter((h) => h.start >= left && h.end <= right && h.start >= s0);
    if (after.length) return after;
    if (sameWord.length) return sameWord;

    // span 誤指宿主、助詞在同一詞：仍優先 sameWord 已空則退回全部 hits（勿標到句中別處）
    const inWord = hits.filter((h) => h.start >= left && h.end <= right);
    if (inWord.length) return inWord;
    return hits;
  }

  /**
   * API 盤點項目在原文中定位（盡量找到可上色片段，減少「句中未定位」）
   * 助詞／冠形類：優先標在 은·를·만 等語素上，避免標整段 치마／너
   * @returns {{ start, end, text, needle }[]}
   */
  function locateApiItemInText(src, item) {
    const text = String(src || "");
    if (!text || !item) return [];

    const candidates = new Set();
    /** 文法本體針（nameKo／標題韓語）— 優先於 span 宿主、note 例詞 */
    const preferred = new Set();

    function addCand(raw, opts = {}) {
      const asPreferred = Boolean(opts.preferred);
      let s = String(raw || "").trim().normalize("NFC");
      if (!s) return;
      const addOne = (x) => {
        if (!x) return;
        candidates.add(x);
        if (asPreferred) preferred.add(x);
      };
      addOne(s);
      const stripped = s
        .replace(/^[-~〜～─–—\s]+/, "")
        .replace(/[-~〜～─–—\s]+$/, "")
        .trim();
      if (stripped) addOne(stripped);
      const noParen = stripped.replace(/[()（）\[\]【】]/g, "").trim();
      if (noParen) addOne(noParen);
      noParen.split(/[\/／|｜,，]/).forEach((p) => {
        const t = p
          .trim()
          .replace(/^[-~〜～]+/, "")
          .replace(/[-~〜～]+$/, "");
        if (t) addOne(t);
      });
      try {
        expandNeedles(s).forEach((n) => addOne(n));
      } catch {
        /* ignore */
      }
      // 拆連續韓文：僅 preferred 來源才拆成單字（避免 note「너만」把 너 抬成候選搶色）
      if (asPreferred) {
        const runs = s.match(/[\uAC00-\uD7A3]+/g);
        if (runs) runs.forEach((r) => addOne(r));
      }
    }

    // 文法標記優先；span 只當位置提示，不拆成 너／만 搶優先
    addCand(item.nameKo, { preferred: true });
    addCand(item.name, { preferred: true });
    const parsed = parseBilingualTitle(item.name || "");
    addCand(parsed.ko, { preferred: true });
    if (item.span) {
      const sp = String(item.span).trim().normalize("NFC");
      if (sp) {
        candidates.add(sp);
        preferred.add(sp);
      }
    }
    addCand(item.nameZh);

    // note 只取短韓文整段（≤6），不拆單字，避免「如 너만」→ 너 先於 만
    if (item.note) {
      const noteRuns = String(item.note).match(/[\uAC00-\uD7A3]+/g) || [];
      noteRuns.filter((r) => r.length >= 2 && r.length <= 6).forEach((r) => candidates.add(r));
    }

    const owned = findMatchingRule(item);
    if (owned.owned && owned.rule) {
      const rk = parseBilingualTitle(owned.rule.title);
      addCand(rk.ko, { preferred: true });
    }

    // ㅡ 탈락：句中沒有 ㅡ，禁止用 jamo 當 needle；只靠 span／融合音節
    const euDrop = isEuDeletionItem(item) || isEuDeletionRule(owned.rule);
    if (euDrop) {
      candidates.delete("ㅡ");
      candidates.delete("으");
      preferred.delete("ㅡ");
      preferred.delete("으");
      // span 若是完整詞，也加入首音節作候選（커요→커）
      const sp = String(item.span || "").trim().normalize("NFC");
      if (sp && /[\uAC00-\uD7A3]/.test(sp[0])) {
        candidates.add(sp[0]);
        preferred.add(sp[0]);
      }
    }

    const itemBlob = [item.name, item.nameZh, item.nameKo, item.category, item.span, item.note].join(
      "\n"
    );
    const synthRule =
      owned.owned && owned.rule
        ? owned.rule
        : /主格|이\s*\/\s*가|이\/가/.test(itemBlob)
          ? { title: "主格助詞（이/가）", category: "助詞" }
          : /賓格|을\s*\/\s*를|을\/를/.test(itemBlob)
            ? { title: "賓格助詞（을/를）", category: "助詞" }
            : /主題|은\s*\/\s*는|은\/는/.test(itemBlob)
              ? { title: "主題助詞（은/는）", category: "助詞" }
              : /限定|만|only/i.test(itemBlob) && /助詞|보조사|한정/.test(itemBlob)
                ? { title: "限定助詞（만）", category: "助詞" }
                : /冠形|관형|定語/.test(itemBlob)
                  ? { title: "冠形", category: "語尾" }
                  : { title: "", category: "" };

    const focus = detectParticleFocus(itemBlob, owned.rule || synthRule, item);
    const ruleForLoc = owned.rule || synthRule;
    const isAdnNEun =
      focus &&
      (focus.includes("ㄴ") ||
        (focus.includes("은") &&
          /冠形|관형|定語|adnominal|ㄴ\s*\/\s*은|-은/i.test(
            [itemBlob, ruleForLoc?.title || ""].join("\n")
          ) &&
          !focus.includes("는")));

    // 0-) 母音縮約：優先句中表面（보여／해요），勿走助詞焦點、勿被過去融合抢走
    const vForm =
      detectVowelContractionQuery(
        item.name,
        item.nameKo || parsed.ko,
        item.nameZh || parsed.zh,
        item.span
      ) ||
      (owned.rule &&
        detectVowelContractionQuery(owned.rule.title, "", "", item.span));
    if (vForm && vForm.form) {
      const form = canonicalVowelForm(vForm.form) || vForm.form;
      const surfaces = [];
      const addSurf = (x) => {
        const t = String(x || "").trim();
        if (t && !surfaces.includes(t)) surfaces.push(t);
      };
      // 僅合法表面；拒 API 誤 span（純 게／純 줘 等）
      if (isValidVowelSurface(form, item.span)) addSurf(item.span);
      for (const n of vowelSurfaceNeedles(form)) addSurf(n);
      // 從 span 再抽 …여／…해 子串（속삭여줘 → 속삭여、여줘）
      const sp0 = String(item.span || "").trim().normalize("NFC");
      if (sp0 && isValidVowelSurface(form, sp0)) {
        const core =
          vowelFormFamily(form) === "yeo"
            ? "여"
            : vowelFormFamily(form) === "hae"
              ? "해"
              : vowelFormFamily(form) === "dwae"
                ? "돼"
                : "";
        if (core && sp0.includes(core)) {
          const i = sp0.indexOf(core);
          if (i >= 0) {
            addSurf(sp0.slice(0, i + 1)); // 속삭여
            addSurf(sp0.slice(i)); // 여줘／여
            addSurf(core);
          }
        }
      }
      // 長表面優先（보여 > 여줘 > 여）
      surfaces.sort((a, b) => b.length - a.length);
      for (const needle of surfaces) {
        if (!needle || !text.includes(needle)) continue;
        let locs = locateNeedle(text, needle);
        if (needle.length === 1) {
          locs = filterVowelSyllableLocs(text, locs);
        }
        if (locs.length) {
          const spanHint = isValidVowelSurface(form, item.span) ? item.span : "";
          const picked = pickHitsNearSpan(text, locs, spanHint);
          return (picked.length ? picked : locs).map((l) => ({
            ...l,
            needle: l.needle || needle,
          }));
        }
      }
      // 母音縮約：句中無合法表面 → 不標記
      return [];
    }

    // 0) 冠形 -ㄴ/은：含 ㄴ받침（예쁜）與獨立 은（작은）
    if (isAdnNEun || (focus && focus.includes("ㄴ"))) {
      const adnHits = locateAdnominalNEun(text, item, ruleForLoc);
      if (adnHits.length) {
        const picked = pickHitsNearSpan(text, adnHits, item.span);
        if (picked.length) return picked;
        return adnHits;
      }
    }

    // 1) 助詞／冠形：只標語素本身（은·를·만…），不要整段名詞／代詞
    if (focus && focus.length) {
      const syllFocus = focus.filter((f) => f && f !== "ㄴ");
      const hits = locateParticleSyllables(text, syllFocus, ruleForLoc);
      if (hits.length) {
        const picked = pickHitsNearSpan(text, hits, item.span);
        if (picked.length) return picked;
        return hits;
      }
      // 冠形泛稱：음절 못 찾으면 再試 ㄴ받침
      if (focus.includes("ㄴ") || focus.includes("은")) {
        const adnHits = locateAdnominalNEun(text, item, ruleForLoc);
        if (adnHits.length) {
          const picked = pickHitsNearSpan(text, adnHits, item.span);
          if (picked.length) return picked;
          return adnHits;
        }
      }
    }

    // 2) 一般候選：文法本體（preferred）> 助詞焦點 > 適中長度；避免 너 搶 만
    // ㅡ 탈락 只接受含完整韓文音節的 needle（排除 jamo ㅡ）
    const sorted = [...candidates]
      .filter((n) => n && n.length >= 1)
      .filter((n) => /[\uAC00-\uD7A3]/.test(n))
      .filter((n) => !euDrop || !/^[ㅡ으탈락脫落\s]+$/i.test(n))
      .sort((a, b) => {
        const rank = (n) => {
          let s = 0;
          if (preferred.has(n)) s += 1000;
          if (focus && focus.includes(n)) s += 800;
          if (PARTICLE_LIKE.includes(n) && (preferred.has(n) || (focus && focus.includes(n)))) {
            s += 400;
          }
          // ㅡ 탈락：優先 span／句中表面
          if (euDrop && item.span && n === String(item.span).trim()) s += 600;
          // 純宿主單字（나／너／저）且非 preferred → 降權（防 너만 標到 너）
          if (
            n.length === 1 &&
            /^(나|너|저|내|네|제|이|그|저)$/.test(n) &&
            !preferred.has(n)
          ) {
            s -= 500;
          }
          if (n.length >= 2 && n.length <= 6) s += 100 - n.length;
          else if (n.length === 1) s += 10;
          else s += 50 - Math.min(n.length, 40);
          return s;
        };
        return rank(b) - rank(a) || a.localeCompare(b);
      });

    for (const needle of sorted) {
      let locs = locateNeedle(text, needle);
      locs = filterLocsForRule(text, locs, owned.rule || synthRule, needle);
      if (PARTICLE_LIKE.includes(needle)) {
        locs = locs.filter((l) => !isLexicalNotParticle(text, l.start, l.end, needle));
      }
      if (!locs.length) continue;

      // 長命中／宿主命中 → 縮成或改標助詞
      if (focus) {
        locs = locs.map((l) => preferParticleNearLoc(text, l, focus));
      } else if (needle.length > 1) {
        locs = locs.map((l) => shrinkToEnding(text, l, PARTICLE_LIKE_SHRINK));
      }
      // 若 preferred 是助詞，拒絕仍停在非助詞宿主上的結果
      // 冠形 -ㄴ：允許標在「有 ㄴ받침 的末音節」上（예쁜 的 쁜）
      if (focus && focus.length) {
        const ok = locs.filter((l) => {
          const surface = text.slice(l.start, l.end);
          if (focus.some((f) => f !== "ㄴ" && surface === f)) return true;
          if (focus.includes("ㄴ") && surface.length === 1 && hasNieunBatchim(surface)) {
            return true;
          }
          // span 整段且以 ㄴ받침／은 結尾
          if (
            focus.includes("ㄴ") &&
            surface.length >= 1 &&
            (hasNieunBatchim(surface[surface.length - 1]) || surface.endsWith("은"))
          ) {
            return true;
          }
          return false;
        });
        if (ok.length) {
          // 長 span 縮到末音節
          const shrunk = ok.map((l) => {
            const surface = text.slice(l.start, l.end);
            if (surface.length > 1 && (hasNieunBatchim(surface[surface.length - 1]) || surface.endsWith("은"))) {
              return {
                start: l.end - 1,
                end: l.end,
                text: text.slice(l.end - 1, l.end),
                needle: surface.endsWith("은") ? "은" : "ㄴ",
              };
            }
            return { ...l, needle: l.needle || needle };
          });
          return shrunk;
        }
        // 全部被改寫失敗則試下一針
        continue;
      }
      return locs.map((l) => ({ ...l, needle: l.needle || needle }));
    }

    // 3) 後備：語尾在詞尾
    for (const needle of sorted) {
      if (needle.length < 1 || needle.length > 8) continue;
      const re = new RegExp(
        `([\\uAC00-\\uD7A3]*${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "g"
      );
      let m;
      const hits = [];
      while ((m = re.exec(text)) !== null) {
        const full = m[1];
        const start = m.index + (full.length - needle.length);
        const end = start + needle.length;
        if (PARTICLE_LIKE.includes(needle) && isLexicalNotParticle(text, start, end, needle)) {
          continue;
        }
        let loc = { start, end, text: text.slice(start, end), needle };
        if (focus) loc = preferParticleNearLoc(text, loc, focus);
        if (focus && focus.length) {
          const surface = text.slice(loc.start, loc.end);
          if (!focus.some((f) => f !== "ㄴ" && surface === f)) {
            if (
              !(
                focus.includes("ㄴ") &&
                surface.length === 1 &&
                hasNieunBatchim(surface)
              )
            ) {
              continue;
            }
          }
        }
        hits.push(loc);
        if (hits.length >= 8) break;
      }
      if (hits.length) return hits;
    }

    // 4) 句型／複合語尾：從名稱拆可搜尋片段（수 없다、을걸、지 않다…）
    const phraseNeedles = expandPhraseLocateNeedles(item, owned.rule);
    for (const needle of phraseNeedles) {
      if (!needle || !text.includes(needle)) continue;
      let locs = locateNeedle(text, needle);
      if (!locs.length) continue;
      if (PARTICLE_LIKE.includes(needle)) {
        locs = locs.filter((l) => !isLexicalNotParticle(text, l.start, l.end, needle));
      }
      if (locs.length) {
        return locs.map((l) => ({ ...l, needle }));
      }
    }

    // 5) span 找不到時：用 span 內最長、且出現在原文的子串（≥2 韓文）
    const spanRaw = String(item.span || "").trim().normalize("NFC");
    if (spanRaw && !text.includes(spanRaw)) {
      const sub = longestHangulSubstringInText(text, spanRaw);
      if (sub) {
        const locs = locateNeedle(text, sub);
        if (locs.length) return locs.map((l) => ({ ...l, needle: sub }));
      }
    }

    // 6) 過去融合 ㅆ（排除母音縮約卡：說明裡常寫「過去 하＋였→했」）
    const blob = [item.name, item.nameKo, item.span, item.note, item.category, owned.rule?.title].join(
      "\n"
    );
    const isVowelContrItem = /母音\s*縮約|모음\s*축약|元音\s*縮約/i.test(blob);
    if (
      !isVowelContrItem &&
      (/過去|과거|았\s*\/\s*었|았\/었/.test(blob) || ruleWantsPastFusion(owned.rule))
    ) {
      const fusions = findPastSsFusions(text);
      if (fusions.length) {
        return fusions.map((f) => ({
          start: f.start,
          end: f.end,
          text: f.text,
          needle: f.text,
        }));
      }
    }

    // 7) 最後：owned 規則標題韓語 needle（아/어요 → 아요·어요）
    if (owned.owned && owned.rule) {
      const ruleNeedles = collectRuleNeedles(owned.rule)
        .filter((n) => n && /[\uAC00-\uD7A3]/.test(n))
        .sort((a, b) => b.length - a.length);
      for (const needle of ruleNeedles) {
        if (needle.length > 12) continue;
        let locs = locateNeedleForRule(text, needle, owned.rule);
        if (locs.length) {
          return locs.map((l) => ({
            start: l.start,
            end: l.end,
            text: l.text || text.slice(l.start, l.end),
            needle: l.needle || needle,
            fusionNote: l.fusionNote || "",
          }));
        }
      }
    }

    // 8) 해요體常見表面
    if (/해요|아\s*\/\s*어|아\/어/.test(blob)) {
      for (const needle of ["해요", "예요", "이에요", "아요", "어요", "여요", "세요"]) {
        if (text.includes(needle)) {
          return locateNeedle(text, needle).map((l) => ({ ...l, needle }));
        }
      }
    }

    return [];
  }

  /**
   * 複合句型可搜尋表面（API s 常填 -ㄹ 수 없다 這類「看不見的」標籤）
   */
  function expandPhraseLocateNeedles(item, rule) {
    const blob = [
      item?.name,
      item?.nameKo,
      item?.nameZh,
      item?.span,
      item?.note,
      rule?.title,
      rule?.structure,
    ]
      .map((x) => String(x || ""))
      .join("\n");
    const out = [];
    const add = (s) => {
      const t = String(s || "").trim();
      if (t && !out.includes(t)) out.push(t);
    };

    // 顯式 span 先
    add(item?.span);

    // 常見複合
    if (/수\s*없|不可能|할\s*수/.test(blob)) {
      ["수 없다", "수 없어요", "수 없습니다", "수 없", "수없다", "ㄹ 수 없", "을 수 없"].forEach(add);
    }
    // 值得／還可以 -(으)ㄹ 만하다
    if (/만하|만해|值得|還可以|만하다|ㄹ\s*만|을\s*만/.test(blob)) {
      [
        "만하다",
        "만해요",
        "만합니다",
        "만해",
        "만했",
        "을 만하",
        "ㄹ 만하",
        "을 만해",
        "ㄹ 만해",
        "을만하",
        "ㄹ만하",
        "볼 만",
        "먹을 만",
        "갈 만",
      ].forEach(add);
    }
    if (/을걸|ㄹ걸|推测|推測/.test(blob)) {
      ["을걸", "ㄹ걸", "을 걸", "ㄹ 걸"].forEach(add);
    }
    if (/지\s*않|否定/.test(blob)) {
      ["지 않", "지 않아", "지 않아요", "지 않다", "지 않았습니다"].forEach(add);
    }
    if (/고\s*있|進行/.test(blob)) {
      ["고 있", "고 있어", "고 있어요", "고 있다", "고 있습니다"].forEach(add);
    }
    if (/고\s*싶|希望/.test(blob)) {
      ["고 싶", "고 싶어", "고 싶어요", "고 싶다"].forEach(add);
    }
    if (/는데|은데|인데|背景|對比/.test(blob)) {
      ["는데", "은데", "인데", "ㄴ데"].forEach(add);
    }
    if (/아요|어요|해요|해요體/.test(blob)) {
      ["해요", "아요", "어요", "여요", "예요", "이에요"].forEach(add);
    }
    if (/습니다|합니다/.test(blob)) {
      ["습니다", "ㅂ니다", "습니까", "ㅂ니까"].forEach(add);
    }

    // 從標題韓語段拆（去掉 - ~）
    const ko = parseBilingualTitle(item?.name || rule?.title || "").ko;
    if (ko) {
      ko.split(/[\/／|｜,，\s]+/).forEach((p) => {
        const t = p.replace(/^[-~〜～]+/, "").replace(/[-~〜～]+$/, "").trim();
        if (t.length >= 1 && /[\uAC00-\uD7A3]/.test(t)) add(t);
      });
      // 連續韓文 run
      const runs = ko.match(/[\uAC00-\uD7A3]+/g);
      if (runs) runs.forEach(add);
    }

    // 依長度排：長句型優先
    return out.sort((a, b) => b.length - a.length);
  }

  /** span 不在原文時，找 span 內最長且出現在 text 的韓文子串 */
  function longestHangulSubstringInText(text, span) {
    const s = String(span || "").normalize("NFC");
    const t = String(text || "");
    if (!s || !t) return "";
    // 先取韓文連續段
    const runs = s.match(/[\uAC00-\uD7A3]+/g) || [];
    let best = "";
    for (const run of runs) {
      if (run.length < 2) continue;
      if (t.includes(run) && run.length > best.length) best = run;
      // 縮短搜尋
      for (let len = run.length - 1; len >= 2; len--) {
        for (let i = 0; i + len <= run.length; i++) {
          const sub = run.slice(i, i + len);
          if (t.includes(sub) && sub.length > best.length) best = sub;
        }
      }
    }
    // 無空格版本
    const compact = s.replace(/\s+/g, "");
    if (compact.length >= 2 && t.includes(compact) && compact.length > best.length) {
      best = compact;
    }
    return best;
  }

  /** locate + 歧義過濾 + 開音節 ㅆ 融合（過去） */
  function locateNeedleForRule(src, needle, rule) {
    let locs = filterLocsForRule(src, locateNeedle(src, needle), rule, needle);

    // 方案 B：過去相關針或規則 → 補 ㅆ받침 融合位置
    if (ruleWantsPastFusion(rule) && (isPastRelatedNeedle(needle) || !locs.length)) {
      const fusions = fusionLocsForRule(src, rule);
      for (const f of fusions) {
        if (!locs.some((l) => l.start === f.start && l.end === f.end)) {
          locs.push(f);
        }
      }
    }
    return locs;
  }

  function searchLocal(query) {
    const src = String(query || "");
    const q = normalizeToken(src);
    if (!q) return [];

    const pastFusions = findPastSsFusions(src);
    const hits = [];
    for (const rule of rules) {
      const blob = normalizeToken(
        [rule.title, rule.explanation, rule.structure, rule.category].join("\n")
      );
      let score = 0;
      const notes = [];
      const matchedNeedles = [];

      if (normalizeToken(rule.title) === q) {
        score += 20;
        notes.push("標題完全相符");
      } else if (normalizeToken(rule.title).includes(q) && q.length >= 2) {
        score += 12;
        notes.push("標題包含");
      }

      const keys = ruleMatchKeys(rule);
      if (keys.has(q)) {
        score += 15;
        notes.push("關鍵字");
      }

      // 標題韓語段／關鍵字出現在查詢中（與著色同一套 needle）
      const needles = collectRuleNeedles(rule).sort((a, b) => b.length - a.length);
      const sense = ruleNeunSense(rule);
      for (const needle of needles) {
        const locs = locateNeedleForRule(src, needle, rule);
        if (!locs.length) {
          // 後備：正規化 includes — 但純「는」不可整句 includes 就命中（歧義）
          const kn = normalizeToken(needle);
          if (kn === "는" && sense) {
            // 必須在句中有通過語境過濾的位置才算
            continue;
          }
          // 過去針若只有融合形、字面無 았/었，不走 includes 誤報
          if (isPastRelatedNeedle(needle) && pastFusions.length && !q.includes(kn)) {
            continue;
          }
          // 單音節助詞禁止用 includes（듯이 含 이 會誤中主格）
          if (kn.length <= 1 && /^(이|가|은|는|을|를|에|의|도|만)$/.test(kn)) {
            continue;
          }
          if (kn && q.includes(kn)) {
            matchedNeedles.push(needle);
            score += Math.min(12, kn.length + 4);
            notes.push("關鍵字命中：" + needle);
          }
          continue;
        }
        matchedNeedles.push(needle);
        score += Math.min(12, needle.replace(/\s+/g, "").length + 4);
        const fusionNotes = locs.map((l) => l.fusionNote).filter(Boolean);
        const roleNote =
          needle === "는" && sense
            ? sense === "topic"
              ? "（主題助詞語境）"
              : "（冠形詞形語境）"
            : "";
        if (fusionNotes.length) {
          notes.push(...fusionNotes);
          notes.push("關鍵字命中：" + needle + "（含開音節融合）");
        } else {
          notes.push("關鍵字命中：" + needle + roleNote);
        }
      }

      // 方案 B：過去規則僅靠融合命中（關鍵字迴圈可能沒寫 았）
      if (ruleWantsPastFusion(rule) && pastFusions.length) {
        const already = notes.some((n) => /開音節融合|ㅆ받침/.test(n));
        if (!already) {
          score += 14;
          pastFusions.forEach((f) => notes.push(f.note));
          matchedNeedles.push("ㅆ받침過去");
        } else {
          score += 2;
        }
      }

      if (blob.includes(q) && score < 5 && q.length >= 2) {
        score += 3;
        notes.push("說明文字");
      }

      if (score > 0) {
        hits.push({
          rule,
          score,
          notes: [...new Set(notes)],
          matchedNeedles: [...new Set(matchedNeedles)],
        });
      }
    }

    hits.sort((a, b) => b.score - a.score || a.rule.title.localeCompare(b.rule.title, "zh-Hant"));
    return hits;
  }

  /**
   * 在句子中掃描規則關鍵字／韓語標記位置
   * 與 searchLocal 共用 expandNeedles／locateNeedle，避免「命中卻無著色」
   * @param {string} text
   * @param {object[]} [preferRules] 可選：優先只掃這些規則（通常是 search 命中者）
   */
  function scanSentence(text, preferRules = null) {
    const src = String(text || "");
    if (!src) return [];
    const spans = [];

    const list =
      Array.isArray(preferRules) && preferRules.length
        ? preferRules
        : rules;

    for (const rule of list) {
      const needles = collectRuleNeedles(rule).sort((a, b) => b.length - a.length);
      const seenSpan = new Set();
      // 同一規則：先記所有命中，稍後全域去重
      for (const needle of needles) {
        for (const loc of locateNeedleForRule(src, needle, rule)) {
          const key = `${loc.start}-${loc.end}-${rule.id}`;
          if (seenSpan.has(key)) continue;
          seenSpan.add(key);
          spans.push({
            start: loc.start,
            end: loc.end,
            text: loc.text,
            ruleId: rule.id,
            ruleTitle: rule.title,
            needle: loc.fusionNote ? `ㅆ·${loc.text}` : needle,
            fusionNote: loc.fusionNote || "",
          });
        }
      }
      // 過去規則：無 았/었 關鍵字時仍補融合 span
      if (ruleWantsPastFusion(rule)) {
        for (const loc of fusionLocsForRule(src, rule)) {
          const key = `${loc.start}-${loc.end}-${rule.id}`;
          if (seenSpan.has(key)) continue;
          seenSpan.add(key);
          spans.push({
            start: loc.start,
            end: loc.end,
            text: loc.text,
            ruleId: rule.id,
            ruleTitle: rule.title,
            needle: `ㅆ·${loc.text}`,
            fusionNote: loc.fusionNote || "",
          });
        }
      }
    }

    // 若有 prefer 但仍無 span，再掃全部規則補一次
    if (Array.isArray(preferRules) && preferRules.length && !spans.length) {
      return scanSentence(src, null);
    }

    // 去重：重疊時保留較長；同區間同規則只留一筆
    spans.sort((a, b) => a.start - b.start || b.end - a.end || b.end - b.start - (a.end - a.start));
    const kept = [];
    for (const s of spans) {
      const overlaps = kept.some((k) => !(s.end <= k.start || s.start >= k.end));
      if (overlaps) {
        // 若完全被既有較長 span 覆蓋則跳過；若更長則替換被蓋住的短 span
        const coveredByLonger = kept.some(
          (k) => k.start <= s.start && k.end >= s.end && k.end - k.start >= s.end - s.start
        );
        if (coveredByLonger) continue;
        // 移除完全被此 span 包含的較短項
        for (let i = kept.length - 1; i >= 0; i--) {
          const k = kept[i];
          if (s.start <= k.start && s.end >= k.end && s.end - s.start > k.end - k.start) {
            kept.splice(i, 1);
          }
        }
        // 仍與部分重疊則跳過（避免破碎著色）
        if (kept.some((k) => !(s.end <= k.start || s.start >= k.end))) continue;
      }
      kept.push(s);
    }
    kept.sort((a, b) => a.start - b.start);
    return kept;
  }

  function filterList(filterText) {
    const q = String(filterText || "").trim().toLowerCase();
    const all = getAll();
    if (!q) return all;
    return all.filter((r) => {
      const blob = [r.title, r.category, r.explanation, r.structure].join("\n").toLowerCase();
      return blob.includes(q);
    });
  }

  /** 是否為「命令／請托（-아/어 줘）」類規則 */
  function isAjueoJudaRule(rule) {
    if (!rule) return false;
    if (rule.id === "seed-ajueo-juda") return true;
    const blob = [rule.title, rule.structure, rule.explanation || ""].join("\n");
    return (
      /命令\s*[／/]\s*請托|請托.*줘|아\s*\/\s*어\s*줘|-아\/어\s*줘/i.test(blob) ||
      (/命令|請托/.test(rule.title || "") && /줘|주세요|주다/.test(blob))
    );
  }

  function findAjueoJudaRule() {
    const byId = getById("seed-ajueo-juda");
    if (byId) return byId;
    return getAll().find((r) => isAjueoJudaRule(r)) || null;
  }

  /**
   * API 盤點常漏報「有 줘 卻沒列請托」。依句中表面補上 inventory 項。
   * - 已有項能對上請托卡／名稱已含 줘·請托 → 不重複
   * - 優先綁本地卡 manualRuleId，保證已收錄可上色
   * @param {string} query
   * @param {{ items?: object[], vocab?: object[], summary?: string, translation?: string }} inventory
   * @returns 同形 inventory（items 可能多一筆）
   */
  function enrichInventoryWithSurfaceHints(query, inventory) {
    const src = String(query || "").normalize("NFC");
    const inv = inventory && typeof inventory === "object" ? inventory : {};
    const items = Array.isArray(inv.items) ? inv.items.slice() : [];
    if (!src) {
      return { ...inv, items };
    }

    const jueoSurfaces = ["주세요", "주실래요", "줘요", "줘"];
    let jueoHit = null;
    for (const needle of jueoSurfaces) {
      const idx = src.indexOf(needle);
      if (idx >= 0) {
        jueoHit = { needle, start: idx, end: idx + needle.length };
        break;
      }
    }

    if (jueoHit) {
      // 僅當「已有項能對上請托卡／名稱明確是請托」才算已報；span  alone 含 줘 不算
      const already = items.some((it) => {
        if (it?.manualRuleId) {
          const r = getById(it.manualRuleId);
          if (isAjueoJudaRule(r)) return true;
        }
        const m = findMatchingRule(it);
        if (m.owned && isAjueoJudaRule(m.rule)) return true;
        const blob = [it?.name, it?.nameZh, it?.nameKo, it?.title].join("\n");
        if (/請托|아\s*\/\s*어\s*줘|아\/어\s*줘|주세요|주실래요|아\s*\/\s*어\s*주/i.test(blob)) {
          return true;
        }
        if (/命令/.test(blob) && /줘|주세요|주다/.test(blob + "\n" + (it?.span || ""))) {
          return true;
        }
        return false;
      });

      if (!already) {
        const rule = findAjueoJudaRule();
        const title = rule?.title || "命令／請托（-아/어 줘）";
        const p = parseBilingualTitle(title);
        const row = {
          name: title,
          nameZh: p.zh || "命令／請托",
          nameKo: p.ko || "-아/어 줘",
          category: rule?.category || "句型",
          span: jueoHit.needle,
          start: jueoHit.start,
          end: jueoHit.end,
          confidence: "high",
          source: "surface-hint",
        };
        if (rule?.id) {
          row.manualRuleId = rule.id;
        }
        items.push(row);
      }
    }

    return {
      summary: inv.summary || "",
      translation: inv.translation || "",
      items,
      vocab: Array.isArray(inv.vocab) ? inv.vocab : [],
      mode: inv.mode,
      source: inv.source,
    };
  }

  /**
   * 選字套用：依選定片段本地打分，高分規則置頂建議
   * @param {string} selectedText
   * @param {{ minScore?: number, maxSuggest?: number }} [opts]
   * @returns {{ suggestions: { rule, score, reasons: string[] }[], rest: object[] }}
   */
  function rankRulesForSpan(selectedText, opts = {}) {
    const sel = String(selectedText || "").trim().normalize("NFC");
    const minScore = Number.isFinite(opts.minScore) ? opts.minScore : 8;
    const maxSuggest = Number.isFinite(opts.maxSuggest) ? opts.maxSuggest : 8;
    const all = getAll();
    if (!sel) {
      return { suggestions: [], rest: all };
    }

    const selNorm = normalizeToken(sel);
    const selKoKey = normalizeGrammarKey(sel);
    const scored = [];

    // 表面捷徑（高訊號）
    const surfaceBoosts = [];
    if (/주세요|주실래요|줘요|(^|[^가-힣])줘([^가-힣]|$)|줘$/.test(sel) || sel === "줘") {
      surfaceBoosts.push({
        test: (r) => isAjueoJudaRule(r),
        score: 28,
        reason: "表面含 줘／주세요 → 請托",
      });
    }
    const vForm = inferVowelFormFromSurface(sel) || extractVowelContractionForm(sel);
    if (vForm && vowelFormFamily(vForm)) {
      const want = canonicalVowelForm(vForm) || vForm;
      surfaceBoosts.push({
        test: (r) => ruleMentionsVowelContraction(r, want),
        score: 26,
        reason: `表面像母音縮約（${want}）`,
      });
    }
    // 常見單／雙字助詞、語尾
    const PARTICLE_HINTS = [
      { re: /^(은|는)$/, titleRe: /主題|은\s*\/\s*는|은\/는/, reason: "主題助詞表面" },
      { re: /^(이|가)$/, titleRe: /主格|이\s*\/\s*가|이\/가/, reason: "主格助詞表面" },
      { re: /^(을|를)$/, titleRe: /賓格|을\s*\/\s*를|을\/를/, reason: "賓格助詞表面" },
      { re: /^에$/, titleRe: /時間地點|處所|（에）|\(에\)|^에$/, reason: "助詞 에" },
      { re: /^에서$/, titleRe: /에서|處所來源/, reason: "助詞 에서" },
      { re: /^고$/, titleRe: /並列|（-고）|\(-고\)/, reason: "連接 -고" },
      { re: /는데|은데|인데/, titleRe: /는데|은데|인데|背景對比/, reason: "連接 -는데 系" },
      { re: /지\s*않|지않/, titleRe: /否定|지\s*않/, reason: "否定 지 않" },
      { re: /고\s*있|고있/, titleRe: /進行|고\s*있/, reason: "進行 -고 있다" },
      { re: /고\s*싶|고싶/, titleRe: /希望|고\s*싶/, reason: "希望 -고 싶다" },
      { re: /이에요|예요|입니다/, titleRe: /指定|이에요|예요/, reason: "指定詞" },
      { re: /만하|만해|을\s*만/, titleRe: /值得|만하/, reason: "值得／還可以" },
    ];
    for (const h of PARTICLE_HINTS) {
      if (h.re.test(sel) || h.re.test(selNorm)) {
        surfaceBoosts.push({
          test: (r) => h.titleRe.test([r.title, r.structure, r.explanation || ""].join("\n")),
          score: 22,
          reason: h.reason,
        });
      }
    }
    // 人稱縮約形
    if (PARTICLE_CONTRACTIONS[sel] || PARTICLE_CONTRACTIONS[selNorm]) {
      const form = PARTICLE_CONTRACTIONS[sel] ? sel : selNorm;
      surfaceBoosts.push({
        test: (r) => ruleMentionsContraction(r, form, PARTICLE_CONTRACTIONS[form].type),
        score: 24,
        reason: `人稱縮約「${form}」`,
      });
    }

    // searchLocal 當基底（整段 sel 當 query）
    const localHits = searchLocal(sel);
    const localById = new Map(localHits.map((h) => [h.rule.id, h]));

    // findMatchingRule 把選取當文法名
    const asNameMatch = findMatchingRule({
      name: sel,
      nameKo: sel,
      span: sel,
    });

    for (const rule of all) {
      let score = 0;
      const reasons = [];
      const local = localById.get(rule.id);
      if (local && (local.score || 0) > 0) {
        score += Math.min(22, local.score);
        if (local.notes?.length) {
          reasons.push(local.notes[0]);
        } else {
          reasons.push("本地關鍵字命中");
        }
      }

      const rp = parseBilingualTitle(rule.title);
      const rKo = normalizeGrammarKey(rp.ko);
      const rTitleNorm = normalizeToken(rule.title);

      if (rTitleNorm === selNorm && selNorm) {
        score += 30;
        reasons.push("與標題完全相同");
      } else if (selNorm.length >= 2 && rTitleNorm.includes(selNorm)) {
        score += 14;
        reasons.push("標題包含選取字");
      }

      if (selKoKey && rKo && selKoKey === rKo) {
        score += 18;
        reasons.push("韓語標記一致");
      }

      // needle 精確：選取字 ∈ 規則 needles 或反之
      const needles = collectRuleNeedles(rule);
      for (const n of needles) {
        const nn = String(n || "").trim();
        if (!nn) continue;
        if (nn === sel || normalizeToken(nn) === selNorm || normalizeGrammarKey(nn) === selKoKey) {
          score += 16;
          reasons.push(`標記「${nn}」`);
          break;
        }
        if (sel.length >= 2 && nn.length >= 2 && (sel.includes(nn) || nn.includes(sel))) {
          // 短助詞不靠 includes
          if (nn.length <= 1 && /^(이|가|은|는|을|를|에|의|도|만|고)$/.test(nn)) continue;
          score += 10;
          reasons.push(`含標記「${nn}」`);
          break;
        }
      }

      if (asNameMatch.owned && asNameMatch.rule?.id === rule.id) {
        score += 20;
        reasons.push("名稱比對命中");
      }

      for (const b of surfaceBoosts) {
        if (b.test(rule)) {
          score += b.score;
          reasons.push(b.reason);
        }
      }

      // 結構式零件
      if (rule.structure && sel.length >= 1) {
        const parts = String(rule.structure).split(/[＋+\s→／|,，()（）]+/);
        if (parts.some((p) => normalizeGrammarKey(p) === selKoKey && selKoKey)) {
          score += 8;
          reasons.push("結構式含此標記");
        }
      }

      if (score > 0) {
        // 去重 reasons
        const uniq = [];
        const seen = new Set();
        for (const r of reasons) {
          if (!r || seen.has(r)) continue;
          seen.add(r);
          uniq.push(r);
        }
        scored.push({ rule, score, reasons: uniq.slice(0, 3) });
      }
    }

    scored.sort((a, b) => b.score - a.score || String(a.rule.title).localeCompare(String(b.rule.title), "zh-Hant"));

    const suggestions = scored.filter((s) => s.score >= minScore).slice(0, maxSuggest);
    const suggestIds = new Set(suggestions.map((s) => s.rule.id));
    const rest = all.filter((r) => !suggestIds.has(r.id));

    return { suggestions, rest };
  }

  return {
    CATEGORIES,
    SUPPLEMENTARY_CATEGORY,
    isSupplementaryUsage,
    SEED_ID_ORDER,
    setAll,
    getAll,
    getById,
    compareRules,
    create,
    update,
    remove,
    normalizeRule,
    parseStructureParts,
    parseStructureTokens,
    parseStructureBranches,
    parseStructureChain,
    parseBilingualTitle,
    findMatchingRule,
    searchLocal,
    scanSentence,
    locateNeedle,
    locateNeedleForRule,
    locateApiItemInText,
    isValidVowelSurface,
    sentenceHasVowelSurface,
    isVowelContractionRule,
    extractVowelContractionForm,
    enrichInventoryWithSurfaceHints,
    isAjueoJudaRule,
    rankRulesForSpan,
    classifyNeunAt,
    ruleNeunSense,
    findPastSsFusions,
    ruleWantsPastFusion,
    decomposeHangul,
    stripBatchim,
    expandNeedles,
    collectRuleNeedles,
    filterList,
    normalizeToken,
    normalizeGrammarKey,
    normalizeTitleKey,
    zhNamesRelated,
  };
})();
