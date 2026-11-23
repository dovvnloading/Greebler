// PNG 1.2: one zlib stream split over contiguous IDAT chunks. Scalar data maps
// are untagged; only the color map has an sRGB rendering intent.
import { Zlib } from 'fflate';

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});

export type PngFormat = 'gray' | 'gray16' | 'rgb' | 'srgb' | 'rgba';

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < out.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ out[i]) & 255];
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
  return out;
}

const end = chunk('IEND', new Uint8Array());

export class StripPng {
  private readonly parts: Uint8Array<ArrayBuffer>[];
  private readonly compress: (data: Uint8Array<ArrayBuffer>, final: boolean) => void | Promise<void>;
  private nativeWriter?: WritableStreamDefaultWriter<BufferSource>;
  private readonly bytesPerPixel: number;
  private written = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    format: PngFormat,
    native = false,
  ) {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = format === 'gray16' ? 16 : 8;
    if (format === 'rgba') {
      header[9] = 6;
      this.bytesPerPixel = 4;
    } else if (format === 'rgb' || format === 'srgb') {
      header[9] = 2;
      this.bytesPerPixel = 3;
    } else {
      this.bytesPerPixel = header[8] / 8;
    }
    this.parts = [signature, chunk('IHDR', header)];
    if (format === 'srgb') this.parts.push(chunk('sRGB', Uint8Array.of(0)));
    if (native && typeof CompressionStream !== 'undefined') {
      const stream = new CompressionStream('deflate');
      const writer = stream.writable.getWriter();
      this.nativeWriter = writer;
      const drained = stream.readable.pipeTo(
        new WritableStream({
          write: (data: Uint8Array) => {
            this.parts.push(chunk('IDAT', data));
          },
          close: () => {
            this.parts.push(end);
          },
        }),
      );
      // Aborting a partial bake also terminates its readable stream.
      drained.catch(() => {});
      this.compress = async (data, final) => {
        await writer.write(data);
        if (final) {
          await writer.close();
          await drained;
          this.nativeWriter = undefined;
        }
      };
    } else {
      const deflater = new Zlib({ level: 1 }, (data, final) => {
        if (data.length) this.parts.push(chunk('IDAT', data));
        if (final) this.parts.push(end);
      });
      this.compress = (data, final) => deflater.push(data, final);
    }
  }

  write(data: Uint8Array, rows: number) {
    const stride = this.width * this.bytesPerPixel;
    if (rows < 1 || this.written + rows > this.height || data.length !== rows * stride) {
      throw new Error('PNG strip dimensions do not match the image.');
    }
    // Horizontal difference filter. Each band can be released once compressed.
    const scanlines = new Uint8Array(rows * (stride + 1));
    for (let row = 0; row < rows; row++) {
      const src = row * stride;
      const dst = row * (stride + 1);
      scanlines[dst] = 1;
      for (let i = 0; i < this.bytesPerPixel; i++) scanlines[dst + 1 + i] = data[src + i];
      for (let i = this.bytesPerPixel; i < stride; i++) {
        scanlines[dst + 1 + i] = data[src + i] - data[src + i - this.bytesPerPixel];
      }
    }
    this.written += rows;
    return this.compress(scanlines, this.written === this.height);
  }

  dispose() {
    if (this.nativeWriter) {
      this.nativeWriter.abort().catch(() => {});
      this.nativeWriter = undefined;
    }
  }

  blob() {
    if (this.written !== this.height) throw new Error('Incomplete PNG render.');
    return new Blob(this.parts, { type: 'image/png' });
  }

  dataUrl() {
    if (this.written !== this.height) throw new Error('Incomplete PNG render.');
    const words: string[] = [];
    for (const part of this.parts) {
      for (let i = 0; i < part.length; i += 16384) words.push(String.fromCharCode(...part.subarray(i, i + 16384)));
    }
    return `data:image/png;base64,${btoa(words.join(''))}`;
  }
}
