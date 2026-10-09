import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelRoot = path.resolve(root, '../../piper_trump_inference');
const modelName = 'en_US-trump_ai_demo-medium.onnx';
const model = await readFile(path.join(modelRoot, modelName)).catch(() => {
  throw new Error(`모델이 없습니다: ${path.join(modelRoot, modelName)}. 로컬 모델 폴더를 먼저 준비하세요.`);
});
const version = createHash('sha256').update(model).digest('hex').slice(0, 16);
const modelDir = path.join(root, 'public/models', version);
const runtimeDir = path.join(root, 'public/runtime');
await Promise.all([mkdir(modelDir, { recursive: true }), mkdir(runtimeDir, { recursive: true })]);
await Promise.all([copyFile(path.join(modelRoot, modelName), path.join(modelDir, modelName)),
  copyFile(path.join(modelRoot, `${modelName}.json`), path.join(modelDir, `${modelName}.json`))]);
await writeFile(path.join(root, 'public/models/manifest.json'), JSON.stringify({
  version, model: `/models/${version}/${modelName}`, config: `/models/${version}/${modelName}.json`, bytes: model.byteLength,
}));
const piperRoot = path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build');
const glue = await readFile(path.join(piperRoot, 'piper_phonemize.js'), 'utf8');
if (!glue.includes('var createPiperPhonemize =')) throw new Error('발음 변환기 배포 형식이 변경되었습니다.');
// Keep the packaged glue intact; add an ESM export for a module worker.
await writeFile(path.join(runtimeDir, 'piper_phonemize.mjs'), `${glue}\nexport default createPiperPhonemize;\n`);
await Promise.all(['piper_phonemize.wasm', 'piper_phonemize.data'].map(name => copyFile(path.join(piperRoot, name), path.join(runtimeDir, name))));
const ortDir = path.join(root, 'node_modules/onnxruntime-web/dist');
const files = (await readdir(ortDir)).filter(name => /^ort-wasm-simd-threaded(?:\.asyncify)?\.(?:wasm|mjs)$/.test(name));
// Only remove obsolete files that this script generated for the prior ORT path.
await Promise.all(['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'].map(name => rm(path.join(runtimeDir, name), { force: true })));
await Promise.all(files.map(name => copyFile(path.join(ortDir, name), path.join(runtimeDir, name))));
console.log(`Piper 모델·런타임 준비 완료 (${version}). 생성 파일은 Git에서 제외됩니다.`);
