/**
 * SpaceXAI / xAI API
 * 1) 查詢：文法盤點（列出名稱，格式 中文（韓語））
 * 2) 表單：依規則名自動填寫說明
 */
const AiService = (() => {
  const RULE_SYSTEM = `你是韓語文法助教。依「規則名」產出筆記本卡片 JSON（不要 markdown／圍欄／其他文字）。

短鍵格式（必須用短鍵，勿用 title/category 等長鍵）：
{"n":"中文（韓語）","c":"語尾|助詞|不規則|時態|敬語|連接|句型|其他","e":"繁中說明2–5句","s":"結構式 詞幹＋…"}

規則：
1. n 必須「中文（韓語）」，如 해요體（-아/어요）、主格助詞（이/가）。
2. 無變化格子、keywords。不規則獨立概念；通則可在 e 提「例外見 ○○ 不規則」。
3. e 只寫用法，盡量無例句。
4. s 必填：＋ 連零件；→ 結果；開/閉音節同一卡用全形／分列，**開在前閉在後**。
5. 一次一主題（人稱縮約只寫該形；母音縮約只寫 해／여／돼 等該形；-는데 只寫本句詞類）。
6. 母音縮約標題必須寫「套用範圍」在括號內，禁止只寫「母音縮約」或只寫（해）／（여）／（돼）：
   - 母音縮約（하＋여→해）｜母音縮約（이＋어→여）｜母音縮約（되＋어→돼）
   - 해≠여≠돼，勿混；주＋어→줘、副詞 -게 都不是 해 系。
7. 不規則必須寫具體種類（ㅂ／ㄷ／ㅅ／르／ㅎ 不規則、ㅡ 脫落），禁止只寫「不規則」。`;

  const INVENTORY_SYSTEM = `你是韓語文法助教。盤點句中文法，並給實詞原形與簡義。只輸出一個 JSON（無 markdown／圍欄）。

【短鍵・必用】禁止 summary/translation/items/name 等長鍵：
{
  "u": "摘要可空",
  "t": "整句繁中翻譯（必填）",
  "i": [
    {"n":"中文（韓語）","c":"語尾|助詞|不規則|時態|敬語|連接|句型|其他","s":"句中片段","f":"h|m|l"}
  ],
  "v": [
    {"s":"句中表面形","l":"詞典原形","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","a":0,"b":2}
  ]
}

欄位：n=全名；c=分類；s=span 或 surface；f=h/m/l；v 中 l=lemma 原形，g=gloss，p=詞性，a/b=在原文的 start/end（0-based，b 不含，須對上 s）。
**p 詞性必須寫完整中文**（動詞、形容詞、名詞、副詞、代詞、數詞、其他），禁止只寫單字「動／形／名」。
z/k（nameZh/nameKo）可省略（前端從 n 拆）。

文法 i：
1. n 格式 中文（韓語），如 過去（-았/었-）。通則與不規則分開。
2. 只列值得建卡的點；已有本地規則也可列。**若 user 訊息附了「本地已有規則標題」且語意相同，n 必須逐字抄本地標題**（勿改成 過去式／連接語尾 等別名，否則前端會誤判未收錄）。
3. 不要在 i 寫用法長文／翻譯；建立規則只用名稱。
4. 一次一主題；縮約只報句中那一個（난≠날）。
5. **s（span）極重要**：必須是查詢原文裡**原樣找得到**的最短韓文（indexOf 能命中），否則前端會顯示「句中未定位」、無法上色。
   - 正確：갔어요、을걸、수 없、지 않、는데、를、예쁜、커요
   - 錯誤：-았/었、〜ㄹ 수 없다（整段抽象）、開音節、았（融合後句中常是 갔 的 ㅆ받침）
   - 複合句型 s 用句中連續字：不可能 →「수 없」或「수 없다」；推測終結 →「을걸」；值得／還可以（-(으)ㄹ 만하다）→「만하」「만해」「을 만하」等（勿只寫 -ㄹ 만하다）
   - 助詞只標語素（너만→만）；過去融合用 갔어요／봤어요 等整詞或能對上的音節
6. 듯이/같이/없이 的 이 不是主格。
7. i 寧可少而準。
7a. **冠形分開**：動詞現在冠形 n:"冠形詞形（-는）"；形容詞現在冠形 n:"冠形詞形（-ㄴ/은）"。s 填句中形（가는、예쁜、작은）。예쁜/큰 的 -ㄴ 是받침，s 仍填完整詞或末音節，勿填 jamo「ㄴ」。
7b. **母音縮約分卡（必須寫套用範圍；해 ≠ 여 ≠ 돼）**：
   - 僅當句中確有「하→해」系表面（해요／해서／했어／했다／해／해줘…）才可列 n:"母音縮約（하＋여→해）"，s 填該表面（해줘 的 해 系 s 填 **해** 或 **해줘**，勿只報 줘）。
   - 僅當詞幹末 이 而縮約（보여、기다려、속삭여、가르쳐…）才可列 n:"母音縮約（이＋어→여）"，s 填 **보여／속삭여／여** 等含 여 的表面。**禁止**把 여 系標成 해 系。
   - 僅當 되→돼 系（돼요／됐다…）才可列 n:"母音縮約（되＋어→돼）"。
   - **여＋줘 連寫必雙報**（極重要）：속삭여줘、알려줘（알리＋어→여）、가르쳐줘 等＝前面 **이＋어→여** ＋後面 **請托 줘**。i 必須**兩項都列**：
     - n:"母音縮約（이＋어→여）"，s:"속삭여" 或 "여"（須 indexOf 能命中原文）
     - n:"命令／請托（-아/어 줘）"，s:"줘"
     不可只報 줘 而省略 여 縮約。
   - **해＋줘**：해줘／해 줘 → 可同時列 母音縮約（하＋여→해）s:"해" 與 請托 s:"줘"。
   - **禁止**：句中無 해／해요／했 等卻標 하＋여→해；單純 감싸줘（無 여／해 縮約）只報請托即可；부드럽게 的 -게 不是母音縮約。
   - 三系各列各卡；勿只寫「母音縮約」或舊式「母音縮約（해）」；勿用 해요體 冒充；해／여／돼 不可互換。
7c. **命令／請托（-아/어 줘）— 有 줘／주세요 就必須列（不可漏）**：
   - 句中只要出現 **줘／줘요／주세요／주실래요**（含 속삭여줘、감싸줘、해 줘、도와줘 連寫），i **必須**有一項：
     n:"命令／請托（-아/어 줘）"（若本地標題表有此名則**逐字抄**），s:"줘" 或 "주세요" 等最短可見表面。
   - **禁止**：只報母音縮約／해요體／動詞原形而**省略**請托；여＋줘、해＋줘 都是「縮約＋請托」兩項，不是二選一。
   - 勿把 줘 標成母音縮約（하＋여→해）或只寫「命令（-아/어）」而不提 줘。

詞彙 v（原形查詢・必填若句中有實詞）：
8. 只列實詞（名/動/形/副/代等）；助詞、語尾、語法標記不要進 v。
9. 動詞/形容詞 l 須詞典形 -다（봤어요→보다；들었어요→듣다；있어요→있다）。
10. 名詞+助詞：친구와→ s 可 친구 或 친구와，l 為 친구。
11. 하다動詞固定 l 如 공부하다。同 l 去重；g 一句內語境簡義（短）。
12. a/b 盡量給準；若省略前端用 s 搜尋。

不規則（**嚴格・禁止統括**）：
13. **禁止** n 只寫「不規則」「불규칙」「不規則活用」等統稱。必須點名**哪一種**：
   - ㅂ 不規則（ㅂ 불규칙）— 춥다→추워、돕다→도와
   - ㄷ 不規則（ㄷ 불규칙）— 듣다→들어、걷다→걸어
   - ㅅ 不規則（ㅅ 불규칙）— 짓다→지어
   - 르 不規則（르 불규칙）— 모르다→몰라、부르다→불러
   - ㅎ 不規則（ㅎ 불규칙）— 파랗다→파래요
   - ㅡ 脫落（ㅡ 탈락）— 크다→커、쓰다→써、바쁘다→바빠
   句中實際用到哪一種就只列那一種；多種並用就**各列一項**，不可合成一條「不規則」。
14. ㅡ 탈락：s 用融合後表面（커、써、커요），不要填 ㅡ／으。
15. 可同時列 해요體／過去等，但具體不規則名不可省略、不可用統稱代替。
16. 句型「值得／還可以」寫 n:"值得／還可以（-(으)ㄹ 만하다）"，s 填句中「만하／만해／을 만…」可見片段。`;

  function getConfig() {
    const s = Storage.loadSettings();
    return {
      apiKey: s.apiKey || "",
      baseUrl: (s.baseUrl || Storage.DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
      model: s.model || Storage.DEFAULT_SETTINGS.model,
    };
  }

  function extractJson(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("API 回傳空白內容");

    try {
      return JSON.parse(raw);
    } catch {
      /* continue */
    }

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* continue */
      }
    }

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error("無法解析 API 回傳的 JSON");
  }

  const ALLOWED_CAT = new Set([
    "語尾",
    "助詞",
    "不規則",
    "時態",
    "敬語",
    "連接",
    "句型",
    "其他",
  ]);

  /** 短鍵優先，長鍵相容（舊快照／模型偶發長鍵） */
  function pickField(obj, shortKey, ...longKeys) {
    if (obj == null || typeof obj !== "object") return "";
    if (obj[shortKey] != null && String(obj[shortKey]).trim() !== "") {
      return obj[shortKey];
    }
    for (const k of longKeys) {
      if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
    }
    return "";
  }

  const CONF_MAP = {
    h: "high",
    m: "medium",
    l: "low",
    high: "high",
    medium: "medium",
    low: "low",
  };

  /** 詞性：單字／英文 → 完整中文標籤 */
  function normalizePosLabel(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const key = s.toLowerCase().replace(/\s+/g, "");
    const map = {
      動: "動詞",
      動詞: "動詞",
      v: "動詞",
      verb: "動詞",
      형용사: "形容詞",
      形: "形容詞",
      形容詞: "形容詞",
      a: "形容詞",
      adj: "形容詞",
      adjective: "形容詞",
      名: "名詞",
      名詞: "名詞",
      n: "名詞",
      noun: "名詞",
      부사: "副詞",
      副: "副詞",
      副詞: "副詞",
      adv: "副詞",
      adverb: "副詞",
      대: "代詞",
      代: "代詞",
      代詞: "代詞",
      代名詞: "代詞",
      pron: "代詞",
      pronoun: "代詞",
      數: "數詞",
      数: "數詞",
      數詞: "數詞",
      num: "數詞",
      관: "冠詞",
      感: "感嘆詞",
      感嘆詞: "感嘆詞",
      助: "助詞",
      助詞: "助詞",
      其他: "其他",
      other: "其他",
    };
    if (map[key] || map[s]) return map[key] || map[s];
    // 已是「…詞」等完整寫法
    if (/詞$|词$/.test(s) || s.length >= 2) return s;
    return s;
  }

  function normalizeDraft(data, fallbackTitle) {
    const d = data || {};
    let category = String(pickField(d, "c", "category")).trim();
    if (!ALLOWED_CAT.has(category)) category = "其他";

    let title =
      String(pickField(d, "n", "title")).trim() ||
      String(fallbackTitle || "").trim() ||
      fallbackTitle;
    return {
      title,
      category,
      explanation: String(pickField(d, "e", "explanation")).trim(),
      structure: String(pickField(d, "s", "structure", "pattern")).trim(),
    };
  }

  function normalizeInventory(data) {
    const raw = data || {};
    const summary = String(pickField(raw, "u", "summary")).trim();
    const translation = String(
      pickField(raw, "t", "translation", "sentenceTranslation", "fullTranslation")
    ).trim();

    const rawItems = Array.isArray(raw.i)
      ? raw.i
      : Array.isArray(raw.items)
        ? raw.items
        : [];

    const items = rawItems
      .map((it) => {
        let name = String(pickField(it, "n", "name", "title")).trim();
        let nameZh = String(pickField(it, "z", "nameZh", "zh")).trim();
        let nameKo = String(pickField(it, "k", "nameKo", "ko")).trim();
        if (!name && (nameZh || nameKo)) {
          name = nameKo ? `${nameZh || "文法"}（${nameKo}）` : nameZh;
        }
        if (!name) return null;
        if (!nameZh || !nameKo) {
          const m = name.match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
          if (m) {
            nameZh = nameZh || m[1].trim();
            nameKo = nameKo || m[2].trim();
          } else {
            nameZh = nameZh || name;
          }
        }
        let category = String(pickField(it, "c", "category")).trim();
        if (!ALLOWED_CAT.has(category)) category = "其他";
        let confidence = String(pickField(it, "f", "confidence") || "m").toLowerCase();
        confidence = CONF_MAP[confidence] || "medium";

        const row = {
          name,
          nameZh,
          nameKo,
          category,
          span: String(pickField(it, "s", "span")).trim(),
          confidence,
        };
        // 本句手動校正欄位（選字套用／指定區間／手動定位）
        const source = String(it?.source || "").trim();
        if (source) row.source = source;
        const manualRuleId = String(it?.manualRuleId || "").trim();
        if (manualRuleId) row.manualRuleId = manualRuleId;
        if (it?.locatedManually) row.locatedManually = true;
        const start = Number(it?.start);
        const end = Number(it?.end);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          row.start = start;
          row.end = end;
        }
        return row;
      })
      .filter(Boolean);

    const rawVocab = Array.isArray(raw.v)
      ? raw.v
      : Array.isArray(raw.vocab)
        ? raw.vocab
        : [];

    const vocab = rawVocab
      .map((w) => {
        const surface = String(pickField(w, "s", "surface")).trim();
        const lemma = String(pickField(w, "l", "lemma", "base", "dictionaryForm")).trim();
        if (!surface && !lemma) return null;
        const gloss = String(pickField(w, "g", "gloss", "meaning", "translation")).trim();
        const pos = normalizePosLabel(pickField(w, "p", "pos", "partOfSpeech"));
        let start = w.a != null ? Number(w.a) : w.start != null ? Number(w.start) : NaN;
        let end = w.b != null ? Number(w.b) : w.end != null ? Number(w.end) : NaN;
        if (!Number.isFinite(start)) start = null;
        if (!Number.isFinite(end)) end = null;
        return {
          surface: surface || lemma,
          lemma: lemma || surface,
          gloss,
          pos,
          start,
          end,
        };
      })
      .filter(Boolean);

    return { summary, translation, items, vocab };
  }

  async function chatComplete({ messages, temperature = 0.3 }) {
    const { apiKey, baseUrl, model } = getConfig();
    if (!apiKey) {
      throw new Error("尚未設定 API Key，請先到「設定」填入");
    }

    const url = `${baseUrl}/chat/completions`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          stream: false,
        }),
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
        throw new Error(
          "無法連線 API（可能是網路或瀏覽器 CORS）。請確認 Base URL 與金鑰。"
        );
      }
      throw new Error("網路錯誤：" + msg);
    }

    const bodyText = await res.text();
    let body;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { raw: bodyText };
    }

    if (!res.ok) {
      const detail =
        body?.error?.message ||
        body?.message ||
        body?.error ||
        bodyText?.slice(0, 200) ||
        res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error("API Key 無效或無權限（" + res.status + "）");
      }
      throw new Error(`API 錯誤 ${res.status}：${detail}`);
    }

    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("API 回傳沒有內容");
    }
    return content;
  }

  async function completeRuleFromTitle(title) {
    const t = String(title || "").trim();
    if (!t) throw new Error("請先填寫規則名");

    const content = await chatComplete({
      messages: [
        { role: "system", content: RULE_SYSTEM },
        {
          role: "user",
          content: `規則名：${t}\n\n請輸出短鍵 JSON：n/c/e/s。n 用「中文（韓語）」；e 無例句；s 必填。一次一主題。開/閉音節同卡時開在前、全形／分隔。`,
        },
      ],
      temperature: 0.25,
    });

    const parsed = extractJson(content);
    return normalizeDraft(parsed, t);
  }

  /** 僅單字／原形：短 prompt、不帶本地規則標題（省 tokens） */
  const VOCAB_ONLY_SYSTEM = `你是韓語詞彙助教。只做實詞原形與簡義，不盤點文法。只輸出一個 JSON（無 markdown／圍欄）。

短鍵：
{"u":"","t":"整句繁中翻譯（單詞則給該詞義）","v":[{"s":"表面形","l":"詞典原形","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","a":0,"b":2}]}

規則：
1. 禁止輸出文法陣列 i／items（助詞、語尾、不規則、母音縮約等一律不要）。
2. v 只列實詞；助詞／語尾／語法標記不要進 v。
3. 動詞／形容詞 l 須詞典形 -다（봤어요→보다）。
4. p 用完整中文詞性；同 l 去重；g 短；a/b 盡量準。`;

  /**
   * 查詢時文法盤點
   * @param {string} query
   * @param {string[]} localTitles
   */
  async function inventoryGrammar(query, localTitles = []) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    // 盡量帶齊本地標題，讓模型 n 與筆記本一致（前端仍會正規化比對）
    const titleList =
      (localTitles || []).slice(0, 200).join("\n") || "（尚無本地規則）";
    const content = await chatComplete({
      messages: [
        { role: "system", content: INVENTORY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n本地已有規則標題（若句中文法已在下列，n 請**逐字使用本地標題**，勿自創同義別名）：\n${titleList}\n\n請輸出短鍵 JSON（u/t/i/v）。t 整句翻譯；i 文法；v 實詞原形+簡義（含 a/b 或 s）。`,
        },
      ],
      temperature: 0.2,
    });

    const parsed = extractJson(content);
    let inv = normalizeInventory(parsed);
    // 前端再依句中 줘／주세요 等補漏報（不依賴模型一定列出）
    if (typeof RulesService !== "undefined" && RulesService.enrichInventoryWithSurfaceHints) {
      inv = RulesService.enrichInventoryWithSurfaceHints(q, inv);
    }
    return inv;
  }

  /**
   * 僅 API 單字（無文法盤點）：輕量請求，不傳本地規則標題
   * @param {string} query
   */
  async function inventoryVocabOnly(query) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const content = await chatComplete({
      messages: [
        { role: "system", content: VOCAB_ONLY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n只輸出 u/t/v（禁止 i）。動詞／形容詞 l 用 -다 詞典形。`,
        },
      ],
      temperature: 0.2,
    });

    const inv = normalizeInventory(extractJson(content));
    inv.items = [];
    if (!inv.summary) inv.summary = `API 單字：${(inv.vocab || []).length} 詞`;
    return inv;
  }

  /**
   * 單一選取詞的 AI 填寫
   * @param {string} surface
   * @param {string} [sentence]
   */
  async function completeWordFromSurface(surface, sentence = "") {
    const surf = String(surface || "").trim();
    if (!surf) throw new Error("沒有選取的詞");
    const ctx = String(sentence || "").trim();
    const content = await chatComplete({
      messages: [
        {
          role: "system",
          content: `你是韓語詞彙助教。使用者選定一個詞，請補齊詞彙。只輸出一個 JSON（無 markdown）：
{"s":"句中表面形","l":"詞典原形（動詞／形容詞 -다）","g":"簡短繁中義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他"}
p 必須完整中文詞性。`,
        },
        {
          role: "user",
          content: ctx
            ? `選定詞：「${surf}」\n所在句子：${ctx}\n請依語境填寫該詞 JSON（可用 s/l/g/p 或 surface/lemma/gloss/pos）。`
            : `選定詞：「${surf}」\n請填寫該詞 JSON。`,
        },
      ],
      temperature: 0.2,
    });
    const parsed = extractJson(content);
    const raw =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Array.isArray(parsed.v)
          ? parsed.v[0]
          : Array.isArray(parsed.vocab)
            ? parsed.vocab[0]
            : parsed
        : null;
    const inv = normalizeInventory({ u: "", t: "", i: [], v: raw ? [raw] : [] });
    const w = (inv.vocab || [])[0];
    if (!w) throw new Error("AI 未回傳可用的單字資訊");
    if (!w.surface) w.surface = surf;
    return w;
  }

  async function testConnection() {
    const content = await chatComplete({
      messages: [
        { role: "system", content: "Reply with exactly: ok" },
        { role: "user", content: "ping" },
      ],
      temperature: 0,
    });
    return { ok: true, sample: String(content).slice(0, 80) };
  }

  return {
    getConfig,
    completeRuleFromTitle,
    completeWordFromSurface,
    inventoryGrammar,
    inventoryVocabOnly,
    normalizeInventory,
    testConnection,
  };
})();
