// pdf.js 6 uses Map/WeakMap getOrInsert(Computed) (TC39 "upsert"), which
// only newer engines ship. WebView2 is evergreen, but an organisation may pin
// an older one, and older Chromium fails with "getOrInsertComputed is not a
// function". Defined only when missing; standard semantics.
for (const Type of [Map, WeakMap]) {
  const proto = Type.prototype;
  if (!proto.getOrInsert) Object.defineProperty(proto, 'getOrInsert', {configurable: true, writable: true, value(key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); }});
  if (!proto.getOrInsertComputed) Object.defineProperty(proto, 'getOrInsertComputed', {configurable: true, writable: true, value(key, compute) { if (!this.has(key)) this.set(key, compute(key)); return this.get(key); }});
}
