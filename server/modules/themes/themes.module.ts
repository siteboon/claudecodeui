import { createThemeGalleryRouter } from './themes.routes.js';
import { createThemeGalleryService } from './themes.service.js';

const themeGalleryService = createThemeGalleryService({
  fetch: (...args) => globalThis.fetch(...args),
});

/** Theme-gallery router assembled for the authenticated server mount. */
export const themeRoutes = createThemeGalleryRouter(themeGalleryService);
