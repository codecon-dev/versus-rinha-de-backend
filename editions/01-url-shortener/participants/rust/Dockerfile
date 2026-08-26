FROM rust:1.90-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM alpine:3.20
RUN apk add --no-cache libgcc
WORKDIR /app
COPY --from=builder /app/target/release/url-shortener .
EXPOSE 3000
CMD ["./url-shortener"]
