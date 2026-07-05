# redux → Redux Toolkit

`@omnimod/plugin-redux-to-toolkit` migrates legacy [Redux](https://redux.js.org)
to [Redux Toolkit](https://redux-toolkit.js.org). It repoints imports and
rewrites store creation; the semantic migrations that need human judgement are
flagged rather than guessed.

```bash
omnimod run redux-to-toolkit "src/**/*.{ts,tsx,js,jsx}" --write
```

The target project needs `@reduxjs/toolkit` installed.

## Example

```ts
// before
import { createStore } from "redux";
export const store = createStore(rootReducer);

// after
import { configureStore } from "@reduxjs/toolkit";
export const store = configureStore({ reducer: rootReducer });
```

## Automated

- `createStore` / `legacy_createStore` → `configureStore`, rewriting
  `createStore(rootReducer, preloadedState)` into
  `configureStore({ reducer, preloadedState })`.
- The `redux` import is retargeted to `@reduxjs/toolkit`. Helpers RTK re-exports
  verbatim (`combineReducers`, `compose`, `bindActionCreators`,
  `applyMiddleware`) move with it; any redux-only export is split back onto a
  residual `redux` import.

## Flagged for follow-up

- Switch-statement reducers → convert to `createSlice` (diagnostic + TODO).
- Middleware/enhancers passed to `createStore` are noted so you can move them to
  `configureStore`'s `middleware`/`enhancers` options.
- `connect()` → prefer the `useSelector`/`useDispatch` hooks.
- `redux-saga` / `redux-thunk` → migrate async logic to `createAsyncThunk` /
  listener middleware.
