export const MIC_MESSAGES = {
  unsupported: '이 브라우저에서는 마이크를 쓸 수 없어요. https 주소의 Chrome이나 Edge에서 열어 주세요.',
  denied: '마이크 사용이 허용되지 않았어요. 주소창의 권한 설정에서 허용한 뒤 다시 눌러 주세요.',
  notFound: '연결된 마이크를 찾지 못했어요. 마이크를 연결한 뒤 다시 눌러 주세요.',
  busy: '다른 프로그램이 마이크를 쓰고 있어요. 그 프로그램을 닫고 다시 눌러 주세요.',
  failed: '마이크를 시작하지 못했어요. 다시 눌러 주세요.',
  stopped: '마이크 연결이 끊겼어요. 다시 연결하려면 버튼을 눌러 주세요.',
  listening: '마이크 소리에 맞춰 그림이 움직여요. 소리는 저장하거나 보내지 않아요.',
  noSignal: '소리가 들어오지 않아요. 마이크가 켜져 있는지 확인해 주세요.',
} as const;

/**
 * Voice-call processing is switched off. Noise suppression treats music as noise to remove,
 * which would leave the analyser with little to draw.
 */
export function requestMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error(MIC_MESSAGES.unsupported));
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
}

export function micErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_MESSAGES.denied;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return MIC_MESSAGES.notFound;
  if (name === 'NotReadableError' || name === 'AbortError') return MIC_MESSAGES.busy;
  if (error instanceof Error && Object.values<string>(MIC_MESSAGES).includes(error.message)) return error.message;
  return MIC_MESSAGES.failed;
}
