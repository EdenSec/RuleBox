/**
 * 主题切换
 * 只使用 data-theme 属性驱动 CSS 变量，不在此处写任何颜色值。
 */

const THEME_ORDER = ['auto', 'dark', 'light'];

const THEME_META = {
  auto: { label: '跟随系统', icon: 'monitor' },
  dark: { label: '深色', icon: 'moon' },
  light: { label: '浅色', icon: 'sun' }
};

/** 应用主题到根节点 */
export function applyTheme(theme = 'auto') {
  const value = THEME_ORDER.includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = value;
  return value;
}

/** 下一个主题 */
export function nextTheme(theme = 'auto') {
  const index = THEME_ORDER.indexOf(theme);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

/** 主题显示信息 */
export function themeMeta(theme = 'auto') {
  return THEME_META[theme] || THEME_META.auto;
}

export { THEME_ORDER };
