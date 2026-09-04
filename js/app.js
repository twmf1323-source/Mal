/**
 * Mal · 韓語文法筆記本 — 主應用
 * API 盤點整句 → 先掛本地卡 → 未收錄才生成說明 · 雙語規則名
 */
const App = (() => {
  const state = {
    view: "lookup",
    editingId: null,
    /** 從待辦「建立規則」帶入時，儲存成功後清除該待辦 */
    todoSourceId: null,
    lastQuery: "",
    lastInventory: null,
    aiBusy: false,
    lookupBusy: false,
    /** 進行中查詢的世代 token（新查詢遞增，舊回傳不覆寫 UI） */
    lookupToken: 0,
    /** 背景 API 查詢中的句子（可切到歷史句而不中斷） */
    pendingLookupQuery: null,
    /** 還原「查詢中」畫面用 */
    pendingLookupLoadingHtml: null,
    /**
     * AI 自動填寫背景工作（可離開表單瀏覽歷史／筆記本）
     * @type {null | { id: string, title: string, editingId: string|null, todoSourceId: string|null, status: 'running'|'done'|'error' }}
     */
    aiJob: null,
    /** 句中共置規則顏色輪播的 interval id */
    gramHlCycleTimers: [],
    /** 專案模式目前游標序號（瀏覽用；與永久 seq 對應） */
    projectCursorSeq: null,
    /**
     * 選字套用規則的暫存
     * @type {null | { text: string, start: number, end: number }}
     */
    selApply: null,
    /** 點擊選字編輯（與 hover／複製浮層分開） */
    sentenceSelectEdit: false,
    /** 規則挑選模式：null=選字套用 · supplementary=圖例「+補充」 */
    rulePickMode: null,
    /** 建立補充用法後自動加入本句 */
    pendingSupplementaryApply: false,
    /** 單字解釋編輯中的區間 */
    vocabEditRange: null,
    /**
     * 選字「建立新規則」：儲存後自動套回此片段
     * @type {null | { text: string, start: number, end: number }}
     */
    pendingSelApply: null,
    /**
     * 從「尚未收錄」建立規則：儲存後綁回該盤點項（不靠嚴格標題對卡）
     * @type {null | { invIdx: number, name: string, span: string, start?: number, end?: number, tokenFrom?: number, tokenTo?: number, kiwiKind?: string, category?: string }}
     */
    pendingCreateFromInventory: null,
    /** 空專案整首匯入 */
    bulkImport: null,
    /** 專案 modal：null=大項列表 · ""=未分類 · id=該大項 */
    projectsBrowseId: null,
    /**
     * 進入表單前的頁面（AI 填寫／取消時跳回）
     * @type {null | string}
     */
    formReturnView: null,
    /**
     * 手動為「句中未定位」規則指定片段
     * @type {null | { ruleId: string, ruleTitle: string }}
     */
    locateTarget: null,
    /** 規則挑選清單世代，避免形態素分析回傳覆寫較新結果 */
    rulePickGen: 0,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg, type = "info") {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show toast-${type}`;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function updateRuleCount() {
    const el = $("#app-rule-count");
    if (el) el.textContent = String(RulesService.getAll().length);
  }

  function updateApiStatusDot() {
    const dot = $("#api-status-dot");
    if (!dot) return;
    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    const ready = Storage.hasApiKey();
    // 手動模式（全關）仍可用；僅「開了 API 卻沒 Key」為未就緒
    dot.classList.toggle("ready", anyMode ? ready : true);
    if (!anyMode) {
      dot.title = "手動模式（未開掃描 · 仍可查詢）";
    } else {
      const label = Storage.formatLookupModesLabel(modes);
      dot.title = ready ? `${label} · Key 已設定` : `${label} · 尚未設定 Key`;
    }
  }

  /** 查詢頁說明與設定開關文案 */
  function updateLookupModeUI() {
    const modes = Storage.loadLookupModes();
    const desc = $("#lookup-mode-desc");
    if (desc) {
      const bits = [];
      if (modes.apiGrammar) bits.push("<strong>API 文法</strong>");
      if (modes.apiVocab) bits.push("<strong>API 單字</strong>");
      if (!bits.length) {
        const empty =
          "目前：手動模式 · 可直接查詢並選字套用（右側可再開 API 文法／單字）";
        desc.innerHTML = empty;
        desc.title = empty;
      } else {
        const keyReqOn = modes.apiGrammar || modes.apiVocab;
        const line =
          `目前：${bits.join(" · ")}` +
          (keyReqOn ? " · 需 API Key" : "") +
          " · 可選字套用／本句移除";
        desc.innerHTML = line;
        desc.title = line.replace(/<\/?strong>/g, "");
      }
    }
    const apiG = $("#settings-mode-api-grammar");
    const apiV = $("#settings-mode-api-vocab");
    if (apiG) apiG.checked = Boolean(modes.apiGrammar);
    if (apiV) apiV.checked = Boolean(modes.apiVocab);
    updateKiwiStatusUI();
    const keyReq = $("#settings-api-key-req");
    if (keyReq) keyReq.hidden = !(modes.apiGrammar || modes.apiVocab);
    syncSettingsModesAllBtn(modes);
    updateApiStatusDot();
    updateBulkImportHint();
  }

  function updateKiwiStatusUI() {
    const box = $("#settings-kiwi-enabled");
    if (box) {
      box.checked =
        typeof KiwiService !== "undefined" ? KiwiService.isEnabled() : Storage.loadSettings().kiwiEnabled !== false;
    }
    const el = $("#settings-kiwi-status");
    if (!el) return;
    const enabled = typeof KiwiService !== "undefined" ? KiwiService.isEnabled() : false;
    if (!enabled) {
      el.hidden = true;
      el.textContent = "";
      el.className = "kiwi-status";
      return;
    }
    const st = KiwiService.getStatus();
    el.className = `kiwi-status ${st.status}`;
    if (st.status === "loading") {
      el.hidden = false;
      el.textContent =
        location.protocol === "file:" ? "從網站載入模型中…" : "背景載入模型中…";
    } else if (st.status === "error") {
      el.hidden = false;
      el.textContent = `載入失敗：${st.error || "未知錯誤"}`;
    } else if (st.status === "ready") {
      el.hidden = false;
      el.textContent = "已在背景就緒";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function onKiwiToggle() {
    const on = Boolean($("#settings-kiwi-enabled")?.checked);
    Storage.saveSettings({ kiwiEnabled: on });
    updateKiwiStatusUI();
    if (on && typeof KiwiService !== "undefined") {
      showToast("已開啟形態素分析（背景載入）", "info");
      KiwiService.warmup().then(async () => {
        updateKiwiStatusUI();
        if (state.lastQuery && state.lastInventory) {
          await applyKiwiToInventory(state.lastQuery, state.lastInventory);
          if (typeof refreshLookupFromInventory === "function") refreshLookupFromInventory();
        }
      });
    } else {
      showToast("已關閉形態素分析", "info");
    }
  }

  async function applyKiwiToInventory(query, inventory, opts = {}) {
    if (typeof KiwiService === "undefined" || !KiwiService.isEnabled()) return inventory;
    const modes = Storage.loadLookupModes();
    const includeGrammar =
      opts.includeGrammar != null
        ? Boolean(opts.includeGrammar)
        : Boolean(modes.apiGrammar);
    const apply = async () => {
      try {
        const next = await KiwiService.enrichInventory(query, inventory, { includeGrammar });
        if (state.lastQuery === query && !state.bulkImport?.running) {
          const cur = state.lastInventory;
          if (cur && cur !== next) {
            if (!Array.isArray(next.vocab) || !next.vocab.length) {
              next.vocab = Array.isArray(cur.vocab) ? cur.vocab : [];
            }
            if (!next.translation && cur.translation) next.translation = cur.translation;
          }
          state.lastInventory = next;
          if (typeof refreshLookupFromInventory === "function") refreshLookupFromInventory();
        }
        return next;
      } catch (err) {
        console.warn("[kiwi] enrich failed", err);
        return inventory;
      }
    };
    if (KiwiService.getStatus().status !== "ready") {
      KiwiService.warmup().then(apply);
      return inventory;
    }
    try {
      return await KiwiService.enrichInventory(query, inventory, { includeGrammar });
    } catch (err) {
      console.warn("[kiwi] enrich failed", err);
      return inventory;
    }
  }

  /** 全部開啟：API 文法 + API 單字 */
  function areAllLookupModesOn(modes) {
    const m = modes || Storage.loadLookupModes();
    return Boolean(m.apiGrammar && m.apiVocab);
  }

  function syncSettingsModesAllBtn(modes) {
    const btn = $("#btn-settings-modes-all");
    if (!btn) return;
    const allOn = areAllLookupModesOn(modes);
    btn.textContent = allOn ? "全部關閉" : "全部開啟";
    btn.setAttribute("aria-pressed", allOn ? "true" : "false");
    btn.classList.toggle("is-all-on", allOn);
  }

  function onSettingsModesAllClick() {
    const modes = Storage.loadLookupModes();
    const allOn = areAllLookupModesOn(modes);
    let next;
    if (allOn) {
      next = Storage.saveLookupModes({
        apiGrammar: false,
        localGrammar: false,
        apiVocab: false,
      });
      setSettingsStatus("已全部關閉查詢模式", "warn");
      showToast("查詢模式：全部關閉", "info");
    } else {
      next = Storage.saveLookupModes({
        apiGrammar: true,
        localGrammar: false,
        apiVocab: true,
      });
      if (!Storage.hasApiKey()) {
        setSettingsStatus("已全部開啟 API 模式 — 請填入 API Key", "warn");
      } else {
        setSettingsStatus(`模式：${Storage.formatLookupModesLabel(next)}`, "ok");
      }
      showToast("查詢模式：全部開啟（API 文法 · API 單字）", "success");
    }
    updateLookupModeUI();
  }

  function setView(view) {
    state.view = view;
    $$(".nav-btn").forEach((btn) => {
      if (view === "form") {
        btn.classList.remove("active");
        return;
      }
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    $$(".view").forEach((v) => {
      v.classList.toggle("hidden", v.id !== `view-${view}`);
    });
    if (view === "rules") renderRulesList();
    if (view === "vocab") renderVocabBankList();
    if (view === "todos") renderTodos();
    if (view === "history") renderHistory();
    if (view === "settings") fillSettingsForm();
    if (view === "lookup") {
      updateLookupModeUI();
      syncProjectBulkImport();
    }
    updateRuleCount();
    updateApiStatusDot();
  }

  /** 離開表單時應回到的頁面（預設查詢；避免硬跳規則本） */
  function getFormReturnView() {
    const v = state.formReturnView;
    if (v && v !== "form" && document.getElementById(`view-${v}`)) return v;
    if (state.lastQuery) return "lookup";
    return "rules";
  }

  function formatHistoryTime(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  async function requestApiVocab(form) {
    const qVocab =
      typeof Storage.stripEnglishFromVocabQuery === "function"
        ? Storage.stripEnglishFromVocabQuery(form)
        : String(form || "").trim();
    const hasTarget =
      typeof Storage.vocabQueryHasTargetLanguage === "function"
        ? Storage.vocabQueryHasTargetLanguage(qVocab)
        : Boolean(qVocab);
    if (!hasTarget) {
      return { summary: "", translation: "", items: [], vocab: [] };
    }
    if (typeof AiService.inventoryVocabOnly === "function") {
      return await AiService.inventoryVocabOnly(qVocab);
    }
    return await AiService.inventoryGrammar(qVocab);
  }

  function mergeVocabPreferGloss(base, extra) {
    const out = Array.isArray(base) ? base.slice() : [];
    for (const w of extra || []) {
      if (!w) continue;
      const idx = out.findIndex((x) => {
        if (
          Number.isFinite(Number(x.start)) &&
          Number.isFinite(Number(w.start)) &&
          Math.abs(Number(x.start) - Number(w.start)) <= 1
        ) {
          return x.surface === w.surface || (x.lemma && x.lemma === w.lemma);
        }
        return x.surface === w.surface || (x.lemma && w.lemma && x.lemma === w.lemma);
      });
      if (idx >= 0) {
        out[idx] = {
          ...out[idx],
          ...w,
          gloss: w.gloss || out[idx].gloss,
          lemma: w.lemma || out[idx].lemma,
          pos: w.pos || out[idx].pos,
          start: Number.isFinite(Number(out[idx].start)) ? out[idx].start : w.start,
          end: Number.isFinite(Number(out[idx].end)) ? out[idx].end : w.end,
        };
      } else {
        out.push(w);
      }
    }
    return out;
  }

  async function fetchApiGrammarInventory(form, skipVocab) {
    let inventory;
    const kiwiOn = typeof KiwiService !== "undefined" && KiwiService.isEnabled();
    if (kiwiOn && typeof AiService.inventoryByKoParse === "function") {
      try {
        inventory = await AiService.inventoryByKoParse(form, { skipVocab: Boolean(skipVocab) });
      } catch (err) {
        console.warn("[inventoryByKoParse]", err);
        inventory = await AiService.inventoryGrammar(form);
        inventory.fallbackLegacy = true;
      }
    } else {
      inventory = await AiService.inventoryGrammar(form);
      inventory.fallbackLegacy = true;
    }
    if (skipVocab) inventory.vocab = [];
    if (typeof RulesService.attachLocalRulesToInventory === "function") {
      inventory = RulesService.attachLocalRulesToInventory(form, inventory);
    }
    return inventory;
  }

  /** 先掛本地卡，再為真正沒卡的項目生成說明（不寫入筆記本） */
  async function finalizeApiGrammarInventory(query, inventory) {
    let inv = inventory && typeof inventory === "object" ? inventory : { items: [] };
    if (typeof RulesService.attachLocalRulesToInventory === "function") {
      inv = RulesService.attachLocalRulesToInventory(query, inv);
    }
    if (typeof AiService !== "undefined" && typeof AiService.fillMissingRuleDrafts === "function") {
      try {
        inv = await AiService.fillMissingRuleDrafts(inv);
      } catch (err) {
        console.warn("[fillMissingRuleDrafts]", err);
      }
    }
    return inv;
  }

  /** 以全域單字庫補本句 vocab */
  function prepareInventoryVocab(inventory, query) {
    if (!inventory) return inventory;
    const q = String(query || state.lastQuery || "");
    if (typeof Storage.mergeVocabWithBank === "function") {
      inventory.vocab = Storage.mergeVocabWithBank(
        Array.isArray(inventory.vocab) ? inventory.vocab : [],
        q
      );
    } else if (!Array.isArray(inventory.vocab)) {
      inventory.vocab = [];
    }
    if (typeof Storage.filterEnglishVocab === "function") {
      inventory.vocab = Storage.filterEnglishVocab(inventory.vocab);
    }
    if (typeof Storage.ensurePronounVocab === "function") {
      inventory.vocab = Storage.ensurePronounVocab(q, inventory.vocab);
    }
    return inventory;
  }

  /* attach + generate live in finalizeApiGrammarInventory */

  function rememberInventoryVocab(inventory, opts = {}) {
    if (
      typeof Storage.upsertVocabBankEntries === "function" &&
      inventory &&
      Array.isArray(inventory.vocab) &&
      inventory.vocab.length
    ) {
      Storage.upsertVocabBankEntries(inventory.vocab, opts);
    }
  }

  /**
   * 用既有盤點結果（或歷史快照）渲染查詢頁，並依「目前」筆記本重分類已收錄／未收錄
   */
  function lookupStoredTranslation(query) {
    const q = String(query || "").trim();
    if (!q) return "";
    const key = normalizeLookupKey(q);
    const pid = typeof Storage.getActiveProjectId === "function" ? Storage.getActiveProjectId() : "";
    if (pid && typeof Storage.findProjectEntryByQuery === "function") {
      const t = String(Storage.findProjectEntryByQuery(pid, q)?.translation || "").trim();
      if (t) return t;
    }
    const hist = typeof Storage.loadHistory === "function" ? Storage.loadHistory() : [];
    const h = hist.find((x) => normalizeLookupKey(x?.query) === key);
    return String(h?.translation || "").trim();
  }

  function keepExistingTranslation(query, inventory, opts = {}) {
    if (!inventory || opts.replaceTranslation) return inventory;
    const stored = lookupStoredTranslation(query);
    if (stored) inventory.translation = stored;
    return inventory;
  }

  function applyInventoryToLookup(query, inventory, opts = {}) {
    const q = String(query || "").trim();
    const box = $("#lookup-result");
    if (!box || !q) return null;

    keepExistingTranslation(q, inventory, opts);
    prepareInventoryVocab(inventory, q);
    const origVocab = Array.isArray(inventory?.vocab) ? inventory.vocab : [];
    // 再正規化（補整句 translation 等；保留手動校正欄位）
    const normalized =
      typeof AiService !== "undefined" && AiService.normalizeInventory
        ? AiService.normalizeInventory(inventory || {})
        : {
            summary: inventory?.summary || "",
            translation: inventory?.translation || "",
            items: Array.isArray(inventory?.items) ? inventory.items : [],
            vocab: origVocab,
          };
    const normVocab = Array.isArray(normalized.vocab) ? normalized.vocab : [];
    let inv = {
      summary: normalized.summary || inventory?.summary || "",
      translation: normalized.translation || inventory?.translation || "",
      items: Array.isArray(normalized.items)
        ? normalized.items
        : Array.isArray(inventory?.items)
          ? inventory.items
          : [],
      vocab: normVocab.length ? normVocab : origVocab,
      tokens: Array.isArray(inventory?.tokens)
        ? inventory.tokens
        : Array.isArray(normalized.tokens)
          ? normalized.tokens
          : [],
      mode: inventory?.mode || "",
      source: inventory?.source || "",
      mappingFailed: Boolean(inventory?.mappingFailed || normalized.mappingFailed),
      fallbackLegacy: Boolean(inventory?.fallbackLegacy || normalized.fallbackLegacy),
      apiRejectedCount: Number(inventory?.apiRejectedCount || normalized.apiRejectedCount) || 0,
      unresolvedGrammarCount:
        Number(inventory?.unresolvedGrammarCount || normalized.unresolvedGrammarCount) || 0,
      apiRepairUsed: Boolean(inventory?.apiRepairUsed || normalized.apiRepairUsed),
      grammarEnabled:
        inventory?.grammarEnabled != null
          ? Boolean(inventory.grammarEnabled)
          : Boolean(Storage.loadLookupModes().apiGrammar),
    };
    // normalize 可能洗掉 bank merge，再補一次
    prepareInventoryVocab(inv, q);
    // API 常漏報「句中有 줘 卻沒列請托」→ 依表面補項（綁本地卡）
    if (
      inv.grammarEnabled &&
      typeof RulesService.enrichInventoryWithSurfaceHints === "function"
    ) {
      inv = RulesService.enrichInventoryWithSurfaceHints(q, inv);
    }
    if (typeof RulesService.attachLocalRulesToInventory === "function") {
      inv = RulesService.attachLocalRulesToInventory(q, inv);
    }

    state.lastQuery = q;
    state.lastInventory = inv;

    const input = $("#lookup-input");
    if (input) input.value = q;

    const apiHl = buildApiHighlight(q, inv);
    // 外層 lookup-result-stack 要夠高，句中 sticky 才不會「捲過就消失」
    box.innerHTML =
      `<div class="lookup-result-stack">` +
      sentenceBoardHtml(q, apiHl.spans, apiHl.colorByRule, apiHl.ownedHits, {
        source: "api",
        apiLegend: apiHl.legend,
        vocab: inv.vocab,
        tokens: inv.tokens,
        mappingFailed: inv.mappingFailed,
        fallbackLegacy: inv.fallbackLegacy,
        audit: apiHl.audit,
        inventory: inv,
      }) +
      morphBoardHtml(q, inv) +
      `<div class="lookup-result-body">` +
      localMatchesHtml(apiHl.ownedHits || [], inv) +
      missingInventoryHtml(inv, apiHl.missingItems) +
      `</div></div>`;

    bindLookupResultEvents(q, inv);
    startGramHlCycles(box);
    bindWordTipHovers(box);
    // 重新渲染後恢復「定位中」提示列
    updateLocateModeBar();
    syncAppHeaderHeight();
    return apiHl;
  }

  /** 從歷史：依現在規則重看（不呼叫 API） */
  function reviewHistoryWithCurrentRules(entry) {
    if (!entry?.query) return;
    // 允許 items 為空：仍還原句子與結果區
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    const tokens = Array.isArray(entry.tokens) ? entry.tokens : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    // A1：apply 內已算一次 highlight，直接重用
    const apiHl =
      applyInventoryToLookup(
        entry.query,
        {
          summary: entry.summary || "",
          translation: entry.translation || "",
          items,
          vocab,
          tokens,
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
        translation: entry.translation,
        vocab,
        tokens,
      });
    Storage.addHistoryEntry({
      query: entry.query,
      summary: entry.summary || "",
      translation: entry.translation || "",
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      items,
      vocab,
      tokens,
    });
    updateLookupNavBtns();
    updateBackgroundLookupBanner();
    if (items.length) {
      showToast(
        `已依目前筆記本重看：已收錄 ${(apiHl.ownedHits || []).length} · 尚未 ${(apiHl.missingItems || []).length}`,
        "success"
      );
    } else {
      showToast("已還原句子（當時無文法標記，可選字套用）", "info");
    }
  }

  /** 從專案句子：依現在規則重看（不呼叫 API、不寫一般歷史） */
  function reviewProjectEntry(entry, opts = {}) {
    if (!entry?.query) return;
    if (entry.seq != null) state.projectCursorSeq = entry.seq;
    const items = Array.isArray(entry.items) ? entry.items : [];
    const vocab = Array.isArray(entry.vocab) ? entry.vocab : [];
    const tokens = Array.isArray(entry.tokens) ? entry.tokens : [];
    setView("lookup");
    if ($("#lookup-input")) $("#lookup-input").value = entry.query;
    const apiHl =
      applyInventoryToLookup(
        entry.query,
        {
          summary: entry.summary || "",
          translation: entry.translation || "",
          items,
          vocab,
          tokens,
        },
        { fromHistory: true }
      ) ||
      buildApiHighlight(entry.query, {
        items,
        summary: entry.summary,
        translation: entry.translation,
        vocab,
        tokens,
      });
    // 僅更新專案內快照計數，序號不變、不寫一般歷史
    const pid = Storage.getActiveProjectId();
    if (pid) {
      Storage.upsertProjectEntry(pid, {
        id: entry.id,
        seq: entry.seq,
        query: entry.query,
        summary: entry.summary || "",
        translation: entry.translation || "",
        ownedCount: (apiHl.ownedHits || []).length,
        missingCount: (apiHl.missingItems || []).length,
        items,
        vocab,
        tokens,
      });
    }
    updateProjectModeUI();
    updateBackgroundLookupBanner();
    if (!opts.silent) {
      if (items.length) {
        showToast(
          `第 ${entry.seq} 句 · 已收錄 ${(apiHl.ownedHits || []).length} · 尚未 ${(apiHl.missingItems || []).length}`,
          "success"
        );
      } else {
        showToast(`第 ${entry.seq} 句 · 已還原（當時無文法標記）`, "info");
      }
    }
  }

  function renderHistory() {
    const box = $("#history-list");
    const countEl = $("#history-count");
    if (!box) return;
    const all = Storage.loadHistory();
    const filterQ = String($("#history-filter")?.value || "")
      .trim()
      .toLowerCase();
    const list = !filterQ
      ? all
      : all.filter((h) => {
          const blob = [h.query, h.summary, h.translation].join("\n").toLowerCase();
          return blob.includes(filterQ);
        });

    if (countEl) {
      if (!all.length) {
        countEl.textContent = "尚無歷史。在「查詢」送出句子後會自動記錄。";
      } else if (filterQ) {
        countEl.textContent = `搜尋「${filterQ}」· ${list.length} / ${all.length} 筆 · 列表為儲存時數字 ·「再看一次」才依目前筆記本重分`;
      } else {
        countEl.textContent = `共 ${all.length} 筆（最多 ${Storage.HISTORY_MAX || 40} 筆）· 列表顯示儲存時的已收錄／尚未 ·「再看一次」才重分`;
      }
    }
    if (!all.length) {
      box.innerHTML = `<div class="empty-state"><p>還沒有查詢紀錄。<br/>到「查詢」輸入句子並完成盤點後會出現在這裡。</p></div>`;
      return;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>沒有符合「${esc(filterQ)}」的歷史。<br/>試試其他關鍵字。</p></div>`;
      return;
    }
    // A3：列表用儲存時 owned/missing，不對每筆即時 buildApiHighlight
    box.innerHTML = `
      <ul class="history-list">
        ${list
          .map((h) => {
            const meta = [];
            if (h.ownedCount != null) meta.push(`已收錄 ${h.ownedCount}`);
            if (h.missingCount != null) meta.push(`未收錄 ${h.missingCount}`);
            const ruleN = Array.isArray(h.items) ? h.items.length : 0;
            const preview = esc(h.query);
            return `
          <li class="history-item" data-id="${esc(h.id)}">
            <div class="history-main">
              <p class="history-query">${preview}</p>
              <p class="history-meta muted">
                ${esc(formatHistoryTime(h.at))}
                ${meta.length ? ` · ${esc(meta.join(" · "))}` : ""}
                ${meta.length ? ` · <span class="history-snap-hint">儲存時</span>` : ""}
                ${
                  ruleN
                    ? ` · <span class="muted">文法 ${ruleN}</span>`
                    : ' · <span class="muted">無文法標記</span>'
                }
                ${h.summary ? `<br/>${esc(h.summary)}` : ""}
              </p>
            </div>
            <div class="history-actions">
              <button type="button" class="btn btn-sm btn-primary" data-hist-review title="${
                ruleN
                  ? "用當時盤點快照，依目前筆記本重分已收錄／未收錄"
                  : "還原句子與結果區（當時無文法標記，可再選字套用）"
              }">再看一次</button>
              <button type="button" class="btn btn-sm btn-ghost" data-hist-remove>刪除</button>
            </div>
          </li>`;
          })
          .join("")}
      </ul>`;

    box.querySelectorAll(".history-item").forEach((li) => {
      const id = li.dataset.id;
      const entry = list.find((x) => x.id === id);
      if (!entry) return;
      li.querySelector("[data-hist-review]")?.addEventListener("click", () => {
        reviewHistoryWithCurrentRules(entry);
      });
      li.querySelector("[data-hist-remove]")?.addEventListener("click", () => {
        Storage.removeHistoryEntry(id);
        renderHistory();
        updateLookupNavBtns();
        showToast("已刪除該筆歷史", "info");
      });
    });
  }

  function clearAllHistory() {
    if (!Storage.loadHistory().length) {
      showToast("歷史是空的", "info");
      return;
    }
    if (!confirm("確定清空全部查詢歷史？（不影響規則與待辦）")) return;
    Storage.clearHistory();
    renderHistory();
    updateLookupNavBtns();
    showToast("已清空歷史", "success");
  }

  /* —— 專案模式 —— */

  function isProjectMode() {
    return Boolean(Storage.getActiveProjectId());
  }

  function updateProjectModeUI() {
    const bar = $("#project-mode-bar");
    const navBtn = $("#nav-projects");
    const project = Storage.getActiveProject();
    const inProject = Boolean(project);

    if (bar) bar.classList.toggle("hidden", !inProject);
    if (navBtn) {
      navBtn.classList.toggle("project-active", inProject);
      navBtn.title = inProject
        ? `回到分項「${project.name || "未命名"}」（離開請用查詢頁「離開專案」）`
        : "大項／分項：小說各章、歌詞各首";
    }

    if (inProject) {
      const nameEl = $("#project-mode-name");
      const posEl = $("#project-mode-pos");
      const colBtn = $("#project-mode-collection");
      const sepEl = $("#project-mode-path-sep");
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      if (colBtn && sepEl) {
        if (col) {
          colBtn.textContent = col.name || "未命名";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        } else if (project.collectionId) {
          colBtn.classList.add("hidden");
          sepEl.classList.add("hidden");
        } else {
          colBtn.textContent = "未分類";
          colBtn.classList.remove("hidden");
          sepEl.classList.remove("hidden");
        }
      }
      if (nameEl && document.activeElement !== nameEl) {
        nameEl.textContent = project.name || "未命名專案";
      }
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;
      let curSeq = state.projectCursorSeq;
      const curQ = String($("#lookup-input")?.value || "").trim();
      if (curQ) {
        curSeq = resolveDisplayedProjectSeq(project.id, curQ, curSeq);
      }
      if (posEl) {
        if (total === 0) {
          posEl.textContent = "尚無句子 · 可一次放入歌詞，或查詢後編為第 1 號";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          const idx = entries.findIndex((e) => e.seq === curSeq) + 1;
          posEl.textContent = `第 ${curSeq} 號 · ${idx}/${total} 句`;
        } else {
          posEl.textContent = `共 ${total} 句 · 查新句會接續編號`;
        }
      }
    }

    updateLookupNavBtns();
    syncProjectBulkImport();
  }

  function commitProjectRename() {
    const el = $("#project-mode-name");
    const project = Storage.getActiveProject();
    if (!el || !project) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = project.name || "未命名專案";
      showToast("專案名稱不能空白", "error");
      return;
    }
    if (next === String(project.name || "").trim()) {
      el.textContent = project.name || next;
      return;
    }
    const updated = Storage.renameProject(project.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindProjectNameEdit() {
    const el = $("#project-mode-name");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitProjectRename());
  }

  function isEmptyActiveProject() {
    const p = Storage.getActiveProject();
    if (!p) return false;
    return Storage.getProjectEntriesSorted(p).length === 0;
  }

  const SENTENCE_END_MARK = /[。．｡！？!?…⋯‼⁇⁈⁉]/;
  const SENTENCE_END_CLOSER = /[」』）\)］】》〉»"”’]/;
  const LETTER_BEFORE_DOT = /[\u3040-\u30FF\u4E00-\u9FFFー」』）)］】》〉A-Za-zÀ-ÖØ-öø-ÿ\uAC00-\uD7A3]/;

  function isSentenceEndChar(ch, prev, next) {
    if (SENTENCE_END_MARK.test(ch)) return true;
    if (ch === "." && prev && LETTER_BEFORE_DOT.test(prev) && !/\d/.test(next || "")) {
      return true;
    }
    return false;
  }

  function isCommaBreakChar(ch, prev, next) {
    if (ch === "、" || ch === "，" || ch === "､") return true;
    if (ch === "," && !(/\d/.test(prev || "") && /\d/.test(next || ""))) return true;
    return false;
  }

  /** 依指定標點切開一行；標點與緊接的閉括號留在上一句。無該標點則原樣。 */
  function splitLineByBreakPred(line, isBreak) {
    const s = String(line || "");
    if (!s.trim()) return [];
    const parts = [];
    let start = 0;
    let i = 0;
    while (i < s.length) {
      const prev = i > 0 ? s[i - 1] : "";
      const next = i + 1 < s.length ? s[i + 1] : "";
      if (!isBreak(s[i], prev, next)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < s.length) {
        const p = j > 0 ? s[j - 1] : "";
        const n = j + 1 < s.length ? s[j + 1] : "";
        if (!isBreak(s[j], p, n)) break;
        j += 1;
      }
      while (j < s.length && SENTENCE_END_CLOSER.test(s[j])) j += 1;
      const piece = s.slice(start, j).trim();
      if (piece) parts.push(piece);
      while (j < s.length && /[\s\u3000]/.test(s[j])) j += 1;
      start = j;
      i = j;
    }
    const tail = s.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length > 1 ? parts : [s];
  }

  function breakBulkTextByPred(text, isBreak) {
    return String(text || "")
      .split(/\r?\n/)
      .flatMap((line) => (line.trim() ? splitLineByBreakPred(line, isBreak) : [""]))
      .join("\n");
  }

  function applyBulkTextTransform(transform, noChangeToast, successLabel) {
    if (state.bulkImport?.running) return;
    const ta = $("#project-bulk-input");
    if (!ta) return;
    const before = ta.value;
    if (!before.trim()) {
      showToast("請先貼上歌詞或文本", "error");
      ta.focus();
      return;
    }
    const after = transform(before);
    const same =
      after.replace(/\r\n/g, "\n") === String(before).replace(/\r\n/g, "\n");
    if (same) {
      showToast(noChangeToast, "info");
      return;
    }
    ta.value = after;
    updateBulkImportHint();
    const info = splitBulkLines(after);
    showToast(`已${successLabel}分成 ${info.lines.length} 行，可再改後再分析`, "success");
    ta.focus();
  }

  function applyBulkSentenceBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isSentenceEndChar),
      "沒有可依句號拆開的句子",
      "依句號"
    );
  }

  function applyBulkCommaBreaks() {
    applyBulkTextTransform(
      (text) => breakBulkTextByPred(text, isCommaBreakChar),
      "沒有可依逗號拆開的句子",
      "依逗號"
    );
  }

  function splitBulkLines(text) {
    const rawLines = String(text || "").split(/\r?\n/);
    const nonempty = rawLines.map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    const lines = [];
    let dupCount = 0;
    for (const line of nonempty) {
      const key = Storage.normalizeQueryKey(line);
      if (!key) continue;
      if (seen.has(key)) dupCount += 1;
      else seen.add(key);
      lines.push(line);
    }
    return {
      lines,
      rawCount: rawLines.length,
      nonemptyCount: nonempty.length,
      skippedEmpty: rawLines.length - nonempty.length,
      dupCount,
    };
  }

  function formatBulkStat(info) {
    if (!info || !info.nonemptyCount) return "尚未貼上內容";
    const bits = [`將匯入 ${info.lines.length} 句`];
    if (info.skippedEmpty) bits.push(`略過空行 ${info.skippedEmpty}`);
    if (info.dupCount) bits.push(`重複保留 ${info.dupCount}（API 只查一次）`);
    return bits.join(" · ");
  }

  function updateBulkImportHint() {
    const modeEl = $("#project-bulk-mode");
    if (modeEl && typeof Storage.formatLookupModesLabel === "function") {
      modeEl.textContent = Storage.formatLookupModesLabel(Storage.loadLookupModes());
    }
    const stat = $("#project-bulk-stat");
    const ta = $("#project-bulk-input");
    if (stat && ta && !state.bulkImport?.running) {
      stat.textContent = formatBulkStat(splitBulkLines(ta.value));
    }
  }

  function isViewingBulkProject() {
    const job = state.bulkImport;
    return Boolean(job?.running && job.projectId && Storage.getActiveProjectId() === job.projectId);
  }

  function syncProjectBulkImport() {
    const panel = $("#project-bulk-import");
    if (!panel) return;
    const running = Boolean(state.bulkImport?.running);
    const viewingJob = isViewingBulkProject();
    const empty = isEmptyActiveProject();
    const compact = viewingJob && !empty;
    const show =
      viewingJob || (empty && state.view === "lookup" && !state.lookupBusy && !running);
    panel.classList.toggle("hidden", !show);
    panel.classList.toggle("is-compact", compact);
    if (show && !running) updateBulkImportHint();
    updateBulkProgressDom();
  }

  function updateBulkProgressDom() {
    const box = $("#project-bulk-progress");
    if (!box) return;
    const job = state.bulkImport;
    if (!job?.running) {
      box.classList.add("hidden");
      document.body.classList.remove("bulk-import-running");
      updateBackgroundLookupBanner();
      return;
    }
    const viewingJob = isViewingBulkProject();
    box.classList.toggle("hidden", !viewingJob);
    const stillCollecting = viewingJob && isEmptyActiveProject();
    document.body.classList.toggle("bulk-import-running", stillCollecting);
    const title = $("#project-bulk-progress-title");
    const line = $("#project-bulk-progress-line");
    const fill = $("#project-bulk-progress-fill");
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    if (title) {
      title.textContent = `${stillCollecting ? "分析中" : "背景分析"} ${job.done}／${job.total}${
        job.failed ? ` · 失敗 ${job.failed}` : ""
      }`;
    }
    if (line) {
      const now = job.current ? `正在處理「${truncateQueryPreview(job.current, 40)}」` : "";
      line.textContent = stillCollecting
        ? now
        : [now, "可開「專案」看別本；分析不會中斷"].filter(Boolean).join(" · ");
    }
    if (fill) fill.style.width = `${pct}%`;
    updateBackgroundLookupBanner();
  }

  async function persistBulkLine(query, inventory, projectId) {
    const inv =
      inventory && typeof inventory === "object"
        ? inventory
        : { summary: "", translation: "", items: [], vocab: [], tokens: [] };
    let apiHl = { ownedHits: [], missingItems: [], spans: [], legend: [] };
    try {
      apiHl = buildApiHighlight(query, inv) || apiHl;
    } catch (err) {
      console.warn("[persistBulkLine highlight]", query, err);
    }
    try {
      persistLookupResult(query, inv, apiHl, {
        silent: true,
        keepCursor: true,
        projectId,
        forceNew: true,
      });
    } catch (err) {
      console.warn("[persistBulkLine]", query, err);
      try {
        if (typeof Storage.upsertProjectEntry === "function") {
          Storage.upsertProjectEntry(projectId, {
            query,
            summary: `分析失敗：${err.message || "無法寫入"}`,
            translation: "",
            items: [],
            vocab: [],
            tokens: [],
            forceNew: true,
          });
        }
      } catch (err2) {
        console.warn("[persistBulkLine fallback]", err2);
      }
    }
    try {
      if (typeof Storage.flushProjects === "function") {
        await Storage.flushProjects();
      }
    } catch (err) {
      console.warn("[persistBulkLine flush]", query, err);
    }
    return apiHl;
  }

  function cloneLookupJson(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function isFailedLookupInventory(inventory) {
    if (!inventory) return true;
    if (inventory.source === "failed" || inventory.mode === "failed") return true;
    return /分析失敗/.test(String(inventory.summary || ""));
  }

  function inventoryFromStoredSnapshot(entry) {
    if (!entry) return null;
    return {
      summary: String(entry.summary || ""),
      translation: String(entry.translation || ""),
      items: cloneLookupJson(entry.items) || [],
      vocab: cloneLookupJson(entry.vocab) || [],
      tokens: cloneLookupJson(entry.tokens) || [],
      mode: "cached",
      source: "cached",
    };
  }

  function rememberBulkInventory(cache, line, inventory) {
    const key = Storage.normalizeQueryKey(line);
    if (!key || isFailedLookupInventory(inventory) || cache.has(key)) return;
    cache.set(key, cloneLookupJson(inventory));
  }

  function reuseBulkInventory(cache, line, { needApi, projectId } = {}) {
    const key = Storage.normalizeQueryKey(line);
    if (!key) return null;
    if (cache.has(key)) return cloneLookupJson(cache.get(key));
    if (!needApi) return null;
    const stored =
      typeof Storage.findReusableSnapshotByQuery === "function"
        ? Storage.findReusableSnapshotByQuery(line, { projectId })
        : null;
    if (!stored) return null;
    const inv = inventoryFromStoredSnapshot(stored);
    cache.set(key, cloneLookupJson(inv));
    return inv;
  }

  async function runProjectBulkImport() {
    if (state.bulkImport?.running || state.lookupBusy) {
      showToast("已有查詢進行中", "info");
      return;
    }
    if (!isEmptyActiveProject()) {
      showToast("專案已有句子，請用上方查詢列逐句新增", "info");
      syncProjectBulkImport();
      return;
    }
    const info = splitBulkLines($("#project-bulk-input")?.value || "");
    if (!info.lines.length) {
      showToast("請先貼上歌詞或文本", "error");
      $("#project-bulk-input")?.focus();
      return;
    }
    const modes = Storage.loadLookupModes();
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    const startPid = Storage.getActiveProjectId();
    const startName = Storage.getProject(startPid)?.name || "專案";
    const job = {
      running: true,
      cancel: false,
      token: ++state.lookupToken,
      projectId: startPid,
      projectName: startName,
      total: info.lines.length,
      done: 0,
      failed: 0,
      dupCount: info.dupCount,
      reused: 0,
      current: "",
    };
    state.bulkImport = job;
    state.lookupBusy = true;
    updateBulkProgressDom();
    syncProjectBulkImport();

    let firstQuery = null;
    const lookupCache = new Map();
    try {
      for (const line of info.lines) {
        if (job.cancel || !Storage.getProject(startPid)) break;
        job.current = line;
        updateBulkProgressDom();
        let reusedThis = false;
        try {
          let inventory = reuseBulkInventory(lookupCache, line, {
            needApi,
            projectId: startPid,
          });
          reusedThis = Boolean(inventory);
          if (!inventory) {
            inventory = await fetchLookupInventory(line);
          }
          if (job.cancel || !Storage.getProject(startPid)) break;
          await persistBulkLine(line, inventory, startPid);
          if (!reusedThis) rememberBulkInventory(lookupCache, line, inventory);
          if (reusedThis) job.reused += 1;
          if (!firstQuery) firstQuery = line;
        } catch (err) {
          console.warn("[bulk line]", line, err);
          if (job.cancel || !Storage.getProject(startPid)) break;
          job.failed += 1;
          await persistBulkLine(
            line,
            {
              summary: `分析失敗：${err.message || "未知錯誤"}`,
              translation: "",
              items: [],
              vocab: [],
              mode: "failed",
              source: "failed",
            },
            startPid
          );
          if (!firstQuery) firstQuery = line;
        }
        job.done += 1;
        try {
          if (firstQuery && job.done === 1 && Storage.getActiveProjectId() === startPid) {
            const first = Storage.findProjectEntryByQuery(startPid, firstQuery);
            if (first) {
              reviewProjectEntry(first, { silent: true });
              showToast(
                `第 ${first.seq} 句已可看 · 其餘 ${job.total - 1} 句在背景繼續；可先開其他專案`,
                "success"
              );
            }
          }
          if (Storage.getActiveProjectId() === startPid) updateProjectModeUI();
          if (
            !$("#project-entries-modal")?.classList.contains("hidden") &&
            Storage.getActiveProjectId() === startPid
          ) {
            renderProjectEntriesList(startPid);
          }
        } catch (err) {
          console.warn("[bulk ui]", err);
        }
        if (needApi && !job.cancel && !reusedThis) {
          await new Promise((r) => setTimeout(r, 280));
        }
      }
    } finally {
      try {
        if (typeof Storage.flushProjects === "function") {
          await Storage.flushProjects();
        }
      } catch (err) {
        console.warn("[bulk flush]", err);
      }
      state.lookupBusy = false;
      const cancelled = job.cancel;
      const done = job.done;
      const failed = job.failed;
      const dupCount = job.dupCount;
      const reused = job.reused;
      state.bulkImport = null;
      document.body.classList.remove("bulk-import-running");
      updateBulkProgressDom();
      updateProjectModeUI();

      const viewing = Storage.getActiveProjectId() === startPid;
      const entries = viewing ? Storage.getProjectEntriesSorted(startPid) : [];
      if (viewing && entries.length && firstQuery && !isViewingLookupQuery(firstQuery) && !state.lastQuery) {
        const first =
          Storage.findProjectEntryByQuery(startPid, firstQuery) || entries[0];
        reviewProjectEntry(first, { silent: true });
      }
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      syncProjectBulkImport();

      const bits = [`「${startName}」已匯入 ${done} 句`];
      if (dupCount) bits.push(`重複保留 ${dupCount}`);
      if (reused) bits.push(`API 沿用 ${reused}`);
      if (failed) bits.push(`失敗 ${failed}`);
      if (cancelled && done < info.lines.length) bits.push("已取消其餘");
      showToast(bits.join(" · "), failed ? "info" : "success");
    }
  }

  function cancelProjectBulkImport() {
    if (!state.bulkImport?.running) return;
    state.bulkImport.cancel = true;
    const title = $("#project-bulk-progress-title");
    if (title) title.textContent = "正在取消…";
  }

  function normalizeLookupKey(q) {
    return String(q || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function isViewingLookupQuery(query) {
    return normalizeLookupKey($("#lookup-input")?.value) === normalizeLookupKey(query);
  }

  function truncateQueryPreview(q, max = 36) {
    const s = String(q || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }

  function ensureLookupBgBanner() {
    let el = $("#lookup-bg-banner");
    if (el) return el;
    const form = $("#lookup-form");
    const result = $("#lookup-result");
    if (!form && !result) return null;
    el = document.createElement("div");
    el.id = "lookup-bg-banner";
    el.className = "lookup-bg-banner hidden";
    el.setAttribute("role", "status");
    if (form) form.insertAdjacentElement("afterend", el);
    else result.insertAdjacentElement("beforebegin", el);
    return el;
  }

  /** API 查詢中切到已查過句子、或整批分析時去看別的專案 */
  function updateBackgroundLookupBanner() {
    const el = ensureLookupBgBanner();
    if (!el) return;
    const job = state.bulkImport;
    if (job?.running && !isViewingBulkProject()) {
      const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
      el.classList.remove("hidden");
      el.innerHTML = `
        <div class="lookup-bg-banner-main">
          <strong>整批分析進行中</strong>
          <span>專案「${esc(job.projectName || "未命名")}」${job.done}／${job.total}${
            job.failed ? ` · 失敗 ${job.failed}` : ""
          }（${pct}%）· 不中斷目前瀏覽</span>
        </div>
        <div class="lookup-bg-banner-actions">
          <button type="button" class="btn btn-sm btn-secondary" id="btn-return-bulk-project">
            回該專案
          </button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-cancel-bulk-away">
            取消其餘
          </button>
        </div>`;
      el.querySelector("#btn-return-bulk-project")?.addEventListener("click", () => {
        if (job.projectId) enterProject(job.projectId);
      });
      el.querySelector("#btn-cancel-bulk-away")?.addEventListener("click", () => {
        cancelProjectBulkImport();
        updateBackgroundLookupBanner();
      });
      return;
    }
    const pending = state.pendingLookupQuery;
    if (!state.lookupBusy || !pending || job?.running) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    if (isViewingLookupQuery(pending)) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="lookup-bg-banner-main">
        <strong>API 背景查詢中</strong>
        <span>「${esc(truncateQueryPreview(pending))}」完成後會自動存入${
          Storage.getActiveProjectId() ? "專案" : "歷史"
        }，不中斷目前瀏覽。</span>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" id="btn-return-pending-lookup">
        回到查詢中
      </button>`;
    el.querySelector("#btn-return-pending-lookup")?.addEventListener("click", () => {
      returnToPendingLookup();
    });
  }

  function returnToPendingLookup() {
    const pending = state.pendingLookupQuery;
    if (!pending || !state.lookupBusy) {
      updateBackgroundLookupBanner();
      return;
    }
    if ($("#lookup-input")) $("#lookup-input").value = pending;
    state.lastQuery = pending;
    const box = $("#lookup-result");
    if (box && state.pendingLookupLoadingHtml) {
      box.innerHTML = state.pendingLookupLoadingHtml;
      bindLookupResultEvents(pending, null);
      syncAppHeaderHeight();
    }
    updateBackgroundLookupBanner();
    updateLookupNavBtns();
    if (isProjectMode()) updateProjectModeUI();
  }

  function clearPendingLookup(token) {
    if (token != null && token !== state.lookupToken) return;
    state.lookupBusy = false;
    state.pendingLookupQuery = null;
    state.pendingLookupLoadingHtml = null;
    updateBackgroundLookupBanner();
  }

  /**
   * 一般模式：僅 → 再看歷史上一句
   * 專案模式：← 上一號 / 序號 / → 下一號
   */
  function updateLookupNavBtns() {
    const prevBtn = $("#btn-lookup-seq-prev");
    const nextBtn = $("#btn-lookup-seq-next");
    const label = $("#lookup-seq-label");
    if (!nextBtn) return;

    if (isProjectMode()) {
      const project = Storage.getActiveProject();
      const entries = Storage.getProjectEntriesSorted(project);
      const total = entries.length;

      if (prevBtn) prevBtn.hidden = false;
      if (label) {
        label.hidden = false;
        let curSeq = state.projectCursorSeq;
        const curQ = String($("#lookup-input")?.value || "").trim();
        if (curQ) {
          curSeq = resolveDisplayedProjectSeq(project?.id, curQ, curSeq);
        }
        if (total === 0) {
          label.textContent = "—";
        } else if (curSeq != null && entries.some((e) => e.seq === curSeq)) {
          label.textContent = `${curSeq}/${entries[entries.length - 1].seq}`;
        } else {
          label.textContent = `·/${entries[entries.length - 1].seq}`;
        }
      }

      const curIdx = resolveProjectCursorIndex(entries);
      // curIdx < 0（尚未對到句子）時兩向皆可：→ 第一句、← 最後一句
      if (prevBtn) {
        prevBtn.disabled = total === 0 || curIdx === 0;
        prevBtn.title = "上一號句子（A / ←）";
        prevBtn.setAttribute("aria-label", "上一號句子");
      }
      nextBtn.disabled = total === 0 || (curIdx >= 0 && curIdx >= total - 1);
      nextBtn.title = "下一號句子（D / →）";
      nextBtn.setAttribute("aria-label", "下一號句子");
      return;
    }

    // 一般歷史模式
    if (prevBtn) prevBtn.hidden = true;
    if (label) {
      label.hidden = true;
      label.textContent = "";
    }
    const list = Storage.loadHistory();
    const has = list.length > 0;
    nextBtn.disabled = !has;
    nextBtn.title = has
      ? "再看歷史中的上一句（D / →）"
      : "尚無查詢歷史";
    nextBtn.setAttribute("aria-label", has ? "再看歷史上一句" : "尚無查詢歷史");
  }

  function resolveProjectCursorIndex(entries) {
    if (!entries?.length) return -1;
    // 副歌／重複句：必須用游標序號。若改找「輸入框同句的第一筆」，
    // 下一句會從第一次出現處起算，翻頁就會跳回前前頁打轉。
    if (state.projectCursorSeq != null) {
      const byCursor = entries.findIndex((e) => e.seq === state.projectCursorSeq);
      if (byCursor >= 0) return byCursor;
    }
    const curQ = String($("#lookup-input")?.value || "").trim();
    if (curQ) {
      const hit = entries.find(
        (e) => Storage.normalizeQueryKey(e.query) === Storage.normalizeQueryKey(curQ)
      );
      if (hit) return entries.findIndex((e) => e.seq === hit.seq);
    }
    return -1;
  }

  /**
   * 再看歷史上一句：預設最新一筆；若輸入框已是最新句則取下一筆
   */
  function recallPreviousHistorySentence() {
    const list = Storage.loadHistory();
    if (!list.length) {
      showToast("尚無查詢歷史", "info");
      updateLookupNavBtns();
      return;
    }
    const cur = String($("#lookup-input")?.value || "")
      .trim()
      .replace(/\s+/g, " ");
    let entry = list[0];
    if (cur && list.length > 1) {
      const firstNorm = String(list[0].query || "")
        .trim()
        .replace(/\s+/g, " ");
      if (cur === firstNorm) {
        entry = list[1];
      }
    }
    if (!entry?.query) {
      showToast("找不到上一句歷史", "info");
      return;
    }
    reviewHistoryWithCurrentRules(entry);
    updateLookupNavBtns();
  }

  /** 專案模式：上一號 / 下一號 */
  function navigateProjectSentence(dir) {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("目前不在專案中", "info");
      return;
    }
    const entries = Storage.getProjectEntriesSorted(project);
    if (!entries.length) {
      showToast("此專案尚無句子", "info");
      updateLookupNavBtns();
      return;
    }
    let idx = resolveProjectCursorIndex(entries);
    if (idx < 0) {
      // 尚未對到句子：→ 從第 1 句、← 從最後一句
      idx = dir > 0 ? -1 : entries.length;
    }
    const nextIdx = idx + dir;
    if (nextIdx < 0) {
      showToast("已是第一句", "info");
      return;
    }
    if (nextIdx >= entries.length) {
      showToast("已是最後一句", "info");
      return;
    }
    reviewProjectEntry(entries[nextIdx], { silent: false });
  }

  function onLookupSeqPrev() {
    if (isProjectMode()) navigateProjectSentence(-1);
  }

  function onLookupSeqNext() {
    if (isProjectMode()) navigateProjectSentence(1);
    else recallPreviousHistorySentence();
  }

  /** 是否在可編輯欄位中（方向鍵應留給游標移動） */
  function isEditableKeyTarget(el) {
    if (!el || el === document.body) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return Boolean(el.closest && el.closest("input, textarea, select, [contenteditable='true']"));
  }

  let touchSession = false;

  function isCoarsePointer() {
    if (touchSession) return true;
    try {
      return (
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches
      );
    } catch {
      return "ontouchstart" in window;
    }
  }

  function visualViewportBox() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        left: vv.offsetLeft,
        top: vv.offsetTop,
        width: vv.width,
        height: vv.height,
        right: vv.offsetLeft + vv.width,
        bottom: vv.offsetTop + vv.height,
      };
    }
    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
  }

  function eventClientPoint(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (t) return { x: t.clientX, y: t.clientY };
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      return { x: e.clientX, y: e.clientY };
    }
    return { x: NaN, y: NaN };
  }

  function placeFixedPop(pop, clientX, clientY, opts = {}) {
    if (!pop) return;
    const pad = opts.pad ?? 8;
    const gap = opts.gap ?? 12;
    const vv = visualViewportBox();
    const rect = pop.getBoundingClientRect();
    let left = clientX - rect.width / 2;
    let top = clientY + gap;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - rect.width - pad));
    if (top + rect.height > vv.bottom - pad) top = clientY - rect.height - gap;
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - rect.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function placePopNearAnchor(pop, anchor) {
    if (!pop || !anchor) return;
    const pad = 8;
    const vv = visualViewportBox();
    const rect = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + pad;
    left = Math.max(vv.left + pad, Math.min(left, vv.right - pr.width - pad));
    if (top + pr.height > vv.bottom - pad && rect.top - pr.height - pad >= vv.top) {
      top = rect.top - pr.height - pad;
    }
    top = Math.max(vv.top + pad, Math.min(top, vv.bottom - pr.height - pad));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function bindPadChrome() {
    if (bindPadChrome.done) return;
    bindPadChrome.done = true;
    window.addEventListener(
      "touchstart",
      () => {
        touchSession = true;
      },
      { passive: true }
    );
    const vv = window.visualViewport;
    if (!vv) return;
    let ticking = false;
    const keepFocusVisible = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = document.activeElement;
        if (!el || !isEditableKeyTarget(el)) return;
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          el.scrollIntoView();
        }
      });
    };
    vv.addEventListener("resize", keepFocusVisible);
    vv.addEventListener("scroll", keepFocusVisible);
  }

  /**
   * 查詢頁方向鍵導航：← / A 上一句 · → / D 下一句
   * @returns {boolean} 是否已處理
   */
  function handleLookupArrowNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (state.view !== "lookup") return false;
    // 查詢進行中仍可切到已查過句子（背景 API 不中斷）
    if (isEditableKeyTarget(e.target)) return false;
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return false;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return false;
    if (!$("#projects-modal")?.classList.contains("hidden")) return false;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return false;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return false;
    if (state.locateTarget) return false;

    const code = String(e.code || "");
    if (e.key === "ArrowLeft" || code === "KeyA") {
      e.preventDefault();
      onLookupSeqPrev();
      return true;
    }
    if (e.key === "ArrowRight" || code === "KeyD") {
      e.preventDefault();
      onLookupSeqNext();
      return true;
    }
    return false;
  }

  function isAppHotkeyBlocked(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
    if (e.isComposing || e.keyCode === 229) return true;
    if (isEditableKeyTarget(e.target)) return true;
    return false;
  }

  function isBlockingOverlayOpen() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) return true;
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) return true;
    if (!$("#projects-modal")?.classList.contains("hidden")) return true;
    if (!$("#project-entries-modal")?.classList.contains("hidden")) return true;
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) return true;
    if (state.locateTarget) return true;
    return false;
  }

  function dismissTransientUi() {
    if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
    if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
    if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
      hideSelApplyPop();
      state.selApply = null;
    }
    if (state.locateTarget) cancelLocateMode();
    if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
    if (!$("#projects-modal")?.classList.contains("hidden")) closeProjectsModal();
  }

  function toggleLookupModeHotkey(which) {
    const id = which === "apiVocab" ? "settings-mode-api-vocab" : "settings-mode-api-grammar";
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !el.checked;
    onLookupModeToggle(which);
  }

  /** WASD／ZXCVBNM 全域快捷鍵（輸入中不攔截） */
  function handleAppHotkeys(e) {
    if (isAppHotkeyBlocked(e)) return false;
    const code = String(e.code || "");

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      code === "KeyA" ||
      code === "KeyD"
    ) {
      return handleLookupArrowNav(e);
    }

    if (e.repeat) return false;

    if (code === "KeyW") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiGrammar");
      return true;
    }
    if (code === "KeyS") {
      if (isBlockingOverlayOpen()) return false;
      e.preventDefault();
      toggleLookupModeHotkey("apiVocab");
      return true;
    }

    const viewByCode = {
      KeyZ: "lookup",
      KeyX: "history",
      KeyC: "projects",
      KeyV: "rules",
      KeyB: "vocab",
      KeyN: "todos",
      KeyM: "settings",
    };
    const dest = viewByCode[code];
    if (!dest) return false;
    e.preventDefault();
    if (dest === "projects") {
      if (!$("#vocab-edit-modal")?.classList.contains("hidden")) closeVocabEditModal();
      if (!$("#rule-pick-modal")?.classList.contains("hidden")) closeRulePickModal();
      if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
        hideSelApplyPop();
        state.selApply = null;
      }
      if (state.locateTarget) cancelLocateMode();
      if (!$("#project-entries-modal")?.classList.contains("hidden")) closeProjectEntriesModal();
      onNavProjects();
      return true;
    }
    dismissTransientUi();
    setView(dest);
    return true;
  }

  /** 頂部「專案」：已在專案中 → 回查詢頁；否則開列表 */
  function onNavProjects() {
    const project = Storage.getActiveProject();
    if (project) {
      closeProjectsModal();
      setView("lookup");
      updateProjectModeUI();
      // 若查詢區尚無結果、但專案有句子，補顯示目前游標句（或第一句）
      const box = $("#lookup-result");
      const empty = !box || !box.innerHTML.trim();
      if (empty) {
        const entries = Storage.getProjectEntriesSorted(project);
        if (entries.length) {
          let entry =
            state.projectCursorSeq != null
              ? entries.find((e) => e.seq === state.projectCursorSeq)
              : null;
          if (!entry) entry = entries[0];
          reviewProjectEntry(entry, { silent: true });
        }
      }
      return;
    }
    openProjectsModal();
  }

  function openProjectsModal(opts = {}) {
    const modal = $("#projects-modal");
    if (!modal) return;
    if (Object.prototype.hasOwnProperty.call(opts, "browseId")) {
      state.projectsBrowseId = opts.browseId;
    } else {
      state.projectsBrowseId = null;
    }
    modal.classList.remove("hidden");
    renderProjectsList();
    const input = $("#project-new-name");
    if (input) {
      input.value = "";
      if (!isCoarsePointer()) setTimeout(() => input.focus(), 50);
    }
  }

  function closeProjectsModal() {
    $("#projects-modal")?.classList.add("hidden");
  }

  function isBrowsingUngrouped() {
    return state.projectsBrowseId === "";
  }

  function browsingCollection() {
    if (state.projectsBrowseId == null || state.projectsBrowseId === "") return null;
    return Storage.getCollection(state.projectsBrowseId);
  }

  function syncProjectsModalChrome() {
    const atRoot = state.projectsBrowseId == null;
    const ungrouped = isBrowsingUngrouped();
    const col = browsingCollection();
    const title = $("#projects-modal-title");
    const sub = $("#projects-modal-sub");
    const crumb = $("#projects-modal-crumb");
    const crumbCur = $("#projects-crumb-current");
    const input = $("#project-new-name");
    const label = $("#project-new-name-label");
    const createBtn = $("#btn-project-create");

    if (title) title.textContent = atRoot ? "專案" : ungrouped ? "未分類" : col?.name || "分項";
    if (sub) {
      sub.textContent = atRoot
        ? "先選大項（如歌詞、小說），再進分項。句子只存在分項裡。"
        : "分項是現在的專案：各章／各首歌。進入後查詢會依序編號。";
    }
    if (crumb) crumb.classList.toggle("hidden", atRoot);
    if (crumbCur) {
      const name = ungrouped ? "未分類" : col?.name || "—";
      if (document.activeElement !== crumbCur) crumbCur.textContent = name;
      crumbCur.classList.toggle("is-editable", Boolean(col));
      crumbCur.contentEditable = col ? "true" : "false";
      crumbCur.title = col ? "點此改名" : "";
    }
    if (input) {
      input.placeholder = atRoot
        ? "新大項名稱，例如：歌詞、小說"
        : "新分項名稱，例如：1절、某首歌";
    }
    if (label) label.textContent = atRoot ? "新大項名稱" : "新分項名稱";
    if (createBtn) createBtn.textContent = atRoot ? "建立大項" : "建立分項";
  }

  function collectionMoveOptionsHtml(selectedId) {
    const cur = String(selectedId || "");
    const cols = Storage.listCollections();
    const opts = [`<option value=""${cur ? "" : " selected"}>未分類</option>`];
    for (const c of cols) {
      opts.push(
        `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`
      );
    }
    return opts.join("");
  }

  function openProjectEntriesModal() {
    const project = Storage.getActiveProject();
    if (!project) {
      showToast("請先進入專案", "info");
      return;
    }
    const modal = $("#project-entries-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    const filter = $("#project-entries-filter");
    if (filter) filter.value = "";
    renderProjectEntriesList(project.id);
    setTimeout(() => filter?.focus(), 40);
  }

  function closeProjectEntriesModal() {
    $("#project-entries-modal")?.classList.add("hidden");
  }

  function renderProjectsList() {
    const box = $("#projects-list");
    if (!box) return;
    syncProjectsModalChrome();
    if (state.projectsBrowseId == null) {
      renderCollectionList(box);
      return;
    }
    renderProjectItems(box, state.projectsBrowseId);
  }

  function renderCollectionList(box) {
    const cols = Storage.listCollections();
    const ungroupedN = Storage.countUngroupedProjects();
    const active = Storage.getActiveProject();
    const items = [];

    for (const c of cols) {
      const sum = Storage.summarizeCollection(c.id);
      const current = active?.collectionId === c.id;
      items.push({
        kind: "collection",
        id: c.id,
        name: c.name,
        current,
        meta: [
          `${sum.projectCount} 分項`,
          `${sum.sentenceCount} 句`,
          sum.lastProjectName ? `上次：${sum.lastProjectName}` : "",
          c.updatedAt ? `更新 ${formatHistoryTime(c.updatedAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    if (ungroupedN) {
      const sum = Storage.summarizeCollection("");
      items.push({
        kind: "ungrouped",
        id: "",
        name: "未分類",
        current: Boolean(active && !active.collectionId),
        meta: [`${sum.projectCount} 分項`, `${sum.sentenceCount} 句`].join(" · "),
      });
    }

    if (!items.length) {
      box.innerHTML = `<p class="projects-empty">尚無大項。建立「歌詞」「小說」這類容器，再在裡面加分項（各章／各首歌）。</p>`;
      return;
    }

    box.innerHTML = `<ul class="projects-list">${items
      .map(
        (it) => `
          <li class="project-item is-folder${it.current ? " is-active" : ""}" data-kind="${
            it.kind
          }" data-id="${esc(it.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(it.name)}${it.current ? " · 使用中" : ""}</p>
              <p class="project-item-meta">${esc(it.meta)}</p>
            </div>
            <div class="project-item-actions">
              <button type="button" class="btn btn-sm btn-primary" data-col-open>打開</button>
              ${
                it.kind === "collection"
                  ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-col-delete>刪除</button>`
                  : ""
              }
            </div>
          </li>`
      )
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      const open = () => {
        state.projectsBrowseId = li.dataset.kind === "ungrouped" ? "" : id;
        renderProjectsList();
        $("#project-new-name")?.focus();
      };
      li.querySelector("[data-col-open]")?.addEventListener("click", open);
      li.querySelector(".project-item-main")?.addEventListener("click", open);
      li.querySelector("[data-col-delete]")?.addEventListener("click", () => {
        deleteCollectionWithConfirm(id);
      });
    });
  }

  function renderProjectItems(box, collectionId) {
    const list = Storage.listProjectsByCollection(collectionId);
    const activeId = Storage.getActiveProjectId();
    if (!list.length) {
      box.innerHTML = `<p class="projects-empty">尚無分項。輸入名稱後按「建立分項」，再一次放入文本。</p>`;
      return;
    }
    box.innerHTML = `<ul class="projects-list">${list
      .map((p) => {
        const n = (p.entries || []).length;
        const active = p.id === activeId;
        return `
          <li class="project-item${active ? " is-active" : ""}" data-id="${esc(p.id)}">
            <div class="project-item-main">
              <p class="project-item-name">${esc(p.name)}${active ? " · 使用中" : ""}</p>
              <p class="project-item-meta">
                ${n} 句
                ${p.updatedAt ? ` · 更新 ${esc(formatHistoryTime(p.updatedAt))}` : ""}
              </p>
            </div>
            <div class="project-item-actions">
              <label class="sr-only" for="proj-move-${esc(p.id)}">搬到大項</label>
              <select
                class="project-item-move"
                id="proj-move-${esc(p.id)}"
                data-proj-move
                title="搬到其他大項"
              >${collectionMoveOptionsHtml(p.collectionId)}</select>
              <button type="button" class="btn btn-sm btn-primary" data-proj-enter>
                ${active ? "回到查詢" : "進入"}
              </button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-proj-delete>
                刪除
              </button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("[data-proj-enter]")?.addEventListener("click", () => {
        enterProject(id);
      });
      li.querySelector("[data-proj-move]")?.addEventListener("change", (e) => {
        const next = e.target.value;
        const moved = Storage.moveProject(id, next);
        if (!moved) {
          showToast("無法搬移", "error");
          renderProjectsList();
          return;
        }
        const dest = next ? Storage.getCollection(next)?.name : "未分類";
        showToast(`已搬到「${dest || "未分類"}」`, "success");
        updateProjectModeUI();
        renderProjectsList();
      });
      li.querySelector("[data-proj-delete]")?.addEventListener("click", () => {
        const p = Storage.getProject(id);
        if (!p) return;
        if (
          !confirm(
            `確定刪除分項「${p.name}」？\n內含 ${(p.entries || []).length} 句將一併清除（無法復原）。`
          )
        ) {
          return;
        }
        if (state.bulkImport?.running && state.bulkImport.projectId === id) {
          cancelProjectBulkImport();
        }
        Storage.deleteProject(id);
        if (!Storage.getActiveProjectId()) {
          state.projectCursorSeq = null;
        }
        updateProjectModeUI();
        renderProjectsList();
        showToast("已刪除分項", "info");
      });
    });
  }

  function deleteCollectionWithConfirm(id) {
    const c = Storage.getCollection(id);
    if (!c) return;
    const sum = Storage.summarizeCollection(id);
    if (!confirm(`確定刪除大項「${c.name}」？\n內含 ${sum.projectCount} 個分項、${sum.sentenceCount} 句。`)) {
      return;
    }
    const wipeKids = confirm(
      `這 ${sum.projectCount} 個分項要怎麼處理？\n\n確定＝連同分項與句子全部刪除\n取消＝只刪大項，分項回到「未分類」`
    );
    if (wipeKids) {
      const kids = Storage.listProjectsByCollection(id);
      for (const p of kids) {
        if (state.bulkImport?.running && state.bulkImport.projectId === p.id) {
          cancelProjectBulkImport();
        }
      }
    }
    Storage.deleteCollection(id, { deleteChildren: wipeKids });
    if (!Storage.getActiveProjectId()) state.projectCursorSeq = null;
    if (state.projectsBrowseId === id) state.projectsBrowseId = null;
    updateProjectModeUI();
    renderProjectsList();
    showToast(wipeKids ? `已刪除大項「${c.name}」與全部分項` : `已刪除大項「${c.name}」· 分項回到未分類`, "info");
  }

  /** 專案句子篩選：文字（原文／摘要／翻譯）或序號 */
  function filterProjectEntries(entries, rawQ) {
    const q = String(rawQ || "").trim();
    if (!q) return entries.slice();
    const qLower = q.toLowerCase();
    // 純數字或 #3 / 第3 / 第 3 號
    const seqMatch = q.match(/^(?:#|第\s*)?(\d+)\s*(?:號|句)?$/);
    if (seqMatch) {
      const n = Number(seqMatch[1]);
      return entries.filter((e) => Number(e.seq) === n);
    }
    // 序號區間 2-5 / 2～5
    const rangeMatch = q.match(/^(\d+)\s*[-~～—–]\s*(\d+)$/);
    if (rangeMatch) {
      let a = Number(rangeMatch[1]);
      let b = Number(rangeMatch[2]);
      if (a > b) [a, b] = [b, a];
      return entries.filter((e) => {
        const s = Number(e.seq);
        return s >= a && s <= b;
      });
    }
    return entries.filter((e) => {
      const blob = [
        e.query,
        e.summary,
        e.translation,
        String(e.seq),
        `#${e.seq}`,
        `第${e.seq}`,
      ]
        .join("\n")
        .toLowerCase();
      return blob.includes(qLower);
    });
  }

  function highlightFilterMatch(text, rawQ) {
    const src = String(text || "");
    const q = String(rawQ || "").trim();
    if (!q || !src) return esc(src);
    // 純序號搜尋不在正文高亮
    if (/^(?:#|第\s*)?\d+\s*(?:號|句)?$/.test(q) || /^\d+\s*[-~～—–]\s*\d+$/.test(q)) {
      return esc(src);
    }
    const lower = src.toLowerCase();
    const ql = q.toLowerCase();
    const idx = lower.indexOf(ql);
    if (idx < 0) return esc(src);
    const before = src.slice(0, idx);
    const mid = src.slice(idx, idx + q.length);
    const after = src.slice(idx + q.length);
    return `${esc(before)}<mark class="pe-hl">${esc(mid)}</mark>${esc(after)}`;
  }

  function renderProjectEntriesList(projectId) {
    const box = $("#project-entries-list");
    const sub = $("#project-entries-modal-sub");
    const stat = $("#project-entries-filter-stat");
    const project = Storage.getProject(projectId);
    if (!box || !project) return;
    const all = Storage.getProjectEntriesSorted(project);
    const filterQ = String($("#project-entries-filter")?.value || "");
    const entries = filterProjectEntries(all, filterQ);

    if (sub) {
      const col = project.collectionId ? Storage.getCollection(project.collectionId) : null;
      const path = col ? `${col.name} › ${project.name}` : project.name;
      sub.textContent = `「${path}」· 共 ${all.length} 句 · 序號永久固定，刪除後不重編`;
    }
    if (stat) {
      if (!all.length) {
        stat.textContent = "";
      } else if (filterQ.trim()) {
        stat.textContent = `${entries.length} / ${all.length}`;
      } else {
        stat.textContent = `${all.length} 句`;
      }
    }

    if (!all.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">尚無句子</p>
        <p>在查詢頁送出後會依序編為第 1、2、3… 號。</p>
      </div>`;
      return;
    }
    if (!entries.length) {
      box.innerHTML = `<div class="project-entries-empty">
        <p class="project-entries-empty-title">沒有符合的句子</p>
        <p>試試其他關鍵字，或輸入序號如 <code>3</code>、<code>#12</code>、區間 <code>2-5</code>。</p>
      </div>`;
      return;
    }

    const activeSeq = state.projectCursorSeq;
    box.innerHTML = `<ul class="project-entries-list" role="list">${entries
      .map((e) => {
        const ruleN = Array.isArray(e.items) ? e.items.length : 0;
        const isCurrent = activeSeq != null && Number(e.seq) === Number(activeSeq);
        const qFull = String(e.query || "");
        const qShow =
          qFull.length > 160 ? qFull.slice(0, 160) + "…" : qFull;
        const tr = String(e.translation || "").trim();
        const sum = String(e.summary || "").trim();
        return `
          <li class="project-entry-item${isCurrent ? " is-current" : ""}" data-id="${esc(
            e.id
          )}" data-seq="${e.seq}">
            <div class="project-entry-seq-col" aria-hidden="true">
              <span class="project-entry-seq">#${e.seq}</span>
            </div>
            <div class="project-entry-main">
              <p class="project-entry-query">${highlightFilterMatch(qShow, filterQ)}</p>
              ${
                tr
                  ? `<p class="project-entry-trans">${highlightFilterMatch(
                      tr.length > 100 ? tr.slice(0, 100) + "…" : tr,
                      filterQ
                    )}</p>`
                  : ""
              }
              <div class="project-entry-meta-row">
                <span class="pe-chip">${esc(formatHistoryTime(e.at) || "—")}</span>
                ${
                  ruleN
                    ? `<span class="pe-chip pe-chip-ok">文法 ${ruleN}</span>`
                    : `<span class="pe-chip">無文法標記</span>`
                }
                ${
                  e.ownedCount != null || e.missingCount != null
                    ? `<span class="pe-chip">已收錄 ${e.ownedCount ?? "—"} · 尚未 ${
                        e.missingCount ?? "—"
                      }</span>`
                    : ""
                }
                ${isCurrent ? `<span class="pe-chip pe-chip-now">目前句子</span>` : ""}
              </div>
              ${
                sum
                  ? `<p class="project-entry-summary">${highlightFilterMatch(
                      sum.length > 100 ? sum.slice(0, 100) + "…" : sum,
                      filterQ
                    )}</p>`
                  : ""
              }
            </div>
            <div class="project-entry-actions">
              <button type="button" class="btn btn-sm btn-primary" data-pe-review title="${
                ruleN
                  ? "還原盤點快照"
                  : "還原句子與結果區（當時無文法標記）"
              }">再看</button>
              <button type="button" class="btn btn-sm btn-danger-ghost" data-pe-delete>刪除</button>
            </div>
          </li>`;
      })
      .join("")}</ul>`;

    box.querySelectorAll(".project-entry-item").forEach((li) => {
      const entryId = li.dataset.id;
      const entry = entries.find((x) => x.id === entryId);
      if (!entry) return;
      li.querySelector("[data-pe-review]")?.addEventListener("click", () => {
        closeProjectEntriesModal();
        reviewProjectEntry(entry);
      });
      li.querySelector("[data-pe-delete]")?.addEventListener("click", () => {
        if (!confirm(`確定刪除第 ${entry.seq} 號句子？\n（其餘句子序號不變）`)) return;
        Storage.removeProjectEntry(projectId, entryId);
        if (state.projectCursorSeq === entry.seq) state.projectCursorSeq = null;
        renderProjectEntriesList(projectId);
        if (isEmptyActiveProject()) {
          state.lastQuery = "";
          state.lastInventory = null;
          if ($("#lookup-input")) $("#lookup-input").value = "";
          const resultBox = $("#lookup-result");
          if (resultBox) resultBox.innerHTML = "";
        }
        updateProjectModeUI();
        showToast(`已刪除第 ${entry.seq} 號`, "info");
      });
    });
  }

  function enterProject(id) {
    const p = Storage.getProject(id);
    if (!p) {
      showToast("找不到專案", "error");
      return;
    }
    Storage.setActiveProjectId(id);
    if (p.collectionId) Storage.rememberCollectionLastProject(p.collectionId, id);
    state.projectCursorSeq = null;
    closeProjectsModal();
    setView("lookup");
    updateProjectModeUI();
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    const entries = Storage.getProjectEntriesSorted(p);
    if (entries.length) {
      // 進入時顯示第一句（若有快照則重看）
      reviewProjectEntry(entries[0], { silent: true });
      showToast(`已進入專案「${p.name}」· ${entries.length} 句`, "success");
    } else {
      const input = $("#lookup-input");
      if (input) input.value = "";
      const box = $("#lookup-result");
      if (box) box.innerHTML = "";
      state.lastQuery = "";
      state.lastInventory = null;
      syncProjectBulkImport();
      showToast(`已進入專案「${p.name}」· 可貼上整首一次匯入`, "success");
    }
  }

  function leaveProject() {
    if (!Storage.getActiveProjectId()) {
      showToast("目前不在專案中", "info");
      return;
    }
    Storage.setActiveProjectId(null);
    state.projectCursorSeq = null;
    updateProjectModeUI();
    $("#project-bulk-import")?.classList.add("hidden");
    syncProjectBulkImport();
    updateBackgroundLookupBanner();
    showToast(
      state.bulkImport?.running
        ? "已離開專案 · 整批分析仍在背景進行"
        : "已離開專案（一般查詢模式）",
      "info"
    );
  }

  function createProjectFromModal() {
    const input = $("#project-new-name");
    const name = String(input?.value || "").trim();
    if (!name) {
      showToast(state.projectsBrowseId == null ? "請輸入大項名稱" : "請輸入分項名稱", "error");
      input?.focus();
      return;
    }
    if (state.projectsBrowseId == null) {
      const c = Storage.createCollection(name);
      if (input) input.value = "";
      state.projectsBrowseId = c.id;
      renderProjectsList();
      showToast(`已建立大項「${c.name}」· 可再加分項`, "success");
      input?.focus();
      return;
    }
    const p = Storage.createProject(name, { collectionId: state.projectsBrowseId || "" });
    if (input) input.value = "";
    renderProjectsList();
    showToast(`已建立分項「${p.name}」`, "success");
  }

  function commitCollectionRenameFromCrumb() {
    const el = $("#projects-crumb-current");
    const col = browsingCollection();
    if (!el || !col) return;
    const next = String(el.textContent || "").replace(/\s+/g, " ").trim();
    if (!next) {
      el.textContent = col.name || "未命名";
      showToast("大項名稱不能空白", "error");
      return;
    }
    if (next === String(col.name || "").trim()) {
      el.textContent = col.name || next;
      return;
    }
    const updated = Storage.renameCollection(col.id, next);
    el.textContent = updated?.name || next;
    updateProjectModeUI();
    renderProjectsList();
    showToast(`已改名為「${updated?.name || next}」`, "success");
  }

  function bindCollectionCrumbRename() {
    const el = $("#projects-crumb-current");
    if (!el || el.dataset.renameBound === "1") return;
    el.dataset.renameBound = "1";
    let snapshot = "";
    el.addEventListener("focus", () => {
      snapshot = String(el.textContent || "");
    });
    el.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        el.textContent = snapshot;
        el.blur();
      }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = String((e.clipboardData || window.clipboardData)?.getData("text") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) document.execCommand("insertText", false, text);
    });
    el.addEventListener("blur", () => commitCollectionRenameFromCrumb());
  }



  function maskKey(key) {
    const k = String(key || "");
    if (k.length <= 8) return k ? "••••" : "（未設定）";
    return k.slice(0, 4) + "…" + k.slice(-4);
  }

  function setSettingsStatus(text, kind = "") {
    const box = $("#settings-status");
    const el = $("#settings-status-text");
    if (el) el.textContent = text;
    if (box) {
      box.classList.remove("ok", "warn", "error");
      if (kind) box.classList.add(kind);
    }
  }

  function applyStructureTheme(themeId) {
    const id = Storage.normalizeStructureTheme(themeId);
    document.documentElement.setAttribute("data-structure-theme", id);
    return id;
  }

  function renderStructureThemePreview() {
    const host = $("#structure-theme-preview");
    if (!host) return;
    host.innerHTML = structureFormulaHtml("詞幹＋지 않다＋主詞＋（이/가）");
  }

  function renderThemePicker(selectedId) {
    const box = $("#structure-theme-picker");
    if (!box) return;
    const selected = Storage.normalizeStructureTheme(selectedId);
    const themes = Storage.STRUCTURE_THEMES || [];
    box.innerHTML = themes
      .map((t) => {
        const active = t.id === selected ? " active" : "";
        return `
          <button
            type="button"
            class="theme-card${active}"
            role="radio"
            aria-checked="${t.id === selected ? "true" : "false"}"
            data-theme-id="${esc(t.id)}"
            title="${esc(t.desc)}"
          >
            <span class="theme-card-swatches" data-structure-theme="${esc(t.id)}" aria-hidden="true">
              <span class="theme-swatch theme-swatch-slot"></span>
              <span class="theme-swatch theme-swatch-plus">＋</span>
              <span class="theme-swatch theme-swatch-affix"></span>
              <span class="theme-swatch theme-swatch-transform"></span>
            </span>
            <span class="theme-card-meta">
              <strong>${esc(t.label)}</strong>
              <span class="muted">${esc(t.desc)}</span>
            </span>
          </button>`;
      })
      .join("");

    box.querySelectorAll(".theme-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = applyStructureTheme(btn.dataset.themeId);
        Storage.saveSettings({ structureTheme: id });
        renderThemePicker(id);
        renderStructureThemePreview();
        showToast(`已套用「${(Storage.STRUCTURE_THEMES.find((x) => x.id === id) || {}).label || id}」配色`, "success");
      });
    });
  }

  function readApiFieldsFromForm() {
    return {
      apiKey: $("#settings-api-key")?.value || "",
      baseUrl: $("#settings-base-url")?.value || "",
      model: $("#settings-model")?.value || "",
    };
  }

  function renderApiProviderUI(s) {
    const settings = s || Storage.loadSettings();
    const providers = Storage.API_PROVIDERS || [];
    const curId =
      typeof Storage.inferApiProviderId === "function"
        ? Storage.inferApiProviderId(settings)
        : settings.apiProvider || "grok";
    const preset =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(curId)
        : providers.find((p) => p.id === curId) || providers[0] || {};
    const box = $("#settings-api-provider");
    if (box) {
      box.innerHTML = providers
        .map((p) => {
          const hasKey = Boolean(settings.apiProfiles?.[p.id]?.apiKey);
          const active = p.id === curId;
          return `<button type="button" class="api-provider-pill${
            active ? " is-active" : ""
          }" data-api-provider="${esc(p.id)}" aria-pressed="${active ? "true" : "false"}">
            ${esc(p.label)}${
              hasKey ? `<span class="api-provider-keydot" title="已保存金鑰"></span>` : ""
            }
          </button>`;
        })
        .join("");
    }
    const hint = $("#settings-provider-hint");
    if (hint) {
      hint.innerHTML =
        `${esc(preset.hint || "")}。切換服務時各家金鑰分開保存在本機。` +
        (preset.signup
          ? ` 申請：<a href="${esc(preset.signup)}" target="_blank" rel="noopener noreferrer">${esc(
              preset.signupLabel || preset.signup
            )}</a>`
          : "");
    }
    const keyHint = $("#settings-api-key-hint");
    if (keyHint && preset.signup) {
      keyHint.innerHTML =
        `金鑰存在本機瀏覽器 localStorage，不會上傳到本專案伺服器。請勿在公用電腦儲存。申請：<a href="${esc(
          preset.signup
        )}" target="_blank" rel="noopener noreferrer">${esc(preset.signupLabel || preset.signup)}</a>`;
    }
    const keyInput = $("#settings-api-key");
    if (keyInput) keyInput.placeholder = preset.keyPlaceholder || "API Key";
    const urlInput = $("#settings-base-url");
    if (urlInput) {
      urlInput.readOnly = Boolean(preset.urlLocked);
      urlInput.placeholder = preset.baseUrl || "https://";
    }
    const urlHint = $("#settings-base-url-hint");
    if (urlHint) {
      urlHint.innerHTML = preset.urlLocked
        ? `此服務使用固定端點 <code>${esc(preset.baseUrl)}</code>（OpenAI 相容）`
        : "請填寫 OpenAI 相容的 Base URL（不含尾端 <code>/chat/completions</code>）。";
    }
    const modelInput = $("#settings-model");
    if (modelInput) modelInput.placeholder = preset.defaultModel || "模型名稱";
    const chips = $("#settings-model-shortcuts");
    const models = Array.isArray(preset.models) ? preset.models : [];
    const curModel = String(settings.model || "").trim();
    if (chips) {
      chips.hidden = !models.length;
      chips.innerHTML = models
        .map(
          (m) =>
            `<button type="button" class="model-chip${
              m.id === curModel ? " is-active" : ""
            }" data-model-id="${esc(m.id)}">${esc(m.label)}</button>`
        )
        .join("");
    }
  }

  function switchApiProvider(id) {
    if (typeof Storage.switchApiProvider !== "function") return;
    const next = Storage.switchApiProvider(id, readApiFieldsFromForm());
    fillSettingsForm();
    updateApiStatusDot();
    const label = (Storage.getApiProvider && Storage.getApiProvider(id)?.label) || id;
    const hasKey = Boolean(next.apiKey);
    showToast(
      hasKey ? `已切換 ${label}（已還原該服務金鑰）` : `已切換 ${label}（此服務尚未填金鑰）`,
      hasKey ? "success" : "info"
    );
  }

  function applyModelShortcut(modelId) {
    const input = $("#settings-model");
    if (!input || !modelId) return;
    input.value = modelId;
    Storage.saveSettings({ ...readApiFieldsFromForm(), model: modelId });
    renderApiProviderUI();
    const s = Storage.loadSettings();
    const modes = Storage.loadLookupModes();
    const prov = Storage.getApiProvider ? Storage.getApiProvider(s.apiProvider) : null;
    setSettingsStatus(
      `已填入模型 ${modelId}` +
        (prov ? ` · ${prov.label}` : "") +
        (s.apiKey ? ` · Key ${maskKey(s.apiKey)}` : "") +
        ` · ${Storage.formatLookupModesLabel(modes)}`,
      s.apiKey ? "ok" : "warn"
    );
  }

  function fillSettingsForm() {
    const s = Storage.loadSettings();
    $("#settings-api-key").value = s.apiKey || "";
    $("#settings-base-url").value = s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl;
    $("#settings-model").value = s.model || Storage.DEFAULT_SETTINGS.model;
    const input = $("#settings-api-key");
    if (input) input.type = "password";
    const toggle = $("#btn-toggle-key");
    if (toggle) toggle.textContent = "顯示";
    renderApiProviderUI(s);
    syncApiTtsSwitch(s);
    updateLookupModeUI();
    const modes = Storage.loadLookupModes();
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const prov =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider)
        : null;
    const provLabel = prov?.label ? `${prov.label} · ` : "";
    if (s.apiKey) {
      setSettingsStatus(
        `已設定 ${provLabel}API Key（${maskKey(s.apiKey)}）· 模型 ${s.model} · ${modeLabel}`,
        "ok"
      );
    } else if (needApi) {
      setSettingsStatus(
        `尚未設定 ${provLabel}API Key — API 文法／單字與 AI 填寫無法使用`,
        "warn"
      );
    } else {
      setSettingsStatus("手動模式 · 可查詢並選字套用（未開掃描）", "ok");
    }
    applyStructureTheme(s.structureTheme);
    renderThemePicker(s.structureTheme);
    renderStructureThemePreview();
    updateKiwiStatusUI();
    updateSettingsStorageUsage();
  }

  function updateSettingsStorageUsage() {
    const el = $("#settings-storage-usage");
    if (!el || typeof Storage.measureLocalStorageUsage !== "function") return;
    const u = Storage.measureLocalStorageUsage();
    const pct = Math.round(u.pct * 100);
    const backend =
      u.backend || (typeof Storage.getProjectsBackend === "function" ? Storage.getProjectsBackend() : "");
    const top = (u.rows || [])
      .slice(0, 3)
      .filter((r) => r.key !== "kgn_projects_v1" || backend !== "idb")
      .map((r) => `${r.key.replace(/^(.{18}).+$/, "$1…")} ${Storage.formatStorageBytes(r.bytes)}`)
      .join(" · ");
    let line = `localStorage 約 ${u.totalLabel}／${u.quotaLabel}（${pct}%）`;
    if (backend === "idb") {
      line += ` · 專案句子 IndexedDB ${u.idbLabel || "0 B"}（不受 5MB 上限）`;
    } else if (u.app) {
      line += ` · 文法筆記本 ${u.appLabel}`;
    }
    if (u.level === "full") {
      line +=
        backend === "idb"
          ? " · localStorage 已接近上限（規則／設定／其他網站資料）；專案句子已在 IndexedDB。"
          : " · 已接近上限，整批分析容易寫不進去。可匯出後刪舊專案／清空歷史。";
    } else if (u.level === "warn" && backend !== "idb") {
      line += " · 偏高，歌詞專案含切詞快照會很快塞滿。";
    }
    if (top) line += ` 最大：${top}`;
    el.textContent = line;
  }

  function readLookupModesFromForm() {
    return {
      apiGrammar: Boolean($("#settings-mode-api-grammar")?.checked),
      localGrammar: false,
      apiVocab: Boolean($("#settings-mode-api-vocab")?.checked),
    };
  }

  function onLookupModeToggle() {
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    updateLookupModeUI();
    const label = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (!modes.apiGrammar && !modes.apiVocab) {
      setSettingsStatus("手動模式 · 可查詢並選字套用", "ok");
      showToast("已關閉掃描 · 仍可查詢並手動套用規則", "info");
    } else if (needApi && !Storage.hasApiKey()) {
      setSettingsStatus(`模式：${label} — 請填入 API Key`, "warn");
      showToast(`查詢模式：${label}`, "success");
    } else {
      setSettingsStatus(`模式：${label}`, "ok");
      showToast(`查詢模式：${label}`, "success");
    }
  }

  function saveSettingsForm(e) {
    e?.preventDefault();
    const themeBtn = $("#structure-theme-picker .theme-card.active");
    const raw = readLookupModesFromForm();
    const modes = Storage.saveLookupModes(raw);
    const next = Storage.saveSettings({
      ...readApiFieldsFromForm(),
      kiwiEnabled: $("#settings-kiwi-enabled") ? Boolean($("#settings-kiwi-enabled").checked) : true,
      apiTtsEnabled: Boolean($("#settings-api-tts")?.checked),
      structureTheme:
        themeBtn?.dataset?.themeId ||
        document.documentElement.getAttribute("data-structure-theme") ||
        Storage.DEFAULT_SETTINGS.structureTheme,
      lookupModes: modes,
    });
    applyStructureTheme(next.structureTheme);
    updateLookupModeUI();
    renderApiProviderUI(next);
    const modeLabel = Storage.formatLookupModesLabel(modes);
    const needApi = modes.apiGrammar || modes.apiVocab;
    const provLabel =
      typeof Storage.getApiProvider === "function"
        ? `${Storage.getApiProvider(next.apiProvider).label} · `
        : "";
    if (next.apiKey) {
      setSettingsStatus(
        `已儲存 ${provLabel}（${maskKey(next.apiKey)}）· 模型 ${next.model} · ${modeLabel}`,
        "ok"
      );
      showToast("設定已儲存", "success");
    } else if (needApi) {
      setSettingsStatus("已儲存，但未填 API Key（API 查詢不可用）", "warn");
      showToast("已儲存（尚未填 API Key）", "info");
    } else {
      setSettingsStatus(`已儲存 · ${modeLabel || "未啟用模式"}`, "ok");
      showToast("設定已儲存", "success");
    }
  }

  async function testApiConnection() {
    Storage.saveSettings(readApiFieldsFromForm());
    updateApiStatusDot();
    const btn = $("#btn-test-api");
    if (btn) btn.disabled = true;
    setSettingsStatus("測試連線中…", "");
    try {
      const result = await AiService.testConnection();
      setSettingsStatus(`連線成功 · 回覆：${result.sample}`, "ok");
      showToast("API 連線成功", "success");
    } catch (err) {
      setSettingsStatus(err.message || "連線失敗", "error");
      showToast(err.message || "連線失敗", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clearApiKey() {
    const s = Storage.loadSettings();
    const label =
      typeof Storage.getApiProvider === "function"
        ? Storage.getApiProvider(s.apiProvider).label
        : "目前服務";
    if (!confirm(`確定清除「${label}」的 API Key？其他服務已保存的金鑰會保留。`)) return;
    Storage.clearApiKey();
    $("#settings-api-key").value = "";
    updateApiStatusDot();
    renderApiProviderUI();
    setSettingsStatus(`${label} 的 API Key 已清除`, "warn");
    showToast("已清除 API Key", "info");
  }

  /* —— Form —— */
  function fillCategorySelect(selected) {
    const sel = $("#form-category");
    if (!sel) return;
    const cats = RulesService.CATEGORIES || [];
    sel.innerHTML = cats
      .map(
        (c) =>
          `<option value="${esc(c.key)}"${c.key === (selected || "") ? " selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
    if (selected && !cats.some((c) => c.key === selected)) {
      const opt = document.createElement("option");
      opt.value = selected;
      opt.textContent = selected;
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function openForm(rule = null, draft = null) {
    // AI 背景填寫中：避免開別張表單蓋掉進行中的草稿
    if (state.aiBusy && state.aiJob?.status === "running") {
      const go = confirm(
        `AI 正在為「${state.aiJob.title}」填寫中。\n` +
          `若繼續開啟其他規則，完成後結果可能對不到目前表單。\n\n` +
          `按「確定」仍要開啟；按「取消」則回進行中的表單。`
      );
      if (!go) {
        returnToAiForm();
        return;
      }
    }

    // 記住進入表單前的頁面（AI 填寫中／取消時跳回）
    if (state.view && state.view !== "form") {
      state.formReturnView = state.view;
    }

    state.editingId = rule?.id || null;
    state.todoSourceId = draft?.todoId || null;
    if (!draft?.fromInventory) {
      state.pendingCreateFromInventory = null;
    }
    fillCategorySelect(rule?.category || draft?.category || "");
    $("#form-heading").textContent = rule ? "編輯規則" : "新增規則";
    $("#form-title").value = rule?.title || draft?.title || "";
    $("#form-explanation").value = rule?.explanation || draft?.explanation || "";
    $("#form-structure").value = rule?.structure || draft?.structure || "";
    updateStructurePreview();

    const banner = $("#form-prefill-banner");
    if (draft?.banner) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = draft.banner;
    } else if (state.aiJob?.status === "running" && state.aiJob.editingId === state.editingId) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>AI 查詢中</strong> — 依「${esc(
        state.aiJob.title
      )}」產生內容…可先離開此頁查看歷史或筆記本。`;
    } else {
      banner.classList.add("hidden");
      banner.innerHTML = "";
    }
    setView("form");
    $("#form-title")?.focus();
  }

  /** 選字套用／+補充：建立新規則表單 */
  function openCreateRuleFromSelection() {
    if (state.rulePickMode === "supplementary") {
      if (!state.lastQuery) {
        showToast("請先完成一次查詢", "info");
        return;
      }
      ensureLookupInventoryShell();
      state.pendingSupplementaryApply = true;
      state.pendingSelApply = null;
      closeRulePickModal();
      openForm(null, {
        title: "",
        explanation: "",
        structure: "",
        category: RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
        banner: `<strong>建立補充用法</strong> — 分類已設為「補充用法」。儲存後會<strong>加入本句</strong>（琥珀標、不句中上色）。`,
      });
      return;
    }
    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    state.pendingSelApply = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    closeRulePickModal();
    hideSelApplyPop();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    openForm(null, {
      title: text,
      explanation: "",
      structure: "",
      category: "",
      banner: `<strong>由選字建立</strong> — 已將選取「${esc(
        text
      )}」寫入規則名（可改成「極短中文用法名（韓語）」如 禁止（-지 마））。儲存後會<strong>自動套用到該片段</strong>。`,
    });
  }

  function structureRoleLabel(role) {
    if (role === "slot") return "槽位";
    if (role === "base") return "詞根";
    if (role === "affix") return "標記";
    if (role === "result") return "變化";
    if (role === "transform") return "變化";
    return "";
  }

  function structureTokensToChunks(tokens) {
    const chunks = [];
    (tokens || []).forEach((t) => {
      if (t.op === "plus") {
        chunks.push(
          `<span class="structure-plus" aria-hidden="true"><span class="structure-plus-inner">＋</span></span>`
        );
        return;
      }
      if (t.op === "arrow") {
        chunks.push(
          `<span class="structure-arrow" aria-hidden="true"><span class="structure-arrow-inner">→</span></span>`
        );
        return;
      }
      if (t.op === "slash") {
        chunks.push(
          `<span class="structure-slash" aria-hidden="true"><span class="structure-slash-inner">／</span></span>`
        );
        return;
      }
      const role = t.role || "neutral";
      const kindLabel = structureRoleLabel(role);
      chunks.push(
        `<span class="structure-part structure-part-${role}">` +
          (kindLabel ? `<span class="structure-part-label">${kindLabel}</span>` : "") +
          `<span class="structure-part-text">${esc(t.text || "")}</span>` +
          `</span>`
      );
    });
    return chunks.join("");
  }

  function structureFormulaHtml(structure) {
    const parsed =
      typeof RulesService.parseStructureBranches === "function"
        ? RulesService.parseStructureBranches(structure)
        : {
            branches: [
              {
                tokens: RulesService.parseStructureTokens(structure) || [],
                kind: "normal",
              },
            ],
          };

    let branches = (parsed.branches || []).filter((b) => b.tokens && b.tokens.length);
    if (!branches.length) return "";

    // 顯示順序：開音節 → 閉音節 → 其他（API 若寫反仍校正）
    const rank = (k) => (k === "open" ? 0 : k === "closed" ? 1 : 2);
    if (branches.some((b) => b.kind === "open" || b.kind === "closed")) {
      branches = branches.slice().sort((a, b) => rank(a.kind) - rank(b.kind));
    }

    const multi = branches.length > 1;
    const hasArrow = branches.some((b) => b.tokens.some((t) => t.op === "arrow"));
    const hasOpenClosed = branches.some((b) => b.kind === "open" || b.kind === "closed");

    function wrapBranch(b) {
      const kindClass =
        b.kind === "open"
          ? " structure-branch-open"
          : b.kind === "closed"
            ? " structure-branch-closed"
            : "";
      const tag =
        b.kind === "open"
          ? `<span class="structure-branch-tag structure-branch-tag-open">開音節</span>`
          : b.kind === "closed"
            ? `<span class="structure-branch-tag structure-branch-tag-closed">閉音節</span>`
            : "";
      return `<span class="structure-branch${kindClass}">${tag}${structureTokensToChunks(
        b.tokens
      )}</span>`;
    }

    let trackHtml;
    if (multi || hasOpenClosed) {
      trackHtml = branches
        .map((b, i) => {
          const branch = wrapBranch(b);
          if (i === 0) return branch;
          return (
            `<span class="structure-slash" aria-hidden="true"><span class="structure-slash-inner">／</span></span>` +
            branch
          );
        })
        .join("");
    } else {
      trackHtml = wrapBranch(branches[0]);
    }

    const mods = [
      hasArrow ? "structure-formula-contract" : "",
      multi || hasOpenClosed ? "structure-formula-alts" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      `<div class="structure-formula${mods ? " " + mods : ""}" role="img" aria-label="${esc(structure)}">` +
      `<div class="structure-formula-track">${trackHtml}</div>` +
      `</div>`
    );
  }

  function updateStructurePreview() {
    const box = $("#form-structure-preview");
    if (!box) return;
    const val = ($("#form-structure")?.value || "").trim();
    if (!val) {
      box.innerHTML =
        `<div class="structure-formula structure-formula-empty">` +
        `<div class="structure-formula-track">` +
        `<span class="structure-empty-hint">輸入後預覽結構式，例如：詞幹＋지 않다</span>` +
        `</div></div>`;
      return;
    }
    box.innerHTML = structureFormulaHtml(val);
  }

  /** 規則建立／更新成功後，清掉對應待辦（來源 id 或同名標題） */
  function clearTodosAfterRuleSaved(ruleTitle) {
    let todos = Storage.loadTodos();
    const before = todos.length;
    const sourceId = state.todoSourceId;
    const key = todoKey(ruleTitle);

    todos = todos.filter((t) => {
      if (sourceId && t.id === sourceId) return false;
      if (key && todoKey(t.title) === key) return false;
      // 雙語標題模糊：中文段或韓語段相同也清
      if (key && ruleTitle) {
        const a = RulesService.parseBilingualTitle(t.title);
        const b = RulesService.parseBilingualTitle(ruleTitle);
        if (a.zh && b.zh && todoKey(a.zh) === todoKey(b.zh)) return false;
        if (a.ko && b.ko && todoKey(a.ko) === todoKey(b.ko)) return false;
      }
      return true;
    });

    state.todoSourceId = null;
    if (todos.length !== before) {
      Storage.saveTodos(todos);
      return before - todos.length;
    }
    return 0;
  }

  function readForm() {
    return {
      title: ($("#form-title")?.value || "").trim(),
      category: $("#form-category")?.value || "",
      explanation: ($("#form-explanation")?.value || "").trim(),
      structure: ($("#form-structure")?.value || "").trim(),
    };
  }

  function saveForm(e) {
    e?.preventDefault();
    e?.stopPropagation?.();
    const data = readForm();
    if (!data.title) {
      showToast("請填寫規則名", "error");
      $("#form-title")?.focus();
      return;
    }
    const wasEdit = Boolean(state.editingId);
    const pending = state.pendingSelApply;
    const pendingSupp = state.pendingSupplementaryApply;
    const pendingInv = state.pendingCreateFromInventory;
    if (pendingSupp) {
      data.category = RulesService.SUPPLEMENTARY_CATEGORY || "補充用法";
    }
    let saved;
    try {
      if (state.editingId) {
        saved = RulesService.update(state.editingId, data);
      } else {
        saved = RulesService.create(data);
      }
    } catch (err) {
      showToast(err.message || "儲存失敗", "error");
      return;
    }
    if (!saved) {
      showToast("儲存失敗", "error");
      return;
    }

    const cleared = clearTodosAfterRuleSaved(data.title || saved.title);
    state.editingId = null;
    state.todoSourceId = null;
    state.pendingSelApply = null;
    state.pendingSupplementaryApply = false;
    state.pendingCreateFromInventory = null;
    // 儲存成功後收起 AI 狀態列
    if (state.aiJob && state.aiJob.status !== "running") {
      setAiJobBar("hidden");
      state.aiJob = null;
    }
    updateRuleCount();

    const extra = cleared ? ` · 已清 ${cleared} 筆待辦` : "";
    try {
      if (!wasEdit && pending && state.lastInventory) {
        setView("lookup");
        addRuleToCurrentResult(saved, pending.text, pending.start, pending.end);
        showToast(`規則已建立並套用到「${pending.text}」${extra}`, "success");
        return;
      }

      if (!wasEdit && pendingSupp && state.lastQuery) {
        setView("lookup");
        addSupplementaryRuleToCurrent(saved);
        showToast(`補充用法已建立並加入本句${extra}`, "success");
        return;
      }

      if (!wasEdit && pendingInv && state.lastInventory) {
        attachCreatedRuleToInventoryItem(saved, pendingInv);
        setView("lookup");
        refreshLookupFromInventory();
        requestAnimationFrame(() => scrollToOwnedRuleOnLookup(saved.id));
        showToast(`規則已建立並套用到本句${extra}`, "success");
        return;
      }

      if (state.lastQuery && state.lastInventory) {
        setView("lookup");
        refreshLookupFromInventory();
        if (!wasEdit) {
          requestAnimationFrame(() => scrollToOwnedRuleOnLookup(saved.id));
        }
        showToast(
          wasEdit ? `規則已更新${extra}` : `規則已新增${extra}`,
          "success"
        );
        return;
      }

      setView("rules");
      showToast(
        wasEdit ? `規則已更新${extra}` : `規則已新增${extra}`,
        "success"
      );
    } catch (err) {
      console.warn("[saveForm] UI refresh", err);
      setView(state.lastQuery ? "lookup" : "rules");
      showToast(
        `規則已儲存，但畫面更新失敗：${err.message || "未知錯誤"}。可到筆記本查看。`,
        "info"
      );
    }
  }

  function uidJob() {
    return "ai_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function setAiJobBar(status, message, opts = {}) {
    const bar = $("#ai-job-bar");
    const text = $("#ai-job-bar-text");
    const dismiss = $("#btn-ai-job-dismiss");
    if (!bar || !text) return;
    if (status === "hidden") {
      bar.classList.add("hidden");
      bar.classList.remove("is-running", "is-done", "is-error");
      return;
    }
    bar.classList.remove("hidden", "is-running", "is-done", "is-error");
    if (status === "running") bar.classList.add("is-running");
    if (status === "done") bar.classList.add("is-done");
    if (status === "error") bar.classList.add("is-error");
    text.textContent = message || "";
    if (dismiss) {
      dismiss.hidden = status === "running";
    }
    const formBtn = $("#btn-ai-job-form");
    if (formBtn) {
      formBtn.textContent = opts.formBtnLabel || "回表單";
    }
  }

  /** 回尚未儲存的表單（AI 草稿仍在 DOM 欄位） */
  function returnToAiForm() {
    // 還原這次 AI 工作對應的編輯身分（含新增時 id 為 null）
    if (state.aiJob) {
      state.editingId = state.aiJob.editingId;
      state.todoSourceId = state.aiJob.todoSourceId;
      if (state.aiJob.pendingCreateFromInventory) {
        state.pendingCreateFromInventory = state.aiJob.pendingCreateFromInventory;
      }
      if (state.aiJob.pendingSelApply) {
        state.pendingSelApply = state.aiJob.pendingSelApply;
      }
      if (state.aiJob.pendingSupplementaryApply) {
        state.pendingSupplementaryApply = state.aiJob.pendingSupplementaryApply;
      }
    }
    setView("form");
    if (state.aiJob?.status === "done" || state.aiJob?.status === "error") {
      // 已結束：進入表單後可收起狀態列
      setAiJobBar("hidden");
      state.aiJob = null;
    }
    $("#form-explanation")?.focus();
  }

  function dismissAiJobBar() {
    setAiJobBar("hidden");
    if (!state.aiBusy) state.aiJob = null;
  }

  async function runAiComplete() {
    if (state.aiBusy) {
      showToast("AI 仍在填寫中，可先到歷史或筆記本查看", "info");
      return;
    }
    const title = ($("#form-title")?.value || "").trim();
    if (!title) {
      showToast("請先填寫規則名", "error");
      $("#form-title")?.focus();
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
      return;
    }
    const current = readForm();
    if (
      ((current.explanation || "").trim() || (current.structure || "").trim()) &&
      !confirm("目前說明或結構已有內容，要用 AI 結果覆寫嗎？")
    ) {
      return;
    }

    const jobId = uidJob();
    const job = {
      id: jobId,
      title,
      editingId: state.editingId,
      todoSourceId: state.todoSourceId,
      pendingCreateFromInventory: state.pendingCreateFromInventory,
      pendingSelApply: state.pendingSelApply,
      pendingSupplementaryApply: state.pendingSupplementaryApply,
      status: "running",
    };
    state.aiJob = job;
    state.aiBusy = true;

    const btn = $("#btn-ai-complete");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    const banner = $("#form-prefill-banner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.className = "result-banner info";
      banner.innerHTML = `<strong>AI 查詢中</strong> — 依「${esc(
        title
      )}」產生內容…可先離開此頁查看歷史或筆記本。`;
    }

    setAiJobBar("running", `AI 填寫中：${title} — 可先瀏覽其他頁，完成後回表單核對`);
    // 保留表單欄位進度，跳回進入表單前的頁面（不再固定規則本）
    setView(getFormReturnView());
    showToast("AI 填寫中，完成後可點狀態列「回表單」核對", "info");

    try {
      const draft = await AiService.completeRuleFromTitle(title);
      // 僅當仍是同一筆工作時寫入（避免中途開了別張表單被蓋掉）
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "done";
        // 還原編輯身分後寫入表單（DOM 在 hidden 的 view-form 仍保留）
        state.editingId = job.editingId;
        state.todoSourceId = job.todoSourceId;
        if (job.pendingCreateFromInventory) {
          state.pendingCreateFromInventory = job.pendingCreateFromInventory;
        }
        if (job.pendingSelApply) state.pendingSelApply = job.pendingSelApply;
        if (job.pendingSupplementaryApply) {
          state.pendingSupplementaryApply = job.pendingSupplementaryApply;
        }
        if (draft.title) $("#form-title").value = draft.title;
        $("#form-explanation").value = draft.explanation || "";
        $("#form-structure").value = draft.structure || "";
        updateStructurePreview();
        const keepSupp =
          job.pendingSupplementaryApply ||
          $("#form-category")?.value === "補充用法" ||
          (typeof RulesService.isSupplementaryUsage === "function" &&
            RulesService.isSupplementaryUsage(draft.category));
        if (keepSupp) {
          fillCategorySelect("補充用法");
        } else if (draft.category) {
          fillCategorySelect(draft.category);
        }
        if (banner) {
          banner.className = "result-banner success";
          banner.innerHTML = `<strong>AI 已填寫</strong> — 請核對說明與結構式後再儲存。`;
        }
        setAiJobBar("done", `AI 已填好「${draft.title || title}」— 點「回表單」核對`, {
          formBtnLabel: "回表單核對",
        });
        showToast("AI 已填好，可回表單核對", "success");
      }
    } catch (err) {
      const stillSameJob = state.aiJob && state.aiJob.id === jobId;
      if (stillSameJob) {
        state.aiJob.status = "error";
        if (banner) {
          banner.className = "result-banner error";
          banner.innerHTML = `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`;
        }
        setAiJobBar("error", `AI 失敗：${err.message || "未知錯誤"}`, {
          formBtnLabel: "回表單",
        });
      }
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      state.aiBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  /* —— Rules list —— */
  function renderRulesList() {
    const filter = $("#rules-filter")?.value || "";
    const list = RulesService.filterList(filter);
    const box = $("#rules-list");
    const count = $("#rules-count");
    if (count) count.textContent = `${list.length} 筆規則`;
    if (!box) return;
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>尚無規則。可新增，或到設定重設種子。</p></div>`;
      return;
    }
    box.innerHTML = `<div class="match-list">${list.map((r) => ruleCardHtml(r, { compact: false })).join("")}</div>`;
    box.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.edit);
        if (rule) openForm(rule);
      });
    });
    box.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.delete;
        const rule = RulesService.getById(id);
        if (!rule) return;
        if (!confirm(`刪除規則「${rule.title}」？`)) return;
        RulesService.remove(id);
        updateRuleCount();
        renderRulesList();
        showToast("已刪除", "info");
      });
    });
  }

  /**
   * @param {object} rule
   * @param {{ compact?: boolean, tint?: number, extra?: string, mode?: string, hasSpan?: boolean|null }} opts
   *   hasSpan: lookup 模式用；false=未定位顯示「手動定位」，true=顯示「重新定位」
   */
  function ruleCardHtml(
    rule,
    {
      compact = false,
      tint = -1,
      extra = "",
      mode = "notebook",
      hasSpan = null,
      generatedIdx = null,
    } = {}
  ) {
    const isSupp =
      tint === "usage" ||
      (typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule));
    const tintClass = isSupp
      ? " rule-card-usage"
      : typeof tint === "number" && tint >= 0
        ? ` rule-card-tint-${tint % 8}`
        : "";
    const colorEdge = isSupp
      ? `<span class="rule-card-color-edge gram-hl-usage" aria-hidden="true" title="補充用法（不句中上色）"></span>`
      : typeof tint === "number" && tint >= 0
        ? `<span class="rule-card-color-edge gram-hl-${tint % 8}" aria-hidden="true"></span>`
        : "";
    const catBadge = rule.category
      ? `<span class="badge ${isSupp ? "badge-usage" : "badge-category"}">${esc(
          rule.category
        )}</span>`
      : "";
    const isLookup = mode === "lookup";
    const isGenerated = generatedIdx != null && Number(generatedIdx) >= 0;
    const effectiveHasSpan = isSupp ? null : hasSpan;
    const unlocatedBadge =
      isLookup && effectiveHasSpan === false
        ? `<span class="badge badge-api-fallback">句中未定位</span>`
        : "";
    const missingBadge = isGenerated
      ? `<span class="badge badge-missing">尚未收錄</span>`
      : "";
    const badgesHtml = [catBadge, missingBadge, unlocatedBadge].filter(Boolean).join("");
    const locateBtn =
      isLookup && effectiveHasSpan !== null
        ? effectiveHasSpan === false
          ? `<button type="button" class="btn btn-sm btn-primary" data-locate-rule="${esc(
              rule.id
            )}" title="在句中選取片段，為此規則上色">手動定位</button>`
          : `<button type="button" class="btn btn-sm btn-secondary" data-locate-rule="${esc(
              rule.id
            )}" title="重新指定句中片段（可疊加位置）">重新定位</button>`
        : "";
    if (compact) {
      return `
        <div class="rule-card compact${tintClass}" id="rule-${esc(rule.id)}">
          ${colorEdge}
          <div class="rule-card-top">
            <h4>${esc(rule.title)}</h4>
            ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
          </div>
          <div class="rule-card-actions">
            <button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(rule.id)}">編輯</button>
            ${locateBtn}
            ${
              isLookup
                ? `<button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
                    rule.id
                  )}" title="從本句結果移除，不刪除筆記本規則">本句移除</button>`
                : ""
            }
          </div>
        </div>`;
    }
    const actions = isGenerated
      ? `<button type="button" class="btn btn-sm btn-primary" data-save-draft-idx="${esc(
          String(generatedIdx)
        )}" title="把這張生成卡寫入筆記本，並套用到本句">收入筆記本</button>
          <button type="button" class="btn btn-sm btn-secondary" data-create-inv-idx="${esc(
            String(generatedIdx)
          )}" title="先開表單核對再建立">編輯後建立</button>
          <button type="button" class="btn btn-sm btn-secondary" data-add-todo-idx="${esc(
            String(generatedIdx)
          )}">加入待辦</button>
          <button type="button" class="btn btn-sm btn-ghost" data-dismiss-inv-idx="${esc(
            String(generatedIdx)
          )}" title="從本句結果移除（不刪筆記本）">本句忽略</button>`
      : isLookup
      ? `<button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(rule.id)}">編輯</button>
          ${locateBtn}
          <button type="button" class="btn btn-sm btn-danger-ghost" data-detach-rule="${esc(
            rule.id
          )}" title="從本句結果移除高亮與規則卡，不刪除筆記本中的規則">本句移除</button>`
      : `<button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(rule.id)}">編輯</button>
          <button type="button" class="btn btn-sm btn-danger-ghost" data-delete="${esc(rule.id)}">刪除</button>`;
    return `
      <article class="rule-card${tintClass}" id="rule-${esc(rule.id)}">
        ${colorEdge}
        <div class="rule-card-top">
          <h3>${esc(rule.title)}</h3>
          ${badgesHtml ? `<span class="rule-card-badges">${badgesHtml}</span>` : ""}
        </div>
        ${
          rule.structure
            ? `<div class="field-block structure-block"><h4>結構</h4>${structureFormulaHtml(rule.structure)}</div>`
            : ""
        }
        ${
          rule.explanation
            ? `<div class="field-block"><h4>說明</h4><p class="explanation-text">${esc(rule.explanation)}</p></div>`
            : rule.structure
              ? ""
              : `<p class="muted">（尚無說明）</p>`
        }
        ${extra}
        <div class="rule-card-actions">
          ${actions}
        </div>
      </article>`;
  }

  /* —— Todos —— */
  function todoKey(title) {
    return RulesService.normalizeToken(title);
  }

  function addTodosFromItems(items, sourceQuery) {
    const todos = Storage.loadTodos();
    let added = 0;
    let skipped = 0;
    for (const it of items) {
      const title = (it.name || it.title || "").trim();
      if (!title) continue;
      const key = todoKey(title);
      if (todos.some((t) => !t.done && todoKey(t.title) === key)) {
        skipped++;
        continue;
      }
      // 已有規則則跳過
      const match =
        typeof RulesService.findInventoryRule === "function"
          ? RulesService.findInventoryRule(it)
          : RulesService.findMatchingRule(it);
      if (match.owned) {
        skipped++;
        continue;
      }
      todos.unshift({
        id:
          crypto.randomUUID?.() ||
          "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
        title,
        category: it.category || "",
        span: it.span || "",
        sourceQuery: sourceQuery || "",
        done: false,
        created_at: new Date().toISOString(),
      });
      added++;
    }
    Storage.saveTodos(todos);
    return { added, skipped };
  }

  function addTodoSingle(item, sourceQuery) {
    return addTodosFromItems([item], sourceQuery);
  }

  function renderTodos() {
    // 只顯示未完成；勾選完成會直接刪除。清掉舊的 done 項目。
    const allTodos = Storage.loadTodos();
    const todos = allTodos.filter((t) => !t.done);
    if (todos.length !== allTodos.length) {
      Storage.saveTodos(todos);
    }
    const box = $("#todos-list");
    if (!box) return;
    if (!todos.length) {
      box.innerHTML = `<div class="empty-state"><p>待辦清單是空的。<br/>在 API 查詢中把「尚未收錄」的文法加入即可。</p></div>`;
      return;
    }
    box.innerHTML = `
      <ul class="todo-list">
        ${todos
          .map(
            (t) => `
          <li class="todo-item" data-id="${esc(t.id)}">
            <label>
              <input type="checkbox" data-toggle title="完成並移出清單" />
              <span>
                <strong>${esc(t.title)}</strong>
                ${t.category ? `<span class="tag">${esc(t.category)}</span>` : ""}
                ${
                  t.sourceQuery
                    ? `<div class="muted" style="font-size:0.82rem">來自：${esc(t.sourceQuery)}</div>`
                    : ""
                }
              </span>
            </label>
            <div class="todo-actions">
              <button type="button" class="btn btn-sm btn-primary" data-create>建立規則</button>
              <button type="button" class="btn btn-sm btn-ghost" data-remove>刪除</button>
            </div>
          </li>`
          )
          .join("")}
      </ul>`;

    box.querySelectorAll(".todo-item").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("[data-toggle]")?.addEventListener("change", (e) => {
        if (!e.target.checked) return;
        // 完成 → 直接從清單移除
        Storage.saveTodos(Storage.loadTodos().filter((t) => t.id !== id));
        renderTodos();
        showToast("已完成並移出待辦", "success");
      });
      li.querySelector("[data-remove]")?.addEventListener("click", () => {
        Storage.saveTodos(Storage.loadTodos().filter((t) => t.id !== id));
        renderTodos();
        showToast("已刪除待辦", "info");
      });
      li.querySelector("[data-create]")?.addEventListener("click", () => {
        const item = Storage.loadTodos().find((t) => t.id === id);
        if (!item) return;
        const pending = captureInventoryPendingByTitle(item.title);
        if (pending) state.pendingCreateFromInventory = pending;
        // 新規則只帶名稱（其餘由使用者／AI 自動填寫再補）
        openForm(null, {
          todoId: item.id,
          title: item.title,
          category: item.category || pending?.category || "",
          fromInventory: Boolean(pending),
          banner: `<strong>由待辦建立</strong> — ${esc(item.title)}（儲存後會自動移出待辦）`,
        });
      });
    });
  }

  /* —— Lookup —— */

  /**
   * 依句中首次出現位置排序命中規則，並指定與著色相同的 colorIndex（0–7）
   * 句中有標記的在前（左→右）；其餘命中依分數排在後
   */
  function orderHitsWithColors(hits, spans) {
    const firstPos = new Map();
    for (const s of spans || []) {
      if (!s?.ruleId) continue;
      const prev = firstPos.get(s.ruleId);
      if (prev == null || s.start < prev) firstPos.set(s.ruleId, s.start);
    }

    const hitById = new Map(hits.map((h) => [h.rule.id, h]));

    // 1) 句中有 span 的規則：依 start 左→右
    const spanRuleIds = [...firstPos.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

    const ordered = [];
    const seen = new Set();

    for (const id of spanRuleIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (hitById.has(id)) {
        ordered.push(hitById.get(id));
      } else {
        // 有著色但 search 未列入時，補一張最小命中項
        const rule = RulesService.getById(id);
        if (rule) {
          ordered.push({
            rule,
            score: 1,
            notes: ["句中標記"],
            matchedNeedles: [],
          });
        }
      }
    }

    // 2) 其餘命中（無 span）：依分數
    const rest = hits
      .filter((h) => !seen.has(h.rule.id))
      .sort((a, b) => b.score - a.score);
    for (const h of rest) {
      seen.add(h.rule.id);
      ordered.push(h);
    }

    const colorByRule = new Map();
    ordered.forEach((h, i) => {
      colorByRule.set(h.rule.id, i % 8);
    });

    return {
      orderedHits: ordered.map((h, i) => ({
        ...h,
        colorIndex: i % 8,
        order: i + 1,
      })),
      colorByRule,
    };
  }

  function localMatchesHtml(orderedHits, inventory) {
    if (!orderedHits.length) {
      const hasGrammar = Array.isArray(inventory?.items) && inventory.items.length;
      if (!hasGrammar) return "";
      return `
      <section class="panel" id="lookup-owned-rules">
        <div class="panel-head">
          <h3>已收錄的規則</h3>
          <span class="badge badge-local">0 筆</span>
        </div>
        <p class="panel-note">本句尚無已套用的筆記本規則。可在上方<strong>選取文字</strong>後「套用規則」手動加上。</p>
      </section>`;
    }
    return `
      <section class="panel" id="lookup-owned-rules">
        <div class="panel-head">
          <h3>已收錄的規則</h3>
          <span class="badge badge-local">${orderedHits.length} 筆 · 與句中同色</span>
        </div>
        <p class="panel-note lookup-edit-hint">已掛上的筆記本規則即使句中未定位也會留卡。操作列：編輯 · 手動定位／重新定位 · 本句移除。選字可套用／疊加規則。<strong>補充用法</strong>為琥珀標、固定在後、不句中上色。</p>
        <div class="match-list">
          ${orderedHits
            .map((h) => {
              const isSupp =
                h.supplementary ||
                h.colorIndex === "usage" ||
                (typeof RulesService.isSupplementaryUsage === "function" &&
                  RulesService.isSupplementaryUsage(h.rule));
              const color = isSupp ? "usage" : h.colorIndex ?? 0;
              const unlocated = !isSupp && h.hasSpan === false;
              const colorKey = `<div class="match-color-key" style="margin:0.35rem 0 0.15rem">
                <span class="legend-swatch gram-hl gram-hl-${color}"></span>
                <span class="muted" style="font-size:0.85rem">${
                  isSupp
                    ? "補充用法 · 不句中上色"
                    : unlocated
                    ? "句中未定位 — 用下方「手動定位」"
                    : `句中第 ${h.order ?? "—"} 色`
                }</span>
              </div>`;
              return ruleCardHtml(h.rule, {
                mode: "lookup",
                tint: color,
                // false → 手動定位；true → 重新定位；null → 不顯示（補充用法）
                hasSpan: isSupp ? null : h.hasSpan === true,
                extra:
                  colorKey +
                  (h.notes?.length > 0
                    ? `<p class="muted" style="font-size:0.85rem;margin-top:0.25rem">命中：${esc(h.notes.join(" · "))}</p>`
                    : ""),
              });
            })
            .join("")}
        </div>
      </section>`;
  }

  /**
   * 依 API 盤點結果：
   * - 已收錄 → 句中多彩上色（0–7）+ 規則卡
   * - 未收錄 → 不進句中上色，只在下方列表
   */
  /** 解析 inventory 項目對應的本地規則（支援手動指定 manualRuleId） */
  function resolveInventoryRule(it) {
    if (it?.manualRuleId) {
      const r = RulesService.getById(it.manualRuleId);
      if (r) return { owned: true, rule: r, score: 100, manual: true };
    }
    if (it?.localRuleId) {
      const r = RulesService.getById(it.localRuleId);
      if (r) return { owned: true, rule: r, score: 100, manual: false };
    }
    const match =
      typeof RulesService.findInventoryRule === "function"
        ? RulesService.findInventoryRule(it)
        : RulesService.findMatchingRule(it);
    if (match?.owned && match.rule && it && !it.manualRuleId) {
      const title = String(match.rule.title || "").trim();
      if (title) {
        it.name = title;
        if (typeof RulesService.parseBilingualTitle === "function") {
          const p = RulesService.parseBilingualTitle(title);
          if (p.zh) it.nameZh = p.zh;
          if (p.ko) it.nameKo = p.ko;
        }
      }
    }
    return { ...match, manual: false };
  }

  /** 在原文中定位項目；手動指定 start/end 時優先使用 */
  function locateInventoryItemInText(src, it, tokens) {
    const text = String(src || "");
    const start = Number(it?.start);
    const end = Number(it?.end);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= text.length
    ) {
      const slice = text.slice(start, end);
      // 母音縮約：拒絕 API 給的錯區間（如 게／줘）當座標；手動定位／手動套用除外
      if (it.source !== "manual" && !it.manualRuleId && !it.locatedManually) {
        const form =
          typeof RulesService.extractVowelContractionForm === "function"
            ? RulesService.extractVowelContractionForm(
                it.name,
                it.nameKo,
                it.nameZh,
                it.span
              )
            : "";
        if (
          form &&
          typeof RulesService.isValidVowelSurface === "function" &&
          !RulesService.isValidVowelSurface(form, slice) &&
          !RulesService.isValidVowelSurface(form, it.span)
        ) {
          // 改走合法表面搜尋
          if (RulesService.locateApiItemInText) {
            return RulesService.locateApiItemInText(text, it, tokens);
          }
          return [];
        }
      }
      const loc = {
        start,
        end,
        text: slice,
        needle: String(it.span || slice),
        fusionNote: "",
      };
      const bypassGate = it.source === "manual" || it.locatedManually;
      if (
        !bypassGate &&
        typeof AffixGate !== "undefined" &&
        AffixGate.accept
      ) {
        const owned =
          it.manualRuleId && RulesService.getById
            ? { owned: true, rule: RulesService.getById(it.manualRuleId) }
            : RulesService.findInventoryRule
              ? RulesService.findInventoryRule(it)
              : RulesService.findMatchingRule
                ? RulesService.findMatchingRule(it)
              : { rule: null };
        const rule = owned && owned.rule ? owned.rule : null;
        const profile = AffixGate.inferProfile(rule, it);
        if (profile && !AffixGate.accept(text, loc, profile, { item: it, tokens })) {
          if (RulesService.locateApiItemInText) {
            return RulesService.locateApiItemInText(text, it, tokens);
          }
          return [];
        }
      }
      return [loc];
    }
    if (RulesService.locateApiItemInText) {
      return RulesService.locateApiItemInText(text, it, tokens);
    }
    return [];
  }

  function buildApiHighlight(query, inventory) {
    const src = String(query || "");
    const rawItems = inventory?.items || [];
    // 舊歷史快照可能尚未保存 kiwiKind；用現有 token 重新附上精確區間的
    // 高信心形態見證，讓重新開啟舊句時也能套用最新的防錯配規則。
    const morphCandidates =
      Array.isArray(inventory?.tokens) &&
      inventory.tokens.length &&
      typeof KoParse !== "undefined" &&
      typeof KoParse.deterministicFunctions === "function"
        ? KoParse.deterministicFunctions(src, inventory.tokens)
        : [];
    const witnessedItems = rawItems.map((it) => {
      if (it?.kiwiKind) return it;
      const witness = morphCandidates.find(
        (c) =>
          !c.needsDisambiguation &&
          Number.isFinite(Number(it?.tokenFrom)) &&
          Number.isFinite(Number(it?.tokenTo)) &&
          Number(c.tokenFrom) === Number(it.tokenFrom) &&
          Number(c.tokenTo) === Number(it.tokenTo)
      );
      return witness ? { ...it, kiwiKind: witness.kiwiKind } : it;
    });
    const items =
      typeof KoParse !== "undefined" && KoParse.narrowItemToMarker
        ? witnessedItems.map((it) => KoParse.narrowItemToMarker(src, it, inventory?.tokens))
        : witnessedItems;
    const spans = [];
    const legend = [];
    const ownedHits = [];
    const missingItems = [];
    let colorIdx = 0;
    const colorByRule = new Map();
    const ownedSeen = new Set();
    const vocabLocsForMan = locateVocabInText(src, inventory?.vocab);
    let ownedPointCount = 0;
    let rejectedCount = Number(inventory?.apiRejectedCount) || 0;
    const unresolvedCount = Number(inventory?.unresolvedGrammarCount) || 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const match = resolveInventoryRule(it);
      let owned = Boolean(match.owned && match.rule);
      const isSuppEarly =
        (typeof RulesService.isSupplementaryUsage === "function" &&
          (RulesService.isSupplementaryUsage(match.rule) ||
            RulesService.isSupplementaryUsage(it))) ||
        it.source === "manual" ||
        Boolean(it.manualRuleId);
      const witness =
        !isSuppEarly &&
        it.source !== "manual" &&
        !it.locatedManually &&
        typeof RulesService.morphWitness === "function"
          ? RulesService.morphWitness(src, it, match.rule, inventory?.tokens)
          : "none";
      if (witness === "miss") {
        rejectedCount += 1;
        continue;
      }

      // API 偶爾會把同形語尾誤對到某張詞彙／特定用法卡；若卡名中的
      // 完整韓語詞根本不在原句，整項視為誤報，不列已收錄也不列缺失。
      // 使用者從「尚未收錄」建立／手動套用的項目不要再用這道閘丟掉。
      if (
        owned &&
        match.rule &&
        it.source !== "manual" &&
        !it.manualRuleId &&
        !it.locatedManually &&
        typeof RulesService.ruleHasLiteralSurfaceWitness === "function" &&
        !RulesService.ruleHasLiteralSurfaceWitness(match.rule, src)
      ) {
        rejectedCount += 1;
        continue;
      }

      // 母音縮約：句中無該系合法表面（해／해요／보여／돼…）→ 視為 API 誤報，整項捨棄
      // 僅使用者手動套用可例外；Kiwi 自動掛上的 manualRuleId 仍要過這關。
      if (
        owned &&
        match.rule &&
        it.source !== "manual" &&
        !it.locatedManually &&
        typeof RulesService.isVowelContractionRule === "function" &&
        RulesService.isVowelContractionRule(match.rule)
      ) {
        const form =
          typeof RulesService.extractVowelContractionForm === "function"
            ? RulesService.extractVowelContractionForm(
                match.rule.title,
                match.rule.structure
              )
            : "";
        // 句中有該系表面，或 API span 本身是合法表面（속삭여／속삭여줘）
        const hasSurf =
          form &&
          ((typeof RulesService.sentenceHasVowelSurface === "function" &&
            RulesService.sentenceHasVowelSurface(src, form)) ||
            (it.span &&
              typeof RulesService.isValidVowelSurface === "function" &&
              RulesService.isValidVowelSurface(form, it.span)));
        if (!hasSurf) {
          rejectedCount += 1;
          continue;
        }
      }

      if (!owned) {
        missingItems.push({ it, invIdx: i });
        const isSuppMiss =
          typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(it);
        if (!isSuppMiss) {
          const foundMiss = locateInventoryItemInText(src, it, inventory?.tokens);
          const prevMiss = legend.find((h) => !h.owned && h.name === it.name);
          if (prevMiss) {
            if (foundMiss.length) prevMiss.hasSpan = true;
          } else {
            legend.push({
              invIdx: i,
              name: it.name,
              owned: false,
              ruleId: "",
              ruleTitle: it.name,
              color: "missing",
              hasSpan: foundMiss.length > 0,
              supplementary: false,
            });
          }
          for (const loc of foundMiss) {
            spans.push({
              start: loc.start,
              end: loc.end,
              text: loc.text,
              ruleId: `missing-${i}`,
              ruleTitle: it.name,
              missing: true,
              color: "missing",
              apiName: it.name,
              invIdx: i,
              needle: loc.needle || it.span || it.nameKo || "",
              fusionNote: loc.fusionNote || "",
            });
          }
        }
        continue;
      }

      const rule = match.rule;
      const isSupp =
        typeof RulesService.isSupplementaryUsage === "function" &&
        RulesService.isSupplementaryUsage(rule);
      let color;
      if (isSupp) {
        color = "usage";
      } else {
        if (!colorByRule.has(rule.id)) {
          colorByRule.set(rule.id, colorIdx % 8);
          colorIdx += 1;
        }
        color = colorByRule.get(rule.id);
      }

      const hadDirectCoords =
        Number.isFinite(Number(it.start)) &&
        Number.isFinite(Number(it.end)) &&
        Number(it.end) > Number(it.start);
      if (
        it.source !== "manual" &&
        !it.manualRuleId &&
        !it.locatedManually &&
        typeof RulesService.eulFrameWitness === "function" &&
        RulesService.eulFrameWitness(src, match.rule || it) === "miss"
      ) {
        rejectedCount += 1;
        continue;
      }
      let found = isSupp ? [] : locateInventoryItemInText(src, it, inventory?.tokens);
      if (
        found.length &&
        typeof RulesService.filterHitsAgainstVocab === "function"
      ) {
        found = RulesService.filterHitsAgainstVocab(src, found, rule, vocabLocsForMan);
      }
      // 誤把詞中 만（가만히）當限定助詞：定位不到就整項丟掉（手動套用除外）
      if (
        !found.length &&
        it.source !== "manual" &&
        !it.locatedManually &&
        typeof RulesService.isLimitManParticleRule === "function" &&
        RulesService.isLimitManParticleRule(rule)
      ) {
        rejectedCount += 1;
        continue;
      }
      // 本地自動掃到、句中卻定位不到 → 不當「本句文法」（避免 듯이／고 싶다 等灌進圖例）
      if (
        !found.length &&
        it.source === "local" &&
        !it.locatedManually &&
        !it.manualRuleId
      ) {
        rejectedCount += 1;
        continue;
      }
      // 已掛上本地卡：句中未定位仍顯示卡（標「句中未定位」），不再整張丟掉。

      ownedPointCount += 1;

      // 同一規則只一則圖例；任一定位成功即 hasSpan
      const prevLeg = legend.find((h) => h.ruleId === rule.id);
      if (prevLeg) {
        if (found.length) prevLeg.hasSpan = true;
      } else {
        legend.push({
          invIdx: i,
          name: it.name,
          owned: true,
          ruleId: rule.id,
          ruleTitle: rule.title,
          color,
          hasSpan: found.length > 0,
          supplementary: isSupp,
        });
      }

      if (!ownedSeen.has(rule.id)) {
        ownedSeen.add(rule.id);
        const noteSrc =
          it.source === "manual"
            ? "手動"
            : it.source === "local"
              ? "本地"
              : match.manual
                ? "手動"
                : "API";
        ownedHits.push({
          rule,
          score: 10,
          notes: [`${noteSrc}：${it.name}${it.span ? ` · 「${it.span}」` : ""}`],
          matchedNeedles: it.span ? [it.span] : [],
          colorIndex: isSupp ? "usage" : color,
          order: ownedHits.length + 1,
          hasSpan: isSupp ? null : found.length > 0,
          supplementary: isSupp,
        });
      } else {
        const hit = ownedHits.find((h) => h.rule.id === rule.id);
        if (hit) {
          if (found.length && !isSupp) hit.hasSpan = true;
          if (it.span && !hit.notes.some((n) => n.includes(`「${it.span}」`))) {
            hit.notes.push(`片段：「${it.span}」`);
          }
        }
      }

      // 補充用法：不句中上色
      if (isSupp) continue;

      for (const loc of found) {
        spans.push({
          start: loc.start,
          end: loc.end,
          text: loc.text,
          ruleId: rule.id,
          ruleTitle: rule.title,
          missing: false,
          color,
          apiName: it.name,
          invIdx: i,
          needle: loc.needle || it.span || it.nameKo || "",
          fusionNote: loc.fusionNote || "",
        });
      }
    }

    // 圖例依句中出現順序（有 span 的優先），其餘依 API 順序；補充用法最後
    const firstPos = new Map();
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      const prev = firstPos.get(s.ruleId);
      if (prev == null || s.start < prev) firstPos.set(s.ruleId, s.start);
    }
    for (const h of legend) {
      if (h.supplementary || !h.owned) continue;
      if (!h.hasSpan && firstPos.has(h.ruleId)) h.hasSpan = true;
    }
    ownedHits.forEach((h) => {
      if (!h.supplementary && firstPos.has(h.rule.id)) h.hasSpan = true;
    });
    legend.sort((a, b) => {
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      const aOwned = Boolean(a.owned);
      const bOwned = Boolean(b.owned);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      if (Boolean(a.hasSpan) !== Boolean(b.hasSpan)) return a.hasSpan ? -1 : 1;
      const pa = a.ruleId && firstPos.has(a.ruleId) ? firstPos.get(a.ruleId) : 1e9;
      const pb = b.ruleId && firstPos.has(b.ruleId) ? firstPos.get(b.ruleId) : 1e9;
      if (pa !== pb) return pa - pb;
      return a.invIdx - b.invIdx;
    });
    const recolor = new Map();
    let ci = 0;
    for (const h of legend) {
      if (!h.owned || !h.ruleId) continue;
      if (h.supplementary || h.color === "usage") {
        h.color = "usage";
        continue;
      }
      if (!recolor.has(h.ruleId)) {
        recolor.set(h.ruleId, ci % 8);
        ci += 1;
      }
      h.color = recolor.get(h.ruleId);
    }
    for (const s of spans) {
      if (s.missing || s.color === "missing" || s.color === "usage") continue;
      if (recolor.has(s.ruleId)) s.color = recolor.get(s.ruleId);
    }
    ownedHits.forEach((h) => {
      if (h.supplementary) {
        h.colorIndex = "usage";
        return;
      }
      if (recolor.has(h.rule.id)) {
        h.colorIndex = recolor.get(h.rule.id);
      }
    });
    ownedHits.sort((a, b) => {
      if (Boolean(a.supplementary) !== Boolean(b.supplementary)) {
        return a.supplementary ? 1 : -1;
      }
      const ca = typeof a.colorIndex === "number" ? a.colorIndex : 999;
      const cb = typeof b.colorIndex === "number" ? b.colorIndex : 999;
      return ca - cb;
    });
    ownedHits.forEach((h, i) => {
      h.order = i + 1;
    });

    return {
      spans,
      legend,
      colorByRule: recolor,
      ownedHits,
      missingItems,
      audit: {
        total: ownedPointCount + missingItems.length,
        owned: ownedPointCount,
        missing: missingItems.length,
        rejected: rejectedCount,
        unresolved: unresolvedCount,
        repairUsed: Boolean(inventory?.apiRepairUsed),
      },
    };
  }

  /**
   * 將 API vocab 對到原文區間（優先 a/b，否則 surface 搜尋）
   * @returns {{ start:number, end:number, lemma:string, gloss:string, pos:string, surface:string }[]}
   */
  function normVocabKey(s) {
    return String(s || "")
      .trim()
      .normalize("NFC")
      .toLowerCase();
  }

  function sliceMatchesVocab(slice, w) {
    const sl = normVocabKey(slice);
    if (!sl) return false;
    const surf = normVocabKey(w.surface);
    const lem = normVocabKey(w.lemma);
    if ((surf && sl === surf) || (lem && sl === lem)) return true;
    const alts =
      typeof Storage.pronounAlts === "function"
        ? [...Storage.pronounAlts(surf), ...Storage.pronounAlts(lem)]
        : [];
    return alts.includes(sl);
  }

  /**
   * 將 API vocab 對到原文區間。
   * - 不信任與 surface 不符的 a/b
   * - 純單詞查詢：整段對到最吻合的一筆
   */
  function locateVocabInText(text, vocabList) {
    const src = String(text || "");
    const list = Array.isArray(vocabList) ? vocabList : [];
    if (!src || !list.length) return [];

    const candidates = list
      .map((w) => ({
        surface: String(w.surface || "").trim(),
        lemma: String(w.lemma || "").trim(),
        gloss: String(w.gloss || "").trim(),
        pos: String(w.pos || "").trim(),
        start: w.start,
        end: w.end,
      }))
      .filter((w) => w.surface || w.lemma);

    const trimStart = src.search(/\S/);
    const qCore = src.trim();
    const qNorm = normVocabKey(qCore);
    const isSingleWord = qCore.length > 0 && !/\s/.test(qCore);

    function hitFrom(w, start, end) {
      return {
        start,
        end,
        lemma: w.lemma || src.slice(start, end),
        gloss: w.gloss,
        pos: w.pos,
        surface: src.slice(start, end),
      };
    }

    if (isSingleWord && qNorm) {
      let best = null;
      let bestScore = -1;
      for (const w of candidates) {
        const surf = normVocabKey(w.surface);
        const lem = normVocabKey(w.lemma);
        let sc = 0;
        if (surf && surf === qNorm) sc = 100;
        else if (lem && lem === qNorm) sc = 90;
        else if (surf && (qNorm.includes(surf) || surf.includes(qNorm)) && Math.min(surf.length, qNorm.length) >= 2)
          sc = 50;
        else if (lem && (qNorm.includes(lem) || lem.includes(qNorm)) && Math.min(lem.length, qNorm.length) >= 2)
          sc = 40;
        if (sc > bestScore) {
          bestScore = sc;
          best = w;
        }
      }
      if (!best && candidates.length === 1) {
        best = candidates[0];
        bestScore = 40;
      }
      if (best && bestScore >= 30) {
        const start = trimStart >= 0 ? trimStart : 0;
        const end = start + qCore.length;
        return [hitFrom(best, start, end)];
      }
    }

    const occupied = [];
    const hits = [];
    const ordered = candidates
      .slice()
      .sort((a, b) => (b.surface || b.lemma || "").length - (a.surface || a.lemma || "").length);

    function clashes(start, end) {
      return occupied.some((o) => !(end <= o.start || start >= o.end));
    }

    function findInSrc(needle) {
      if (!needle) return null;
      let from = 0;
      while (from < src.length) {
        const idx = src.indexOf(needle, from);
        if (idx < 0) return null;
        const e = idx + needle.length;
        if (!clashes(idx, e)) return { start: idx, end: e };
        from = idx + Math.max(1, needle.length);
      }
      return null;
    }

    for (const w of ordered) {
      let start = Number(w.start);
      let end = Number(w.end);
      let placed = false;
      const rangeOk =
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start &&
        end <= src.length;

      if (rangeOk && !clashes(start, end) && sliceMatchesVocab(src.slice(start, end), w)) {
        placed = true;
      }

      if (!placed) {
        const needles = [w.surface, w.lemma].filter(Boolean);
        if (typeof Storage.pronounAlts === "function") {
          for (const n of [w.surface, w.lemma].filter(Boolean)) {
            Storage.pronounAlts(n).forEach((a) => {
              if (!needles.includes(a)) needles.push(a);
            });
          }
        }
        needles.sort((a, b) => b.length - a.length);
        for (const n of needles) {
          if (n.length < 1) continue;
          const loc = findInSrc(n);
          if (loc) {
            start = loc.start;
            end = loc.end;
            placed = true;
            break;
          }
        }
      }
      if (!placed) continue;
      occupied.push({ start, end });
      hits.push(hitFrom(w, start, end));
    }

    hits.sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
    return hits;
  }

  /** 把對上的 start/end 寫回 vocab，避免下次打開只剩錯的 a/b 或空座標 */
  function writeBackVocabLocations(query, vocabList) {
    const list = Array.isArray(vocabList) ? vocabList.slice() : [];
    if (!list.length) return list;
    const locs = locateVocabInText(query, list);
    const used = new Set();
    for (const loc of locs) {
      let idx = list.findIndex((w, i) => {
        if (used.has(i)) return false;
        const a = Number(w.start);
        const b = Number(w.end);
        if (Number.isFinite(a) && Number.isFinite(b) && a === loc.start && b === loc.end) {
          return true;
        }
        return false;
      });
      if (idx < 0) {
        idx = list.findIndex((w, i) => {
          if (used.has(i)) return false;
          const surf = String(w.surface || "").trim();
          const lem = String(w.lemma || "").trim();
          return surf === loc.surface || lem === loc.lemma || surf === loc.lemma || lem === loc.surface;
        });
      }
      if (idx < 0) continue;
      used.add(idx);
      list[idx] = {
        ...list[idx],
        start: loc.start,
        end: loc.end,
        surface: loc.surface || list[idx].surface,
        lemma: loc.lemma || list[idx].lemma,
        gloss: loc.gloss || list[idx].gloss,
        pos: loc.pos || list[idx].pos,
      };
    }
    return list;
  }

  /** 文法 mark 開標籤 HTML */
  function grammarMarkOpenHtml(s) {
    const tipOf = (h) =>
      h.fusionNote
        ? `${h.ruleTitle} · ${h.fusionNote}`
        : h.needle
          ? `${h.ruleTitle} ← ${h.needle}`
          : h.ruleTitle || h.apiName || "";
    const stack = [
      {
        color: s.color,
        ruleId: s.ruleId,
        ruleTitle: s.ruleTitle,
        needle: s.needle,
        fusionNote: s.fusionNote,
        missing: s.missing,
      },
      ...(s.coHits || []),
    ].filter((h) => h && h.color !== "usage");
    const owned = stack.filter(
      (h) => !h.missing && h.color !== "missing" && Number.isFinite(Number(h.color))
    );
    const use = owned.length ? owned : stack;
    const first = use[0] || s;
    const multi = use.length > 1 && use.every((h) => Number.isFinite(Number(h.color)));
    const tip = multi
      ? use.map((h, i) => `${i + 1}. ${tipOf(h)}`).join(" ｜ ") + "（顏色輪播）"
      : first.missing || first.color === "missing"
        ? `尚未建立：${tipOf(first)}`
        : tipOf(first);
    const cls =
      first.missing || first.color === "missing"
        ? "gram-hl gram-hl-missing"
        : `gram-hl gram-hl-${first.color ?? 0}${multi ? " gram-hl-cycle" : ""}`;
    const colorsAttr = multi ? ` data-cycle-colors="${use.map((h) => h.color).join(",")}"` : "";
    const titlesAttr = multi
      ? ` data-cycle-titles="${esc(use.map((h) => tipOf(h)).join("\n"))}"`
      : "";
    const scrollAttr =
      !first.missing && first.color !== "missing" && first.ruleId
        ? ` data-scroll-rule="${esc(first.ruleId)}" data-rule-id="${esc(first.ruleId)}"`
        : "";
    const cycleIds = multi
      ? ` data-cycle-rule-ids="${use.map((h) => h.ruleId || "").join(",")}"`
      : "";
    return `<mark class="${cls}" title="${esc(tip)}"${colorsAttr}${titlesAttr}${scrollAttr}${cycleIds}>`;
  }

  /** 單字庫詞性 → 底線色類（動詞淺藍／名詞淺綠／形容詞黃／副詞紅／其他紫） */
  function posUnderlineKind(pos) {
    const p = String(pos || "");
    if (/助動詞|助詞|語尾/.test(p)) return "other";
    if (/形容詞|形容動詞|adjective|\badj\b/i.test(p)) return "adj";
    if (/副詞|adverb/i.test(p)) return "adv";
    if (/動詞|verb/i.test(p)) return "verb";
    if (/名詞|noun/i.test(p)) return "noun";
    return "other";
  }

  const POS_UL_KINDS = ["verb", "noun", "adj", "adv", "other"];
  const POS_UL_LABELS = {
    verb: "動詞",
    noun: "名詞",
    adj: "形容詞",
    adv: "副詞",
    other: "其他",
  };
  const POS_UL_STORAGE_KEY = "kgn_pos_underline_hidden";

  function loadPosUnderlineHidden() {
    try {
      const raw = JSON.parse(localStorage.getItem(POS_UL_STORAGE_KEY) || "{}");
      const out = {};
      for (const k of POS_UL_KINDS) out[k] = Boolean(raw?.[k]);
      return out;
    } catch {
      return { verb: false, noun: false, adj: false, adv: false, other: false };
    }
  }

  function posHideToken(hidden) {
    return POS_UL_KINDS.filter((k) => hidden[k]).join(" ");
  }

  function sentenceBoardPosHideAttr() {
    const v = posHideToken(loadPosUnderlineHidden());
    return v ? ` data-pos-hide="${esc(v)}"` : "";
  }

  function applyPosUnderlineVisibility() {
    const hidden = loadPosUnderlineHidden();
    const board = $("#sentence-board");
    if (board) {
      const v = posHideToken(hidden);
      if (v) board.setAttribute("data-pos-hide", v);
      else board.removeAttribute("data-pos-hide");
    }
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    document.querySelectorAll("[data-pos-toggle]").forEach((btn) => {
      const k = btn.dataset.posToggle;
      if (k === "all") {
        btn.classList.toggle("is-off", allOff);
        btn.classList.toggle("is-mixed", !allOn && !allOff);
        btn.setAttribute("aria-pressed", allOn ? "true" : "false");
        btn.title = allOn ? "關閉全部底線" : "開啟全部底線";
        return;
      }
      const on = !hidden[k];
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = POS_UL_LABELS[k] || "";
      btn.title = `${on ? "隱藏" : "顯示"}${label}底線`;
    });
  }

  function togglePosUnderline(kind) {
    const hidden = loadPosUnderlineHidden();
    if (kind === "all") {
      const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
      const next = {};
      for (const k of POS_UL_KINDS) next[k] = allOn;
      localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(next));
      applyPosUnderlineVisibility();
      return;
    }
    if (!POS_UL_KINDS.includes(kind)) return;
    hidden[kind] = !hidden[kind];
    localStorage.setItem(POS_UL_STORAGE_KEY, JSON.stringify(hidden));
    applyPosUnderlineVisibility();
  }

  function posUnderlineLegendHtml() {
    const hidden = loadPosUnderlineHidden();
    const allOn = POS_UL_KINDS.every((k) => !hidden[k]);
    const allOff = POS_UL_KINDS.every((k) => hidden[k]);
    const allBtn = `<button type="button" class="pos-line-toggle pos-line-toggle-all${
      allOff ? " is-off" : ""
    }${!allOn && !allOff ? " is-mixed" : ""}" data-pos-toggle="all" aria-pressed="${
      allOn ? "true" : "false"
    }" title="${allOn ? "關閉全部底線" : "開啟全部底線"}">全部</button>`;
    const items = POS_UL_KINDS.map((k) => {
      const on = !hidden[k];
      return `<button type="button" class="pos-line-toggle${
        on ? "" : " is-off"
      }" data-pos-toggle="${k}" aria-pressed="${on ? "true" : "false"}" title="${
        on ? "隱藏" : "顯示"
      }${POS_UL_LABELS[k]}底線"><span class="pos-line" data-pos-kind="${k}">${
        POS_UL_LABELS[k]
      }</span></button>`;
    }).join("");
    return `<span class="pos-line-legend" role="group" aria-label="詞性底線，點擊顯示或隱藏">${allBtn}${items}</span>`;
  }

  function wordTipOpenHtml(v) {
    const fallbackTitle = [
      v.lemma ? `原形 ${v.lemma}` : "",
      v.gloss ? `意思 ${v.gloss}` : "",
      v.pos ? `（${v.pos}）` : "",
      v.lemma ? "點擊複製並朗讀原形" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<span class="word-tip" tabindex="0" data-lemma="${esc(v.lemma)}" data-gloss="${esc(
      v.gloss
    )}" data-pos="${esc(v.pos)}" data-pos-kind="${esc(posUnderlineKind(v.pos))}" data-surface="${esc(
      v.surface
    )}" data-tag="${esc(v.tag || "")}" title="${esc(fallbackTitle)}">`;
  }

  /**
   * 文法 used[] + vocab 串流渲染
   * 外層 grammar mark、內層 word-tip，連續同規則不拆開（避免 mark 間假空格）
   */
  function buildAnnotatedSentenceHtml(query, usedGrammar, vocabLocs) {
    const src = String(query || "");
    const n = src.length;
    if (!n) return "";

    const cuts = new Set([0, n]);
    for (const g of usedGrammar || []) {
      cuts.add(g.start);
      cuts.add(g.end);
    }
    for (const v of vocabLocs || []) {
      cuts.add(v.start);
      cuts.add(v.end);
    }
    const points = [...cuts].filter((p) => p >= 0 && p <= n).sort((a, b) => a - b);

    const atoms = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a >= b) continue;
      const g = (usedGrammar || []).find((x) => x.start <= a && x.end >= b) || null;
      const vCands = (vocabLocs || []).filter((x) => x.start <= a && x.end >= b);
      const v =
        vCands.sort(
          (x, y) => x.end - x.start - (y.end - y.start) || y.start - x.start
        )[0] || null;
      atoms.push({ g, v, text: src.slice(a, b) });
    }

    let html = "";
    let openG = null;
    let openV = null;

    const closeV = () => {
      if (openV) {
        html += "</span>";
        openV = null;
      }
    };
    const closeG = () => {
      closeV();
      if (openG) {
        html += "</mark>";
        openG = null;
      }
    };

    for (const at of atoms) {
      if (at.g !== openG) {
        closeG();
        if (at.g) {
          html += grammarMarkOpenHtml(at.g);
          openG = at.g;
        }
      }
      if (at.v !== openV) {
        closeV();
        if (at.v) {
          html += wordTipOpenHtml(at.v);
          openV = at.v;
        }
      }
      html += esc(at.text);
    }
    closeG();
    return html;
  }

  function sentenceBoardHtml(query, spans, colorByRule, orderedHits, options = {}) {
    const isApi = options.source === "api";
    const apiLegend = options.apiLegend || null;
    const vocabList = options.vocab || [];
    const audit = options.audit || null;

    const colorOf = (s) => {
      if (s.missing || s.color === "missing") return "missing";
      if (s.color != null && s.color !== "") return s.color;
      if (colorByRule && s.ruleId && colorByRule.has(s.ruleId)) return colorByRule.get(s.ruleId);
      return 0;
    };

    // 較長優先；已收錄先於未收錄；重疊的其他規則併入 coHits
    const sorted = (spans || []).slice().sort((a, b) => {
      const lenA = (a.end || 0) - (a.start || 0);
      const lenB = (b.end || 0) - (b.start || 0);
      if (lenB !== lenA) return lenB - lenA;
      if (a.start !== b.start) return a.start - b.start;
      const am = a.missing || a.color === "missing" ? 1 : 0;
      const bm = b.missing || b.color === "missing" ? 1 : 0;
      return am - bm;
    });
    const used = [];
    for (const s of sorted) {
      if (s.start >= query.length || s.end > query.length || s.start >= s.end) continue;
      const col = colorOf(s);
      const hit = {
        color: col,
        ruleId: s.ruleId || "",
        ruleTitle: s.ruleTitle || "",
        needle: s.needle || "",
        fusionNote: s.fusionNote || "",
        missing: Boolean(s.missing || s.color === "missing"),
        invIdx: s.invIdx,
      };
      const host = used.find((u) => !(s.end <= u.start || s.start >= u.end));
      if (host) {
        const exists =
          host.ruleId === hit.ruleId ||
          (host.coHits || []).some((c) => c.ruleId === hit.ruleId);
        if (!exists) {
          if (!host.coHits) host.coHits = [];
          host.coHits.push(hit);
        }
        continue;
      }
      used.push({
        start: s.start,
        end: s.end,
        ...hit,
        coHits: [],
      });
    }
    used.sort((a, b) => a.start - b.start);

    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    // 句子上的單字 hover 以 API／單字庫的完整詞彙區間為準，才能保留 gloss。
    // Kiwi 的語素區間可能把活用詞拆成詞幹、語尾，語尾本身沒有意思；
    // 只有 API 單字無法對回原文時，才退回語素 hover。
    const locatedVocab = locateVocabInText(query, vocabList);
    const vocabLocs =
      locatedVocab.length || !tokens.length || typeof KoParse === "undefined" || !KoParse.hoverLocs
        ? locatedVocab
        : KoParse.hoverLocs(tokens, vocabList);
    const html =
      used.length || vocabLocs.length
        ? buildAnnotatedSentenceHtml(query, used, vocabLocs)
        : esc(query);

    // 圖例：已收錄色點 + 未收錄紅標；補充用法改用右側 +補充
    let legend = "";
    const legendItems = (apiLegend || []).filter(
      (h) => !h.supplementary && h.color !== "usage"
    );
    if (legendItems.length) {
      legend = legendItems
        .map((h) => {
          const sw =
            h.color === "missing" || !h.owned
              ? "gram-hl gram-hl-missing"
              : `gram-hl gram-hl-${h.color}`;
          const badge = h.owned
            ? ""
            : `<span class="badge badge-missing-hl">未建立</span>`;
          const btn = h.owned
            ? `<button type="button" class="legend-link" data-scroll-rule="${esc(h.ruleId)}">${esc(
                h.ruleTitle || h.name
              )}</button>`
            : `<button type="button" class="legend-link legend-link-missing" data-create-inv-idx="${h.invIdx}">${esc(
                h.name
              )}</button>`;
          return `
        <li class="legend-item">
          <span class="legend-swatch ${sw}"></span>${btn}${badge}${
            h.owned && !h.hasSpan ? `<span class="legend-count">（句中未定位）</span>` : ""
          }
        </li>`;
        })
        .join("");
    } else if (orderedHits && orderedHits.length) {
      legend = orderedHits
        .filter(
          (h) =>
            !h.supplementary &&
            h.colorIndex !== "usage" &&
            !(
              typeof RulesService.isSupplementaryUsage === "function" &&
              RulesService.isSupplementaryUsage(h.rule)
            )
        )
        .map(
          (h) => `
        <li class="legend-item">
          <span class="legend-swatch gram-hl gram-hl-${h.colorIndex ?? 0}"></span>
          <button type="button" class="legend-link" data-scroll-rule="${esc(h.rule.id)}">${esc(
            h.rule.title
          )}</button>
          ${h.hasSpan === false ? `<span class="legend-count">（未定位）</span>` : ""}
        </li>`
        )
        .join("");
    } else {
      const seen = new Set();
      legend = used
        .filter((s) => {
          if (seen.has(s.ruleId)) return false;
          seen.add(s.ruleId);
          return true;
        })
        .map(
          (s) => `
        <li class="legend-item">
          <span class="legend-swatch gram-hl gram-hl-${s.color}"></span>
          <button type="button" class="legend-link" data-scroll-rule="${esc(s.ruleId || "")}">${esc(
            s.ruleTitle
          )}</button>
        </li>`
        )
        .join("");
    }

    const hasCycle = used.some((u) => (u.coHits || []).length > 0);
    const hasVocab = vocabLocs.length > 0;
    const emptyGrammarNote =
      isApi && !used.length
        ? `<p class="panel-note" style="margin:0.5rem 0 0">尚無可在句中標記的文法（未收錄見下方列表）。${
            hasVocab ? "滑過底線詞可看原形與意思。" : ""
          } 也可按 +補充。</p>`
        : "";
    const editHint = isApi
      ? `<p class="sentence-edit-hint">選取文字或<strong>點已上色片段</strong>可套用／疊加規則；下方規則卡操作列的<strong>手動定位</strong>可指定句中片段。右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>`
      : `<p class="sentence-edit-hint">右側<strong>+補充</strong>可加入不句中上色的補充用法。</p>`;
    const modeLabel = options.fallbackLegacy
      ? "API 標記 · 已回退舊盤點"
      : options.mappingFailed
        ? "形態素切詞 · 對卡未完成"
        : audit?.repairUsed
          ? "API 標記 · 補查完成"
        : tokens.length
          ? "API 標記 · 形態素切詞"
          : isApi
            ? "API 標記"
            : "查詢內容";
    const auditLabel =
      isApi && audit
        ? `<span class="sentence-cycle-hint">文法 ${Number(audit.total) || 0} · 已收錄 ${
            Number(audit.owned) || 0
          } · 未收錄 ${Number(audit.missing) || 0}${
            Number(audit.rejected) > 0 ? ` · 排除候選 ${Number(audit.rejected)}` : ""
          }${
            Number(audit.unresolved) > 0 ? ` · 待確認 ${Number(audit.unresolved)}` : ""
          }</span>`
        : "";

    // 句子 + 色點圖例同框 sticky（父層 lookup-result-stack 須夠高）
    return `
      <div class="sentence-board" id="sentence-board"${sentenceBoardPosHideAttr()}>
        <div id="locate-mode-bar" class="locate-mode-bar hidden" role="status"></div>
        <p class="sentence-label">
          <span class="sentence-label-main">${esc(modeLabel)}</span>
          ${auditLabel}
          ${hasCycle ? `<span class="sentence-cycle-hint">共置輪播</span>` : ""}
          ${hasVocab ? `<span class="sentence-cycle-hint">滑過看原形／語素</span>` : ""}
          ${hasVocab ? posUnderlineLegendHtml() : ""}
        </p>
        ${sentenceTextBlockHtml(html || esc(query))}
        ${editHint}
        ${emptyGrammarNote || ""}
        <ul class="sentence-legend" aria-label="句中規則與補充">
          ${legend}
          <li class="legend-item legend-item-add">
            <button type="button" class="btn-legend-add" data-add-supplementary title="加入補充用法（不句中上色）">+補充</button>
          </li>
        </ul>
        ${options.inventory ? sentenceTranslationHtml(options.inventory) : ""}
      </div>`;
  }

  /**
   * Mirinae 式層列：語節 → 語素 → 角色／句層。
   * 不放進 sticky 句框，避免把句子區撐滿。
   */
  function morphBoardHtml(query, inventory) {
    const tokens = Array.isArray(inventory?.tokens) ? inventory.tokens : [];
    if (!tokens.length || typeof KoParse === "undefined" || !KoParse.analysisModel) return "";
    const model = KoParse.analysisModel(query, tokens, inventory?.vocab, inventory?.items);
    const words = model.words || [];
    if (!words.length) return "";
    const nMorph = words.reduce((n, w) => n + (w.morphs || []).length, 0);
    const chips = words
      .map((w) => {
        const morphs = (w.morphs || [])
          .map((m) => {
            const affix = m.zeroWidth || m.pos === "助詞" || m.pos === "語尾";
            const tip = [m.form, m.pos, m.tag, m.lemma && m.lemma !== m.form ? `原 ${m.lemma}` : "", m.grammarName, m.gloss]
              .filter(Boolean)
              .join(" · ");
            return `<span class="morph-chip${affix ? " is-affix" : " is-content"}" data-pos="${esc(
              m.pos || ""
            )}" title="${esc(tip)}"><span class="morph-chip-form">${esc(
              m.form
            )}</span><span class="morph-chip-role">${esc(m.roleLabel || m.pos || "")}</span></span>`;
          })
          .join("");
        const phrase = w.phrase && w.phrase.role
          ? `<span class="morph-phrase" data-kind="${esc(w.phrase.kind || "")}">${esc(w.phrase.role)}</span>`
          : `<span class="morph-phrase morph-phrase-empty">—</span>`;
        const gloss = w.gloss
          ? `<span class="morph-gloss">${esc(w.gloss)}</span>`
          : `<span class="morph-gloss morph-gloss-empty"></span>`;
        return `<div class="morph-eojeol">
          ${phrase}
          <div class="morph-surface">${esc(w.text)}</div>
          <div class="morph-forms">${morphs}</div>
          ${gloss}
        </div>`;
      })
      .join("");
    return `
      <details class="morph-board" id="morph-board" open>
        <summary class="morph-board-summary" title="展開或收合形態素分析">
          形態素分析
          <span class="morph-board-meta">${words.length} 語節 · ${nMorph} 語素</span>
        </summary>
        <p class="morph-board-hint">上層是語節（空白分開的詞），中層是語素（詞幹／助詞／語尾；받침裡的 ㄴ·ㄹ·ㅆ 也拆開），底層是句層角色。</p>
        <div class="morph-eojeol-row">${chips}</div>
      </details>`;
  }

  /** 原形 tooltip 浮層 */
  let wordTipHideTimer = 0;
  let wordTipSelectArmed = false;
  let wordTipAnchor = null;
  let sentenceGesture = { moved: false, x: 0, y: 0 };
  let suppressWordTipClick = false;

  function cancelWordTipHide() {
    if (wordTipHideTimer) {
      clearTimeout(wordTipHideTimer);
      wordTipHideTimer = 0;
    }
  }

  function wordTipPointerOver() {
    const pop = document.getElementById("word-tip-pop");
    if (pop && !pop.classList.contains("hidden") && pop.matches(":hover")) return true;
    return Boolean(document.querySelector(".word-tip:hover"));
  }

  function wordTipHasSelection() {
    const pop = document.getElementById("word-tip-pop");
    if (!pop || pop.classList.contains("hidden")) return false;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    try {
      return sel.getRangeAt(0).intersectsNode(pop);
    } catch {
      return pop.contains(sel.anchorNode) || pop.contains(sel.focusNode);
    }
  }

  function wordTipShouldStay() {
    return wordTipPointerOver() || wordTipHasSelection();
  }

  function onWordTipSelectMouseUp() {
    wordTipSelectArmed = false;
    document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    if (!wordTipShouldStay()) hideWordTipPop();
  }

  /** 框選文字拖出解釋欄時不要立刻關；放開後若已離開再關 */
  function requestHideWordTipPop(e) {
    if (e && e.buttons) {
      if (!wordTipSelectArmed) {
        wordTipSelectArmed = true;
        document.addEventListener("mouseup", onWordTipSelectMouseUp);
      }
      return;
    }
    cancelWordTipHide();
    wordTipHideTimer = window.setTimeout(() => {
      wordTipHideTimer = 0;
      if (!wordTipShouldStay()) hideWordTipPop();
    }, 180);
  }

  function bindWordTipOutsideDismiss() {
    if (bindWordTipOutsideDismiss.done) return;
    bindWordTipOutsideDismiss.done = true;
    document.addEventListener("pointerdown", (e) => {
      const pop = document.getElementById("word-tip-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".word-tip")) return;
      hideWordTipPop();
    });
  }

  function appendWordTipCopyAction(pop, data) {
    if (!pop || !isCoarsePointer()) return;
    const lemma = String(data?.lemma || "").trim();
    if (!lemma) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm word-tip-copy-btn";
    btn.textContent = "複製並朗讀";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const speak = String(data.reading || data.surface || lemma).trim() || lemma;
      copyLemmaToClipboard(lemma, { speak });
    });
    pop.appendChild(btn);
  }

  function ensureWordTipPop() {
    let el = document.getElementById("word-tip-pop");
    if (el) return el;
    el = document.createElement("div");
    el.id = "word-tip-pop";
    el.className = "word-tip-pop hidden";
    el.setAttribute("role", "tooltip");
    el.addEventListener("mouseenter", () => {
      if (!isCoarsePointer()) cancelWordTipHide();
    });
    el.addEventListener("mouseleave", (e) => {
      if (!isCoarsePointer()) requestHideWordTipPop(e);
    });
    document.body.appendChild(el);
    bindWordTipOutsideDismiss();
    return el;
  }

  function hideWordTipPop() {
    cancelWordTipHide();
    wordTipAnchor = null;
    if (wordTipSelectArmed) {
      wordTipSelectArmed = false;
      document.removeEventListener("mouseup", onWordTipSelectMouseUp);
    }
    const el = document.getElementById("word-tip-pop");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  }

  function showWordTipPop(anchor, data) {
    if (isSentenceSelectEdit()) return;
    cancelWordTipHide();
    const pop = ensureWordTipPop();
    const lemma = data.lemma || "";
    const gloss = data.gloss || "";
    const pos = data.pos || "";
    const surface = data.surface || "";
    const tag = data.tag || "";
    pop.innerHTML = `
      <div class="word-tip-row word-tip-surface">${esc(surface || "—")}</div>
      <div class="word-tip-row"><span class="word-tip-k">原形</span><span class="word-tip-v">${esc(
        lemma || "—"
      )}</span></div>
      <div class="word-tip-row"><span class="word-tip-k">意思</span><span class="word-tip-v">${esc(
        gloss || "—"
      )}</span></div>
      ${
        pos
          ? `<div class="word-tip-row"><span class="word-tip-k">詞性</span><span class="word-tip-v">${esc(
              pos
            )}${tag ? ` · ${esc(tag)}` : ""}</span></div>`
          : tag
            ? `<div class="word-tip-row"><span class="word-tip-k">標籤</span><span class="word-tip-v">${esc(
                tag
              )}</span></div>`
            : ""
      }`;
    pop.innerHTML = wrapWordTipPopHtml(pop.innerHTML);
    finalizeWordTipPop(pop, anchor, data);
  }

  const LOOKUP_TTS_LANG = "ko-KR";
  const TTS_API_LANG = "ko";
  let ttsVoices = [];
  let ttsAudio = null;
  let ttsToken = 0;
  const ttsCache = new Map();
  const TTS_CACHE_MAX = 40;
  let apiTtsWarned = false;

  function refreshTtsVoices() {
    if (!window.speechSynthesis) return;
    ttsVoices = speechSynthesis.getVoices() || [];
  }

  function pickTtsVoice(lang) {
    if (!window.speechSynthesis) return null;
    const want = String(lang || LOOKUP_TTS_LANG).toLowerCase().replace(/_/g, "-");
    const prefix = want.slice(0, 2);
    const list = ttsVoices.length ? ttsVoices : speechSynthesis.getVoices() || [];
    return (
      list.find((v) => String(v.lang || "").toLowerCase().replace(/_/g, "-") === want) ||
      list.find((v) => String(v.lang || "").toLowerCase().startsWith(prefix)) ||
      null
    );
  }

  function stopLookupSpeech() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    if (ttsAudio) {
      try {
        ttsAudio.pause();
      } catch {
        /* ignore */
      }
      ttsAudio = null;
    }
  }

  function speakViaBrowser(text, lang = LOOKUP_TTS_LANG) {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.92;
      const voice = pickTtsVoice(lang);
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn("[tts]", err);
    }
  }

  function normalizeTtsBaseUrl(url) {
    let base = String(url || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\/api\.x\.ai$/i.test(base)) base = "https://api.x.ai/v1";
    return base;
  }

  function pcmToWavBlob(pcmBytes, sampleRate = 24000) {
    const pcm = pcmBytes instanceof Uint8Array ? pcmBytes : new Uint8Array(pcmBytes);
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + pcm.length, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, pcm.length, true);
    const out = new Uint8Array(44 + pcm.length);
    out.set(new Uint8Array(header), 0);
    out.set(pcm, 44);
    return new Blob([out], { type: "audio/wav" });
  }

  function grokTtsCandidate(s, profiles) {
    const grokProv =
      typeof Storage.getApiProvider === "function" ? Storage.getApiProvider("grok") : null;
    const grok = profiles.grok && typeof profiles.grok === "object" ? profiles.grok : {};
    const pid = String(s.apiProvider || "").trim();
    let apiKey = String(grok.apiKey || "").trim();
    let baseUrl = normalizeTtsBaseUrl(grok.baseUrl || grokProv?.baseUrl || "https://api.x.ai/v1");
    if (pid === "grok" || /x\.ai/i.test(String(s.baseUrl || ""))) {
      if (!apiKey) apiKey = String(s.apiKey || "").trim();
      if (s.baseUrl) baseUrl = normalizeTtsBaseUrl(s.baseUrl);
    }
    if (!apiKey) return null;
    return { kind: "grok", id: "grok", label: "Grok", apiKey, baseUrl };
  }

  function googleTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const google = profiles.google && typeof profiles.google === "object" ? profiles.google : {};
    const apiKey = String(
      google.apiKey || (pid === "google" || /generativelanguage\.googleapis/.test(String(s.baseUrl || ""))
        ? s.apiKey
        : "")
    ).trim();
    if (!apiKey) return null;
    return { kind: "google", id: "google", label: "Google", apiKey };
  }

  function customTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const custom = profiles.custom && typeof profiles.custom === "object" ? profiles.custom : {};
    const apiKey = String(pid === "custom" ? s.apiKey || custom.apiKey : custom.apiKey || "").trim();
    const baseUrl = normalizeTtsBaseUrl(pid === "custom" ? s.baseUrl || custom.baseUrl : custom.baseUrl);
    if (!apiKey || !baseUrl) return null;
    return { kind: "openai", id: "custom", label: "自訂", apiKey, baseUrl };
  }

  function currentTtsCandidate(s, profiles) {
    const pid = String(s.apiProvider || "").trim();
    const url = String(s.baseUrl || "").toLowerCase();
    if (pid === "google" || /generativelanguage\.googleapis/.test(url)) return googleTtsCandidate(s, profiles);
    if (pid === "deepseek" || /deepseek\.com/.test(url)) return null;
    if (pid === "custom") return customTtsCandidate(s, profiles);
    return grokTtsCandidate(s, profiles);
  }

  function resolveTtsProvider() {
    const s = Storage.loadSettings();
    const profiles = s.apiProfiles && typeof s.apiProfiles === "object" ? s.apiProfiles : {};
    const current = currentTtsCandidate(s, profiles);
    if (current && current.apiKey) return { ...current, fallback: false };
    const alts = [
      grokTtsCandidate(s, profiles),
      googleTtsCandidate(s, profiles),
      customTtsCandidate(s, profiles),
    ].filter((p) => p && p.apiKey && (!current || p.id !== current.id));
    if (alts[0]) return { ...alts[0], fallback: true };
    if (current) return { ...current, fallback: false };
    return { kind: "none", id: String(s.apiProvider || ""), label: "目前服務", apiKey: "" };
  }

  function putTtsCache(key, url) {
    if (ttsCache.has(key)) {
      const old = ttsCache.get(key);
      if (old && old !== url) URL.revokeObjectURL(old);
      ttsCache.delete(key);
    }
    ttsCache.set(key, url);
    while (ttsCache.size > TTS_CACHE_MAX) {
      const first = ttsCache.keys().next().value;
      const u = ttsCache.get(first);
      if (u) URL.revokeObjectURL(u);
      ttsCache.delete(first);
    }
  }

  async function fetchGrokTts(p, text) {
    const res = await fetch(`${p.baseUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        text,
        voice_id: "eve",
        language: TTS_API_LANG,
        output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`Grok TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function fetchGoogleTts(p, text) {
    const models = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];
    let lastErr = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        p.apiKey
      )}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              languageCode: LOOKUP_TTS_LANG,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      });
      if (res.status === 404) {
        lastErr = new Error(`找不到 Gemini TTS 模型 ${model}`);
        continue;
      }
      if (!res.ok) {
        const detail = String(await res.text().catch(() => "")).slice(0, 180);
        throw new Error(`Google TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
      }
      const json = await res.json();
      const part = json?.candidates?.[0]?.content?.parts?.find((x) => x?.inlineData?.data);
      const b64 = part?.inlineData?.data;
      if (!b64) throw new Error("Google TTS 未回傳音訊");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = String(part.inlineData.mimeType || "");
      const rateMatch = mime.match(/rate=(\d+)/i);
      const rate = rateMatch ? Number(rateMatch[1]) : 24000;
      if (/mpeg|mp3/i.test(mime)) {
        return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      }
      return URL.createObjectURL(pcmToWavBlob(bytes, rate || 24000));
    }
    throw lastErr || new Error("Google TTS 失敗");
  }

  async function fetchOpenAiTts(p, text) {
    if (!p.baseUrl) throw new Error("自訂端點未填 Base URL");
    const res = await fetch(`${p.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "alloy",
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const detail = String(await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`自訂 TTS HTTP ${res.status}${detail ? `：${detail}` : ""}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) throw new Error("TTS 回傳空白音訊");
    return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  }

  async function speakViaApi(text) {
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) throw new Error(p.kind === "none" ? "NO_TTS_PROVIDER" : "NO_TTS_KEY");
    if (p.fallback && !apiTtsWarned) {
      apiTtsWarned = true;
      showToast(`目前服務沒有語音，改用 ${p.label}`, "info");
    }
    const cacheKey = `${p.kind}|${text}|${LOOKUP_TTS_LANG}`;
    let objectUrl = ttsCache.get(cacheKey);
    const myToken = ++ttsToken;
    if (!objectUrl) {
      if (p.kind === "google") objectUrl = await fetchGoogleTts(p, text);
      else if (p.kind === "openai") objectUrl = await fetchOpenAiTts(p, text);
      else objectUrl = await fetchGrokTts(p, text);
      putTtsCache(cacheKey, objectUrl);
    }
    if (myToken !== ttsToken) return;
    stopLookupSpeech();
    const audio = new Audio(objectUrl);
    ttsAudio = audio;
    await audio.play();
  }

  function speakLookupText(text, lang = LOOKUP_TTS_LANG) {
    const t = String(text || "").trim();
    if (!t) return;
    const useApi = Boolean(Storage.loadSettings().apiTtsEnabled);
    if (!useApi) {
      stopLookupSpeech();
      speakViaBrowser(t, lang);
      return;
    }
    speakViaApi(t).catch((err) => {
      console.warn("[tts-api]", err);
      const code = err && err.message;
      if (!apiTtsWarned && (code === "NO_TTS_KEY" || code === "NO_TTS_PROVIDER")) {
        apiTtsWarned = true;
        showToast("沒有可用的語音 API Key（Grok／Google／自訂），已改用系統語音", "warn");
      } else if (code !== "NO_TTS_KEY" && code !== "NO_TTS_PROVIDER") {
        showToast("API 語音失敗，改用系統語音", "warn");
      }
      speakViaBrowser(t, lang);
    });
  }

  function syncApiTtsSwitch(settings) {
    const el = $("#settings-api-tts");
    if (el) el.checked = Boolean((settings || Storage.loadSettings()).apiTtsEnabled);
  }

  function onApiTtsToggle() {
    const on = Boolean($("#settings-api-tts")?.checked);
    Storage.saveSettings({ apiTtsEnabled: on });
    apiTtsWarned = false;
    if (!on) {
      showToast("朗讀改用系統語音", "info");
      return;
    }
    const p = resolveTtsProvider();
    if (p.kind === "none" || !p.apiKey) {
      showToast("沒有可用的語音 API Key（Grok／Google／自訂），朗讀仍用系統語音", "warn");
    } else if (p.fallback) {
      showToast(`目前服務沒有語音，改用 ${p.label} 朗讀`, "info");
    } else {
      showToast(`朗讀改用 ${p.label} API 語音`, "info");
    }
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    refreshTtsVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshTtsVoices);
  }

  function isSentenceSelectEdit() {
    return Boolean(state.sentenceSelectEdit);
  }

  function syncSentenceSelectEditUi() {
    const on = isSentenceSelectEdit();
    $("#sentence-board")?.classList.toggle("is-select-edit", on);
    document.querySelectorAll("[data-sentence-select-edit]").forEach((btn) => {
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setSentenceSelectEdit(on) {
    const next = Boolean(on);
    const changed = next !== isSentenceSelectEdit();
    state.sentenceSelectEdit = next;
    hideWordTipPop();
    syncSentenceSelectEditUi();
    if (!changed) return;
    if (next) {
      showToast("選字編輯：點句中的字來套用規則或編輯單字", "info");
    } else {
      showToast("已關閉選字編輯，點字可再看詞義", "info");
    }
  }

  function toggleSentenceSelectEdit() {
    setSentenceSelectEdit(!isSentenceSelectEdit());
  }

  function wrapWordTipPopHtml(bodyHtml) {
    const on = isSentenceSelectEdit();
    return `<div class="word-tip-pop-inner">
      <div class="word-tip-pop-body">${bodyHtml}</div>
      <button type="button" class="word-tip-edit-mode-btn${on ? " is-on" : ""}" data-sentence-select-edit aria-pressed="${
        on ? "true" : "false"
      }" title="開啟選字編輯：改以點擊選字，套用規則或編輯單字">選字編輯</button>
    </div>`;
  }

  function finalizeWordTipPop(pop, anchor, data) {
    pop.classList.remove("hidden");
    wordTipAnchor = anchor;
    const body = pop.querySelector(".word-tip-pop-body") || pop;
    appendWordTipCopyAction(body, data);
    requestAnimationFrame(() => placePopNearAnchor(pop, anchor));
  }

  function applySentenceTokenSelection(el, clientX, clientY) {
    if (!el) return false;
    const range = getMarkRangeInQuery(el);
    if (!range?.text) return false;
    hideWordTipPop();
    state.selApply = range;
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* ignore */
    }
    const inv = state.lastInventory;
    let note = "點選片段 · 可套用規則或編輯單字";
    if (inv?.items && range.start >= 0) {
      const n = inv.items.filter((it) => {
        if (Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
          return !(range.end <= Number(it.start) || range.start >= Number(it.end));
        }
        return String(it.span || "").trim() === range.text;
      }).length;
      if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
    }
    showSelApplyPop(clientX, clientY, range.text, { note });
    return true;
  }

  function markSentenceGestureStart(e) {
    const p = eventClientPoint(e);
    sentenceGesture = { moved: false, x: p.x, y: p.y };
  }

  function markSentenceGestureMove(e) {
    const p = eventClientPoint(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (!Number.isFinite(sentenceGesture.x)) return;
    if (Math.hypot(p.x - sentenceGesture.x, p.y - sentenceGesture.y) > 12) {
      sentenceGesture.moved = true;
    }
  }

  function shouldRevealSelApplyFromGesture() {
    return sentenceGesture.moved;
  }

  function sentenceSelectEditButtonHtml() {
    const on = isSentenceSelectEdit();
    return `<button type="button" class="btn-sentence-select-edit${on ? " is-on" : ""}" data-sentence-select-edit title="選字編輯：點擊句中的字來套用規則或編輯單字" aria-label="選字編輯" aria-pressed="${
      on ? "true" : "false"
    }">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
    </button>`;
  }

  function sentenceSpeakButtonHtml() {
    return `<button type="button" class="btn-sentence-speak" data-speak-sentence title="朗讀整句" aria-label="朗讀整句">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8.04v7.93A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    </button>`;
  }

  function sentenceTextBlockHtml(innerHtml) {
    return `<div class="sentence-text-row">
      <p class="sentence-text" id="sentence-text">${innerHtml}</p>
      <div class="sentence-text-actions">
        ${sentenceSelectEditButtonHtml()}
        ${sentenceSpeakButtonHtml()}
      </div>
    </div>`;
  }

  function speakCurrentSentence() {
    const t = String(state.lastQuery || $("#sentence-text")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) {
      showToast("沒有可朗讀的句子", "info");
      return;
    }
    speakLookupText(t);
  }

  function fallbackCopyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function copyLemmaToClipboard(lemma, opts = {}) {
    const t = String(lemma || "").trim();
    if (!t) return;
    const spoken = String(opts.speak || t).trim() || t;
    speakLookupText(spoken, opts.lang || LOOKUP_TTS_LANG);
    const ok = () => showToast(`已複製原形「${t}」並朗讀`, "success");
    const fail = () => showToast("無法複製到剪貼簿", "error");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(ok).catch(() => {
        if (fallbackCopyText(t)) ok();
        else fail();
      });
      return;
    }
    if (fallbackCopyText(t)) ok();
    else fail();
  }

  function bindWordTipHovers(root = document) {
    const scope = root || document;
    scope.querySelectorAll(".word-tip").forEach((el) => {
      const data = {
        lemma: el.dataset.lemma || "",
        gloss: el.dataset.gloss || "",
        pos: el.dataset.pos || "",
        surface: el.dataset.surface || el.textContent || "",
        tag: el.dataset.tag || "",
      };
      let pressX = 0;
      let pressY = 0;
      const coarse = isCoarsePointer();
      if (!coarse) {
        el.addEventListener("mouseenter", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("mouseleave", (e) => requestHideWordTipPop(e));
        el.addEventListener("focus", () => {
          if (isSentenceSelectEdit()) return;
          showWordTipPop(el, data);
        });
        el.addEventListener("blur", () => requestHideWordTipPop());
      }
      el.addEventListener("pointerdown", (e) => {
        pressX = e.clientX;
        pressY = e.clientY;
      });
      el.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (state.locateTarget) return;
        if (suppressWordTipClick) {
          suppressWordTipClick = false;
          return;
        }
        if (sentenceGesture.moved) return;
        if (selectionIsNonEmptyInSentence() && !isSentenceSelectEdit()) return;
        if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 8) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSentenceSelectEdit()) {
          applySentenceTokenSelection(el, e.clientX, e.clientY);
          return;
        }
        if (coarse) {
          if (wordTipAnchor === el) hideWordTipPop();
          else showWordTipPop(el, data);
          return;
        }
        const lemma = String(el.dataset.lemma || "").trim();
        if (!lemma) return;
        const speak =
          String(el.dataset.surface || data.surface || "").trim() || lemma;
        copyLemmaToClipboard(lemma, { speak });
      });
    });
  }

  /** 停止句中共置顏色輪播 */
  function stopGramHlCycles() {
    for (const id of state.gramHlCycleTimers || []) {
      clearInterval(id);
    }
    state.gramHlCycleTimers = [];
    hideWordTipPop();
  }

  /**
   * 同一表面命中多條規則時，輪流切換 mark 的 gram-hl-N 色
   * 尊重 prefers-reduced-motion：不輪播，title 仍列出全部
   */
  function startGramHlCycles(root = document) {
    stopGramHlCycles();
    const marks = (root || document).querySelectorAll("mark.gram-hl-cycle[data-cycle-colors]");
    if (!marks.length) return;

    const reduceMotion =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const INTERVAL_MS = 1100;
    marks.forEach((mark) => {
      const colors = String(mark.dataset.cycleColors || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
      const titles = String(mark.dataset.cycleTitles || "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (colors.length < 2) return;

      let i = 0;
      const tick = () => {
        i = (i + 1) % colors.length;
        // 保留 cycle class，只換色號
        mark.className = `gram-hl gram-hl-cycle gram-hl-${colors[i]}`;
        const sole = titles[i] || "";
        const all = titles.map((t, idx) => `${idx + 1}. ${t}`).join(" ｜ ");
        mark.title = sole ? `${sole}（${i + 1}/${colors.length} · ${all}）` : mark.title;
      };
      const id = setInterval(tick, INTERVAL_MS);
      state.gramHlCycleTimers.push(id);
    });
  }

  /** 整句翻譯區塊（可手動貼上／修改；寫回本句 inventory） */
  function sentenceTranslationHtml(inventory, opts = {}) {
    const t = String(inventory?.translation || "").trim();
    const editing = Boolean(opts.editing);
    if (editing) {
      return `
      <div class="inv-sentence-translation is-editing" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <div class="inv-translation-body">
          <textarea
            id="inv-translation-input"
            class="inv-translation-input"
            rows="2"
            placeholder="貼上或輸入整句繁中翻譯…"
            spellcheck="true"
          >${esc(t)}</textarea>
          <div class="inv-translation-actions">
            <button type="button" class="btn btn-sm btn-primary" data-save-translation>儲存</button>
            <button type="button" class="btn btn-sm btn-ghost" data-cancel-translation>取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
      <div class="inv-sentence-translation" id="inv-translation-block">
        <span class="inv-label">翻譯</span>
        <p class="inv-sentence-text${t ? "" : " is-empty"}">${
          t ? esc(t) : "尚無翻譯 · 可手動貼上或編輯"
        }</p>
        <button type="button" class="btn btn-sm btn-secondary inv-translation-edit" data-edit-translation title="編輯翻譯">
          ${t ? "編輯" : "貼上／編輯"}
        </button>
      </div>`;
  }

  function bindTranslationEditors(root = document) {
    const scope = root || document;
    scope.querySelector("[data-edit-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginEditSentenceTranslation();
    });
    scope.querySelector("[data-save-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveSentenceTranslation();
    });
    scope.querySelector("[data-cancel-translation]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelEditSentenceTranslation();
    });
  }

  function beginEditSentenceTranslation() {
    const inv = state.lastInventory;
    if (!inv && state.lastQuery) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory, { editing: true });
    bindTranslationEditors(document);
    const ta = $("#inv-translation-input");
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function saveSentenceTranslation() {
    if (!state.lastInventory) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    const v = String($("#inv-translation-input")?.value || "").trim();
    state.lastInventory.translation = v;
    if (typeof refreshLookupFromInventory === "function") {
      refreshLookupFromInventory({ replaceTranslation: true });
    } else {
      const block = $("#inv-translation-block");
      if (block) {
        block.outerHTML = sentenceTranslationHtml(state.lastInventory);
        bindTranslationEditors(document);
      }
      if (typeof persistCurrentInventory === "function") {
        persistCurrentInventory({ silent: true, replaceTranslation: true });
      }
    }
    showToast(v ? "已更新翻譯" : "已清除翻譯", "success");
  }

  function cancelEditSentenceTranslation() {
    const block = $("#inv-translation-block");
    if (!block) return;
    block.outerHTML = sentenceTranslationHtml(state.lastInventory || {});
    bindTranslationEditors(document);
  }

  /** 下方只列 API 找出、筆記本尚未收錄的項目（僅名稱；說明不預填） */
  function missingInventoryHtml(inventory, missingItems) {
    if (!inventory) return "";
    const list = missingItems || [];
    const summary = inventory.summary
      ? `<p class="panel-note">${esc(inventory.summary)}</p>`
      : "";
    const isLocal = inventory.mode === "local" || inventory.source === "local";

    if (!list.length) {
      const hasVocab = Array.isArray(inventory.vocab) && inventory.vocab.length;
      if (hasVocab && !isLocal) {
        if (!summary) return "";
        return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <div class="panel-head">
            <h3>摘要</h3>
          </div>
          ${summary}
        </section>`;
      }
      return `
        <section class="panel panel-suggest" id="api-inventory-slot">
          <div class="panel-head">
            <h3>${isLocal ? "盤點說明" : "尚未收錄"}</h3>
            <span class="badge ${isLocal ? "badge-local" : "badge-owned"}">${
              isLocal ? "本地掃描" : "全部已有筆記"
            }</span>
          </div>
          ${summary}
          <p class="panel-note">${
            isLocal
              ? "本地模式只標出筆記本已有規則，不會列出「尚未收錄」。若要 AI 盤點未收錄文法，請在查詢頁上方開啟 API 文法；也可選字手動套用規則。"
              : "本次 API 盤點到的文法，筆記本裡都已有對應規則。"
          }</p>
        </section>`;
    }

    const cards = list
      .map(({ it, invIdx }) => {
        const draft = it.draft && typeof it.draft === "object" ? it.draft : {};
        const fakeRule = {
          id: `generated-${invIdx}`,
          title: draft.title || it.name || "未命名規則",
          category: draft.category || it.category || "",
          explanation: draft.explanation || "",
          structure: draft.structure || "",
        };
        const conf =
          it.confidence === "low" ? "需確認" : it.confidence === "high" ? "" : "";
        const spanNote = it.span ? `句中：「${it.span}」` : "句中未定位";
        const extra = `<p class="muted" style="font-size:0.85rem;margin-top:0.25rem">${esc(
          [spanNote, conf].filter(Boolean).join(" · ")
        )} · 僅本句顯示，尚未寫入筆記本</p>`;
        return `<div class="inventory-item missing-card" data-inv-idx="${invIdx}">${ruleCardHtml(
          fakeRule,
          { mode: "generated", generatedIdx: invIdx, extra }
        )}</div>`;
      })
      .join("");

    return `
      <section class="panel panel-suggest" id="api-inventory-slot">
        <div class="panel-head">
          <h3>尚未收錄</h3>
          <span class="badge badge-api-fallback">${list.length} 項</span>
        </div>
        ${summary}
        <p class="panel-note">API 盤點到、筆記本還沒有的文法。可直接收入或加入待辦；<strong>不會自動寫入</strong>筆記本。</p>
        <div class="action-row" style="margin-bottom:0.65rem">
          <button type="button" class="btn btn-primary" id="btn-add-all-missing">將 ${list.length} 項全部加入待辦</button>
        </div>
        <div class="match-list inventory-generated-list">${cards}</div>
      </section>`;
  }

  /**
   * 在查詢頁「已收錄的規則」區塊內定位規則卡（優先）
   * @returns {boolean} 是否找到並捲動
   */
  function scrollToOwnedRuleOnLookup(ruleId) {
    const id = String(ruleId || "").trim();
    if (!id) return false;
    const root = $("#lookup-result");
    if (!root) return false;
    const wantId = "rule-" + id;
    const card = Array.from(root.querySelectorAll(".rule-card")).find((n) => n.id === wantId);
    if (!card) return false;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("rule-card-flash");
    void card.offsetWidth;
    card.classList.add("rule-card-flash");
    setTimeout(() => card.classList.remove("rule-card-flash"), 1400);
    return true;
  }

  /**
   * 切換到「規則筆記本」並捲動／高亮指定規則卡
   */
  function goToRuleInNotebook(ruleId) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    if (!rule) {
      showToast("找不到對應規則卡", "error");
      return;
    }

    setView("rules");

    const filter = $("#rules-filter");
    if (filter) {
      // 清空篩選，確保卡片會被渲染
      filter.value = "";
    }
    renderRulesList();

    const highlight = () => {
      const el = document.getElementById("rule-" + id);
      if (!el) {
        // 仍找不到：用標題篩一次
        if (filter) {
          filter.value = rule.title;
          renderRulesList();
        }
        const el2 = document.getElementById("rule-" + id);
        if (!el2) {
          showToast("規則列表中找不到該卡，改為開啟編輯", "info");
          openForm(rule);
          return;
        }
        el2.scrollIntoView({ behavior: "smooth", block: "center" });
        el2.classList.add("rule-card-flash");
        setTimeout(() => el2.classList.remove("rule-card-flash"), 1400);
        showToast(`已定位：${rule.title}`, "success");
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("rule-card-flash");
      setTimeout(() => el.classList.remove("rule-card-flash"), 1400);
      showToast(`已定位：${rule.title}`, "success");
    };

    // 等 view 切換與 DOM 繪出
    requestAnimationFrame(() => {
      requestAnimationFrame(highlight);
    });
  }

  /**
   * 點圖例／句中標記：優先跳到本頁「已收錄的規則」卡
   */
  function jumpToRuleFromLookup(ruleId) {
    const id = String(ruleId || "").trim();
    if (!id) {
      showToast("無法定位規則", "info");
      return;
    }
    const rule = RulesService.getById(id);
    if (scrollToOwnedRuleOnLookup(id)) {
      showToast(rule ? `已定位：${rule.title}` : "已定位規則", "success");
      return;
    }
    // 本頁沒有該卡（例如僅在筆記本）→ 改開規則筆記本
    goToRuleInNotebook(id);
  }

  /* —— 本句手動校正（不改筆記本規則本體） —— */

  function persistCurrentInventory(opts = {}) {
    const q = String(state.lastQuery || "").trim();
    const inv = state.lastInventory;
    if (!q || !inv) return null;
    // 可傳入已算過的 apiHl，避免手動校正後再全量重算
    keepExistingTranslation(q, inv, opts);
    if (typeof writeBackVocabLocations === "function") {
      inv.vocab = writeBackVocabLocations(q, inv.vocab);
    }
    const apiHl = opts.apiHl || buildApiHighlight(q, inv);
    const payload = {
      query: q,
      summary: inv.summary || "",
      translation: inv.translation || "",
      replaceTranslation: Boolean(opts.replaceTranslation),
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      items: inv.items || [],
      vocab: inv.vocab || [],
      tokens: inv.tokens || [],
    };
    applyPersistEntryTarget(payload, opts);
    const activePid = Storage.getActiveProjectId();
    if (activePid) {
      const after = Storage.upsertProjectEntry(activePid, payload);
      if (after?.seq != null) state.projectCursorSeq = after.seq;
      updateProjectModeUI();
    } else if (!opts.skipHistory) {
      Storage.addHistoryEntry(payload);
      updateLookupNavBtns();
    }
    return apiHl;
  }

  function refreshLookupFromInventory(opts = {}) {
    const q = state.lastQuery;
    const inv = state.lastInventory;
    if (!q || !inv) return;
    const apiHl = applyInventoryToLookup(q, inv, opts);
    persistCurrentInventory({
      apiHl: apiHl || undefined,
      replaceTranslation: Boolean(opts.replaceTranslation),
    });
  }

  /** 從本句結果移除某規則的套用（筆記本規則保留） */
  function detachRuleFromCurrentResult(ruleId) {
    const id = String(ruleId || "").trim();
    const inv = state.lastInventory;
    if (!id || !inv) {
      showToast("沒有可編輯的查詢結果", "info");
      return;
    }
    const before = (inv.items || []).length;
    inv.items = (inv.items || []).filter((it) => {
      if (it.manualRuleId && String(it.manualRuleId) === id) return false;
      if (it.localRuleId && String(it.localRuleId) === id) return false;
      const m = resolveInventoryRule(it);
      if (m.owned && m.rule?.id === id) return false;
      return true;
    });
    if (inv.items.length === before) {
      showToast("找不到對應的本句項目", "info");
      return;
    }
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast("已從本句移除（筆記本規則仍保留）", "success");
  }

  /** 把本句生成卡寫入筆記本並套回此項 */
  function saveGeneratedDraftToNotebook(invIdx) {
    const inv = ensureLookupInventoryShell();
    if (!inv) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    const i = Number(invIdx);
    const it = Array.isArray(inv.items) ? inv.items[i] : null;
    if (!it) {
      showToast("找不到這項文法", "error");
      return;
    }
    const owned = resolveInventoryRule(it);
    if (owned.owned && owned.rule) {
      showToast(`筆記本已有「${owned.rule.title}」`, "info");
      return;
    }
    const draft = it.draft && typeof it.draft === "object" ? it.draft : {};
    const title = String(draft.title || it.name || "").trim();
    if (!title) {
      showToast("沒有規則名，請改用「編輯後建立」", "error");
      return;
    }
    const rule = RulesService.create({
      title,
      category: draft.category || it.category || "其他",
      explanation: draft.explanation || "",
      structure: draft.structure || "",
    });
    attachCreatedRuleToInventoryItem(rule, captureInventoryPendingFromItem(it, i));
    updateRuleCount();
    renderRulesList();
    refreshLookupFromInventory();
    showToast(`已收入筆記本：${rule.title}`, "success");
  }

  /** 忽略尚未收錄的某一項（僅本句） */
  function dismissInventoryItemAt(invIdx) {
    const inv = state.lastInventory;
    if (!inv?.items) return;
    const i = Number(invIdx);
    if (!Number.isFinite(i) || i < 0 || i >= inv.items.length) return;
    const name = inv.items[i]?.name || "";
    inv.items.splice(i, 1);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(name ? `已忽略「${name}」` : "已從本句忽略", "info");
  }

  function ensureLookupInventoryShell() {
    if (!state.lastQuery) return null;
    if (!state.lastInventory) {
      state.lastInventory = {
        summary: "",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
      };
    }
    if (!Array.isArray(state.lastInventory.items)) state.lastInventory.items = [];
    return state.lastInventory;
  }

  function addSupplementaryRuleToCurrent(rule) {
    if (!rule?.id) return;
    if (
      typeof RulesService.isSupplementaryUsage === "function" &&
      !RulesService.isSupplementaryUsage(rule)
    ) {
      showToast("請選擇分類為「補充用法」的規則", "info");
      return;
    }
    const inv = ensureLookupInventoryShell();
    if (!inv || !state.lastQuery) {
      showToast("請先完成一次查詢再加入補充", "info");
      return;
    }
    const already = (inv.items || []).some((it) => {
      if (String(it.manualRuleId || "") === rule.id) return true;
      const m = resolveInventoryRule(it);
      return m.owned && m.rule?.id === rule.id;
    });
    if (already) {
      showToast("本句已有此補充用法", "info");
      return;
    }
    const parsed =
      typeof RulesService.parseBilingualTitle === "function"
        ? RulesService.parseBilingualTitle(rule.title) || {}
        : {};
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push({
      name: rule.title,
      nameKo: parsed.ko || "",
      nameZh: parsed.zh || "",
      span: "",
      category: rule.category || RulesService.SUPPLEMENTARY_CATEGORY || "補充用法",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    });
    state.lastInventory = inv;
    refreshLookupFromInventory();
    showToast(`已加入補充：${rule.title}`, "success");
  }

  function openSupplementaryPickModal() {
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    ensureLookupInventoryShell();
    state.rulePickMode = "supplementary";
    state.selApply = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const title = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (title) title.textContent = "加入補充用法";
    if (preview) preview.textContent = "不句中上色 · 排在規則卡最後";
    if (sub) {
      sub.innerHTML =
        `選擇筆記本中的<strong>補充用法</strong>加入本句；或建立新卡（分類會設為補充用法）。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適的？<strong>建立新補充用法</strong>（儲存後自動加入本句，不句中上色）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立補充用法";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  function captureInventoryPendingFromItem(it, invIdx) {
    if (!it) return null;
    const start = Number(it.start);
    const end = Number(it.end);
    const tokenFrom = Number(it.tokenFrom);
    const tokenTo = Number(it.tokenTo);
    return {
      invIdx: Number.isFinite(Number(invIdx)) ? Number(invIdx) : -1,
      name: String(it.name || it.title || "").trim(),
      span: String(it.span || "").trim(),
      category: String(it.category || "").trim(),
      kiwiKind: String(it.kiwiKind || "").trim(),
      start: Number.isFinite(start) ? start : undefined,
      end: Number.isFinite(end) ? end : undefined,
      tokenFrom: Number.isFinite(tokenFrom) ? tokenFrom : undefined,
      tokenTo: Number.isFinite(tokenTo) ? tokenTo : undefined,
    };
  }

  function captureInventoryPendingByTitle(title) {
    const want = String(title || "").trim();
    const items = state.lastInventory?.items;
    if (!want || !Array.isArray(items)) return null;
    const idx = items.findIndex((it) => {
      if (!it) return false;
      if (resolveInventoryRule(it).owned) return false;
      return String(it.name || it.title || "").trim() === want;
    });
    if (idx < 0) return null;
    return captureInventoryPendingFromItem(items[idx], idx);
  }

  /** 從尚未收錄建立的規則：直接綁回該盤點項，避免嚴格對卡失敗看起來像沒存到 */
  function attachCreatedRuleToInventoryItem(rule, pending) {
    if (!rule?.id) return false;
    const inv = ensureLookupInventoryShell();
    if (!inv) return false;
    const items = Array.isArray(inv.items) ? inv.items.slice() : [];
    const pendingName = String(pending?.name || "").trim();
    const pendingSpan = String(pending?.span || "").trim();
    const sameItem = (it) => {
      if (!it) return false;
      const name = String(it.name || it.title || "").trim();
      if (pendingName && name === pendingName) return true;
      if (pendingSpan && String(it.span || "").trim() === pendingSpan && name === pendingName) {
        return true;
      }
      return false;
    };
    let idx = Number(pending?.invIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= items.length || !sameItem(items[idx])) {
      idx = items.findIndex(sameItem);
    }
    const parsed = RulesService.parseBilingualTitle(rule.title) || {};
    const patch = {
      name: rule.title,
      nameZh: parsed.zh || "",
      nameKo: parsed.ko || "",
      category: rule.category || (idx >= 0 ? items[idx]?.category : "") || pending?.category || "",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    };
    if (idx >= 0) {
      const prev = items[idx] || {};
      const next = { ...prev, ...patch };
      if (prev.span || pendingSpan) next.span = prev.span || pendingSpan;
      const start = Number.isFinite(Number(prev.start)) ? Number(prev.start) : Number(pending?.start);
      const end = Number.isFinite(Number(prev.end)) ? Number(prev.end) : Number(pending?.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        next.start = start;
        next.end = end;
      }
      if (prev.tokenFrom != null || pending?.tokenFrom != null) {
        next.tokenFrom = prev.tokenFrom ?? pending.tokenFrom;
      }
      if (prev.tokenTo != null || pending?.tokenTo != null) {
        next.tokenTo = prev.tokenTo ?? pending.tokenTo;
      }
      items[idx] = next;
    } else {
      const row = { ...patch, span: pendingSpan };
      const start = Number(pending?.start);
      const end = Number(pending?.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        row.start = start;
        row.end = end;
      }
      if (pending?.tokenFrom != null) row.tokenFrom = pending.tokenFrom;
      if (pending?.tokenTo != null) row.tokenTo = pending.tokenTo;
      if (pending?.kiwiKind) row.kiwiKind = pending.kiwiKind;
      items.push(row);
    }
    inv.items = items;
    state.lastInventory = inv;
    return true;
  }

  function countVisibleItemsOnRange(inv, q, start, end, spanText) {
    const list = inv?.items || [];
    const tokens = inv?.tokens;
    const src = String(q || "");
    const span = String(spanText || "").trim();
    let n = 0;
    for (const it of list) {
      let found = [];
      try {
        found = locateInventoryItemInText(src, it, tokens) || [];
      } catch {
        found = [];
      }
      if (found.length) {
        if (found.some((loc) => !(end <= loc.start || start >= loc.end))) n += 1;
        continue;
      }
      if (it.source === "manual" || it.locatedManually) {
        const a = Number(it.start);
        const b = Number(it.end);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
          if (!(end <= a || start >= b)) n += 1;
        } else if (span && String(it.span || "").trim() === span) {
          n += 1;
        }
      }
    }
    return n;
  }

  /** 手動把筆記本規則套到選取片段 */
  function addRuleToCurrentResult(rule, spanText, start, end) {
    if (!rule?.id) return;
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!inv || !q) {
      showToast("請先完成一次查詢再手動套用", "info");
      return;
    }
    const span = String(spanText || "").trim();
    if (!span) {
      showToast("沒有選取文字", "error");
      return;
    }

    // 相同文法可在句中多處各套一次；僅「同規則＋同片段（區間重疊）」才禁止
    let s = Number(start);
    let e = Number(end);
    let rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === span;

    function itemMatchesRule(it) {
      return (
        String(it.manualRuleId || "") === rule.id ||
        resolveInventoryRule(it).rule?.id === rule.id
      );
    }
    function rangesOverlap(a0, a1, b0, b1) {
      return !(a1 <= b0 || a0 >= b1);
    }
    /**
     * 只計算句中實際看得到的套用（有上色／手動）。
     * API 誤報被閘門丟掉的項目仍留在 items 裡，不可再擋使用者套用。
     */
    function collectSameRuleOccupied() {
      const occupied = [];
      for (const it of inv.items || []) {
        if (!itemMatchesRule(it)) continue;
        let found = [];
        try {
          found = locateInventoryItemInText(q, it, inv.tokens) || [];
        } catch {
          found = [];
        }
        if (found.length) {
          for (const loc of found) {
            if (Number.isFinite(loc.start) && Number.isFinite(loc.end) && loc.end > loc.start) {
              occupied.push({ s: loc.start, e: loc.end });
            }
          }
          continue;
        }
        if (it.source === "manual" || it.locatedManually) {
          const a = Number(it.start);
          const b = Number(it.end);
          if (Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0 && b <= q.length) {
            occupied.push({ s: a, e: b });
          }
        }
      }
      return occupied;
    }
    function placementFree(ps, pe) {
      return !collectSameRuleOccupied().some((r) => rangesOverlap(ps, pe, r.s, r.e));
    }

    if (!rangeOk) {
      let from = 0;
      let placed = null;
      while (from < q.length) {
        const idx = q.indexOf(span, from);
        if (idx < 0) break;
        const pe = idx + span.length;
        if (placementFree(idx, pe)) {
          placed = { s: idx, e: pe };
          break;
        }
        from = idx + 1;
      }
      if (placed) {
        s = placed.s;
        e = placed.e;
        rangeOk = true;
      } else {
        const near = nearestTextOccurrence(q, span, start);
        s = near;
        e = s >= 0 ? s + span.length : -1;
        rangeOk = s >= 0 && e > s && e <= q.length && q.slice(s, e) === span;
      }
    }

    const occupied = collectSameRuleOccupied();
    const dup = rangeOk
      ? occupied.some((r) => rangesOverlap(s, e, r.s, r.e))
      : (inv.items || []).some(
          (it) => itemMatchesRule(it) && String(it.span || "").trim() === span
        );
    if (dup) {
      showToast("此片段已套用過同一則規則（可改選句中其他位置）", "info");
      return;
    }

    const coCount = (inv.items || []).filter((it) => {
      if (rangeOk && Number.isFinite(Number(it.start)) && Number.isFinite(Number(it.end))) {
        const a = Number(it.start);
        const b = Number(it.end);
        return rangesOverlap(s, e, a, b);
      }
      return String(it.span || "").trim() === span;
    }).length;

    // 清掉同規則、句中看不到的幽靈項目，避免再擋下一次套用
    inv.items = (inv.items || []).filter((it) => {
      if (!itemMatchesRule(it)) return true;
      if (it.source === "manual" || it.locatedManually) return true;
      const found = locateInventoryItemInText(q, it, inv.tokens);
      return found.length > 0;
    });

    const parsed = RulesService.parseBilingualTitle(rule.title) || {};
    const item = {
      name: rule.title,
      nameKo: parsed.ko || "",
      nameZh: parsed.zh || "",
      span,
      category: rule.category || "",
      confidence: "high",
      source: "manual",
      manualRuleId: rule.id,
    };
    if (rangeOk) {
      item.start = s;
      item.end = e;
    }
    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    inv.items.push(item);
    state.lastInventory = inv;
    refreshLookupFromInventory();
    if (coCount > 0) {
      showToast(`已疊加：${rule.title}（此片段共 ${coCount + 1} 則規則）`, "success");
    } else {
      showToast(`已套用：${rule.title}`, "success");
    }
  }

  /* —— 手動為「句中未定位」指定片段 —— */

  function updateLocateModeBar() {
    const bar = $("#locate-mode-bar");
    if (!bar) return;
    const t = state.locateTarget;
    if (!t?.ruleId) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      document.body.classList.remove("locate-mode-active");
      return;
    }
    document.body.classList.add("locate-mode-active");
    bar.classList.remove("hidden");
    bar.innerHTML = `
      <span class="locate-mode-badge">定位中</span>
      <span class="locate-mode-text">請在句中<strong>選取</strong>對應片段 →
        <strong>${esc(t.ruleTitle || "規則")}</strong>
      </span>
      <button type="button" class="btn btn-sm btn-ghost" id="btn-locate-cancel">取消</button>
    `;
    bar.querySelector("#btn-locate-cancel")?.addEventListener("click", () => {
      cancelLocateMode();
      showToast("已取消定位", "info");
    });
  }

  function enterLocateMode(ruleId) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    if (!rule) {
      showToast("找不到規則", "error");
      return;
    }
    if (!state.lastQuery || !state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    state.locateTarget = { ruleId: id, ruleTitle: rule.title };
    hideSelApplyPop();
    updateLocateModeBar();
    setView("lookup");
    const board = $("#sentence-board") || $("#sentence-text");
    board?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`請選取「${rule.title}」在句中的位置`, "info");
  }

  function cancelLocateMode() {
    state.locateTarget = null;
    updateLocateModeBar();
    // 還原套用按鈕文案
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) applyBtn.textContent = "套用規則";
  }

  /**
   * 將選取片段寫入 inventory，讓該規則在句中上色
   * - 優先更新「尚未定位成功」的同規則項目
   * - 若皆已定位則新增一筆（可共置多位置）
   * - 若無項目則新建
   */
  function assignManualLocation(ruleId, cap) {
    const id = String(ruleId || "").trim();
    const rule = RulesService.getById(id);
    const inv = state.lastInventory;
    const q = String(state.lastQuery || "");
    if (!rule || !inv || !q) {
      showToast("無法定位：缺少查詢結果", "error");
      return false;
    }
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先選取句中文字", "error");
      return false;
    }
    let s = Number(cap.start);
    let e = Number(cap.end);
    const rangeOk =
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= q.length &&
      q.slice(s, e) === text;
    if (!rangeOk) {
      const near = nearestTextOccurrence(q, text, cap?.start);
      if (near < 0) {
        showToast("選取內容與原文對不上，請再選一次", "error");
        return false;
      }
      s = near;
      e = near + text.length;
    }

    inv.items = Array.isArray(inv.items) ? inv.items.slice() : [];
    const indices = [];
    inv.items.forEach((it, i) => {
      const m = resolveInventoryRule(it);
      if (m.rule?.id === id) indices.push(i);
    });

    const patch = (it) => {
      it.span = text;
      it.start = s;
      it.end = e;
      it.locatedManually = true;
      if (!it.manualRuleId) it.manualRuleId = id;
      if (!it.name) it.name = rule.title;
    };

    let mode = "update";
    if (indices.length) {
      // 先找目前 locate 不到的項目
      let targetIdx = -1;
      for (const i of indices) {
        const found = locateInventoryItemInText(q, inv.items[i]);
        if (!found.length) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx >= 0) {
        patch(inv.items[targetIdx]);
      } else {
        // 皆已定位 → 新增一筆位置（共置／多處）
        const base = { ...inv.items[indices[0]] };
        patch(base);
        base.source = base.source || "manual";
        inv.items.push(base);
        mode = "add";
      }
    } else {
      const parsed = RulesService.parseBilingualTitle(rule.title) || {};
      inv.items.push({
        name: rule.title,
        nameKo: parsed.ko || "",
        nameZh: parsed.zh || "",
        span: text,
        start: s,
        end: e,
        category: rule.category || "",
        confidence: "high",
        source: "manual",
        manualRuleId: id,
        locatedManually: true,
      });
      mode = "new";
    }

    state.lastInventory = inv;
    state.locateTarget = null;
    updateLocateModeBar();
    refreshLookupFromInventory();
    showToast(
      mode === "add"
        ? `已加上定位「${text}」→ ${rule.title}`
        : `已定位「${text}」→ ${rule.title}`,
      "success"
    );
    return true;
  }

  function hideSelApplyPop() {
    const pop = $("#sel-apply-pop");
    if (pop) pop.classList.add("hidden");
    const note = $("#sel-apply-note");
    if (note) {
      note.textContent = "";
      note.classList.add("hidden");
    }
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      viewBtn.classList.add("hidden");
      viewBtn.dataset.ruleId = "";
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn && !state.locateTarget) applyBtn.textContent = "套用規則";
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {string} text
   * @param {{ note?: string, viewRuleId?: string }} [opts]
   */
  function showSelApplyPop(clientX, clientY, text, opts = {}) {
    const pop = $("#sel-apply-pop");
    const label = $("#sel-apply-text");
    if (!pop) return;
    if (label) label.textContent = `「${text.length > 24 ? text.slice(0, 24) + "…" : text}」`;
    const note = $("#sel-apply-note");
    const locate = state.locateTarget;
    if (note) {
      if (locate?.ruleId) {
        note.textContent = `定位到：${locate.ruleTitle || "規則"}`;
        note.classList.remove("hidden");
      } else if (opts.note) {
        note.textContent = opts.note;
        note.classList.remove("hidden");
      } else {
        note.textContent = "";
        note.classList.add("hidden");
      }
    }
    const applyBtn = $("#btn-sel-apply-rule");
    if (applyBtn) {
      applyBtn.textContent = locate?.ruleId ? "確認定位" : "套用規則";
    }
    const vocabBtn = $("#btn-sel-vocab");
    if (vocabBtn) vocabBtn.classList.toggle("hidden", Boolean(locate?.ruleId));
    const viewBtn = $("#btn-sel-view-rule");
    if (viewBtn) {
      if (opts.viewRuleId && !locate?.ruleId) {
        viewBtn.classList.remove("hidden");
        viewBtn.dataset.ruleId = opts.viewRuleId;
      } else {
        viewBtn.classList.add("hidden");
        viewBtn.dataset.ruleId = "";
      }
    }
    pop.classList.remove("hidden");
    requestAnimationFrame(() => {
      let x = clientX;
      let y = clientY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          const vv = visualViewportBox();
          x = vv.left + vv.width / 2;
          y = vv.top + 96;
        }
      }
      placeFixedPop(pop, x, y);
    });
  }

  function setVocabEditBanner(html, kind = "info") {
    const banner = $("#vocab-edit-banner");
    if (!banner) return;
    if (!html) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }
    banner.classList.remove("hidden");
    banner.className = `result-banner ${kind}`;
    banner.innerHTML = html;
  }

  function findVocabEntryForRange(cap) {
    const list = state.lastInventory?.vocab;
    if (!Array.isArray(list) || !cap) return { entry: null, index: -1 };
    const text = String(cap.text || "").trim();
    const s = Number(cap.start);
    const e = Number(cap.end);
    const rangeOk = Number.isFinite(s) && Number.isFinite(e) && e > s;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const ws = Number(w.start);
      const we = Number(w.end);
      if (rangeOk && Number.isFinite(ws) && Number.isFinite(we) && !(e <= ws || s >= we)) {
        return { entry: w, index: i };
      }
    }
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].surface || "").trim() === text) return { entry: list[i], index: i };
    }
    return { entry: null, index: -1 };
  }

  /** select 設值；若選項沒有該值則臨時加入，避免無法顯示／再改 */
  function setSelectValue(sel, value) {
    if (!sel || sel.tagName !== "SELECT") {
      if (sel) sel.value = value || "";
      return;
    }
    const v = String(value || "").trim();
    sel.querySelectorAll("option[data-temp-opt]").forEach((o) => o.remove());
    if (!v) {
      sel.value = "";
      return;
    }
    const has = Array.from(sel.options).some((o) => o.value === v);
    if (!has) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      opt.dataset.tempOpt = "1";
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function fillVocabEditForm(data = {}) {
    const set = (id, v) => {
      const el = $(id);
      if (!el) return;
      if (el.tagName === "SELECT") setSelectValue(el, v);
      else el.value = v || "";
    };
    set("#vocab-edit-surface", data.surface);
    set("#vocab-edit-lemma", data.lemma);
    set("#vocab-edit-pos", data.pos);
    set("#vocab-edit-gloss", data.gloss);
  }

  function readVocabEditForm() {
    return {
      surface: String($("#vocab-edit-surface")?.value || "").trim(),
      lemma: String($("#vocab-edit-lemma")?.value || "").trim(),
      pos: String($("#vocab-edit-pos")?.value || "").trim(),
      gloss: String($("#vocab-edit-gloss")?.value || "").trim(),
    };
  }

  function openVocabEditModal() {
    const cap = state.selApply;
    const text = String(cap?.text || "").trim();
    if (!text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastQuery) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = { summary: "", translation: "", items: [], vocab: [] };
    }
    if (!Array.isArray(state.lastInventory.vocab)) state.lastInventory.vocab = [];

    const range = {
      text,
      start: Number.isFinite(cap.start) ? cap.start : -1,
      end: Number.isFinite(cap.end) ? cap.end : -1,
    };
    state.vocabEditRange = range;
    hideSelApplyPop();

    const found = findVocabEntryForRange(range);
    const bankHit =
      typeof Storage.lookupVocabBank === "function" ? Storage.lookupVocabBank(text) : null;
    const base = found.entry
      ? { ...found.entry }
      : bankHit
        ? {
            surface: bankHit.surface || text,
            lemma: bankHit.lemma || "",
            pos: bankHit.pos || "",
            gloss: bankHit.gloss || "",
          }
        : { surface: text, lemma: "", pos: "", gloss: "" };
    if (!base.surface) base.surface = text;
    fillVocabEditForm(base);
    setVocabEditBanner(
      found.entry
        ? `<strong>編輯既有單字</strong> — 修改後按「儲存到本句」（並更新本地單字庫）。`
        : bankHit
          ? `<strong>來自本地單字庫</strong> — 可修改後儲存到本句。`
          : `<strong>新增單字解釋</strong> — 可手動填寫或按「AI 填寫」；儲存後寫入本句與本地單字庫。`,
      "info"
    );
    const preview = $("#vocab-edit-span-preview");
    if (preview) preview.textContent = text;
    $("#vocab-edit-modal")?.classList.remove("hidden");
    setTimeout(() => $("#vocab-edit-gloss")?.focus(), 40);
  }

  function closeVocabEditModal() {
    $("#vocab-edit-modal")?.classList.add("hidden");
    state.vocabEditRange = null;
    setVocabEditBanner("");
  }

  function saveVocabEditForm(e) {
    e?.preventDefault();
    const range = state.vocabEditRange;
    const q = String(state.lastQuery || "");
    if (!range || !q) {
      showToast("沒有可寫入的查詢結果", "error");
      return;
    }
    if (!state.lastInventory) {
      state.lastInventory = { summary: "", translation: "", items: [], vocab: [] };
    }
    const form = readVocabEditForm();
    const surface = form.surface || range.text;
    if (!surface) {
      showToast("請填寫表面形", "error");
      return;
    }
    if (!form.gloss && !form.lemma) {
      showToast("請至少填寫原形或意思", "info");
      return;
    }
    let start = Number(range.start);
    let end = Number(range.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
      const idx = q.indexOf(surface);
      if (idx >= 0) {
        start = idx;
        end = idx + surface.length;
      } else {
        start = null;
        end = null;
      }
    }
    const row = {
      surface,
      lemma: form.lemma || surface,
      gloss: form.gloss,
      pos: form.pos,
      start,
      end,
      source: "manual",
    };
    const list = Array.isArray(state.lastInventory.vocab)
      ? state.lastInventory.vocab.slice()
      : [];
    const found = findVocabEntryForRange(range);
    if (found.index >= 0) {
      list[found.index] = { ...list[found.index], ...row };
    } else {
      let replaced = false;
      for (let i = 0; i < list.length; i++) {
        if (String(list[i].surface || "") === surface) {
          list[i] = { ...list[i], ...row };
          replaced = true;
          break;
        }
      }
      if (!replaced) list.push(row);
    }
    state.lastInventory.vocab = list;
    if (typeof Storage.upsertVocabBankEntries === "function") {
      Storage.upsertVocabBankEntries([row], { preferIncoming: true });
    }
    closeVocabEditModal();
    state.selApply = null;
    window.getSelection()?.removeAllRanges();
    refreshLookupFromInventory();
    showToast(`已寫入單字「${surface}」（本句＋本地庫）`, "success");
  }

  async function runVocabEditAi() {
    const range = state.vocabEditRange;
    const surface =
      String($("#vocab-edit-surface")?.value || "").trim() ||
      String(range?.text || "").trim();
    if (!surface) {
      showToast("請先有選取詞", "error");
      return;
    }
    if (!Storage.hasApiKey()) {
      showToast("請先到「設定」填入 API Key", "error");
      setView("settings");
      return;
    }
    const btn = $("#btn-vocab-edit-ai");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
    }
    setVocabEditBanner(`<strong>AI 查詢中</strong> — 正在補齊「${esc(surface)}」…`, "info");
    try {
      const w = await AiService.completeWordFromSurface(surface, state.lastQuery || "");
      fillVocabEditForm({
        surface: w.surface || surface,
        lemma: w.lemma || "",
        pos: w.pos || "",
        gloss: w.gloss || "",
      });
      setVocabEditBanner(`<strong>AI 已填寫</strong> — 請核對後按「儲存到本句」。`, "success");
      showToast("AI 已填寫單字資訊", "success");
    } catch (err) {
      setVocabEditBanner(
        `<strong>AI 失敗</strong> — ${esc(err.message || "未知錯誤")}`,
        "error"
      );
      showToast(err.message || "AI 填寫失敗", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("loading");
      }
    }
  }

  /** 已上色 mark 對應到原文的 start/end */
  function getMarkRangeInQuery(mark) {
    const sentenceEl = $("#sentence-text");
    const q = String(state.lastQuery || "");
    if (!mark || !sentenceEl || !q) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(mark);
      let start = getTextOffsetInElement(
        sentenceEl,
        range.startContainer,
        range.startOffset
      );
      let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
      const text = String(mark.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      if (start >= 0 && end > start && end <= q.length && q.slice(start, end) === text) {
        return { text, start, end };
      }
      // 同形多處時取最靠近 DOM 偏移的出現處
      const near = nearestTextOccurrence(q, text, start);
      if (near >= 0) return { text, start: near, end: near + text.length };
      return { text, start: -1, end: -1 };
    } catch {
      return null;
    }
  }

  /** 在原文找 needle；有 hint 時取最靠近的出現處（支援同一文法多處） */
  function nearestTextOccurrence(src, needle, hintStart) {
    const q = String(src || "");
    const n = String(needle || "");
    if (!q || !n) return -1;
    let best = -1;
    let bestDist = Infinity;
    let from = 0;
    const hint = Number(hintStart);
    const useHint = Number.isFinite(hint) && hint >= 0;
    while (from < q.length) {
      const idx = q.indexOf(n, from);
      if (idx < 0) break;
      if (!useHint) return idx;
      const d = Math.abs(idx - hint);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
      from = idx + 1;
    }
    return best;
  }

  function selectionIsNonEmptyInSentence() {
    const sentenceEl = $("#sentence-text");
    const sel = window.getSelection();
    if (!sentenceEl || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    try {
      return selectionIntersectsElement(sel.getRangeAt(0), sentenceEl);
    } catch {
      return false;
    }
  }

  function selectionIntersectsElement(range, el) {
    if (!range || !el) return false;
    try {
      if (el.contains(range.commonAncestorContainer)) return true;
      const er = document.createRange();
      er.selectNodeContents(el);
      return (
        range.compareBoundaryPoints(Range.END_TO_START, er) > 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, er) < 0
      );
    } catch {
      return false;
    }
  }

  function clampRangeToElement(range, el) {
    if (!range || !el) return null;
    try {
      const er = document.createRange();
      er.selectNodeContents(el);
      const out = range.cloneRange();
      if (out.compareBoundaryPoints(Range.START_TO_START, er) < 0) {
        out.setStart(er.startContainer, er.startOffset);
      }
      if (out.compareBoundaryPoints(Range.END_TO_END, er) > 0) {
        out.setEnd(er.endContainer, er.endOffset);
      }
      if (out.collapsed) return null;
      return out;
    } catch {
      return null;
    }
  }

  function getTextOffsetInElement(root, node, offset) {
    if (!root || !node) return -1;
    if (!root.contains(node) && node !== root) {
      try {
        const er = document.createRange();
        er.selectNodeContents(root);
        const probe = document.createRange();
        probe.setStart(node, Math.max(0, offset));
        probe.collapse(true);
        if (probe.compareBoundaryPoints(Range.START_TO_START, er) <= 0) return 0;
        if (probe.compareBoundaryPoints(Range.START_TO_END, er) >= 0) {
          return (root.textContent || "").length;
        }
      } catch {
        /* fall through */
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let count = 0;
      let n;
      while ((n = walker.nextNode())) {
        if (n === node) {
          return count + Math.max(0, Math.min(offset, n.textContent.length));
        }
        count += n.textContent.length;
      }
    }
    if (node.nodeType === Node.ELEMENT_NODE && (root.contains(node) || node === root)) {
      try {
        const before = document.createRange();
        before.selectNodeContents(root);
        before.setEnd(node, Math.min(Math.max(0, offset), node.childNodes.length));
        return before.toString().length;
      } catch {
        return -1;
      }
    }
    try {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch {
      return -1;
    }
  }

  function mapDomOffsetsToQuery(q, domText, start, end) {
    const src = String(q || "");
    if (!src) return { start: -1, end: -1 };
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= src.length
    ) {
      return { start, end };
    }
    const qMap = [];
    for (let i = 0; i < src.length; i++) {
      if (!/\s/.test(src[i])) qMap.push(i);
    }
    if (!qMap.length) return { start: -1, end: -1 };
    function domToCompact(i) {
      let c = 0;
      const s = String(domText || "");
      for (let k = 0; k < Math.min(i, s.length); k++) {
        if (!/\s/.test(s[k])) c++;
      }
      return c;
    }
    const cs = domToCompact(start);
    const ce = domToCompact(end);
    if (cs >= qMap.length) return { start: -1, end: -1 };
    const qs = qMap[Math.min(cs, qMap.length - 1)];
    const qe = ce <= 0 ? qs : ce >= qMap.length ? src.length : qMap[ce - 1] + 1;
    if (qe > qs) return { start: qs, end: qe };
    return { start: -1, end: -1 };
  }

  function captureSentenceSelection() {
    const sentenceEl = $("#sentence-text");
    if (!sentenceEl || !state.lastQuery) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    let range = sel.getRangeAt(0);
    if (!selectionIntersectsElement(range, sentenceEl)) return null;
    const clamped = clampRangeToElement(range, sentenceEl);
    if (!clamped) return null;
    range = clamped;

    const text = String(range.toString() || "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    let start = getTextOffsetInElement(sentenceEl, range.startContainer, range.startOffset);
    let end = getTextOffsetInElement(sentenceEl, range.endContainer, range.endOffset);
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    const q = String(state.lastQuery || "");
    const domText = sentenceEl.textContent || "";

    if (start >= 0 && end > start && end <= q.length && q.slice(start, end) === text) {
      return { text, start, end };
    }
    if (start >= 0 && end > start && end <= q.length) {
      const slice = q.slice(start, end).replace(/\s+/g, " ").trim();
      if (slice === text) return { text, start, end };
    }
    if (start >= 0 && end > start) {
      const mapped = mapDomOffsetsToQuery(q, domText, start, end);
      if (mapped.start >= 0 && mapped.end > mapped.start) {
        const slice = q.slice(mapped.start, mapped.end).replace(/\s+/g, " ").trim();
        if (slice === text || slice.includes(text) || text.includes(slice)) {
          return { text: slice || text, start: mapped.start, end: mapped.end };
        }
      }
    }
    const near = nearestTextOccurrence(q, text, start);
    if (near >= 0) return { text, start: near, end: near + text.length };
    return { text, start: -1, end: -1 };
  }

  function bindSentenceSelectionHandlers() {
    const board = $("#sentence-board");
    const sentenceEl = $("#sentence-text");
    const host = board || sentenceEl;
    if (!host || host.dataset.selBound === "1") return;
    host.dataset.selBound = "1";
    host.addEventListener("pointerdown", markSentenceGestureStart);
    host.addEventListener("pointermove", markSentenceGestureMove);
    host.addEventListener("mouseup", onSentenceMouseUp);
    host.addEventListener("touchend", onSentenceMouseUp, { passive: true });
  }

  function onSentenceMouseUp(e) {
    if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, .sentence-legend, .locate-mode-bar")) {
      return;
    }
    if (!shouldRevealSelApplyFromGesture()) return;
    suppressWordTipClick = true;
    const point = eventClientPoint(e);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        state.selApply = cap;
        const inv = state.lastInventory;
        const q = String(state.lastQuery || "");
        let note = "";
        if (inv?.items && cap.start >= 0 && q) {
          const n = countVisibleItemsOnRange(inv, q, cap.start, cap.end, cap.text);
          if (n > 0) note = `此片段已有 ${n} 則 · 可再疊加`;
        }
        showSelApplyPop(point.x, point.y, cap.text, { note });
      });
    });
  }

  /** 點已上色片段：可再套用（不取代既有）；無拖曳選取時不強制跳轉 */
  function onGrammarMarkClick(e, mark) {
    // 若使用者正在／剛選取文字，交給 mouseup 的套用浮層
    if (selectionIsNonEmptyInSentence()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const range = getMarkRangeInQuery(mark);
    if (!range?.text) {
      const id =
        mark.dataset.scrollRule ||
        String(mark.dataset.cycleRuleIds || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)[0];
      if (id) jumpToRuleFromLookup(id);
      return;
    }
    state.selApply = range;
    const viewId =
      mark.dataset.scrollRule ||
      String(mark.dataset.cycleRuleIds || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)[0] ||
      "";
    const inv = state.lastInventory;
    let n = 0;
    if (inv?.items && range.start >= 0) {
      n = countVisibleItemsOnRange(inv, String(state.lastQuery || ""), range.start, range.end, range.text);
    }
    showSelApplyPop(e.clientX, e.clientY, range.text, {
      note: n > 0 ? `已有 ${n} 則規則 · 可再疊加其他規則` : "可為此片段套用規則",
      viewRuleId: viewId,
    });
  }

  function openRulePickModal() {
    const cap = state.selApply;
    if (!cap?.text) {
      showToast("請先在句子中選取文字", "info");
      return;
    }
    if (!state.lastInventory) {
      showToast("請先完成一次查詢", "info");
      return;
    }
    // 定位模式：確認選取即寫入，不開規則列表
    if (state.locateTarget?.ruleId) {
      hideSelApplyPop();
      assignManualLocation(state.locateTarget.ruleId, cap);
      state.selApply = null;
      window.getSelection()?.removeAllRanges();
      return;
    }
    state.rulePickMode = null;
    hideSelApplyPop();
    const modal = $("#rule-pick-modal");
    const titleEl = $("#rule-pick-modal-title");
    const preview = $("#rule-pick-span-preview");
    const sub = modal?.querySelector(".modal-sub");
    if (titleEl) titleEl.textContent = "套用規則";
    if (preview) preview.textContent = cap.text;
    if (sub) {
      sub.innerHTML =
        `選取片段：<strong id="rule-pick-span-preview" class="rule-pick-span">${esc(
          cap.text
        )}</strong> — 依選取字與<strong>形態素分析</strong>推送可能規則置頂；只影響本句，不改筆記本。`;
    }
    const createHint = $(".rule-pick-create-hint");
    if (createHint) {
      createHint.innerHTML =
        `沒有合適規則卡？用選取字<strong>建立新規則</strong>（名稱可再改；儲存後會套用到此片段）。`;
    }
    const createBtn = $("#btn-rule-pick-create");
    if (createBtn) createBtn.textContent = "建立新規則";
    if (modal) modal.classList.remove("hidden");
    const filter = $("#rule-pick-filter");
    if (filter) {
      filter.value = "";
      setTimeout(() => filter.focus(), 40);
    }
    renderRulePickList();
  }

  function closeRulePickModal() {
    $("#rule-pick-modal")?.classList.add("hidden");
    state.rulePickMode = null;
  }

  async function renderRulePickList() {
    const box = $("#rule-pick-list");
    if (!box) return;
    const gen = ++state.rulePickGen;
    const q = String($("#rule-pick-filter")?.value || "")
      .trim()
      .toLowerCase();
    const suppMode = state.rulePickMode === "supplementary";
    const selText = suppMode ? "" : String(state.selApply?.text || "").trim();

    if (suppMode) {
      let rest = RulesService.getAll().filter(
        (r) =>
          typeof RulesService.isSupplementaryUsage === "function" &&
          RulesService.isSupplementaryUsage(r)
      );
      if (q) {
        rest = rest.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
      }
      if (!rest.length) {
        box.innerHTML = `<p class="projects-empty">尚無「補充用法」規則。請按上方「建立補充用法」。</p>`;
        return;
      }
      box.innerHTML = `<div class="rule-pick-section"><ul class="rule-pick-ul">${rest
        .map(
          (r) => `
        <li class="rule-pick-item">
          <div class="rule-pick-main">
            <p class="rule-pick-title"><span class="badge badge-usage">補充</span> ${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "補充用法")}</p>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">加入</button>
        </li>`
        )
        .join("")}</ul></div>`;
      box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const rule = RulesService.getById(btn.dataset.pickRule);
          if (!rule) return;
          closeRulePickModal();
          addSupplementaryRuleToCurrent(rule);
        });
      });
      return;
    }

    // 依選取片段本地智慧排序（有 Kiwi 時帶入語素提示）
    let kiwiHints = [];
    let kiwiAnalyzed = false;
    if (
      selText &&
      typeof KiwiService !== "undefined" &&
      KiwiService.isEnabled() &&
      state.lastQuery
    ) {
      const kiwiSt = KiwiService.getStatus();
      if (kiwiSt.status === "ready") {
        try {
          const cap = state.selApply;
          kiwiHints = await KiwiService.hintsForSpan(
            state.lastQuery,
            cap?.start,
            cap?.end
          );
          kiwiAnalyzed = true;
        } catch (err) {
          console.warn("[kiwi] span hints failed", err);
        }
      } else {
        KiwiService.warmup().then(() => {
          if (gen === state.rulePickGen && !$("#rule-pick-modal")?.classList.contains("hidden")) {
            renderRulePickList();
          }
        });
      }
    }
    if (gen !== state.rulePickGen) return;

    let suggestions = [];
    let rest = RulesService.getAll();
    if (
      selText &&
      typeof RulesService.rankRulesForSpan === "function" &&
      !q
    ) {
      const ranked = RulesService.rankRulesForSpan(selText, {
        minScore: 8,
        maxSuggest: 8,
        kiwiHints,
        kiwiAnalyzed,
        contextText: state.lastQuery,
        spanStart: state.selApply?.start,
        spanEnd: state.selApply?.end,
      });
      suggestions = ranked.suggestions || [];
      rest = ranked.rest || rest;
    } else if (q) {
      const all = RulesService.getAll();
      // 有搜尋時：建議仍可依選取算，但兩邊都 filter
      if (selText && typeof RulesService.rankRulesForSpan === "function") {
        const ranked = RulesService.rankRulesForSpan(selText, {
          minScore: 6,
          maxSuggest: 12,
          kiwiHints,
          kiwiAnalyzed,
          contextText: state.lastQuery,
          spanStart: state.selApply?.start,
          spanEnd: state.selApply?.end,
        });
        const matchQ = (r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        };
        suggestions = (ranked.suggestions || []).filter((s) => matchQ(s.rule));
        rest = all.filter(
          (r) => matchQ(r) && !suggestions.some((s) => s.rule.id === r.id)
        );
      } else {
        rest = all.filter((r) => {
          const blob = `${r.title || ""} ${r.category || ""} ${r.explanation || ""}`.toLowerCase();
          return blob.includes(q);
        });
        suggestions = [];
      }
    }

    if (!suggestions.length && !rest.length) {
      box.innerHTML = `<p class="projects-empty">沒有符合的規則${
        q ? "，試試其他關鍵字" : "。可用上方「建立新規則」用選取字建卡。"
      }</p>`;
      return;
    }

    const itemHtml = (r, extra = {}) => {
      const reason =
        extra.reason && !q
          ? `<p class="rule-pick-reason">${esc(extra.reason)}</p>`
          : extra.reason
            ? `<p class="rule-pick-reason">${esc(extra.reason)}</p>`
            : "";
      const badge = extra.suggest
        ? `<span class="badge badge-rule-suggest">建議</span>`
        : "";
      return `
        <li class="rule-pick-item${extra.suggest ? " rule-pick-item-suggest" : ""}">
          <div class="rule-pick-main">
            <p class="rule-pick-title">${badge}${esc(r.title)}</p>
            <p class="rule-pick-meta muted">${esc(r.category || "未分類")}${
              extra.score != null ? ` · 相關 ${extra.score}` : ""
            }</p>
            ${reason}
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-pick-rule="${esc(r.id)}">套用</button>
        </li>`;
    };

    const suggestBlock =
      suggestions.length > 0
        ? `<div class="rule-pick-section">
            <h3 class="rule-pick-section-title">依選取「${esc(selText)}」建議</h3>
            <ul class="rule-pick-ul rule-pick-ul-suggest">${suggestions
              .map((s) =>
                itemHtml(s.rule, {
                  suggest: true,
                  score: s.score,
                  reason: (s.reasons || []).slice(0, 2).join(" · "),
                })
              )
              .join("")}</ul>
          </div>`
        : selText && !q
          ? `<p class="panel-note rule-pick-no-suggest">沒有高分建議，可從下方完整列表選擇或搜尋。</p>`
          : "";

    const restLimit = 80;
    const restSlice = rest.slice(0, restLimit);
    const restBlock =
      restSlice.length > 0
        ? `<div class="rule-pick-section">
            ${
              suggestions.length
                ? `<h3 class="rule-pick-section-title">其他規則</h3>`
                : ""
            }
            <ul class="rule-pick-ul">${restSlice
              .map((r) => itemHtml(r))
              .join("")}</ul>
            ${
              rest.length > restLimit
                ? `<p class="panel-note">僅顯示前 ${restLimit} 筆，請縮小搜尋。</p>`
                : ""
            }
          </div>`
        : "";

    box.innerHTML = suggestBlock + restBlock;

    box.querySelectorAll("[data-pick-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.pickRule);
        const cap = state.selApply;
        if (!rule || !cap) return;
        closeRulePickModal();
        addRuleToCurrentResult(rule, cap.text, cap.start, cap.end);
        state.selApply = null;
        window.getSelection()?.removeAllRanges();
      });
    });
  }

  function bindLookupResultEvents(query, inventory) {
    const root = $("#lookup-result");
    if (!root) return;

    root.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = RulesService.getById(btn.dataset.edit);
        if (rule) openForm(rule);
      });
    });
    root.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("刪除此規則？")) return;
        RulesService.remove(btn.dataset.delete);
        updateRuleCount();
        runLookup(query);
      });
    });
    root.querySelectorAll("[data-detach-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detachRuleFromCurrentResult(btn.dataset.detachRule);
      });
    });
    // 圖例等連結：跳轉規則；句中 mark 另處理（可再疊加套用）
    root.querySelectorAll("[data-scroll-rule]").forEach((el) => {
      if (el.matches && el.matches("mark.gram-hl")) return;
      el.addEventListener("click", () => {
        let id = el.dataset.scrollRule;
        const invIdx = el.dataset.invIdx;
        if (invIdx != null && invIdx !== "" && inventory?.items) {
          const it = inventory.items[Number(invIdx)];
          if (it) {
            const m = resolveInventoryRule(it);
            if (!m.owned || !m.rule) {
              showToast("此文法尚未嚴格對應到本地規則（可能是縮約形等）", "info");
              return;
            }
            id = m.rule.id;
          }
        }
        jumpToRuleFromLookup(id);
      });
    });
    root.querySelectorAll("[data-add-supplementary]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSupplementaryPickModal();
      });
    });

    // 已上色片段：點一下 → 再套用／查看（同一片段可複數規則）
    root.querySelectorAll("mark.gram-hl").forEach((mark) => {
      mark.addEventListener("click", (e) => onGrammarMarkClick(e, mark));
    });

    // 句中未定位：手動指定片段
    root.querySelectorAll("[data-locate-rule]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterLocateMode(btn.dataset.locateRule);
      });
    });

    $("#btn-create-from-query")?.addEventListener("click", () => {
      openForm(null, {
        title: "",
        banner: `<strong>來自查詢</strong> — ${esc(query)}`,
      });
      // 若像語尾可預填
      $("#form-title").value = "";
      $("#form-title").placeholder = "禁止（-지 마）";
    });

    $("#btn-todo-from-query")?.addEventListener("click", () => {
      const { added, skipped } = addTodosFromItems(
        [{ name: query, note: "手動由查詢加入", category: "其他" }],
        query
      );
      if (added) showToast("已加入待辦", "success");
      else showToast(skipped ? "待辦中已有相同項目" : "未加入", "info");
    });

    $("#btn-add-all-missing")?.addEventListener("click", () => {
      if (!inventory?.items) return;
      const missing = inventory.items.filter((it) => !resolveInventoryRule(it).owned);
      const { added, skipped } = addTodosFromItems(missing, query);
      showToast(
        added ? `已加入 ${added} 項待辦${skipped ? `（略過 ${skipped}）` : ""}` : "沒有新的待辦可加",
        added ? "success" : "info"
      );
    });

    root.querySelectorAll("[data-add-todo-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = inventory?.items?.[Number(btn.dataset.addTodoIdx)];
        if (!it) return;
        const { added } = addTodoSingle(it, query);
        showToast(added ? "已加入待辦" : "待辦中已有或已收錄", added ? "success" : "info");
      });
    });

    root.querySelectorAll("[data-save-draft-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        saveGeneratedDraftToNotebook(btn.dataset.saveDraftIdx);
      });
    });

    root.querySelectorAll("[data-create-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.createInvIdx);
        const it = inventory?.items?.[idx];
        if (!it) return;
        state.pendingSelApply = null;
        state.pendingSupplementaryApply = false;
        state.pendingCreateFromInventory = captureInventoryPendingFromItem(it, idx);
        const draft = it.draft && typeof it.draft === "object" ? it.draft : {};
        openForm(null, {
          title: draft.title || it.name,
          category: draft.category || it.category || "",
          explanation: draft.explanation || "",
          structure: draft.structure || "",
          fromInventory: true,
          banner: `<strong>由 API 盤點建立</strong> — ${esc(
            draft.title || it.name
          )}。儲存後會直接套用到本句，不必再對一次卡名。`,
        });
      });
    });

    root.querySelectorAll("[data-dismiss-inv-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dismissInventoryItemAt(btn.dataset.dismissInvIdx);
      });
    });

    // 選字套用：掛在 sentence-board（句首邊距拖選也吃得到）
    bindSentenceSelectionHandlers();
    bindTranslationEditors(root);
  }

  async function fetchLookupInventory(query) {
    const form = String(query || "").trim();
    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    if (!anyMode) {
      const inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
        grammarEnabled: false,
      };
      keepExistingTranslation(form, inventory);
      return inventory;
    }
    const needApi = modes.apiGrammar || modes.apiVocab;
    if (needApi && !Storage.hasApiKey()) {
      const err = new Error("此模式需要 API Key，請先到「設定」填入");
      err.code = "NEED_API_KEY";
      throw err;
    }

    const wantApiVocab = Boolean(modes.apiVocab);
    const wantApiGrammar = Boolean(modes.apiGrammar);
    let inventory;

    if (wantApiGrammar) {
      const vocabP = wantApiVocab ? requestApiVocab(form) : null;
      inventory = await fetchApiGrammarInventory(form, false);
      inventory.mode = "api";
      inventory.source = "api";
      if (vocabP) {
        const apiInv = await vocabP;
        inventory.vocab = mergeVocabPreferGloss(inventory.vocab, apiInv.vocab);
        if (apiInv.translation && !inventory.translation) inventory.translation = apiInv.translation;
        const added = (apiInv.vocab || []).length;
        inventory.summary = `${inventory.summary || ""} · ${
          added ? `API 單字 ${added} 詞` : "API 單字已核對"
        }`.trim();
      }
    } else if (wantApiVocab) {
      inventory = await requestApiVocab(form);
      inventory.mode = "api";
      inventory.source = "api";
      inventory.items = [];
      inventory.summary =
        inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
    } else {
      inventory = { summary: "", translation: "", items: [], vocab: [], mode: "api", source: "api" };
    }
    inventory.grammarEnabled = Boolean(modes.apiGrammar);
    if (typeof KiwiService !== "undefined" && KiwiService.isEnabled()) {
      try {
        inventory = await KiwiService.enrichInventory(form, inventory, {
          includeGrammar:
            inventory.grammarEnabled &&
            !(Array.isArray(inventory.tokens) && inventory.tokens.length && !inventory.fallbackLegacy),
        });
      } catch (err) {
        console.warn("[kiwi] enrich failed", err);
      }
    }
    if (wantApiGrammar) {
      inventory = await finalizeApiGrammarInventory(form, inventory);
    }
    keepExistingTranslation(form, inventory);
    return inventory;
  }

  function resolveDisplayedProjectSeq(projectId, query, preferredSeq) {
    const norm = Storage.normalizeQueryKey(query);
    if (preferredSeq != null && projectId) {
      const cur = Storage.findProjectEntryBySeq(projectId, preferredSeq);
      if (cur && (!norm || Storage.normalizeQueryKey(cur.query) === norm)) {
        return cur.seq;
      }
    }
    if (!norm || !projectId) return preferredSeq;
    return Storage.findProjectEntryByQuery(projectId, query)?.seq ?? preferredSeq;
  }

  function applyPersistEntryTarget(payload, opts = {}) {
    if (opts.forceNew) {
      payload.forceNew = true;
      return;
    }
    if (opts.entryId) payload.id = opts.entryId;
    if (opts.entrySeq != null) payload.seq = opts.entrySeq;
    if (payload.id || payload.seq != null) return;
    const pid = opts.projectId || Storage.getActiveProjectId();
    if (!pid || state.projectCursorSeq == null) return;
    const cur = Storage.findProjectEntryBySeq(pid, state.projectCursorSeq);
    if (
      cur &&
      Storage.normalizeQueryKey(cur.query) === Storage.normalizeQueryKey(payload.query)
    ) {
      payload.id = cur.id;
      payload.seq = cur.seq;
    }
  }

  function persistLookupResult(query, inventory, apiHl, opts = {}) {
    keepExistingTranslation(query, inventory, opts);
    prepareInventoryVocab(inventory, query);
    inventory.vocab = writeBackVocabLocations(query, inventory.vocab);
    rememberInventoryVocab(inventory, { preferIncoming: false });
    const payload = {
      query,
      summary: inventory.summary || "",
      translation: inventory.translation || "",
      replaceTranslation: Boolean(opts.replaceTranslation),
      ownedCount: (apiHl.ownedHits || []).length,
      missingCount: (apiHl.missingItems || []).length,
      items: inventory.items || [],
      vocab: inventory.vocab || [],
      tokens: inventory.tokens || [],
    };
    applyPersistEntryTarget(payload, opts);
    const activePid = opts.projectId || Storage.getActiveProjectId();
    if (activePid) {
      const before = payload.forceNew
        ? null
        : payload.id
          ? Storage.getProject(activePid)?.entries?.find((e) => e.id === payload.id)
          : Storage.findProjectEntryByQuery(activePid, query);
      const after = Storage.upsertProjectEntry(activePid, payload);
      // keepCursor：背景完成時不把游標跳到剛查完的句子
      const viewing = Storage.getActiveProjectId() === activePid;
      if (after?.seq != null && !opts.keepCursor && viewing) state.projectCursorSeq = after.seq;
      if (!opts.keepCursor && viewing) updateProjectModeUI();
      else updateLookupNavBtns();
      if (!opts.silent) {
        if (before) {
          showToast(`已更新第 ${after?.seq} 號快照（序號不變）`, "success");
        } else {
          showToast(`已加入專案第 ${after?.seq} 號`, "success");
        }
      }
    } else {
      Storage.addHistoryEntry(payload);
      updateLookupNavBtns();
    }
  }

  async function runLookup(forcedQuery) {
    if (state.bulkImport?.running) {
      if (isViewingBulkProject()) {
        showToast("此專案正在整批分析，可用 ← → 或「句子列表」先看已完成的句子", "info");
      } else {
        showToast("另有專案正在整批分析。可先看目前專案已有句子，或按提示列回到分析中的專案", "info");
      }
      return;
    }
    const input = $("#lookup-input");
    const query = (forcedQuery != null ? forcedQuery : input?.value || "").trim();
    if (!query) {
      showToast("請輸入查詢內容", "error");
      return;
    }
    if (input && forcedQuery != null) input.value = query;
    state.lastQuery = query;
    if (typeof KiwiService !== "undefined" && KiwiService.isEnabled()) {
      KiwiService.tokenize(query).catch(() => {});
    }

    const box = $("#lookup-result");
    if (!box) return;

    const modes = Storage.loadLookupModes();
    const anyMode = modes.apiGrammar || modes.apiVocab;
    // 未開啟任何掃描：仍可查詢、顯示句子，供選字套用／補充用法
    if (!anyMode) {
      let inventory = {
        summary: "手動模式",
        translation: "",
        items: [],
        vocab: [],
        mode: "manual",
        source: "manual",
        grammarEnabled: false,
      };
      inventory = await applyKiwiToInventory(query, inventory, { includeGrammar: false });
      state.lastInventory = inventory;
      const apiHl =
        applyInventoryToLookup(query, inventory) || buildApiHighlight(query, inventory);
      if (typeof persistLookupResult === "function") {
        persistLookupResult(query, inventory, apiHl);
      }
      showToast("已顯示句子 · 可選字套用規則（未開啟掃描模式）", "info");
      return;
    }

    const needApi = modes.apiGrammar || modes.apiVocab;

    if (needApi && !Storage.hasApiKey()) {
      showToast("此模式需要 API Key，請先到「設定」填入", "error");
      setView("settings");
      return;
    }

    const myToken = ++state.lookupToken;
    state.lookupBusy = true;
    state.pendingLookupQuery = query;
    stopGramHlCycles();
    const loadingBits = [];
    if (modes.apiGrammar) loadingBits.push("文法點");
    if (modes.apiVocab) loadingBits.push("單字原形");
    const loadingHtml =
      `<div class="lookup-result-stack">` +
      sentenceBoardHtml(query, [], null, null, { source: "api", apiLegend: [] }) +
      `<div class="lookup-result-body">
        <section class="panel" id="api-inventory-slot">
          <div class="panel-head">
            <h3>查詢中</h3>
            <span class="badge badge-api-fallback">請稍候…</span>
          </div>
          <p class="panel-note">正在處理：${esc(loadingBits.join(" · "))}…</p>
          <p class="panel-note muted">查詢期間可用 → 或「歷史」查看已查過的句子，不會中斷 API。單字查詢通常十幾秒內回來。</p>
        </section>
      </div></div>`;
    state.pendingLookupLoadingHtml = loadingHtml;
    box.innerHTML = loadingHtml;
    bindLookupResultEvents(query, null);
    syncAppHeaderHeight();
    updateBackgroundLookupBanner();

    try {
      const wantApiVocab = Boolean(modes.apiVocab);
      const wantApiGrammar = Boolean(modes.apiGrammar);
      let inventory;

      if (wantApiGrammar) {
        const vocabP = wantApiVocab ? requestApiVocab(query) : null;
        inventory = await fetchApiGrammarInventory(query, false);
        inventory.mode = "api";
        inventory.source = "api";
        if (vocabP) {
          const apiInv = await vocabP;
          inventory.vocab = mergeVocabPreferGloss(inventory.vocab, apiInv.vocab);
          if (apiInv.translation && !inventory.translation) inventory.translation = apiInv.translation;
          const added = (apiInv.vocab || []).length;
          inventory.summary = `${inventory.summary || ""} · ${
            added ? `API 單字 ${added} 詞` : "API 單字已核對"
          }`.trim();
        }
      } else if (wantApiVocab) {
        inventory = await requestApiVocab(query);
        inventory.mode = "api";
        inventory.source = "api";
        inventory.items = [];
        inventory.summary =
          inventory.summary || `API 單字查詢：${(inventory.vocab || []).length} 詞`;
      } else {
        inventory = { summary: "", translation: "", items: [], vocab: [], mode: "api", source: "api" };
      }

      inventory.grammarEnabled = Boolean(modes.apiGrammar);
      inventory = await applyKiwiToInventory(query, inventory, {
        includeGrammar:
          inventory.grammarEnabled &&
          !(Array.isArray(inventory.tokens) && inventory.tokens.length && !inventory.fallbackLegacy),
      });
      if (wantApiGrammar) {
        inventory = await finalizeApiGrammarInventory(query, inventory);
      }

      const stillMine = myToken === state.lookupToken;
      const stillViewing = stillMine && isViewingLookupQuery(query);
      const activePid = Storage.getActiveProjectId();
      const vocabNote = inventory.vocab?.length ? ` · 詞彙 ${inventory.vocab.length}` : "";

      if (stillViewing) {
        state.lastInventory = inventory;
        const apiHl =
          applyInventoryToLookup(query, inventory) || buildApiHighlight(query, inventory);
        persistLookupResult(query, inventory, apiHl);
        const nVocab = (inventory.vocab || []).length;
        const nItems = (inventory.items || []).length;
        if (wantApiVocab && !wantApiGrammar) {
          showToast(
            nVocab ? `單字查詢完成：${nVocab} 詞` : "API 未回傳單字，請再試一次或選字手動解釋",
            nVocab ? "success" : "info"
          );
        } else if (!Storage.getActiveProjectId()) {
          showToast(
            `查詢完成${nItems ? ` · 文法 ${nItems}` : ""}${nVocab ? ` · 單字 ${nVocab}` : ""}`,
            "success"
          );
        }
      } else {
        // 使用者已切到其他已查過句子：只寫入儲存，不覆寫畫面
        const apiHl = buildApiHighlight(query, inventory);
        persistLookupResult(query, inventory, apiHl, {
          silent: true,
          keepCursor: true,
        });
        if (stillMine) {
          const where = activePid ? "專案" : "歷史";
          showToast(
            `「${truncateQueryPreview(query)}」查詢完成，已存入${where}${vocabNote}`,
            "success"
          );
        }
      }
    } catch (err) {
      const stillMine = myToken === state.lookupToken;
      if (stillMine && isViewingLookupQuery(query)) {
        const slot = $("#api-inventory-slot");
        const errHtml = `
          <section class="panel">
            <div class="result-banner error" style="margin:0">
              <strong>查詢失敗</strong>
              <span>${esc(err.message || "未知錯誤")}</span>
            </div>
          </section>`;
        if (slot) slot.outerHTML = errHtml;
        else box.insertAdjacentHTML("beforeend", errHtml);
      }
      if (stillMine) {
        showToast(err.message || "API 失敗", "error");
      }
    } finally {
      clearPendingLookup(myToken);
    }
  }

  /* —— Data IO（規則 + 專案） —— */
  function exportRules() {
    const json =
      typeof Storage.exportDataJSON === "function"
        ? Storage.exportDataJSON(RulesService.getAll())
        : Storage.exportRulesJSON(RulesService.getAll());
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const nProj =
      typeof Storage.listProjects === "function" ? Storage.listProjects().length : 0;
    showToast(
      `已匯出：規則 ${RulesService.getAll().length} 筆` +
        (nProj ? ` · 專案 ${nProj} 個` : ""),
      "success"
    );
  }

  function importRules() {
    $("#import-file")?.click();
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const mode = confirm(
        "確定後將「合併」匯入（同 id 覆蓋規則／專案）。\n按取消則中止。\n\n可匯入：完整備份（規則+專案）、舊版規則陣列、或舊版專案檔。"
      )
        ? "merge"
        : null;
      if (!mode) return;

      if (typeof Storage.importDataJSON === "function") {
        const result = Storage.importDataJSON(text, "merge");
        RulesService.setAll(result.rules || []);
        updateRuleCount();
        updateProjectModeUI();
        let msg = `規則 ${result.rules?.length ?? 0} 筆`;
        if (result.projects) {
          msg += ` · 專案 +${result.projects.added}/覆寫 ${result.projects.updated}`;
        } else if (result.kind === "rules-only" || result.kind === "rules-bundle") {
          msg += "（無專案資料）";
        }
        showToast(`已合併匯入：${msg}`, "success");
        if (result.projects && typeof Storage.flushProjects === "function") {
          await Storage.flushProjects();
        }
      } else {
        const merged = Storage.importRulesJSON(text, "merge");
        RulesService.setAll(merged);
        updateRuleCount();
        showToast(`已合併匯入，目前 ${merged.length} 筆規則`, "success");
      }
      if (state.view === "rules") renderRulesList();
    } catch (err) {
      showToast(err.message || "匯入失敗", "error");
    }
  }

  async function resetSeed() {
    if (!confirm("將清除所有本地規則與待辦，並重新載入種子資料。確定？（不會清除 API Key）")) {
      return;
    }
    Storage.resetToSeed();
    const rules = await Storage.initWithSeed();
    RulesService.setAll(rules);
    updateRuleCount();
    renderRulesList();
    renderTodos();
    showToast("已重設種子", "success");
  }

  function renderVocabBankList() {
    const box = $("#vocab-bank-list");
    const countEl = $("#vocab-bank-count");
    if (!box) return;
    const filterQ = String($("#vocab-bank-filter")?.value || "").trim();
    const list =
      typeof Storage.listVocabBankEntries === "function"
        ? Storage.listVocabBankEntries(filterQ)
        : [];
    if (countEl) {
      countEl.textContent = filterQ
        ? `篩選後 ${list.length} 筆 · 本地單字會自動套用到新句子`
        : `共 ${list.length} 筆 · 手改會寫入詞庫；多義可設主要義或刪義項`;
    }
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><p>${
        filterQ
          ? "沒有符合的單字。"
          : "單字本還是空的。<br/>查詢並編輯單字後會自動累積；或先做一次 API 單字查詢。"
      }</p></div>`;
      return;
    }
    box.innerHTML = `<ul class="vocab-bank-list">${list
      .map((e) => {
        const senses = Array.isArray(e.senses) ? e.senses : [];
        const senseHtml = senses
          .map((s) => {
            const isP = s.id === e.primarySenseId;
            return `<li class="vocab-bank-sense${isP ? " is-primary" : ""}">
              <span class="vocab-bank-sense-gloss">${esc(s.gloss || "（無意思）")}</span>
              ${s.lemma ? `<span class="muted"> · ${esc(s.lemma)}</span>` : ""}
              ${isP ? `<span class="badge badge-local">主要</span>` : ""}
              <span class="vocab-bank-sense-actions">
                ${
                  !isP
                    ? `<button type="button" class="btn btn-sm btn-ghost" data-vb-primary="${esc(
                        e.key
                      )}" data-sense-id="${esc(s.id)}">設為主要</button>`
                    : ""
                }
                <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-del-sense="${esc(
                  e.key
                )}" data-sense-id="${esc(s.id)}">刪義項</button>
              </span>
            </li>`;
          })
          .join("");
        return `<li class="vocab-bank-item" data-key="${esc(e.key)}">
          <div class="vocab-bank-main">
            <p class="vocab-bank-surface"><span class="pos-line" data-pos-kind="${esc(
              posUnderlineKind(e.pos)
            )}" data-lemma="${esc(e.lemma || "")}" title="${
              e.lemma ? esc(`點擊複製並朗讀原形「${e.lemma}」`) : ""
            }">${esc(e.surface || e.key)}</span>${
              e.senseCount > 1
                ? `<span class="badge badge-api-fallback">${e.senseCount} 義</span>`
                : ""
            }</p>
            <p class="vocab-bank-meta muted">${e.lemma ? `原形 ${esc(e.lemma)} · ` : ""}${
              e.pos ? esc(e.pos) : ""
            }</p>
            <p class="vocab-bank-gloss">${esc(e.gloss || "—")}</p>
            ${senses.length > 1 ? `<ul class="vocab-bank-senses">${senseHtml}</ul>` : ""}
          </div>
          <div class="vocab-bank-actions">
            <button type="button" class="btn btn-sm btn-danger-ghost" data-vb-delete="${esc(
              e.key
            )}">刪除詞</button>
          </div>
        </li>`;
      })
      .join("")}</ul>`;
    box.querySelectorAll(".vocab-bank-surface .pos-line[data-lemma]").forEach((el) => {
      if (!String(el.dataset.lemma || "").trim()) return;
      el.addEventListener("click", () => copyLemmaToClipboard(el.dataset.lemma));
    });
    box.querySelectorAll("[data-vb-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelete;
        if (!key || !confirm(`刪除「${key}」及其所有義項？`)) return;
        Storage.removeVocabBankEntry(key);
        renderVocabBankList();
        showToast("已刪除單字", "info");
      });
    });
    box.querySelectorAll("[data-vb-del-sense]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbDelSense;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.removeVocabBankSense(key, sid);
        renderVocabBankList();
        showToast("已刪除義項", "info");
      });
    });
    box.querySelectorAll("[data-vb-primary]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.vbPrimary;
        const sid = btn.dataset.senseId;
        if (!key || !sid) return;
        Storage.setVocabBankPrimarySense(key, sid);
        renderVocabBankList();
        showToast("已設為主要義項", "success");
      });
    });
  }

  function bindEvents() {
    bindPadChrome();
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-pos-toggle]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      togglePosUnderline(btn.dataset.posToggle);
    });
    $$(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "projects") {
          onNavProjects();
          return;
        }
        const v = btn.dataset.view;
        if (v && v !== "form") setView(v);
      });
    });

    $("#lookup-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      runLookup();
    });

    // Enter 查詢；Shift+Enter 換行（textarea 預設 Enter 只換行）
    $("#lookup-input")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      if (e.shiftKey) return; // 換行
      e.preventDefault();
      const form = $("#lookup-form");
      if (form?.requestSubmit) form.requestSubmit();
      else runLookup();
    });
    $("#lookup-input")?.addEventListener("input", () => {
      if (isProjectMode()) updateProjectModeUI();
      if (state.lookupBusy) updateBackgroundLookupBanner();
    });

    $("#btn-new-rule")?.addEventListener("click", () => openForm());
    $("#vocab-bank-filter")?.addEventListener("input", () => renderVocabBankList());
    $("#rule-form")?.addEventListener("submit", saveForm);
    $("#btn-form-cancel")?.addEventListener("click", () => {
      // AI 進行中：不清草稿，回原頁（表單欄位與 job 身分保留）
      if (state.aiBusy && state.aiJob?.status === "running") {
        setView(getFormReturnView());
        showToast("AI 仍在背景填寫，草稿已保留", "info");
        return;
      }
      state.editingId = null;
      state.todoSourceId = null;
      state.pendingSelApply = null;
      state.pendingSupplementaryApply = false;
      state.pendingCreateFromInventory = null;
      setView(getFormReturnView());
    });
    $("#btn-ai-complete")?.addEventListener("click", () => runAiComplete());
    $("#btn-ai-job-form")?.addEventListener("click", () => returnToAiForm());
    $("#btn-ai-job-dismiss")?.addEventListener("click", () => dismissAiJobBar());
    $("#form-structure")?.addEventListener("input", () => updateStructurePreview());
    $("#rules-filter")?.addEventListener("input", () => renderRulesList());
    $("#history-filter")?.addEventListener("input", () => renderHistory());
    $("#btn-lookup-seq-prev")?.addEventListener("click", () => onLookupSeqPrev());
    $("#btn-lookup-seq-next")?.addEventListener("click", () => onLookupSeqNext());

    // 專案
    $("#btn-projects-modal-close")?.addEventListener("click", () => closeProjectsModal());
    $("#projects-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectsModal();
    });
    $("#btn-projects-crumb-root")?.addEventListener("click", () => {
      state.projectsBrowseId = null;
      renderProjectsList();
      $("#project-new-name")?.focus();
    });
    $("#project-mode-collection")?.addEventListener("click", () => {
      const p = Storage.getActiveProject();
      openProjectsModal({ browseId: p ? p.collectionId || "" : null });
    });
    bindCollectionCrumbRename();
    $("#btn-project-create")?.addEventListener("click", () => createProjectFromModal());
    $("#project-new-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createProjectFromModal();
      }
    });
    bindProjectNameEdit();
    $("#btn-project-leave")?.addEventListener("click", () => leaveProject());
    $("#btn-project-entries")?.addEventListener("click", () => openProjectEntriesModal());
    $("#project-bulk-input")?.addEventListener("input", () => updateBulkImportHint());
    $("#btn-project-bulk-split")?.addEventListener("click", () => applyBulkSentenceBreaks());
    $("#btn-project-bulk-split-comma")?.addEventListener("click", () => applyBulkCommaBreaks());
    $("#btn-project-bulk-run")?.addEventListener("click", () => runProjectBulkImport());
    $("#btn-project-bulk-cancel")?.addEventListener("click", () => cancelProjectBulkImport());
    $("#btn-project-bulk-clear")?.addEventListener("click", () => {
      const ta = $("#project-bulk-input");
      if (ta) ta.value = "";
      updateBulkImportHint();
      ta?.focus();
    });
    $("#btn-project-entries-modal-close")?.addEventListener("click", () =>
      closeProjectEntriesModal()
    );
    $("#project-entries-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeProjectEntriesModal();
    });
    $("#project-entries-filter")?.addEventListener("input", () => {
      const pid = Storage.getActiveProjectId();
      if (pid) renderProjectEntriesList(pid);
    });
    // 選字／已標片段：套用規則（可疊加）
    $("#btn-sel-apply-rule")?.addEventListener("click", () => openRulePickModal());
    $("#btn-sel-vocab")?.addEventListener("click", () => openVocabEditModal());
    $("#btn-vocab-edit-close")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-cancel")?.addEventListener("click", () => closeVocabEditModal());
    $("#btn-vocab-edit-ai")?.addEventListener("click", () => runVocabEditAi());
    $("#vocab-edit-form")?.addEventListener("submit", saveVocabEditForm);
    {
      const overlay = $("#vocab-edit-modal");
      let pressOnOverlay = false;
      overlay?.addEventListener("mousedown", (e) => {
        pressOnOverlay = e.target === overlay;
      });
      overlay?.addEventListener("click", (e) => {
        if (pressOnOverlay && e.target === overlay) closeVocabEditModal();
        pressOnOverlay = false;
      });
    }
    $("#btn-sel-view-rule")?.addEventListener("click", () => {
      const id = $("#btn-sel-view-rule")?.dataset?.ruleId;
      hideSelApplyPop();
      if (id) jumpToRuleFromLookup(id);
    });
    $("#btn-sel-apply-cancel")?.addEventListener("click", () => {
      hideSelApplyPop();
      state.selApply = null;
      if (state.locateTarget) {
        // 只關浮層，保持定位模式，方便重選
        showToast("可再選一次片段，或按上方「取消」結束定位", "info");
      }
      window.getSelection()?.removeAllRanges();
    });
    $("#btn-rule-pick-close")?.addEventListener("click", () => closeRulePickModal());
    $("#btn-rule-pick-create")?.addEventListener("click", () => openCreateRuleFromSelection());
    $("#rule-pick-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeRulePickModal();
    });
    $("#rule-pick-filter")?.addEventListener("input", () => renderRulePickList());
    const dismissSelApplyIfOutside = (e) => {
      const pop = $("#sel-apply-pop");
      if (!pop || pop.classList.contains("hidden")) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest && e.target.closest("#sentence-text, #sentence-board")) {
        return;
      }
      hideSelApplyPop();
    };
    document.addEventListener("pointerdown", dismissSelApplyIfOutside);
    const revealSelApplyOutsideBoard = (e) => {
      if (state.view !== "lookup") return;
      if (e.target.closest && e.target.closest("#sel-apply-pop, button, a, input, textarea")) {
        return;
      }
      if (!$("#sentence-text")) return;
      if (e.target.closest && e.target.closest("#sentence-board")) return;
      if (!shouldRevealSelApplyFromGesture()) return;
      suppressWordTipClick = true;
      const point = eventClientPoint(e);
      requestAnimationFrame(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        showSelApplyPop(point.x, point.y, cap.text, {});
      });
    };
    document.addEventListener("mouseup", revealSelApplyOutsideBoard);
    document.addEventListener("touchend", revealSelApplyOutsideBoard, { passive: true });
    let selChangeTimer = 0;
    document.addEventListener("selectionchange", () => {
      if (!isCoarsePointer() || state.view !== "lookup") return;
      if (!shouldRevealSelApplyFromGesture()) return;
      clearTimeout(selChangeTimer);
      selChangeTimer = window.setTimeout(() => {
        const cap = captureSentenceSelection();
        if (!cap) return;
        if (
          state.selApply &&
          state.selApply.text === cap.text &&
          state.selApply.start === cap.start &&
          !$("#sel-apply-pop")?.classList.contains("hidden")
        ) {
          return;
        }
        state.selApply = cap;
        let x = NaN;
        let y = NaN;
        try {
          const r = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
          x = r.left + r.width / 2;
          y = r.bottom;
        } catch {
          /* ignore */
        }
        showSelApplyPop(x, y, cap.text, {});
      }, 380);
    });

    document.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-sentence-select-edit]");
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleSentenceSelectEdit();
        return;
      }
      const btn = e.target.closest("[data-speak-sentence]");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      speakCurrentSentence();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#vocab-edit-modal")?.classList.contains("hidden")) {
          closeVocabEditModal();
          return;
        }
        if (!$("#rule-pick-modal")?.classList.contains("hidden")) {
          closeRulePickModal();
          return;
        }
        if (!$("#sel-apply-pop")?.classList.contains("hidden")) {
          hideSelApplyPop();
          state.selApply = null;
          return;
        }
        if (isSentenceSelectEdit()) {
          setSentenceSelectEdit(false);
          return;
        }
        if (state.locateTarget) {
          cancelLocateMode();
          showToast("已取消定位", "info");
          return;
        }
        if (!$("#project-entries-modal")?.classList.contains("hidden")) {
          closeProjectEntriesModal();
          return;
        }
        if (!$("#projects-modal")?.classList.contains("hidden")) {
          closeProjectsModal();
        }
        return;
      }

      // WASD／ZXCVBNM／方向鍵（輸入中不攔截）
      handleAppHotkeys(e);
    });

    $("#settings-form")?.addEventListener("submit", saveSettingsForm);
    $("#settings-api-tts")?.addEventListener("change", () => onApiTtsToggle());
    $("#settings-mode-api-grammar")?.addEventListener("change", () =>
      onLookupModeToggle("apiGrammar")
    );
    $("#settings-mode-api-vocab")?.addEventListener("change", () =>
      onLookupModeToggle("apiVocab")
    );
    $("#settings-kiwi-enabled")?.addEventListener("change", () => onKiwiToggle());
    $("#btn-settings-modes-all")?.addEventListener("click", () => onSettingsModesAllClick());
    $("#btn-test-api")?.addEventListener("click", () => testApiConnection());
    $("#btn-clear-key")?.addEventListener("click", () => clearApiKey());
    $("#settings-api-provider")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-api-provider]");
      if (!btn) return;
      switchApiProvider(btn.dataset.apiProvider);
    });
    $("#settings-model-shortcuts")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-model-id]");
      if (!btn) return;
      applyModelShortcut(btn.dataset.modelId);
    });
    $("#btn-toggle-key")?.addEventListener("click", () => {
      const input = $("#settings-api-key");
      const btn = $("#btn-toggle-key");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      if (btn) btn.textContent = show ? "隱藏" : "顯示";
    });
    $("#btn-export")?.addEventListener("click", exportRules);
    $("#btn-import")?.addEventListener("click", importRules);
    $("#import-file")?.addEventListener("change", onImportFile);
    $("#btn-reset-seed")?.addEventListener("click", () => resetSeed());
    $("#btn-clear-history")?.addEventListener("click", () => clearAllHistory());
  }

  /** 量測頂欄高度，讓句中 sticky 列精準貼在下方 */
  function syncAppHeaderHeight() {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const h = Math.ceil(header.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty("--app-header-h", `${h}px`);
    }
  }

  async function init() {
    applyStructureTheme(Storage.loadSettings().structureTheme);
    try {
      if (typeof Storage.initProjectsDb === "function") {
        await Storage.initProjectsDb();
      }
    } catch (err) {
      console.warn("[projects idb init]", err);
    }
    bindEvents();
    try {
      const rules = await Storage.initWithSeed();
      RulesService.setAll(rules);
    } catch {
      RulesService.setAll([]);
    }
    try {
      if (typeof Storage.harvestVocabBankFromSnapshots === "function") {
        const n = Storage.harvestVocabBankFromSnapshots();
        if (n > 0) console.info(`[vocab-bank] harvested ${n} entries`);
      }
    } catch (err) {
      console.warn("[vocab-bank] harvest failed", err);
    }
    updateRuleCount();
    updateLookupModeUI();
    // 還原上次進入的專案（若仍存在）
    if (Storage.getActiveProjectId()) {
      state.projectCursorSeq = null;
    }
    updateProjectModeUI();
    syncAppHeaderHeight();
    window.addEventListener("resize", () => syncAppHeaderHeight());
    setView("lookup");
    // 版面穩定後再量一次
    requestAnimationFrame(() => syncAppHeaderHeight());
    if (typeof KiwiService !== "undefined") {
      KiwiService.onStatus(() => updateKiwiStatusUI());
      updateKiwiStatusUI();
      KiwiService.warmup();
    }
  }

  return { init, setView, runLookup };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
