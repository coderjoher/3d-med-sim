import { registerStrings } from '@medsim/core';

/** Station-specific UI strings (EN / AR), registered into the core string table. */
export const STATION_STRINGS: Record<string, { en: string; ar: string }> = {
  'station.title': { en: 'MedSim Lab station', ar: 'محطة مختبر ميدسيم' },
  'station.sign_in': { en: 'Sign in', ar: 'تسجيل الدخول' },
  'station.university_id': { en: 'University ID', ar: 'الرقم الجامعي' },
  'station.station_id': { en: 'Station ID', ar: 'رقم المحطة' },
  'station.student_id': { en: 'Student ID', ar: 'رقم الطالب' },
  'station.local_mode': { en: 'Local prototype mode — no server; results are stored on this station', ar: 'وضع النموذج الأولي المحلي — بدون خادم؛ تُحفظ النتائج على هذه المحطة' },
  'station.download_logs': { en: 'Download local results (JSON)', ar: 'تنزيل النتائج المحلية (JSON)' },
  'station.local_attempts': { en: '{count} attempt(s) stored on this station', ar: '{count} محاولة/محاولات محفوظة على هذه المحطة' },
  'station.no_cases': { en: 'No cases are available right now', ar: 'لا توجد حالات متاحة حالياً' },
  'station.refresh': { en: 'Refresh', ar: 'تحديث' },
  'station.end_session': { en: 'Sign out', ar: 'تسجيل الخروج' },
  'station.session_ended': { en: 'The session was ended by the proctor', ar: 'أنهى المراقب الجلسة' },
  'station.questions_count': { en: '{count} questions', ar: '{count} أسئلة' },
  'station.minutes': { en: '{n} min', ar: '{n} دقيقة' },
  'station.completed': { en: 'Completed', ar: 'مكتملة' },
  'station.another_case': { en: 'Back to case list', ar: 'العودة إلى قائمة الحالات' },
  'station.server_error': { en: 'Could not reach the lab server', ar: 'تعذر الاتصال بخادم المختبر' },
  'station.queued': { en: 'Saved on this station — it will be sent when the connection returns', ar: 'تم الحفظ على هذه المحطة — سيتم الإرسال عند عودة الاتصال' },
  'station.preview_note': { en: 'Preview as student — nothing is recorded', ar: 'معاينة كطالب — لا يتم تسجيل أي شيء' },
  'station.practice_again': { en: 'Practise again', ar: 'تدرّب مرة أخرى' },
  'station.practice_done': { en: 'Practice finished — this was not graded', ar: 'انتهى التدريب — لم يتم احتسابه' },
  'station.practice_intro': { en: 'Try the controls on a sample model. Nothing here is graded.', ar: 'جرّب أدوات التحكم على نموذج تجريبي. لا شيء هنا محتسب.' },
  'station.go_to_cases': { en: 'Go to my cases', ar: 'الانتقال إلى حالاتي' },
  // case player
  'player.confirm_answer_btn': { en: 'Confirm answer', ar: 'تأكيد الإجابة' },
  'player.your_selection': { en: 'Your selection: {value}', ar: 'اختيارك: {value}' },
  'player.change_answer': { en: 'Change answer', ar: 'تغيير الإجابة' },
  'player.recorded_value': { en: 'Recorded: {value}', ar: 'المسجل: {value}' },
  'player.tools': { en: 'Tools', ar: 'الأدوات' },
  'player.clip_off': { en: 'Off', ar: 'إيقاف' },
  'player.clip_offset': { en: 'Section position', ar: 'موضع المقطع' },
  'player.stereo': { en: 'Stereo (side-by-side) output', ar: 'إخراج مجسم (جنباً إلى جنب)' },
  'player.unanswered_list': { en: 'Unanswered: {list}', ar: 'بدون إجابة: {list}' },
  'player.question_nav': { en: 'Questions', ar: 'الأسئلة' },
  'player.go_to_question': { en: 'Go to question {n}', ar: 'انتقل إلى السؤال {n}' },
  'player.submitting': { en: 'Submitting…', ar: 'جارٍ الإرسال…' },
  'player.view_preset': { en: 'View', ar: 'العرض' },
  'view.anterior': { en: 'Anterior', ar: 'أمامي' },
  'view.posterior': { en: 'Posterior', ar: 'خلفي' },
  'view.left': { en: 'Left', ar: 'أيسر' },
  'view.right': { en: 'Right', ar: 'أيمن' },
  'view.superior': { en: 'Superior', ar: 'علوي' },
  'view.inferior': { en: 'Inferior', ar: 'سفلي' },
  'player.points_of': { en: '{score} / {max} pts', ar: '{score} / {max} درجة' },
  // input
  'input.switched_by_proctor': { en: 'The proctor switched this station to {mode}', ar: 'قام المراقب بتحويل هذه المحطة إلى {mode}' },
  'input.starting': { en: 'Starting camera…', ar: 'جارٍ تشغيل الكاميرا…' },
  'input.error': { en: 'Hand tracking error — using mouse and keyboard', ar: 'خطأ في تتبع اليد — يتم استخدام الفأرة ولوحة المفاتيح' },
  'calibration.skip': { en: 'Skip — use mouse', ar: 'تخطٍ — استخدم الفأرة' },
  'calibration.click_target': { en: 'Pinch (or click) the highlighted target', ar: 'اضغط بالإصبعين (أو انقر) على الهدف المحدد' },
  'calibration.start': { en: 'Start calibration', ar: 'ابدأ المعايرة' },
  // accessibility bar
  'a11y.bar': { en: 'Display settings', ar: 'إعدادات العرض' },
  'a11y.text_smaller': { en: 'Smaller text', ar: 'تصغير النص' },
  'a11y.text_larger': { en: 'Larger text', ar: 'تكبير النص' },
  // kiosk
  'kiosk.fullscreen': { en: 'Enter full screen', ar: 'الدخول إلى وضع ملء الشاشة' },
  'kiosk.exit_prompt': { en: 'Enter the proctor PIN to exit', ar: 'أدخل الرقم السري للمراقب للخروج' },
  'kiosk.exited': { en: 'Kiosk mode exited', ar: 'تم الخروج من وضع الكشك' },
  'kiosk.locked_hint': { en: 'Please wait for the proctor', ar: 'يرجى انتظار المراقب' },
  // bench
  'bench.title': { en: 'Performance benchmark', ar: 'اختبار الأداء' },
  'bench.run': { en: 'Run benchmark', ar: 'تشغيل الاختبار' },
  'bench.download': { en: 'Download report (JSON)', ar: 'تنزيل التقرير (JSON)' },
  'bench.running': { en: 'Measuring…', ar: 'جارٍ القياس…' },
};

let done = false;
export function registerStationStrings() {
  if (done) return;
  done = true;
  registerStrings(STATION_STRINGS);
}
registerStationStrings();
