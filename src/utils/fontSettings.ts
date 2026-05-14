export const applyAppearanceFontSettings = () => {
  const font = localStorage.getItem('appearanceFont') || 'default';
  const customFont = localStorage.getItem('appearanceCustomFont') || '';
  const fontSize = localStorage.getItem('appearanceFontSize') || '16';

  const body = document.body;

  if (font === 'custom' && customFont.trim()) {
    body.style.fontFamily = customFont;
  } else {
    body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  }

  body.style.fontSize = `${fontSize}px`;
};

export const applyCodeEditorFontSettings = () => {
  const font = localStorage.getItem('codeEditorFont') || 'default';
  const customFont = localStorage.getItem('codeEditorCustomFont') || '';

  const codeElements = document.querySelectorAll('code, pre code');
  
  let fontFamily: string;
  if (font === 'custom' && customFont.trim()) {
    fontFamily = customFont;
  } else {
    fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  }

  codeElements.forEach((element) => {
    (element as HTMLElement).style.fontFamily = fontFamily;
  });
};

export const initializeFontSettings = () => {
  applyAppearanceFontSettings();
  applyCodeEditorFontSettings();

  // Listen for settings changes
  window.addEventListener('appearanceFontSettingsChanged', applyAppearanceFontSettings);
  window.addEventListener('codeEditorSettingsChanged', applyCodeEditorFontSettings);
};
