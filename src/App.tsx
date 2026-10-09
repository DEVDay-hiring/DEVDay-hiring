import { lazy, Suspense, useEffect, useState } from 'react'
import AssetImage, { preloadImage } from './AssetImage'
import { asset } from './assets'
import type { Snapshot } from '../shared/realtime-client.js'

const loadConversation = () => import('./ConversationScreen')
const loadSummary = () => import('./SummaryScreen')
const ConversationScreen = lazy(loadConversation)
const SummaryScreen = lazy(loadSummary)
const heroSizes = '(max-width: 799px) min(400px, 100vw), (min-aspect-ratio: 16/9) 76.4vh, 43vw'

const warmConversation = () => {
  void loadConversation().catch(() => {})
  preloadImage(asset('devday/conversation-bg.webp'))
  preloadImage(asset('donald-hero.webp'), '(max-width: 799px) 440px, (min-aspect-ratio: 16/9) 53vh, 30vw')
}

const warmSummary = () => {
  void loadSummary().catch(() => {})
  preloadImage(asset('devday/summary-bg.webp'))
  preloadImage(asset('devday/summary-duo.webp'), '(max-width: 799px) 100vw, 425px')
}

type Category = '전체' | '정치' | '비즈니스' | '과학·기술' | '가상 캐릭터'
type Screen = 'onboarding' | 'select' | 'conversation' | 'summary'
type Notice = { title: string; body: string }

const screenFromHash = (): Screen => {
  const hash = window.location.hash.slice(1)
  return hash === 'select' || hash === 'conversation' || hash === 'summary' ? hash : 'onboarding'
}

type Person = {
  id: string
  name: string
  profileName?: string
  category: string
  filters: Category[]
  image: string
  hero: string
  role: string
  description: string
  tags: string[]
  prompts: string[]
}

const people: Person[] = [
  {
    id: 'donald',
    name: 'Donald Trump',
    category: '정치',
    filters: ['정치'],
    image: asset('donald-card.webp'),
    hero: asset('donald-hero.webp'),
    role: '트럼프를 모티브로 한 AI 페르소나',
    description: 'AI부터 가벼운 일상 이야기까지,\nTrump AI와 영어로 대화해보세요.\n자신감 있는 말투와 자연스러운 질문으로\n회화 연습을 이어갈 수 있어요.',
    tags: ['정치', '경제', '외교', '리더십', '시사 이슈'],
    prompts: [
      'AI와 SI, 이름에 대해 물어보기',
      '리더십과 협상에 대해 이야기하기',
      '가볍게 일상 이야기 나누기',
    ],
  },
  {
    id: 'elon',
    name: 'Elon Musk',
    category: '비즈니스·과학·기술',
    filters: ['비즈니스', '과학·기술'],
    image: asset('elon-card.webp'),
    hero: asset('elon-hero.webp'),
    role: '기업가·기술 혁신가',
    description: '우주, 전기차, AI 등 다양한 주제로\n일론 머스크와 직접 대화해 보세요.\n그의 독특한 관점과 아이디어를 통해\n현실감 있는 영어 회화 연습이 가능합니다.',
    tags: ['비즈니스', '과학·기술', '우주', 'AI', '혁신'],
    prompts: ['우주 탐사와 화성 이주에 대해 물어보기', '전기차와 미래 기술에 대해 질문하기', 'AI의 발전과 미래에 대한 의견 듣기'],
  },
  {
    id: 'einstein',
    name: 'Albert Einstein',
    category: '과학·기술',
    filters: ['과학·기술'],
    image: asset('einstein-card.webp'),
    hero: asset('einstein-hero.webp'),
    role: '물리학자·상대성이론의 창시자',
    description: '시간과 공간, 우주와 과학에 대해\n아인슈타인과 직접 대화해보세요.\n그의 호기심과 독창적인 사고를 통해\n현실감 있는 영어 회화 연습이 가능합니다.',
    tags: ['물리학', '상대성이론', '우주', '과학', '창의적 사고'],
    prompts: ['시간과 공간의 관계에 대해 물어보기', '상대성이론을 쉽게 설명해 달라고 하기', '창의적인 사고와 호기심에 대해 질문하기'],
  },
  {
    id: 'sol',
    name: 'AI 캐릭터 ‘SOL’',
    profileName: 'SOL',
    category: '가상 캐릭터',
    filters: ['가상 캐릭터'],
    image: asset('sol-card.webp'),
    hero: asset('sol-hero.webp'),
    role: 'AI 영어 회화 파트너',
    description: '일상, 취미, 공부 등 다양한 주제로\nSOL과 편하게 대화해보세요.\n친근한 대화와 자연스러운 피드백으로\n부담 없이 영어 말하기를 연습할 수 있어요.',
    tags: ['일상', '취미', '학습', '자기개발', '문화'],
    prompts: ['오늘 하루 있었던 일 이야기하기', '좋아하는 취미와 관심사 나누기', '영어로 자기소개 연습하기'],
  },
  {
    id: 'luna',
    name: 'AI 캐릭터 ‘LUNA’',
    profileName: 'LUNA',
    category: '가상 캐릭터',
    filters: ['가상 캐릭터'],
    image: asset('luna-card.webp'),
    hero: asset('luna-hero.webp'),
    role: '당신의 다정한 AI 대화 친구',
    description: '일상, 취미, 여행 등 다양한 주제로\nLUNA와 편하게 대화해보세요.\n다정한 반응과 자연스러운 질문을 통해\n부담 없이 영어 회화를 연습할 수 있어요.',
    tags: ['일상', '취미', '여행', '공감', '영어 연습'],
    prompts: ['오늘 있었던 일을 영어로 이야기하기', '좋아하는 취미와 여행 계획을 나누기', '상황별 표현을 배우며 대화 연습하기'],
  },
  {
    id: 'obama',
    name: 'Barack Obama',
    category: '정치',
    filters: ['정치'],
    image: asset('obama-card.webp'),
    hero: asset('obama-hero.webp'),
    role: '제 44대 미국 대통령',
    description: '리더십, 사회, 문화 등 다양한 주제로\n오바마와 직접 대화해보세요.\n그의 차분한 말투와 명료한 설명을 통해\n현실감 있는 영어 회화 연습이 가능합니다.',
    tags: ['정치', '리더십', '사회', '소통', '문화'],
    prompts: ['리더십과 효과적인 소통에 대해 물어보기', '어려운 선택을 내리는 방법에 대해 묻기', '미국의 사회와 문화에 대해 이야기하기'],
  },
]

const categories: Category[] = ['전체', '정치', '비즈니스', '과학·기술', '가상 캐릭터']

function Brand({ large = false }: { large?: boolean }) {
  return <span className={`brand ${large ? 'brand-large' : ''}`}><span>Hi</span><b>:</b><span>Ring</span></span>
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return viewport
}

function App() {
  const [screen, setScreen] = useState<Screen>(screenFromHash)
  const [category, setCategory] = useState<Category>('전체')
  const [selectedId, setSelectedId] = useState('donald')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [record, setRecord] = useState<Snapshot | null>(null)
  const [topic, setTopic] = useState('Free conversation')
  const viewport = useViewport()
  useEffect(() => {
    const syncScreen = () => setScreen(screenFromHash())
    window.addEventListener('hashchange', syncScreen)
    return () => window.removeEventListener('hashchange', syncScreen)
  }, [])
  const mobile = viewport.width < 800
  const scale = Math.min(viewport.width / 1920, viewport.height / 1080)
  const selected = people.find((person) => person.id === selectedId) ?? people[0]
  const visiblePeople = category === '전체' ? people : people.filter((person) => person.filters.includes(category))

  const selectCategory = (next: Category) => {
    setCategory(next)
    const first = next === '전체' ? people[0] : people.find((person) => person.filters.includes(next))
    if (first) setSelectedId(first.id)
  }

  const navigate = (next: Screen) => {
    window.location.hash = next === 'onboarding' ? '' : next
    setScreen(next)
    setNotice(null)
  }

  const showFeedback = (title: string, body: string) => setNotice({ title, body })

  const startConversation = (nextTopic = 'Free conversation') => {
    if (selected.id === 'donald') { setTopic(nextTopic); setRecord(null); navigate('conversation') }
    else showFeedback('준비 중', `${selected.profileName ?? selected.name}와의 대화는 아직 준비 중입니다.`)
  }

  const stageStyle = mobile ? undefined : { transform: `scale(${scale})` }
  const warmSelection = () => {
    preloadImage(asset('atrium-bg.webp'))
    preloadImage(people[0].hero, heroSizes)
  }

  return (
    <main className={`app ${screen === 'select' ? 'app-selection' : ''} ${mobile ? 'app-mobile' : ''}`}>
      {screen !== 'onboarding' && <AssetImage className="app-background" fetchPriority="low" src={screen === 'select' ? asset('atrium-bg.webp') : asset(`devday/${screen === 'conversation' ? 'conversation-bg.webp' : 'summary-bg.webp'}`)} alt="" />}
      <div className={`stage ${screen === 'select' ? 'selection' : screen}`} style={stageStyle}>
        <Suspense fallback={<div className="screen-loading" role="status">화면을 불러오는 중...</div>}>
          {screen === 'onboarding' ? (
            <button className="onboarding-click" type="button" onPointerEnter={warmSelection} onFocus={warmSelection} onClick={() => navigate('select')} aria-label="시작하기: 인물 선택 화면으로 이동">
              <span className="hackathon-label">DevDay Exchange Community Hackathon : Seoul</span>
              <span className="onboarding-logo"><Brand large /></span>
              <span className="onboarding-subtitle">유명 인물과 현실처럼 영어로 대화하며<br />회화 실력을 키우는 <strong>AI 회화 서비스</strong></span>
              <AssetImage className="onboarding-art" fetchPriority="high" sizes="(max-width: 799px) 100vw, 57vw" src={asset('onboarding-people.webp')} alt="마주 앉아 대화하는 두 사람" />
              <span className="onboarding-fade" aria-hidden="true" />
              <span className="team-label">팀명: 하이링<br />소속: 숭실대학교 멋쟁이사자처럼</span>
              <span className="click-label">화면을 눌러주세요</span>
            </button>
          ) : screen === 'select' ? (
            <>
              <button className="selection-logo" type="button" onClick={() => navigate('onboarding')} aria-label="온보딩 화면으로 돌아가기"><Brand /></button>
              <h1 className="selection-heading">지금, 만나고 싶은<br /><span>인물과 대화</span>해보세요</h1>
              <p className="selection-subtitle">정치, 비즈니스, 문화, 역사 등<br />다양한 분야의 AI 인물과 현실처럼 대화할 수 있어요.</p>
              <div className="category-list" aria-label="인물 분야 필터">
                {categories.map((item) => (
                  <button key={item} type="button" className={`category-chip ${category === item ? 'active' : ''}`} onClick={() => selectCategory(item)} aria-pressed={category === item}>{item}</button>
                ))}
              </div>
              <div className="person-grid" aria-label="대화할 인물 선택">
                {visiblePeople.map((person) => (
                  <button key={person.id} type="button" className={`person-card person-card-${person.id} ${selected.id === person.id ? 'selected' : ''}`} onPointerEnter={() => preloadImage(person.hero, heroSizes)} onFocus={() => preloadImage(person.hero, heroSizes)} onClick={() => setSelectedId(person.id)} aria-pressed={selected.id === person.id}>
                    <span className="portrait"><AssetImage src={person.image} sizes="(max-width: 799px) calc((100vw - 60px) / 3), 216px" loading="lazy" alt="" /></span>
                    <span className="card-caption"><strong>{person.name}</strong><small>{person.category}</small></span>
                  </button>
                ))}
              </div>
              <div className="person-hero" aria-hidden="true">
                <AssetImage src={selected.hero} sizes={heroSizes} fetchPriority="high" alt="" />
              </div>
              <aside className="profile-panel" aria-label={`${selected.name} 소개`}>
                <h2>{selected.profileName ?? selected.name}</h2>
                <p className="person-role">{selected.role}</p>
                <p className="person-description">{selected.description}</p>
                <div className="tag-list">{[selected.tags.slice(0, 3), selected.tags.slice(3)].map((row, index) => <div className="tag-row" key={index}>{row.map((tag) => <span key={tag}># {tag}</span>)}</div>)}</div>
                <AssetImage className="profile-divider" src={asset('divider.svg')} alt="" />
                <h3><AssetImage src={asset('selection-chat.svg')} alt="" />이런 대화를 할 수 있어요</h3>
                <div className="prompt-list">
                  {selected.prompts.map((prompt, index) => <button key={prompt} type="button" onPointerEnter={selected.id === 'donald' ? warmConversation : undefined} onFocus={selected.id === 'donald' ? warmConversation : undefined} onClick={() => startConversation(['AI and Super Intelligence: names and ideas', 'Leadership and negotiation', 'Everyday life and small talk'][index])}>{prompt}<AssetImage src={asset('selection-arrow.svg')} alt="" /></button>)}
                </div>
              </aside>
              <button className="conversation-button" type="button" disabled={selected.id !== 'donald'} onPointerEnter={selected.id === 'donald' ? warmConversation : undefined} onFocus={selected.id === 'donald' ? warmConversation : undefined} onClick={() => startConversation()}>{selected.id === 'donald' ? '이 인물과 대화하기' : '이 인물은 준비중 입니다'}</button>
            </>
          ) : screen === 'conversation' ? (
            <ConversationScreen
              person={people[0]}
              topic={topic}
              onBack={() => navigate('select')}
              onFinish={(result) => { setRecord(result); navigate('summary') }}
              onPrepareFinish={warmSummary}
            />
          ) : (
            <SummaryScreen
              person={people[0]}
              record={record}
              onBack={() => navigate('select')}
              onRetry={() => { setRecord(null); navigate('conversation') }}
            />
          )}
        </Suspense>
      </div>
      {notice && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setNotice(null)}>
          <div className="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="notice-close" type="button" onClick={() => setNotice(null)} aria-label="닫기">×</button>
            <span className="notice-icon" aria-hidden="true">✦</span>
            <h2 id="notice-title">{notice.title}</h2>
            <p>{notice.body}</p>
            <button className="notice-confirm" type="button" onClick={() => setNotice(null)}>확인</button>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
