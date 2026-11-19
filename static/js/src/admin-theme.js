// Applies the saved app theme (same localStorage key as ui.js) to the admin page.
// External file because the CSP (script-src 'self') blocks inline scripts.
if (localStorage.getItem('cspm_theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
