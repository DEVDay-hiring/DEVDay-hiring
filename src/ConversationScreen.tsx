import { getHealth } from '../shared/health.js'
import './mvp.css'
import AssetImage from './AssetImage'
import { asset, devdayAsset } from './assets'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { RealtimeClient, type Config, type Snapshot, type SpeechCue } from '../shared/realtime-client.js'
import { PiperSpeech } from './piper/speech'
import { elapsed } from './time'

type Props = { onPrepareFinish: () => void; person: { name: string; image: string }; topic: string; onBack: () => void; onFinish: (record: Snapshot) => void }
const modes: Record<string, string> = {
  idle: '대화 준비', connecting: '연결 중', ready: '당신의 차례예요', listening: '당신의 이야기를 듣고 있어요',
  transcribing: '이야기를 이해하고 있어요', thinking: '답변을 준비하고 있어요', searching: '참고 기사를 확인하고 있어요',
  synthesizing: '음성을 준비하고 있어요', speaking: 'Trump AI가 말하고 있어요', ended: '대화 종료', error: '연결 확인 필요',
}

function renderSpeechText(text: string, cue: SpeechCue, itemId: string): ReactNode {
  if (!cue) return text
  const isActiveItem = cue.itemId === itemId
  const ranges = cue.completed
    .filter(range => range.itemId === itemId && !(isActiveItem && range.start === cue.start && range.end === cue.end))
    .map(range => ({ ...range, progress: 1 }))
  if (isActiveItem) ranges.push({ itemId, start: cue.start, end: cue.end, progress: cue.progress })
  ranges.sort((a, b) => a.start - b.start)
  const nodes: ReactNode[] = []
  let cursor = 0
  ranges.forEach(range => {
    const start = Math.max(cursor, Math.min(text.length, range.start))
    const end = Math.max(start, Math.min(text.length, range.end))
    if (start > cursor) nodes.push(text.slice(cursor, start))
    if (end <= start) return
    const segment = text.slice(start, end)
    if (range.progress >= 1) {
      nodes.push(<span className="speech-progress-complete" key={`spoken-${start}-${end}`}>{segment}</span>)
    } else {
      const progress = Math.max(0, Math.min(1, range.progress))
      const softness = Math.min(0.06, Math.max(0.012, 4 / segment.length))
      let offset = 0
      const characters: ReactNode[] = []
      for (const character of segment) {
        const position = (offset + character.length / 2) / segment.length
        const blend = Math.max(0, Math.min(1, (progress - position + softness) / (2 * softness)))
        characters.push(<span className="speech-progress-char" style={{ '--speech-blend': `${blend * 100}%` } as CSSProperties} key={`char-${start + offset}`}>{character}</span>)
        offset += character.length
      }
      nodes.push(<span key={`active-${start}-${end}`}>{characters}</span>)
    }
    cursor = end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export default function ConversationScreen({ person, topic, onBack, onFinish, onPrepareFinish }: Props) {
  const [client] = useState(() => new RealtimeClient({ voice: new PiperSpeech() }))
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'conversation' | 'sources' | 'logs'>('conversation')
  const [health, setHealth] = useState('서버 확인 중')
  const [config, setConfig] = useState<Config>({ topic, level: 'intermediate', support: 'english', correction: 'on_request', speechMode: 'auto', learnerContext: '', evaluateAudio: true })
  const transcriptRef = useRef<HTMLDivElement>(null)
  const connecting = state.status === 'connecting'
  const locked = connecting || state.connected
  const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant')
  useEffect(() => {
    const abort = new AbortController()
    getHealth(abort.signal).then(data => {
      setHealth(data.apiKeyConfigured ? 'Realtime · 연결 준비됨' : 'API 키 설정 필요')
    }).catch(error => { if (!abort.signal.aborted) setHealth(error.message || '서버 연결 확인 필요') })
    return () => { abort.abort(); client.stop() }
  }, [client])
  useEffect(() => {
    const list = transcriptRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [state.messages, tab])
  const change = (name: keyof Config, value: string) => setConfig(previous => ({ ...previous, [name]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); if (client.text(draft)) setDraft('') }
  const finish = () => onFinish(client.stop())
  const feedback = () => {
    if (!state.connected) return
    client.text('Could you briefly help me improve the English I have used in this conversation? Suggest one natural expression, then continue our chat.', true)
    setTab('conversation')
  }

  return <>
    <button className="flow-logo" type="button" onClick={onBack} aria-label="인물 선택으로 돌아가기"><span className="brand"><span>Hi</span><b>:</b><span>Ring</span></span></button>
    <div className="mvp-topline"><span className={`live-dot ${state.connected ? 'on' : ''}`} />{state.connected ? 'LIVE · 실시간 연결됨' : health}</div>
    <aside className="mvp-person"><AssetImage sizes="90px" src={devdayAsset('conversation-trump.webp')} alt="" /><div><small>YOUR CONVERSATION PARTNER</small><h1>{person.name}</h1><p>AI persona · English conversation</p></div></aside>
    <aside className="mvp-settings">
      <h2>오늘의 대화</h2><p className="subtle">당신의 속도로, 자연스럽게.</p>
      <fieldset disabled={locked}>
        <label>대화 주제<input value={config.topic} maxLength={160} onChange={e => change('topic', e.target.value)} /></label>
        <label>영어 수준<select value={config.level} onChange={e => change('level', e.target.value)}><option value="beginner">Beginner · 편안하게</option><option value="intermediate">Intermediate · 자연스럽게</option><option value="advanced">Advanced · 깊이 있게</option></select></label>
        <label>언어 도움<select value={config.support} onChange={e => change('support', e.target.value)}><option value="english">English only</option><option value="bilingual">필요할 때 한국어 도움</option></select></label>
        <label>표현 교정<select value={config.correction} onChange={e => change('correction', e.target.value)}><option value="on_request">요청할 때만</option><option value="gentle">대화 중 가볍게</option></select></label>
        <label><span>나의 관심사 <small>선택</small></span><input value={config.learnerContext} maxLength={500} onChange={e => change('learnerContext', e.target.value)} placeholder="예: 컴퓨터공학, 여행, AI" /></label>
      </fieldset>
      <p className="evaluation-privacy">첫 음성 재생 시 모델·실행 파일을 다운로드합니다. 이후에는 브라우저 캐시를 사용합니다. 영어 음성만 지원합니다.</p>
      <div className="mvp-tip"><AssetImage src={devdayAsset('emoji-objects.svg')} alt="" /><p>AI가 말할 때도 끼어들 수 있어요.<br />이어폰을 사용하면 더 자연스러워요.</p></div>
      <label className="evaluation-consent"><input type="checkbox" checked={config.evaluateAudio} disabled={locked} onChange={e => setConfig(c => ({ ...c, evaluateAudio: e.target.checked }))} />종료 후 발음·유창성 음성 평가</label>
      <p className="evaluation-privacy">평가를 켜면 마이크 음성을 메모리에 임시 보관하고 종료 후 최대 90초의 발화 표본을 OpenAI로 전송합니다. 끄면 텍스트만 평가합니다.</p>
      <button className="feedback-button" onClick={feedback} disabled={!state.connected}>✦ 지금까지의 영어 표현 피드백 받기</button>
    </aside>

    <div className={`call-video mvp-video ${state.status === 'speaking' ? 'is-speaking' : ''}`}>
      <AssetImage className="mvp-portrait" sizes="(max-width: 799px) 440px, (min-aspect-ratio: 16/9) 53vh, 30vw" fetchPriority="high" src={asset('donald-hero.webp')} alt="트럼프를 모티브로 한 AI 대화 캐릭터" />
      <div className="mvp-video-label"><span className="live-dot on" />TRUMP AI<span>AI SIMULATION</span></div>
      <div className="mvp-video-caption"><small>{modes[state.status] || state.status}</small><p>{lastAssistant ? renderSpeechText(lastAssistant.text, state.speechCue, lastAssistant.id) : 'A real conversation. A little more confidence.'}</p>{lastAssistant?.interrupted && <small>발화 중단 · 자막에 미재생 내용이 포함될 수 있습니다.</small>}</div>
      {!state.connected && <div className="mvp-connect-overlay">
        <span className="connect-mark">Hi<span>:</span>Ring</span><h2>{connecting ? 'Trump AI를 만나고 있어요' : 'Ready to say hello?'}</h2>
        <p>{connecting ? '마이크 권한을 허용해 주세요. 잠시 후 대화가 시작됩니다.' : '영어로 말을 걸어보세요. 질문도, 가벼운 일상 이야기도 좋아요.'}</p>
        {connecting ? <button onClick={() => client.stop()}>연결 취소</button> : <><button className="connect-primary" onClick={() => void client.start(config)}>마이크 켜고 대화 시작</button><button className="connect-text" onClick={() => void client.start(config, true)}>마이크 없이 텍스트로 시작</button></>}
        <small>실제 인물이 아닌 AI 역할극 · Piper 합성 음성<br />음성·텍스트와 관심사 정보가 OpenAI로 전송됩니다.</small>
      </div>}
    </div>
    <form className="mvp-composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="conversation-input">영어 메시지</label>
      <input id="conversation-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder={state.connected ? 'Type in English… or just speak.' : '대화를 시작하면 입력할 수 있어요'} disabled={!state.connected} maxLength={2000} autoComplete="off" />
      <button type="submit" disabled={!state.connected || !draft.trim()}>Send ↗</button>
    </form>
    <div className="mvp-call-controls">
      <span className="mvp-elapsed">{elapsed(state.durationSeconds)}<small>{state.turns} turns</small></span>
      <button className={`mvp-mic ${state.micMuted ? 'muted' : ''}`} onClick={() => client.toggleMic()} disabled={!state.connected || state.textOnly} aria-pressed={state.micMuted} aria-label={state.micMuted ? '마이크 켜기' : '마이크 음소거'}><AssetImage src={devdayAsset('microphone.svg')} alt="" /><span>{state.textOnly ? '텍스트 모드' : state.micMuted ? '마이크 꺼짐' : '마이크 켜짐'}</span></button>
      <div className={`mvp-bars ${['speaking', 'listening'].includes(state.status) ? 'active' : ''}`} aria-hidden="true">{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ animationDelay: `${i * .09}s`, height: `${12 + (i * 17 % 33)}px` }} />)}</div>
      <button className="mvp-end" onPointerEnter={onPrepareFinish} onFocus={onPrepareFinish} onClick={finish} aria-label="대화 종료하고 결과 보기"><AssetImage src={devdayAsset('hangup.svg')} alt="" />대화 마치기</button>
    </div>
    <p className="mvp-disclosure">트럼프를 모티브로 한 AI 역할극입니다. 실제 인물의 음성·영상이 아닙니다.</p>

    <aside className="mvp-transcript-panel">
      <header><h2>Our conversation</h2><span>한 문장씩 쌓이는 자신감</span></header>
      <div className="mvp-tabs" role="tablist" aria-label="대화 정보"><button role="tab" aria-selected={tab === 'conversation'} onClick={() => setTab('conversation')}>대화 기록</button><button role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')}>참고 기사 <b>{state.sources.length}</b></button><button role="tab" aria-selected={tab === 'logs'} onClick={() => setTab('logs')}>연결</button></div>
      {tab === 'conversation' ? <div className="mvp-messages" ref={transcriptRef} role="log" aria-label="실시간 대화 기록">
        {!state.messages.length && <div className="mvp-empty"><span>“</span><h3>시작은 가벼운 인사로.</h3><p>실제 대화 자막이 이곳에 나타납니다.</p><button onClick={() => setDraft('Hi Trump. I have a question. Why do people call it AI instead of SI?')}>AI와 SI에 대해 물어보기 ↗</button></div>}
        {state.messages.map(m => <article className={`mvp-message ${m.role}`} key={m.id}><small>{m.role === 'user' ? 'You' : 'Trump AI'}{m.partial ? ' · …' : ''}{m.interrupted ? ' · 발화 중단' : ''}</small><p>{m.role === 'assistant' ? renderSpeechText(m.text, state.speechCue, m.id) : m.text}</p>{m.interrupted && <em>자막에 듣지 못한 내용이 포함될 수 있습니다.</em>}</article>)}
      </div> : tab === 'sources' ? <div className="mvp-source-list"><p className="subtle">Vector Store에서 찾은 업로드 자료입니다. 기사의 주장이 독립적으로 검증되었다는 뜻은 아닙니다.</p>{!state.sources.length && <p>AI/SI 또는 실제 발언에 대해 물어보면 검색 결과가 표시됩니다.</p>}{state.sources.map(s => <article key={s.filename}><span>REFERENCE</span><h3>{s.filename}</h3><p>{s.text}</p></article>)}</div> : <div className="mvp-log-list"><dl><dt>연결 시간</dt><dd>{state.connectionMs ?? '—'} ms</dd><dt>최근 응답 지연</dt><dd>{state.latencyMs ?? '—'} ms</dd><dt>자료 검색</dt><dd>{state.searchCount}회</dd><dt>음성 실행</dt><dd>{state.voiceBackend === 'webgpu+wasm' ? 'GPU + CPU' : state.voiceBackend === 'wasm' ? 'CPU' : config.speechMode === 'off' ? '자막만' : '준비 전'}</dd></dl><p className="subtle">브라우저 마이크 → WebRTC → Realtime API<br />답변 텍스트 → 브라우저 Piper 음성<br />API 키는 서버에만 보관됩니다.</p>{state.logs.map((log, i) => <p key={i}><time>{log.time}</time> {log.type}{log.detail && <span>{log.detail}</span>}</p>)}</div>}
      <footer><span className={`live-dot ${state.connected ? 'on' : ''}`} />{modes[state.status] || state.status}</footer>
    </aside>
    {state.error && <div className="mvp-error" role="alert"><span>{state.error}</span><button onClick={() => client.dismissError()} aria-label="오류 안내 닫기">×</button></div>}
    {(state.voiceProgress || state.voiceNotice) && <div className="mvp-voice-notice" role="status">{state.voiceProgress || state.voiceNotice}</div>}
    <audio ref={client.attachAudio} autoPlay className="sr-only" />
    {state.needsPlayback && <button className="mvp-enable-audio" onClick={() => void client.playAudio()}>소리를 켜려면 클릭하세요</button>}
  </>
}
