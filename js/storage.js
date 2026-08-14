/**
 * 規則／待辦／設定持久化（localStorage + 種子）
 * 鍵名 kgn_*（Korean Grammar Notebook）
 */
const Storage = (() => {
  const RULES_KEY = "kgn_rules_v1";
  const TODOS_KEY = "kgn_todos_v1";
  const META_KEY = "kgn_meta_v1";
  const SETTINGS_KEY = "kgn_settings_v1";
  const LOOKUP_MODE_KEY = "kgn_lookup_mode";
  const HISTORY_KEY = "kgn_history_v1";
  const HISTORY_MAX = 40;
  const PROJECTS_KEY = "kgn_projects_v1";
  const ACTIVE_PROJECT_KEY = "kgn_active_project_v1";
  const VOCAB_BANK_KEY = "kgn_vocab_bank_v1";
  const VOCAB_BANK_MAX = 5000;
  const VOCAB_BANK_FIELDS = ["surface", "lemma", "gloss", "pos"];

  /** 文法結構可視化配色（與 CSS data-structure-theme 對應） */
  const STRUCTURE_THEMES = [
    { id: "indigo", label: "靛紫", desc: "預設 · 沉穩對比" },
    { id: "teal", label: "青瓷", desc: "冷靜 · 學習感" },
    { id: "sakura", label: "櫻粉", desc: "柔和 · 輕盈" },
    { id: "matcha", label: "抹茶", desc: "自然 · 清爽" },
    { id: "sunset", label: "暮霞", desc: "暖調 · 溫和" },
    { id: "slate", label: "水墨", desc: "低彩 · 專注" },
    { id: "ocean", label: "海灣", desc: "深藍 · 清澈" },
    { id: "honey", label: "蜂蜜", desc: "金杏 · 溫潤" },
    { id: "grape", label: "葡萄", desc: "紫紅 · 沉靜" },
    { id: "frost", label: "霜藍", desc: "冷調 · 乾淨" },
  ];

  const DEFAULT_LOOKUP_MODES = {
    apiGrammar: true,
    localGrammar: false,
    apiVocab: true,
  };

  const DEFAULT_SETTINGS = {
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    structureTheme: "indigo",
    kiwiEnabled: true,
    lookupModes: { ...DEFAULT_LOOKUP_MODES },
  };

  function normalizeStructureTheme(id) {
    const ok = STRUCTURE_THEMES.some((t) => t.id === id);
    return ok ? id : DEFAULT_SETTINGS.structureTheme;
  }

  function loadRules() {
    try {
      const raw = localStorage.getItem(RULES_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveRules(rules) {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    setMeta({ lastSaved: new Date().toISOString() });
  }

  function loadTodos() {
    try {
      const raw = localStorage.getItem(TODOS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTodos(todos) {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }

  function getMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setMeta(partial) {
    const next = { ...getMeta(), ...partial };
    localStorage.setItem(META_KEY, JSON.stringify(next));
    return next;
  }

  const SEED_VOWEL_IDS = new Set(["seed-vowel-hae", "seed-vowel-yeo", "seed-vowel-dwae"]);
  const SEED_EPOCH = "2026-01-01T00:00:00.000Z";

  /** 母音縮約專項標題（括號寫套用範圍；人稱縮約不在此列） */
  const VOWEL_SCOPE_CANON = {
    hae: {
      title: "母音縮約（하＋여→해）",
      structure: "하＋여 → 해",
      explanation:
        "하다 系專項：僅當詞幹「하」後接母音語尾而縮約成「해」時適用（해요、해서、했어、했다、하였→했）。不適用 이＋어→여（보여）、되＋어→돼，也不適用 주＋어→줘、副詞 -게 等其他變化。",
      keywords: ["해", "해요", "해서", "했다", "했어", "하였"],
    },
    yeo: {
      title: "母音縮約（이＋어→여）",
      structure: "이＋어 → 여",
      explanation:
        "이 系專項：僅當詞幹末音節母音為「이」時，이＋어→여（보이다→보여、기다리다→기다려、가르치다→가르쳐）。與 하＋여→해、되＋어→돼 不同系，勿混用。",
      keywords: ["여", "보여", "여요", "여서", "이어"],
    },
    dwae: {
      title: "母音縮約（되＋어→돼）",
      structure: "되＋어 → 돼",
      explanation:
        "되다 系專項：僅當「되」後接母音語尾而縮約成「돼」時適用（돼요、돼서；過去 되＋었→됐）。不涵蓋 하＋여→해 與 이＋어→여。",
      keywords: ["돼", "돼요", "돼서", "됐다", "됐어"],
    },
  };

  function classifyVowelScopeKey(title) {
    const t = String(title || "").trim();
    if (!t) return null;
    // 新式（優先）
    if (/母音縮約/.test(t) && /하\s*[＋+]\s*여/.test(t) && /해/.test(t)) return "hae";
    if (/母音縮約/.test(t) && /이\s*[＋+]\s*어/.test(t) && /여/.test(t) && !/하\s*[＋+]/.test(t))
      return "yeo";
    if (/母音縮約/.test(t) && /되\s*[＋+]\s*어|돼/.test(t) && !/하\s*[＋+]|이\s*[＋+]/.test(t))
      return "dwae";
    // 舊式短名
    if (/^母音縮約（\s*해\s*）$/.test(t)) return "hae";
    if (/^母音縮約（\s*여\s*）$/.test(t)) return "yeo";
    if (/^母音縮約（\s*돼\s*）$/.test(t)) return "dwae";
    return null;
  }

  /**
   * 修正舊種子：여 誤寫成 하＋여；並將標題升級為「套用範圍」寫在括號內。
   * 只動 seed-vowel-* 與舊式短名「母音縮約（해／여／돼）」。
   * 不改 updated_at（避免排序被頂到最前）。
   */
  function migrateVowelContractionSeeds(rules) {
    if (!Array.isArray(rules) || !rules.length) return { rules, changed: false };
    let changed = false;
    const next = rules.map((r) => {
      if (!r) return r;
      let key = null;
      if (r.id === "seed-vowel-hae") key = "hae";
      else if (r.id === "seed-vowel-yeo") key = "yeo";
      else if (r.id === "seed-vowel-dwae") key = "dwae";
      else key = classifyVowelScopeKey(r.title);

      if (!key) return r;

      const isSeed = SEED_VOWEL_IDS.has(r.id);
      const isLegacyShort = /^母音縮約（\s*[해여돼]\s*）$/.test(String(r.title || "").trim());
      // 只升級：種子卡、或舊式短名「母音縮約（해／여／돼）」
      if (!isSeed && !isLegacyShort) return r;

      const canon = VOWEL_SCOPE_CANON[key];
      if (!canon) return r;

      const title = String(r.title || "").trim();
      const struct = String(r.structure || "");
      const expl = String(r.explanation || "");
      const needTitle = title !== canon.title;
      const needStruct =
        (key === "yeo" && (/하\s*[＋+]\s*여/.test(struct) || !/이\s*[＋+]\s*어/.test(struct))) ||
        (key === "hae" && !/하\s*[＋+]\s*여|→\s*해/.test(struct)) ||
        (key === "dwae" && !/되\s*[＋+]\s*어|→\s*돼/.test(struct));
      const needExpl =
        /標題也可寫「母音縮約（여）」|同一文法|同為\s*하|與「母音縮約（해）」同為|表面\s*해/.test(
          expl
        ) ||
        needTitle ||
        (key === "yeo" && /하\s*[＋+]\s*여→해/.test(expl) && !/이\s*[＋+]\s*어/.test(expl));

      if (!needTitle && !needStruct && !needExpl) return r;

      changed = true;
      return {
        ...r,
        title: canon.title,
        category: r.category || "不規則",
        explanation: needExpl || needTitle ? canon.explanation : r.explanation,
        structure: needStruct || !struct ? canon.structure : r.structure,
        keywords: Array.isArray(r.keywords) && r.keywords.length ? r.keywords : canon.keywords,
        // 保持原時間，避免排序被頂到最前
        updated_at: r.created_at || r.updated_at || SEED_EPOCH,
      };
    });
    return { rules: next, changed };
  }

  /**
   * 先前遷移曾把 seed-vowel-* 的 updated_at 設成「現在」，導致規則筆記本排序跳到最前。
   * 一次把時間戳壓回 created_at，與其他種子卡並列。
   */
  function restoreSeedVowelSortOrder(rules) {
    if (!Array.isArray(rules) || !rules.length) return { rules, changed: false };
    let changed = false;
    const next = rules.map((r) => {
      if (!r || !SEED_VOWEL_IDS.has(r.id)) return r;
      const t = String(r.title || "").trim();
      const isVowelTitle =
        /^母音縮約（\s*[해여돼]\s*）$/.test(t) ||
        /^母音縮約（/.test(t) && /하\s*[＋+]\s*여|이\s*[＋+]\s*어|되\s*[＋+]\s*어/.test(t);
      if (!isVowelTitle) return r;
      const created = r.created_at || SEED_EPOCH;
      if (r.updated_at && r.updated_at !== created) {
        changed = true;
        return { ...r, updated_at: created };
      }
      return r;
    });
    return { rules: next, changed };
  }

  /**
   * 依分類＋種子序重排陣列（修正曾被「最近更新」打亂、母音縮約浮到最前的本機順序）
   * 不依賴 RulesService（init 時可能尚未就緒），內嵌與 rules.js 相同的種子序。
   */
  function reorderRulesCanonical(rules) {
    if (!Array.isArray(rules) || rules.length < 2) return { rules, changed: false };
    const SEED_ID_ORDER = [
      "seed-haeyo",
      "seed-haeche",
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
    const CAT_KEYS = ["語尾", "助詞", "不規則", "時態", "敬語", "連接", "句型", "其他"];
    const catRank = (cat) => {
      const key = String(cat || "");
      const i = CAT_KEYS.indexOf(key);
      if (i >= 0) return i;
      if (!key) return CAT_KEYS.length + 1;
      return CAT_KEYS.length;
    };
    const seedRank = (id) => {
      const i = SEED_ID_ORDER.indexOf(String(id || ""));
      return i >= 0 ? i : -1;
    };
    const cmp = (a, b) => {
      const cr = catRank(a?.category) - catRank(b?.category);
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
    };
    const before = rules.map((r) => r && r.id).join("\0");
    const next = rules.slice().sort(cmp);
    const after = next.map((r) => r && r.id).join("\0");
    return { rules: next, changed: before !== after };
  }

  const TITLE_RENAMES = {
    "해요體（-아/어요）": "禮貌體（-아/어요）",
    "해체（반말）": "平語（해체）",
    "합니다體（-습니다）": "正式體（-습니다）",
    "主題助詞（은/는）": "主題（은/는）",
    "主格助詞（이/가）": "主格（이/가）",
    "比喻接尾（듯이）": "比喻（듯이）",
    "賓格助詞（을/를）": "賓格（을/를）",
    "時間地點助詞（에）": "時間地點（에）",
    "處所來源助詞（에서）": "處所來源（에서）",
    "背景對比連結・動詞（-는데）": "背景對比（-는데）",
    "背景對比連結・形容詞（-ㄴ/은데）": "背景對比（-ㄴ/은데）",
    "背景對比連結・名詞（-ㄴ데/인데）": "背景對比（-ㄴ데/인데）",
    "指定詞해요體（이에요/예요）": "指定（이에요/예요）",
    "值得／還可以（-(으)ㄹ 만하다）": "值得（-ㄹ 만하다）",
    "命令／請托（-아/어 줘）": "請托（-아/어 줘）",
  };

  function migrateRuleTitles(rules) {
    if (!Array.isArray(rules)) return { rules: [], changed: false };
    let changed = false;
    const next = rules.map((r) => {
      if (!r) return r;
      const t = String(r.title || "").trim();
      const mapped = TITLE_RENAMES[t];
      if (!mapped || mapped === t) return r;
      changed = true;
      return { ...r, title: mapped };
    });
    return { rules: next, changed };
  }

  /** 補上本機尚未有的種子卡（例如新加的 請托、平語） */
  function ensureMissingSeedRules(rules, seedList) {
    if (!Array.isArray(rules)) return { rules: [], changed: false };
    if (!Array.isArray(seedList) || !seedList.length) return { rules, changed: false };
    const byId = new Map(rules.filter((r) => r && r.id).map((r) => [r.id, r]));
    const titles = new Set(
      [...byId.values()].map((r) => String(r?.title || "").trim()).filter(Boolean)
    );
    let changed = false;
    for (const s of seedList) {
      if (!s || !s.id) continue;
      if (byId.has(s.id)) continue;
      // 使用者已自建同標題時不重複插入（例如已有 해체（반말））
      const seedTitle = String(s.title || "").trim();
      if (seedTitle && titles.has(seedTitle)) continue;
      byId.set(s.id, {
        ...s,
        created_at: s.created_at || SEED_EPOCH,
        updated_at: s.updated_at || s.created_at || SEED_EPOCH,
      });
      if (seedTitle) titles.add(seedTitle);
      changed = true;
    }
    return { rules: Array.from(byId.values()), changed };
  }

  async function initWithSeed() {
    let rules = loadRules();
    if (rules && rules.length > 0) {
      let next = rules;
      let changed = false;
      // 補齊新增種子（不覆蓋使用者已有同 id）
      try {
        const res = await fetch("data/seed-rules.json");
        if (res.ok) {
          const seedList = await res.json();
          const ens = ensureMissingSeedRules(next, seedList);
          next = ens.rules;
          changed = ens.changed || changed;
        }
      } catch {
        /* 離線時略過 */
      }
      // 母音縮約：舊短名／錯結構 → 括號寫套用範圍（하＋여→해 等）
      const mig = migrateVowelContractionSeeds(next);
      next = mig.rules;
      changed = mig.changed || changed;
      const titleMig = migrateRuleTitles(next);
      next = titleMig.rules;
      changed = titleMig.changed || changed;

      const meta = getMeta();
      if (mig.changed && !meta.vowelScopeTitleV1At) {
        setMeta({
          vowelScopeTitleV1At: new Date().toISOString(),
          vowelYeoMigratedAt: new Date().toISOString(),
        });
      }
      if (!meta.vowelYeoSortFixedAt) {
        const sortFix = restoreSeedVowelSortOrder(next);
        next = sortFix.rules;
        changed = sortFix.changed || changed;
        setMeta({ vowelYeoSortFixedAt: new Date().toISOString() });
      }
      // v2：依分類＋種子序重排本機陣列（解決「時間戳已壓回但陣列仍亂」）
      if (!meta.rulesCanonicalSortV2At) {
        const reo = reorderRulesCanonical(next);
        next = reo.rules;
        changed = reo.changed || changed;
        setMeta({ rulesCanonicalSortV2At: new Date().toISOString() });
      }
      if (changed) saveRules(next);
      return next;
    }
    try {
      const res = await fetch("data/seed-rules.json");
      if (!res.ok) throw new Error("seed fetch failed");
      rules = await res.json();
    } catch {
      rules = [];
    }
    const ordered = reorderRulesCanonical(rules);
    saveRules(ordered.rules);
    setMeta({
      seeded: true,
      seededAt: new Date().toISOString(),
      rulesCanonicalSortV2At: new Date().toISOString(),
    });
    return ordered.rules;
  }

  function exportRulesJSON(rules) {
    return JSON.stringify(rules, null, 2);
  }

  /**
   * 資料管理：規則 + 專案一併匯出
   * 相容舊版純規則陣列匯入；新檔為 { type, rules, projects }
   */
  function exportDataJSON(rules) {
    const list = Array.isArray(rules) ? rules : loadRules() || [];
    return JSON.stringify(
      {
        type: "mal-korean-grammar-backup",
        version: 2,
        exportedAt: new Date().toISOString(),
        rules: list,
        projects: listProjects(),
      },
      null,
      2
    );
  }

  function importRulesJSON(text, mode = "merge") {
    const incoming = JSON.parse(text);
    // 新備份：{ rules, projects }
    if (incoming && typeof incoming === "object" && !Array.isArray(incoming) && Array.isArray(incoming.rules)) {
      return importRulesArray(incoming.rules, mode);
    }
    if (!Array.isArray(incoming)) throw new Error("匯入格式必須是規則陣列 JSON，或含 rules 的備份檔");
    return importRulesArray(incoming, mode);
  }

  function importRulesArray(incoming, mode = "merge") {
    if (!Array.isArray(incoming)) throw new Error("規則必須是陣列");
    const current = loadRules() || [];
    if (mode === "replace") {
      saveRules(incoming);
      return incoming;
    }
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of incoming) {
      if (r && r.id) byId.set(r.id, r);
    }
    const merged = Array.from(byId.values());
    saveRules(merged);
    return merged;
  }

  /**
   * 統一匯入：規則陣列、備份檔（rules+projects）、或舊版專案檔
   * @returns {{ rules: object[], projects?: { added, updated, total }, kind: string }}
   */
  function importDataJSON(text, mode = "merge") {
    const data = JSON.parse(text);
    // 1) 舊：純規則陣列
    if (Array.isArray(data)) {
      const rules = importRulesArray(data, mode);
      return { rules, kind: "rules-only" };
    }
    if (!data || typeof data !== "object") {
      throw new Error("無法辨識的 JSON 格式");
    }
    // 2) 備份檔或含 rules
    if (Array.isArray(data.rules)) {
      const rules = importRulesArray(data.rules, mode);
      let projectsResult = null;
      if (Array.isArray(data.projects) && data.projects.length) {
        projectsResult = importProjectsList(data.projects, mode);
      }
      return {
        rules,
        projects: projectsResult,
        kind: projectsResult ? "backup" : "rules-bundle",
      };
    }
    // 3) 舊：純專案 { type: projects, projects } 或 projects 陣列 / 單專案
    if (
      data.type === "mal-korean-grammar-projects" ||
      Array.isArray(data.projects) ||
      (data.id && (data.entries || data.name))
    ) {
      const projectsResult = importProjectsJSON(JSON.stringify(data));
      return {
        rules: loadRules() || [],
        projects: {
          added: projectsResult.added,
          updated: projectsResult.updated,
          total: projectsResult.projects.length,
        },
        kind: "projects-only",
      };
    }
    throw new Error("匯入格式需為規則陣列，或 { rules, projects } 備份檔");
  }

  function resetToSeed() {
    localStorage.removeItem(RULES_KEY);
    localStorage.removeItem(TODOS_KEY);
    setMeta({ resetAt: new Date().toISOString() });
  }

  /**
   * 查詢模式：API 文法 / 本地文法（互斥）· API 單字（可獨立）
   * 相容舊版 LOOKUP_MODE_KEY（api | local）
   */
  function normalizeLookupModes(input, opts = {}) {
    const src = input && typeof input === "object" ? input : null;
    let apiGrammar;
    let localGrammar;
    let apiVocab;
    if (src && ("apiGrammar" in src || "localGrammar" in src || "apiVocab" in src)) {
      apiGrammar = Boolean(src.apiGrammar);
      localGrammar = Boolean(src.localGrammar);
      apiVocab = Boolean(src.apiVocab);
    } else {
      let legacy = "api";
      try {
        const m = localStorage.getItem(LOOKUP_MODE_KEY);
        if (m === "local") legacy = "local";
      } catch {
        /* ignore */
      }
      if (legacy === "local") {
        apiGrammar = false;
        localGrammar = true;
        apiVocab = false;
      } else {
        apiGrammar = true;
        localGrammar = false;
        apiVocab = true;
      }
    }
    if (opts.preferLocal) {
      if (localGrammar) apiGrammar = false;
    } else if (opts.preferApiGrammar) {
      if (apiGrammar) localGrammar = false;
    } else if (apiGrammar && localGrammar) {
      localGrammar = false;
    }
    return { apiGrammar, localGrammar, apiVocab };
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {
          ...DEFAULT_SETTINGS,
          lookupModes: { ...DEFAULT_LOOKUP_MODES },
        };
      }
      const parsed = JSON.parse(raw);
      const base = {
        ...DEFAULT_SETTINGS,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
        baseUrl:
          (typeof parsed?.baseUrl === "string" && parsed.baseUrl.trim()) ||
          DEFAULT_SETTINGS.baseUrl,
        model:
          (typeof parsed?.model === "string" && parsed.model.trim()) ||
          DEFAULT_SETTINGS.model,
        structureTheme: normalizeStructureTheme(parsed?.structureTheme),
        kiwiEnabled: parsed?.kiwiEnabled !== false,
      };
      base.lookupModes = normalizeLookupModes(
        parsed && typeof parsed === "object" ? parsed.lookupModes : null
      );
      return base;
    } catch {
      return {
        ...DEFAULT_SETTINGS,
        lookupModes: { ...DEFAULT_LOOKUP_MODES },
      };
    }
  }

  function saveSettings(partial) {
    const next = { ...loadSettings(), ...partial };
    next.apiKey = String(next.apiKey || "").trim();
    next.baseUrl = String(next.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, "");
    next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
    next.structureTheme = normalizeStructureTheme(next.structureTheme);
    next.kiwiEnabled = next.kiwiEnabled !== false;
    if (partial && Object.prototype.hasOwnProperty.call(partial, "lookupModes")) {
      next.lookupModes = normalizeLookupModes(partial.lookupModes);
    } else {
      next.lookupModes = normalizeLookupModes(next.lookupModes);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  function clearApiKey() {
    return saveSettings({ apiKey: "" });
  }

  function hasApiKey() {
    return Boolean(loadSettings().apiKey);
  }

  /** @deprecated 相容舊碼：api | local（以文法排查為準） */
  function loadLookupMode() {
    const m = loadLookupModes();
    return m.localGrammar && !m.apiGrammar ? "local" : "api";
  }

  function saveLookupMode(mode) {
    if (mode === "local") {
      return saveLookupModes({ apiGrammar: false, localGrammar: true });
    }
    return saveLookupModes({ apiGrammar: true, localGrammar: false, apiVocab: true });
  }

  function loadLookupModes() {
    return normalizeLookupModes(loadSettings().lookupModes);
  }

  /**
   * @param {Partial<{apiGrammar:boolean,localGrammar:boolean,apiVocab:boolean}>} partial
   */
  function saveLookupModes(partial) {
    const cur = loadLookupModes();
    const p = partial && typeof partial === "object" ? partial : {};
    const merged = { ...cur, ...p };
    const opts = {};
    if (p.localGrammar === true) opts.preferLocal = true;
    else if (p.apiGrammar === true) opts.preferApiGrammar = true;
    const next = normalizeLookupModes(merged, opts);
    saveSettings({ lookupModes: next });
    try {
      if (next.apiGrammar) localStorage.setItem(LOOKUP_MODE_KEY, "api");
      else if (next.localGrammar) localStorage.setItem(LOOKUP_MODE_KEY, "local");
    } catch {
      /* ignore */
    }
    return next;
  }

  /** 查詢是否會呼叫 API（文法或單字） */
  function isApiLookupEnabled() {
    const m = loadLookupModes();
    return Boolean(m.apiGrammar || m.apiVocab);
  }

  function formatLookupModesLabel(modes) {
    const m = modes || loadLookupModes();
    const parts = [];
    if (m.apiGrammar) parts.push("API 文法");
    if (m.localGrammar) parts.push("本地文法");
    if (m.apiVocab) parts.push("API 單字");
    return parts.length ? parts.join(" · ") : "未啟用";
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  /** 精簡盤點項目供歷史快照（之後可依目前筆記本重分類；保留手動校正欄位） */
  function slimInventoryItems(items) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 80)
      .map((it) => {
        const row = {
          name: String(it?.name || "").trim(),
          nameKo: String(it?.nameKo || "").trim(),
          nameZh: String(it?.nameZh || "").trim(),
          category: String(it?.category || "").trim(),
          span: String(it?.span || "").trim(),
          confidence: String(it?.confidence || "medium").trim(),
        };
        if (it?.source) row.source = String(it.source).trim();
        if (it?.manualRuleId) row.manualRuleId = String(it.manualRuleId).trim();
        if (it?.locatedManually) row.locatedManually = true;
        const start = Number(it?.start);
        const end = Number(it?.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          row.start = start;
          row.end = end;
        }
        return row;
      })
      .filter((it) => it.name);
  }

  /** 詞彙原形快照（hover 用） */
  function slimVocabItems(vocab) {
    return (Array.isArray(vocab) ? vocab : [])
      .slice(0, 80)
      .map((w) => ({
        surface: String(w?.surface || "").trim(),
        lemma: String(w?.lemma || "").trim(),
        gloss: String(w?.gloss || "").trim(),
        pos: String(w?.pos || "").trim(),
        start: Number.isFinite(w?.start) ? w.start : w?.start == null ? null : Number(w.start),
        end: Number.isFinite(w?.end) ? w.end : w?.end == null ? null : Number(w.end),
      }))
      .filter((w) => w.surface || w.lemma);
  }

  /* —— 全域單字庫（跨句複用） —— */

  function normVocabBankKey(s) {
    return String(s || "")
      .trim()
      .normalize("NFC");
  }

  const SENSE_KEYS = VOCAB_BANK_FIELDS.filter((k) => k !== "surface");

  function senseHasPayload(sense) {
    if (!sense) return false;
    return SENSE_KEYS.some((k) => String(sense[k] || "").trim());
  }

  function pickSenseFields(src) {
    const out = {};
    for (const k of SENSE_KEYS) out[k] = String(src?.[k] || "").trim();
    return out;
  }

  function vocabBankHasPayload(row) {
    if (!row) return false;
    if (Array.isArray(row.senses) && row.senses.some(senseHasPayload)) return true;
    if (Array.isArray(row.alts) && row.alts.some(senseHasPayload)) return true;
    return SENSE_KEYS.some((k) => String(row[k] || "").trim());
  }

  function getPrimarySense(entry) {
    if (!entry) return null;
    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    if (!senses.length) return null;
    const pid = entry.primarySenseId;
    return senses.find((s) => s && s.id === pid) || senses[0];
  }

  /** 扁平舊資料／alts → senses；同步主要義到頂層欄位 */
  function ensureBankEntrySenses(entry) {
    if (!entry || !(entry.surface || entry.lemma)) return entry;
    let senses = Array.isArray(entry.senses) ? entry.senses.filter(Boolean) : [];
    if (!senses.length) {
      const primary = {
        id: entry.primarySenseId || "primary",
        ...pickSenseFields(entry),
        updatedAt: entry.updatedAt || new Date().toISOString(),
      };
      if (senseHasPayload(primary)) senses = [primary];
    }
    (Array.isArray(entry.alts) ? entry.alts : []).forEach((a, i) => {
      if (!senseHasPayload(a)) return;
      const gloss = String(a.gloss || "").trim();
      const lemma = String(a.lemma || "").trim();
      const exists = senses.some(
        (s) => String(s.gloss || "").trim() === gloss && String(s.lemma || "").trim() === lemma
      );
      if (exists) return;
      senses.push({
        id: a.id || `alt-${i}`,
        ...pickSenseFields(a),
        updatedAt: a.updatedAt || entry.updatedAt || new Date().toISOString(),
      });
    });
    if (!senses.length) return entry;
    delete entry.alts;
    if (!entry.primarySenseId || !senses.some((s) => s.id === entry.primarySenseId)) {
      entry.primarySenseId = senses[0].id;
    }
    entry.senses = senses;
    const p = getPrimarySense(entry);
    if (p) {
      for (const k of SENSE_KEYS) entry[k] = p[k] || "";
      entry.updatedAt = p.updatedAt || entry.updatedAt;
    }
    return entry;
  }

  function flattenBankHit(entry) {
    if (!entry) return null;
    const e = ensureBankEntrySenses({
      ...entry,
      senses: (entry.senses || []).map((s) => ({ ...s })),
      alts: (entry.alts || []).map((a) => ({ ...a })),
    });
    if (!vocabBankHasPayload(e)) return null;
    const primary = getPrimarySense(e);
    const flat = {
      surface: e.surface,
      ...pickSenseFields(primary || e),
      updatedAt: e.updatedAt || primary?.updatedAt || "",
      primarySenseId: e.primarySenseId,
      senses: e.senses,
      bankAlts: (e.senses || [])
        .filter((s) => s && s.id !== e.primarySenseId)
        .map((s) => ({ id: s.id, ...pickSenseFields(s) })),
    };
    return flat;
  }

  function rebuildLemmaIndex(bank) {
    const byLemma = {};
    for (const [sk, raw] of Object.entries(bank.bySurface || {})) {
      const row = ensureBankEntrySenses(raw);
      bank.bySurface[sk] = row;
      const lemmas = new Set();
      const pl = normVocabBankKey(row?.lemma);
      if (pl && pl !== sk) lemmas.add(pl);
      for (const s of row.senses || []) {
        const lem = normVocabBankKey(s?.lemma);
        if (lem && lem !== sk) lemmas.add(lem);
      }
      for (const lem of lemmas) {
        if (!byLemma[lem]) byLemma[lem] = [];
        if (!byLemma[lem].includes(sk)) byLemma[lem].push(sk);
      }
    }
    bank.byLemma = byLemma;
    return bank;
  }

  function loadVocabBank() {
    try {
      const raw = localStorage.getItem(VOCAB_BANK_KEY);
      if (!raw) return { bySurface: {}, byLemma: {} };
      const parsed = JSON.parse(raw);
      const bySurface =
        parsed?.bySurface && typeof parsed.bySurface === "object"
          ? parsed.bySurface
          : {};
      let byLemma =
        parsed?.byLemma && typeof parsed.byLemma === "object" ? parsed.byLemma : {};
      const bank = { bySurface, byLemma };
      if (Object.keys(bySurface).length && !Object.keys(byLemma).length) {
        rebuildLemmaIndex(bank);
      }
      return bank;
    } catch {
      return { bySurface: {}, byLemma: {} };
    }
  }

  function pruneVocabBank(bank) {
    const keys = Object.keys(bank.bySurface || {});
    if (keys.length <= VOCAB_BANK_MAX) return bank;
    keys
      .map((k) => ({ k, at: String(bank.bySurface[k]?.updatedAt || "") }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, keys.length - VOCAB_BANK_MAX)
      .forEach(({ k }) => {
        delete bank.bySurface[k];
      });
    rebuildLemmaIndex(bank);
    return bank;
  }

  function saveVocabBank(bank) {
    rebuildLemmaIndex(bank);
    const next = pruneVocabBank({
      bySurface: bank?.bySurface && typeof bank.bySurface === "object" ? bank.bySurface : {},
      byLemma: bank?.byLemma && typeof bank.byLemma === "object" ? bank.byLemma : {},
    });
    localStorage.setItem(VOCAB_BANK_KEY, JSON.stringify(next));
    return next;
  }

  function findVocabBankHit(bank, surface, lemma) {
    const bySurface = bank.bySurface || {};
    const byLemma = bank.byLemma || {};
    const sk = normVocabBankKey(surface);
    if (sk && bySurface[sk] && vocabBankHasPayload(bySurface[sk])) {
      return ensureBankEntrySenses(bySurface[sk]);
    }
    const lk = normVocabBankKey(lemma || surface);
    if (lk && bySurface[lk] && vocabBankHasPayload(bySurface[lk])) {
      return ensureBankEntrySenses(bySurface[lk]);
    }
    if (lk && Array.isArray(byLemma[lk])) {
      let best = null;
      for (const id of byLemma[lk]) {
        const row = bySurface[id];
        if (!row || !vocabBankHasPayload(row)) continue;
        const er = ensureBankEntrySenses(row);
        if (!best || String(er.updatedAt || "") > String(best.updatedAt || "")) best = er;
      }
      return best;
    }
    return null;
  }

  function fillVocabRowFromHit(row, hit) {
    if (!hit) return row;
    const flat = flattenBankHit(hit);
    if (!flat) return row;
    const out = { ...row };
    for (const k of SENSE_KEYS) {
      if (!String(out[k] || "").trim() && String(flat[k] || "").trim()) out[k] = flat[k];
    }
    if (flat.bankAlts?.length) out.bankAlts = flat.bankAlts;
    if (!out.fromBank) out.fromBank = true;
    return out;
  }

  function upsertVocabBankEntries(list, opts = {}) {
    const preferIncoming = Boolean(opts.preferIncoming);
    const bank = loadVocabBank();
    const now = new Date().toISOString();
    let n = 0;
    for (const w of Array.isArray(list) ? list : []) {
      const surface = normVocabBankKey(w?.surface || w?.lemma);
      if (!surface) continue;
      const surfaceDisp = String(w?.surface || w?.lemma || surface).trim();
      const incoming = pickSenseFields(w);
      if (!senseHasPayload(incoming)) continue;

      let entry = bank.bySurface[surface]
        ? ensureBankEntrySenses({ ...bank.bySurface[surface] })
        : { surface: surfaceDisp, senses: [], primarySenseId: "" };

      entry.surface = surfaceDisp || entry.surface || surface;
      if (!Array.isArray(entry.senses)) entry.senses = [];

      const sameGloss = entry.senses.find(
        (s) =>
          String(s.gloss || "").trim() === incoming.gloss &&
          String(s.lemma || "").trim() === incoming.lemma
      );

      if (preferIncoming && incoming.gloss) {
        if (sameGloss) {
          Object.assign(sameGloss, { ...incoming, updatedAt: now });
          entry.primarySenseId = sameGloss.id;
        } else {
          const primary = getPrimarySense(entry);
          const primaryGloss = String(primary?.gloss || "").trim();
          if (primary && primaryGloss && primaryGloss !== incoming.gloss) {
            const sense = { id: newId("vs_"), ...incoming, updatedAt: now };
            entry.senses.push(sense);
            entry.primarySenseId = sense.id;
          } else if (primary) {
            Object.assign(primary, { ...incoming, updatedAt: now });
            entry.primarySenseId = primary.id;
          } else {
            const sense = { id: newId("vs_"), ...incoming, updatedAt: now };
            entry.senses = [sense];
            entry.primarySenseId = sense.id;
          }
        }
      } else {
        let primary = getPrimarySense(entry);
        if (!primary) {
          primary = { id: newId("vs_"), ...incoming, updatedAt: now };
          entry.senses = [primary];
          entry.primarySenseId = primary.id;
        } else {
          for (const k of SENSE_KEYS) {
            if (!String(primary[k] || "").trim() && incoming[k]) primary[k] = incoming[k];
          }
          primary.updatedAt = now;
        }
      }

      entry = ensureBankEntrySenses(entry);
      entry.updatedAt = now;
      if (!vocabBankHasPayload(entry)) continue;
      bank.bySurface[surface] = entry;
      n += 1;
    }
    if (n) saveVocabBank(bank);
    return n;
  }

  function lookupVocabBank(surfaceOrLemma) {
    const key = normVocabBankKey(surfaceOrLemma);
    if (!key) return null;
    const hit = findVocabBankHit(loadVocabBank(), key, key);
    return hit ? flattenBankHit(hit) : null;
  }

  function mergeVocabWithBank(vocabList, queryText, opts = {}) {
    const bank = loadVocabBank();
    if (!bank.byLemma || !Object.keys(bank.byLemma).length) rebuildLemmaIndex(bank);
    const bySurface = bank.bySurface || {};
    const src = String(queryText || "");
    const list = Array.isArray(vocabList) ? vocabList.slice() : [];
    const seen = new Set();

    function enrich(row) {
      const surf = normVocabBankKey(row?.surface);
      if (surf) seen.add(surf);
      const hit = findVocabBankHit(bank, row?.surface, row?.lemma);
      return hit ? fillVocabRowFromHit(row, hit) : row;
    }

    const out = list.map(enrich);
    if (src) {
      const keys = Object.keys(bySurface)
        .filter((k) => k.length >= 2 && src.includes(k) && !seen.has(k))
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
      let added = 0;
      for (const k of keys) {
        if (added >= 40) break;
        const hit = bySurface[k];
        if (!hit || !vocabBankHasPayload(hit)) continue;
        const flat = flattenBankHit(hit) || hit;
        out.push({
          surface: hit.surface || k,
          lemma: flat.lemma || "",
          gloss: flat.gloss || "",
          pos: flat.pos || "",
          bankAlts: flat.bankAlts || [],
          fromBank: true,
          source: "local-bank",
        });
        seen.add(k);
        added += 1;
      }
    }
    // API 已給 lemma、句中 surface 不同時：用 lemma 對庫並保留句中 surface
    const hints = Array.isArray(opts.tokenHints) ? opts.tokenHints : [];
    let hintAdded = 0;
    for (const t of hints) {
      if (hintAdded >= 40) break;
      const surf = String(t?.surface || "").trim();
      if (!surf) continue;
      const sk = normVocabBankKey(surf);
      if (sk && seen.has(sk)) continue;
      const hit = findVocabBankHit(bank, surf, t?.lemma);
      if (!hit || !vocabBankHasPayload(hit)) continue;
      if (src && !src.includes(surf)) continue;
      const flat = flattenBankHit(hit) || hit;
      const row = {
        surface: surf,
        lemma: flat.lemma || String(t.lemma || "").trim() || "",
        gloss: flat.gloss || "",
        pos: flat.pos || "",
        bankAlts: flat.bankAlts || [],
        fromBank: true,
        source: "local-bank",
      };
      const a = Number(t.start);
      const b = Number(t.end);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
        row.start = a;
        row.end = b;
      }
      out.push(row);
      if (sk) seen.add(sk);
      hintAdded += 1;
    }
    return out;
  }

  function harvestVocabBankFromSnapshots() {
    const bank = loadVocabBank();
    if (Object.keys(bank.bySurface || {}).length) return 0;
    const collected = [];
    for (const h of loadHistory()) {
      if (Array.isArray(h?.vocab)) collected.push(...h.vocab);
    }
    try {
      for (const p of listProjects()) {
        for (const e of p.entries || []) {
          if (Array.isArray(e?.vocab)) collected.push(...e.vocab);
        }
      }
    } catch {
      /* ignore */
    }
    return upsertVocabBankEntries(collected, { preferIncoming: false });
  }

  function listVocabBankEntries(filterQ = "") {
    const bank = loadVocabBank();
    const q = normVocabBankKey(filterQ).toLowerCase();
    const rows = Object.entries(bank.bySurface || {})
      .map(([key, raw]) => {
        const e = ensureBankEntrySenses({ ...raw });
        bank.bySurface[key] = e;
        return { key, entry: e, flat: flattenBankHit(e) };
      })
      .filter((r) => r.flat && vocabBankHasPayload(r.entry));
    let list = rows;
    if (q) {
      list = rows.filter(({ entry, flat }) => {
        const blob = [
          entry.surface,
          flat.lemma,
          flat.gloss,
          flat.pos,
          ...(entry.senses || []).map((s) => `${s.gloss} ${s.lemma}`),
        ]
          .join("\n")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort(
      (a, b) =>
        String(b.entry.updatedAt || "").localeCompare(String(a.entry.updatedAt || "")) ||
        String(a.entry.surface || "").localeCompare(String(b.entry.surface || ""))
    );
    return list.map(({ key, entry, flat }) => ({
      key,
      surface: entry.surface,
      ...flat,
      senseCount: (entry.senses || []).length,
    }));
  }

  function removeVocabBankEntry(surfaceKey) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    if (!k || !bank.bySurface[k]) return false;
    delete bank.bySurface[k];
    saveVocabBank(bank);
    return true;
  }

  function removeVocabBankSense(surfaceKey, senseId) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    const entry = bank.bySurface[k];
    if (!entry) return false;
    ensureBankEntrySenses(entry);
    const before = entry.senses.length;
    entry.senses = entry.senses.filter((s) => s.id !== senseId);
    if (!entry.senses.length) {
      delete bank.bySurface[k];
    } else {
      if (entry.primarySenseId === senseId) entry.primarySenseId = entry.senses[0].id;
      ensureBankEntrySenses(entry);
      bank.bySurface[k] = entry;
    }
    saveVocabBank(bank);
    return entry.senses ? entry.senses.length < before || !bank.bySurface[k] : true;
  }

  function setVocabBankPrimarySense(surfaceKey, senseId) {
    const bank = loadVocabBank();
    const k = normVocabBankKey(surfaceKey);
    const entry = bank.bySurface[k];
    if (!entry) return false;
    ensureBankEntrySenses(entry);
    if (!entry.senses.some((s) => s.id === senseId)) return false;
    entry.primarySenseId = senseId;
    ensureBankEntrySenses(entry);
    entry.updatedAt = new Date().toISOString();
    bank.bySurface[k] = entry;
    saveVocabBank(bank);
    return true;
  }

  function estimateVocabBankCoverage(query, tokenHints = []) {
    const src = String(query || "").trim();
    if (!src) return { ratio: 0, hit: 0, total: 0 };
    const bank = loadVocabBank();
    const hints = Array.isArray(tokenHints) ? tokenHints : [];
    if (hints.length) {
      const content = hints.filter((t) => String(t?.surface || "").trim().length >= 2);
      if (!content.length) return { ratio: 0, hit: 0, total: 0 };
      let hit = 0;
      for (const t of content) {
        const h = findVocabBankHit(bank, t.surface, t.lemma);
        if (h && String(h.gloss || "").trim()) hit += 1;
      }
      return { ratio: hit / content.length, hit, total: content.length };
    }
    const keys = Object.keys(bank.bySurface || {}).filter(
      (k) => k.length >= 2 && src.includes(k)
    );
    if (!keys.length) return { ratio: 0, hit: 0, total: 0 };
    let hit = 0;
    for (const k of keys) {
      if (vocabBankHasPayload(bank.bySurface[k])) hit += 1;
    }
    return { ratio: hit / keys.length, hit, total: keys.length };
  }

  /**
   * 新增或更新查詢歷史（同句移到最前）
   * @param {{ query: string, summary?: string, translation?: string, ownedCount?: number, missingCount?: number, items?: object[], vocab?: object[] }} entry
   */
  function addHistoryEntry(entry) {
    const q = String(entry?.query || "").trim();
    if (!q) return loadHistory();
    const norm = q.replace(/\s+/g, " ");
    let list = loadHistory().filter(
      (h) => String(h.query || "").replace(/\s+/g, " ") !== norm
    );
    const item = {
      id:
        (crypto.randomUUID && crypto.randomUUID()) ||
        "h_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      query: q,
      at: new Date().toISOString(),
      summary: String(entry.summary || "").trim(),
      translation: String(entry.translation || "").trim(),
      ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
      missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
      // 完整盤點快照：之後「依現在筆記本重看」可不呼叫 API 重新分類
      items: slimInventoryItems(entry.items),
      vocab: slimVocabItems(entry.vocab),
    };
    list.unshift(item);
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX);
    saveHistory(list);
    return list;
  }

  function removeHistoryEntry(id) {
    const list = loadHistory().filter((h) => h.id !== id);
    saveHistory(list);
    return list;
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }

  /* —— 專案（有序、永久保存；不與一般歷史混用） —— */

  function newId(prefix) {
    return (
      (crypto.randomUUID && crypto.randomUUID()) ||
      prefix + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
    );
  }

  function normalizeQueryKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function loadProjectsStore() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return { projects: [] };
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed?.projects)
        ? parsed.projects
        : Array.isArray(parsed)
          ? parsed
          : [];
      return {
        projects: projects
          .filter((p) => p && p.id)
          .map((p) => ({
            id: String(p.id),
            name: String(p.name || "未命名專案").trim() || "未命名專案",
            createdAt: p.createdAt || new Date().toISOString(),
            updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
            entries: Array.isArray(p.entries)
              ? p.entries
                  .filter((e) => e && e.query)
                  .map((e, i) => ({
                    id: String(e.id || newId("pe_")),
                    seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : i + 1,
                    query: String(e.query || "").trim(),
                    at: e.at || new Date().toISOString(),
                    summary: String(e.summary || "").trim(),
                    translation: String(e.translation || "").trim(),
                    ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
                    missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
                    items: slimInventoryItems(e.items),
                    vocab: slimVocabItems(e.vocab),
                  }))
              : [],
          })),
      };
    } catch {
      return { projects: [] };
    }
  }

  function saveProjectsStore(store) {
    const projects = Array.isArray(store?.projects) ? store.projects : [];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({ projects }));
    return { projects };
  }

  function listProjects() {
    const { projects } = loadProjectsStore();
    return projects
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function getProject(id) {
    if (!id) return null;
    return loadProjectsStore().projects.find((p) => p.id === id) || null;
  }

  function createProject(name) {
    const n = String(name || "").trim() || "未命名專案";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    const project = {
      id: newId("proj_"),
      name: n,
      createdAt: now,
      updatedAt: now,
      entries: [],
    };
    store.projects.push(project);
    saveProjectsStore(store);
    return project;
  }

  function deleteProject(id) {
    const store = loadProjectsStore();
    store.projects = store.projects.filter((p) => p.id !== id);
    saveProjectsStore(store);
    if (getActiveProjectId() === id) setActiveProjectId(null);
    return store.projects;
  }

  function renameProject(id, name) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === id);
    if (!p) return null;
    const n = String(name || "").trim();
    if (!n) return p;
    p.name = n;
    p.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return p;
  }

  function getActiveProjectId() {
    try {
      const id = localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (!id) return null;
      return getProject(id) ? id : null;
    } catch {
      return null;
    }
  }

  function setActiveProjectId(id) {
    if (!id) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    if (!getProject(id)) {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      return null;
    }
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    return id;
  }

  function getActiveProject() {
    return getProject(getActiveProjectId());
  }

  /** 專案內句子依序號排序（序號永久固定，刪除後可有空缺） */
  function getProjectEntriesSorted(projectOrId) {
    const p = typeof projectOrId === "string" ? getProject(projectOrId) : projectOrId;
    if (!p) return [];
    return (p.entries || [])
      .slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.at || "").localeCompare(String(b.at || "")));
  }

  /**
   * 查詢成功後寫入專案：
   * - 同句（空白正規化後相同）已存在 → 更新快照，序號不變
   * - 新句 → append，序號 = max(seq)+1（永久固定）
   * 不寫入一般歷史。
   */
  function upsertProjectEntry(projectId, entry) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const q = String(entry?.query || "").trim();
    if (!q) return p;
    const norm = normalizeQueryKey(q);
    const now = new Date().toISOString();
    const existing = (p.entries || []).find(
      (e) => normalizeQueryKey(e.query) === norm
    );
    if (existing) {
      existing.query = q;
      existing.at = now;
      existing.summary = String(entry.summary || "").trim();
      existing.translation = String(entry.translation || "").trim();
      existing.ownedCount = Number.isFinite(entry.ownedCount) ? entry.ownedCount : null;
      existing.missingCount = Number.isFinite(entry.missingCount) ? entry.missingCount : null;
      existing.items = slimInventoryItems(entry.items);
      existing.vocab = slimVocabItems(entry.vocab);
      // seq 永久不變
    } else {
      const maxSeq = (p.entries || []).reduce(
        (m, e) => Math.max(m, Number(e.seq) || 0),
        0
      );
      p.entries = p.entries || [];
      p.entries.push({
        id: newId("pe_"),
        seq: maxSeq + 1,
        query: q,
        at: now,
        summary: String(entry.summary || "").trim(),
        translation: String(entry.translation || "").trim(),
        ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
        missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
        items: slimInventoryItems(entry.items),
        vocab: slimVocabItems(entry.vocab),
      });
    }
    p.updatedAt = now;
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function removeProjectEntry(projectId, entryId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    p.entries = (p.entries || []).filter((e) => e.id !== entryId);
    p.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return getProject(projectId);
  }

  function findProjectEntryByQuery(projectId, query) {
    const p = getProject(projectId);
    if (!p) return null;
    const norm = normalizeQueryKey(query);
    return (p.entries || []).find((e) => normalizeQueryKey(e.query) === norm) || null;
  }

  function findProjectEntryBySeq(projectId, seq) {
    const p = getProject(projectId);
    if (!p) return null;
    const n = Number(seq);
    return (p.entries || []).find((e) => Number(e.seq) === n) || null;
  }

  function exportProjectsJSON(projectIds) {
    const all = listProjects();
    const set = projectIds && projectIds.length ? new Set(projectIds) : null;
    const projects = set ? all.filter((p) => set.has(p.id)) : all;
    return JSON.stringify(
      {
        type: "mal-korean-grammar-projects",
        version: 1,
        exportedAt: new Date().toISOString(),
        projects,
      },
      null,
      2
    );
  }

  /**
   * 匯入專案 JSON（合併：同 id 覆蓋；無 id 則新建）
   * 接受 { projects: [...] } 或單一 project 物件或 project 陣列
   */
  function importProjectsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.projects.map((p) => [p.id, p]));
    if (mode === "replace") byId = new Map();
    let added = 0;
    let updated = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || newId("proj_"));
      const entries = Array.isArray(raw.entries)
        ? raw.entries
            .filter((e) => e && e.query)
            .map((e, i) => ({
              id: String(e.id || newId("pe_")),
              seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : i + 1,
              query: String(e.query || "").trim(),
              at: e.at || new Date().toISOString(),
              summary: String(e.summary || "").trim(),
              translation: String(e.translation || "").trim(),
              ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
              missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
              items: slimInventoryItems(e.items),
              vocab: slimVocabItems(e.vocab),
            }))
        : [];
      const project = {
        id,
        name: String(raw.name || "未命名專案").trim() || "未命名專案",
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || new Date().toISOString(),
        entries,
      };
      if (byId.has(id)) updated += 1;
      else added += 1;
      byId.set(id, project);
    }
    store.projects = Array.from(byId.values());
    saveProjectsStore(store);
    return { projects: store.projects, added, updated, total: store.projects.length };
  }

  function importProjectsJSON(text) {
    const data = JSON.parse(text);
    let incoming = [];
    if (Array.isArray(data)) {
      incoming = data;
    } else if (data && Array.isArray(data.projects)) {
      incoming = data.projects;
    } else if (data && data.id && (data.entries || data.name)) {
      incoming = [data];
    } else {
      throw new Error("匯入格式需為專案物件、專案陣列，或 { projects: [...] }");
    }
    return importProjectsList(incoming, "merge");
  }

  return {
    loadRules,
    saveRules,
    loadTodos,
    saveTodos,
    getMeta,
    setMeta,
    initWithSeed,
    exportRulesJSON,
    exportDataJSON,
    importRulesJSON,
    importDataJSON,
    resetToSeed,
    loadSettings,
    saveSettings,
    clearApiKey,
    hasApiKey,
    loadLookupMode,
    saveLookupMode,
    loadLookupModes,
    saveLookupModes,
    isApiLookupEnabled,
    formatLookupModesLabel,
    DEFAULT_LOOKUP_MODES,
    loadHistory,
    saveHistory,
    addHistoryEntry,
    removeHistoryEntry,
    clearHistory,
    slimInventoryItems,
    slimVocabItems,
    loadVocabBank,
    saveVocabBank,
    upsertVocabBankEntries,
    lookupVocabBank,
    listVocabBankEntries,
    removeVocabBankEntry,
    removeVocabBankSense,
    setVocabBankPrimarySense,
    estimateVocabBankCoverage,
    mergeVocabWithBank,
    harvestVocabBankFromSnapshots,
    VOCAB_BANK_MAX,
    HISTORY_MAX,
    normalizeStructureTheme,
    DEFAULT_SETTINGS,
    STRUCTURE_THEMES,
    listProjects,
    getProject,
    createProject,
    deleteProject,
    renameProject,
    getActiveProjectId,
    setActiveProjectId,
    getActiveProject,
    getProjectEntriesSorted,
    upsertProjectEntry,
    removeProjectEntry,
    findProjectEntryByQuery,
    findProjectEntryBySeq,
    exportProjectsJSON,
    importProjectsJSON,
    normalizeQueryKey,
  };
})();
