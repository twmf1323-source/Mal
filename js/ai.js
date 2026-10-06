/**
 * SpaceXAI / xAI API
 * 1) 查詢：文法盤點（列出名稱，格式 中文（韓語））
 * 2) 表單：依規則名自動填寫說明
 */
const AiService = (() => {
  const RULE_SYSTEM = `你是韓語文法助教。依「規則名」產出筆記本卡片 JSON（不要 markdown／圍欄／其他文字）。

短鍵格式（必須用短鍵，勿用 title/category 等長鍵）：
{"n":"極短中文用法名（韓語標記）","c":"語尾|助詞|不規則|時態|敬語|連接|句型|其他","e":"繁中說明2–5句","s":"結構式 詞幹＋…"}

規則：
1. n 必須「功能名稱（韓語標記）」，全形括號。標準例：**禁止（-지 마）**、禮貌體（-아/어요）、主格（이/가）、所有格（의）。中文＝極短功能名；括號內只寫韓語標記。禁止長句標題、禁止韓語在外。禁止 해요體／主題助詞／定語助詞／所有格助詞 等別名。
2. 無變化格子、keywords。不規則獨立概念；通則可在 e 提「例外見 ○○ 不規則」。
3. e 必須用繁體中文寫 2–5 句用法，盡量無例句。禁止用韓文寫說明。韓文只可夾在中文句子裡當標記（아요、은/는），不可整句或整段用韓文。
   正確：「日常禮貌體。詞幹後接 -아요／-어요／-여요（하다→해요）。」
   錯誤：「일상적인 존댓말이다. 어간에 -아요를 붙인다.」
4. s 必填，用中文零件名：＋ 連零件；→ 結果。例：「詞幹＋아/어＋요」「開音節＋았/었→ㅆ받침 ／ 閉音節＋았/었＋語尾」。禁止「어간＋아/어＋요」這類韓文結構。開/閉音節同一卡用全形／分列，**開在前閉在後**。
5. 一次一主題（人稱縮約只寫該形；母音縮約只寫 해／여／돼 等該形；-는데 只寫本句詞類）。
6. 母音縮約標題必須寫「套用範圍」在括號內，禁止只寫「母音縮約」或只寫（해）／（여）／（돼）：
   - 母音縮約（하＋여→해）｜母音縮約（이＋어→여）｜母音縮約（되＋어→돼）
   - 해≠여≠돼，勿混；주＋어→줘、副詞 -게 都不是 해 系。
7. 不規則必須寫具體種類（ㅂ／ㄷ／ㅅ／르／ㅎ 不規則、ㄹ 脫落、ㅡ 脫落），禁止只寫「不規則」。`;

  const INVENTORY_SYSTEM = `你是韓語文法助教。盤點句中文法，並給實詞原形與簡義。只輸出一個 JSON（無 markdown／圍欄）。

【短鍵・必用】禁止 summary/translation/items/name 等長鍵：
{
  "u": "摘要可空",
  "t": "整句繁中翻譯（必填）",
  "i": [
    {"n":"極短中文用法名（韓語標記）","c":"語尾|助詞|不規則|時態|敬語|連接|句型|其他","s":"句中片段","f":"h|m|l"}
  ],
  "v": [
    {"s":"句中表面形","l":"詞典原形","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","a":0,"b":2}
  ]
}

欄位：n=全名；c=分類；s=span 或 surface；f=h/m/l；v 中 l=lemma 原形，g=gloss，p=詞性，a/b=在原文的 start/end（0-based，b 不含，須對上 s）。
**p 詞性必須寫完整中文**（動詞、形容詞、名詞、副詞、代詞、數詞、其他），禁止只寫單字「動／形／名」。
z/k（nameZh/nameKo）可省略（前端從 n 拆）。

文法 i：
1. n 格式「功能名稱（韓語標記）」，全形括號。如 **禁止（-지 마）**、過去（-았/었-）、禮貌體（-아/어요）。通則與不規則分開。中文極短。
2. 只列值得建卡的點，並使用下列標準功能名；不要自創同義別名（禁止 해요體、主題助詞、主格助詞、합니다體、定語助詞、所有格助詞）。不要推測或迎合使用者的本地筆記本內容。
2b. **의 只寫** n:"所有格（의）"。定語助詞／所有格助詞／屬格／冠形格 都是同一條，禁止輪流改名。
3. 不要在 i 寫用法長文／翻譯；建立規則只用名稱。
4. 一次一主題；縮約只報句中那一個（난≠날）。
5. **s（span）極重要**：必須是查詢原文裡**原樣找得到**的最短韓文（indexOf 能命中），否則前端會顯示「句中未定位」、無法上色。
   - 正確：갔어요、을걸、수 없、지 않、는데、를、예쁜、커요
   - 錯誤：-았/었、〜ㄹ 수 없다（整段抽象）、開音節、았（融合後句中常是 갔 的 ㅆ받침）
   - 複合句型 s 用句中連續字：不可能 →「수 없」或「수 없다」；推測終結 →「을걸」；值得／還可以（-(으)ㄹ 만하다）→「만하」「만해」「을 만하」等（勿只寫 -ㄹ 만하다）
   - 助詞只標語素（너만→만）；過去融合用 갔어요／봤어요 等整詞或能對上的音節
6. 듯이/같이/없이 的 이 不是主格。
7. 句中實際出現的文法都要列（助詞、語尾、時態、敬語、連接、不規則、複合句型），不要為了保守而漏列。誤報仍禁止（沒有 거야 就不要 ㄹ 거야；沒有 줘／주세요 就不要請托）。
7a. **冠形分開**：動詞現在冠形 n:"冠形詞形（-는）"；形容詞現在冠形 n:"冠形詞形（-ㄴ/은）"（含 이다→인）。s 填句中形（가는、예쁜、작은、엉망인）。예쁜/큰/인 的 -ㄴ 是받침，s 仍填完整詞或末音節，勿填 jamo「ㄴ」。
7e. **不要**把 하다→해 報成 ㅎ 不規則；不要把沒有 요 的 해／아／어 報成禮貌體；不要把 인 걸 的 ㄹ 報成未來推測；不要把 않아 報成 안 或 -지 못하다（沒有 못）。
7f. **더는／다시는／이제는**＝더／다시／이제＋主題 는，必須列 主題（은/는），s 填「는」或「더는」。禁止漏列。
7c. **未來／推測冠形** n:"未來推測（-(으)ㄹ）"。s 填句中形（갈、줄、먹을、할），ㄹ 在받침裡時仍填該音節，勿填 jamo「ㄹ」。依存名詞 줄（할 줄 알다）不要標成本語尾。
7d. **-(으)ㄹ 複合句型必須見到後接表面，禁止只見 ㄹ／을／볼 就套用本地卡：**
    - 將會／打算（-(으)ㄹ 거야）僅當句中有 **거야／거예요／거다／것이다**。
    - 不可能（-ㄹ 수 없다）僅當 **수 없／수 없다**；可能（-ㄹ 수 있다）只要有 **수 있-** 即成立，包含 **수 있게／수 있어／수 있도록**。
    - **볼 수 없게** 的 ㄹ 屬於 수 없다，**不是** ㄹ 거야，也不是裸「未來推測（-(으)ㄹ）」。
    - 本地標題即使含 -(으)ㄹ，後接對不上就**不要抄**。
7b. **母音縮約分卡（必須寫套用範圍；해 ≠ 여 ≠ 돼）**：
   - 僅當句中確有「하→해」系表面（해요／해서／했어／했다／해／해줘…）才可列 n:"母音縮約（하＋여→해）"，s 填該表面（해줘 的 해 系 s 填 **해** 或 **해줘**，勿只報 줘）。
   - 僅當詞幹末 이 而縮約（보여、기다려、속삭여、가르쳐…）才可列 n:"母音縮約（이＋어→여）"，s 填 **보여／속삭여／여** 等含 여 的表面。**禁止**把 여 系標成 해 系。
   - 僅當句中確有「되→돼」縮約表面（돼요／됐어／됐다／돼／돼서）才可列 n:"母音縮約（되＋어→돼）"。**未縮約的 되어／되었다 不要列**；句中沒有 돼／됐 就禁止報這張。
   - **여＋줘 連寫必雙報**（極重要）：속삭여줘、알려줘（알리＋어→여）、가르쳐줘 等＝前面 **이＋어→여** ＋後面 **請托 줘**。i 必須**兩項都列**：
     - n:"母音縮約（이＋어→여）"，s:"속삭여" 或 "여"（須 indexOf 能命中原文）
     - n:"請托（-아/어 줘）"，s:"줘"
     不可只報 줘 而省略 여 縮約。
   - **해＋줘**：해줘／해 줘 → 可同時列 母音縮約（하＋여→해）s:"해" 與 請托 s:"줘"。
   - **禁止**：句中無 해／해요／했 等卻標 하＋여→해；單純 감싸줘（無 여／해 縮約）只報請托即可；부드럽게 的 -게 不是母音縮約。
   - 三系各列各卡；勿只寫「母音縮約」或舊式「母音縮約（해）」；勿用 해요體 冒充；해／여／돼 不可互換。
7c. **命令／請托（-아/어 줘）— 有 줘／주세요 就必須列（不可漏）**：
   - 句中只要出現 **줘／줘요／주세요／주실래요**（含 속삭여줘、감싸줘、해 줘、도와줘 連寫），i **必須**有一項：
     n:"請托（-아/어 줘）"（若本地標題表有此名則**逐字抄**），s:"줘" 或 "주세요" 等最短可見表面。
   - **禁止**：只報母音縮約／해요體／動詞原形而**省略**請托；여＋줘、해＋줘 都是「縮約＋請托」兩項，不是二選一。
   - 勿把 줘 標成母音縮約（하＋여→해）或只寫「命令（-아/어）」而不提 줘。

標準 n（必須逐字用「功能名稱（韓語）」，勿改寫）：
禮貌體（-아/어요）｜平語（해체）｜正式體（-습니다）｜過去（-았/었-）｜主題（은/는）｜主格（이/가）｜賓格（을/를）｜所有格（의）｜時間地點（에）｜處所來源（에서）｜冠形詞形（-는）｜冠形詞形（-ㄴ/은）｜未來推測（-(으)ㄹ）｜並列連接（-고）｜原因連接（-아/어서）｜背景對比（-는데）｜背景對比（-ㄴ/은데）｜背景對比（-ㄴ데/인데）｜進行（-고 있다）｜否定（-지 않다）｜主體敬語（-시-）｜指定（이에요/예요）｜希望（-고 싶다）｜值得（-ㄹ 만하다）｜請托（-아/어 줘）｜比喻（듯이）｜限定（만）｜副詞化（-게）｜ㅂ 不規則（ㅂ 불규칙）｜ㄷ 不規則（ㄷ 불규칙）｜ㅅ 不規則（ㅅ 불규칙）｜르 不規則（르 불규칙）｜ㅎ 不規則（ㅎ 불규칙）｜ㄹ 脫落（ㄹ 탈락）｜ㅡ 脫落（ㅡ 탈락）｜母音縮約（하＋여→해）｜母音縮約（이＋어→여）｜母音縮約（되＋어→돼）｜人稱主題縮約（난／넌／전）｜人稱賓格縮約（날／널／절）｜可能（-ㄹ 수 있다）｜不可能（-ㄹ 수 없다）｜將會／打算（-(으)ㄹ 거야）

詞彙 v（原形查詢・必填若句中有實詞）：
8. 只列實詞（名/動/形/副/代等）；助詞、語尾、語法標記不要進 v。
8b. **人稱代詞必列、禁止因「太簡單」省略**：나／너／저／우리／저희。句中 **내**（나의「我的」）、**네**、**제**、**내가** 也要列：s 填句中形（내／내가），l 填 나／너／저。
9. 動詞/形容詞 l 須詞典形 -다（봤어요→보다；들었어요→듣다；있어요→있다）。
10. 名詞+助詞：친구와→ s 可 친구 或 친구와，l 為 친구。
11. 하다動詞固定 l 如 공부하다。同 l 去重；g 一句內語境簡義（短）。
12. a/b 盡量給準；若省略前端用 s 搜尋。
12b. **歌詞夾雜的英文**（拉丁字母詞、英文翻譯行）不要列入 v；使用者不學英文。

不規則（**嚴格・禁止統括**）：
13. **禁止** n 只寫「不規則」「불규칙」「不規則活用」等統稱。必須點名**哪一種**：
   - ㅂ 不規則（ㅂ 불규칙）— 춥다→추워、돕다→도와
   - ㄷ 不規則（ㄷ 불규칙）— 듣다→들어、걷다→걸어
   - ㅅ 不規則（ㅅ 불규칙）— 짓다→지어
   - 르 不規則（르 불규칙）— 모르다→몰라、부르다→불러
   - ㅎ 不規則（ㅎ 불규칙）— 파랗다→파래요
   - ㄹ 脫落（ㄹ 탈락）— 들다→드는、살다→사는／삽니다、알다→아니까
   - ㅡ 脫落（ㅡ 탈락）— 크다→커、쓰다→써、바쁘다→바빠
   句中實際用到哪一種就只列那一種；多種並用就**各列一項**，不可合成一條「不規則」。
14. ㅡ 탈락：s 用融合後表面（커、써、커요），不要填 ㅡ／으。
15. 可同時列 해요體／過去等，但具體不規則名不可省略、不可用統稱代替。
16. 句型「值得」寫 n:"值得（-ㄹ 만하다）"，s 填句中「만하／만해／을 만…」可見片段。`;

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
    "補充用法",
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
    const keepSupplementary =
      typeof RulesService !== "undefined" &&
      typeof RulesService.isSupplementaryUsage === "function" &&
      RulesService.isSupplementaryUsage(category);
    if (!ALLOWED_CAT.has(category)) category = "其他";
    if (
      keepSupplementary ||
      (typeof document !== "undefined" &&
        document.getElementById("form-category")?.value === "補充用法")
    ) {
      category = "補充用法";
    }

    let title =
      String(pickField(d, "n", "title")).trim() ||
      String(fallbackTitle || "").trim() ||
      fallbackTitle;
    if (typeof RulesService !== "undefined" && typeof RulesService.canonicalInventoryName === "function") {
      title = RulesService.canonicalInventoryName(title) || title;
    }
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
        if (typeof RulesService !== "undefined" && typeof RulesService.canonicalInventoryName === "function") {
          name = RulesService.canonicalInventoryName(name, { nameZh, nameKo }) || name;
        }
        if (!nameZh || !nameKo) {
          const m = name.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
          if (m) {
            nameZh = nameZh || m[1].trim();
            nameKo = nameKo || m[2].trim();
          } else {
            nameZh = nameZh || name;
          }
        } else {
          const m = name.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
          if (m) {
            nameZh = m[1].trim();
            nameKo = m[2].trim();
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
        const tokenFrom = Number(it?.tokenFrom ?? it?.aTok);
        const tokenTo = Number(it?.tokenTo ?? it?.bTok);
        if (Number.isFinite(tokenFrom)) row.tokenFrom = tokenFrom;
        if (Number.isFinite(tokenTo)) row.tokenTo = tokenTo;
        if (it?.kiwiKind) row.kiwiKind = String(it.kiwiKind);
        const grammarKey = String(pickField(it, "g", "grammarKey", "key")).trim();
        const candidateId = String(pickField(it, "q", "candidateId", "decisionId")).trim();
        if (grammarKey) row.grammarKey = grammarKey;
        if (candidateId) row.candidateId = candidateId;
        if (it?.note) row.note = String(it.note).trim();
        const localRuleId = String(it?.localRuleId || "").trim();
        if (localRuleId) row.localRuleId = localRuleId;
        if (it?.localAttached) row.localAttached = true;
        if (it?.draft && typeof it.draft === "object") {
          row.draft = {
            title: String(it.draft.title || it.draft.n || "").trim(),
            category: String(it.draft.category || it.draft.c || "").trim(),
            explanation: String(it.draft.explanation || it.draft.e || "").trim(),
            structure: String(it.draft.structure || it.draft.s || "").trim(),
          };
        }
        return row;
      })
      .filter(Boolean);

    const rawVocabSrc = (() => {
      const cands = [raw.v, raw.vocab, raw.words, raw.vocabulary, raw.lexicon];
      const nonempty = cands.find((x) => Array.isArray(x) && x.length);
      if (nonempty) return nonempty;
      const firstArr = cands.find((x) => Array.isArray(x));
      if (firstArr) return firstArr;
      const obj = cands.find((x) => x && typeof x === "object" && !Array.isArray(x));
      return obj || [];
    })();
    const rawVocab = Array.isArray(rawVocabSrc)
      ? rawVocabSrc
      : rawVocabSrc && typeof rawVocabSrc === "object"
        ? [rawVocabSrc]
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
      .filter(Boolean)
      .filter((w) => !(typeof Storage !== "undefined" && Storage.isEnglishVocabSkip && Storage.isEnglishVocabSkip(w.surface, w.lemma)));

    const tokens = Array.isArray(raw.tokens) ? raw.tokens : [];
    const out = { summary, translation, items, vocab };
    if (tokens.length) out.tokens = tokens;
    if (raw.mappingFailed) out.mappingFailed = true;
    if (raw.fallbackLegacy) out.fallbackLegacy = true;
    const rejected = Number(raw.apiRejectedCount);
    const unresolved = Number(raw.unresolvedGrammarCount);
    if (Number.isFinite(rejected) && rejected > 0) out.apiRejectedCount = rejected;
    if (Number.isFinite(unresolved) && unresolved > 0) out.unresolvedGrammarCount = unresolved;
    if (raw.apiRepairUsed) out.apiRepairUsed = true;
    return out;
  }

  function isReasoningModel(model) {
    const m = String(model || "").toLowerCase();
    if (!m || /non-reasoning/.test(m)) return false;
    return /grok-4(\.|-|$)/.test(m);
  }

  function messageContentToText(msg) {
    if (!msg || typeof msg !== "object") return "";
    const raw = msg.content;
    if (typeof raw === "string" && raw.trim()) return raw;
    if (Array.isArray(raw)) {
      const joined = raw
        .map((p) => {
          if (typeof p === "string") return p;
          if (!p || typeof p !== "object") return "";
          return p.text || p.content || p.output_text || "";
        })
        .filter(Boolean)
        .join("");
      if (joined.trim()) return joined;
    }
    const alt = msg.reasoning_content || msg.output_text || "";
    return String(alt || "").trim();
  }

  async function chatComplete({ messages, temperature = 0.3, json = false }) {
    const { apiKey, baseUrl, model } = getConfig();
    if (!apiKey) {
      throw new Error("尚未設定 API Key，請先到「設定」填入");
    }

    const url = `${baseUrl}/chat/completions`;
    const extras = {};
    if (isReasoningModel(model)) extras.reasoning_effort = "low";
    if (json) extras.response_format = { type: "json_object" };

    async function post(extra) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 120000) : null;
      try {
        return await fetch(url, {
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
            ...extra,
          }),
          signal: ctrl?.signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    let res;
    try {
      res = await post(extras);
      if (res.status === 400 && Object.keys(extras).length) {
        const preview = await res.text();
        if (/reasoning_effort|response_format|unknown|unsupported|unrecognized|invalid/i.test(preview)) {
          res = await post({});
        } else {
          res = {
            ok: false,
            status: 400,
            statusText: "Bad Request",
            text: async () => preview,
          };
        }
      }
    } catch (err) {
      const msg = err?.message || String(err);
      if (err?.name === "AbortError" || /aborted|timeout/i.test(msg)) {
        throw new Error("API 逾時（超過 2 分鐘）。請再試一次，或到設定把推理較重的模型改成較快的。");
      }
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
        (typeof body?.error === "string" ? body.error : "") ||
        bodyText?.slice(0, 200) ||
        res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error("API Key 無效或無權限（" + res.status + "）");
      }
      throw new Error(`API 錯誤 ${res.status}：${detail}`);
    }

    const content = messageContentToText(body?.choices?.[0]?.message);
    if (!content) {
      throw new Error("API 回傳沒有內容（推理模型可能尚未產出正文，請再試一次）");
    }
    return content;
  }

  function hangulHanziCounts(text) {
    const s = String(text || "");
    return {
      hangul: (s.match(/[\uAC00-\uD7A3]/g) || []).length,
      hanzi: (s.match(/[\u4E00-\u9FFF]/g) || []).length,
    };
  }

  /** 說明與結構式要是中文；韓文只可當標記。 */
  function ruleDraftInChinese(draft) {
    const explanation = String(draft?.explanation || "");
    const structure = String(draft?.structure || "");
    const ec = hangulHanziCounts(explanation);
    const sc = hangulHanziCounts(structure);
    const explanationOk =
      !explanation.trim() ||
      (ec.hangul === 0 && ec.hanzi > 0) ||
      (ec.hanzi >= 4 && ec.hangul <= ec.hanzi + 6);
    const structureOk = !sc.hangul || sc.hanzi >= 1;
    return explanationOk && structureOk;
  }

  const RULE_FILL_USER =
    "請輸出短鍵 JSON：n/c/e/s。n 必須「功能名稱（韓語標記）」，如 禁止（-지 마）、禮貌體（-아/어요）。e 必須繁體中文，禁止用韓文寫說明。s 用中文結構式（詞幹＋…），韓文只留在標記裡。e 無例句。一次一主題。開/閉音節同卡時開在前、全形／分隔。";

  async function requestRuleCard(title, extra) {
    const content = await chatComplete({
      messages: [
        { role: "system", content: RULE_SYSTEM },
        {
          role: "user",
          content: `規則名：${title}\n\n${RULE_FILL_USER}${extra || ""}`,
        },
      ],
      temperature: 0.25,
      json: true,
    });
    return normalizeDraft(extractJson(content), title);
  }

  async function completeRuleFromTitle(title) {
    const t = String(title || "").trim();
    if (!t) throw new Error("請先填寫規則名");
    let draft = await requestRuleCard(t);
    if (!ruleDraftInChinese(draft)) {
      draft = await requestRuleCard(
        t,
        "\n\n上一則把說明或結構寫成韓文了。請重寫：e 整段改繁體中文，s 改成中文結構式（詞幹＋韓語標記）。不要用韓文寫句子。"
      );
    }
    return draft;
  }

  const RULE_BATCH_SYSTEM = `${RULE_SYSTEM}

批次時只輸出：{"r":[{...},{...}]}
r 的順序必須對應使用者列出的規則名；每一項仍用短鍵 n/c/e/s。每一張 e 必須繁體中文，s 必須中文結構式。不要用韓文寫說明。不要 markdown。`;

  function rowsToDrafts(parsed, names) {
    const rawArr = Array.isArray(parsed?.r)
      ? parsed.r
      : Array.isArray(parsed?.rules)
        ? parsed.rules
        : Array.isArray(parsed)
          ? parsed
          : [];
    return names.map((name, i) => {
      let row = rawArr[i];
      if (!row || typeof row !== "object") {
        const want = name;
        row = rawArr.find((x) => {
          const n = String(pickField(x, "n", "title") || "").trim();
          return n && (n === want || n.includes(want) || want.includes(n));
        });
      }
      return normalizeDraft(row || {}, name);
    });
  }

  /**
   * 依規則名批次生成卡片內容（不寫入筆記本）。
   * 回傳與 names 等長的 draft 陣列。
   */
  async function completeRulesFromNames(names) {
    const list = (Array.isArray(names) ? names : []).map((n) => String(n || "").trim());
    if (!list.length) return [];

    const unique = [];
    const mapToUnique = [];
    const seen = new Map();
    for (const n of list) {
      const key = n || "";
      if (!key) {
        mapToUnique.push(-1);
        continue;
      }
      if (seen.has(key)) {
        mapToUnique.push(seen.get(key));
        continue;
      }
      if (unique.length >= 24) {
        mapToUnique.push(-1);
        continue;
      }
      seen.set(key, unique.length);
      mapToUnique.push(unique.length);
      unique.push(key);
    }
    if (!unique.length) {
      return list.map((n) => ({ title: n, category: "其他", explanation: "", structure: "" }));
    }

    const content = await chatComplete({
      messages: [
        { role: "system", content: RULE_BATCH_SYSTEM },
        {
          role: "user",
          content: `請依序為下列規則名各產出一張卡（短鍵 n/c/e/s；包在 r 陣列）。每一張 e 必須繁體中文，禁止用韓文寫說明；s 用中文結構式（詞幹＋韓語標記）：\n${unique
            .map((n, i) => `${i + 1}. ${n}`)
            .join("\n")}`,
        },
      ],
      temperature: 0.25,
      json: true,
    });

    let byUnique = rowsToDrafts(extractJson(content), unique);
    if (byUnique.some((draft) => !ruleDraftInChinese(draft))) {
      const again = await chatComplete({
        messages: [
          { role: "system", content: RULE_BATCH_SYSTEM },
          {
            role: "user",
            content: `上一則有說明或結構寫成韓文。請依序重寫下列每一張：e 整段改繁體中文，s 改成中文結構式（詞幹＋韓語標記）。不要用韓文寫句子。短鍵 n/c/e/s，包在 r：\n${unique
              .map((n, i) => `${i + 1}. ${n}`)
              .join("\n")}`,
          },
        ],
        temperature: 0.2,
        json: true,
      });
      const rewritten = rowsToDrafts(extractJson(again), unique);
      byUnique = byUnique.map((draft, i) =>
        ruleDraftInChinese(draft) ? draft : rewritten[i] || draft
      );
    }

    return list.map((name, i) => {
      const u = mapToUnique[i];
      if (u < 0) return { title: name, category: "其他", explanation: "", structure: "" };
      return byUnique[u] || { title: name, category: "其他", explanation: "", structure: "" };
    });
  }

  /**
   * 尚未掛上本地卡的盤點項，補上本句用的結構／說明草稿（不寫入筆記本）。
   */
  async function fillMissingRuleDrafts(inventory) {
    const inv = inventory && typeof inventory === "object" ? inventory : { items: [] };
    const items = Array.isArray(inv.items) ? inv.items : [];
    const need = [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      if (it.manualRuleId || it.localRuleId) continue;
      if (it.draft && (it.draft.explanation || it.draft.structure || it.draft.title)) continue;
      if (typeof RulesService !== "undefined" && typeof RulesService.findInventoryRule === "function") {
        const match = RulesService.findInventoryRule(it);
        if (match?.owned && match.rule) {
          it.localRuleId = match.rule.id;
          it.localAttached = true;
          it.name = match.rule.title;
          continue;
        }
      }
      need.push(it);
    }
    if (!need.length) return inv;
    const drafts = await completeRulesFromNames(need.map((it) => it.name || it.title || ""));
    for (let i = 0; i < need.length; i++) {
      if (drafts[i]) need[i].draft = drafts[i];
    }
    return inv;
  }

  /** 僅單字／原形：短 prompt、不帶本地規則標題（省 tokens） */
  const VOCAB_ONLY_SYSTEM = `你是韓語詞彙助教。只做實詞原形與簡義，不盤點文法。只輸出一個 JSON（無 markdown／圍欄）。

短鍵：
{"u":"","t":"整句繁中翻譯（單詞則給該詞義）","v":[{"s":"表面形","l":"詞典原形","g":"簡短中文義","p":"動詞|形容詞|名詞|副詞|代詞|數詞|其他","a":0,"b":2}]}

規則：
1. 禁止輸出文法陣列 i／items（助詞、語尾、不規則、母音縮約等一律不要）。
2. v 只列實詞；助詞／語尾／語法標記不要進 v。
2b. **人稱代詞必列**：나／너／저／우리／저희；句中 내（나의）、네、제、내가 也要列（s=句中形，l=나／너／저）。不要因為簡單而省略。
3. 動詞／形容詞 l 須詞典形 -다（봤어요→보다）。
4. p 用完整中文詞性；同 l 去重；g 短；a/b 盡量準。
5. 夾雜的英文（拉丁字母、英文翻譯行）不要列入 v。`;

  const MAP_SYSTEM = `你是韓語文法審核器。依原句、Kiwi 切詞及必處理清單，獨立判定句中實際文法；不知道使用者有哪些本地卡。只輸出 JSON。

格式：{"u":"短摘要","t":"整句繁中翻譯","fn":[{"q":"清單ID或new:序號","x":"confirmed|rejected|reclassified|unknown","g":"穩定文法key","n":"極短中文名（韓語標記）","a":0,"b":0,"c":"語尾|助詞|不規則|時態|敬語|連接|句型|其他","f":"h|m|l","e":"短理由"}]}

硬性規則：
1. 必處理清單的每個 ID 在 fn 恰好出現一次；不可漏答。正確=x confirmed；功能錯誤=x reclassified；不存在=x rejected；真的無法判斷=x unknown。
2. rejected／unknown 可省 n/g/a/b；confirmed／reclassified 必填 g/n/a/b/c/f。補充清單外文法用 q="new:1" 起編。
3. g 是跨句穩定的 ASCII 語義鍵（例 particle:topic、ending:adnominal-present、pattern:eul-su-itda），不可把本地卡名當 key。
4. a/b 是切詞編號且含兩端。只覆蓋文法標記；不含前方實詞。助詞、語尾、不規則、時態、敬語、連接與複合句型都需檢查。
5. n 固定「功能名稱（韓語標記）」，全形括號（例：主題（은/는）、禮貌體（-아/어요）、所有格（의））。確認清單項時 n 盡量與清單名稱相同；新文法也用此格式。禁止 해요體／主題助詞／定語助詞／所有格助詞 等別名。同形異義須依語境改判。母音縮約須點名 해/여/돼 系；不規則須點名種類。
6. 有 줘/주세요 必查請托（-아/어 줘）。수 있-（含 있게/있어/있도록）必查可能；수 없- 必查不可能；沒有 거야/거예요 不可判 ㄹ 거야。
7. 只列實際成立且值得建卡的點；清單候選不成立就明確 rejected，不可為了湊數確認。
8. 形態優先：切詞標籤與清單 kind 衝突時以切詞為準（JKO 的 ㄹ 不是 ETM 未來冠形；EF 無 요 是平語不是禮貌體）。
8e. **더는／다시는／이제는／아직은** 等＝副詞＋主題 은/는，即使切成一個詞也要確認主題（은/는）。는 不是冠形。
8b. **해／해요**：沒有 요 不可確認禮貌體（-아/어요）。하다→해 是母音縮約，不是 ㅎ 不規則。
8c. **인 걸／는 걸**：ㄴ 是이다冠形，걸 是 것＋을 或句末感嘆，禁止未來推測（-(으)ㄹ）。
8d. **-지 않다 ≠ -지 못하다**：沒有 못／못해 不可確認 못하다。않아 的 않 不是副詞 안。使役 -게 하다 必須見到 게。
9. 標準 n：禮貌體（-아/어요）｜平語（해체）｜正式體（-습니다）｜過去（-았/었-）｜主題（은/는）｜主格（이/가）｜賓格（을/를）｜所有格（의）｜冠形詞形（-는）｜冠形詞形（-ㄴ/은）｜未來推測（-(으)ㄹ）｜請托（-아/어 줘）。其餘同樣「功能名稱（韓語）」。`;

  /**
   * Kiwi 切詞後，請模型把語素區間對上規則卡名。
   */
  async function mapGrammarFunctions(query, tokens, candidates, checklistInput, repairOnly = false) {
    const q = String(query || "").trim();
    const checklist = Array.isArray(checklistInput)
      ? checklistInput
      : KoParse.grammarChecklist(tokens, candidates);
    const tokenLines =
      typeof KoParse !== "undefined" && KoParse.compactTokenLines
        ? KoParse.compactTokenLines(tokens)
        : "";
    const candLines =
      typeof KoParse !== "undefined" && KoParse.compactCandidateLines
        ? KoParse.compactCandidateLines(candidates)
        : "";
    const checklistLines =
      typeof KoParse.compactChecklistLines === "function"
        ? KoParse.compactChecklistLines(checklist)
        : "";
    const content = await chatComplete({
      messages: [
        { role: "system", content: MAP_SYSTEM },
        {
          role: "user",
          content: `原文：\n${q}\n\n切詞：\n${tokenLines}\n\n程式候選：\n${candLines || "（無）"}\n\n必處理清單（每個 ID 恰答一次）：\n${checklistLines || "（空；仍可補 new 文法）"}${
            repairOnly ? "\n\n這是補查：只回答上列未完成 ID，不要新增 new 項目。" : ""
          }`,
        },
      ],
      temperature: 0.2,
      json: true,
    });
    return KoParse.parseMappedFunctions(extractJson(content));
  }

  function mergeMappedGrammar(base, patch) {
    const left = base || {};
    const right = patch || {};
    const decisionMap = new Map();
    for (const d of [...(left.decisions || []), ...(right.decisions || [])]) {
      const id = String(d?.candidateId || "").trim();
      if (id) decisionMap.set(id, d);
    }
    const fnMap = new Map();
    for (const fn of [...(left.functions || []), ...(right.functions || [])]) {
      const id = String(fn?.candidateId || "").trim();
      const key = id || `${fn?.grammarKey || fn?.name || "?"}:${fn?.tokenFrom}:${fn?.tokenTo}`;
      fnMap.set(key, fn);
    }
    const rejected = new Set(
      [...decisionMap.values()]
        .filter((d) => d.status === "rejected" || d.status === "unknown")
        .map((d) => d.candidateId)
    );
    return {
      functions: [...fnMap.values()].filter(
        (fn) => !fn.candidateId || !rejected.has(fn.candidateId)
      ),
      decisions: [...decisionMap.values()],
      translation: left.translation || right.translation || "",
      summary: left.summary || right.summary || "",
    };
  }

  async function repairGrammarFunctions(query, tokens, candidates, unresolved) {
    const ids = new Set((unresolved || []).map((x) => x.id));
    const relevant = (candidates || []).filter((c) => ids.has(KoParse.candidateDecisionId(c)));
    return mapGrammarFunctions(query, tokens, relevant, unresolved, true);
  }

  /**
   * 先 Kiwi 切詞、再對卡（對齊日語 school-parse；切詞失敗時由呼叫端回退舊盤點）。
   */
  async function inventoryByKoParse(query, opts = {}) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");
    if (typeof KoParse === "undefined" || !KoParse.fromKiwi) {
      throw new Error("KoParse 未載入");
    }
    if (typeof KiwiService === "undefined" || !KiwiService.isEnabled()) {
      throw new Error("形態素分析未開啟");
    }
    await KiwiService.ensureReady();
    const kiwiToks = await KiwiService.tokenize(q);
    if (!Array.isArray(kiwiToks) || !kiwiToks.length) {
      throw new Error("切詞結果沒有有效語素");
    }
    const tokens = KoParse.fromKiwi(q, kiwiToks);
    if (!tokens.length) throw new Error("切詞結果無法還原原文");

    const candidates = KoParse.deterministicFunctions(q, tokens);
    const checklist = KoParse.grammarChecklist(tokens, candidates);
    let mapped = { functions: [], decisions: [], translation: "", summary: "" };
    let firstMappingFailed = false;
    try {
      mapped = await mapGrammarFunctions(q, tokens, candidates, checklist);
    } catch (err) {
      console.warn("[mapGrammarFunctions]", err);
      firstMappingFailed = true;
      mapped = {
        functions: [],
        decisions: [],
        translation: "",
        summary: "形態素切詞完成；文法對卡未完成，僅列出高信心項目",
      };
    }

    let unresolved = KoParse.unresolvedGrammarChecklist(checklist, mapped);
    let apiRepairUsed = false;
    if (unresolved.length) {
      apiRepairUsed = true;
      try {
        const repaired = await repairGrammarFunctions(q, tokens, candidates, unresolved);
        mapped = mergeMappedGrammar(mapped, repaired);
      } catch (err) {
        console.warn("[repairGrammarFunctions]", err);
      }
      unresolved = KoParse.unresolvedGrammarChecklist(checklist, mapped);
    }
    const mappingFailed = unresolved.length > 0;
    const items = KoParse.functionsToItems(tokens, mapped.functions, candidates, {
      mappingFailed,
      src: q,
      candidateDecisions: mapped.decisions,
    });
    const vocab = opts.skipVocab ? [] : KoParse.tokensToVocab(tokens);
    if (typeof RulesService !== "undefined" && RulesService.enrichInventoryWithSurfaceHints) {
      const hinted = RulesService.enrichInventoryWithSurfaceHints(q, { items, vocab, translation: mapped.translation });
      if (Array.isArray(hinted.items)) {
        for (const extra of hinted.items) {
          if (!items.some((it) => it.name === extra.name && it.start === extra.start && it.end === extra.end)) {
            items.push(extra);
          }
        }
      }
    }
    const nTok = tokens.filter((t) => t.pos !== "記號").length;
    const apiRejectedCount = (mapped.decisions || []).filter(
      (d) => d.status === "rejected"
    ).length;
    return {
      summary:
        mapped.summary ||
        (mappingFailed
          ? `形態素切詞 ${nTok} 塊 · 尚有 ${unresolved.length} 項待確認`
          : `形態素切詞 ${nTok} 塊 · 文法 ${items.length} 點`),
      translation: mapped.translation || "",
      items,
      vocab,
      tokens: KoParse.slimTokens(tokens),
      mappingFailed,
      firstMappingFailed,
      apiRejectedCount,
      unresolvedGrammarCount: unresolved.length,
      apiRepairUsed,
    };
  }

  /**
   * 查詢時文法盤點
   * @param {string} query
   */
  async function inventoryGrammar(query) {
    const q = String(query || "").trim();
    if (!q) throw new Error("請輸入查詢內容");

    const content = await chatComplete({
      messages: [
        { role: "system", content: INVENTORY_SYSTEM },
        {
          role: "user",
          content: `查詢內容：\n${q}\n\n請先獨立盤點句中所有實際文法，不參考任何本地筆記本內容。請輸出短鍵 JSON（u/t/i/v）。t 整句翻譯；i 文法；v 實詞原形+簡義（含 a/b 或 s）。`,
        },
      ],
      temperature: 0.2,
      json: true,
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
          content: `查詢內容：\n${q}\n\n只輸出 u/t/v（禁止 i）。v 必填、不可空陣列。動詞／形容詞 l 用 -다 詞典形。`,
        },
      ],
      temperature: 0.2,
      json: true,
    });

    const inv = normalizeInventory(extractJson(content));
    inv.items = [];
    if (!inv.summary) inv.summary = `API 單字：${(inv.vocab || []).length} 詞`;
    if (!(inv.vocab || []).length && !inv.translation) {
      throw new Error("API 沒有回傳單字資料，請再試一次");
    }
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
    if (typeof Storage !== "undefined" && Storage.isEnglishVocabSkip && Storage.isEnglishVocabSkip(surf)) {
      throw new Error("這是英文詞，已略過（不查詢、不收入單字庫）");
    }
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
      json: true,
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

  const LYRIC_SPLIT_SYSTEM = `你是韓語歌詞編輯。把文本依「畫面／短語／子句」切開，讓每一行是一個完整意思單位。

必須只輸出一個 JSON 物件（不要 markdown、不要圍欄、不要其他文字）：
{"lines":["第一行","第二行"]}

規則：
1. 不要改寫、不要翻譯、不要增刪用字、不要加標點。只決定換行。原文順序與用字必須原樣保留。
2. 詞與詞之間的空白要保留在行內，不要每個空格都斷行。已有換行可當句界；不要合併意思不相接的行。
3. 每一行最多 12 字（韓文一音節算 1，含空格）。超過 12 字必須再切；已 ≤12 且意思完整的行不要再切。
4. 切在「畫面／短語交界」，不要切在修飾關係中間：
   - 「A의 B」盡量整組保留（백금빛의 바다、정체 속）。禁止切成「백금빛의／바다」。
   - 「A 속에서／앞에서／뒤에／사이에」是完整場所短語，切在該短語之後、下一句主語之前。
   - 主謂句（당신은 도시로 돌아간다）若 ≤12 字整句保留，不要切成「당신은／도시로 돌아간다」。
5. 不要把詞從中間切斷。하고 있다／아 주다／지 않다／ㄹ 수 있다 保持同一行。
6. 連接語尾 고／서／며／는데／지만／니까 可當切點（切在該語尾之後）。

正確例子：
輸入：선글라스 너머 백금빛 바다 정체 속에서 당신은 도시로 돌아간다
輸出：{"lines":["선글라스 너머","백금빛 바다","정체 속에서","당신은 도시로 돌아간다"]}`;

  const PHONE_LINE_SOFT = 10;
  const PHONE_LINE_HARD = 12;

  function charLen(s) {
    return Array.from(String(s || "")).length;
  }

  function compactSource(s) {
    return String(s || "").replace(/\s+/g, "");
  }

  function indexAfterChars(s, count) {
    return Array.from(String(s || "")).slice(0, Math.max(0, count)).join("").length;
  }

  function scoreMeaningCut(chars, i) {
    const n = chars.length;
    if (i < 3 || i > n - 2) return -1;
    const last = chars[i - 1] || "";
    const next = chars[i] || "";
    const tail = chars.slice(Math.max(0, i - 6), i).join("");
    const rest = chars.slice(i).join("");
    if (last === "의") return -1;
    if (last === "하" && /[고지였여]/.test(next)) return -1;
    if (last === "했" && /[어어요다]/.test(next)) return -1;
    if ((last === "아" || last === "어") && /[요줘서도]/.test(next)) return -1;
    if (last === "지" && /^\s*않/.test(rest)) return -1;
    if (last === "고" && /^\s*있/.test(rest)) return -1;
    if (last === "수" && /^\s*[있없]/.test(rest)) return -1;
    if (/\s/.test(last) && /않/.test(next) && (chars[i - 2] || "") === "지") return -1;
    if (/\s/.test(last) && /있/.test(next) && (chars[i - 2] || "") === "고") return -1;
    if (/\s/.test(last) && /[있없]/.test(next) && (chars[i - 2] || "") === "수") return -1;
    let score = 0;
    if (/[。．｡！？!?…]/.test(last)) score += 100;
    else if (/[、，,､]/.test(last)) score += 86;
    else if (
      tail.endsWith("지만") ||
      tail.endsWith("는데") ||
      tail.endsWith("니까") ||
      tail.endsWith("면서") ||
      tail.endsWith("다가") ||
      tail.endsWith("도록")
    ) {
      score += 78;
    } else if (tail.endsWith("에서") || tail.endsWith("으로") || tail.endsWith("에게") || tail.endsWith("속에")) {
      score += 72;
    } else if (last === "고" || last === "서" || last === "며" || last === "면") score += 68;
    else if (last === "을" || last === "를") score += 48;
    else if (last === "에" || last === "로" || last === "와" || last === "과") score += 40;
    else if (/\s/.test(last)) score += 40;
    else if (last === "은" || last === "는" || last === "이" || last === "가") score += 18;
    else return -1;
    if (i <= PHONE_LINE_HARD) score += 8;
    const dist = Math.abs(i - PHONE_LINE_SOFT);
    score += Math.max(0, 10 - dist);
    return score;
  }

  function findMeaningCut(s) {
    const chars = Array.from(String(s || ""));
    const n = chars.length;
    if (n <= PHONE_LINE_HARD) return 0;
    const min = 3;
    const max = Math.min(PHONE_LINE_HARD, n - 2);
    let bestI = 0;
    let bestScore = 9;
    for (let i = max; i >= min; i -= 1) {
      const sc = scoreMeaningCut(chars, i);
      if (sc > bestScore) {
        bestScore = sc;
        bestI = i;
      }
    }
    return bestI ? indexAfterChars(s, bestI) : 0;
  }

  function splitLongLineByMeaning(line) {
    const s = String(line || "").trim();
    if (!s) return [];
    if (charLen(s) <= PHONE_LINE_HARD) return [s];
    const cut = findMeaningCut(s);
    if (!cut) {
      const chars = Array.from(s);
      const left = chars.slice(0, PHONE_LINE_HARD).join("");
      const right = chars.slice(PHONE_LINE_HARD).join("");
      return [left, ...splitLongLineByMeaning(right)];
    }
    const left = s.slice(0, cut).trim();
    const right = s.slice(cut).trim();
    if (!left || !right) return [s];
    return [left, ...splitLongLineByMeaning(right)];
  }

  function enforcePhoneLineLength(lines) {
    return (Array.isArray(lines) ? lines : [lines])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .flatMap((line) => splitLongLineByMeaning(line));
  }

  function chunkLyricText(text) {
    const lines = String(text || "").split(/\r?\n/);
    const chunks = [];
    let buf = [];
    let size = 0;
    const flush = () => {
      if (!buf.length) return;
      chunks.push(buf.join("\n"));
      buf = [];
      size = 0;
    };
    for (const line of lines) {
      const add = line.length + 1;
      if (buf.length && size + add > 1400) flush();
      buf.push(line);
      size += add;
    }
    flush();
    return chunks.length ? chunks : [String(text || "")];
  }

  function normalizeSplitLines(parsed) {
    let arr = [];
    if (Array.isArray(parsed)) arr = parsed;
    else if (Array.isArray(parsed?.lines)) arr = parsed.lines;
    else if (Array.isArray(parsed?.sentences)) arr = parsed.sentences;
    return arr.map((x) => String(x || "").trim()).filter(Boolean);
  }

  async function splitLyricChunk(chunk) {
    const content = await chatComplete({
      messages: [
        { role: "system", content: LYRIC_SPLIT_SYSTEM },
        {
          role: "user",
          content: `請依畫面／短語切開，每行最多 12 字。詞間空白不要逐一斷行。只輸出 JSON。\n\n${chunk}`,
        },
      ],
      temperature: 0.15,
      json: true,
    });
    return normalizeSplitLines(extractJson(content));
  }

  async function splitLyricLines(text) {
    const raw = String(text || "");
    if (!raw.trim()) throw new Error("請先貼上歌詞或文本");
    const chunks = chunkLyricText(raw);
    const collected = [];
    for (const chunk of chunks) {
      const part = await splitLyricChunk(chunk);
      collected.push(...part);
    }
    const lines = enforcePhoneLineLength(collected);
    if (!lines.length) throw new Error("AI 沒有回傳可分行的句子");
    const src = compactSource(raw);
    const out = compactSource(lines.join(""));
    if (src && out && src !== out) {
      if (src.includes(out) || out.includes(src)) {
        return lines;
      }
      throw new Error("AI 改動了原文用字，已取消套用");
    }
    return lines;
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
    completeRulesFromNames,
    fillMissingRuleDrafts,
    completeWordFromSurface,
    splitLyricLines,
    enforcePhoneLineLength,
    mapGrammarFunctions,
    inventoryByKoParse,
    inventoryGrammar,
    inventoryVocabOnly,
    normalizeInventory,
    testConnection,
  };
})();
