# @omnimod/plugin-moment-to-dayjs

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-moment-to-dayjs?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-moment-to-dayjs)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that migrates Moment.js imports and call sites to Day.js.

## Use With The CLI

```bash
omnimod run moment-to-dayjs "src/**/*.{ts,tsx,js,jsx}"
omnimod run moment-to-dayjs "src/**/*.{ts,tsx,js,jsx}" --write
```

## Use As A Library

```ts
import { momentToDayjs } from "@omnimod/plugin-moment-to-dayjs";
```

## Notes

The plugin rewrites the default Moment binding and compatible call sites. APIs
that require Day.js plugins, such as duration or relative-time helpers, are
reported for follow-up.
