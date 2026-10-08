/** System Usability Scale (§15 exit, §17). 10 items, EN + AR. */
export const SUS_ITEMS: Array<{ en: string; ar: string }> = [
  { en: 'I think that I would like to use this system frequently.', ar: 'أعتقد أنني أرغب في استخدام هذا النظام بشكل متكرر.' },
  { en: 'I found the system unnecessarily complex.', ar: 'وجدت النظام معقداً بلا داعٍ.' },
  { en: 'I thought the system was easy to use.', ar: 'اعتقدت أن النظام سهل الاستخدام.' },
  { en: 'I think that I would need the support of a technical person to be able to use this system.', ar: 'أعتقد أنني سأحتاج إلى مساعدة شخص متخصص تقنياً لأتمكن من استخدام هذا النظام.' },
  { en: 'I found the various functions in this system were well integrated.', ar: 'وجدت أن الوظائف المختلفة في هذا النظام متكاملة بشكل جيد.' },
  { en: 'I thought there was too much inconsistency in this system.', ar: 'اعتقدت أن هناك الكثير من عدم الاتساق في هذا النظام.' },
  { en: 'I would imagine that most people would learn to use this system very quickly.', ar: 'أتصور أن معظم الناس سيتعلمون استخدام هذا النظام بسرعة كبيرة.' },
  { en: 'I found the system very cumbersome to use.', ar: 'وجدت النظام مرهقاً جداً في الاستخدام.' },
  { en: 'I felt very confident using the system.', ar: 'شعرت بثقة كبيرة أثناء استخدام النظام.' },
  { en: 'I needed to learn a lot of things before I could get going with this system.', ar: 'احتجت إلى تعلم الكثير من الأشياء قبل أن أتمكن من البدء باستخدام هذا النظام.' },
];

/** answers: 10 values 1..5. Returns 0..100. Throws on invalid input. */
export function susScore(answers: number[]): number {
  if (!Array.isArray(answers) || answers.length !== 10) throw new Error('SUS requires exactly 10 answers');
  let sum = 0;
  answers.forEach((a, i) => {
    if (!Number.isInteger(a) || a < 1 || a > 5) throw new Error(`SUS answer ${i + 1} must be an integer 1..5`);
    // Odd-numbered (positive) items: a-1; even-numbered (negative) items: 5-a.
    sum += i % 2 === 0 ? a - 1 : 5 - a;
  });
  return sum * 2.5;
}
