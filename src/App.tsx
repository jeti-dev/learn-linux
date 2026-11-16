import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useProgress } from './state/progress';
import { LessonPage } from './ui/lesson/LessonView';
import { CheatSheet } from './ui/pages/CheatSheet';
import { Home } from './ui/pages/Home';
import { Sandbox } from './ui/pages/Sandbox';

function ScrollToTop() {
  const { pathname } = useLocation();
  // Braces matter: newer browsers return a Promise from scrollTo, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  const { theme } = useProgress();
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  return (
    <HashRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lesson/:id" element={<LessonPage />} />
        <Route path="/sandbox" element={<Sandbox />} />
        <Route path="/cheatsheet" element={<CheatSheet />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
