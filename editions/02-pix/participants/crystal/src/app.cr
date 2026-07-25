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

workers_ctx.spawn do
    loop do
      MUTEX.write do
        DB_CONNECTION.transaction do |tx|
          conn = tx.connection
          conn.exec("
            WITH picked AS (
              SELECT id, payer_id, payee_id, amount
              FROM temp_transfers
              WHERE status = 'pending'
              ORDER BY created_at, id
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            ),
            debited AS (
              UPDATE accounts a
              SET balance = balance - picked.amount, updated_at = NOW()
              FROM picked
              WHERE a.id = picked.payer_id
                AND a.balance >= picked.amount
              RETURNING picked.id, picked.payee_id, picked.amount
            ),
            credited AS (
              UPDATE accounts a
              SET balance = balance + debited.amount, updated_at = NOW()
              FROM debited
              WHERE a.id = debited.payee_id
              RETURNING debited.id
            )
            UPDATE temp_transfers t
            SET
              status = CASE
                WHEN credited.id IS NOT NULL THEN 'completed'
                ELSE 'failed'
              END,
              failure_reason = CASE
                WHEN credited.id IS NULL THEN 'insufficient_funds'
                ELSE NULL
              END,
              processed_at = NOW()
            FROM picked
            LEFT JOIN credited ON credited.id = picked.id
            WHERE t.id = picked.id
          ")
        end
      end
      sleep 5.milliseconds
    end
end

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
@[JSON::Serializable::Options(emit_nulls: true)]
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
  @[JSON::Field(key: "createdAt")]
  property created_at : Time?
  property processed_at : Time?
  property status : String?
  @[JSON::Field(key: "failureReason")]
  property failure_reason : String?
  property xmax : Bool?
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
    env.json(acct)
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
    t = Transfers.from_json(env.request.body.not_nil!)
    if t.amount <= 0
      env.response.status_code = 422
      next
    end
    if t.payer_id == t.payee_id
      env.response.status_code = 422
      next
    end
    time = Time.utc
    id = UUID.random
    tt = Transfers.from_rs(DB_CONNECTION.query("INSERT INTO temp_transfers(id, payer_id, payee_id, amount, idempotency_key, created_at) VALUES($1, $2, $3, $4, $5, $6) ON CONFLICT(idempotency_key) DO UPDATE SET id = temp_transfers.id RETURNING *, (xmax=0) AS xmax", id, t.payer_id, t.payee_id, t.amount, t.idempotency_key, time)).first?.not_nil!
    t.created_at = time
    t.status = "pending"
    t.failure_reason = nil
    env.response.status_code = tt.xmax ? 201 : 200
    env.json(tt)
  rescue e: PQ::PQError
    puts e.message.to_s
    if e.message.to_s.not_nil!.includes?("violates")
      env.response.status_code = 422
      next
    end
    env.response.status_code = 500
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
  transfers = Transfers.from_rs(DB_CONNECTION.query("SELECT * FROM temp_transfers WHERE (payer_id = $1 OR payee_id = $1) AND status = 'completed'  ORDER BY created_at DESC", id))
  acct.transfers = transfers
  acct.accountId = id
  env.json(acct)
end

error 404 do
  ""
end

Kemal.run(ENV.fetch("PORT", 8080).to_i)
