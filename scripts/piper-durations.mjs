// Use ORT's pinned ONNX protobuf schema; this runs at build time, never in the browser.
import proto from '../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js';

export const DURATION_OUTPUT = 'phoneme_durations';

export function withPhonemeDurations(bytes) {
  const model = proto.onnx.ModelProto.decode(bytes);
  const graph = model.graph;
  if (graph.output.some(output => output.name === DURATION_OUTPUT)) return bytes;
  // In this Piper/VITS export, w_ceil feeds both the audio length and alignment path.
  const candidates = graph.node.filter(node => node.opType === 'Ceil'
    && ['ReduceSum', 'CumSum'].every(op => graph.node.some(consumer => consumer.opType === op && consumer.input.includes(node.output[0]))));
  if (candidates.length !== 1 || !graph.output.some(output => output.name === 'output')) {
    throw new Error('Piper duration output could not be identified safely');
  }
  graph.node.push(proto.onnx.NodeProto.create({
    name: 'ExportPhonemeDurations', opType: 'Identity', input: [candidates[0].output[0]], output: [DURATION_OUTPUT],
  }));
  graph.output.push(proto.onnx.ValueInfoProto.create({ name: DURATION_OUTPUT, type: { tensorType: {
    elemType: 1, shape: { dim: [{ dimParam: 'batch_size' }, { dimValue: 1 }, { dimParam: 'phonemes' }] },
  } } }));
  // Only expose an existing intermediate. Leave every weight and audio operation intact.
  return proto.onnx.ModelProto.encode(model).finish();
}
