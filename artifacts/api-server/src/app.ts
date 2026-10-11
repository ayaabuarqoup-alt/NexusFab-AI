import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { OperationError } from "./routes/operations";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const errors: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof OperationError) { res.status(err.status).json({ error: err.message, code: err.code }); return; }
  req.log.error({ err }, "Request failed");
  res.status(500).json({ error: "Unable to process request", code: "SERVER_ERROR" });
};
app.use(errors);

export default app;
