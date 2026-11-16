import { useEffect, useState } from 'react';

/**
 * Tracks the visible viewport so the layout can shrink when the on-screen keyboard opens.
 * Publishes the height as the CSS variable `--vvh` and returns it.
 */
export function useVisualViewport(): number {
  const [height, setHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      document.documentElement.style.setProperty('--vvh', `${h}px`);
      setHeight(h);
      // iOS scrolls the page up when the keyboard opens; keep the app pinned to the top.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--vvh');
    };
  }, []);

  return height;
}
