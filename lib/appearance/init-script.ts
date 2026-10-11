import {
  CUSTOM_BG_STORAGE_KEY,
  DEFAULT_PREFS,
  DEFAULT_THEME,
  PALETTES,
  PREFS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  WALLPAPER_URLS,
} from './config';
import { applyAppearanceToRoot, normalizePrefs } from './apply';

/**
 * Inline script untuk <head>: membaca localStorage dan menerapkan appearance
 * sebelum browser menggambar halaman pertama (mencegah kedip tema default).
 * Dibangun dari sumber fungsi yang sama dengan runtime React (apply.ts).
 */
export function buildAppearanceInitScript(): string {
  const config = {
    themeKey: THEME_STORAGE_KEY,
    prefsKey: PREFS_STORAGE_KEY,
    customKey: CUSTOM_BG_STORAGE_KEY,
    defaultTheme: DEFAULT_THEME,
    defaults: DEFAULT_PREFS,
    palettes: PALETTES,
    wallpapers: WALLPAPER_URLS,
  };

  return (
    '(function(){try{' +
    // Dibungkus kurung sebagai EKSPRESI: minifier bisa mengubah deklarasi `function x(){}`
    // menjadi ekspresi anonim, yang akan SyntaxError bila dijadikan statement.
    'var normalizePrefs=(' +
    normalizePrefs.toString() +
    ');' +
    'var applyAppearanceToRoot=(' +
    applyAppearanceToRoot.toString() +
    ');' +
    'var cfg=' +
    JSON.stringify(config) +
    ';' +
    'var root=document.documentElement;' +
    'var theme=null;try{theme=localStorage.getItem(cfg.themeKey);}catch(e){}' +
    'var sys=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);' +
    'if(theme==="system"){theme=sys?"dark":"light";}' +
    'if(!theme||!cfg.palettes[theme]){theme=cfg.defaultTheme;}' +
    'if(theme==="system"){theme=sys?"dark":"light";}' +
    'var raw=null;try{raw=JSON.parse(localStorage.getItem(cfg.prefsKey));}catch(e){}' +
    'var custom=null;try{custom=localStorage.getItem(cfg.customKey);}catch(e){}' +
    'applyAppearanceToRoot({theme:theme,prefs:normalizePrefs(raw,cfg.defaults),customImage:custom,palettes:cfg.palettes,wallpapers:cfg.wallpapers},root);' +
    '}catch(e){}})();'
  );
}
