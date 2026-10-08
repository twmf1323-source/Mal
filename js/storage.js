/**
 * 規則／待辦／設定：localStorage（kgn_*）
 * 專案句子快照：IndexedDB（kgn_idb_v1），不受約 5MB 上限
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
  const IDB_NAME = "kgn_idb_v1";
  const IDB_VERSION = 1;
  const IDB_STORE = "kv";
  const IDB_PROJECTS_KEY = "projects_v1";
  const ACTIVE_PROJECT_KEY = "kgn_active_project_v1";
  const VOCAB_BANK_KEY = "kgn_vocab_bank_v1";
  const VOCAB_BANK_MAX = 5000;
  const VOCAB_BANK_FIELDS = ["surface", "lemma", "gloss", "pos"];
  /** 換句連按時合併寫入，避免每次 structuredClone 整包專案 */
  const PROJECTS_FLUSH_MS = 400;

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
    apiProvider: "grok",
    apiProfiles: {},
    structureTheme: "indigo",
    kiwiEnabled: true,
    apiTtsEnabled: false,
    lookupModes: { ...DEFAULT_LOOKUP_MODES },
  };

  const API_PROVIDERS = [
    {
      id: "grok",
      label: "Grok",
      hint: "SpaceXAI / xAI · OpenAI 相容",
      signup: "https://console.x.ai",
      signupLabel: "console.x.ai",
      keyPlaceholder: "xAI API Key",
      baseUrl: "https://api.x.ai/v1",
      defaultModel: "grok-4.6",
      urlLocked: true,
      models: [
        { id: "grok-4.6", label: "Grok 4.6" },
        { id: "grok-4.5", label: "Grok 4.5" },
        { id: "grok-4-1-fast", label: "Grok 4.1 Fast" },
        { id: "grok-code-fast-1", label: "Grok Code Fast" },
      ],
    },
    {
      id: "google",
      label: "Google",
      hint: "Gemini · OpenAI 相容端點",
      signup: "https://aistudio.google.com/apikey",
      signupLabel: "Google AI Studio",
      keyPlaceholder: "Gemini API Key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-2.5-flash",
      urlLocked: true,
      models: [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      ],
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      hint: "DeepSeek Chat / Reasoner · OpenAI 相容",
      signup: "https://platform.deepseek.com",
      signupLabel: "platform.deepseek.com",
      keyPlaceholder: "DeepSeek API Key",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      urlLocked: true,
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
      ],
    },
    {
      id: "custom",
      label: "自訂",
      hint: "其他 OpenAI 相容端點（自行填 Base URL 與模型名）",
      signup: "",
      signupLabel: "",
      keyPlaceholder: "API Key",
      baseUrl: "",
      defaultModel: "",
      urlLocked: false,
      models: [],
    },
  ];

  function getApiProvider(id) {
    return API_PROVIDERS.find((p) => p.id === id) || API_PROVIDERS[0];
  }

  function inferApiProviderId(settings) {
    const explicit = String(settings?.apiProvider || "").trim();
    if (API_PROVIDERS.some((p) => p.id === explicit)) return explicit;
    const url = String(settings?.baseUrl || "").toLowerCase();
    if (/generativelanguage\.googleapis\.com/.test(url)) return "google";
    if (/deepseek\.com/.test(url)) return "deepseek";
    if (/x\.ai/.test(url) || !url.trim()) return "grok";
    return "custom";
  }

  function canonicalizeBaseUrl(url, providerId) {
    const preset = getApiProvider(providerId);
    let next = String(url || "").trim().replace(/\/+$/, "");
    if (preset.urlLocked && preset.baseUrl) {
      return String(preset.baseUrl).trim().replace(/\/+$/, "");
    }
    if (/^https?:\/\/api\.x\.ai$/i.test(next)) return "https://api.x.ai/v1";
    return next;
  }

  function emptyApiProfiles() {
    const out = {};
    for (const p of API_PROVIDERS) {
      out[p.id] = { apiKey: "", baseUrl: p.baseUrl, model: p.defaultModel };
    }
    return out;
  }

  function normalizeApiProfiles(raw, current) {
    const out = emptyApiProfiles();
    const src = raw && typeof raw === "object" ? raw : {};
    for (const p of API_PROVIDERS) {
      const row = src[p.id] && typeof src[p.id] === "object" ? src[p.id] : {};
      out[p.id] = {
        apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
        baseUrl: canonicalizeBaseUrl(row.baseUrl || p.baseUrl || "", p.id),
        model: String(row.model || p.defaultModel || "").trim(),
      };
    }
    const pid = inferApiProviderId(current);
    if (current?.apiKey && !out[pid].apiKey) {
      out[pid] = {
        apiKey: String(current.apiKey || "").trim(),
        baseUrl: canonicalizeBaseUrl(current.baseUrl || out[pid].baseUrl || "", pid),
        model: String(current.model || out[pid].model || "").trim(),
      };
    }
    return out;
  }

  function upsertCurrentApiProfile(settings) {
    const pid = inferApiProviderId(settings);
    const profiles = normalizeApiProfiles(settings?.apiProfiles, settings);
    profiles[pid] = {
      apiKey: String(settings?.apiKey || "").trim(),
      baseUrl: canonicalizeBaseUrl(settings?.baseUrl, pid),
      model: String(settings?.model || "").trim(),
    };
    return {
      ...settings,
      apiProvider: pid,
      baseUrl: profiles[pid].baseUrl,
      apiProfiles: profiles,
    };
  }

  function applyProviderProfile(settings, providerId) {
    const pid = getApiProvider(providerId).id;
    const preset = getApiProvider(pid);
    const profiles = normalizeApiProfiles(settings?.apiProfiles, settings);
    const saved = profiles[pid] || {};
    const baseUrl = canonicalizeBaseUrl(saved.baseUrl || preset.baseUrl, pid);
    return {
      ...settings,
      apiProvider: pid,
      apiKey: saved.apiKey || "",
      baseUrl,
      model: saved.model || preset.defaultModel,
      apiProfiles: profiles,
    };
  }

  function switchApiProvider(id, currentFields) {
    let s = loadSettings();
    if (currentFields && typeof currentFields === "object") s = { ...s, ...currentFields };
    s = upsertCurrentApiProfile(s);
    s = applyProviderProfile(s, id);
    return saveSettings(s);
  }

  function normalizeStructureTheme(id) {
    const ok = STRUCTURE_THEMES.some((t) => t.id === id);
    return ok ? id : DEFAULT_SETTINGS.structureTheme;
  }

  /** 內建種子卡的 id 一律是 seed- 開頭。使用者新卡是 UUID 或 r_ 開頭。 */
  function isBuiltinSeedRule(rule) {
    return String(rule && rule.id || "").startsWith("seed-");
  }

  function stripBuiltinSeedRules(rules) {
    const list = Array.isArray(rules) ? rules : [];
    const next = [];
    let changed = false;
    for (const rule of list) {
      if (!rule || isBuiltinSeedRule(rule)) {
        changed = true;
        continue;
      }
      next.push(rule);
    }
    return { rules: next, changed };
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
    const kept = stripBuiltinSeedRules(rules).rules;
    localStorage.setItem(RULES_KEY, JSON.stringify(kept));
    setMeta({ lastSaved: new Date().toISOString() });
    return kept;
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
      "seed-adnominal-eul",
      "seed-subject",
      "seed-deusi",
      "seed-object",
      "seed-object-contraction-nal",
      "seed-object-contraction-neol",
      "seed-object-contraction-jeol",
      "seed-ui",
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
      "seed-l-deletion",
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
    "主題（는）": "主題（은/는）",
    "主題（은）": "主題（은/는）",
    "主題助詞（는）": "主題（은/는）",
    "主題助詞（은）": "主題（은/는）",
    "主格（가）": "主格（이/가）",
    "主格（이）": "主格（이/가）",
    "賓格（를）": "賓格（을/를）",
    "賓格（을）": "賓格（을/를）",
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
    "定語助詞（의）": "所有格（의）",
    "所有格助詞（의）": "所有格（의）",
    "屬格助詞（의）": "所有格（의）",
    "屬格（의）": "所有格（의）",
    "定語格（의）": "所有格（의）",
    "冠形格（의）": "所有格（의）",
    "冠形格助詞（의）": "所有格（의）",
    "無論（-든지）": "不論（-든지）",
    "如同（듯이）": "比喻（듯이）",
    "話題助詞（은/는）": "主題（은/는）",
    "動詞背景對比（-는데）": "背景對比（-는데）",
    "處所助詞（에）": "時間地點（에）",
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

  function titleDedupeKey(raw) {
    return String(raw || "")
      .normalize("NFKC")
      .replace(/[（(]/g, "(")
      .replace(/[）)]/g, ")")
      .replace(/[／/]/g, "/")
      .replace(/[〜～~]/g, "~")
      .replace(/[‐‑–—−]/g, "-")
      .replace(/[\s\u00A0\u3000\u200B-\u200D\u2060\uFEFF]+/g, "")
      .replace(/。+$/g, "")
      .toLowerCase();
  }

  function ruleCompletenessScore(rule) {
    const exp = String(rule?.explanation || "").length;
    const st = String(rule?.structure || "").length;
    const kw = Array.isArray(rule?.keywords) ? rule.keywords.filter(Boolean).length : 0;
    return exp * 4 + st * 3 + kw * 12;
  }

  function absorbRuleFields(winner, loser) {
    if (!winner || !loser) return winner;
    const next = { ...winner };
    if (!String(next.structure || "").trim() && String(loser.structure || "").trim()) {
      next.structure = loser.structure;
    }
    if (
      (!Array.isArray(next.keywords) || !next.keywords.length) &&
      Array.isArray(loser.keywords) &&
      loser.keywords.length
    ) {
      next.keywords = loser.keywords.slice();
    }
    if (String(loser.explanation || "").length > String(next.explanation || "").length) {
      next.explanation = loser.explanation;
    }
    return next;
  }

  function pickRicherRule(a, b) {
    const sa = ruleCompletenessScore(a);
    const sb = ruleCompletenessScore(b);
    if (sa !== sb) return sa >= sb ? a : b;
    const ua = Date.parse(a?.updated_at) || 0;
    const ub = Date.parse(b?.updated_at) || 0;
    if (ua !== ub) return ua >= ub ? a : b;
    return a;
  }

  /** 同標題（含全形／空白差）只留較完整的一張 */
  function dedupeDuplicateRules(rules) {
    const list = Array.isArray(rules) ? rules.filter((r) => r && r.id) : [];
    const byKey = new Map();
    for (const r of list) {
      const key = titleDedupeKey(r.title) || `id:${r.id}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, r);
        continue;
      }
      const win = pickRicherRule(prev, r);
      const loser = win === prev ? r : prev;
      byKey.set(key, absorbRuleFields(win, loser));
    }
    const seen = new Set();
    const out = [];
    for (const r of list) {
      const key = titleDedupeKey(r.title) || `id:${r.id}`;
      const win = byKey.get(key);
      if (!win || seen.has(win.id)) continue;
      seen.add(win.id);
      out.push(win);
    }
    const changed = out.length !== list.length || out.some((r, i) => r !== list[i]);
    return { rules: out, changed };
  }

  /**
   * 開啟筆記本時去掉全部內建種子卡。不再讀 seed-rules.json，也不從 GitHub Pages 補回。
   * 使用者自己建的規則留下。
   */
  async function initWithSeed() {
    let next = loadRules();
    if (!Array.isArray(next)) next = [];
    let changed = false;
    const stripped = stripBuiltinSeedRules(next);
    next = stripped.rules;
    changed = stripped.changed || changed;
    const mig = migrateVowelContractionSeeds(next);
    next = mig.rules;
    changed = mig.changed || changed;
    const titleMig = migrateRuleTitles(next);
    next = titleMig.rules;
    changed = titleMig.changed || changed;
    const dedupe = dedupeDuplicateRules(next);
    next = dedupe.rules;
    changed = changed || dedupe.changed;

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
    if (!meta.rulesCanonicalSortV2At) {
      const reo = reorderRulesCanonical(next);
      next = reo.rules;
      changed = reo.changed || changed;
      setMeta({ rulesCanonicalSortV2At: new Date().toISOString() });
    }
    if (!meta.builtinSeedsRemovedAt) {
      setMeta({ builtinSeedsRemovedAt: new Date().toISOString() });
    }
    if (changed) saveRules(next);
    return next;
  }

  function exportRulesJSON(rules) {
    return JSON.stringify(rules, null, 2);
  }

  /**
   * 資料管理：規則 + 專案一併匯出
   * 相容舊版純規則陣列匯入；新檔為 { type, rules, projects }
   */
  function exportDataJSON(rules) {
    const list = stripBuiltinSeedRules(Array.isArray(rules) ? rules : loadRules() || []).rules;
    return JSON.stringify(
      {
        type: "mal-korean-grammar-backup",
        version: 2,
        exportedAt: new Date().toISOString(),
        rules: list,
        projects: listProjects(),
        collections: listCollections(),
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
    const incomingKept = stripBuiltinSeedRules(incoming).rules;
    const current = stripBuiltinSeedRules(loadRules() || []).rules;
    if (mode === "replace") return saveRules(incomingKept);
    const byId = new Map(current.map((r) => [r.id, r]));
    for (const r of incomingKept) {
      if (r && r.id) byId.set(r.id, r);
    }
    return saveRules(Array.from(byId.values()));
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
      if (Array.isArray(data.collections) && data.collections.length) {
        importCollectionsList(data.collections, mode);
      }
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
   * 刪除筆記本內容：規則、待辦、專案（含 IndexedDB）、單字本、查詢歷史。不載入預設種子。
   * 保留 API 設定。單字本的來源（歷史、專案句子）一併清掉，避免下次開啟再被收回來。
   */
  async function clearAllNotebookData() {
    adoptProjectsCache(emptyProjectsStore());
    projectsDirty = true;
    try {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {
      /* ignore */
    }

    let idbCleared = false;
    try {
      if (idbAvailable()) {
        if (!projectsDb) projectsDb = await openProjectsDb();
        projectsBackend = "idb";
        await flushProjects();
        await idbPut(projectsDb, IDB_PROJECTS_KEY, emptyProjectsStore());
        projectsDirty = false;
        idbCleared = true;
        try {
          writeProjectsLocalStorageStub();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn("[clear all] IndexedDB", err);
    }
    if (!idbCleared) {
      writeProjectsLocalStorageFull(emptyProjectsStore());
      projectsBackend = "localStorage";
      projectsDirty = false;
    }

    clearHistory();
    vocabBankCache = null;
    try {
      localStorage.removeItem(VOCAB_BANK_KEY);
    } catch {
      /* ignore */
    }
    resetToSeed();
  }

  /**
   * 查詢模式：API 文法 · API 單字（可獨立）；本地文法排查已取消
   * 相容舊版 LOOKUP_MODE_KEY（api | local）—— local 視為手動模式
   */
  function normalizeLookupModes(input) {
    const src = input && typeof input === "object" ? input : null;
    let apiGrammar;
    let apiVocab;
    if (src && ("apiGrammar" in src || "localGrammar" in src || "apiVocab" in src)) {
      apiGrammar = Boolean(src.apiGrammar);
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
        apiVocab = false;
      } else {
        apiGrammar = true;
        apiVocab = true;
      }
    }
    return { apiGrammar, localGrammar: false, apiVocab };
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
        apiTtsEnabled: parsed?.apiTtsEnabled === true,
      };
      base.lookupModes = normalizeLookupModes(
        parsed && typeof parsed === "object" ? parsed.lookupModes : null
      );
      base.apiProfiles = normalizeApiProfiles(parsed?.apiProfiles, base);
      base.apiProvider = inferApiProviderId(base);
      base.baseUrl = canonicalizeBaseUrl(base.baseUrl, base.apiProvider);
      const next = upsertCurrentApiProfile(base);
      const oldUrl = String(parsed?.baseUrl || "").trim().replace(/\/+$/, "");
      const oldGrok = String(parsed?.apiProfiles?.grok?.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
      if (
        oldUrl !== next.baseUrl ||
        (oldGrok && oldGrok !== next.apiProfiles?.grok?.baseUrl)
      ) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }
      return next;
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
    next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
    next.structureTheme = normalizeStructureTheme(next.structureTheme);
    next.kiwiEnabled = next.kiwiEnabled !== false;
    next.apiTtsEnabled = next.apiTtsEnabled === true;
    next.apiProvider = inferApiProviderId(next);
    next.baseUrl = canonicalizeBaseUrl(next.baseUrl, next.apiProvider);
    Object.assign(next, upsertCurrentApiProfile(next));
    if (partial && Object.prototype.hasOwnProperty.call(partial, "lookupModes")) {
      next.lookupModes = normalizeLookupModes(partial.lookupModes);
    } else {
      next.lookupModes = normalizeLookupModes(next.lookupModes);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  function clearApiKey() {
    const s = loadSettings();
    const pid = inferApiProviderId(s);
    const profiles = normalizeApiProfiles(s.apiProfiles, s);
    if (profiles[pid]) profiles[pid] = { ...profiles[pid], apiKey: "" };
    return saveSettings({ apiKey: "", apiProfiles: profiles, apiProvider: pid });
  }

  function hasApiKey() {
    return Boolean(loadSettings().apiKey);
  }

  /** @deprecated 相容舊碼：api | local（本地排查已取消，local 視為手動） */
  function loadLookupMode() {
    const m = loadLookupModes();
    return m.apiGrammar || m.apiVocab ? "api" : "manual";
  }

  function saveLookupMode(mode) {
    if (mode === "local") {
      return saveLookupModes({ apiGrammar: false, localGrammar: false, apiVocab: false });
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
    const next = normalizeLookupModes(merged);
    saveSettings({ lookupModes: next });
    try {
      if (next.apiGrammar) localStorage.setItem(LOOKUP_MODE_KEY, "api");
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
        const tokenFrom = Number(it?.tokenFrom);
        const tokenTo = Number(it?.tokenTo);
        if (Number.isFinite(tokenFrom)) row.tokenFrom = tokenFrom;
        if (Number.isFinite(tokenTo)) row.tokenTo = tokenTo;
        if (it?.kiwiKind) row.kiwiKind = String(it.kiwiKind);
        if (it?.grammarKey) row.grammarKey = String(it.grammarKey);
        if (it?.candidateId) row.candidateId = String(it.candidateId);
        return row;
      })
      .filter((it) => it.name);
  }

  /** 形態素切詞快照（hover／分析板／重看用） */
  function slimTokens(tokens) {
    if (typeof KoParse !== "undefined" && KoParse.slimTokens) {
      return KoParse.slimTokens(tokens);
    }
    return (Array.isArray(tokens) ? tokens : [])
      .slice(0, 240)
      .map((t) => ({
        word: String(t?.word ?? ""),
        form: String(t?.form || "").trim(),
        pos: String(t?.pos || "").trim(),
        tag: String(t?.tag || "").trim(),
        lemma: String(t?.lemma || "").trim(),
        start: Number.isFinite(t?.start) ? t.start : t?.start == null ? null : Number(t.start),
        end: Number.isFinite(t?.end) ? t.end : t?.end == null ? null : Number(t.end),
        length: Number.isFinite(t?.length) ? t.length : 0,
        zeroWidth: Boolean(t?.zeroWidth),
        kiwiPosition: Number.isFinite(t?.kiwiPosition) ? t.kiwiPosition : null,
        wordPosition: Number.isFinite(t?.wordPosition) ? t.wordPosition : null,
      }))
      .filter((t) => t.word || t.form);
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

  const LATIN_WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const KO_SCRIPT_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF]/;

  /** 歌詞夾雜的英文（拉丁字母、無韓文）— 不查 API、不收入單字庫 */
  function isEnglishVocabSkip(surface, lemma) {
    for (const raw of [surface, lemma]) {
      const s = String(raw || "").trim();
      if (!s) continue;
      if (KO_SCRIPT_RE.test(s)) continue;
      if (/[A-Za-z]/.test(s)) return true;
    }
    return false;
  }

  function filterEnglishVocab(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((w) => !isEnglishVocabSkip(w?.surface, w?.lemma));
  }

  /** 人稱代詞：나↔내（나의）、너↔네、저↔제。單音節，API／詞庫常漏。 */
  const PRONOUN_ENTRIES = [
    { form: "저희", lemma: "저희", gloss: "我們（謙稱）", pos: "代詞" },
    { form: "우리", lemma: "우리", gloss: "我們", pos: "代詞" },
    { form: "나", lemma: "나", gloss: "我", pos: "代詞" },
    { form: "너", lemma: "너", gloss: "你", pos: "代詞" },
    { form: "저", lemma: "저", gloss: "我（謙稱）", pos: "代詞" },
    { form: "내", lemma: "나", gloss: "我的（나）", pos: "代詞" },
    { form: "네", lemma: "너", gloss: "你的（너）", pos: "代詞" },
    { form: "제", lemma: "저", gloss: "我的（謙稱）", pos: "代詞" },
  ];
  const PRONOUN_FORM_SET = new Set(PRONOUN_ENTRIES.map((p) => p.form));
  const PRONOUN_LEMMA_ALTS = {
    나: ["내", "내가"],
    너: ["네", "네가", "니가"],
    저: ["제", "제가"],
    내: ["나"],
    네: ["너"],
    제: ["저"],
  };
  const PRONOUN_PARTICLE_TAIL =
    /^(는|은|를|을|가|이|의|와|과|도|만|요|죠|께|한테|에게|에서|으로|로|부터|까지)?$/;

  function isHangulSyllableCh(ch) {
    const c = String(ch || "").charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  function pronounAlts(key) {
    const k = String(key || "").trim();
    const extra = PRONOUN_LEMMA_ALTS[k] || [];
    return [k, ...extra].filter(Boolean);
  }

  function findPronounLocs(text) {
    const src = String(text || "").normalize("NFC");
    const hits = [];
    const seen = new Set();
    let i = 0;
    while (i < src.length) {
      if (!isHangulSyllableCh(src[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && isHangulSyllableCh(src[j])) j++;
      const run = src.slice(i, j);
      for (const p of PRONOUN_ENTRIES) {
        if (run === p.form) {
          const key = `${i}-${i + p.form.length}`;
          if (!seen.has(key)) {
            seen.add(key);
            hits.push({
              start: i,
              end: i + p.form.length,
              surface: p.form,
              lemma: p.lemma,
              gloss: p.gloss,
              pos: p.pos,
            });
          }
          break;
        }
        if (run.startsWith(p.form) && PRONOUN_PARTICLE_TAIL.test(run.slice(p.form.length))) {
          const key = `${i}-${i + p.form.length}`;
          if (!seen.has(key)) {
            seen.add(key);
            hits.push({
              start: i,
              end: i + p.form.length,
              surface: p.form,
              lemma: p.lemma,
              gloss: p.lemma === p.form ? p.gloss : p.gloss,
              pos: p.pos,
            });
          }
          break;
        }
      }
      i = j;
    }
    return hits;
  }

  function ensurePronounVocab(query, vocabList) {
    const src = String(query || "");
    const list = Array.isArray(vocabList) ? vocabList.slice() : [];
    const locs = findPronounLocs(src);
    if (!locs.length) return list;

    function alreadyCovers(loc) {
      return list.some((w) => {
        const a = Number(w.start);
        const b = Number(w.end);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
          return !(loc.end <= a || loc.start >= b);
        }
        const surf = String(w.surface || "").trim();
        const lem = String(w.lemma || "").trim();
        if (surf === loc.surface || lem === loc.lemma || surf === loc.lemma || lem === loc.surface) {
          return src.includes(surf) || src.includes(lem);
        }
        return pronounAlts(lem).includes(loc.surface) || pronounAlts(surf).includes(loc.surface);
      });
    }

    for (const loc of locs) {
      if (alreadyCovers(loc)) continue;
      list.push({
        surface: loc.surface,
        lemma: loc.lemma,
        gloss: loc.gloss,
        pos: loc.pos,
        start: loc.start,
        end: loc.end,
        source: "pronoun-hint",
      });
    }
    return list;
  }

  function stripEnglishFromVocabQuery(query) {
    return String(query || "")
      .replace(LATIN_WORD_RE, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function vocabQueryHasTargetLanguage(query) {
    return KO_SCRIPT_RE.test(String(query || ""));
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

  let vocabBankCache = null;

  function emptyVocabBank() {
    return { bySurface: {}, byLemma: {} };
  }

  function loadVocabBank() {
    if (vocabBankCache) return vocabBankCache;
    try {
      const raw = localStorage.getItem(VOCAB_BANK_KEY);
      if (!raw) {
        vocabBankCache = emptyVocabBank();
        return vocabBankCache;
      }
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
      vocabBankCache = bank;
      return bank;
    } catch {
      vocabBankCache = emptyVocabBank();
      return vocabBankCache;
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
    vocabBankCache = next;
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
      if (isEnglishVocabSkip(w?.surface, w?.lemma)) continue;
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
    const list = filterEnglishVocab(Array.isArray(vocabList) ? vocabList : []);
    const seen = new Set();

    function enrich(row) {
      const surf = normVocabBankKey(row?.surface);
      if (surf) seen.add(surf);
      const hit = findVocabBankHit(bank, row?.surface, row?.lemma);
      return hit ? fillVocabRowFromHit(row, hit) : row;
    }

    const out = list.map(enrich);
    if (src && !opts.enrichOnly) {
      const keys = Object.keys(bySurface)
        .filter((k) => {
          if (seen.has(k)) return false;
          if (k.length >= 2) return src.includes(k);
          if (!PRONOUN_FORM_SET.has(k)) return false;
          return pronounAlts(k).some((a) => src.includes(a));
        })
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
      let added = 0;
      for (const k of keys) {
        if (added >= 40) break;
        if (isEnglishVocabSkip(k)) continue;
        const hit = bySurface[k];
        if (!hit || !vocabBankHasPayload(hit)) continue;
        const flat = flattenBankHit(hit) || hit;
        const surfaceInSrc = src.includes(k)
          ? k
          : pronounAlts(k).find((a) => a !== k && src.includes(a)) || hit.surface || k;
        out.push({
          surface: surfaceInSrc,
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
      if (isEnglishVocabSkip(surf, t?.lemma)) continue;
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
  function mergeKeptTranslation(prev, incoming, replace) {
    if (replace) return String(incoming || "").trim();
    const old = String(prev || "").trim();
    if (old) return old;
    return String(incoming || "").trim();
  }

  function addHistoryEntry(entry) {
    const q = String(entry?.query || "").trim();
    if (!q) return loadHistory();
    const norm = q.replace(/\s+/g, " ");
    const prevList = loadHistory();
    const prev = prevList.find((h) => String(h.query || "").replace(/\s+/g, " ") === norm);
    let list = prevList.filter(
      (h) => String(h.query || "").replace(/\s+/g, " ") !== norm
    );
    const item = {
      id:
        (crypto.randomUUID && crypto.randomUUID()) ||
        "h_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      query: q,
      at: new Date().toISOString(),
      summary: String(entry.summary || "").trim(),
      translation: mergeKeptTranslation(prev?.translation, entry.translation, entry.replaceTranslation),
      ownedCount: Number.isFinite(entry.ownedCount) ? entry.ownedCount : null,
      missingCount: Number.isFinite(entry.missingCount) ? entry.missingCount : null,
      // 完整盤點快照：之後「依現在筆記本重看」可不呼叫 API 重新分類
      items: slimInventoryItems(entry.items),
      vocab: (() => {
        const incomingVocab = slimVocabItems(entry.vocab);
        if (incomingVocab.length || !Array.isArray(prev?.vocab) || !prev.vocab.length) {
          return incomingVocab;
        }
        return slimVocabItems(prev.vocab);
      })(),
      tokens: (() => {
        const incoming = slimTokens(entry.tokens);
        if (incoming.length || !Array.isArray(prev?.tokens) || !prev.tokens.length) {
          return incoming;
        }
        return slimTokens(prev.tokens);
      })(),
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

  /* 大項 collections 只做容器；句子只存在分項 project。專案列表會把全部分項直接鋪開。 */
  const UNGROUPED_COLLECTION_ID = "";

  function normalizeCollection(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || "").trim();
    if (!id) return null;
    return {
      id,
      name: String(raw.name || "未命名").trim() || "未命名",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
      lastProjectId: String(raw.lastProjectId || "").trim(),
    };
  }

  function normalizeProjectRecord(p, i = 0) {
    if (!p || !p.id) return null;
    return {
      id: String(p.id),
      name: String(p.name || "未命名專案").trim() || "未命名專案",
      collectionId: String(p.collectionId || UNGROUPED_COLLECTION_ID).trim(),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      entries: Array.isArray(p.entries)
        ? p.entries
            .filter((e) => e && e.query)
            .map((e, ei) => ({
              id: String(e.id || newId("pe_")),
              seq: Number.isFinite(Number(e.seq)) ? Number(e.seq) : ei + 1,
              query: String(e.query || "").trim(),
              at: e.at || new Date().toISOString(),
              summary: String(e.summary || "").trim(),
              translation: String(e.translation || "").trim(),
              ownedCount: Number.isFinite(e.ownedCount) ? e.ownedCount : null,
              missingCount: Number.isFinite(e.missingCount) ? e.missingCount : null,
              items: slimInventoryItems(e.items),
              vocab: slimVocabItems(e.vocab),
              tokens: slimTokens(e.tokens),
            }))
        : [],
    };
  }

  /** 記憶體快取：讀寫同步；IndexedDB 非同步落盤 */
  let projectsCache = null;
  let projectsBackend = "localStorage";
  let projectsDb = null;
  let projectsDirty = false;
  let projectsFlushTimer = null;
  let projectsFlushPromise = null;
  let projectsInitPromise = null;

  function emptyProjectsStore() {
    return { collections: [], projects: [] };
  }

  function isProjectsIdbStub(parsed) {
    return Boolean(parsed && typeof parsed === "object" && parsed.__idb === true);
  }

  function storePayloadCount(store) {
    return (store?.projects?.length || 0) + (store?.collections?.length || 0);
  }

  function normalizeProjectsStoreObject(parsed) {
    if (!parsed || typeof parsed !== "object" || isProjectsIdbStub(parsed)) {
      return emptyProjectsStore();
    }
    const projectsRaw = Array.isArray(parsed.projects)
      ? parsed.projects
      : Array.isArray(parsed)
        ? parsed
        : [];
    const collections = (Array.isArray(parsed.collections) ? parsed.collections : [])
      .map((c) => normalizeCollection(c))
      .filter(Boolean);
    const colIds = new Set(collections.map((c) => c.id));
    const projects = projectsRaw
      .map((p, i) => normalizeProjectRecord(p, i))
      .filter(Boolean)
      .map((p) => {
        if (p.collectionId && !colIds.has(p.collectionId)) p.collectionId = UNGROUPED_COLLECTION_ID;
        return p;
      });
    for (const c of collections) {
      if (c.lastProjectId && !projects.some((x) => x.id === c.lastProjectId)) {
        c.lastProjectId = "";
      }
    }
    return { collections, projects };
  }

  function readProjectsLocalStorageRaw() {
    try {
      return localStorage.getItem(PROJECTS_KEY);
    } catch {
      return null;
    }
  }

  function parseProjectsLocalStorage() {
    const raw = readProjectsLocalStorageRaw();
    if (!raw) return { store: emptyProjectsStore(), stub: false, missing: true };
    try {
      const parsed = JSON.parse(raw);
      if (isProjectsIdbStub(parsed)) {
        return { store: emptyProjectsStore(), stub: true, missing: false };
      }
      return { store: normalizeProjectsStoreObject(parsed), stub: false, missing: false };
    } catch {
      return { store: emptyProjectsStore(), stub: false, missing: false };
    }
  }

  function quotaError(err) {
    const msg = String(err && (err.name + " " + err.message));
    if (/quota|QuotaExceeded/i.test(msg)) {
      return new Error("瀏覽器儲存空間不足，無法再寫入專案句子");
    }
    return null;
  }

  function writeProjectsLocalStorageFull(store) {
    localStorage.setItem(
      PROJECTS_KEY,
      JSON.stringify({
        collections: Array.isArray(store?.collections) ? store.collections : [],
        projects: Array.isArray(store?.projects) ? store.projects : [],
      })
    );
  }

  function writeProjectsLocalStorageStub() {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({ __idb: true }));
  }

  function idbAvailable() {
    return typeof indexedDB !== "undefined";
  }

  function openProjectsDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 無法開啟"));
    });
  }

  function idbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("IndexedDB 寫入中止"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB 寫入失敗"));
      tx.objectStore(IDB_STORE).put(value, key);
    });
  }

  function adoptProjectsCache(store) {
    projectsCache = {
      collections: Array.isArray(store?.collections) ? store.collections : [],
      projects: Array.isArray(store?.projects) ? store.projects : [],
    };
    return projectsCache;
  }

  async function initProjectsDb() {
    if (projectsInitPromise) return projectsInitPromise;
    projectsInitPromise = (async () => {
      const fromLs = parseProjectsLocalStorage();
      if (!idbAvailable()) {
        adoptProjectsCache(fromLs.store);
        projectsBackend = "localStorage";
        return { backend: projectsBackend };
      }
      try {
        projectsDb = await openProjectsDb();
        const idbVal = await idbGet(projectsDb, IDB_PROJECTS_KEY);
        const fromIdb =
          idbVal && typeof idbVal === "object"
            ? normalizeProjectsStoreObject(idbVal)
            : null;
        const idbHas = fromIdb && storePayloadCount(fromIdb) > 0;
        const lsHas = !fromLs.stub && storePayloadCount(fromLs.store) > 0;
        const idbRecordExists = idbVal != null;

        if (idbHas || (idbRecordExists && !lsHas)) {
          adoptProjectsCache(fromIdb || emptyProjectsStore());
          projectsBackend = "idb";
          projectsDirty = false;
          try {
            writeProjectsLocalStorageStub();
          } catch {
            /* 騰出 localStorage；失敗不影響 IndexedDB */
          }
          return { backend: "idb", migrated: false };
        }

        adoptProjectsCache(lsHas ? fromLs.store : emptyProjectsStore());
        await idbPut(projectsDb, IDB_PROJECTS_KEY, projectsCache);
        projectsBackend = "idb";
        projectsDirty = false;
        try {
          writeProjectsLocalStorageStub();
        } catch {
          /* 騰出 localStorage；失敗不影響 IndexedDB */
        }
        return { backend: "idb", migrated: lsHas };
      } catch (err) {
        console.warn("[projects idb init]", err);
        if (!projectsCache) {
          adoptProjectsCache(fromLs.stub ? emptyProjectsStore() : fromLs.store);
        }
        projectsBackend = "localStorage";
        try {
          if (projectsCache && storePayloadCount(projectsCache)) {
            writeProjectsLocalStorageFull(projectsCache);
          }
        } catch {
          /* 記憶體仍可讀；下次再開 IndexedDB */
        }
        return { backend: "localStorage", error: String(err && err.message) };
      }
    })();
    return projectsInitPromise;
  }

  function loadProjectsStore() {
    if (projectsCache) return projectsCache;
    const fromLs = parseProjectsLocalStorage();
    return adoptProjectsCache(fromLs.store);
  }

  function saveProjectsStore(store) {
    const next = adoptProjectsCache({
      collections: Array.isArray(store?.collections) ? store.collections : [],
      projects: Array.isArray(store?.projects) ? store.projects : [],
    });
    projectsDirty = true;
    if (projectsBackend === "idb") {
      scheduleProjectsFlush();
      return next;
    }
    try {
      writeProjectsLocalStorageFull(next);
      projectsDirty = false;
    } catch (err) {
      const q = quotaError(err);
      if (q) throw q;
      throw err;
    }
    return next;
  }

  function scheduleProjectsFlush() {
    if (projectsFlushTimer || projectsFlushPromise) return;
    projectsFlushTimer = setTimeout(() => {
      projectsFlushTimer = null;
      flushProjects();
    }, PROJECTS_FLUSH_MS);
  }

  async function runProjectsFlush() {
    while (projectsDirty) {
      projectsDirty = false;
      const snapshot = projectsCache || emptyProjectsStore();
      try {
        if (projectsBackend === "idb" && projectsDb) {
          await idbPut(projectsDb, IDB_PROJECTS_KEY, snapshot);
        } else {
          writeProjectsLocalStorageFull(snapshot);
        }
      } catch (err) {
        if (projectsBackend === "idb") {
          try {
            writeProjectsLocalStorageFull(snapshot);
            projectsBackend = "localStorage";
            console.warn("[projects idb] 改回 localStorage", err);
          } catch (err2) {
            projectsDirty = true;
            const q = quotaError(err2);
            throw q || err2;
          }
        } else {
          projectsDirty = true;
          const q = quotaError(err);
          throw q || err;
        }
      }
    }
  }

  function flushProjects() {
    if (projectsFlushTimer) {
      clearTimeout(projectsFlushTimer);
      projectsFlushTimer = null;
    }
    if (projectsFlushPromise) return projectsFlushPromise;
    if (!projectsDirty) return Promise.resolve();
    projectsFlushPromise = runProjectsFlush().finally(() => {
      projectsFlushPromise = null;
      if (projectsDirty) scheduleProjectsFlush();
    });
    return projectsFlushPromise;
  }

  function getProjectsBackend() {
    return projectsBackend;
  }

  function estimateProjectsCacheBytes() {
    if (!projectsCache) return 0;
    try {
      return JSON.stringify(projectsCache).length * 2;
    } catch {
      return 0;
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushProjects();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
      flushProjects();
    });
  }

  function touchCollectionInStore(store, collectionId, patch = {}) {
    if (!collectionId) return;
    const c = store.collections.find((x) => x.id === collectionId);
    if (!c) return;
    c.updatedAt = new Date().toISOString();
    if (patch.lastProjectId !== undefined) c.lastProjectId = String(patch.lastProjectId || "");
  }

  function listCollections() {
    const { collections } = loadProjectsStore();
    return collections
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function getCollection(id) {
    if (!id) return null;
    return loadProjectsStore().collections.find((c) => c.id === id) || null;
  }

  function createCollection(name) {
    const n = String(name || "").trim() || "未命名";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    const collection = {
      id: newId("col_"),
      name: n,
      createdAt: now,
      updatedAt: now,
      lastProjectId: "",
    };
    store.collections.push(collection);
    saveProjectsStore(store);
    return collection;
  }

  function renameCollection(id, name) {
    const store = loadProjectsStore();
    const c = store.collections.find((x) => x.id === id);
    if (!c) return null;
    const n = String(name || "").trim();
    if (!n) return c;
    c.name = n;
    c.updatedAt = new Date().toISOString();
    saveProjectsStore(store);
    return c;
  }

  /**
   * @param {string} id
   * @param {{ deleteChildren?: boolean }} [opts]
   *   deleteChildren true：連分項刪除；false：分項回到未分類
   */
  function deleteCollection(id, opts = {}) {
    const store = loadProjectsStore();
    const exists = store.collections.some((c) => c.id === id);
    if (!exists) return store;
    const deleteChildren = Boolean(opts.deleteChildren);
    if (deleteChildren) {
      const gone = new Set(
        store.projects.filter((p) => p.collectionId === id).map((p) => p.id)
      );
      store.projects = store.projects.filter((p) => p.collectionId !== id);
      if (gone.has(getActiveProjectId())) setActiveProjectId(null);
    } else {
      for (const p of store.projects) {
        if (p.collectionId === id) p.collectionId = UNGROUPED_COLLECTION_ID;
      }
    }
    store.collections = store.collections.filter((c) => c.id !== id);
    saveProjectsStore(store);
    return store;
  }

  function listProjectsByCollection(collectionId) {
    const cid = String(collectionId || UNGROUPED_COLLECTION_ID);
    return listProjects().filter((p) => String(p.collectionId || "") === cid);
  }

  function countUngroupedProjects() {
    return listProjectsByCollection(UNGROUPED_COLLECTION_ID).length;
  }

  function summarizeCollection(collectionId) {
    const cid = String(collectionId || UNGROUPED_COLLECTION_ID);
    const projects = listProjectsByCollection(cid);
    const sentenceCount = projects.reduce((n, p) => n + (p.entries || []).length, 0);
    const col = cid ? getCollection(cid) : null;
    const last = col?.lastProjectId ? getProject(col.lastProjectId) : projects[0] || null;
    return {
      projectCount: projects.length,
      sentenceCount,
      lastProjectId: last?.id || "",
      lastProjectName: last?.name || "",
      updatedAt: col?.updatedAt || projects[0]?.updatedAt || "",
    };
  }

  function rememberCollectionLastProject(collectionId, projectId) {
    if (!collectionId || !projectId) return null;
    const store = loadProjectsStore();
    touchCollectionInStore(store, collectionId, { lastProjectId: projectId });
    saveProjectsStore(store);
    return getCollection(collectionId);
  }

  function moveProject(projectId, collectionId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const nextId = String(collectionId || UNGROUPED_COLLECTION_ID);
    if (nextId && !store.collections.some((c) => c.id === nextId)) return p;
    const prevId = String(p.collectionId || "");
    if (prevId === nextId) return getProject(projectId);
    p.collectionId = nextId;
    p.updatedAt = new Date().toISOString();
    touchCollectionInStore(store, prevId);
    touchCollectionInStore(store, nextId, { lastProjectId: p.id });
    saveProjectsStore(store);
    return getProject(projectId);
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

  function createProject(name, opts = {}) {
    const n = String(name || "").trim() || "未命名專案";
    const store = loadProjectsStore();
    const now = new Date().toISOString();
    let collectionId = String(opts.collectionId || UNGROUPED_COLLECTION_ID);
    if (collectionId && !store.collections.some((c) => c.id === collectionId)) {
      collectionId = UNGROUPED_COLLECTION_ID;
    }
    const project = {
      id: newId("proj_"),
      name: n,
      collectionId,
      createdAt: now,
      updatedAt: now,
      entries: [],
    };
    store.projects.push(project);
    touchCollectionInStore(store, collectionId, { lastProjectId: project.id });
    saveProjectsStore(store);
    return project;
  }

  function deleteProject(id) {
    const store = loadProjectsStore();
    const doomed = store.projects.find((p) => p.id === id);
    store.projects = store.projects.filter((p) => p.id !== id);
    if (doomed?.collectionId) {
      const col = store.collections.find((c) => c.id === doomed.collectionId);
      if (col && col.lastProjectId === id) col.lastProjectId = "";
      touchCollectionInStore(store, doomed.collectionId);
    }
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
    touchCollectionInStore(store, p.collectionId);
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
   * - forceNew：即使同句已存在也新增一筆（批量副歌各自佔號）
   * - 有 id／seq：更新該筆，序號不變
   * - 否則同句（空白正規化後相同）已存在 → 更新快照，序號不變
   * - 新句 → append，序號 = max(seq)+1（永久固定）
   * 回傳寫入的那一筆；不寫入一般歷史。
   */
  function pickExistingProjectEntry(entries, entry) {
    const list = Array.isArray(entries) ? entries : [];
    if (entry?.forceNew) return null;
    if (entry?.id) {
      const byId = list.find((e) => e.id === entry.id);
      if (byId) return byId;
    }
    const seq = Number(entry?.seq);
    if (Number.isFinite(seq) && seq > 0) {
      const bySeq = list.find((e) => Number(e.seq) === seq);
      if (bySeq) return bySeq;
    }
    const norm = normalizeQueryKey(entry?.query);
    if (!norm) return null;
    return list.find((e) => normalizeQueryKey(e.query) === norm) || null;
  }

  function upsertProjectEntry(projectId, entry) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const q = String(entry?.query || "").trim();
    if (!q) return null;
    const now = new Date().toISOString();
    const existing = pickExistingProjectEntry(p.entries, entry);
    let written;
    if (existing) {
      existing.query = q;
      existing.at = now;
      existing.summary = String(entry.summary || "").trim();
      existing.translation = mergeKeptTranslation(
        existing.translation,
        entry.translation,
        entry.replaceTranslation
      );
      existing.ownedCount = Number.isFinite(entry.ownedCount) ? entry.ownedCount : null;
      existing.missingCount = Number.isFinite(entry.missingCount) ? entry.missingCount : null;
      existing.items = slimInventoryItems(entry.items);
      {
        const incomingVocab = slimVocabItems(entry.vocab);
        if (incomingVocab.length || !Array.isArray(existing.vocab) || !existing.vocab.length) {
          existing.vocab = incomingVocab;
        }
      }
      {
        const incomingTok = slimTokens(entry.tokens);
        if (incomingTok.length || !Array.isArray(existing.tokens) || !existing.tokens.length) {
          existing.tokens = incomingTok;
        }
      }
      written = existing;
    } else {
      const maxSeq = (p.entries || []).reduce(
        (m, e) => Math.max(m, Number(e.seq) || 0),
        0
      );
      p.entries = p.entries || [];
      written = {
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
        tokens: slimTokens(entry.tokens),
      };
      p.entries.push(written);
    }
    p.updatedAt = now;
    touchCollectionInStore(store, p.collectionId);
    saveProjectsStore(store);
    return written;
  }

  /**
   * 換句重看時只改計數，不重寫 items／vocab／tokens，避免整包 clone。
   * 數字沒變則不落盤。
   */
  function patchProjectEntryCounts(projectId, entryId, counts = {}) {
    const id = String(entryId || "");
    if (!projectId || !id) return null;
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    const e = (p.entries || []).find((x) => x.id === id);
    if (!e) return null;
    const owned = Number.isFinite(counts.ownedCount) ? counts.ownedCount : e.ownedCount;
    const missing = Number.isFinite(counts.missingCount) ? counts.missingCount : e.missingCount;
    if (e.ownedCount === owned && e.missingCount === missing) return e;
    e.ownedCount = owned;
    e.missingCount = missing;
    saveProjectsStore(store);
    return e;
  }

  function snapshotLooksReusable(entry) {
    if (!entry) return false;
    if (String(entry.mode || entry.source || "") === "failed") return false;
    if (/分析失敗/.test(String(entry.summary || ""))) return false;
    if (Array.isArray(entry.items) && entry.items.length) return true;
    if (Array.isArray(entry.vocab) && entry.vocab.length) return true;
    if (Array.isArray(entry.tokens) && entry.tokens.length) return true;
    if (String(entry.translation || "").trim()) return true;
    const sum = String(entry.summary || "").trim();
    return Boolean(sum) && sum !== "手動模式";
  }

  /** 其他專案／歷史已查過的同句快照，供批量重複句沿用（不重打 API） */
  function findReusableSnapshotByQuery(query, opts = {}) {
    const norm = normalizeQueryKey(query);
    if (!norm) return null;
    const preferId = String(opts.projectId || "");
    const projects = listProjects();
    const ordered = preferId
      ? projects.filter((p) => p.id === preferId).concat(projects.filter((p) => p.id !== preferId))
      : projects;
    for (const p of ordered) {
      const entries = p.entries || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (normalizeQueryKey(e.query) !== norm) continue;
        if (!snapshotLooksReusable(e)) continue;
        return e;
      }
    }
    try {
      const hist = loadHistory();
      for (const h of hist || []) {
        if (normalizeQueryKey(h?.query) === norm && snapshotLooksReusable(h)) return h;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function removeProjectEntry(projectId, entryId) {
    const store = loadProjectsStore();
    const p = store.projects.find((x) => x.id === projectId);
    if (!p) return null;
    p.entries = (p.entries || []).filter((e) => e.id !== entryId);
    p.updatedAt = new Date().toISOString();
    touchCollectionInStore(store, p.collectionId);
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
        version: 2,
        exportedAt: new Date().toISOString(),
        collections: listCollections(),
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
  function importCollectionsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.collections.map((c) => [c.id, c]));
    if (mode === "replace") byId = new Map();
    for (const raw of list) {
      const col = normalizeCollection({
        ...raw,
        id: raw?.id || newId("col_"),
      });
      if (!col) continue;
      byId.set(col.id, col);
    }
    store.collections = Array.from(byId.values());
    saveProjectsStore(store);
    return store.collections;
  }

  function importProjectsList(incoming, mode = "merge") {
    const list = Array.isArray(incoming) ? incoming : [];
    const store = loadProjectsStore();
    let byId = new Map(store.projects.map((p) => [p.id, p]));
    if (mode === "replace") byId = new Map();
    let added = 0;
    let updated = 0;
    const colIds = new Set(store.collections.map((c) => c.id));
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || newId("proj_"));
      const project = normalizeProjectRecord({
        ...raw,
        id,
      });
      if (!project) continue;
      if (project.collectionId && !colIds.has(project.collectionId)) {
        project.collectionId = UNGROUPED_COLLECTION_ID;
      }
      if (byId.has(id)) updated += 1;
      else added += 1;
      byId.set(id, project);
    }
    store.projects = Array.from(byId.values());
    saveProjectsStore(store);
    return { projects: store.projects, added, updated, total: store.projects.length };
  }

  function formatStorageBytes(n) {
    const b = Math.max(0, Number(n) || 0);
    if (b < 1024) return `${Math.round(b)} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * localStorage 每個來源約 5MB（韓語 kgn_* 與日語 jgn_* 同網址會共用）。
   * 專案句子快照在 IndexedDB，不計入此上限。UTF-16（鍵+值×2）估算。
   */
  function measureLocalStorageUsage() {
    const quota = 5 * 1024 * 1024;
    const rows = [];
    let total = 0;
    let app = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || "";
        const bytes = (key.length + val.length) * 2;
        total += bytes;
        const mine = /^(kgn_|jgn_|fgn_)/.test(key);
        if (mine) app += bytes;
        rows.push({ key, bytes, mine });
      }
    } catch {
      /* ignore */
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    const pct = quota ? total / quota : 0;
    let level = "ok";
    if (pct >= 0.95) level = "full";
    else if (pct >= 0.8) level = "warn";
    const idbBytes = estimateProjectsCacheBytes();
    return {
      total,
      app,
      quota,
      pct,
      level,
      rows,
      backend: projectsBackend,
      idbBytes,
      idbLabel: formatStorageBytes(idbBytes),
      totalLabel: formatStorageBytes(total),
      appLabel: formatStorageBytes(app),
      quotaLabel: formatStorageBytes(quota),
    };
  }

  function importProjectsJSON(text) {
    const data = JSON.parse(text);
    let incoming = [];
    if (Array.isArray(data)) {
      incoming = data;
    } else if (data && Array.isArray(data.projects)) {
      if (Array.isArray(data.collections)) importCollectionsList(data.collections, "merge");
      incoming = data.projects;
    } else if (data && data.id && (data.entries || data.name)) {
      incoming = [data];
    } else {
      throw new Error("匯入格式需為專案物件、專案陣列，或 { projects: [...] }");
    }
    return importProjectsList(incoming, "merge");
  }

  /**
   * 雲端資料夾：記住使用者選的 iCloud／Google 雲端硬碟資料夾，讀寫同一份 mal-backup.json。
   * FileSystemHandle 只能放 IndexedDB。
   */
  const CLOUD_IDB_NAME = "kgn_cloud_v1";
  const CLOUD_IDB_VERSION = 1;
  const CLOUD_STORE = "kv";
  const CLOUD_HANDLE_KEY = "dir";
  const CLOUD_META_KEY = "kgn_cloud_meta_v1";
  const CLOUD_BACKUP_FILE = "mal-backup.json";
  const CLOUD_BACKUP_TMP = "mal-backup.json.tmp";
  let cloudDbPromise = null;
  /** undefined＝尚未讀過；null＝沒有連結 */
  let cloudHandleCache;

  function cloudFolderSupported() {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  }

  /** iPad／Safari 沒有資料夾控制代碼，改以分享與選檔讀寫同一份備份。 */
  function cloudFileSyncSupported() {
    return typeof window !== "undefined" && typeof File !== "undefined";
  }

  function markCloudFileStamp(which) {
    const now = new Date().toISOString();
    if (which === "load") saveCloudMeta({ loadedAt: now });
    else saveCloudMeta({ syncedAt: now });
    return now;
  }

  function cloudSyncMode() {
    if (cloudFolderSupported()) return "folder";
    if (cloudFileSyncSupported()) return "file";
    return "none";
  }

  function openCloudDb() {
    if (!idbAvailable()) return Promise.reject(new Error("這個瀏覽器沒有 IndexedDB，不能記住資料夾"));
    if (!cloudDbPromise) {
      cloudDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(CLOUD_IDB_NAME, CLOUD_IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(CLOUD_STORE)) db.createObjectStore(CLOUD_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          cloudDbPromise = null;
          reject(req.error || new Error("無法記住雲端資料夾"));
        };
      });
    }
    return cloudDbPromise;
  }

  function cloudIdbGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, "readonly");
      const req = tx.objectStore(CLOUD_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function cloudIdbPut(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("雲端資料夾寫入中止"));
      tx.onerror = () => reject(tx.error || new Error("雲端資料夾寫入失敗"));
      tx.objectStore(CLOUD_STORE).put(value, key);
    });
  }

  function cloudIdbDelete(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("雲端資料夾刪除中止"));
      tx.onerror = () => reject(tx.error || new Error("雲端資料夾刪除失敗"));
      tx.objectStore(CLOUD_STORE).delete(key);
    });
  }

  function loadCloudMeta() {
    try {
      const raw = localStorage.getItem(CLOUD_META_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveCloudMeta(patch) {
    const next = { ...loadCloudMeta(), ...patch };
    localStorage.setItem(CLOUD_META_KEY, JSON.stringify(next));
    return next;
  }

  function rememberCloudHandle(handle) {
    cloudHandleCache = handle && typeof handle.getFileHandle === "function" ? handle : null;
    return cloudHandleCache;
  }

  async function loadCloudHandle() {
    if (cloudHandleCache !== undefined) return cloudHandleCache;
    const db = await openCloudDb();
    const handle = await cloudIdbGet(db, CLOUD_HANDLE_KEY);
    return rememberCloudHandle(handle);
  }

  async function ensureCloudPermission(handle, mode) {
    const opts = { mode };
    try {
      if (typeof handle.queryPermission === "function") {
        if ((await handle.queryPermission(opts)) === "granted") return true;
      }
      if (typeof handle.requestPermission === "function") {
        return (await handle.requestPermission(opts)) === "granted";
      }
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError" || err.name === "AbortError")) {
        return false;
      }
      throw err;
    }
    return true;
  }

  async function cloudFolderStatus() {
    const meta = loadCloudMeta();
    if (!cloudFolderSupported() && cloudFileSyncSupported()) {
      return {
        supported: true,
        mode: "file",
        linked: false,
        name: "",
        permission: "file",
        syncedAt: meta.syncedAt || "",
        loadedAt: meta.loadedAt || "",
        fileName: CLOUD_BACKUP_FILE,
      };
    }
    const supported = cloudFolderSupported();
    let handle = null;
    let permission = "missing";
    try {
      handle = await loadCloudHandle();
    } catch {
      handle = null;
    }
    if (handle) {
      try {
        if (typeof handle.queryPermission === "function") {
          permission = await handle.queryPermission({ mode: "readwrite" });
        } else {
          permission = "granted";
        }
      } catch {
        permission = "prompt";
      }
    }
    return {
      supported,
      mode: "folder",
      linked: Boolean(handle),
      name: (handle && handle.name) || meta.name || "",
      permission,
      syncedAt: meta.syncedAt || "",
      loadedAt: meta.loadedAt || "",
      fileName: CLOUD_BACKUP_FILE,
    };
  }

  async function ensureCloudFolderPermission(mode = "readwrite") {
    const handle = cloudHandleCache !== undefined ? cloudHandleCache : await loadCloudHandle();
    if (!handle) return false;
    return ensureCloudPermission(handle, mode);
  }

  async function pickCloudFolder() {
    if (!cloudFolderSupported()) {
      throw new Error("此瀏覽器不能記住資料夾。請用 Chrome 或 Edge 開啟 http://127.0.0.1:8080/ 。");
    }
    let handle;
    try {
      try {
        handle = await window.showDirectoryPicker({
          id: "mal-cloud-backup",
          mode: "readwrite",
        });
      } catch (err) {
        if (err && err.name === "TypeError") {
          handle = await window.showDirectoryPicker({ mode: "readwrite" });
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        const cancel = new Error("已取消");
        cancel.name = "AbortError";
        throw cancel;
      }
      throw err;
    }
    const db = await openCloudDb();
    await cloudIdbPut(db, CLOUD_HANDLE_KEY, handle);
    rememberCloudHandle(handle);
    saveCloudMeta({
      name: handle.name || "",
      linkedAt: new Date().toISOString(),
      syncedAt: "",
      loadedAt: "",
    });
    return { name: handle.name || "" };
  }

  async function unlinkCloudFolder() {
    cloudHandleCache = null;
    try {
      const db = await openCloudDb();
      await cloudIdbDelete(db, CLOUD_HANDLE_KEY);
    } catch {
      /* 權限紀錄清不掉時，仍清本機狀態 */
    }
    try {
      localStorage.removeItem(CLOUD_META_KEY);
    } catch {
      /* ignore */
    }
  }

  async function writeTextToDir(dirHandle, name, text) {
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        /* ignore */
      }
      throw err;
    }
    return fileHandle;
  }

  async function writeCloudBackup(json) {
    const handle = await loadCloudHandle();
    if (!handle) throw new Error("尚未連結資料夾");
    const ok = await ensureCloudPermission(handle, "readwrite");
    if (!ok) throw new Error("沒有寫入這個資料夾的權限。請再按一次「連結資料夾」。");
    const text = typeof json === "string" ? json : JSON.stringify(json);
    const tmp = await writeTextToDir(handle, CLOUD_BACKUP_TMP, text);
    if (typeof tmp.move === "function") {
      try {
        await tmp.move(CLOUD_BACKUP_FILE);
      } catch (err) {
        if (!err || err.name !== "InvalidModificationError") throw err;
        try {
          await handle.removeEntry(CLOUD_BACKUP_FILE);
        } catch {
          /* 目標檔可能不存在 */
        }
        await tmp.move(CLOUD_BACKUP_FILE);
      }
    } else {
      await writeTextToDir(handle, CLOUD_BACKUP_FILE, text);
      try {
        await handle.removeEntry(CLOUD_BACKUP_TMP);
      } catch {
        /* ignore */
      }
    }
    const syncedAt = new Date().toISOString();
    saveCloudMeta({ name: handle.name || "", syncedAt });
    return { name: handle.name || "", fileName: CLOUD_BACKUP_FILE, syncedAt };
  }

  async function readCloudBackup() {
    const handle = await loadCloudHandle();
    if (!handle) throw new Error("尚未連結資料夾");
    const ok = await ensureCloudPermission(handle, "read");
    if (!ok) throw new Error("沒有讀取這個資料夾的權限。請再按一次「連結資料夾」。");
    let fileHandle;
    try {
      fileHandle = await handle.getFileHandle(CLOUD_BACKUP_FILE);
    } catch (err) {
      if (err && err.name === "NotFoundError") {
        throw new Error(`「${handle.name || "資料夾"}」裡還沒有 ${CLOUD_BACKUP_FILE}。請先在放著這份筆記本的電腦按「同步到雲端」。`);
      }
      throw err;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    const loadedAt = new Date().toISOString();
    saveCloudMeta({ name: handle.name || "", loadedAt });
    return { text, name: handle.name || "", fileName: CLOUD_BACKUP_FILE, loadedAt };
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
    clearAllNotebookData,
    loadSettings,
    saveSettings,
    clearApiKey,
    hasApiKey,
    API_PROVIDERS,
    getApiProvider,
    inferApiProviderId,
    switchApiProvider,
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
    slimTokens,
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
    ensurePronounVocab,
    findPronounLocs,
    pronounAlts,
    isEnglishVocabSkip,
    filterEnglishVocab,
    stripEnglishFromVocabQuery,
    vocabQueryHasTargetLanguage,
    harvestVocabBankFromSnapshots,
    VOCAB_BANK_MAX,
    HISTORY_MAX,
    normalizeStructureTheme,
    DEFAULT_SETTINGS,
    STRUCTURE_THEMES,
    UNGROUPED_COLLECTION_ID,
    listCollections,
    getCollection,
    createCollection,
    renameCollection,
    deleteCollection,
    listProjectsByCollection,
    countUngroupedProjects,
    summarizeCollection,
    rememberCollectionLastProject,
    moveProject,
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
    patchProjectEntryCounts,
    removeProjectEntry,
    findProjectEntryByQuery,
    findReusableSnapshotByQuery,
    findProjectEntryBySeq,
    exportProjectsJSON,
    importProjectsJSON,
    initProjectsDb,
    flushProjects,
    getProjectsBackend,
    measureLocalStorageUsage,
    formatStorageBytes,
    normalizeQueryKey,
    CLOUD_BACKUP_FILE,
    cloudFolderSupported,
    cloudSyncMode,
    markCloudFileStamp,
    cloudFolderStatus,
    ensureCloudFolderPermission,
    pickCloudFolder,
    unlinkCloudFolder,
    writeCloudBackup,
    readCloudBackup,
  };
})();
