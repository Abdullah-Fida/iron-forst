export const THEME_STORAGE_KEY = 'core_ui_theme';

function createThemePreset({
  id,
  label,
  description,
  preview,
  primary,
  hover,
  secondary,
  light,
  border,
  rgb,
}) {
  return {
    id,
    label,
    description,
    preview,
    vars: {
      'accent-primary': primary,
      'accent-primary-hover': hover,
      'accent-secondary': secondary,
      'accent-gradient': primary,
      'accent-gradient-hover': hover,
      'accent-glow': `0 12px 24px rgba(${rgb}, 0.3)`,
      'accent-light': light,
      'accent-border': border,
      'border-indigo': primary,
      primary,
      'loader-color': primary,
      'loader-gradient': primary,
      'shadow-indigo': `0 16px 30px rgba(${rgb}, 0.24)`,
      'shadow-neon': `0 0 24px rgba(${rgb}, 0.36)`,
    },
  };
}

export const THEME_PRESETS = [
  createThemePreset({
    id: 'ocean-blue',
    label: 'Aurora Blue',
    description: 'Vivid and modern',
    preview: '#3b82f6',
    primary: '#3b82f6',
    hover: '#2563eb',
    secondary: '#60a5fa',
    light: '#12213f',
    border: '#2a4f8d',
    rgb: '59, 130, 246',
  }),
  createThemePreset({
    id: 'emerald-green',
    label: 'Emerald Pulse',
    description: 'Fresh and high-clarity',
    preview: '#10b981',
    primary: '#10b981',
    hover: '#059669',
    secondary: '#34d399',
    light: '#102a24',
    border: '#1f5d4f',
    rgb: '16, 185, 129',
  }),
  createThemePreset({
    id: 'royal-purple',
    label: 'Royal Amethyst',
    description: 'Premium and rich',
    preview: '#8b5cf6',
    primary: '#8b5cf6',
    hover: '#7c3aed',
    secondary: '#a78bfa',
    light: '#21183b',
    border: '#4b3482',
    rgb: '139, 92, 246',
  }),
  createThemePreset({
    id: 'amber-gold',
    label: 'Solar Amber',
    description: 'Warm and confident',
    preview: '#f59e0b',
    primary: '#f59e0b',
    hover: '#d97706',
    secondary: '#fbbf24',
    light: '#33240f',
    border: '#6b4a1c',
    rgb: '245, 158, 11',
  }),
  createThemePreset({
    id: 'slate-cyan',
    label: 'Glacier Cyan',
    description: 'Clean and futuristic',
    preview: '#06b6d4',
    primary: '#06b6d4',
    hover: '#0891b2',
    secondary: '#67e8f9',
    light: '#0f2830',
    border: '#1f5b69',
    rgb: '6, 182, 212',
  }),
  createThemePreset({
    id: 'mist-indigo',
    label: 'Cobalt Night',
    description: 'Bold and focused',
    preview: '#4f46e5',
    primary: '#4f46e5',
    hover: '#4338ca',
    secondary: '#818cf8',
    light: '#181b3a',
    border: '#343b7f',
    rgb: '79, 70, 229',
  }),
  createThemePreset({
    id: 'sage-olive',
    label: 'Lime Current',
    description: 'Bright and sporty',
    preview: '#84cc16',
    primary: '#84cc16',
    hover: '#65a30d',
    secondary: '#a3e635',
    light: '#223110',
    border: '#4a6d1f',
    rgb: '132, 204, 22',
  }),
  createThemePreset({
    id: 'rosewood-mauve',
    label: 'Rose Fusion',
    description: 'Stylish and premium',
    preview: '#e11d8d',
    primary: '#e11d8d',
    hover: '#be185d',
    secondary: '#f472b6',
    light: '#331528',
    border: '#6d2b55',
    rgb: '225, 29, 141',
  }),
  createThemePreset({
    id: 'steel-blue',
    label: 'Indigo Spark',
    description: 'Sharp and modern',
    preview: '#6366f1',
    primary: '#6366f1',
    hover: '#4f46e5',
    secondary: '#a5b4fc',
    light: '#171a36',
    border: '#333a74',
    rgb: '99, 102, 241',
  }),
  createThemePreset({
    id: 'glacier-mint',
    label: 'Aqua Mint',
    description: 'Cool and uplifting',
    preview: '#14b8a6',
    primary: '#14b8a6',
    hover: '#0d9488',
    secondary: '#5eead4',
    light: '#102b28',
    border: '#25635e',
    rgb: '20, 184, 166',
  }),
];

const DEFAULT_THEME_ID = 'amber-gold';

function getThemeById(themeId) {
  return THEME_PRESETS.find((theme) => theme.id === themeId) || THEME_PRESETS[0];
}

function persistTheme(themeId) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Ignore local storage errors in restricted environments.
  }
}

export function getActiveThemeId() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved) return DEFAULT_THEME_ID;
    return getThemeById(saved).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyTheme(themeId) {
  const theme = getThemeById(themeId);
  const root = document.documentElement;

  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });

  persistTheme(theme.id);
  return theme.id;
}

/* ── Mode Support (Light/Dark) ──────────────── */
export const MODE_STORAGE_KEY = 'core_ui_mode';

export function getActiveMode() {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    // Default to dark for Gym SaaS vibe
    return saved || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyMode(mode) {
  const root = document.documentElement;
  if (mode === 'light') {
    root.classList.add('light-mode');
    root.classList.remove('dark-mode');
  } else {
    root.classList.add('dark-mode');
    root.classList.remove('light-mode');
  }
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  return mode;
}

export function toggleMode() {
  const current = getActiveMode();
  const next = current === 'light' ? 'dark' : 'light';
  return applyMode(next);
}

export function initTheme() {
  const themeId = getActiveThemeId();
  applyTheme(themeId);
  
  // Initialize mode
  const mode = getActiveMode();
  applyMode(mode);
}
