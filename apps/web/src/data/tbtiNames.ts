/**
 * R15-8 16유형 이름 데이터 (계약 `.roster/contract-r15-v1.0.md` R15-8 그대로).
 * 코드 키 16개와 필드(앞 문구·호칭·영어 별명·견종·카드 본문 7종)는 확정 구조 그대로 둔다.
 * 값은 예시값이다 — 캡틴 손질 대기(DRAFT 사본에서 옮김, 문서에 적힌 값은 예시).
 * ko/en 쌍으로 두되, 카드 본문 영어판은 범위 밖이므로 en 본문 자리는 비워 둔다.
 * 화면·공유 텍스트는 이 파일을 읽기만 한다(렌더 입력). 출력 문구 하드코딩이 아니다.
 */

export type TbtiCode =
  | 'INOC' | 'INOL' | 'INAC' | 'INAL'
  | 'IHOC' | 'IHOL' | 'IHAC' | 'IHAL'
  | 'RNOC' | 'RNOL' | 'RNAC' | 'RNAL'
  | 'RHOC' | 'RHOL' | 'RHAC' | 'RHAL';

/** 카드 본문 7종 (계약 R15-8: 정의·강점·삐끗·공감·합주·대표게임·끝 한 줄). */
export interface TbtiCardBody {
  definition: string;
  strength: string;
  slip: string;
  empathy: string;
  ensemble: string;
  representativeGame: string;
  closing: string;
}

/** 범위 밖 표시 — 카드 본문 영어판이 오기 전까지 en 본문 자리에 쓴다. */
export const TBTI_BODY_EN_EMPTY: TbtiCardBody = {
  definition: '',
  strength: '',
  slip: '',
  empathy: '',
  ensemble: '',
  representativeGame: '',
  closing: '',
};

export interface TbtiNameLocale {
  /** 앞 문구 (예시값). */
  lead: string;
  /** 호칭 (예시값). */
  title: string;
  /** 영어 별명(구안) (예시값). */
  nickname: string;
  /** 견종 (예시값). 타이니 탄이(요크셔테리어)는 16유형 어디에도 배정하지 않는다. */
  breed: string;
  body: TbtiCardBody;
}

export interface TbtiNameEntry {
  code: TbtiCode;
  ko: TbtiNameLocale;
  en: TbtiNameLocale;
}

function entry(
  code: TbtiCode,
  lead: string,
  title: string,
  nickname: string,
  breed: string,
): TbtiNameEntry {
  return {
    code,
    ko: {
      lead,
      title,
      nickname,
      breed,
      // 카드 본문 ko 자리는 비워 둠 — 본문 문구는 DRAFT 정본 이관 시 채운다(예시값 자리).
      body: { ...TBTI_BODY_EN_EMPTY },
    },
    en: {
      // 영어 로케일은 코드·축 이름·UI만 영어이므로 앞 문구·호칭·견종 en은 범위 밖 — 자리만 둔다.
      lead: '',
      title: '',
      nickname,
      breed: '',
      body: { ...TBTI_BODY_EN_EMPTY },
    },
  };
}

/** 16유형 이름표. 키 순서 = 계약 R15-8 표 순서. 값은 예시값(캡틴 손질 대기). */
export const TBTI_NAMES: Record<TbtiCode, TbtiNameEntry> = {
  INOC: entry('INOC', '한 우물을 깊게 파 —', '얼리어답터 개척자', 'New-Release Devotee', '보더 콜리'),
  INOL: entry('INOL', '내 장르 신작은 다 찍어 봐 —', '신작 사냥꾼', 'Fresh Flavor Hunter', '잭 러셀 테리어'),
  INAC: entry('INAC', '새로운 게 좋아 —', '끈질긴 대식가', 'The Devouring Pilgrim', '래브라도 리트리버'),
  INAL: entry('INAL', '어디든 푹 빠져 구경해 —', '화제작 투어리스트', 'Hype Tourist', '시베리안 허스키'),
  IHOC: entry('IHOC', '돌아갈 세계가 있어 —', '장르의 장인', 'The One-Game Master', '진돗개'),
  IHOL: entry('IHOL', '잠깐씩 들러도 늘 여기 —', '본진 보안관', 'The Hometown Local', '버니즈 마운틴 독'),
  IHAC: entry('IHAC', '장르는 안 가려 —', '세계관 역사학자', 'Lore Collector', '푸들'),
  IHAL: entry('IHAL', '그때 그 세계가 좋아 —', '추억 수집가', 'Nostalgia Collector', '바셋 하운드'),
  RNOC: entry('RNOC', '한 판 더, 한 장르만 —', '신작 마라토너', 'Fresh Run Veteran', '저먼 셰퍼드'),
  RNOL: entry('RNOL', '남들보다 먼저 한 판 —', '트렌드 서퍼', 'Trend Sampler', '포메라니안'),
  RNAC: entry('RNAC', '새 런이면 끝까지 —', '신작 런 장인', 'New Run Grinder', '그레이하운드'),
  RNAL: entry('RNAL', '한 판씩 맛만 볼게 —', '트렌드 미식가', 'Trend Stroller', '비글'),
  RHOC: entry('RHOC', '한 판 더, 늘 그 게임 —', '장르의 달인', 'The One-Run Grinder', '불독'),
  RHOL: entry('RHOL', '딱 한 판만 하고 갈게 —', '부지런한 단골 손님', 'The Regular', '웰시 코기'),
  RHAC: entry('RHAC', '런 게임이면 다 파 봐 —', '러너 연구자', 'Run Librarian', '슈나우저'),
  RHAL: entry('RHAL', '이것저것 한 판씩 —', '사랑방 단골', 'Clubhouse Regular', '퍼그'),
};

/** 코드 키 16개 (계약 R15-8 확정 순서). */
export const TBTI_CODES: readonly TbtiCode[] = [
  'INOC', 'INOL', 'INAC', 'INAL',
  'IHOC', 'IHOL', 'IHAC', 'IHAL',
  'RNOC', 'RNOL', 'RNAC', 'RNAL',
  'RHOC', 'RHOL', 'RHAC', 'RHAL',
];
