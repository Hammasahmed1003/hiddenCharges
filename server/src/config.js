import dotenv from "dotenv";

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "hiddencharges",
    socketPath: process.env.MYSQL_SOCKET || ""
  },
  sessionSecret: process.env.SESSION_SECRET || "dev-only-change-me",
  security: {
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "dev-only-change-me"
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/api/auth/gmail/callback",
    pubsubTopic: process.env.GOOGLE_PUBSUB_TOPIC || "",
    pubsubVerificationToken: process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN || ""
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  }
};
