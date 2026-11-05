# Prolysis

A web application for process discovery using desirable and undesirable event logs and domain knowledge.

## Run

Requires Docker with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Then open http://localhost:8080. **Load sample data** on the home page allows a first run without any upload.

LLM rule extraction needs an API key from a supported provider. The key is entered in the application for each request.

## License

CC BY-NC 4.0. See [LICENSE](LICENSE).
