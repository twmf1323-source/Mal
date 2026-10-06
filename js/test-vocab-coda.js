load("vocab-coda.js");

let failed = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failed += 1;
    print("FAIL " + msg + " got " + a);
  } else {
    print("ok " + msg);
  }
}
function marks(surface, items, start) {
  return VocabCoda.paints(surface, items, start);
}

const nieun = { name: "冠形詞形（-ㄴ/은）", category: "語尾" };
const neun = { name: "冠形詞形（-는）", category: "語尾" };
const rieul = { name: "未來推測（-(으)ㄹ）", category: "語尾" };
const past = { name: "過去（-았/었-）", category: "時態" };
const polite = { name: "禮貌體（-아/어요）", category: "語尾" };
const formal = { name: "正式體（-습니다）", category: "語尾" };
const cause = { name: "原因連接（-아/어서）", category: "連接" };
const nde = { name: "背景對比（-ㄴ데/인데）", category: "連接" };
const neg = { name: "否定（-지 않다）", category: "句型" };
const topic = { name: "主題（은/는）", category: "助詞" };

eq(marks("예쁜", [nieun]), [{ index: 1, mode: "jong" }], "예쁜 coda ㄴ");
eq(marks("작은", [nieun]), [{ index: 1, mode: "char" }], "작은 colors 은");
eq(marks("가는", [neun]), [{ index: 1, mode: "char" }], "가는 colors 는");
eq(marks("갈", [rieul]), [{ index: 0, mode: "jong" }], "갈 coda ㄹ");
eq(marks("먹을", [rieul]), [{ index: 1, mode: "char" }], "먹을 colors 을");
eq(marks("갔어", [past]), [{ index: 0, mode: "jong" }], "갔어 past ㅆ only");
eq(
  marks("갔어", [past, polite]),
  [
    { index: 0, mode: "jong" },
    { index: 1, mode: "char" },
  ],
  "갔어 past ㅆ and polite 어"
);
eq(
  marks("했어요", [past, polite]),
  [
    { index: 0, mode: "jong" },
    { index: 1, mode: "char" },
    { index: 2, mode: "char" },
  ],
  "했어요 ㅆ plus 어요"
);
eq(marks("사람", []), [], "사람 without grammar stays plain");
eq(marks("사람", [topic]), [], "助詞 does not color the big word");
eq(marks("사람", [nieun]), [], "no ㄴ batchim means no nieun paint");
eq(
  marks("예쁜데", [nieun, nde]),
  [
    { index: 1, mode: "jong" },
    { index: 2, mode: "char" },
  ],
  "예쁜데 coda ㄴ and 데"
);
eq(marks("같지가", [neg, topic]), [{ index: 1, mode: "char" }], "같지가 colors 지 only");
eq(
  marks("좋습니다", [formal]),
  [
    { index: 1, mode: "char" },
    { index: 2, mode: "char" },
    { index: 3, mode: "char" },
  ],
  "좋습니다 colors 습니다"
);
eq(
  marks("갑니다", [formal]),
  [
    { index: 0, mode: "jong" },
    { index: 1, mode: "char" },
    { index: 2, mode: "char" },
  ],
  "갑니다 colors ㅂ and 니다"
);
eq(marks("있었어요", [past, polite]), [
  { index: 1, mode: "char" },
  { index: 2, mode: "char" },
  { index: 3, mode: "char" },
], "있었어요 does not color lexical 있");
eq(
  marks("가서", [cause]),
  [
    { index: 0, mode: "char" },
    { index: 1, mode: "char" },
  ],
  "가서 colors the syllable that absorbed 아 plus 서"
);
eq(
  marks("해도", [{ name: "讓步（-아/어도）", category: "連接", span: "해도" }]),
  [
    { index: 0, mode: "char" },
    { index: 1, mode: "char" },
  ],
  "해도 colors contracted 아/어도"
);
eq(marks("먹어도", [{ name: "讓步（-아/어도）", category: "連接" }]), [
  { index: 1, mode: "char" },
  { index: 2, mode: "char" },
], "먹어도 colors only 어도");
eq(
  marks("해줘", [{ name: "請托（-아/어 줘）", category: "句型" }]),
  [
    { index: 0, mode: "char" },
    { index: 1, mode: "char" },
  ],
  "해줘 colors contracted 아/어 plus 줘"
);
eq(marks("먹어요", [polite]), [
  { index: 1, mode: "char" },
  { index: 2, mode: "char" },
], "먹어요 colors 어요");
eq(
  marks("해요", [polite]),
  [
    { index: 0, mode: "char" },
    { index: 1, mode: "char" },
  ],
  "해요 colors contracted polite ending"
);
eq(
  marks("해도", [{ name: "讓步（-아/어도）", nameKo: "-아/어도", category: "連接", span: "해도", start: 8, end: 10 }], 8),
  [
    { index: 0, mode: "char" },
    { index: 1, mode: "char" },
  ],
  "해도 with the saved offsets colors both syllables"
);
eq(marks("봐도", [{ name: "讓步（-아/어도）", nameKo: "-아/어도", category: "語尾" }]), [
  { index: 0, mode: "char" },
  { index: 1, mode: "char" },
], "봐도 colors the syllable that absorbed 아 plus 도");
eq(
  marks("바꿔봐도", [{ name: "嘗試（-아/어 보다）", nameKo: "-아/어 보다", category: "句型", span: "봐도", start: 5, end: 7 }], 3),
  [{ index: 2, mode: "char" }],
  "嘗試 colors contracted 봐 and leaves 도 to 讓步"
);
eq(marks("봐도", [
  { name: "嘗試（-아/어 보다）", nameKo: "-아/어 보다", category: "句型" },
  { name: "讓步（-아/어도）", nameKo: "-아/어도", category: "連接" },
]), [
  { index: 0, mode: "char" },
  { index: 1, mode: "char" },
], "봐도 colors both the try auxiliary and the concessive");
eq(marks("입어 봐", [{ name: "嘗試（-아/어 보다）", nameKo: "-아/어 보다", category: "句型" }]), [
  { index: 1, mode: "char" },
  { index: 3, mode: "char" },
], "입어 봐 colors 어 and 봐");
eq(marks("지쳐가", [{ name: "進行（-아/어 가다）", nameKo: "-아/어 가다", category: "句型", span: "지쳐가" }]), [
  { index: 1, mode: "char" },
  { index: 2, mode: "char" },
], "지쳐가 colors fused 쳐 plus 가");
eq(marks("해 줘", [{ name: "請托（-아/어 줘）", nameKo: "-아/어 줘", category: "句型" }]), [
  { index: 0, mode: "char" },
  { index: 2, mode: "char" },
], "해 줘 colors the fused syllable across a space");
eq(marks("도", [{ name: "讓步（-아/어도）", nameKo: "-아/어도", category: "連接", span: "도" }]), [
  { index: 0, mode: "char" },
], "a card that is only 도 still colors that tail");
eq(marks("섹시해", [{ name: "平語（해체）", nameKo: "해체", category: "語尾", span: "해", start: 2, end: 3 }], 0), [
  { index: 2, mode: "char" },
], "해체 colors contracted 해");
eq(marks("해요", [{ name: "平語（해체）", nameKo: "해체", category: "語尾" }]), [
  { index: 0, mode: "char" },
], "해체 does not color polite 요");
eq(marks("보여", [{ name: "平語（해체）", nameKo: "해체", category: "語尾", span: "여" }]), [
  { index: 1, mode: "char" },
], "보여 colors literal 여");
eq(marks("예쁜", [{ name: "冠形詞形（-ㄴ/은）", category: "語尾", start: 0, end: 2 }], 10), [], "range outside the card does not paint");
eq(marks("예쁜", [{ name: "冠形詞形（-ㄴ/은）", category: "語尾", start: 4, end: 6 }], 4), [{ index: 1, mode: "jong" }], "range inside the card paints");

const haedo = VocabCoda.surfaceHtml("해도", [{ name: "讓步（-아/어도）", nameKo: "-아/어도", category: "連接", span: "해도" }]);
if (haedo !== '<span class="vocab-card-ending">해</span><span class="vocab-card-ending">도</span>') {
  failed += 1;
  print("FAIL haedo html " + haedo);
} else {
  print("ok haedo html colors both syllables");
}

const html = VocabCoda.surfaceHtml("예쁜", [nieun]);
if (!html.startsWith("예") || !html.includes('data-shape="h"') || !html.includes("vocab-coda-mask") || !html.includes("쁜")) {
  failed += 1;
  print("FAIL html " + html);
} else {
  print("ok html keeps 예 and masks 쁜");
}
if (!VocabCoda.surfaceHtml("사람", []).includes("사람") || VocabCoda.surfaceHtml("사람", []).includes("vocab-coda")) {
  failed += 1;
  print("FAIL plain html");
} else {
  print("ok plain html");
}

if (failed) {
  print(failed + " failed");
  quit(1);
}
print("all passed");
