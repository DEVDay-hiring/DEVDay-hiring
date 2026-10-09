export async function getHealth(signal) {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch('/api/health', {
    cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status === 404) throw new Error('대화 API가 배포되지 않았습니다. Vercel의 API 배포 설정을 확인하세요.');
  const type = response.headers?.get('content-type');
  if (type && !type.includes('application/json')) throw new Error('대화 API가 올바른 응답을 반환하지 않았습니다. 배포 라우팅을 확인하세요.');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `대화 서버 확인에 실패했습니다 (${response.status}).`);
  if (typeof body.apiKeyConfigured !== 'boolean') throw new Error('대화 API 상태 응답이 올바르지 않습니다.');
  return body;
}
