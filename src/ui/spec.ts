import { marked } from 'marked';
import specMd from '../../SPEC.md?raw';

const main = document.querySelector<HTMLElement>('#spec')!;
main.innerHTML = marked.parse(specMd, { async: false, gfm: true });

// Ancore sui titoli, per poter linkare le sezioni (es. spec.html#5-pipeline).
for (const h of main.querySelectorAll<HTMLHeadingElement>('h1, h2, h3')) {
  h.id = (h.textContent ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
