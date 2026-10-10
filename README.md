# Hi:Ring 🎙️

> **Talk to anyone. In English.**  
> 만나기 어려운 인물과의 대화를 통해 영어 공부를 **‘해야 하는 일’에서 ‘하고 싶은 대화’로** 바꾸는 몰입형 AI 영어회화 서비스

**Codex Community Korea Hackathon Seoul 2026 · 교육·학습 트랙**  
[GitHub Repository](https://github.com/DEVDay-hiring/DEVDay-hiring) · [Live Demo](https://dev-day-hiring.vercel.app/)

## 프로젝트 소개

영어회화 실력 향상에는 꾸준히 직접 말하는 연습이 중요하지만, 기존 서비스에서는 반복적인 주제와 낮은 몰입감 때문에 대화를 지속할 동기가 부족할 수 있습니다.

Hi:Ring은 **“그 인물에게 직접 물어보고 싶은 질문”**을 영어 발화의 출발점으로 삼았습니다. 사용자는 인물을 선택하고, 해당 인물의 화법과 관련 자료를 반영한 AI 페르소나와 실시간으로 대화합니다. 해커톤 MVP에서는 **트럼프를 모티브로 한 가상의 AI 기자회견**을 구현했습니다.

> 본 서비스의 인물 대화와 음성·영상은 AI로 제작된 시뮬레이션이며, 실제 인물의 발언이나 공식 입장을 의미하지 않습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 실시간 영어 대화 | OpenAI Realtime API와 WebRTC를 이용한 음성·텍스트 대화, 자막, 사용자 끼어들기 처리 |
| 인물 맥락 기반 응답 | 페르소나 프롬프트와 Vector Store 자료 검색을 결합한 맥락형 답변 |
| 인물 음성 합성 | 학습된 Piper ONNX 모델을 브라우저에서 실행해 AI 답변을 음성으로 재생 |
| 사진 기반 립싱크 | 음소·발음 길이·음성 세기·재생 시각에 맞춰 입 주변 이미지를 변경 |
| 영어 발화 피드백 | 발음·유창성·정확성·복잡성 평가 및 대화 기록 JSON 내보내기 |

현재 실제 대화 페르소나는 Trump AI 한 종류입니다. 다른 인물 및 동화 캐릭터는 향후 확장 방향입니다.

## 시스템 아키텍처

```text
사용자 마이크 / 텍스트
        │
        ▼
OpenAI Realtime API (WebRTC)
  ├─ 발화 이해 및 대화 맥락 관리
  ├─ 페르소나 프롬프트
  └─ Vector Store 자료 검색 (서버 API)
        │
        ▼
    AI 응답 텍스트
        │
        ▼
Piper TTS (ONNX Runtime Web / Web Worker)
  ├─ 브라우저 WebGPU·WASM/CPU 추론
  └─ 음성 PCM + 음소 길이 정보
        │
        ├────────► 스피커 재생
        │
        └────────► 사진 기반 Viseme 립싱크
                      (오디오 재생 시각 동기화)
```

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, Vercel Functions
- **Conversation & Knowledge:** OpenAI Realtime API, WebRTC, OpenAI Vector Store
- **Speech:** Piper, ONNX Runtime Web, `@diffusionstudio/piper-wasm`, Web Worker
- **Lip Sync:** 음소 기반 Viseme 매핑, PCM 분석, 사진 패치 합성
- **Testing & Deployment:** Node.js Test Runner, Playwright, Vercel

### 인물 페르소나와 지식 검색

대화의 **말투·응답 스타일**은 페르소나 프롬프트로 제어하고, **사실 관계와 관련 이슈**는 Vector Store에 저장된 자료를 검색해 답변에 참고합니다. 팀은 트럼프의 X 게시글과 공개 발언·뉴스 자료를 수집해 페르소나의 맥락을 구성했습니다. 단, 공개 저장소에는 수집 원본과 크롤러의 전체 실행·적재 과정이 포함되어 있지 않아 데이터 수집 파이프라인 자체를 재현하려면 별도 자료가 필요합니다. 실시간 웹 검색이 아니라 **사전에 업로드한 자료 검색**입니다.

## 시행착오와 기술적 의사결정

### 1. GPT-SoVITS → Piper: 음성 품질보다 중요한 실시간성

**시도:** Hugging Face에서 트럼프 연설 음성 데이터셋을 확보하고 GPT-SoVITS를 학습했습니다. 음색 재현은 만족스러웠지만, 팀의 CPU 추론 환경에서는 한 번의 음성 생성에 **약 10초**가 걸려 대화의 흐름이 끊겼습니다.

**개선:** Piper 기반 음성 모델을 별도로 학습하고 ONNX 추론 형태로 전환했습니다. 최종 서비스에서는 `piper_trump_inference/`의 모델을 브라우저로 내려받아 **Web Worker + ONNX Runtime Web**으로 실행합니다. 지원 환경에서는 WebGPU를 사용하고, 그렇지 않으면 WASM/CPU로 동작합니다. Realtime이 만든 답변을 문장 단위로 합성하며, 사용자가 끼어들면 재생·합성 대기열을 중단합니다.

**배운 점:** 음성의 유사도뿐 아니라 **첫 응답까지의 지연, 실행 환경, 대화 중단 처리**가 실시간 음성 UX의 핵심이라는 점을 확인했습니다.

### 2. MuseTalk → 사진 기반 Viseme: 영상 생성 대신 오디오 동기화

**시도:** MuseTalk를 사용해 생성된 음성에 맞춘 실시간 얼굴 영상을 구현하려 했습니다. 그러나 별도의 CUDA/GPU 영상 서버가 필요하고, 영상 생성이 실제 음성 재생 속도를 따라가지 못하면 프레임이 늦게 도착하는 문제가 있었습니다.

**개선:** 최종 기본 모드는 GPU 영상 생성을 사용하지 않는 **사진 기반 립싱크**입니다.

1. Piper ONNX 모델의 `phoneme_durations` 출력으로 **음소별 발음 길이**를 확보합니다.
2. `shared/visemes.js`에서 **아·에·이·오·우 계열 모음**, `m/b/p` 입 닫음, 복합 모음을 입 모양 그룹으로 매핑합니다.
3. 입 모양별 이미지 패치와 **40ms PCM 음성 세기**를 조합해 벌림 정도를 정합니다.
4. `audio.currentTime`을 기준으로 **현재 재생 중인 음성에 해당하는 입 모양**만 표시합니다. 무음·중단 시에는 입을 닫습니다.

원본 사진 전체를 매번 바꾸지 않고 **입 주변 패치**만 교체하므로 배경과 얼굴의 나머지 부분이 흔들리지 않습니다. 필요한 발음 길이나 이미지가 없으면 기본 3단계 입 모양으로 대체합니다. MuseTalk 연동 코드는 선택적 실험 모드로 남겨두었습니다.

**배운 점:** 실시간 서비스에서는 영상의 복잡도보다 **음성과 화면의 동기화 및 안정적인 재생**이 우선일 수 있습니다.

### 3. 긴 답변과 끼어들기 문제

초기 테스트에서 AI 답변이 지나치게 길고 사용자가 중간에 말을 걸어도 자연스럽게 전환되지 않는 문제가 있었습니다. 이에 **짧은 답변을 유도하는 프롬프트**를 적용하고, 새로운 발화가 감지되면 이전 응답·자료 검색·TTS 대기열을 취소하도록 처리했습니다.

## 로컬 실행

### 요구 사항

- **Node.js 20.19 이상** 또는 **22.12 이상**
- npm, OpenAI API 키
- 마이크를 사용할 수 있는 브라우저 (localhost 또는 HTTPS)

### 설치 및 실행

```bash
git clone https://github.com/DEVDay-hiring/DEVDay-hiring.git
cd DEVDay-hiring
npm ci
cp .env.example .env.local
```

`.env.local`에 다음 값을 설정합니다.

```dotenv
OPENAI_API_KEY=your_openai_api_key
OPENAI_VECTOR_STORE_ID=your_vector_store_id
VITE_LIPSYNC_MODE=photo
```

`OPENAI_VECTOR_STORE_ID`는 자료 검색을 사용할 때 필요하며, 미설정 상태에서도 일반 대화는 가능합니다. API 키는 **서버 전용**이므로 `VITE_` 접두사를 붙이지 않습니다.

```bash
npm run dev
```

브라우저에서 **http://localhost:5174** 접속. `predev` 과정에서 Piper 모델과 브라우저 실행 파일이 자동 준비됩니다. 최초 음성 실행 시 모델 다운로드가 필요할 수 있습니다.

### 빌드 및 테스트

```bash
npm run check    # TypeScript 및 서버 구문 검사
npm test         # 단위 테스트
npm run build    # 프로덕션 빌드
npm start        # 빌드 후 로컬 실행 (기본 포트 3001)
```

브라우저 UI 테스트는 `npm run test:browser`, `npm run test:piper-ui`, `npm run test:photo-lipsync-ui` 등을 사용할 수 있습니다. 실제 OpenAI API를 호출하는 경우 비용이 발생합니다.

## 주요 디렉터리

```text
src/                     # React UI 및 대화·립싱크 기능
server/                  # Express API와 서버 공통 로직
api/                     # Vercel Functions 진입점
shared/                  # Realtime 클라이언트·Viseme 매핑
piper_trump_inference/    # Piper ONNX 음성 추론 모델
scripts/                  # Piper 준비·음소 길이·이미지 에셋 처리
tests/                    # 단위·브라우저·음성·립싱크 검증
persona.mjs              # AI 페르소나 및 대화 설정
.env.example             # 환경변수 예시
```

## 팀 소개

**Team Hi:Ring** — 박동준 · 최정인 · 어나경 · 차민상

| 팀원 | 담당 역할 | 주요 기여 |
| --- | --- | --- |
| **박동준** | **음성 AI 모델 학습 · PM / 발표** | 서비스 기획 및 **OpenAI Realtime API 연동**, **GPT-SoVITS, Piper TTS 모델 학습** 및 인물 음성 구현 |
| **최정인** | **풀스택 개발 · 개발 리드** | 웹서비스 프론트엔드·백엔드 개발, AI 모델·기능 통합, 학습 데이터 크롤링 및 전처리 |
| **어나경** | **PM · 립싱크 개발** | 사용자 경험 설계, **인물 립싱크 기능 구현**과 **Musetalk 모델** 실험 |
| **차민상** | **풀스택 개발 · 페르소나/RAG** | 웹서비스 프론트엔드·백엔드 개발, 트럼프 페르소나 강화를 위한 **데이터 크롤링 및 RAG 실험** |

> 각 역할은 팀원이 실제 담당한 업무를 기준으로 정리했습니다. 웹서비스 개발은 최정인·차민상이 공동으로 담당했으며, 음성 합성 모델 학습과 립싱크 구현은 각각 박동준·어나경이 주도했습니다.

## 프로젝트 회고 및 확장 방향

Hi:Ring은 **“어떻게 하면 영어를 더 자주 말하고 싶어질까?”**라는 질문에서 출발했습니다. 이번 MVP를 통해 실시간 AI 대화, 검색 기반 페르소나, 브라우저 음성 합성, 저비용 립싱크를 하나의 경험으로 연결했습니다.

향후에는 동화 속 인물이나 애니메이션 캐릭터의 **이야기와 세계관을 활용한 어린이 영어회화**, 다양한 페르소나, 학습 콘텐츠로 확장할 수 있습니다. 단, 현재 저장소에서 실제 대화를 지원하는 페르소나는 한 종류입니다.

## 출처 및 사용 유의사항

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) · [Piper](https://github.com/rhasspy/piper) · [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) · [MuseTalk](https://github.com/TMElyralab/MuseTalk)
- [Trump Speech Dataset (Hugging Face)](https://huggingface.co/datasets/meoconxinhxan/trump-speech-dataset-tts)
- 음성 모델·인물 이미지·외부 데이터의 이용 및 재배포 권한은 별도 확인이 필요합니다. 저장소의 `piper_trump_inference/USAGE.txt`와 각 자산 라이선스 안내를 참고하세요.
- AI 음성·영상은 실제 인물의 공식 콘텐츠가 아닌 **합성 시뮬레이션**입니다.
