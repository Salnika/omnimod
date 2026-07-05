---
layout: home
hero:
  name: omnimod
  text: Modular codemods for the web
  tagline: A small core plus plugins — fast, formatting-preserving, and easy to extend.
  image:
    src: /logo.png
    alt: omnimod logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Browse plugins
      link: /plugins/styled-to-vanilla-extract
    - theme: alt
      text: GitHub
      link: https://github.com/salnika/omnimod
features:
  - title: Formatting-preserving
    details: oxc-parser (UTF-16 offsets) + magic-string splices keep untouched code byte-identical, and generated code is run through your project's own formatter.
  - title: Plugin architecture
    details: A two-phase analyze → transform → finalize lifecycle with shared cross-file state. Author a plugin with definePlugin and a single transform function.
  - title: Seven plugins included
    details: styled→vanilla-extract, moment→dayjs, jest→vitest, lodash→es-toolkit, redux→Redux Toolkit, React class→hooks, and webpack→vite. Convertible cases are automated; the rest is flagged with TODOs and AI-ready migration guides.
---
