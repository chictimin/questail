/**
 * TBTI 판정 상수 중앙 파일 (계약 R15-10, 동결 v1.0 + v1.0.1 델타).
 * 계약 R15-10 행 이름과 1:1 주석 필수 — 각 상수 주석에 행 이름을 적는다.
 * 부록 B I/R 태그 사전(I 33·R 23) 전문 pin 포함.
 * T1(recap/compute.ts)·T3(series/normalize.ts)의 중복 상수는 손대지 않는다(리뷰어가 통합).
 * DB·FS·HTTP·Date·Random·apps/web import 0.
 */

/** R15-10 「I/R 태그 사전」(부록 B pin — 제안). SteamSpy 태그 표기(영어) 기준. Singleplayer·Multiplayer·Co-op 제외(판별력 없음). */
export const TBTI_IR_TAGS_I: readonly string[] = [
  'Story Rich',
  'Choices Matter',
  'CRPG',
  'JRPG',
  'Cinematic',
  'Lore-Rich',
  'Narrative',
  'Story-Driven',
  'Visual Novel',
  'Interactive Fiction',
  'Multiple Endings',
  'Open World',
  'Open World Survival Craft',
  'Survival',
  'Survival Horror',
  'Crafting',
  'Building',
  'Base-Building',
  'Colony Sim',
  'Sandbox',
  'Life Sim',
  'Farming Sim',
  'Agriculture',
  'Management',
  'Relaxing',
  'Character Customization',
  'Exploration',
  'Atmospheric',
  'Fantasy',
  'Underwater',
  'Space',
  'Post-apocalyptic',
  'Zombies',
];

/** R15-10 「I/R 태그 사전」(부록 B pin — 제안). Souls-like/Souls-Like 중복은 C12 대소문자 무시 정확 일치 하에서 무해한 잉여라 유지한다(R21). */
export const TBTI_IR_TAGS_R: readonly string[] = [
  'Rogue-like',
  'Rogue-lite',
  'Action Roguelike',
  'Action Roguelite',
  'Roguelike Deckbuilder',
  'Deckbuilding',
  'Arcade',
  'PvP',
  'Competitive',
  'eSports',
  'Sports',
  'Racing',
  'Card Battler',
  'Card Game',
  'Bullet Hell',
  'Fast-Paced',
  'Score Attack',
  'Souls-like',
  'Souls-Like',
  'Puzzle',
  'Looter Shooter',
  'Hack and Slash',
  'Difficult',
];

/** R15-10 「①축 경계」(확정): 50%(고정 상수). 우세 쪽이 글자 + similar ±10%(SPEC 확정). */
export const TBTI_IR_BOUNDARY_PCT = 50;

/** R15-10 「② N 경계」(확정): 50%(N_min ≥ 50% → N). 캡틴 결정. */
export const TBTI_N_BOUNDARY_PCT = 50;

/** R15-10 「② H 경계」(확정 N1): 30%. 캡틴 결정. 공개 레퍼런스 없음. */
export const TBTI_H_BOUNDARY_PCT = 30;

/** R15-10 「③축 경계」(확정): 50%(고정 상수). ①과 동일 구조. */
export const TBTI_OA_BOUNDARY_PCT = 50;

/** R15-10 「④축 경계」(확정): 50%(고정 상수). ①과 동일 구조. */
export const TBTI_CL_BOUNDARY_PCT = 50;

/** R15-10 「축별 최소 표본」(제안): ①집중3 — 판정 게임(I/R 기여 편 수 합) 3편. */
export const TBTI_MIN_SAMPLE_IR_PIECES = 3;

/** R15-10 「축별 최소 표본」(제안): ②시기3 — 출시일 확인 게임 3편(증거 없음 분류 포함). */
export const TBTI_MIN_SAMPLE_NH_KNOWN = 3;

/** R15-10 「축별 최소 표본」(제안): ③폭3 — 장르 확인 게임 3편. */
export const TBTI_MIN_SAMPLE_OA_KNOWN = 3;

/** R15-10 「축별 최소 표본」(제안): ④끝맺음 업적2 — ready(달성률 산출 가능) 2편이면 표본 충족. */
export const TBTI_MIN_SAMPLE_CL_READY = 2;

/** R15-10 「축별 최소 표본」(제안): ④끝맺음 대리3 — 업적2 미달 시 대상 게임 3편으로 대리 충족. */
export const TBTI_MIN_SAMPLE_CL_PROXY = 3;

/** R15-10 「총 5시간 보류」(확정 SPEC): 5시간 = 300분. PS 10h 컷 대비 관대 + 첫 실행 표시 원칙. */
export const TBTI_PENDING_NEED_MINUTES = 300;

/** R15-10 「±10% 「비슷해요」」(확정 SPEC, ①③④만. ② 없음): 주·부 차이 ±10% 이내면 similar. */
export const TBTI_SIMILAR_TOLERANCE_PCT = 10;

/** R15-10 「「둘 다 강해요」」(확정): N·H 둘 다 각 경계 이상이면 칩. 캡틴 결정. */
export const TBTI_BOTH_STRONG_N_PCT = TBTI_N_BOUNDARY_PCT;
export const TBTI_BOTH_STRONG_H_PCT = TBTI_H_BOUNDARY_PCT;

/** R15-10 「"짧게 그만둔" 2시간」(확정 N3): confirmedMinutes < 2시간(분 단위). Steam 환불 정책 첫 경계만 공개 근거. */
export const TBTI_QUIT_MINUTES = 120;

/** R15-10 「"그만둔" 최근성 90일」(확정 N3): lastPlayed가 90일 전. 캡틴 결정. CONCEPT "마지막 플레이 몇 일 전". 초 단위. */
export const TBTI_QUIT_RECENCY_SECONDS = 90 * 86400;

/** R15-10 「④ 중앙값 CAP」(확정 N2): 500시간. 캡틴 결정. log10(1+500) 스케일. */
export const TBTI_MEDIAN_CAP_HOURS = 500;

/** R15-10 「N 신작 기간 W」(제안): 12개월 = 365일(일 단위 환산). Steam Replay 당해=신작. 초 단위. */
export const TBTI_NEW_WINDOW_SECONDS = 365 * 86400;

/** R15-10 「evidence 상위 5」(확정 N7): 축별 상위 5행 · metric.value 내림차순 · 동률 key 오름차순. */
export const TBTI_EVIDENCE_ROWS = 5;

/** R15-10 「③ 변환 끝점」(제안, 판정 권고): HHI=1/G → A=100, HHI=1 → A=0. G 정의 포함. 식은 judge.ts, 값 경계는 여기 둔다. */
export const TBTI_OA_ENDPOINT_MIN = 100;
export const TBTI_OA_ENDPOINT_MAX = 0;

/** R15-10 「④ 업적 기준선」(IMC 2016, 확인): 표시용으로만 싣는다(판정에 쓰지 않음). i18n 키는 제안. */
export const TBTI_BASELINE_IMC2016_KEY = 'tbti.baseline.imc2016';
export const TBTI_BASELINE_IMC2016_TEXT_KEY = 'tbti.baseline.imc2016.text';

/**
 * R15-10 중 T2가 두지 않는 행의 정본 위치 (리뷰어 통합용 메모 — 값이 아님):
 * - 「출시 시기 구간」 신작=당해·최근=1~7년·고전=8년+ → T1 recap/compute.ts RECAP_RECENT_SPAN_YEARS
 * - 「별점 편차 경계」 |dev| ≥ 1.0 → T1 RECAP_RATING_DEV_THRESHOLD
 * - 「편차작 행 수」 칸당 3행 → T1 RECAP_DEVIANT_ROWS
 * - 「top5 동점 규칙」 5위 동점 전원 포함 → T1 RECAP_TOP5_COUNT
 * - 「03 구간 5개 경계」 <2h·2~10h·10~30h·30~100h·100h+ → T1 RECAP_BUCKET_BOUNDS_MINUTES
 * - 「③ HHI」 appdetails 장르·배정 총수 분모 → 식은 judge.ts(상수 없음, R15-5 ③ 확정 구조)
 * - 같은 묶음 2작 이상 H 근거 → T3 SERIES_MIN_BUNDLE_SIZE
 */
