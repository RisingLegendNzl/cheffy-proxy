// web/src/hooks/useReducedMotion.js
import { useState, useEffect } from ‘react’;

/**

- Custom hook to detect and respect user’s motion preferences
- Returns true if user prefers reduced motion
  */
  const useReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

useEffect(() => {
const mediaQuery = window.matchMedia(’(prefers-reduced-motion: reduce)’);

```
setPrefersReducedMotion(mediaQuery.matches);

const handleChange = (event) => {
  setPrefersReducedMotion(event.matches);
};

mediaQuery.addEventListener('change', handleChange);

return () => {
  mediaQuery.removeEventListener('change', handleChange);
};
```

}, []);

return prefersReducedMotion;
};

export default useReducedMotion;