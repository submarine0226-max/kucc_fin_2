import type { ElementKey } from './audio/features';

export interface TutorialStep {
  /** The instrument this step isolates. Null plays and shows everything. */
  element: ElementKey | null;
  title: string;
  /** Replaces the instrument wording on feature steps. */
  body?: string;
  note?: string;
  /** Controls to point at, as CSS selectors. */
  targets?: string[];
}

const NAMES: Record<ElementKey, string> = { drums: '드럼', bass: '베이스', vocal: '보컬', melody: '멜로디' };
const instrument = (element: ElementKey): TutorialStep => ({ element, title: NAMES[element] });

/** The instruments one at a time, then each feature in the order someone would reach for it. */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    element: null,
    title: '소리결에 오신 걸 환영해요',
    body: '소리를 듣지 않아도 음악을 그림으로 느낄 수 있어요.',
    note: '먼저 네 악기를 하나씩 보고, 이어서 기능을 소개할게요.',
  },
  instrument('drums'),
  instrument('bass'),
  instrument('vocal'),
  instrument('melody'),
  {
    element: null,
    title: '악기를 눌러 집중하기',
    body: '오른쪽 설명에서 악기를 누르면 그 악기만 강조돼요.',
    note: '같은 악기를 다시 누르면 전체 보기로 돌아와요.',
    targets: ['#legend-list'],
  },
  {
    element: null,
    title: '분위기 읽기',
    body: '곡이 신나는지, 평온한지, 슬픈지, 강렬한지 보여줘요.',
    note: '판정은 추정이에요. 분위기에 따라 그림의 색과 움직임도 달라져요.',
    targets: ['.mood'],
  },
  {
    element: null,
    title: '그림 스타일 바꾸기',
    body: '같은 곡을 9가지 그림으로 볼 수 있어요.',
    note: '숫자키 1~9로도 바꿀 수 있어요.',
    targets: ['#style-picker'],
  },
  {
    element: null,
    title: '색 조합 바꾸기',
    body: '그림과 설명의 색을 한 번에 바꿔요.',
    note: '사용자 지정을 고르면 색상, 채도, 따뜻함을 직접 조절할 수 있어요. C 키로도 바꿀 수 있어요.',
    targets: ['.palette-control'],
  },
  {
    element: null,
    title: '그림 움직여 보기',
    body: '휠로 확대하고 드래그로 이동하거나 돌려 볼 수 있어요.',
    note: '더블클릭하면 처음 시점으로 돌아와요.',
    targets: ['#view-hint'],
  },
  {
    element: null,
    title: '재생 조절하기',
    body: '재생, 위치 이동, 소리 크기를 조절해요.',
    note: '파일과 샘플 곡은 소리를 꺼도 그림이 그대로 움직여요. Space로 재생을 멈출 수 있어요.',
    targets: ['.transport'],
  },
  {
    element: null,
    title: '번쩍임 줄이기',
    body: '빛에 민감하다면 켜 주세요. 강한 깜빡임을 부드러운 변화로 바꿔요.',
    targets: ['.switch-row-dark'],
  },
  {
    element: null,
    title: '영상 만들기',
    body: '그림과 소리를 영상으로 저장해요.',
    note: '세로, 정사각형, 현재 화면 비율로 저장할 수 있어요.',
    targets: ['#open-export'],
  },
  {
    element: null,
    title: '화면 넓게 쓰기',
    body: '설명과 메뉴를 숨기거나 전체 화면으로 볼 수 있어요.',
    note: 'H 키는 설명 숨기기, F 키는 전체 화면이에요.',
    targets: ['#toggle-legend', '#toggle-dock', '#fullscreen'],
  },
  {
    element: null,
    title: '내 음악 넣기',
    body: '다른 곡을 누르면 파일, 링크, 유튜브, 마이크로 내 음악을 볼 수 있어요.',
    note: '이 튜토리얼은 설명 패널에서 언제든 다시 볼 수 있어요.',
    targets: ['#back'],
  },
];

export interface TutorialCopy {
  progress: string;
  title: string;
  body: string;
  note: string;
  nextLabel: string;
  canGoBack: boolean;
}

/**
 * Solo means the sound itself was separated, which is only possible for songs synthesised
 * here. For anything else the wording has to admit the sound is unchanged.
 */
export function tutorialCopy(index: number, solo: boolean, legendText: (key: ElementKey) => string): TutorialCopy {
  const step = TUTORIAL_STEPS[index];
  const name = step.element ? NAMES[step.element] : '';
  const instrumentBody = solo ? `${name} 소리만 남겼어요.` : `그림에서 ${name}만 강조했어요. 소리는 그대로예요.`;
  return {
    progress: `${index + 1} / ${TUTORIAL_STEPS.length}`,
    title: step.title,
    body: step.body ?? instrumentBody,
    note: step.element ? `찾아보세요: ${legendText(step.element)}` : step.note ?? '',
    nextLabel: index === TUTORIAL_STEPS.length - 1 ? '마치기' : '다음',
    canGoBack: index > 0,
  };
}
