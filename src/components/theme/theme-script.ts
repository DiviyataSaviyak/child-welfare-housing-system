/** Where the officer's choice of light or dark is kept in this browser. With none, the computer's setting decides. */
export const THEME_KEY = "theme";

/**
 * Runs in the page's <head> before anything is drawn, so a dark page never flashes white: it puts `dark`
 * on <html> for a stored "dark", or, with nothing stored, when the computer is set to dark.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
