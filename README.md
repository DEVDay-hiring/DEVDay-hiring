# Hi:Ring DevDay

React·TypeScript·Vite 화면과 로컬 Express 서버를 함께 실행하는 영어 회화 MVP입니다.
`Final`의 OpenAI Realtime·Vector Store RAG·발화 평가를 통합하고 기존 WebP·반응형 이미지·로컬 폰트를 사용합니다.

## 해커톤 사전 준비 공개

이 저장소의 첫 커밋에는 해커톤 시작 전에 준비한 기존 작업물이 포함됩니다. 행사 시작 시점의 사전 구현 범위는 다음과 같습니다.

- 온보딩·인물 선택·실시간 영어 대화·평가·대화 기록 화면과 반응형 에셋
- OpenAI Realtime 대화, Vector Store 자료 검색, 발화 평가를 위한 로컬/Vercel API
- 브라우저에서 실행하는 Piper 음성 합성과 팀이 준비한 트럼프 AI 데모용 합성 음성 추론 모델
- 로컬 개발 서버, 배포 설정, 자동화된 검증 코드

행사 당일 새로 구현하거나 개선한 기능과 검증 결과는 이후 커밋 및 최종 제출 자료에 따로 기록합니다.

### 외부 자산과 출처

- React, Vite, TypeScript, Express: 애플리케이션·서버 구현용 라이브러리이며 버전은 `package.json`에 기록되어 있습니다.
- OpenAI Realtime, Vector Store, 평가 API: 대화·자료 검색·발화 평가에 사용합니다. API 키와 Vector Store ID는 저장소에 포함하지 않습니다.
- Piper 음성 실행기: `@diffusionstudio/piper-wasm` 및 ONNX Runtime Web을 사용합니다. Piper 원본 프로젝트와 라이선스는 [USAGE.txt](piper_trump_inference/USAGE.txt)에 기록했습니다.
- 트럼프 AI 데모 음성은 실제 녹음이 아닌 합성 음성입니다. 추론 모델 파일은 저장소에 포함되어 있으며, 학습 데이터의 출처와 재배포 권한은 `USAGE.txt` 안내에 따라 별도 확인이 필요합니다.
- 화면용 이미지와 폰트의 라이선스 안내는 저장소의 에셋 설명 및 `public/fonts/OFL.txt`에 기록되어 있습니다.

## 개발 실행

Node.js 20.19 이상(22 계열은 22.12 이상)이 필요합니다.

```bash
npm ci
# .env.local이 없다면 생성합니다. 기존 설정 파일은 덮어쓰지 않습니다.
cp -n .env.example .env.local
npm run dev
```

브라우저에서 **http://localhost:5174**를 엽니다. 프론트와 API, Vite 자동 갱신을 같은 포트에서 제공합니다.
포트가 사용 중이면 자동 변경하지 않고 오류를 표시합니다. 이미 켜둔 이전 Vite 서버는 종료하고 다시 실행하세요.

`.env.local`에 아래 서버 설정을 입력하고 서버를 다시 실행합니다.

```dotenv
OPENAI_API_KEY=
OPENAI_VECTOR_STORE_ID=
```

- `OPENAI_API_KEY`: OpenAI 대화·자료 검색·평가에 사용할 키입니다. `VITE_` 접두사를 붙이지 않습니다.
- `OPENAI_VECTOR_STORE_ID`: 자신의 OpenAI 계정에 자료를 업로드한 Vector Store ID입니다. 다른 프로젝트의 ID를 기본값으로 사용하지 않습니다.
- 키가 없으면 화면은 열리지만 실제 대화 시작 시 설정 안내가 나타납니다.
- Vector Store ID가 없으면 일반 대화는 가능하며, 자료 검색 시 설정 안내가 나타납니다.
- 마이크 인식과 답변 생성은 OpenAI Realtime, 답변 음성은 브라우저 Piper가 담당합니다. 기본 립싱크는 음성 세기에 따라 로컬 입 모양 사진을 교체하며, GPU 서버가 필요하지 않습니다.

서버는 환경변수 → `.env.local` → `.env` 순서로 설정을 읽습니다. 상세 모델·포트 설정은 `.env.example`에 있습니다.
루트 프로젝트는 `Final` 디렉터리 없이 실행할 수 있습니다. `Final/`은 참고용으로 Git 추적에서 제외합니다.

## 빌드 실행

```bash
npm start
```

빌드 후 **http://localhost:3001**에서 실행합니다. 이미 빌드한 상태에서는 `npm run serve`를 사용할 수 있습니다.
`PORT=3002 npm start`처럼 포트를 지정할 수 있습니다. 서버는 로컬 접속 주소 `127.0.0.1`에서 실행합니다.

## Vercel 배포

`vercel.json`은 Vite 빌드(`npm run build`, 출력 `dist`)와 API Functions를 함께 구성합니다.
프론트의 `/api/health`, `/api/session`, `/api/knowledge/search`, `/api/evaluation` 요청은
`api/`의 진입점에서 `server/app.mjs`의 공통 Express API로 전달됩니다. Functions는 로컬 포트를 열거나 `dist` 파일을 읽지 않습니다.

Vercel 프로젝트의 Root Directory는 저장소 루트, Framework Preset은 Vite로 지정합니다.
Settings → Environment Variables에서 Production에 다음 값을 등록하고 재배포합니다.

```dotenv
OPENAI_API_KEY=
OPENAI_VECTOR_STORE_ID=
# 별칭·커스텀 도메인을 쓰거나 시스템 환경변수를 비활성화했다면 추가합니다.
APP_ORIGIN=https://frontend-web-pied-six.vercel.app
```

키에 `VITE_` 접두사를 붙이지 않습니다. `.env.local`과 `Final/.env.example`은 Vercel 런타임 설정이 아닙니다.
필요하면 `.env.example`의 모델 이름도 서버 환경변수로 등록합니다.
배포·프로젝트·브랜치 도메인은 Vercel 시스템 환경변수에서 자동 허용하며, 무관한 도메인은 허용하지 않습니다.
`APP_ORIGIN`에는 실제 사용하는 커스텀 도메인 또는 별칭 하나를 설정합니다.

배포 후 `/api/health`가 JSON을 반환하는지 확인합니다. 200이지만 `apiKeyConfigured: false`이면
Vercel의 OpenAI 키 설정이 필요한 상태입니다. 404는 API가 배포되지 않은 상태이고,
HTML 응답은 API가 프론트 정적 페이지로 잘못 전달된 상태입니다.
클라이언트는 이 상태들을 구분하여 안내합니다.

Vercel Functions의 평가 캐시와 요청 제한은 실행 인스턴스의 메모리에서만 유지됩니다.
새 인스턴스나 재배포 사이에 공유되는 영구 저장소는 아닙니다.

## Piper 트럼프 음성

실제 대화 화면의 OpenAI TTS를 로컬 `piper_trump_inference`의 ONNX 모델로 교체했습니다.
음성 흐름은 **마이크 → OpenAI Realtime(STT·답변 텍스트·RAG) → 브라우저 Piper → 스피커**입니다.
입 모양은 동일한 합성 음성과 실제 오디오 재생 시각을 따라갑니다. 이미지 로딩이나 영상 서버 지연 때문에 음성을 멈추거나 재시작하지 않습니다.
Google TTS 키는 사용하지 않습니다. 사진 립싱크에는 별도의 서버나 키가 필요하지 않습니다.

### 사진 립싱크 (기본값)

`VITE_LIPSYNC_MODE=photo`가 기본값입니다. 기존 `VITE_MUSETALK_WS_URL` 설정이 남아 있어도 사진 모드에서는 GPU 서버에 연결하거나 음성을 전송하지 않습니다.
브라우저에서 합성 PCM의 40ms 구간별 세기로 입 벌림 정도를 계산하고, `audio.currentTime`에 맞춰 사진을 표시합니다.
과거 프레임을 쌓지 않고 현재 시각의 사진만 그리며, 무음·일시정지 시 입을 닫고 발화 종료·중단 시 기본 사진으로 돌아갑니다.
사진이 늦게 로딩되거나 실패해도 원래 Piper 음성은 그대로 재생합니다. MuseTalk 영상 생성이나 별도의 음성 인식은 사용하지 않습니다.
기존 문장별 Piper 합성 대기나 첫 모델 다운로드 지연은 별개입니다.

발음 정보는 영어 철자 추측이 아닌, 해당 Piper 발화의 음소 ID와 모델이 사용한 발음 길이에서 얻습니다.
`scripts/piper-durations.mjs`가 빌드 때 ONNX의 기존 `w_ceil` 중간값을 `phoneme_durations` 출력으로 노출합니다.
원본 ONNX 파일·가중치·음성 계산 경로는 그대로 두고 생성된 배포 파일만 바꾸며, 모델 캐시 버전도 자동 갱신합니다.
발음 길이로 오디오 정렬을 만드는 근거는 [Piper의 VITS 추론 코드](https://github.com/rhasspy/piper/blob/master/src/python/piper_train/vits/models.py#L634)입니다.

`shared/visemes.js`는 아·에·이·오·우 계열, `m/b/p` 입 닫음, 복합 모음을 시각적 입 모양으로 묶습니다.
`PhotoLipSync`의 `PhotoAvatar.vowels`에 각 모음의 `[조금 열림, 크게 열림]` 사진을 지정하면 음소 형태와 음성 세기를 조합합니다.
모음 경계는 최대 70ms 구간에서 입 주변만 섞으며 머리·배경 픽셀은 고정합니다. 무음은 모음보다 우선합니다.
타이밍 정보나 특정 모음 이미지가 없으면 기본 세 단계 입 모양을 사용합니다.

`src/assets/photo-podium/`은 사용자가 제공한 750×450 연단 사진으로 만든 13개 입 모양입니다.
닫힌 입 전체 사진 한 장과 67×51 입 주변 조각 12장(기본 벌림 2개 + 모음 5종 × 벌림 2개)을 사용합니다(총 약 263KB).
전체 배경을 반복 다운로드하지 않으며, 서로 다른 사진의 머리·눈·배경을 섞지 않습니다.
이미지 편집은 사용자 승인하에 `gpt-image-2` API로 에셋 준비 시에만 진행했습니다. 대화·빌드·배포 중에는 이미지 API 비용이나 추가 키가 필요하지 않습니다.
제작 프롬프트와 출처·좌표 안내는 [에셋 설명](src/assets/photo-podium/README.md)에 있습니다.
다시 준비하려면 Pillow·OpenCV·NumPy와 원본 사진, 별도의 이미지 편집 결과가 필요합니다. Python은 에셋 준비에만 필요합니다.

```bash
python scripts/prepare-photo-visemes.py prepare
# 생성된 프롬프트와 마스크로 이미지 편집을 진행한 다음:
python scripts/prepare-photo-visemes.py composite
```

제공된 원본 사진의 이용·재배포 권한은 별도로 확인해야 합니다. 다른 사진으로 교체할 때는 입 위치와 기본 이미지·패치를 함께 변경하세요.
이전 영상 캡처 에셋과 `scripts/extract-photo-avatar.py`는 참고용으로 남겨두며 현재 기본 사진 모드에서는 사용하지 않습니다.
`VITE_LIPSYNC_MODE=off`는 정적 이미지, `musetalk`는 아래 GPU 방식입니다. Vite 환경변수이므로 로컬에서는 재시작, Vercel에서는 빌드 환경 설정 후 재배포해야 합니다.

### MuseTalk 립싱크 연결

먼저 `.env.local` 또는 Vercel 빌드 환경에 `VITE_LIPSYNC_MODE=musetalk`를 지정합니다.
같은 작업 공간의 `../lip-sync-service` 스트림 서버를 MuseTalk Python 3.10/CUDA 환경에서 실행합니다.
공식 MuseTalk 체크아웃, `models/musetalkV15`, `models/whisper`, 트럼프 아바타 영상이 필요합니다.

```bash
cd ../lip-sync-service
python -m pip install -r requirements-streaming.txt
python -m src.realtime.stream_server --repo /path/to/MuseTalk --video samples/input_video/avatar_25fps.mp4 --host 127.0.0.1 --port 8765
```

MuseTalk 모드의 로컬 개발 앱은 `ws://127.0.0.1:8765/stream`에 자동 연결합니다.
원격 작업 공간이나 포트 포워딩으로 앱을 열 때는 `VITE_MUSETALK_WS_URL=/musetalk/stream`을 설정하세요.
`npm run dev`의 WebSocket 중계가 앱과 같은 주소에서 작업 공간의 `127.0.0.1:8765`에 연결합니다.
다른 주소를 쓸 때는
앱의 `.env.local`에 `VITE_MUSETALK_WS_URL=ws://HOST:PORT/stream`을 설정하고 앱을 재시작합니다.
HTTPS 배포에서는 브라우저가 접근할 수 있는 `wss://` 주소가 필요하며, 이 변수를 Vite 빌드 환경과
API 서버 환경에 모두 지정해야 합니다. 서버가 없거나 응답하지 않으면 영상 대신 정적 이미지와
Piper 음성으로 대화를 이어갑니다. MuseTalk 서버는 현재 한 발화씩 처리합니다.
영상은 실제 음성 재생 시각을 기준으로 표시하고, 2프레임(25fps 기준 약 80ms)의 허용 범위를 지난 프레임은 디코딩 전후에 버립니다.
맞는 프레임이 없으면 정적 이미지로 돌아가며, 음성이 끝나거나 중단되면 남은 영상 요청도 닫습니다.
GPU 생성이 실시간보다 느리면 영상이 거의 보이지 않을 수 있습니다. 이 동작은 영상 대기로 인한 음성 끊김만 제거하며, 기존 문장별 Piper 합성 방식은 바꾸지 않습니다.
동봉된 트럼프 샘플 영상에는 방송 자막과 화면 녹화 표시가 포함되어 있으므로 최종 시연에는 깨끗한 25fps 아바타 영상으로 교체하세요.

필요한 로컬 파일:

```text
piper_trump_inference/en_US-trump_ai_demo-medium.onnx
piper_trump_inference/en_US-trump_ai_demo-medium.onnx.json
```

`npm run dev`와 `npm run build`는 모델·런타임을 자동으로 `public/piper/`에 준비합니다.
수동 준비는 `npm run prepare:piper`, 모델 존재를 필수로 검사하려면
`node scripts/prepare-piper.mjs --require-model`을 실행합니다.
모델이 없는 환경에서도 프론트 빌드는 가능하며, 음성 시작 시 자막으로 전환됩니다.

| 선택·상황 | 처리 |
| --- | --- |
| GPU 우선 | WebGPU + WASM 혼합 실행. 지원하지 않는 연산은 이용자 CPU에서 실행 |
| GPU 미지원·어댑터 없음 | 전체 WASM CPU 실행 |
| GPU 초기화·합성 실패 | 새 Worker에서 CPU로 같은 문장 재시도. 해당 연결은 CPU 유지 |
| CPU도 실패·모델 로딩 실패 | 음성만 중지하고 자막·텍스트 대화 유지. 재연결 시 다시 시도 |
| CPU로 실행 | GPU를 사용하지 않고 WASM 실행 |
| 음성 끄기 | 모델을 다운로드하지 않고 자막으로만 답변 |
| 자동 재생 차단 | 화면의 소리 켜기 버튼으로 현재 문장 재생 재개 |
| 사용자가 말하거나 텍스트 전송·종료 | 재생·합성 대기열 중단, 이전 응답의 늦은 결과 폐기 |

모델은 **약 63.5MB**이며 발음 변환기·ONNX 런타임 파일도 필요합니다. 첫 답변 시 다운로드합니다.
모델·설정 내용 해시를 버전 경로와 캐시 키로 사용하고, 캐시 저장이 불가능하면 캐시 없이 실행합니다.
초기 준비 제한은 120초, 모델 초기화·합성 단계는 60초입니다. 실행 중인 합성 취소는 Worker를 종료하므로
다음 문장에서 모델을 다시 초기화할 수 있습니다. 준비된 유휴 Worker는 연결 중 재사용합니다.
교차 출처 격리를 요구하지 않으며 현재 앱의 WASM CPU 실행은 한 스레드입니다.
**영어 음성만 지원**하며 한국어 설명은 자막으로 제공합니다.

### 배포 시 음성 에셋

추론용 `.onnx`·`.onnx.json`과 사용 안내 `USAGE.txt`는 저장소에 포함됩니다.
`main`에 푸시하면 Vercel 빌드가 `public/piper/`를 생성하고 `dist/piper/`에 복사해 함께 배포합니다.
브라우저는 사이트의 **`/piper/models/manifest.json`**에서 모델 버전을 확인하고 같은 사이트에서 모델·실행 파일을 다운로드합니다.
외부 추론 서버나 추가 TTS 키 설정은 필요하지 않습니다.

생성된 `public/piper/`와 학습 데이터·학습 메타데이터·샘플 음성·`.env.local`은 Git에서 제외됩니다.
Vercel 빌드에서는 모델이 없으면 실패하게 하여 음성이 빠진 배포를 방지합니다.
버전 경로의 모델·설정은 1년 캐시, manifest는 재검증하도록 설정합니다.
모델 제공은 정적 파일 다운로드이며, 음성 합성 계산은 계속 이용자 WebGPU/WASM에서 실행됩니다.
모델 사용 안내는 [USAGE.txt](piper_trump_inference/USAGE.txt)를 참조하세요.

ONNX Runtime Web 1.30.0과 `@diffusionstudio/piper-wasm` 1.0.0을 사용합니다.
실행기 설정·제삼자 코드 참고는 [독립 검증 페이지 설명](experiments/piper-browser/README.md)을 참조하세요.

## 화면과 기능

온보딩 → 인물 선택 → 대화 → 영어 실력 평가·대화 기록 순서입니다. 현재 실제 대화는 Trump AI만 지원합니다.

- 영어 수준·주제·언어 도움·합성 음성·표현 교정 설정.
- 마이크를 연 상태에서 WebRTC로 실시간 음성 대화, 텍스트 입력, 사용자·AI 자막.
- AI가 말할 때 끼어들면 재생과 이전 응답·자료 검색을 취소합니다.
- 업로드 자료를 Vector Store로 검색하고 참고 자료 탭에 표시합니다. 실시간 웹 뉴스 검색은 없습니다.
- 기본 사진 립싱크는 발화 중 음성 세기에 따라 입 모양을 교체합니다. 선택적으로 MuseTalk GPU 영상을 사용할 수 있으며, 화면은 실제 인물이 아닌 AI 시뮬레이션임을 표시합니다.
- 연결 실패·자동 재생 차단·자료 검색 실패 안내와 재시도.
- 종료하면 발음·유창성·정확성·복잡성을 실제 사용자 발화로 평가합니다. 텍스트만 있으면 발음·유창성은 평가하지 않습니다.
- 자료가 부족하거나 평가가 실패하면 임의의 점수를 표시하지 않습니다. 피드백은 AI 코칭용이며 공인 시험 점수가 아닙니다.
- 대화 기록·단어 수·발화 수·참고 자료·평가를 JSON으로 저장할 수 있습니다.

실제 대화와 평가는 OpenAI API를 사용하며 비용이 발생합니다. 마이크는 localhost 또는 HTTPS에서 권한 허용이 필요합니다.
음성 평가를 켜면 로컬 마이크의 첫 3분을 메모리에 임시 보관하고 발화 구간 최대 90초만 종료 후 전송합니다.
음성은 파일·localStorage·다운로드 JSON에 저장하지 않습니다. 대화 기록은 메모리에 있어 새로고침하면 사라집니다.
사용자 계정·영구 기록 저장은 아직 포함되어 있지 않습니다.

## 로딩 최적화

- PNG 대신 투명도를 유지하는 WebP를 사용합니다. 에셋은 약 34.69MB에서 **3.41MB**로 줄였습니다.
- 배경·전신·카드에 여러 해상도를 제공해 화면 크기와 픽셀 밀도에 맞는 이미지를 선택합니다.
- 대화·평가 화면 JS와 추가 CSS는 해당 화면이 필요할 때 불러옵니다.
- 카드·이동 버튼의 마우스 오버와 키보드 포커스에서 다음 화면 코드·이미지를 미리 불러옵니다.
- 인물 이미지를 화면 간 공유하고 이미지 디코딩을 비동기로 처리합니다.
- Plus Jakarta Sans를 로컬 WOFF2 폰트로 제공합니다. 라이선스는 `public/fonts/OFL.txt`입니다.
- 서버는 JS·CSS·HTML 등을 gzip으로 전송하며, 내용 해시가 붙은 `/assets/`에는 1년 캐시를 설정합니다. HTML은 재검증합니다.
- Realtime 답변 텍스트를 문장별로 Piper에 전달합니다. 합성은 Worker에서 실행하며 모델·발음 데이터는 브라우저 캐시를 사용합니다. 검색·음성 인식·첫 모델 다운로드에 따라 응답 지연이 달라집니다.
- 중복 평가 요청은 10분 동안 서버 메모리에서 재사용합니다.

새 Figma PNG/SVG 원본을 추가할 때는 Pillow가 설치된 Python으로 변환합니다.

```bash
python3 scripts/optimize-assets.py /path/to/figma-exports
npm run build
```

원본 PNG는 배포 디렉터리에 넣지 않습니다.

## 검증

```bash
npm run check
npm test
npm run build
# 별도 터미널에서 npm run serve 실행 후, Chrome이 설치된 환경에서 검사합니다.
npm run test:browser
npm run test:evaluation-ui
npm run test:conversation-ui
npm run test:piper-ui
# npm run dev 실행 후 검사합니다. 기본 주소는 http://localhost:5174 입니다.
npm run test:lipsync-ui
npm run test:photo-lipsync-ui
npm run test:photo-visemes-ui
npm run test:viseme-piper-ui
```

단위 테스트는 API를 호출하지 않습니다. 기본 브라우저 검사는 실제 마이크와 유료 세션을 사용하지 않고
연결 실패·재시도·빈 평가·화면 이동·모바일·이미지 로딩·코드 분리를 확인합니다.
Piper 브라우저 검사는 실제 ONNX 모델로 GPU·CPU 음성 생성과 재생·중단·실패 복구를 확인합니다.
이 검사에서 Realtime 연결과 RAG API는 모의 응답이며, 유료 API는 호출하지 않습니다.
사진 립싱크 검사는 기본 세 입 모양·모음 패치 10장과 고정 배경 픽셀, 오디오 시각 추적, 로딩 실패·중단·자동 재생 복구를 확인합니다.
실제 Piper 음성으로 데스크톱·390px/320px 모바일 화면과 안내문 겹침도 검사하며 캡처는 `test-results/photo-lipsync-*.png`에 저장합니다.
모음 렌더러 검사는 구별 가능한 테스트용 입 이미지를 사용합니다. 별도 실제 Piper 검사는 CPU·자동 모드의 발음 시각과 PCM 길이 일치를 확인하며 유료 API를 호출하지 않습니다.
테스트 서버 주소는 `TEST_URL=http://localhost:5174`처럼 변경할 수 있습니다.
`LIVE_API=1 npm run test:browser`는 설정된 실제 OpenAI API와 합성 음성 입력으로 연결·RAG·끼어들기·평가를 검사하며 API 비용이 발생합니다.

## 주요 파일

- `server.mjs`: 로컬 개발 Vite 통합·정적 빌드 제공.
- `server/app.mjs`, `server/origins.mjs`: 로컬과 Vercel에서 공유하는 API·도메인 허용 설정.
- `api/`, `vercel.json`: Vercel Functions 진입점·빌드 설정.
- `persona.mjs`: AI 페르소나와 회화 설정.
- `evaluation.mjs`: 평가 입력 검증·기준·API 요청·결과 검증.
- `src/piper/`, `shared/speech-queue.js`, `scripts/prepare-piper.mjs`: 브라우저 음성 합성·재생·문장 대기열·모델 준비.
- `shared/`: WebRTC 연결, 대화 순서·중단 제어, 자료 검색 규칙, 평가용 녹음.
- `src/ConversationScreen.tsx`, `src/SummaryScreen.tsx`, `src/AssessmentPanel.tsx`: 실제 대화와 평가 UI.
- `src/assets/`, `src/AssetImage.tsx`: 최적화한 이미지와 반응형 로딩.
# DEVDay-hiring
