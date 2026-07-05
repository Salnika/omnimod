# React class → hooks

`@omnimod/plugin-react-class-to-hooks` converts **simple** React class
components to function components with hooks. It is intentionally conservative:
only components it can convert faithfully are rewritten — anything with a lifecycle
or pattern it can't model safely is left untouched and flagged.

```bash
omnimod run react-class-to-hooks "src/**/*.{tsx,jsx}" --write
```

## Example

```tsx
// before
import React from "react";
export class Hello extends React.Component {
  state = { n: 0 };
  render() {
    return <div>{this.state.n}</div>;
  }
}

// after
import React, { useState } from "react";
export function Hello(props) {
  const [n, setN] = useState(0);
  return <div>{n}</div>;
}
```

## Automated

- Class body → function component; `render()`'s returned JSX becomes the body.
- `state` + `setState` → `useState` hooks; `this.state.x` / `this.props.x`
  references are unwound to the local binding / `props`.
- `componentDidMount` / `componentDidUpdate` / `componentWillUnmount` →
  `useEffect`.
- Class methods → inner functions.

## Flagged for follow-up

Left as a class with a diagnostic when it uses patterns hooks can't model 1:1:

- `getDerivedStateFromProps`, `shouldComponentUpdate`, `getSnapshotBeforeUpdate`
- higher-order-component wrapping, class refs, legacy context
