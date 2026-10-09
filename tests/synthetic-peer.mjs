export function installSyntheticPeer(page, options = {}) {
  return page.addInitScript(({ duplicateEvents = false, toolPreamble = false }) => {
    let sequence = 0, eventSequence = 0; window.syntheticEvents = [];
    class Channel extends EventTarget {
      readyState = 'connecting'; user = '';
      emit(value) {
        const data = JSON.stringify({ event_id: `synthetic-${++eventSequence}`, ...value });
        this.dispatchEvent(new MessageEvent('message', { data }));
        if (duplicateEvents) this.dispatchEvent(new MessageEvent('message', { data }));
      }
      close() { this.readyState = 'closed'; }
      send(raw) {
        const event = JSON.parse(raw); window.syntheticEvents.push(event);
        if (event.type === 'conversation.item.create' && event.item.role === 'user') this.user = event.item.content[0].text;
        if (event.type !== 'response.create') return;
        setTimeout(() => {
          if (this.readyState !== 'open') return;
          const id = `response-${++sequence}`;
          this.emit({ type: 'response.created', response: { id, metadata: event.response.metadata } });
          if (event.response.tool_choice?.name === 'search_trump_news') {
            if (toolPreamble) {
              this.emit({ type: 'response.output_text.delta', response_id: id, item_id: `${id}-preamble`, delta: 'Lookup preamble: hi again. ' });
              this.emit({ type: 'response.output_text.done', response_id: id, item_id: `${id}-preamble`, text: 'Lookup preamble: hi again. ' });
            }
            this.emit({ type: 'response.done', response: { id, status: 'completed', output: [{ type: 'function_call', name: 'search_trump_news', call_id: id, arguments: JSON.stringify({ query: this.user }) }] } });
            return;
          }
          const text = event.response.metadata.phase === 'grounded' ? 'The uploaded reference discusses AI and Super Intelligence.' : this.user ? 'That sounds interesting. Tell me a little more.' : 'Hello! What would you like to talk about?';
          this.emit({ type: 'response.output_text.delta', response_id: id, item_id: id, delta: text });
          this.emit({ type: 'response.output_text.done', response_id: id, item_id: id, text });
          this.emit({ type: 'response.done', response: { id, status: 'completed', output: [] } });
        }, 30);
      }
    }
    window.RTCPeerConnection = class extends EventTarget {
      iceGatheringState = 'complete'; connectionState = 'new';
      constructor() { super(); window.syntheticPeer = this; }
      addTransceiver() {}
      createDataChannel() { return this.channel = new Channel(); }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio\r\nm=application\r\n' }; }
      async setLocalDescription(value) { this.localDescription = value; }
      async setRemoteDescription() { this.channel.readyState = 'open'; this.channel.dispatchEvent(new Event('open')); this.channel.emit({ type: 'session.created' }); }
      close() { this.connectionState = 'closed'; }
    };
    navigator.mediaDevices.getUserMedia = () => { throw new Error('Text mode must not access the microphone'); };
  }, options);
}
