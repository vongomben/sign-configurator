import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '../src/export/zip';

describe('ZIP senza compressione', () => {
  it('CRC-32 del vettore di prova', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('firma, numero di file e contenuto leggibili', () => {
    const zip = zipStore([
      { name: 'a.txt', data: 'ciao' },
      { name: 'b.bin', data: new Uint8Array([1, 2, 3]) },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // Il primo file: nome e dati in chiaro subito dopo l'intestazione da 30 byte.
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(zip.subarray(35, 39))).toBe('ciao');
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('ciao')));
  });

  it('stesso contenuto, stessi byte', () => {
    const entries = [{ name: 'x.stl', data: new Uint8Array(100) }];
    expect(zipStore(entries)).toEqual(zipStore(entries));
  });
});
