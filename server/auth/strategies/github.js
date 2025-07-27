import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { userDb } from '../../database/db.js';

// Helper function to check if user is allowed
const isAllowedUser = (githubUsername) => {
  const allowedUsers = process.env.GITHUB_ALLOWED_USERS 
    ? process.env.GITHUB_ALLOWED_USERS.split(',').map(u => u.trim())
    : [];
  
  return allowedUsers.includes(githubUsername);
};

// Only initialize GitHub strategy if credentials are provided
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  console.log('🔐 Registering GitHub OAuth strategy');
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user is allowed
      if (!isAllowedUser(profile.username)) {
        return done(null, false, { 
          message: `GitHub user @${profile.username} is not authorized to access this application` 
        });
      }

      // Check if user already exists
      const existingUser = await userDb.getUserByGithubId(profile.id);
      
      if (existingUser) {
        // Update last login
        await userDb.updateUserLastLogin(existingUser.id);
        return done(null, existingUser);
      }

      // Create new user
      const newUser = await userDb.createGithubUser({
        username: profile.username,
        github_id: profile.id,
        github_username: profile.username,
        email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
        avatar_url: profile.photos && profile.photos[0] ? profile.photos[0].value : null
      });

      return done(null, newUser);
    } catch (error) {
      return done(error);
    }
  }
));
  console.log('✅ GitHub strategy registered successfully');
} else {
  console.log('⚠️  GitHub OAuth not configured - missing CLIENT_ID or CLIENT_SECRET');
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await userDb.getUserById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export { isAllowedUser };