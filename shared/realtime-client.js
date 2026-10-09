import { getHealth } from './health.js';
import { Conversation } from './conversation.js';
import { SpeechCapture } from './speech-capture.js';

const initial = () => ({ status: 'idle', connected: false, micMuted: false, textOnly: false,
  error: '', needsPlayback: false, messages: [], sources: [], searchCount: 0, logs: [],
  startedAt: null, durationSeconds: 0, connectionMs: null, latencyMs: null, turns: 0,
  voiceStatus: 'idle', voiceNotice: '', voiceBackend: '', voiceProgress: '', speechCue: null });

// Transport/UI adapter; Conversation retains Voice_agent's tested turn isolation.
export class RealtimeClient {
  constructor({ voice } = {}) {
    this.voice = voice;
    this.snapshot = initial(); this.listeners = new Set(); this.generation = 0;
    this.transcribed = new Set(); this.audio = null; this.lastAutoMutedResponseId = null;
  }
  getSnapshot = () => this.snapshot;
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  update(values) { this.snapshot = { ...this.snapshot, ...values }; this.listeners.forEach(fn => fn()); }
  attachAudio = node => {
    if (!node && this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.audio = node;
    this.voice?.attachAudio(node);
  };
  log = event => {
    this.update({ logs: [...this.snapshot.logs, { type: event.type, time: new Date().toLocaleTimeString(),
      detail: event.error?.message || event.reason || '' }].slice(-60) });
  };
  message(id, role, text, delta = false, partial = false) {
    const messages = [...this.snapshot.messages];
    const index = messages.findIndex(item => item.id === id);
    const old = messages[index];
    const next = { ...old, id, role, text: delta ? (old?.text || '') + text : text,
      partial, timestamp: old?.timestamp || new Date().toISOString() };
    if (index === -1) messages.push(next); else messages[index] = next;
    this.update({ messages });
  }
  async start(config, textOnly = false) {
    if (this.peer || this.snapshot.status === 'connecting') return;
    this.release();
    this.lastAutoMutedResponseId = null;
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.transcribed.clear();
    this.update({ ...initial(), status: 'connecting', textOnly, evaluationAudio: undefined, recordingNotice: '' });
    this.voice?.configure(config.speechMode || 'auto', {
      status: status => {
        if (!current()) return;
        this.update({ voiceStatus: status });
        const controller = this.controller;
        if (!controller) return;
        controller.playing = this.voice.busy;
        if (status !== 'idle') this.update({ status });
        else if (this.snapshot.connected && !controller.speaking && !controller.active && !controller.pending && !controller.searches.size) this.update({ status: 'ready' });
      },
      notice: voiceNotice => { if (current()) this.update({ voiceNotice }); },
      backend: voiceBackend => { if (current()) this.update({ voiceBackend }); },
      progress: voiceProgress => { if (current()) this.update({ voiceProgress }); },
      playbackBlocked: needsPlayback => { if (current()) this.update({ needsPlayback }); },
      playback: speechCue => {
        if (!current()) return;
        this.update({ speechCue });
        if (speechCue && speechCue.progress === 0 && speechCue.responseId !== this.lastAutoMutedResponseId) {
          this.lastAutoMutedResponseId = speechCue.responseId;
          this.setMicMuted(true);
        }
      },
      playbackStarted: () => {
        if (current() && this.stoppedSpeaking) {
          this.update({ latencyMs: Math.round(performance.now() - this.stoppedSpeaking) }); this.stoppedSpeaking = null;
        }
      },
    });
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const began = performance.now();
    this.connectTimer = setTimeout(() => { if (current()) this.fail('연결 시간이 초과되었습니다. 마이크 권한과 네트워크를 확인하고 다시 연결해 주세요.'); }, 45000);
    try {
      const health = await getHealth(signal);
      if (!current()) return;
      if (!health.apiKeyConfigured) throw new Error('서버의 OPENAI_API_KEY가 설정되지 않았습니다. 로컬은 .env.local을, Vercel은 환경변수를 설정하고 다시 실행·배포하세요.');
      if (!textOnly) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('localhost의 Chrome에서 마이크를 허용해 주세요. 텍스트 모드로도 시작할 수 있습니다.');
        const mic = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        } });
        if (!current()) { mic.getTracks().forEach(t => t.stop()); return; }
        this.mic = mic;
        if (config.evaluateAudio !== false) {
          try { this.capture = new SpeechCapture(mic); }
          catch { this.update({ recordingNotice: '이 브라우저에서 평가용 녹음을 시작하지 못했습니다. 텍스트 평가만 가능합니다.' }); }
        }
      }
      const peer = new RTCPeerConnection(); this.peer = peer;
      if (this.mic) this.mic.getAudioTracks().forEach(track => peer.addTrack(track, this.mic));
      else peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.addEventListener('track', ({ streams, track }) => {
        if (this.voice) { track.enabled = false; return; }
        if (!current() || !this.audio) return;
        this.audio.srcObject = streams[0] || new MediaStream([track]);
        void this.playAudio();
      });
      peer.addEventListener('connectionstatechange', () => {
        if (!current()) return;
        clearTimeout(this.disconnectTimer);
        if (['failed', 'closed'].includes(peer.connectionState)) this.fail('연결이 종료되었습니다. 다시 연결해 주세요.');
        else if (peer.connectionState === 'disconnected') this.disconnectTimer = setTimeout(() => {
          if (current() && peer.connectionState === 'disconnected') this.fail('네트워크 연결이 끊겼습니다. 다시 연결해 주세요.');
        }, 5000);
      });
      const channel = peer.createDataChannel('oai-events'); this.channel = channel;
      const send = event => {
        if (!current() || channel.readyState !== 'open') return false;
        channel.send(JSON.stringify(event)); this.log(event); return true;
      };
      const controller = new Conversation({ send, localAudio: Boolean(this.voice),
        search: async (query, searchSignal) => {
          const response = await fetch('/api/knowledge/search', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: searchSignal });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || '자료 검색 실패');
          return payload;
        },
        mute: muted => {
          if (!current()) return;
          if (this.voice) { if (muted) this.voice.interrupt(); }
          else if (this.audio) this.audio.muted = muted;
        },
        status: status => { if (current()) this.update({ status: status === 'ready' && this.voice?.busy ? this.snapshot.voiceStatus : status }); },
        log: event => { if (current()) this.log(event); },
        error: error => { if (current()) this.update({ error }); },
        sources: result => {
          if (!current()) return;
          const merged = new Map(this.snapshot.sources.map(s => [s.filename, s]));
          for (const source of result.results || []) merged.set(source.filename, source);
          this.update({ sources: [...merged.values()], searchCount: this.snapshot.searchCount + 1 });
        },
      });
      this.controller = controller;
      if (this.audio) this.audio.muted = false;
      let sessionReady = false;
      const ready = () => {
        if (!current() || !sessionReady || channel.readyState !== 'open' || this.snapshot.connected) return;
        clearTimeout(this.connectTimer);
        this.update({ connected: true, startedAt: Date.now(), connectionMs: Math.round(performance.now() - began), error: '' });
        this.tick = setInterval(() => {
          if (current()) this.update({ durationSeconds: Math.floor((Date.now() - this.snapshot.startedAt) / 1000) });
        }, 1000);
        controller.greeting();
      };
      channel.addEventListener('open', ready);
      channel.addEventListener('message', ({ data }) => {
        if (!current()) return;
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.type === 'session.created') { sessionReady = true; ready(); }
        this.handle(event, controller);
      });
      channel.addEventListener('close', () => { if (current()) this.fail('대화 연결이 종료되었습니다. 다시 연결해 주세요.'); });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer, signal);
      if (!current()) return;
      const response = await fetch('/api/session', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: peer.localDescription.sdp, config }), signal });
      if (!response.ok) throw new Error((await response.json()).error || '세션 연결 실패');
      const sdp = await response.text();
      if (!current()) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      if (!current()) return;
      const message = error.name === 'NotAllowedError' ? '마이크 권한이 거부되었습니다. 브라우저에서 허용하거나 텍스트 모드로 시작하세요.' : error.message;
      this.fail(message || '연결하지 못했습니다. 서버와 네트워크를 확인해 주세요.');
    }
  }
  handle(event, controller) {
    if (!event.type.endsWith('.delta')) this.log(event);
    const wasSpeaking = this.voice?.busy;
    const responseCurrent = event.response && controller.isCurrent(event.response.id);
    const accepted = controller.handle(event);
    if (event.type === 'input_audio_buffer.speech_started') {
      this.capture?.speechStart(event.item_id);
      this.markInterrupted(wasSpeaking);
      this.update({ error: '', voiceStatus: 'idle' });
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      this.capture?.speechStop(event.item_id);
      this.stoppedSpeaking = performance.now();
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') this.message(event.item_id, 'user', event.delta, true, true);
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.message(event.item_id, 'user', event.transcript || '(인식된 음성 없음)');
      if (!this.transcribed.has(event.item_id)) {
        this.transcribed.add(event.item_id); this.update({ turns: this.snapshot.turns + 1 });
      }
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed') this.update({ error: '음성 자막을 만들지 못했습니다. 원래 음성으로 답변을 시도합니다.' });
    if (event.type === 'conversation.item.truncated') this.update({ messages: this.snapshot.messages.map(m => m.id === event.item_id ? { ...m, interrupted: true, partial: false } : m) });
    if (event.type === 'response.done' && responseCurrent && event.response.status !== 'completed') {
      this.markInterrupted(wasSpeaking); this.voice?.interrupt(); this.update({ voiceStatus: 'idle' });
    }
    if (!accepted) return;
    if (['response.output_audio_transcript.delta', 'response.output_text.delta'].includes(event.type)) this.message(event.item_id, 'assistant', event.delta, true, true);
    if (['response.output_audio_transcript.done', 'response.output_text.done'].includes(event.type)) this.message(event.item_id, 'assistant', event.transcript || event.text || '');
    if (event.type === 'response.output_text.delta') this.voice?.append(event.item_id, event.response_id, event.delta);
    if (event.type === 'response.output_text.done') this.voice?.completeItem(event.item_id, event.response_id, event.text || '');
    if (event.type === 'response.done' && responseCurrent && event.response.status === 'completed') this.voice?.finish(event.response.id);
    if (event.type === 'output_audio_buffer.started' && this.stoppedSpeaking) {
      this.update({ latencyMs: Math.round(performance.now() - this.stoppedSpeaking) }); this.stoppedSpeaking = null;
    }
  }
  text(text, prompted = false) {
    text = text.trim().slice(0, 2000);
    if (!text || !this.snapshot.connected) return false;
    if (!this.controller.speaking) this.markInterrupted(this.voice?.busy);
    if (!this.controller.text(text)) { this.update({ error: '말씀을 마친 뒤 텍스트를 보내 주세요.' }); return false; }
    const id = 'local-' + crypto.randomUUID();
    this.message(id, 'user', text);
    if (prompted) this.update({ messages: this.snapshot.messages.map(m => m.id === id ? { ...m, prompted: true } : m) });
    this.stoppedSpeaking = performance.now();
    this.update({ turns: this.snapshot.turns + 1, error: '' }); return true;
  }
  toggleMic() {
    if (!this.mic) return;
    this.setMicMuted(!this.snapshot.micMuted);
  }
  setMicMuted(micMuted) {
    if (!this.mic) return;
    this.mic.getAudioTracks().forEach(track => { track.enabled = !micMuted; });
    this.update({ micMuted });
  }
  async playAudio() {
    if (this.voice) { await this.voice.resume(); return; }
    const generation = this.generation;
    try { await this.audio?.play(); if (generation === this.generation) this.update({ needsPlayback: false }); }
    catch { if (generation === this.generation) this.update({ needsPlayback: true }); }
  }
  dismissError() { this.update({ error: '' }); }
  markInterrupted(wasSpeaking) {
    const last = [...this.snapshot.messages].reverse().find(m => m.role === 'assistant');
    this.update({ messages: this.snapshot.messages.map(m => m.role === 'assistant' && (m.partial || (wasSpeaking && m.id === last?.id)) ? { ...m, interrupted: true, partial: false } : m) });
  }
  fail(error) { this.release(); this.update({ connected: false, status: 'error', error, needsPlayback: false, voiceStatus: 'idle', voiceProgress: '', speechCue: null }); }
  stop() {
    if (this.capture) { this.update({ evaluationAudio: this.capture.finish() }); this.capture = null; }
    const lastAssistant = [...this.snapshot.messages].reverse().find(m => m.role === 'assistant');
    const interrupted = this.controller?.playing || lastAssistant?.partial;
    const messages = this.snapshot.messages.map(m => interrupted && m.id === lastAssistant?.id ? { ...m, interrupted: true, partial: false } : m);
    this.release(); this.update({ connected: false, status: 'ended', messages, needsPlayback: false, voiceStatus: 'idle', voiceProgress: '', speechCue: null }); return this.snapshot;
  }
  release() {
    this.capture?.discard(); this.capture = null;
    this.generation++;
    this.voice?.dispose();
    this.controller?.dispose(); this.controller = null;
    this.abort?.abort(); clearTimeout(this.connectTimer); clearTimeout(this.disconnectTimer); clearInterval(this.tick);
    const channel = this.channel; this.channel = null; channel?.close();
    const peer = this.peer; this.peer = null; peer?.close();
    this.mic?.getTracks().forEach(t => t.stop()); this.mic = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.stoppedSpeaking = null;
  }
}

function waitForIce(peer, signal) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', change); signal.removeEventListener('abort', finish); resolve(); };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, 1500);
    peer.addEventListener('icegatheringstatechange', change); signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
