// Auth removed — single local user, no login.
// All middleware below are pass-throughs that attach a hardcoded user
// to keep route handlers reading `req.user.id` working unchanged.

const LOCAL_USER = { id: 1, username: 'local' };

const validateApiKey = (req, res, next) => next();

const authenticateToken = (req, res, next) => {
  req.user = LOCAL_USER;
  next();
};

const generateToken = () => '';

const authenticateWebSocket = () => ({ ...LOCAL_USER, userId: LOCAL_USER.id });

const JWT_SECRET = '';

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET,
};
