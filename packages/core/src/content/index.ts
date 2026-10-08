import type { CaseData, ModelDef } from '../types.js';

/*
 * Placeholder procedural models. The web viewer builds geometry procedurally for these
 * structure ids, so the ids below are a STABLE CONTRACT — never rename them (cases, logs and
 * analytics reference them). Add new structures instead.
 *
 * heart_v1 structure ids:
 *   pericardium:  TA:pericardium
 *   myocardium:   TA:myocardium, TA:interventricular_septum
 *   chambers:     TA:right_atrium, TA:right_ventricle, TA:left_atrium, TA:left_ventricle
 *   valves:       TA:tricuspid_valve, TA:pulmonary_valve, TA:mitral_valve, TA:aortic_valve
 *   vessels:      TA:aorta, TA:pulmonary_trunk, TA:superior_vena_cava, TA:inferior_vena_cava
 *   coronary:     TA:right_coronary_artery, TA:left_coronary_artery, TA:left_anterior_descending,
 *                 TA:left_circumflex_artery
 *
 * kidney_v1 structure ids:
 *   capsule:          TA:renal_capsule
 *   cortex:           TA:renal_cortex, TA:renal_column
 *   medulla:          TA:renal_medulla, TA:renal_pyramid, TA:renal_papilla
 *   collecting_system: TA:minor_calyx, TA:major_calyx, TA:renal_pelvis, TA:ureter
 *   vessels:          TA:renal_artery, TA:renal_vein
 *
 * `ta_code` (TA98) is given only where well established; all codes and names await academic
 * sign-off (sign_off is intentionally absent on these placeholder models).
 */

export const HEART_MODEL: ModelDef = {
  id: 'heart_v1',
  organ: 'heart',
  name: { en: 'Heart (placeholder model)', ar: 'القلب (نموذج مبدئي)' },
  version: 1,
  layers: [
    { id: 'pericardium', name: { en: 'Pericardium', ar: 'التامور' } },
    { id: 'myocardium', name: { en: 'Myocardium', ar: 'عضلة القلب' } },
    { id: 'chambers', name: { en: 'Chambers', ar: 'حجرات القلب' } },
    { id: 'valves', name: { en: 'Valves', ar: 'الصمامات' } },
    { id: 'vessels', name: { en: 'Great vessels', ar: 'الأوعية الكبرى' } },
    { id: 'coronary', name: { en: 'Coronary arteries', ar: 'الشرايين التاجية' } },
  ],
  structures: [
    { id: 'TA:pericardium', name: { en: 'Pericardium', ar: 'التامور' }, layer: 'pericardium', ta_code: 'A12.1.08.001' },
    { id: 'TA:myocardium', name: { en: 'Myocardium', ar: 'عضلة القلب' }, layer: 'myocardium', ta_code: 'A12.1.06.001' },
    { id: 'TA:interventricular_septum', name: { en: 'Interventricular septum', ar: 'الحاجز بين البطينين' }, layer: 'myocardium' },
    { id: 'TA:right_atrium', name: { en: 'Right atrium', ar: 'الأذين الأيمن' }, layer: 'chambers', ta_code: 'A12.1.01.001' },
    { id: 'TA:right_ventricle', name: { en: 'Right ventricle', ar: 'البطين الأيمن' }, layer: 'chambers', ta_code: 'A12.1.02.001' },
    { id: 'TA:left_atrium', name: { en: 'Left atrium', ar: 'الأذين الأيسر' }, layer: 'chambers', ta_code: 'A12.1.03.001' },
    { id: 'TA:left_ventricle', name: { en: 'Left ventricle', ar: 'البطين الأيسر' }, layer: 'chambers', ta_code: 'A12.1.04.001' },
    { id: 'TA:tricuspid_valve', name: { en: 'Tricuspid valve', ar: 'الصمام ثلاثي الشرف' }, layer: 'valves' },
    { id: 'TA:pulmonary_valve', name: { en: 'Pulmonary valve', ar: 'الصمام الرئوي' }, layer: 'valves' },
    { id: 'TA:mitral_valve', name: { en: 'Mitral valve', ar: 'الصمام التاجي' }, layer: 'valves' },
    { id: 'TA:aortic_valve', name: { en: 'Aortic valve', ar: 'الصمام الأبهري' }, layer: 'valves' },
    { id: 'TA:aorta', name: { en: 'Aorta', ar: 'الشريان الأبهر' }, layer: 'vessels', ta_code: 'A12.2.03.001' },
    { id: 'TA:pulmonary_trunk', name: { en: 'Pulmonary trunk', ar: 'الجذع الرئوي' }, layer: 'vessels', ta_code: 'A12.2.01.001' },
    { id: 'TA:superior_vena_cava', name: { en: 'Superior vena cava', ar: 'الوريد الأجوف العلوي' }, layer: 'vessels', ta_code: 'A12.3.03.001' },
    { id: 'TA:inferior_vena_cava', name: { en: 'Inferior vena cava', ar: 'الوريد الأجوف السفلي' }, layer: 'vessels', ta_code: 'A12.3.09.001' },
    { id: 'TA:right_coronary_artery', name: { en: 'Right coronary artery', ar: 'الشريان التاجي الأيمن' }, layer: 'coronary' },
    { id: 'TA:left_coronary_artery', name: { en: 'Left coronary artery', ar: 'الشريان التاجي الأيسر' }, layer: 'coronary' },
    { id: 'TA:left_anterior_descending', name: { en: 'Left anterior descending artery', ar: 'الشريان الأمامي النازل الأيسر' }, layer: 'coronary' },
    { id: 'TA:left_circumflex_artery', name: { en: 'Left circumflex artery', ar: 'الشريان المنعطف الأيسر' }, layer: 'coronary' },
  ],
  variants: [
    { id: 'normal', name: { en: 'Normal', ar: 'طبيعي' }, pathological: false },
    {
      id: 'mitral_stenosis',
      name: { en: 'Mitral stenosis', ar: 'تضيق الصمام التاجي' },
      pathological: true,
      affects: ['TA:mitral_valve', 'TA:left_atrium'],
    },
    {
      id: 'myocardial_infarction',
      name: { en: 'Anterior myocardial infarction (LAD territory)', ar: 'احتشاء عضلة القلب الأمامي (منطقة الشريان الأمامي النازل)' },
      pathological: true,
      affects: ['TA:left_anterior_descending', 'TA:interventricular_septum', 'TA:left_ventricle'],
    },
  ],
  animations: ['cardiac_cycle'],
};

export const KIDNEY_MODEL: ModelDef = {
  id: 'kidney_v1',
  organ: 'kidney',
  name: { en: 'Kidney (placeholder model)', ar: 'الكلية (نموذج مبدئي)' },
  version: 1,
  layers: [
    { id: 'capsule', name: { en: 'Capsule', ar: 'المحفظة' } },
    { id: 'cortex', name: { en: 'Cortex', ar: 'القشرة' } },
    { id: 'medulla', name: { en: 'Medulla', ar: 'اللب' } },
    { id: 'collecting_system', name: { en: 'Collecting system', ar: 'الجهاز الجامع' } },
    { id: 'vessels', name: { en: 'Renal vessels', ar: 'الأوعية الكلوية' } },
  ],
  structures: [
    { id: 'TA:renal_capsule', name: { en: 'Renal capsule', ar: 'المحفظة الكلوية' }, layer: 'capsule' },
    { id: 'TA:renal_cortex', name: { en: 'Renal cortex', ar: 'القشرة الكلوية' }, layer: 'cortex' },
    { id: 'TA:renal_column', name: { en: 'Renal column', ar: 'العمود الكلوي' }, layer: 'cortex' },
    { id: 'TA:renal_medulla', name: { en: 'Renal medulla', ar: 'اللب الكلوي' }, layer: 'medulla' },
    { id: 'TA:renal_pyramid', name: { en: 'Renal pyramid', ar: 'الهرم الكلوي' }, layer: 'medulla' },
    { id: 'TA:renal_papilla', name: { en: 'Renal papilla', ar: 'الحليمة الكلوية' }, layer: 'medulla' },
    { id: 'TA:minor_calyx', name: { en: 'Minor calyx', ar: 'الكأس الصغرى' }, layer: 'collecting_system' },
    { id: 'TA:major_calyx', name: { en: 'Major calyx', ar: 'الكأس الكبرى' }, layer: 'collecting_system' },
    { id: 'TA:renal_pelvis', name: { en: 'Renal pelvis', ar: 'الحوض الكلوي' }, layer: 'collecting_system' },
    { id: 'TA:ureter', name: { en: 'Ureter', ar: 'الحالب' }, layer: 'collecting_system', ta_code: 'A08.2.01.001' },
    { id: 'TA:renal_artery', name: { en: 'Renal artery', ar: 'الشريان الكلوي' }, layer: 'vessels' },
    { id: 'TA:renal_vein', name: { en: 'Renal vein', ar: 'الوريد الكلوي' }, layer: 'vessels' },
  ],
  variants: [
    { id: 'normal', name: { en: 'Normal', ar: 'طبيعي' }, pathological: false },
    { id: 'renal_cyst', name: { en: 'Simple renal cyst', ar: 'كيس كلوي بسيط' }, pathological: true, affects: ['TA:renal_cortex', 'TA:renal_capsule'] },
    {
      id: 'hydronephrosis',
      name: { en: 'Hydronephrosis', ar: 'استسقاء الكلية' },
      pathological: true,
      affects: ['TA:renal_pelvis', 'TA:major_calyx', 'TA:minor_calyx', 'TA:renal_papilla', 'TA:renal_medulla'],
    },
  ],
};

/** Model registry (placeholder procedural models; asset_url may point to licensed glTF later). */
export const MODELS: ModelDef[] = [HEART_MODEL, KIDNEY_MODEL];

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export const HEART_COURSE = 'Anatomy II - Thorax';
export const KIDNEY_COURSE = 'Renal System';
export const PRACTICE_COURSE = 'Practice';

/** Built-in content: the non-graded practice case, the 3 prototype heart cases (Anatomy II – Thorax) and 2 kidney cases (second course). */
export const PRACTICE_CASE: CaseData = {
  case_id: 'PRACTICE-001',
  course: PRACTICE_COURSE,
  topic: 'Practice',
  model: 'heart_v1',
  variant: 'normal',
  stem: {
    en: 'Practice round — this is not graded. Try pointing, pinching to select, and confirming your answer.',
    ar: 'جولة تدريبية — لا تُحتسب لها درجة. جرّب الإشارة والضغط للاختيار ثم تأكيد إجابتك.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: true,
  feedback_level: 'full',
  practice: true,
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: { en: 'Select the left ventricle.', ar: 'اختر البطين الأيسر.' },
      answer: ['TA:left_ventricle'],
      points: 1,
      feedback: { en: 'The left ventricle forms the apex of the heart.', ar: 'يشكّل البطين الأيسر قمة القلب.' },
    },
    {
      id: 'q2',
      type: 'mcq',
      prompt: { en: 'How many chambers does the human heart have?', ar: 'كم عدد حجرات قلب الإنسان؟' },
      options: {
        a: { en: 'Two', ar: 'اثنتان' },
        b: { en: 'Four', ar: 'أربع' },
        c: { en: 'Three', ar: 'ثلاث' },
        d: { en: 'Six', ar: 'ست' },
      },
      answer: 'b',
      points: 1,
      feedback: { en: 'Two atria and two ventricles.', ar: 'أذينان وبطينان.' },
    },
  ],
  meta: { author: 'medsim', version: 1, status: 'published', difficulty: 'easy' },
};

const CARD_010: CaseData = {
  case_id: 'CARD-010',
  course: HEART_COURSE,
  topic: 'Heart - external anatomy',
  model: 'heart_v1',
  variant: 'normal',
  stem: {
    en: 'Explore the normal adult heart in anterior view and answer the questions on its chambers and great vessels.',
    ar: 'استكشف قلب الإنسان البالغ الطبيعي من المنظر الأمامي وأجب عن الأسئلة المتعلقة بحجراته وأوعيته الكبرى.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: false,
  time_limit_min: 8,
  feedback_level: 'full',
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: {
        en: 'Select the chamber that forms most of the sternocostal (anterior) surface of the heart.',
        ar: 'اختر الحجرة التي تشكّل معظم السطح القصي الضلعي (الأمامي) للقلب.',
      },
      answer: ['TA:right_ventricle'],
      points: 2,
      feedback: {
        en: 'The right ventricle forms most of the sternocostal surface.',
        ar: 'يشكّل البطين الأيمن معظم السطح القصي الضلعي.',
      },
    },
    {
      id: 'q2',
      type: 'identify',
      prompt: {
        en: 'Select the vessel that returns venous blood from the upper body to the right atrium.',
        ar: 'اختر الوعاء الذي يعيد الدم الوريدي من الجزء العلوي من الجسم إلى الأذين الأيمن.',
      },
      answer: ['TA:superior_vena_cava'],
      points: 1,
      feedback: {
        en: 'The superior vena cava drains the head, neck, upper limbs and thorax.',
        ar: 'يصرّف الوريد الأجوف العلوي الرأس والعنق والطرفين العلويين والصدر.',
      },
    },
    {
      id: 'q3',
      type: 'mcq',
      prompt: {
        en: 'Which valve separates the left atrium from the left ventricle?',
        ar: 'أي صمام يفصل الأذين الأيسر عن البطين الأيسر؟',
      },
      options: {
        a: { en: 'Tricuspid valve', ar: 'الصمام ثلاثي الشرف' },
        b: { en: 'Mitral valve', ar: 'الصمام التاجي' },
        c: { en: 'Aortic valve', ar: 'الصمام الأبهري' },
        d: { en: 'Pulmonary valve', ar: 'الصمام الرئوي' },
      },
      answer: 'b',
      points: 1,
      feedback: {
        en: 'The mitral (bicuspid) valve is the left atrioventricular valve.',
        ar: 'الصمام التاجي (ثنائي الشرف) هو الصمام الأذيني البطيني الأيسر.',
      },
    },
    {
      id: 'q4',
      type: 'identify',
      prompt: {
        en: 'Select the great vessel that leaves the right ventricle.',
        ar: 'اختر الوعاء الكبير الذي يخرج من البطين الأيمن.',
      },
      answer: ['TA:pulmonary_trunk'],
      points: 1,
      feedback: {
        en: 'The pulmonary trunk carries deoxygenated blood to the lungs.',
        ar: 'ينقل الجذع الرئوي الدم غير المؤكسج إلى الرئتين.',
      },
    },
  ],
  meta: {
    author: 'author1',
    reviewer: 'reviewer1',
    version: 1,
    status: 'published',
    objectives: ['Identify the cardiac chambers', 'Identify the great vessels'],
    difficulty: 'easy',
  },
};

const CARD_011: CaseData = {
  case_id: 'CARD-011',
  course: HEART_COURSE,
  topic: 'Coronary circulation',
  model: 'heart_v1',
  variant: 'myocardial_infarction',
  stem: {
    en: 'A 58-year-old man presents with crushing central chest pain radiating to the left arm. ECG shows ST elevation in leads V1–V4.',
    ar: 'رجل يبلغ من العمر 58 عاماً يشكو من ألم ضاغط في وسط الصدر ينتشر إلى الذراع الأيسر. يُظهر تخطيط القلب ارتفاعاً في المقطع ST في الاتجاهات V1–V4.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: false,
  time_limit_min: 12,
  feedback_level: 'none',
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: { en: 'Select the artery most likely occluded.', ar: 'اختر الشريان الأرجح أنه مسدود.' },
      answer: ['TA:left_anterior_descending'],
      points: 2,
      feedback: {
        en: 'Anterior ST elevation (V1–V4) indicates occlusion of the left anterior descending artery.',
        ar: 'يدل ارتفاع المقطع ST الأمامي (V1–V4) على انسداد الشريان الأمامي النازل الأيسر.',
      },
    },
    {
      id: 'q2',
      type: 'identify',
      prompt: {
        en: 'Select a structure supplied by this artery that is likely to be infarcted.',
        ar: 'اختر بنية يغذيها هذا الشريان ومن المرجح أن تكون مصابة بالاحتشاء.',
      },
      answer: ['TA:interventricular_septum', 'TA:left_ventricle'],
      match: 'any',
      points: 1,
      feedback: {
        en: 'The LAD supplies the anterior left ventricular wall and the anterior two-thirds of the septum.',
        ar: 'يغذي الشريان الأمامي النازل الجدار الأمامي للبطين الأيسر والثلثين الأماميين من الحاجز.',
      },
    },
    {
      id: 'q3',
      type: 'mcq',
      prompt: { en: 'The left anterior descending artery is a branch of which artery?', ar: 'الشريان الأمامي النازل الأيسر هو فرع من أي شريان؟' },
      options: {
        a: { en: 'Right coronary artery', ar: 'الشريان التاجي الأيمن' },
        b: { en: 'Left coronary artery', ar: 'الشريان التاجي الأيسر' },
        c: { en: 'Left circumflex artery', ar: 'الشريان المنعطف الأيسر' },
        d: { en: 'Directly from the aortic arch', ar: 'من قوس الأبهر مباشرة' },
      },
      answer: 'b',
      points: 1,
      feedback: {
        en: 'The left coronary artery divides into the LAD and the circumflex artery.',
        ar: 'ينقسم الشريان التاجي الأيسر إلى الشريان الأمامي النازل والشريان المنعطف.',
      },
    },
    {
      id: 'q4',
      type: 'mcq',
      prompt: { en: 'Which serum marker is most specific for myocardial injury?', ar: 'أي مؤشر في المصل هو الأكثر نوعية لإصابة عضلة القلب؟' },
      options: {
        a: { en: 'Total creatine kinase', ar: 'الكرياتين كيناز الكلي' },
        b: { en: 'Cardiac troponin', ar: 'التروبونين القلبي' },
        c: { en: 'Lactate dehydrogenase', ar: 'نازعة هيدروجين اللاكتات' },
        d: { en: 'Myoglobin', ar: 'الميوغلوبين' },
      },
      answer: 'b',
      points: 1,
      feedback: {
        en: 'Cardiac troponins (I and T) are the most specific markers of myocardial injury.',
        ar: 'التروبونينات القلبية (I و T) هي أكثر المؤشرات نوعية لإصابة عضلة القلب.',
      },
    },
  ],
  meta: {
    author: 'author1',
    reviewer: 'reviewer1',
    version: 1,
    status: 'published',
    objectives: ['Relate ECG territory to coronary anatomy'],
    difficulty: 'medium',
  },
};

/** PRD §10 example (CARD-012), with bilingual fields and feedback added. */
const CARD_012: CaseData = {
  case_id: 'CARD-012',
  course: HEART_COURSE,
  topic: 'Valvular heart disease',
  model: 'heart_v1',
  variant: 'mitral_stenosis',
  stem: {
    en: 'A 45-year-old woman presents with exertional dyspnea and a history of rheumatic fever.',
    ar: 'امرأة تبلغ من العمر 45 عاماً تشكو من ضيق النفس عند الجهد ولديها تاريخ إصابة بالحمى الروماتيزمية.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: false,
  time_limit_min: 10,
  feedback_level: 'score',
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: { en: 'Select the affected valve.', ar: 'اختر الصمام المصاب.' },
      answer: ['TA:mitral_valve'],
      points: 2,
      feedback: {
        en: 'Rheumatic heart disease most commonly causes mitral stenosis.',
        ar: 'يسبب مرض القلب الروماتيزمي تضيق الصمام التاجي في أغلب الأحيان.',
      },
    },
    {
      id: 'q2',
      type: 'mcq',
      prompt: { en: 'What is the most likely etiology?', ar: 'ما السبب الأكثر ترجيحاً؟' },
      options: {
        a: { en: 'Congenital', ar: 'خلقي' },
        b: { en: 'Rheumatic', ar: 'روماتيزمي' },
        c: { en: 'Infective', ar: 'عدوائي' },
        d: { en: 'Degenerative', ar: 'تنكسي' },
      },
      answer: 'b',
      points: 1,
      feedback: {
        en: 'A history of rheumatic fever points to rheumatic mitral stenosis.',
        ar: 'يشير تاريخ الإصابة بالحمى الروماتيزمية إلى تضيق تاجي روماتيزمي المنشأ.',
      },
    },
  ],
  meta: { author: 'author1', reviewer: 'reviewer1', version: 3, status: 'published', difficulty: 'medium' },
};

const REN_001: CaseData = {
  case_id: 'REN-001',
  course: KIDNEY_COURSE,
  topic: 'Renal anatomy',
  model: 'kidney_v1',
  variant: 'renal_cyst',
  stem: {
    en: 'A simple renal cyst is found incidentally on abdominal CT in a 50-year-old woman. Review the internal anatomy of the kidney.',
    ar: 'اكتُشف كيس كلوي بسيط بالصدفة في التصوير المقطعي للبطن لدى امرأة تبلغ من العمر 50 عاماً. راجع التشريح الداخلي للكلية.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['capsule'] },
  labels_visible: false,
  time_limit_min: 10,
  feedback_level: 'full',
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: { en: 'Select the region from which the cyst arises.', ar: 'اختر المنطقة التي ينشأ منها الكيس.' },
      answer: ['TA:renal_cortex'],
      points: 1,
      feedback: { en: 'Simple renal cysts usually arise from the cortex.', ar: 'تنشأ الأكياس الكلوية البسيطة عادةً من القشرة.' },
    },
    {
      id: 'q2',
      type: 'multi',
      prompt: { en: 'Which structures belong to the renal medulla? Select all that apply.', ar: 'أي البنى التالية تنتمي إلى اللب الكلوي؟ اختر كل ما ينطبق.' },
      options: {
        a: { en: 'Renal pyramids', ar: 'الأهرامات الكلوية' },
        b: { en: 'Renal papillae', ar: 'الحليمات الكلوية' },
        c: { en: 'Glomeruli', ar: 'الكبيبات' },
        d: { en: 'Renal columns', ar: 'الأعمدة الكلوية' },
      },
      answer: ['a', 'b'],
      partial_credit: true,
      points: 2,
      feedback: {
        en: 'Pyramids and their papillae form the medulla; glomeruli and renal columns are cortical.',
        ar: 'تشكّل الأهرامات وحليماتها اللب؛ أما الكبيبات والأعمدة الكلوية فهي قشرية.',
      },
    },
    {
      id: 'q3',
      type: 'order',
      prompt: { en: 'Put the structures in the order urine passes through them.', ar: 'رتّب البنى حسب ترتيب مرور البول خلالها.' },
      options: {
        a: { en: 'Ureter', ar: 'الحالب' },
        b: { en: 'Major calyx', ar: 'الكأس الكبرى' },
        c: { en: 'Minor calyx', ar: 'الكأس الصغرى' },
        d: { en: 'Renal pelvis', ar: 'الحوض الكلوي' },
      },
      answer: ['c', 'b', 'd', 'a'],
      points: 2,
      feedback: {
        en: 'Papilla → minor calyx → major calyx → renal pelvis → ureter.',
        ar: 'الحليمة ← الكأس الصغرى ← الكأس الكبرى ← الحوض الكلوي ← الحالب.',
      },
    },
  ],
  meta: { author: 'author1', reviewer: 'reviewer1', version: 1, status: 'published', difficulty: 'easy' },
};

const REN_002: CaseData = {
  case_id: 'REN-002',
  course: KIDNEY_COURSE,
  topic: 'Urinary obstruction',
  model: 'kidney_v1',
  variant: 'hydronephrosis',
  stem: {
    en: 'A 30-year-old man presents with severe colicky flank pain radiating to the groin. Ultrasound shows a dilated collecting system.',
    ar: 'رجل يبلغ من العمر 30 عاماً يشكو من ألم مغصي شديد في الخاصرة ينتشر إلى المنطقة الإربية. يُظهر التصوير بالموجات فوق الصوتية توسعاً في الجهاز الجامع.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['capsule'] },
  labels_visible: false,
  time_limit_min: 15,
  feedback_level: 'score',
  questions: [
    {
      id: 'q1',
      type: 'identify',
      prompt: { en: 'Select the most dilated structure.', ar: 'اختر البنية الأكثر توسعاً.' },
      answer: ['TA:renal_pelvis'],
      points: 1,
      feedback: { en: 'The renal pelvis dilates first above an obstruction.', ar: 'يتوسع الحوض الكلوي أولاً فوق موضع الانسداد.' },
    },
    {
      id: 'q2',
      type: 'mcq',
      prompt: { en: 'What is the most likely cause?', ar: 'ما السبب الأكثر ترجيحاً؟' },
      options: {
        a: { en: 'Ureteric calculus', ar: 'حصاة في الحالب' },
        b: { en: 'Renal cell carcinoma', ar: 'سرطان الخلايا الكلوية' },
        c: { en: 'Acute glomerulonephritis', ar: 'التهاب كبيبات الكلى الحاد' },
        d: { en: 'Renal artery stenosis', ar: 'تضيق الشريان الكلوي' },
      },
      answer: 'a',
      points: 1,
      feedback: { en: 'Colicky loin-to-groin pain is typical of a ureteric stone.', ar: 'الألم المغصي من الخاصرة إلى الإربية نموذجي لحصاة الحالب.' },
    },
    {
      id: 'q3',
      type: 'text',
      prompt: {
        en: 'Briefly explain why prolonged obstruction leads to thinning of the renal parenchyma.',
        ar: 'اشرح باختصار لماذا يؤدي الانسداد المطوّل إلى ترقق النسيج الكلوي.',
      },
      answer: 'Raised back-pressure compresses the papillae and medulla and reduces perfusion, causing atrophy of the parenchyma.',
      points: 3,
      feedback: {
        en: 'Back-pressure and ischaemia cause progressive papillary and parenchymal atrophy.',
        ar: 'يسبب الضغط الراجع ونقص التروية ضموراً تدريجياً في الحليمات والنسيج الكلوي.',
      },
    },
  ],
  meta: { author: 'author1', reviewer: 'reviewer1', version: 1, status: 'published', difficulty: 'hard' },
};

export const HEART_CASES: CaseData[] = [CARD_010, CARD_011, CARD_012];
export const KIDNEY_CASES: CaseData[] = [REN_001, REN_002];
export const BUILTIN_CASES: CaseData[] = [...HEART_CASES, ...KIDNEY_CASES];

/** URL/file-system slug for a course name, e.g. "Anatomy II - Thorax" → "anatomy-ii-thorax". */
export function courseSlug(course: string): string {
  return course.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';
}
