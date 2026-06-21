import cors from "cors";
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import helmet from "helmet";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import authRouter from "./routes/auth.js";
import billingRouter from "./routes/billing.js";
import reportsRouter from "./routes/reports.js";
import subscriptionRouter from "./routes/subscriptions.js";
import { latestUsdRates } from "./services/exchangeRates.js";
import { processGmailPushNotification, registerLiveScanSocket } from "./services/liveScan.js";

const MySQLStore = MySQLStoreFactory(session);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, "../../client/dist");

async function startServer() {
  await initializeDatabase();

  const app = express();
  const isProduction = config.nodeEnv === "production";
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  const sessionStore = new MySQLStore({
    ...(config.mysql.socketPath
      ? { socketPath: config.mysql.socketPath }
      : { host: config.mysql.host, port: config.mysql.port }),
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    createDatabaseTable: true,
    schema: {
      tableName: "sessions"
    }
  });

  app.use(helmet());
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
      exposedHeaders: ["Content-Disposition"]
    })
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        request.rawBody = buffer;
      }
    })
  );
  const sessionMiddleware = session({
    name: "hiddencharges.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  });

  app.use(sessionMiddleware);

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, database: "mysql", name: "HiddenCharges API" });
  });

  app.get("/api/rates/latest", async (_request, response, next) => {
    try {
      response.json(await latestUsdRates());
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/subscriptions", subscriptionRouter);

  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      credentials: true
    }
  });

  io.engine.use(sessionMiddleware);
  registerLiveScanSocket(io);

  app.post("/api/google/gmail/push/:token?", async (request, response, next) => {
    try {
      if (
        config.google.pubsubVerificationToken &&
        request.params.token !== config.google.pubsubVerificationToken
      ) {
        return response.status(403).json({ message: "Invalid push verification token" });
      }

      await processGmailPushNotification({ io, payload: request.body });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  if (isProduction) {
    app.use(express.static(clientDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api/")) return next();
      return response.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  server.listen(config.port, () => {
    console.log(`HiddenCharges API listening on http://localhost:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Unable to start API", error);
  process.exit(1);
});
