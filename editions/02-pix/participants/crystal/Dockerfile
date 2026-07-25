FROM crystallang/crystal:1.20.3 AS builder
WORKDIR /app
COPY shard.yml ./
RUN shards install
COPY . .
RUN shards build app --release --no-debug --static

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /app/bin/app ./server
EXPOSE 3000
CMD ["./server"]
