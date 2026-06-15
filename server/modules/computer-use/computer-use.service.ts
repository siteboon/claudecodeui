const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

export const computerUseService = {
  getStatus() {
    return {
      available: false,
      bridgeConnected: false,
      runtime: IS_PLATFORM ? 'cloud' : 'local',
      requiresDesktopBridge: true,
      message: IS_PLATFORM
        ? 'Cloud Computer Use requires a linked CloudCLI Desktop Agent on the user machine.'
        : 'Local Computer Use requires a desktop bridge with screen recording and accessibility permissions.',
      capabilities: {
        screenshots: false,
        mouse: false,
        keyboard: false,
        clipboard: false,
        stopControl: false,
      },
    };
  },
};
