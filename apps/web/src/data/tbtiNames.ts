/**
 * R15-8 16유형 이름 데이터 (계약 `.roster/contract-r15-v1.0.md` R15-8 그대로).
 * 코드 키 16개와 필드(앞 문구·호칭·영어 별명·견종·카드 본문 7종)는 확정 구조 그대로 둔다.
 * 값은 예시값이다 — 캡틴 손질 대기(앞 문구·호칭·영어 별명·견종은 DRAFT 사본, ko 카드 본문 7종은
 * `.roster/research-gamer-type-review.md` 부록 16유형 카드 초안에서 옮김. 부록 별명은 버림).
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
  koBody: TbtiCardBody = { ...TBTI_BODY_EN_EMPTY },
): TbtiNameEntry {
  return {
    code,
    ko: {
      lead,
      title,
      nickname,
      breed,
      // 카드 본문 ko 값 — 부록 16유형 카드 초안에서 옮긴 예시값(캡틴 손질 대기).
      body: koBody,
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
  INOC: entry(
    'INOC',
    '한 우물을 깊게 파 —',
    '얼리어답터 개척자',
    'New-Release Devotee',
    '보더 콜리',
    {
      definition: '',
      strength:
        '발매일 올인 — 새 시리즈작 정보를 출시 전부터 꿰고 있다 / 완주의 품격 — DLC·수집까지 끝내야 직성이 풀린다',
      slip: '기대가 커서 출시 초 버그·혹평에 데미지가 크다 → "1.0이 아니라 1.1에 평가한다"로 미뤄 두기',
      empathy: '① 발매일 연차·반차 써 본 적 있다 ② 전작 복습런은 의식이다 ③ 아트북·사운드트랙까지 사 모은다',
      ensemble: '잘 맞는 IHOC(같은 시리즈 얘기로 밤샘 가능) / 템포 다른 RHAL(한 판하고 다음 겜 얘기하는 속도를 맞춰 보세요)',
      representativeGame: "Assassin's Creed 신작류, Monster Hunter 신작",
      closing: '"새 시대가 오면, 제일 먼저 문을 여는 사람."',
    },
  ),
  INOL: entry(
    'INOL',
    '내 장르 신작은 다 찍어 봐 —',
    '신작 사냥꾼',
    'Fresh Flavor Hunter',
    '잭 러셀 테리어',
    {
      definition: '',
      strength:
        "새맛 레이더 — 화제작의 '지금 그 맛'을 가장 빨리 안다 / 깔끔한 하차 — 미련 없이 다음으로 넘어가서 쌓이는 게 없다",
      slip: '산 더미(엔딩 못 본 게임)가 쌓이면 죄책감이 온다 → "맛본 것도 플레이"라 미리 정해 두기',
      empathy: '① 발매 주에 사서 초반 10시간이 제일 행복하다 ② 엔딩은 유튜브로 봐도 된다 ③ 올해 후보작은 다 찍먹했다',
      ensemble: '잘 맞는 INAL(다음 화제작 정보 교환) / 템포 다른 RHOC(한 게임 얘기 3시간은 맞춰 보세요)',
      representativeGame: 'Far Cry 신작류, 매년 나오는 스토리 시리즈',
      closing: '"첫맛을 아는 사람이, 제일 부지런한 미식가다."',
    },
  ),
  INAC: entry(
    'INAC',
    '새로운 게 좋아 —',
    '끈질긴 대식가',
    'The Devouring Pilgrim',
    '래브라도 리트리버',
    {
      definition: '',
      strength:
        '명작 감별사 — 새로 나온 스토리 명작을 장르 불문하고 찾아낸다 / 올클 체질 — 서브퀘·수집까지 끝내야 끝난 기분이다',
      slip: 'GOTY 정주행이 숙제가 되면 번아웃이 온다 → "올해는 3개만" 상한 정하기',
      empathy: '① GOTY 리스트는 정주행 목록이다 ② 엔딩 보고 한동안 멍하다 ③ 플래티넘·100%가 몇 개 있다',
      ensemble: '잘 맞는 IHAC(서로 파 온 세계관 교환) / 템포 다른 RHOL(깊이 얘기할 땐 속도를 맞춰 보세요)',
      representativeGame: "Baldur's Gate 3, Clair Obscur: Expedition 33",
      closing: '"명작은 스쳐 가는 게 아니라, 살아 내는 것이다."',
    },
  ),
  INAL: entry(
    'INAL',
    '어디든 푹 빠져 구경해 —',
    '화제작 투어리스트',
    'Hype Tourist',
    '시베리안 허스키',
    {
      definition: '',
      strength:
        '화제 감각 — 모두가 말하는 게임을 제일 먼저 말할 수 있다 / 감상평 공유 — 플레이의 절반은 같이 떠드는 데 있다',
      slip: '스포 회피에 목숨 걸다 피로해진다 → 발매 주만 SNS를 쉬기',
      empathy: '① 스포 피하느라 발매 주가 제일 바쁘다 ② 엔딩 전 하차해도 후회 없다 ③ 감상평 공유가 플레이의 일부다',
      ensemble: '잘 맞는 INOL(화제작 릴레이가 끊이지 않음) / 템포 다른 IHOC(본진 얘기는 가볍게 넘겨 보세요)',
      representativeGame: 'Detroit: Become Human, Life is Strange류',
      closing: '"유행의 최전선에, 항상 자리가 있다."',
    },
  ),
  IHOC: entry(
    'IHOC',
    '돌아갈 세계가 있어 —',
    '장르의 장인',
    'The One-Game Master',
    '진돗개',
    {
      definition: '',
      strength:
        '세계관 박사 — 한 시리즈의 연대기를 줄줄 꿴다 / 냉정한 애정 — 후속작 방향성에도 할 말은 하는 팬이다',
      slip: '애정이 깊어서 혹평에 같이 상처받는다 → "내 우물 점수는 내가 매긴다"로 닫기',
      empathy: '① 같은 세계관 N회차는 기본이다 ② 설정·연대기를 줄줄 욈다 ③ 최애 무기·캐릭 얘기만 1시간 가능하다',
      ensemble: '잘 맞는 INOC(같은 시리즈 새 소식에 같이 흥분) / 템포 다른 RNAL(딴청 부려도 섭섭해하지 않기)',
      representativeGame: 'Persona 시리즈, Monster Hunter',
      closing: '"한 우물을 판 사람이, 가장 깊은 물을 마신다."',
    },
  ),
  IHOL: entry(
    'IHOL',
    '잠깐씩 들러도 늘 여기 —',
    '본진 보안관',
    'The Hometown Local',
    '버니즈 마운틴 독',
    {
      definition: '',
      strength: '복귀의 기쁨 — 돌아올 때마다 반가운 게임이 있다 / 무압박 — 완주 압박 없이 편하게 즐긴다',
      slip: '"언젠가 엔딩 봐야지"가 몇 년째 밀린다 → 밀린 건 밀린 채로 두는 것도 실력',
      empathy: '① 복귀할 때마다 반가움이 먼저다 ② DLC는 구경만 해도 된다 ③ 리마스터 소식에 제일 설렌다',
      ensemble: '잘 맞는 IHAL(추억 얘기 궁합 최고) / 템포 다른 RNOC(빡겜 권유는 가볍게 흘려보내세요)',
      representativeGame: 'Stardew Valley(가끔 접속), 심즈류',
      closing: '"고향은, 없어지지 않으니까."',
    },
  ),
  IHAC: entry(
    'IHAC',
    '장르는 안 가려 —',
    '세계관 역사학자',
    'Lore Collector',
    '푸들',
    {
      definition: '',
      strength:
        '연대기 정리력 — 여러 시리즈 세계관을 머릿속에 정돈해 둔다 / 복습 루틴 — 전작 복습 후 신작이 몸에 밴 순서다',
      slip: '수집 목록이 길어지면 손도 못 대고 쌓인다 → "지금 파는 세계관 2개"로 줄이기',
      empathy: '① 크로스오버·후속작 발표가 명절이다 ② 연대기를 설명해 준 적 있다 ③ 전작 복습이 루틴이다',
      ensemble: '잘 맞는 INAC(서로 안 해본 세계관 추천 교환) / 템포 다른 RHAL(세계관 설명은 짧게 끊어 보세요)',
      representativeGame: 'BioShock 전작, The Witcher 3+DLC',
      closing: '"세계가 몇 개 있어도, 다 내 세계다."',
    },
  ),
  IHAL: entry(
    'IHAL',
    '그때 그 세계가 좋아 —',
    '추억 수집가',
    'Nostalgia Collector',
    '바셋 하운드',
    {
      definition: '',
      strength:
        '회상의 달인 — 옛날 게임 얘기로 좌중을 사로잡는다 / 리마스터 감별사 — 뭐가 바뀌었는지 제일 먼저 안다',
      slip: '추억 보정이라 가끔 "예전이 낫다"로 흐른다 → 리메이크는 새 게임으로 대하기',
      empathy: '① 리마스터·리메이크가 제일 반가운 소식이다 ② 옛날 감성 회상이 플레이의 반이다 ③ 완주 압박 없이 편하다',
      ensemble: '잘 맞는 IHOL(같은 추억 다른 맛) / 템포 다른 RNAC(신작 압박은 흘려보내세요)',
      representativeGame: '리마스터 컬렉션류, Telltale 구작',
      closing: '"추억도, 수집하면 아카이브다."',
    },
  ),
  RNOC: entry(
    'RNOC',
    '한 판 더, 한 장르만 —',
    '신작 마라토너',
    'Fresh Run Veteran',
    '저먼 셰퍼드',
    {
      definition: '',
      strength:
        '패치노트 정독 — 밸런스 변화를 남보다 빨리 읽는다 / 사람 끌어들이기 — 친구를 데려와 같이 파는 쪽이다',
      slip: '랭크·기록에 목매면 게임이 숙제가 된다 → 시즌 목표를 하나로 줄이기',
      empathy: '① 패치노트는 신문처럼 읽는다 ② 랭크 올리기가 일상이다 ③ 친구는 자기가 끌어들인다',
      ensemble: '잘 맞는 RNAC(새 런겜 정보가 곧 합주곡) / 템포 다른 IHAL(한 판 템포를 맞춰 보세요)',
      representativeGame: '새 시즌 FPS, Slay the Spire 2',
      closing: '"새 판이 열리면, 제일 먼저 앉는 사람."',
    },
  ),
  RNOL: entry(
    'RNOL',
    '남들보다 먼저 한 판 —',
    '트렌드 서퍼',
    'Trend Sampler',
    '포메라니안',
    {
      definition: '',
      strength: '진입 속도 — 유행하는 한판겜에 제일 빨리 올라탄다 / 썰 수확 — 에피소드가 남는 게 수확이다',
      slip: '유행 지나면 미련 없이 접어서 "남는 게 없다"는 소리가 나온다 → 썰이 남았으면 된 것',
      empathy: '① 친구 따라 시작한 게 대부분이다 ② 유행 지나면 미련 없이 접는다 ③ 에피소드(썰)가 수확이다',
      ensemble: '잘 맞는 RNAL(유행 얘기로 금방 친해짐) / 템포 다른 IHOC(우물 얘기가 길어지면 가볍게 끊어 보세요)',
      representativeGame: 'Fall Guys 유행기, Vampire Survivors',
      closing: '"유행은 지나가도, 썰은 남는다."',
    },
  ),
  RNAC: entry(
    'RNAC',
    '새 런이면 끝까지 —',
    '신작 런 장인',
    'New Run Grinder',
    '그레이하운드',
    {
      definition: '',
      strength: '얼리액세스 추적 — 정발 전에 이미 꿰고 있다 / 빌드 연구 — 덱·빌드 파는 게 본게임이다',
      slip: '추적작이 많아지면 전부 중도 하차한다 → "이번 달 1작"으로 좁히기',
      empathy: '① 얼리액세스 추적이 취미다 ② 후기는 남겨야 직성이 풀린다 ③ 덱·빌드 연구가 본게임이다',
      ensemble: '잘 맞는 RHAC(서로 다른 런겜 얘기로 밤샘) / 템포 다른 IHOL(깊이 얘기는 속도를 맞춰 보세요)',
      representativeGame: 'Hades II, Backpack Hero류',
      closing: '"새 런이 열리면, 장르 불문하고 파고든다."',
    },
  ),
  RNAL: entry(
    'RNAL',
    '한 판씩 맛만 볼게 —',
    '트렌드 미식가',
    'Trend Stroller',
    '비글',
    {
      definition: '',
      strength: '데모 싹쓸이 — 스팀 축제 때 제일 바쁜 사람이다 / 가벼운 추천 — 상대 취향에 맞는 걸 잘 골라 준다',
      slip: '본편 구매가 신중해서 찜만 쌓인다 → 찜은 찜대로 즐기는 목록으로 두기',
      empathy: '① 데모 페스티벌이 행사다 ② 본편 구매는 신중하다 ③ 가벼운 추천을 잘한다',
      ensemble: '잘 맞는 RNOL(유행 지도 공유) / 템포 다른 INOC(한 게임 얘기가 길어지면 가볍게 넘겨 보세요)',
      representativeGame: '데모 페스티벌류, Party Animals류',
      closing: '"산책자에게도, 지도는 있다."',
    },
  ),
  RHOC: entry(
    'RHOC',
    '한 판 더, 늘 그 게임 —',
    '장르의 달인',
    'The One-Run Grinder',
    '불독',
    {
      definition: '',
      strength: '살아있는 공략집 — 빌드 질문은 이 사람에게 / 실력 우선 — 패치보다 손이 먼저 적응한다',
      slip: '"너도 해봐" 권유가 강해질 때가 있다 → 가르치는 건 요청받을 때만',
      empathy: '① 빌드 연구가 생활이다 ② 남은 가르쳐주는 쪽이다 ③ 같은 게임 수천 시간도 안 질린다',
      ensemble: '잘 맞는 RHAC(런겜 얘기는 무한) / 템포 다른 INAL(스토리 감상 얘기는 속도를 맞춰 보세요)',
      representativeGame: 'The Binding of Isaac, 원툴 대전 게임',
      closing: '"한 판을 만 번 한 사람이, 제일 무섭다."',
    },
  ),
  RHOL: entry(
    'RHOL',
    '딱 한 판만 하고 갈게 —',
    '부지런한 단골 손님',
    'The Regular',
    '웰시 코기',
    {
      definition: '',
      strength: '매일 루틴 — 접속 자체가 생활 리듬이다 / 무경쟁 — 승패에 연연하지 않아 같이 하기 편하다',
      slip: '루틴이 끊기면 복귀가 어색해진다 → "3일 쉬어도 단골"이라 정하기',
      empathy: '① 접속은 매일, 빡겜은 안 한다 ② 데일리·출첵이 루틴이다 ③ 기록 경쟁은 구경만 한다',
      ensemble: '잘 맞는 IHOL(가벼운 단골 감성 공유) / 템포 다른 INAC(깊이 권유는 흘려보내세요)',
      representativeGame: '매일 한 판 퍼즐류, 칼바람류',
      closing: '"매일 오는 손님이, 진짜 단골이다."',
    },
  ),
  RHAC: entry(
    'RHAC',
    '런 게임이면 다 파 봐 —',
    '러너 연구자',
    'Run Librarian',
    '슈나우저',
    {
      definition: '',
      strength:
        '장르별 최애 보유 — 물어보면 맞는 책(게임)을 꺼내 준다 / 로테이션 운영 — 시즌·패치 따라 돌려가며 판다',
      slip: '추천·정리에 빠져 정작 플레이가 줄어든다 → 읽는 시간보다 도는 시간',
      empathy: '① 장르별 최애 1개씩 있다 ② 시즌·패치 따라 로테이션한다 ③ 빌드 얘기는 언제든 환영이다',
      ensemble: '잘 맞는 RNAC(새 런겜 발굴 공유) / 템포 다른 INOL(새맛 얘기보다 묵은맛 얘기를 해 보세요)',
      representativeGame: 'Isaac + Spire + Into the Breach류',
      closing: '"도서관이 클수록, 사서는 강하다."',
    },
  ),
  RHAL: entry(
    'RHAL',
    '이것저것 한 판씩 —',
    '사랑방 단골',
    'Clubhouse Regular',
    '퍼그',
    {
      definition: '',
      strength: '기분 매칭 — 오늘 기분에 맞는 판을 잘 고른다 / 승패 초월 — 즐거우면 된 거라 같이 하기 편하다',
      slip: '가볍게만 해서 "진득함이 없다"는 소리가 나온다 → 가벼움이 이 유형의 진득함',
      empathy: '① 기분 따라 고른다 ② 질리면 쉬었다 온다 ③ 승패에 연연 안 한다',
      ensemble: '잘 맞는 RNAL(가벼운 판 약속이 잘 잡힘) / 템포 다른 INOC(한 게임 몰입 얘기는 가볍게 들어 보세요)',
      representativeGame: 'Overcooked!(가끔), Mario Kart류',
      closing: '"사랑방이 오래가는 건, 편해서다."',
    },
  ),
};

/** 코드 키 16개 (계약 R15-8 확정 순서). */
export const TBTI_CODES: readonly TbtiCode[] = [
  'INOC', 'INOL', 'INAC', 'INAL',
  'IHOC', 'IHOL', 'IHAC', 'IHAL',
  'RNOC', 'RNOL', 'RNAC', 'RNAL',
  'RHOC', 'RHOL', 'RHAC', 'RHAL',
];
