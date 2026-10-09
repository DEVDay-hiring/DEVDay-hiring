import AssetImage from './AssetImage'
import { devdayAsset } from './assets'
import { dimensions, type useEvaluation } from './evaluation'

type Props = { evaluation: ReturnType<typeof useEvaluation>; onRetry: () => void; onDownload: () => void; hasRecord: boolean }
export default function AssessmentPanel({ evaluation, onRetry, onDownload, hasRecord }: Props) {
  const { result, error, loading, retry } = evaluation
  const report = result?.report
  const confidence: Record<string, string> = { low: '제한적 근거', medium: '보통 근거', high: '충분한 근거' }
  return <div className="assessment-layout">
    <aside className="assessment-intro"><span className="assessment-kicker">YOUR ENGLISH, IN FOCUS</span><h1>대화 속에 담긴<br /><em>나의 영어 실력.</em></h1><p>점수보다 중요한 건<br />다음 대화에서의 작은 변화예요.</p>
      <div className="assessment-context"><b>이번 대화의 AI 참고 평가</b><p>실제 사용자 발화만 평가합니다. 공인 시험 점수나 다른 사용자와 비교한 순위가 아닙니다.</p><small>점수 기준 · 0–100<br />기초 0–39 / 발전 중 40–59<br />안정적 60–79 / 능숙 80–100</small></div>
      <AssetImage sizes="(max-width: 799px) 100vw, 425px" src={devdayAsset('summary-duo.webp')} alt="대화를 마친 두 사람" />
      <button onClick={onRetry}>새 대화로 연습하기 ↗</button>
    </aside>
    <section className="assessment-main" aria-label="영어 회화 실력 평가" aria-busy={loading}>
      <header><div><h2>Speaking profile</h2><p>{loading ? '사용자 발화와 음성을 분석하고 있어요. 잠시만 기다려 주세요.' : report ? '이번 대화의 평가 · 각 항목을 펼쳐 근거를 확인하세요' : '대화를 마치면 네 가지 영역을 분석해 드려요.'}</p></div><span className="assessment-badge">{loading ? '분석 중…' : report?.sample.mode === 'audio-and-text' ? '음성 + 텍스트' : '텍스트 기반'}</span></header>
      {error && <div className="assessment-error" role="alert"><p>{error}</p><button onClick={retry}>평가 다시 시도</button></div>}
      <div className="assessment-cards">{dimensions.map(([key, en, ko]) => {
        const item = report?.dimensions[key]
        const score = item?.score
        const measured = typeof score === 'number'
        return <article className={`assessment-card ${loading ? 'is-loading' : ''}`} key={key}>
          <div className="assessment-card-title"><div><h3>{en}</h3><span>{ko}</span></div><strong>{measured ? score : '—'}<small>{measured ? '/ 100' : loading ? '분석 중' : '평가 자료 부족'}</small></strong></div>
          <div className={`assessment-meter ${!measured ? 'unrated' : ''}`} role={measured ? 'meter' : undefined} aria-label={`${ko} 점수`} aria-valuemin={measured ? 0 : undefined} aria-valuemax={measured ? 100 : undefined} aria-valuenow={measured ? score : undefined}>
            <div style={{ width: `${measured ? score : 0}%` }} />{measured && <i style={{ left: `clamp(8px, ${score}%, calc(100% - 8px))` }} />}<span /><span /><span />
          </div><div className="assessment-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
          <p className="assessment-reason">{loading ? '평가 근거를 확인하고 있습니다…' : item?.reason || '영어로 의견과 이유를 충분히 말해 보세요.'}</p>
          {item && <><small className="assessment-confidence">{confidence[item.confidence] || '제한적 근거'}{measured && item.confidence === 'low' ? ' · 짧은 표본의 잠정 점수' : ''}</small><details><summary>평가 근거 · 연습 방법</summary>{item.strength && <p><b>잘한 점</b>{item.strength}</p>}{item.evidence.map((s, i) => <blockquote key={i}>{s}</blockquote>)}<p><b>개선할 점</b>{item.improvement}</p><p><b>다음 연습</b>{item.exercise}</p></details></>}
        </article>
      })}</div>
      <div className="assessment-footnote"><p>{result?.notice || '발음 정확도와 유창성에는 실제 녹음이 필요합니다. 텍스트만으로 추측하지 않습니다.'}</p>{report && <p>분석 표본: 영어 {report.sample.wordCount}단어 · 음성 {report.sample.audioSeconds.toFixed(1)}초{report.sample.limited ? ' · 일부 구간 표본' : ''}<br />평가에는 오류와 편차가 있을 수 있습니다. 30–60초 이상, 여러 문장으로 답하면 더 도움이 됩니다.</p>}</div>
    </section>
    <aside className="assessment-coach"><h2>다음 대화를 위한 코칭</h2><span className="assessment-coach-tag">PERSONAL FEEDBACK</span><p className="assessment-summary">{loading ? '발화를 분석한 뒤 구체적인 피드백을 준비합니다.' : report?.summary || '아직 평가할 대화가 없습니다.'}</p>
      {report?.corrections.map((c, i) => <article className="assessment-correction" key={i}><h3>더 자연스럽게 말하기 {i + 1}</h3><small>내가 한 말</small><p>{c.original}</p><small>이렇게 바꿔보세요</small><p className="improved">{c.improved}</p><p className="explanation">{c.explanation}</p></article>)}
      {report && <div className="assessment-next"><h3>오늘의 연습 미션</h3><p>{report.nextPractice}</p></div>}
      <button disabled={!hasRecord || loading} onClick={onDownload}>평가와 대화 기록 저장 ↓</button>
      <small className="assessment-method">HiRing rubric v1 · OpenAI{report?.model ? ` ${report.model}` : ''}<br />발음은 전달력·강세, 유창성은 발화 흐름, 정확성은 문법·어휘, 복잡성은 표현의 다양성을 봅니다.</small>
    </aside>
  </div>
}
