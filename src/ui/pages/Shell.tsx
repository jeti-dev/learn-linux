import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { progress, useProgress } from '../../state/progress';
import s from './Pages.module.css';

function currentTheme(stored?: 'light' | 'dark'): 'light' | 'dark' {
  return stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

/** Top navigation shared by the non-lesson pages. */
export function PageShell({ children, fill }: { children: ReactNode; fill?: boolean }) {
  const { theme } = useProgress();
  const active = currentTheme(theme);
  const link = ({ isActive }: { isActive: boolean }) => `${s.navLink} ${isActive ? s.navActive : ''}`;
  return (
    <div className={`${s.shell} ${fill ? s.shellFill : ''}`}>
      <header className={s.nav}>
        <NavLink to="/" className={s.brand} aria-label="Learn Linux home">
          <span className={s.brandMark} aria-hidden="true">
            &gt;_
          </span>
          <span className={s.brandText}>Learn Linux</span>
        </NavLink>
        <nav className={s.navLinks} aria-label="Main">
          <NavLink to="/" end className={link}>
            Lessons
          </NavLink>
          <NavLink to="/sandbox" className={link}>
            Sandbox
          </NavLink>
          <NavLink to="/cheatsheet" className={link}>
            Cheat sheet
          </NavLink>
        </nav>
        <button
          type="button"
          className={s.themeToggle}
          onClick={() => progress.setTheme(active === 'dark' ? 'light' : 'dark')}
          aria-label={`Switch to ${active === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${active === 'dark' ? 'light' : 'dark'} theme`}
        >
          {active === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      {children}
    </div>
  );
}
