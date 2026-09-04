declare module 'react-syntax-highlighter';
declare module 'react-syntax-highlighter/dist/esm/styles/prism';

// Per-language grammar modules re-export refractor language plugins, which
// carry `displayName`, `aliases` and the Prism grammar. No bundled types.
declare module 'react-syntax-highlighter/dist/esm/languages/prism/*' {
  import type { RefractorLanguage } from 'refractor';
  const language: RefractorLanguage;
  export default language;
}
