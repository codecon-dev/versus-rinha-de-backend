require "kemal"
require "json"
require "pg"
require "uuid"
require "uuid/json"
require "./amqp"
require "sync"

DB_CONNECTION = DB.open(ENV.fetch("DATABASE_URL"))

workers_ctx = Fiber::ExecutionContext::Parallel.new("workers", maximum: 1)

MUTEX = Sync::RWLock.new

ENTRIES = Array(Transfers).new
LAST_INDEX = 0

workers_ctx.spawn do
    loop do
      MUTEX.write do
        DB_CONNECTION.exec("SELECT ")
      end
      sleep 125.milliseconds
    end
end


DB_CONNECTION.exec("
  CREATE UNLOGGED TABLE IF NOT EXISTS temp_transfers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payer_id VARCHAR(64) NOT NULL REFERENCES accounts(id),
      payee_id VARCHAR(64) NOT NULL REFERENCES accounts(id),
      amount BIGINT NOT NULL,
      idempotency_key VARCHAR(128) UNIQUE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
  );
  ")

# DB_CONNECTION.exec("
#   CREATE MATERIALIZED VIEW computed_transfers AS
#   SELECT
#     id,
#     payer_id,
#     payee_id,
#     amount,
#     (SELECT SUM(tmp.amount) FROM temp_transfers tmp WHERE tmp.payer_id = payer_id OR tmp.payee_id = payee_id AND tmp.created_at <= created_at)  as balance_until_now,
#     idempotency_key,
#     CASE
#       WHEN balance_until_now >= amount THEN 'completed'
#       WHEN balance_until_now < amount THEN 'failed'
#     END AS status,
#     CASE
#       WHEN status = 'failed' THEN 'insufficient_funds'
#     ELSE NULL
#     END AS failure_reason,
#     created_at,
#     NOW() as processed_at
#   FROM temp_transfers
# ")

class Accounts
  include DB::Serializable
  include JSON::Serializable
  property id : String
  property balance : Int64
  property updated_at : Time?
  property created_at : Time?
  @[DB::Field(ignore: true)]
  property transfers : Array(Transfers) | Nil
  @[DB::Field(ignore: true)]
  property accountId : String?
end
class Transfers
  include DB::Serializable
  include JSON::Serializable
  property id : UUID?
  @[JSON::Field(key: "payerId")]
  property payer_id : String
  @[JSON::Field(key: "payeeId")]
  property payee_id : String
  @[JSON::Field(key: "idempotencyKey")]
  property idempotency_key : String
  property amount : Int64
  property created_at : Time?
  property processed_at : Time?
  property status : String?
  @[JSON::Field(key: "failureReason")]
  property failure_reason : String?
end
get "/health" do |env|
  DB_CONNECTION.scalar("SELECT 1").as(Int32)
  env.json({ status: "ok" })
end

get "/accounts" do |env|
  account = Accounts.from_rs(DB_CONNECTION.query("SELECT id, balance FROM accounts"))
  env.json(account)
end

post "/accounts" do |env|
  begin
    acct = Accounts.from_json(env.request.body.not_nil!)
    if acct.id.empty?
      env.response.status_code = 422
      next
    end
    if acct.balance < 0
      env.response.status_code = 422
      next
    end
    DB_CONNECTION.exec("INSERT INTO accounts(id, balance) VALUES($1, $2)", acct.id, acct.balance)
    env.response.status_code = 201
  rescue e: PQ::PQError
    if e.message.to_s.not_nil!.includes?("duplicate key")
      env.response.status_code = 409
      next
    end
    env.response.status_code = 500
  rescue e : JSON::SerializableError
    env.response.status_code = 422
  end
end

post "/transfers" do |env|
  begin
    # BloomFilter
    t = Transfers.from_json(env.request.body.not_nil!)
    time = Time.utc
    id = UUID.random
    DB_CONNECTION.exec("INSERT INTO temp_transfers(id, payer_id, payee_id, amount, idempotency_key, created_at) VALUES($1, $2, $3, $4, $5, $6)", id, t.payer_id, t.payee_id, t.amount, t.idempotency_key, time)
    # AMQPClient.publish(env.request.body.not_nil!)
    t.created_at = time
    t.status = "pending"
    t.id = id
    t.failure_reason = nil
    # MUTEX.write do
    #   ENTRIES << t
    # end
    # AMQPClient.publish(IO::Memory.new(t.to_json))
    env.response.status_code = 201
    env.json(t)
  rescue e : JSON::SerializableError
    env.response.status_code = 422
  end
end

get "/transfers/:id" do |env|
  t = Transfers.from_rs(DB_CONNECTION.query("SELECT * FROM temp_transfers WHERE id = $1", env.params.url["id"])).first?
  env.response.status_code = 200
  if t
    env.json(t)
    next
  end
  env.response.status_code = 404
end

get "/accounts/:id/statement" do |env|
  id = env.params.url["id"]
  acct = Accounts.from_rs(DB_CONNECTION.query("SELECT * FROM accounts WHERE id = $1", id)).first?
  env.response.status_code = 404
  if acct.nil?
    next
  end
  env.response.status_code = 200
  transfers = Transfers.from_rs(DB_CONNECTION.query("SELECT * FROM temp_transfers WHERE payer_id = $1 OR payee_id = $1", id))
  acct.transfers = transfers
  acct.accountId = id
  env.json(acct)
end

error 404 do
  ""
end

Kemal.run(ENV.fetch("PORT", 8080).to_i)
