import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    // AI requests contain bounded conversation/context payloads. Keep the
    // transport large enough for an ultra-mode evidence package while still
    // rejecting accidental multi-megabyte uploads before route execution.
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const responseBody = capturedJsonResponse as any;
        // Never write AI response bodies to application logs. They may contain
        // target names, internal paths, or other assessment evidence and can
        // also be large enough to turn a status log into a second transcript.
        const responseSummary = {
          success: responseBody?.success,
          responseChars: typeof responseBody?.response === 'string' ? responseBody.response.length : undefined,
          hasError: typeof responseBody?.error === 'string' && responseBody.error.length > 0,
        };
        logLine += ` :: ${JSON.stringify(responseSummary)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Do not reflect provider, filesystem, or request-body details through the
    // generic Express error boundary. Route handlers already return their
    // user-facing errors explicitly.
    res.status(status >= 400 && status < 500 ? status : 500).json({
      message: status >= 400 && status < 500 ? 'Request could not be processed.' : 'Internal Server Error',
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "127.0.0.1", () => {
    log(`serving on port ${port}`);
  });
})();
