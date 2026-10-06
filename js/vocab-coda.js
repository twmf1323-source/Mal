/**
 * 單字卡大字：只把文法語尾塗上結構配色。
 * 整顆音節的語尾塗整字；받침 裡的語尾（예쁜 的 ㄴ）只塗終聲。
 */
const VocabCoda = (() => {
  const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
  const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const JONG_N = 4;
  const JONG_R = 8;
  const JONG_B = 17;
  const JONG_SS = 20;
  const AUX_STEM = /^(않다|있다|싶다|주다|되다|하다|만하다|모르다|알다)$/;

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function jongOf(ch) {
    const code = String(ch || "").charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return -1;
    return code % 28;
  }

  function partsOf(ch) {
    const code = String(ch || "").charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    const jong = code % 28;
    if (!jong) return null;
    const jung = Math.floor(code / 28) % 21;
    const cho = Math.floor(code / 28 / 21);
    let shape = "hv";
    if ([0, 1, 2, 3, 4, 5, 6, 7, 20].includes(jung)) shape = "v";
    else if ([8, 12, 13, 17, 18].includes(jung)) shape = "h";
    return { cho: CHO[cho], jung: JUNG[jung], jong: JONG[jong], shape };
  }

  function blobOf(item) {
    return `${item?.name || ""} ${item?.nameZh || ""} ${item?.nameKo || ""} ${item?.title || ""} ${item?.category || ""}`;
  }

  function isEndingItem(item) {
    const cat = String(item?.category || "");
    const name = blobOf(item);
    if (/不規則|縮約|脫落|탈락/.test(name)) return false;
    if (cat === "助詞" || (/助詞|主題|主格|賓格|所有格|限定/.test(name) && !/語尾|冠形/.test(name))) return false;
    if (["語尾", "時態", "敬語", "連接", "句型"].includes(cat)) return true;
    return /語尾|冠形|禮貌|平語|正式|過去|敬語|連接|指定|副詞化|否定|進行/.test(name);
  }

  function kindOf(item) {
    const blob = blobOf(item);
    if (/冠形/.test(blob) && /ㄴ\s*[\/／]\s*은|ㄴ\/은|-ㄴ/.test(blob) && !/는/.test(blob.replace(/은\s*[\/／]\s*는|는\s*[\/／]\s*은/g, ""))) {
      return "nieun";
    }
    if (/冠形/.test(blob) && /는/.test(blob)) return "neun";
    if (/未來|推測|[\(（]으[\)）]\s*ㄹ|-(으)ㄹ/.test(blob)) return "rieul";
    if (/過去/.test(blob) && !/冠形|回想/.test(blob)) return "past";
    if (/正式|습니다|ㅂ니다/.test(blob)) return "hamnida";
    if (/해체|반말|平語/.test(blob)) return "haeche";
    if (/禮貌/.test(blob)) return "aeo";
    return "marker";
  }

  function locate(surface, item, cardStart) {
    const surf = String(surface || "");
    const base = Number(cardStart);
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (Number.isFinite(base) && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const a = Math.max(0, start - base);
      const b = Math.min(surf.length, end - base);
      if (b > a) return { start: a, end: b };
      return null;
    }
    const span = String(item?.span || "").trim();
    if (span) {
      const at = surf.lastIndexOf(span);
      if (at >= 0) return { start: at, end: at + span.length };
      if (surf && span.includes(surf)) return { start: 0, end: surf.length };
      return null;
    }
    return surf ? { start: 0, end: surf.length } : null;
  }

  function needlesOf(item) {
    const name = String(item?.name || item?.title || "");
    const paren = name.match(/[（(]([^）)]+)[）)]/);
    const raw = String(item?.nameKo || (paren ? paren[1] : "") || "");
    const parts = raw
      .split(/[／\/、,＋+\s]+/)
      .map((s) => s.trim().replace(/^[-−–—〜～]+/, "").replace(/[-−–—]+$/, "").replace(/[()（）]/g, ""));
    if (/아\s*[\/／]\s*어/.test(raw)) parts.push("아서", "어서", "아", "어");
    return parts
      .filter((s) => s && s !== "으" && !AUX_STEM.test(s) && !/^[ㄴㄹㅆㅂ]$/.test(s))
      .sort((a, b) => b.length - a.length);
  }

  function paintSliceChars(surface, slice, needle, chars) {
    const text = surface.slice(slice.start, slice.end);
    const rel = text.lastIndexOf(needle);
    if (rel < 0) return false;
    for (let i = 0; i < needle.length; i++) chars.add(slice.start + rel + i);
    return true;
  }

  function paintCodaNeedle(surface, slice, jamo, rest, jongId, chars, jongs) {
    const text = surface.slice(slice.start, slice.end);
    const rel = text.lastIndexOf(rest);
    if (rel < 0) return false;
    const abs = slice.start + rel;
    const prev = abs - 1;
    if (prev < slice.start || jongOf(surface[prev]) !== jongId) return false;
    jongs.add(prev);
    for (let i = 0; i < rest.length; i++) chars.add(abs + i);
    return true;
  }

  function parenRaw(item) {
    const name = String(item?.name || item?.title || "");
    const paren = name.match(/[（(]([^）)]+)[）)]/);
    return String(item?.nameKo || (paren ? paren[1] : "") || "");
  }

  function isSyllable(ch) {
    const code = String(ch || "").charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
  }

  /** 아/어 後面的輔助動詞在句中常再縮一次：보다→봐、가다→가。 */
  const AUX_SURFACE = {
    보다: ["보아", "봐", "와"],
    주다: ["주어", "줘"],
    가다: ["가"],
    오다: ["와", "오"],
    드리다: ["드려", "드리"],
    버리다: ["버려", "버리"],
    놓다: ["놓아", "놔"],
    두다: ["두어", "둬"],
    내다: ["내어", "내"],
    대다: ["대어", "대"],
  };
  const AUX_AFTER = /^(도|요|서|지|라|야|네|게|죠|고|면|며)$/;

  function prevSyllable(surface, slice, index) {
    let prev = index - 1;
    while (prev >= slice.start && /\s/.test(surface[prev])) prev--;
    if (prev >= slice.start && isSyllable(surface[prev])) return prev;
    return -1;
  }

  /** -아/어도、아서/어서、아/어 줘：括號裡 아/어 後面剩下的可見尾巴。沒有則 null。 */
  function aeoTail(raw) {
    const s = String(raw || "");
    let m = s.match(/아\s*[\/／]\s*어\s*([^／\/]*)/);
    if (m) return (m[1] || "").replace(/\s+/g, "").replace(/^[+＋]/, "");
    m = s.match(/아([가-힣]*)\s*[\/／]\s*어\1/);
    if (m) return m[1] || "";
    return null;
  }

  /**
   * 아/어 縮進前一音節時，塗「被吃掉的那一顆＋剩下的尾巴」。
   * 해도←하＋아/어도、가서←가＋아서、해줘←하＋아/어 줘。
   * 먹어도、먹어서 仍只塗字面上的 어도／어서。
   */
  function paintContractedAeo(surface, slice, tail, chars) {
    const text = surface.slice(slice.start, slice.end);
    const full = [tail ? "아" + tail : "아", tail ? "어" + tail : "어", tail ? "여" + tail : "여"];
    full.sort((a, b) => b.length - a.length);
    for (const form of full) {
      if (form && paintSliceChars(surface, slice, form, chars)) return true;
    }
    if (tail && text.endsWith(tail)) {
      const tailAt = slice.end - tail.length;
      const prev = prevSyllable(surface, slice, tailAt);
      if (prev >= 0) chars.add(prev);
      for (let i = 0; i < tail.length; i++) chars.add(tailAt + i);
      return true;
    }
    const forms = AUX_SURFACE[tail];
    if (!forms) return false;
    const ordered = forms.slice().sort((a, b) => b.length - a.length);
    for (const form of ordered) {
      let from = text.length;
      while (from > 0) {
        const rel = text.lastIndexOf(form, from - 1);
        if (rel < 0) break;
        const after = text.slice(rel + form.length).replace(/\s+/g, "");
        if (after === "" || AUX_AFTER.test(after)) {
          const prev = prevSyllable(surface, slice, slice.start + rel);
          if (prev >= 0) chars.add(prev);
          for (let i = 0; i < form.length; i++) chars.add(slice.start + rel + i);
          return true;
        }
        from = rel;
      }
    }
    return false;
  }

  function paintMarkers(surface, slice, item, chars, jongs) {
    const needles = needlesOf(item);
    const tail = aeoTail(parenRaw(item));
    for (const needle of needles) {
      if (/^[ㄴㄹㅆㅂ]/.test(needle)) continue;
      if (tail != null && (needle === tail || needle === "아" || needle === "어" || needle === "여")) continue;
      if (paintSliceChars(surface, slice, needle, chars)) return;
    }
    if (tail != null && paintContractedAeo(surface, slice, tail, chars)) return;
    const codaId = { ㄴ: JONG_N, ㄹ: JONG_R, ㅆ: JONG_SS, ㅂ: JONG_B };
    for (const needle of needles) {
      const m = needle.match(/^([ㄴㄹㅆㅂ])(.+)$/);
      if (!m) continue;
      if (paintCodaNeedle(surface, slice, m[1], m[2], codaId[m[1]], chars, jongs)) return;
    }
    for (const needle of needles) {
      if (tail != null && (needle === "아" || needle === "어" || needle === "여")) continue;
      if (/^[ㄴㄹㅆㅂ]/.test(needle)) continue;
      if (paintSliceChars(surface, slice, needle, chars)) return;
    }
  }

  function paintNieun(surface, slice, chars, jongs) {
    paintSliceChars(surface, slice, "은", chars);
    for (let i = slice.start; i < slice.end; i++) {
      if (!chars.has(i) && jongOf(surface[i]) === JONG_N) jongs.add(i);
    }
  }

  function paintRieul(surface, slice, chars, jongs) {
    if (paintSliceChars(surface, slice, "을", chars)) return;
    for (let i = slice.end - 1; i >= slice.start; i--) {
      if (jongOf(surface[i]) === JONG_R) {
        jongs.add(i);
        return;
      }
    }
  }

  function paintPast(surface, slice, chars, jongs) {
    const text = surface.slice(slice.start, slice.end);
    for (const syl of ["았", "었", "였"]) {
      let from = 0;
      while (from < text.length) {
        const rel = text.indexOf(syl, from);
        if (rel < 0) break;
        chars.add(slice.start + rel);
        from = rel + syl.length;
      }
    }
    for (let i = slice.start; i < slice.end; i++) {
      if (chars.has(i) || jongOf(surface[i]) !== JONG_SS) continue;
      if (surface[i] === "있" || surface[i] === "겠") continue;
      const after = surface.slice(i + 1);
      const lone = slice.end - slice.start === 1;
      if (lone || /^(어|아|여|요|다|고|지|네|죠|군|구|는|니|면|며|서|도|던|습)/.test(after)) jongs.add(i);
    }
  }

  function paintHamnida(surface, slice, chars, jongs) {
    if (paintSliceChars(surface, slice, "습니다", chars)) return;
    if (paintSliceChars(surface, slice, "ㅂ니다", chars)) return;
    const text = surface.slice(slice.start, slice.end);
    const rel = text.lastIndexOf("니다");
    if (rel <= 0) return;
    const prev = slice.start + rel - 1;
    if (jongOf(surface[prev]) !== JONG_B) return;
    jongs.add(prev);
    chars.add(slice.start + rel);
    chars.add(slice.start + rel + 1);
  }

  function paintAeo(surface, slice, chars) {
    if (paintContractedAeo(surface, slice, "요", chars)) return;
    const text = surface.slice(slice.start, slice.end);
    const m = text.match(/(아|어|여)$/);
    if (m) chars.add(slice.end - 1);
  }

  /** 해체：하＋아→해 時句中沒有「아／어」。요 是禮貌體，不跟這張文法上色。 */
  function paintHaeche(surface, slice, chars) {
    let end = slice.end;
    const text = surface.slice(slice.start, slice.end);
    if (/(요|죠)$/.test(text)) end -= 1;
    const body = surface.slice(slice.start, end);
    const m = body.match(/(아|어|여)$/);
    if (m) {
      chars.add(end - 1);
      return;
    }
    for (let i = end - 1; i >= slice.start; i--) {
      if (isSyllable(surface[i])) {
        chars.add(i);
        return;
      }
    }
  }

  function paints(surface, items, cardStart) {
    const surf = String(surface || "");
    const chars = new Set();
    const jongs = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      if (!isEndingItem(item)) continue;
      const slice = locate(surf, item, cardStart);
      if (!slice) continue;
      const kind = kindOf(item);
      if (kind === "nieun") paintNieun(surf, slice, chars, jongs);
      else if (kind === "neun") paintSliceChars(surf, slice, "는", chars);
      else if (kind === "rieul") paintRieul(surf, slice, chars, jongs);
      else if (kind === "past") paintPast(surf, slice, chars, jongs);
      else if (kind === "hamnida") paintHamnida(surf, slice, chars, jongs);
      else if (kind === "aeo") paintAeo(surf, slice, chars);
      else if (kind === "haeche") paintHaeche(surf, slice, chars);
      else paintMarkers(surf, slice, item, chars, jongs);
    }
    for (const i of chars) jongs.delete(i);
    const out = [];
    for (let i = 0; i < surf.length; i++) {
      if (jongs.has(i)) out.push({ index: i, mode: "jong" });
      else if (chars.has(i)) out.push({ index: i, mode: "char" });
    }
    return out;
  }

  function codaHtml(ch) {
    const p = partsOf(ch);
    if (!p) return esc(ch);
    const text = esc(ch);
    return `<span class="vocab-coda" data-shape="${p.shape}">${text}<span class="vocab-coda-mask" aria-hidden="true">${text}</span></span>`;
  }

  function surfaceHtml(surface, items, cardStart) {
    const surf = String(surface || "");
    const marks = paints(surf, items, cardStart);
    if (!marks.length) return esc(surf);
    const modeAt = new Map(marks.map((m) => [m.index, m.mode]));
    let html = "";
    for (let i = 0; i < surf.length; i++) {
      const mode = modeAt.get(i);
      const ch = surf[i];
      if (mode === "jong") html += codaHtml(ch);
      else if (mode === "char") html += `<span class="vocab-card-ending">${esc(ch)}</span>`;
      else html += esc(ch);
    }
    return html;
  }

  return { paints, surfaceHtml, isEndingItem, kindOf };
})();
