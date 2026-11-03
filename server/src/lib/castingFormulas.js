// معادلات ورقة "صب" (مطابقة لملف Excel). ملف مشترك بين الخادم والواجهة.
//   الذهب المستحق  F = (الشمع − الزركون) × (16 لعيار 18، 18 لعيار 21)
//   مطلوب 24       G = (F × 0.752 لعيار 18، F × 0.875 لعيار 21) ÷ 2
//   الخلطة         H = (G ÷ 875 لعيار 21، G ÷ 752 لعيار 18) × 1000 − G
//   المطلوب 18     I = F ÷ 2
//   عجز الذهب      L = الذهب قبل + الزركون − الذهب بعد

const n = (x) => (x === null || x === undefined || x === '' ? 0 : Number(x) || 0);

export function castingCalc(t) {
  const karat = Number(t.karat) === 21 ? 21 : 18;
  const f = (n(t.wax) - n(t.zircon)) * (karat === 18 ? 16 : 18);
  const g = (karat === 18 ? f * 0.752 : f * 0.875) / 2;
  const h = (karat === 21 ? g / 875 : g / 752) * 1000 - g;
  const i = f / 2;
  const l = n(t.gold_before) + n(t.zircon) - n(t.gold_after);
  return { due: f, need24: g, alloy: h, need18: i, loss: l };
}

/** تحويل العيار: وزن ذهب 24 ← ما يعادله بعيار 18 و 21 */
export function karatConvert(weight24) {
  const w = n(weight24);
  return { k18: (w * 1000) / 752, k21: (w * 1000) / 875 };
}
