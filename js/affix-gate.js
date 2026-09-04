/**
 * 單音／받침語素上色閘門
 * 短針只負責產生候選；通過表面＋邊界＋宿主／後接＋（可選）Kiwi 才上色。
 */
const AffixGate = (() => {
  function isHangulSyllable(ch) {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  function hasRieulBatchim(ch) {
    if (typeof RulesService !== "undefined" && RulesService.hasRieulBatchim) {
      return RulesService.hasRieulBatchim(ch);
    }
    const c = String(ch || "");
    if (!c) return false;
    const code = c.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 === 8;
  }

  function parseKo(title) {
    if (typeof RulesService !== "undefined" && RulesService.parseBilingualTitle) {
      return RulesService.parseBilingualTitle(title).ko || "";
    }
    const m = String(title || "").trim().match(/^(.+?)[（(]\s*(.+?)\s*[）)]\s*$/);
    return m ? m[2].trim() : "";
  }

  const ENDING_STACK = [
    "주세요",
    "십시오",
    "십니까",
    "습니다",
    "습니까",
    "ㅂ니다",
    "ㅂ니까",
    "시겠어요",
    "셨어요",
    "세요",
    "셔요",
    "면서",
    "지만",
    "는데",
    "은데",
    "니까",
    "려고",
    "도록",
    "겠어요",
    "겠다",
    "어요",
    "아요",
    "여요",
    "어서",
    "아서",
    "여서",
    "겠",
    "었",
    "았",
    "였",
    "면",
    "며",
    "고",
    "지",
    "게",
    "네",
    "죠",
    "요",
    "다",
    "서",
    "도",
    "야",
    "는",
    "을",
    "를",
    "은",
    "이",
    "가",
    "러",
    "니",
    "까",
    "라",
    "셔",
  ];

  const HONORIFIC_FUSED = [
    "으십니다",
    "으십시오",
    "으십니까",
    "으세요",
    "십니다",
    "십시오",
    "십니까",
    "세요",
    "셔요",
    "으셔",
    "으시",
  ];

  const ADN_HEAD =
    /^(사람|것|거|때|곳|날|집|분|중|듯|수|줄|편|말|일|길|쪽|책|영화|음식|친구|학생|소식|이야기|문제|방법|이유|동안|사이|기분|소리|모습|점|부분|경우|옷|색|맛|방|물|밥|차|꽃|나무|하늘|마음|꿈|돈|힘|뜻|눈|손|발|머리|집|옷|말)/;

  const VERBISH_TAIL = /(다|요|게|고|서|며|면|지|네|죠|습니다|ㅂ니다|세요|는데|어서|아서)$/;

  function stripEndingStack(s) {
    let rest = String(s || "");
    let changed = true;
    while (changed && rest) {
      changed = false;
      for (const p of ENDING_STACK) {
        if (rest.startsWith(p)) {
          rest = rest.slice(p.length);
          changed = true;
          break;
        }
      }
    }
    return rest;
  }

  function expandRun(src, start, end) {
    let left = start;
    while (left > 0 && isHangulSyllable(src[left - 1])) left--;
    let right = end;
    while (right < src.length && isHangulSyllable(src[right])) right++;
    return {
      left,
      right,
      word: src.slice(left, right),
      leftText: src.slice(left, start),
      rightText: src.slice(end, right),
    };
  }

  function nextHangulWord(src, from) {
    let i = from;
    while (i < src.length && !isHangulSyllable(src[i])) i++;
    if (i >= src.length) return "";
    let j = i;
    while (j < src.length && isHangulSyllable(src[j])) j++;
    return src.slice(i, j);
  }

  function looksNoun(word) {
    const w = String(word || "");
    if (!w) return false;
    if (ADN_HEAD.test(w)) return true;
    if (/^(것|거|수|줄|때|듯|중|분|곳)$/.test(w)) return true;
    return false;
  }

  function looksVerbishWord(word) {
    const w = String(word || "");
    if (!w) return false;
    if (looksNoun(w)) return false;
    return VERBISH_TAIL.test(w);
  }

  function blobOf(rule, item) {
    return [
      rule?.title,
      rule?.category,
      rule?.structure,
      rule?.explanation,
      item?.name,
      item?.nameKo,
      item?.nameZh,
      item?.category,
    ]
      .map((x) => String(x || ""))
      .join("\n");
  }

  function hangulSyllablesIn(s) {
    return [...String(s || "").normalize("NFC")].filter((ch) => isHangulSyllable(ch));
  }

  function hasNieunBatchim(ch) {
    const c = String(ch || "");
    if (!c) return false;
    const code = c.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 === 4;
  }

  /** 은/는、이/가：斜線兩側都要當可上色表面，不可只留左側 */
  function markerSurfaceSyllables(ko) {
    const raw = String(ko || "").normalize("NFC");
    if (!raw) return [];
    const parts = raw.split(/[\/／|｜,，]/);
    const out = [];
    const seen = new Set();
    for (const part of parts) {
      const cleaned = String(part)
        .replace(/^[-~〜()（）\s]+/, "")
        .replace(/[-~〜()（）\s]+$/, "");
      for (const ch of hangulSyllablesIn(cleaned)) {
        if (seen.has(ch)) continue;
        seen.add(ch);
        out.push(ch);
      }
    }
    return out;
  }

  /**
   * 從規則標題／分類／結構推依附輪廓。推不出則 null（不額外攔）。
   */
  function inferProfile(rule, item) {
    const title = String(rule?.title || item?.name || "");
    const cat = String(rule?.category || item?.category || "");
    const structure = String(rule?.structure || "");
    const blob = blobOf(rule, item);
    const ko = parseKo(title) || String(item?.nameKo || "");
    const joined = `${blob}\n${ko}`;

    const isFutureEul =
      typeof RulesService !== "undefined" && RulesService.isFutureEulRule
        ? RulesService.isFutureEulRule(rule) ||
          RulesService.isFutureEulRule({ title }) ||
          RulesService.isFutureEulRule({ title: String(item?.name || "") })
        : /\(으\)ㄹ/.test(title) && /未來|推測|冠形|관형|定語/.test(joined);

    if (/人稱主題縮約|人稱賓格縮約/.test(title) || /[（(]\s*(난|넌|전|날|널|절)\s*[）)]/.test(title)) {
      const form = (ko.match(/난|넌|전|날|널|절/) || [])[0] || hangulSyllablesIn(ko)[0] || "";
      const jx = /난|넌|전/.test(form + joined);
      return {
        role: "contraction",
        host: "noun",
        surfaces: form ? [form] : ["난", "넌", "전", "날", "널", "절"],
        kiwiTags: jx ? ["JX"] : ["JKO", "JX"],
        kiwiForms: jx ? ["는", "은", "ㄴ", form] : ["를", "을", "ㄹ", form],
      };
    }

    if (
      (/冠形詞形/.test(joined) && /ㄴ\s*[\/／]\s*은|-ㄴ\/은|[（(]\s*-?ㄴ\s*[\/／]\s*은/.test(title + ko)) ||
      (/冠形|관형|定語/.test(joined) && /ㄴ\s*[\/／]\s*은/.test(title + ko) && !/는/.test(title))
    ) {
      return {
        role: "adnominal-n",
        host: "predicate",
        surfaces: ["은"],
        jamo: "ㄴ",
        kiwiTags: ["ETM"],
        kiwiForms: ["은", "ㄴ"],
      };
    }

    if (/(條件|가정)/.test(title) && /면/.test(ko + title)) {
      return {
        role: "ending",
        host: "predicate",
        surfaces: ["면", "으면"],
        kiwiTags: ["EC"],
        kiwiForms: ["면", "으면"],
      };
    }

    if (/背景對比/.test(title) && /는데|은데|인데|ㄴ데/.test(ko + title)) {
      return {
        role: "ending",
        host: "predicate",
        surfaces: ["는데", "은데", "인데", "ㄴ데", "데"],
        kiwiTags: ["EC"],
        kiwiForms: ["는데", "은데", "인데", "데"],
      };
    }

    if (/平語|해체|반말/.test(joined) && !/해요|습니다|합니다/.test(title)) {
      return {
        role: "haeche",
        host: "predicate",
        surfaces: ["아", "어", "여", "해"],
        kiwiTags: ["EF", "EC"],
        kiwiForms: ["아", "어", "여", "해"],
      };
    }

    if (
      (/禮貌體|해요體|해요체/.test(joined) && /아\s*\/\s*어/.test(joined + ko)) ||
      /[（(]\s*-?아\s*\/\s*어요\s*[）)]/.test(title)
    ) {
      return {
        role: "haeyo",
        host: "predicate",
        surfaces: ["아요", "어요", "여요", "해요"],
        kiwiTags: ["EF"],
        kiwiForms: ["아요", "어요", "여요", "해요", "요"],
      };
    }

    if (
      /主體敬語|尊待/.test(joined) ||
      /（-시-）|\(-시-\)|-시-/.test(title) ||
      (/시/.test(ko) && /敬語|존대|honori/i.test(joined))
    ) {
      return {
        role: "honorific-si",
        host: "predicate",
        surfaces: ["시", "으시"],
        kiwiTags: ["EP"],
        kiwiForms: ["시", "으시"],
      };
    }

    if (typeof RulesService !== "undefined" && RulesService.inferEulFrame) {
      const frame = RulesService.inferEulFrame({ title, structure, category: cat, name: title });
      if (frame && frame.id === "geoya") {
        return { role: "eul-frame", frameId: "geoya", surfaces: frame.surfaces };
      }
      if (frame && (frame.id === "su-eob" || frame.id === "su-it")) {
        return { role: "eul-frame", frameId: frame.id, surfaces: frame.surfaces };
      }
    }

    if (isFutureEul) {
      return {
        role: "adnominal-l",
        host: "predicate",
        surfaces: ["을"],
        jamo: "ㄹ",
        kiwiTags: ["ETM"],
        kiwiForms: ["을", "ㄹ"],
        follower: "noun",
      };
    }

    if (
      /賓格/.test(joined) &&
      /을\s*\/\s*를|을\/를/.test(joined)
    ) {
      return {
        role: "particle-object",
        host: "noun",
        surfaces: ["을", "를", "걸", "날", "널", "절"],
        kiwiTags: ["JKO"],
        kiwiForms: ["을", "를", "ㄹ"],
      };
    }

    if (/所有格/.test(joined) && /[（(]\s*의\s*[）)]/.test(title + "（" + ko + "）")) {
      return {
        role: "particle-ui",
        host: "noun",
        surfaces: ["의", "내", "네", "제"],
        kiwiTags: ["JKG", "NP", "MM"],
        kiwiForms: ["의", "내", "네", "제"],
      };
    }

    if (/지\s*못|못\s*하/.test(joined) && /否定/.test(joined)) {
      return {
        role: "neg-mot",
        host: "predicate",
        surfaces: ["못", "못해", "못한다"],
        kiwiTags: ["MAG", "VX", "VV"],
        kiwiForms: ["못", "못해"],
      };
    }

    if (/[（(]\s*안\s*[）)]/.test(title) && /簡略|短形|否定/.test(joined)) {
      return {
        role: "neg-an",
        host: "predicate",
        surfaces: ["안"],
        kiwiTags: ["MAG", "MAJ"],
        kiwiForms: ["안"],
      };
    }

    if (/使役/.test(title) && /게/.test(ko + structure)) {
      return {
        role: "causative-ge",
        host: "predicate",
        surfaces: ["게"],
        kiwiTags: ["EC"],
        kiwiForms: ["게"],
      };
    }

    if (/이야/.test(ko) && /敘述|指定|이야/.test(joined)) {
      return {
        role: "copula-iya",
        host: "noun",
        surfaces: ["이야"],
        kiwiTags: ["EF", "EC"],
        kiwiForms: ["이야", "야"],
      };
    }

    if (
      (/副詞化|부사화|副詞形/.test(joined) && /게/.test(title + ko + structure)) ||
      (/[（(]\s*-?게\s*[）)]/.test(title) && /語尾|連接|어미|語尾/.test(joined))
    ) {
      return {
        role: "ending-ge",
        host: "predicate",
        surfaces: ["게"],
        kiwiTags: ["EC"],
        kiwiForms: ["게"],
      };
    }

    if (/助詞/.test(cat) || /助詞/.test(joined)) {
      const surfaces = markerSurfaceSyllables(ko);
      if (surfaces.length && surfaces.every((s) => s.length === 1) && surfaces.length <= 4) {
        return {
          role: "particle",
          host: "noun",
          surfaces,
          title,
          kiwiTags: ["JKO", "JKS", "JKC", "JKG", "JKB", "JX", "JC"],
          kiwiForms: surfaces,
        };
      }
    }

    if (/語尾|連接|時態|敬語/.test(cat) || /詞幹\s*＋/.test(structure)) {
      const syl = hangulSyllablesIn(ko);
      const one = [...new Set(syl.filter((s) => s.length === 1))];
      if (one.length === 1) {
        return {
          role: "ending",
          host: "predicate",
          surfaces: one,
          kiwiTags: ["EC", "EF", "EP", "ETM"],
          kiwiForms: one,
        };
      }
    }

    return null;
  }

  function tokenRange(src, tok) {
    const visStart = Number(tok?.start);
    const visEnd = Number(tok?.end);
    if (Number.isFinite(visStart) && Number.isFinite(visEnd) && visEnd > visStart) {
      return { start: visStart, end: visEnd };
    }
    if (typeof KiwiService !== "undefined" && KiwiService.tokenSurfaceRange) {
      return KiwiService.tokenSurfaceRange(src, tok);
    }
    const start = Number(tok?.position ?? tok?.kiwiPosition) || 0;
    const len = Number(tok?.length) || 0;
    if (len > 0) return { start, end: Math.min(src.length, start + len) };
    if (start > 0) return { start: start - 1, end: start };
    return { start, end: Math.min(src.length, start + 1) };
  }

  function baseTag(tag) {
    return String(tag || "").split(/[-+]/)[0];
  }

  function kiwiWitness(src, tokens, loc, tags, forms) {
    if (!Array.isArray(tokens) || !tokens.length) return "none";
    for (const tok of tokens) {
      const r = tokenRange(src, tok);
      if (!(r.start < loc.end && loc.start < r.end)) continue;
      const tag = baseTag(tok.tag);
      const form = String(tok.str || tok.form || tok.word || "").normalize("NFC");
      if (tags && tags.includes(tag)) {
        if (!forms || !forms.length || forms.includes(form)) return "hit";
      }
    }
    return "miss";
  }

  function getTokens(src, opts) {
    if (opts && Array.isArray(opts.tokens)) return opts.tokens;
    if (typeof KiwiService !== "undefined" && KiwiService.cachedTokens) {
      const cached = KiwiService.cachedTokens(src);
      if (cached && cached.length) return cached;
    }
    return null;
  }

  function shouldGate(surface, profile) {
    if (!profile) return false;
    const s = String(surface || "");
    const always = new Set([
      "haeyo",
      "haeche",
      "neg-mot",
      "neg-an",
      "causative-ge",
      "copula-iya",
      "particle-ui",
      "particle-object",
      "adnominal-l",
      "adnominal-n",
    ]);
    if (always.has(profile.role)) return true;
    if (s.length <= 1) return true;
    return false;
  }

  function acceptHonorific(src, loc, run, tokens) {
    const wit = kiwiWitness(src, tokens, loc, ["EP"], ["시", "으시"]);
    if (wit === "hit") return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    if (run.rightText) {
      return stripEndingStack(run.rightText) === "";
    }
    // 無後接語尾的詞尾「시」：二字詞（잠시／당시／표시）幾乎都是詞彙
    return false;
  }

  function acceptAdnominalL(src, loc, surface, run, tokens) {
    const okSurface = surface === "을" || (surface.length === 1 && hasRieulBatchim(surface));
    if (!okSurface) return false;
    const wit = kiwiWitness(src, tokens, loc, ["ETM"], ["을", "ㄹ"]);
    if (wit === "hit") {
      const asObj = kiwiWitness(src, tokens, loc, ["JKO"], ["을", "를", "ㄹ"]);
      if (asObj === "hit") return false;
      return true;
    }
    if (wit === "miss" && tokens && tokens.length) {
      return false;
    }
    const rest = String(src || "").slice(run.right).replace(/\s+/g, "");
    if (/^수(없|있)/.test(rest)) return false;
    if (/^(거야|거예요|거에요|거다|겁니다|것이다|것이에요)/.test(rest)) return false;
    if (/^만하/.test(rest)) return false;
    const follow = nextHangulWord(src, run.right);
    if (!follow) return false;
    if (looksVerbishWord(follow)) return false;
    return looksNoun(follow);
  }

  function acceptObject(src, loc, surface, run, tokens) {
    const fusedOk = surface === "걸" || surface === "날" || surface === "널" || surface === "절";
    const batchimOk = surface.length === 1 && hasRieulBatchim(surface);
    if (surface !== "을" && surface !== "를" && !fusedOk && !batchimOk) return false;
    const asEtm = kiwiWitness(src, tokens, loc, ["ETM"], ["을", "ㄹ"]);
    if (asEtm === "hit") return false;
    const wit = kiwiWitness(src, tokens, loc, ["JKO"], ["을", "를", "ㄹ"]);
    if (wit === "hit") return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    if (!run.leftText && !fusedOk) return false;
    if (run.rightText && stripEndingStack(run.rightText) !== "") return false;
    const follow = nextHangulWord(src, run.right);
    if (!run.rightText && looksNoun(follow)) return false;
    return true;
  }

  function acceptGe(src, loc, surface, run, tokens) {
    if (surface !== "게") return false;
    if (/^[이거저]$/.test(run.leftText) && !run.rightText) return false;
    const wit = kiwiWitness(src, tokens, loc, ["EC"], ["게"]);
    if (wit === "hit") return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    if (!run.leftText) return false;
    if (run.rightText && stripEndingStack(run.rightText) !== "") return false;
    return true;
  }

  function acceptGenericEnding(src, loc, surface, run, profile, tokens) {
    if (profile.surfaces && profile.surfaces.length && !profile.surfaces.includes(surface)) {
      return false;
    }
    const wit = kiwiWitness(src, tokens, loc, profile.kiwiTags, profile.kiwiForms);
    if (wit === "hit") return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    if (!run.leftText) return false;
    if (run.rightText && stripEndingStack(run.rightText) !== "") return false;
    return true;
  }

  function acceptContraction(src, loc, surface, profile, tokens) {
    if (profile.surfaces && profile.surfaces.length && profile.surfaces.includes(surface)) {
      const wit = kiwiWitness(src, tokens, loc, profile.kiwiTags, profile.kiwiForms);
      if (wit === "hit") return true;
      if (wit === "miss" && tokens && tokens.length) {
        // 난：Kiwi 常是 나＋ㄴ/JX，表面仍是 난
        const witJamo = kiwiWitness(src, tokens, loc, profile.kiwiTags, ["ㄴ", "ㄹ", "는", "를", "은", "을"]);
        return witJamo !== "miss";
      }
      return true;
    }
    const wit = kiwiWitness(src, tokens, loc, profile.kiwiTags, profile.kiwiForms);
    return wit === "hit";
  }

  function acceptAdnominalN(src, loc, surface, tokens) {
    const ok =
      surface === "은" ||
      (surface.length === 1 && hasNieunBatchim(surface));
    if (!ok) return false;
    const wit = kiwiWitness(src, tokens, loc, ["ETM"], ["은", "ㄴ"]);
    if (wit === "hit") {
      const asTopic = kiwiWitness(src, tokens, loc, ["JX"], ["은", "는", "ㄴ"]);
      if (asTopic === "hit") return false;
      return true;
    }
    if (wit === "miss" && tokens && tokens.length) return false;
    return ok;
  }

  function acceptHaeche(src, loc, surface, run, tokens) {
    if (/^[아어여해]$/.test(surface)) {
      const wit = kiwiWitness(src, tokens, loc, ["EF", "EC"], ["아", "어", "여", "해"]);
      if (wit === "hit") return true;
      if (wit === "miss" && tokens && tokens.length) return false;
      return true;
    }
    const wit = kiwiWitness(src, tokens, loc, ["EF", "EC"], ["아", "어", "여", "해"]);
    return wit === "hit";
  }

  function acceptHaeyo(src, loc, surface, run, tokens) {
    if (!/요$/.test(surface) && surface !== "요") return false;
    const wit = kiwiWitness(src, tokens, loc, ["EF"], ["아요", "어요", "여요", "해요", "요"]);
    if (wit === "hit") return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    return /[아어여해]요$/.test(surface) || surface === "해요";
  }

  function acceptRequireNeedles(src, loc, surface, profile, tokens) {
    const needles = profile.surfaces || [];
    if (needles.length && !needles.some((n) => surface === n || String(src || "").includes(n))) {
      return false;
    }
    if (needles.length && needles.includes(surface)) {
      const wit = kiwiWitness(src, tokens, loc, profile.kiwiTags, profile.kiwiForms);
      if (wit === "hit") return true;
      if (wit === "miss" && tokens && tokens.length) return false;
      return true;
    }
    return needles.some((n) => String(src || "").includes(n));
  }

  function topicSenseAt(src, loc) {
    if (typeof RulesService !== "undefined" && RulesService.classifyEunNeunAt) {
      return RulesService.classifyEunNeunAt(src, loc.start, loc.end);
    }
    return "unknown";
  }

  /** 더는／움직임은：Kiwi 常標 MAG 或 ETM，不能因為沒有 JX 就否決主題 */
  function acceptFusedTopic(src, loc, surface, run, tokens) {
    if (surface !== "은" && surface !== "는") return false;
    const sense = topicSenseAt(src, loc);
    if (sense === "adnominal") return false;
    if (sense === "topic") return true;
    if (typeof KiwiService !== "undefined" && typeof KiwiService.fusedTopicFromForm === "function") {
      if (KiwiService.fusedTopicFromForm(run.word)) return true;
      if (run.leftText && KiwiService.fusedTopicFromForm(run.leftText + surface)) return true;
    }
    if (Array.isArray(tokens)) {
      for (const tok of tokens) {
        const r = tokenRange(src, tok);
        if (!(r.start < loc.end && loc.start < r.end)) continue;
        const form = String(tok.str || tok.form || tok.word || "").normalize("NFC");
        if (typeof KiwiService !== "undefined" && typeof KiwiService.fusedTopicFromForm === "function") {
          if (KiwiService.fusedTopicFromForm(form)) return true;
        }
      }
    }
    return false;
  }

  function acceptParticle(src, loc, surface, run, profile, tokens) {
    if (surface === "에" && String(src || "").slice(loc.start, loc.start + 2) === "에서") {
      const title = String(profile?.title || "");
      if (!/에서/.test(title)) return false;
    }
    if (profile.surfaces && profile.surfaces.length && !profile.surfaces.includes(surface)) {
      return false;
    }
    const wit = kiwiWitness(src, tokens, loc, profile.kiwiTags, profile.kiwiForms);
    if (typeof RulesService !== "undefined" && RulesService.isLexicalNotParticle) {
      if (RulesService.isLexicalNotParticle(src, loc.start, loc.end, surface)) return false;
    }
    if (wit === "hit") return true;
    if (acceptFusedTopic(src, loc, surface, run, tokens)) return true;
    if (wit === "miss" && tokens && tokens.length) return false;
    if (!run.leftText) return false;
    return true;
  }

  /**
   * @returns {boolean}
   */
  function accept(src, loc, profile, opts = {}) {
    if (opts.manual) return true;
    if (!loc || loc.end <= loc.start) return false;
    const text = String(src || "");
    const surface = text.slice(loc.start, loc.end);
    if (!profile) return true;
    if (!shouldGate(surface, profile)) return true;

    const tokens = getTokens(text, opts);
    const run = expandRun(text, loc.start, loc.end);

    switch (profile.role) {
      case "honorific-si":
        return acceptHonorific(text, loc, run, tokens);
      case "adnominal-l":
        return acceptAdnominalL(text, loc, surface, run, tokens);
      case "eul-frame": {
        if (typeof RulesService !== "undefined" && RulesService.sentenceHasEulFrame) {
          return RulesService.sentenceHasEulFrame(text, {
            id: profile.frameId,
            surfaces: profile.surfaces,
          });
        }
        return (profile.surfaces || []).some((s) => text.includes(s) || text.replace(/\s+/g, "").includes(String(s).replace(/\s+/g, "")));
      }
      case "particle-object":
        return acceptObject(text, loc, surface, run, tokens);
      case "ending-ge":
        return acceptGe(text, loc, surface, run, tokens);
      case "contraction":
        return acceptContraction(text, loc, surface, profile, tokens);
      case "adnominal-n":
        return acceptAdnominalN(text, loc, surface, tokens);
      case "haeche":
        return acceptHaeche(text, loc, surface, run, tokens);
      case "haeyo":
        return acceptHaeyo(text, loc, surface, run, tokens);
      case "particle-ui":
      case "neg-mot":
      case "neg-an":
      case "causative-ge":
      case "copula-iya":
        return acceptRequireNeedles(text, loc, surface, profile, tokens);
      case "ending":
        return acceptGenericEnding(text, loc, surface, run, profile, tokens);
      case "particle":
        return acceptParticle(text, loc, surface, run, profile, tokens);
      default:
        return true;
    }
  }

  function filterLocs(src, locs, rule, opts = {}) {
    const list = Array.isArray(locs) ? locs : [];
    if (!list.length) return list;
    if (opts.manual) return list;
    const profile = inferProfile(rule, opts.item);
    if (!profile) return list;
    return list.filter((loc) => accept(src, loc, profile, opts));
  }

  return {
    inferProfile,
    accept,
    filterLocs,
    shouldGate,
    stripEndingStack,
    expandRun,
    HONORIFIC_FUSED,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = AffixGate;
}
