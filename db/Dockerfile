# One-shot goose migration runner. Installs the goose binary and ships the SQL migrations.
FROM golang:1.23-alpine AS build
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.22.1

FROM alpine:3.20
COPY --from=build /go/bin/goose /usr/local/bin/goose
WORKDIR /db
COPY migrations ./migrations
ENTRYPOINT ["goose"]
