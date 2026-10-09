# Piper 브라우저 합성 데모

현재 트럼프 모델을 이용자 기기의 WebGPU/WASM에서 실행하는 독립 테스트 페이지입니다.
독립 페이지 자체에는 OpenAI API 호출이나 별도 추론 서버가 필요하지 않습니다. 실제 React 대화 화면에도 이 합성 경로가 연결되어 있습니다.

## 실행

저장소 루트에서:

```sh
cd experiments/piper-browser
npm ci
npm run dev
```

**http://127.0.0.1:5192** 에서 영어 문장을 입력하고 `음성 만들기`를 누릅니다.
`piper_trump_inference/en_US-trump_ai_demo-medium.onnx`와 같은 이름의 `.json` 파일이 필요합니다.
`npm run prepare:assets`는 로컬 모델과 설치된 런타임을 `public/`에 복사합니다.
생성 파일·테스트 결과는 Git에서 제외됩니다. 추론 모델 두 파일은 루트 저장소에 포함되므로 체크아웃 후 준비 스크립트로 생성할 수 있습니다.

```sh
npm run build
npm run preview
npm test
npm run test:browser
```

브라우저 테스트는 저장소 루트에 이미 설치된 Playwright와 Chrome을 사용합니다.
Chrome의 일반 GPU와 `--disable-gpu` 환경, 실제 음성 데이터 디코딩까지 검사합니다.

## 부분 CPU 처리와 전체 CPU 전환

모델은 여러 작은 연산으로 구성됩니다. WebGPU 실행기가 해당 연산과 입력 형식을 지원하면 GPU에 배정하고,
지원하지 않는 부분은 WASM 실행기를 통해 **같은 기기의 CPU**에 배정합니다.
GPU 하드웨어에서 수학적으로 불가능한 연산이라는 의미가 아닙니다.

```js
executionProviders: ['webgpu', 'wasm']
```

이는 ONNX Runtime의 실행기 우선순위 설정입니다. 모든 연산이 GPU에 배정되거나 모든 장치에서 정상 동작한다는 보장은 아닙니다.
현재 모델은 실제 Chrome/Apple GPU에서 혼합 실행과 음성 생성에 성공했습니다.
실행 로그에서도 일부 노드가 CPU에 배정되는 것을 확인했습니다.

| 상황 | 데모의 처리 |
| --- | --- |
| GPU 사용 가능 | WebGPU + WASM 혼합 실행 |
| WebGPU가 없거나 어댑터를 받지 못함 | GPU 모듈을 불러오기 전에 전체 WASM 실행 선택 |
| GPU 초기화·합성 실패 또는 GPU 실행 시간 초과 | 기존 Worker 종료 후 새 CPU Worker에서 같은 문장을 한 번 재시도 |
| CPU 실행도 실패 | 오류 안내, 입력 문장 유지, 실행 버튼 다시 활성화 |
| 모델 다운로드·발음 변환 실패 | 같은 다운로드를 반복하지 않고 오류 안내·수동 재시도 |
| 중지·실행 방식 변경·페이지 종료 | Worker 종료, 작업 취소, 이전 작업 결과와 오디오 폐기 |
| 캐시 저장 불가 | 캐시 없이 합성 진행 |

CPU 전환 후에는 그 실행 방식을 유지해 같은 GPU 오류를 문장마다 반복하지 않습니다.
선택 메뉴를 변경하면 GPU 사용 여부를 다시 검사할 수 있습니다.
초기 준비는 최대 120초, 모델 로딩·각 합성 단계는 최대 60초 후 종료합니다.
영어 입력은 400자로 제한합니다. 사용자 중지는 자동 재시도를 발생시키지 않습니다.

## 로딩과 성능

- 버튼을 누르기 전에는 모델·WASM을 다운로드하지 않습니다.
- 모델은 약 63.5MB이고, 별도로 발음 변환기와 ONNX 런타임도 다운로드합니다.
- 모델 내용 해시를 캐시 키로 사용합니다. 불완전한 모델 다운로드는 캐시에 저장하지 않습니다.
- Web Worker에서 실행하여 페이지가 합성 계산 때문에 멈추는 것을 방지합니다.
- WASM 스레드는 최대 4개로 제한하고, 교차 출처 격리가 없는 환경은 한 개로 실행합니다.
- GPU가 빠른지는 `합성 시간`, `음성 길이`, `이번 전체 대기`를 구분해 비교합니다.
  첫 실행은 파일 로딩·셰이더 준비까지 포함하므로 두 번째 실행도 비교해야 합니다.

이 PC의 Chrome에서 약 4초 음성 생성에 성공했습니다. 한 검증 실행에서 초기 준비 이후 합성은
GPU 혼합 실행 약 0.05초, 전체 CPU 실행 약 0.13초였습니다.
첫 GPU 실행에는 약 1.64초가 걸린 별도 측정도 있어, 기기와 초기화·캐시 상태에 따라 결과가 달라집니다.
이는 로컬 테스트 결과이며 모바일 성능이나 인터넷 다운로드 시간을 보장하는 값이 아닙니다.
재현 결과는 `test-results/measurements.json`에 생성됩니다.

## 실제 서비스 연결

루트 React 대화 화면은 Realtime의 답변 텍스트를 문장별로 Piper에 전달합니다.
사용자가 말하거나 텍스트를 보내면 재생·합성 대기열을 취소하고, 실패 시 자막·텍스트 대화를 유지합니다.
상세 실행·배포 설정은 [루트 README](../../README.md#piper-트럼프-음성)를 참조하세요.

## 참고와 제삼자 코드

- [ONNX Runtime Web: 실행기 우선순위와 WASM 설정](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [ONNX Runtime WebGPU 지원 연산](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md)
- ONNX Runtime Web 1.30.0: Microsoft, MIT, [소스](https://github.com/microsoft/onnxruntime).
- `@diffusionstudio/piper-wasm` 1.0.0: 배포된 발음 변환기와 데이터 파일,
  패키지 표기 라이선스 MIT, [소스·빌드 코드](https://github.com/diffusion-studio/piper-wasm).
  생성된 JS 본문은 그대로 두고 ESM export만 추가합니다.
- 트럼프 모델의 안내는 저장소 루트 `piper_trump_inference/USAGE.txt`를 참조합니다.

교차 출처 격리 헤더는 이 독립 데모 서버에만 적용됩니다.
정적 호스팅에서 해당 헤더를 제공하지 못해도 WASM은 한 스레드로 시도합니다.
