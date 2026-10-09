import './mvp.css'
import './assessment.css'
import AssetImage from './AssetImage'
import { devdayAsset } from './assets'
import { useState } from 'react'
import { useEvaluation } from './evaluation'
import AssessmentPanel from './AssessmentPanel'
import type { Snapshot } from '../shared/realtime-client.js'
import { elapsed } from './time'

type Props = { person: { name: string }; record: Snapshot | null; onBack: () => void; onRetry: () => void }
const phrases = [
  ['In my opinion…', '제 생각에는…'], ['Could you tell me more?', '좀 더 이야기해 주시겠어요?'],
  ['Let me put it another way.', '다른 말로 표현해 볼게요.'], ['What do you mean by that?', '그게 어떤 뜻인가요?'],
]
export default function SummaryScreen({ person, record, onBack, onRetry }: Props) {
  const [tab, setTab] = useState<'assessment' | 'record'>('assessment')
  const evaluation = useEvaluation(record)
  const messages = record?.messages.filter(m => m.text.trim()) || []
  const userMessages = messages.filter(m => m.role === 'user')
  const words = userMessages.flatMap(m => m.text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [])
  const unique = new Set(words.map(w => w.toLowerCase())).size
  const download = () => {
    const blob = new Blob([JSON.stringify({ persona: person.name, savedAt: new Date().toISOString(), durationSeconds: record?.durationSeconds || 0,
      messages, sources: record?.sources || [], evaluation: evaluation.result?.report || null, note: 'AI simulation. Interrupted transcripts may include unheard content. Scores are provisional AI coaching, not certified proficiency.' }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `HiRing-conversation-${new Date().toISOString().slice(0, 10)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <button className="flow-logo" type="button" onClick={onBack} aria-label="인물 선택으로 돌아가기"><span className="brand"><span>Hi</span><b>:</b><span>Ring</span></span></button>
    <nav className="summary-page-tabs" aria-label="결과 보기"><button aria-pressed={tab === 'assessment'} onClick={() => setTab('assessment')}>영어 실력 평가</button><button aria-pressed={tab === 'record'} onClick={() => setTab('record')}>대화 기록 · 통계</button></nav>
    {tab === 'assessment' ? <AssessmentPanel evaluation={evaluation} onRetry={onRetry} onDownload={download} hasRecord={!!record} /> : <>
    <span className="summary-status">대화 돌아보기</span>
    <h1 className="summary-heading"><span>수고했어요!</span><br />오늘의 한마디가<br />내일의 자신감으로.</h1>
    <AssetImage className="summary-duo" sizes="(max-width: 799px) 100vw, 425px" src={devdayAsset('summary-duo.webp')} alt="대화를 마친 두 사람" />
    <div className="summary-small-speech"><small>{person.name} · AI</small><p>Keep the conversation<br />going!</p></div>
    <section className="summary-score-panel mvp-results" aria-label="실제 대화 통계">
      <div className="mvp-result-mark">{elapsed(record?.durationSeconds || 0)}<small>함께한 시간</small></div>
      <div className="summary-score-intro"><small>YOUR SESSION</small><h2>{userMessages.length ? '당신의 대화가 쌓였어요' : '첫 대화를 시작해 볼까요?'}</h2><p>{record ? '방금 나눈 실제 대화를 바탕으로 정리했어요.' : '아직 기록이 없어요. 새로고침하면 이전 기록은 사라져요.'}<br />음성 자막과 텍스트 입력 기준 통계입니다.</p></div>
      <div className="summary-score-grid">{[['내 발화', `${record?.turns || 0}회`], ['영어 단어', `${words.length}개`], ['다양한 단어', `${unique}개`], ['참고 기사', `${record?.sources.length || 0}개`]].map(([label, value]) => <div className="summary-score-card" key={label}><h3>{label}</h3><strong>{value}</strong><small>이번 대화 기준</small></div>)}</div>
    </section>
    <section className="summary-feedback-panel mvp-review" aria-label="실제 대화 기록"><h2>Conversation recap <small>실제 대화 기록</small></h2>
      <div className="mvp-review-messages">{!messages.length && <p>아직 대화 기록이 없습니다. 아래 버튼으로 시작해 보세요.</p>}{messages.map(m => <article key={m.id} className={m.role}><strong>{m.role === 'user' ? 'You' : 'Trump AI'}{m.interrupted ? ' · 발화 중단' : ''}</strong><p>{m.text}</p></article>)}</div>
      <div className="summary-actions"><button className="summary-retry" onClick={onRetry}><AssetImage src={devdayAsset('refresh.svg')} alt="" />다시 대화하기</button><button className="summary-learn" onClick={download} disabled={!messages.length}>대화 기록 저장 ↓</button></div>
    </section>
    <section className="summary-phrases-panel mvp-phrases"><h2>다음 대화에 써보세요</h2><p className="phrase-note">회화 연습용 추천 표현 · 기기 기본 음성</p><div className="summary-phrase-list">{phrases.map(([en, ko]) => <div className="summary-phrase" key={en}><strong>{en}</strong><small>{ko}</small></div>)}</div></section>
    <section className="summary-recommend-panel mvp-summary-sources"><h2>함께 살펴본 자료</h2><div>{!record?.sources.length ? <p>이번 대화에서 검색한 기사가 없습니다.</p> : record.sources.map(s => <details key={s.filename}><summary>{s.filename}</summary><p>{s.text}</p></details>)}<p className="subtle">영어 실력 평가 탭에서 발음·유창성·정확성·복잡성에 대한 피드백을 확인하세요.</p><button onClick={onBack}>다른 인물 둘러보기 →</button></div></section>
    </>}
  </>
}
