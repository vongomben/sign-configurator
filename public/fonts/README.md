# Fonts

Every font here is under the SIL Open Font License 1.1; each folder carries its own `OFL.txt`.

## Latin

`Sacramento`, `Neonderthaw`, `EMSAllure` and `HersheyScriptSimplex` are the upstream files, unchanged.

## CJK: subsets

The Chinese and Japanese fonts are **subsets** of the upstream releases, cut down to the everyday
character sets so the browser downloads about 2.5 MB instead of 18–27 MB. The design is untouched:
only glyphs outside the character set were dropped. Neither licence reserves the font name
(`Noto Sans SC` inherits Source Han Sans' reserved name `Source`, which we do not use).

A character outside the subset gets the usual "character missing from this font" warning, and the
sign goes to a custom quote.

| Folder | Upstream | Subset to | Size |
|---|---|---|---|
| `NotoSansSC` | [google/fonts `ofl/notosanssc`](https://github.com/google/fonts/tree/main/ofl/notosanssc), variable | GB 2312 (7540 chars), instanced at `wght=300` | 18 MB → 2.4 MB |
| `MPLUSRounded1c` | [google/fonts `ofl/mplusrounded1c`](https://github.com/google/fonts/tree/main/ofl/mplusrounded1c) | Shift-JIS (6974 chars) | 3.3 MB → 2.7 MB |

To rebuild one, with `fonttools` installed:

```sh
# Chinese: pick the Light instance first, then cut to GB 2312.
python -m fontTools.varLib.instancer "NotoSansSC[wght].ttf" wght=300 -o light.ttf
python -m fontTools.subset light.ttf --unicodes-file=gb2312.txt --layout-features='*' \
    --notdef-outline --name-IDs='*' --output-file=NotoSansSC-Light.ttf
```

`gb2312.txt` is the comma-separated `U+XXXX` list of everything `bytes([hi, lo]).decode('gb2312')`
yields, plus ASCII; for Japanese the same with `shift_jis`.

**The outlines must be static.** `opentype.js` ignores variable-font axes and reads the default
master, so a variable file would be rasterized at the wrong weight (Noto Sans SC's default is Thin).
