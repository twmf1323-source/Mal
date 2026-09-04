/**
 * 用言詞幹：比 Kiwi 原形與該語素表面，只在實際脫落／交替時判定不規則種類。
 * 原形 === 表面 → 規則活用，不推薦不規則卡。
 */
const StemDrop = (() => {
  const CHO_RIEUL = 5;
  const JUNG_EU = 18;
  const JONG_NONE = 0;
  const JONG_NIEUN = 4;
  const JONG_D = 7;
  const JONG_RIEUL = 8;
  const JONG_B = 17;
  const JONG_S = 19;
  const JONG_H = 27;

  const KIND_TO_HINT = {
    ㅂ: "irr-b",
    ㄷ: "irr-d",
    ㅅ: "irr-s",
    르: "irr-reu",
    ㅎ: "irr-h",
    ㄹ: "l-del",
    eu: "eu-del",
  };

  const HINT_TO_KIND = {
    "irr-b": "ㅂ",
    "irr-d": "ㄷ",
    "irr-s": "ㅅ",
    "irr-reu": "르",
    "irr-h": "ㅎ",
    "l-del": "ㄹ",
    "eu-del": "eu",
  };

  const KIND_REASON = {
    ㅂ: "ㅂ 脫落",
    ㄷ: "ㄷ→ㄹ",
    ㅅ: "ㅅ 脫落",
    르: "르→ㄹㄹ",
    ㅎ: "ㅎ 脫落",
    ㄹ: "ㄹ 脫落",
    eu: "ㅡ 脫落",
  };

  function isHangulSyllable(ch) {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }

  function canon(s) {
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

  function hangulSyllables(s) {
    return [...canon(s)].filter(isHangulSyllable);
  }

  function decomposeHangul(ch) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    const jong = code % 28;
    const jung = Math.floor(code / 28) % 21;
    const cho = Math.floor(code / 28 / 21);
    return { cho, jung, jong };
  }

  function withJongseong(ch, jong) {
    const d = decomposeHangul(ch);
    if (!d || d.jong !== JONG_NONE) return "";
    return String.fromCharCode(0xac00 + d.cho * 588 + d.jung * 28 + jong);
  }

  function isReuSyllable(ch) {
    const d = decomposeHangul(ch);
    return Boolean(d && d.cho === CHO_RIEUL && d.jung === JUNG_EU && d.jong === JONG_NONE);
  }

  function hasRieulBatchim(ch) {
    const d = decomposeHangul(ch);
    return Boolean(d && d.jong === JONG_RIEUL);
  }

  /** 르 불규칙 第二音節：라／러／랐／렀 */
  function isReuSecondSyllable(ch) {
    const d = decomposeHangul(ch);
    if (!d || d.cho !== CHO_RIEUL) return false;
    if (d.jung !== 0 && d.jung !== 4) return false; // ㅏ / ㅓ
    return d.jong === JONG_NONE || d.jong === 20; // none / ㅆ
  }

  /** 몰라／빨라 或 푸르러／이르러 */
  function isReuIrregularPair(a, b) {
    if (hasRieulBatchim(a) && isReuSecondSyllable(b)) return true;
    if (isReuSyllable(a) && isReuSecondSyllable(b)) return true;
    return false;
  }

  function hasReuIrregularSurface(text) {
    const syls = hangulSyllables(text);
    for (let i = 0; i < syls.length - 1; i++) {
      if (isReuIrregularPair(syls[i], syls[i + 1])) return true;
    }
    return false;
  }

  /**
   * 把詞幹語素區間擴成 몰라／푸르러（라／러 常在下一個語素）
   */
  function extendReuHitRange(text, start, end) {
    const src = String(text || "").normalize("NFC");
    const s = Math.max(0, Number(start) || 0);
    const e = Math.min(src.length, Math.max(Number(end) || s, s));
    const from = Math.max(0, s - 1);
    const to = Math.min(src.length - 1, Math.max(e, s + 1));
    for (let i = from; i < to; i++) {
      if (!isHangulSyllable(src[i]) || !isHangulSyllable(src[i + 1])) continue;
      if (!isReuIrregularPair(src[i], src[i + 1])) continue;
      return { start: Math.min(s, i), end: i + 2 };
    }
    return { start: s, end: e };
  }

  function stripDa(syls) {
    if (syls.length > 1 && syls[syls.length - 1] === "다") return syls.slice(0, -1);
    return syls;
  }

  function correspondingSurface(lemSyls, surSyls) {
    if (surSyls.length === lemSyls.length) return surSyls[surSyls.length - 1];
    if (surSyls.length > lemSyls.length) return surSyls[lemSyls.length - 1];
    return surSyls[surSyls.length - 1];
  }

  /**
   * @returns {{ kind: 'ㅂ'|'ㄷ'|'ㅅ'|'르'|'ㅎ'|'ㄹ'|'eu', lemma: string, surface: string } | null}
   */
  function classifyStemDrop(lemma, surface) {
    const lemSyls = stripDa(hangulSyllables(lemma));
    const surSyls = hangulSyllables(surface);
    if (!lemSyls.length || !surSyls.length) return null;

    const lemmaText = lemSyls.join("");
    const surfaceText = surSyls.join("");
    if (lemmaText === surfaceText) return null;

    const lastL = lemSyls[lemSyls.length - 1];
    const dL = decomposeHangul(lastL);
    if (!dL) return null;

    const pack = (kind) => ({ kind, lemma: lemmaText, surface: surfaceText });

    if (isReuSyllable(lastL) && lemSyls.length >= 2) {
      const prefix = lemSyls.slice(0, -1);
      const preStr = prefix.join("");
      const lastPre = prefix[prefix.length - 1];
      const withR = withJongseong(lastPre, JONG_RIEUL);
      if (withR && (surfaceText === withR || surfaceText.startsWith(withR))) {
        return pack("르");
      }
      const rest = surfaceText.startsWith(preStr) ? surfaceText.slice(preStr.length) : "";
      if (rest && /^[라러]/.test(rest)) {
        return pack("eu");
      }
      // 푸르다→푸르러、이르다→이르러：르 保留再加 러／라
      if (
        surfaceText.startsWith(lemmaText) &&
        /^[라러랐렀]/.test(surfaceText.slice(lemmaText.length))
      ) {
        return pack("르");
      }
    }

    const corr = correspondingSurface(lemSyls, surSyls);
    const dS = decomposeHangul(corr);
    if (!dS) return null;

    if (
      dL.jong === JONG_B &&
      dS.jong === JONG_NONE &&
      dS.cho === dL.cho &&
      dS.jung === dL.jung
    ) {
      return pack("ㅂ");
    }
    if (
      dL.jong === JONG_D &&
      dS.jong === JONG_RIEUL &&
      dS.cho === dL.cho &&
      dS.jung === dL.jung
    ) {
      return pack("ㄷ");
    }
    if (
      dL.jong === JONG_S &&
      dS.jong === JONG_NONE &&
      dS.cho === dL.cho &&
      dS.jung === dL.jung
    ) {
      return pack("ㅅ");
    }
    if (dL.jong === JONG_H && dS.jong !== JONG_H && dS.cho === dL.cho) {
      return pack("ㅎ");
    }
    // ㄹ 탈락：ㄴ／ㅂ／시 類前 ㄹ 沒了；ㅂ니다 等會把 ㅂ 併進前字（살→삽）
    if (
      dL.jong === JONG_RIEUL &&
      dS.cho === dL.cho &&
      dS.jung === dL.jung &&
      (dS.jong === JONG_NONE || dS.jong === JONG_NIEUN || dS.jong === JONG_B)
    ) {
      return pack("ㄹ");
    }
    if (
      dL.jung === JUNG_EU &&
      dS.jung !== JUNG_EU &&
      dS.cho === dL.cho &&
      !isReuSyllable(lastL)
    ) {
      return pack("eu");
    }

    return null;
  }

  function formatReason(hit) {
    if (!hit || !hit.kind) return "";
    const label = KIND_REASON[hit.kind] || hit.kind;
    return `原形 ${hit.lemma} → ${hit.surface}（${label}）`;
  }

  return {
    classifyStemDrop,
    formatReason,
    hasRieulBatchim,
    isReuSyllable,
    isReuSecondSyllable,
    isReuIrregularPair,
    hasReuIrregularSurface,
    extendReuHitRange,
    KIND_TO_HINT,
    HINT_TO_KIND,
    KIND_REASON,
  };
})();

if (typeof module === "object" && module.exports) {
  module.exports = StemDrop;
}
