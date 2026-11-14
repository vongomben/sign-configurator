import { describe, expect, it } from 'vitest';
import { customerMessage, customerMessages, S } from '../src/ui/strings';

describe('testi della pagina cliente', () => {
  it('gli avvisi del generatore diventano frasi brevi in inglese', () => {
    expect(customerMessage('Spezzone 6: curva troppo stretta, raggio 6.3 mm (angolo 105.3°, minimo 14.6 mm), in (250.6, 33.1) mm.')).toMatch(/too tight/);
    expect(customerMessage('Spezzone 4: luce 2.2 mm, sotto il passo di taglio 10.0 mm, in (44.6, 55.0) mm.')).toMatch(/too short/);
    expect(customerMessage('Sagome che si fondono: distanza 8.4 mm, minimo 10.8 mm, in (245.7, 31.8).')).toMatch(/too close/);
    expect(customerMessage('Alimentatore da 18 A a 5 V: oltre i 10 A del controller GLEDOPTO.')).toMatch(/10 A/);
    expect(customerMessage('Spezzone 1: 1 fori di ancoraggio su 2 richiesti, in (36.0, 6.3).')).toBeNull();
    expect(customerMessage('Canale largo 6 mm: la striscia da 10 mm non ci entra.')).toMatch(/narrower than the LED strip/);
    expect(customerMessage('Canale profondo 3 mm: la striscia è spessa 6 mm.')).toMatch(/shallower than the LED strip/);
  });

  it('niente doppioni e niente italiano: quello che non riguarda il cliente sparisce', () => {
    const out = customerMessages([
      'Spezzone 6: curva troppo stretta, raggio 6.3 mm',
      'Spezzone 4: curva troppo stretta, raggio 11.0 mm',
      'Parete interna sotto 1.2 mm: freccia 1.15 mm',
    ]);
    expect(out).toHaveLength(1);
    for (const message of out) expect(message).not.toMatch(/[àèìòù]|curva|spezzone/i);
  });

  it('gli strumenti hanno etichette inglesi brevi', () => {
    expect(Object.values(S.tools)).toEqual(['Text', 'Font', 'Size', 'Color', 'Image', 'Backdrop', 'Tech', 'More']);
  });
});
