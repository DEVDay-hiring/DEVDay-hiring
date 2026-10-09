import { useEffect, useState } from 'react'
import type { Snapshot } from '../shared/realtime-client.js'
export const dimensions = [
  ['pronunciation', 'Pronunciation', '발음 정확도'], ['fluency', 'Fluency', '유창성'],
  ['accuracy', 'Accuracy', '정확성'], ['complexity', 'Complexity', '복잡성'],
] as const
export type Dimension = { score: number | null; confidence: string; reason: string; strength: string; improvement: string; evidence: string[]; exercise: string }
export type Evaluation = { summary: string; dimensions: Record<typeof dimensions[number][0], Dimension>;
  corrections: { original: string; improved: string; explanation: string }[]; nextPractice: string;
  sample: { wordCount: number; audioSeconds: number; limited: boolean; mode: string }; model: string | null; version: string; evaluatedAt: string }
type Result = { report: Evaluation; notice: string }
const cache = new WeakMap<Snapshot, Promise<Result>>()
function request(record: Snapshot) {
  let job = cache.get(record)
  if (!job) {
    job = (async () => {
      const sample = await record.evaluationAudio
      const learners = record.messages.filter(m => m.role === 'user' && !m.prompted && !m.partial)
      const response = await fetch('/api/evaluation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: learners.slice(0, 60), audio: sample?.audio || null, limited: learners.length > 60 }),
        signal: AbortSignal.timeout(100000) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '회화 평가를 불러오지 못했습니다.')
      return { report: data as Evaluation, notice: sample?.notice || record.recordingNotice || '녹음 없이 텍스트를 기준으로 평가합니다.' }
    })()
    cache.set(record, job)
    void job.catch(() => { cache.delete(record) })
  }
  return job
}
export function useEvaluation(record: Snapshot | null) {
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setResult(null); setError('')
    if (!record) { setLoading(false); return }
    setLoading(true)
    request(record).then(value => { if (active) setResult(value) }).catch(e => {
      if (active) setError(e.name === 'TimeoutError' ? '평가 시간이 초과되었습니다. 다시 시도해 주세요.' : e.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [record, attempt])
  return { result, error, loading, retry: () => setAttempt(n => n + 1) }
}
