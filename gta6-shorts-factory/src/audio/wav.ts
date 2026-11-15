import fs from "node:fs";

/** Write mono or stereo float PCM ([-1,1]) as 16-bit WAV. */
export function writeWav(file: string, channels: Float32Array[], sampleRate: number) {
  const n = channels[0].length;
  const ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
}

/** Read a 16-bit PCM WAV (as produced by writeWav / ffmpeg pcm_s16le). */
export function readWav(file: string): { sampleRate: number; channels: Float32Array[] } {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt = { ch: 1, rate: 24000, bits: 16 };
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === "data") {
      if (fmt.bits !== 16) throw new Error(`readWav: only 16-bit PCM supported (${file})`);
      const frames = Math.floor(size / (2 * fmt.ch));
      const chans = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < fmt.ch; c++) chans[c][i] = b.readInt16LE(off + 8 + (i * fmt.ch + c) * 2) / 32768;
      return { sampleRate: fmt.rate, channels: chans };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`readWav: no data chunk in ${file}`);
}

/** Indices of the first/last sample above threshold (for trimming TTS silence). */
export function speechBounds(x: Float32Array, sampleRate: number, threshold = 0.01): [number, number] {
  const win = Math.round(sampleRate * 0.01);
  let first = 0;
  let last = x.length;
  const rms = (i: number) => {
    let s = 0;
    for (let k = i; k < Math.min(x.length, i + win); k++) s += x[k] * x[k];
    return Math.sqrt(s / win);
  };
  for (let i = 0; i < x.length; i += win) if (rms(i) > threshold) { first = i; break; }
  for (let i = x.length - win; i > 0; i -= win) if (rms(i) > threshold) { last = Math.min(x.length, i + win); break; }
  return [first, Math.max(first, last)];
}
