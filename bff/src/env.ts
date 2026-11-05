export const env = {
  port: Number(process.env.PORT ?? 8080),
  backendUrl: process.env.BACKEND_URL ?? "http://localhost:8000",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://prolysis:prolysis@localhost:5432/prolysis",
  // Frontend origin allowed by CORS in local dev.
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
};
