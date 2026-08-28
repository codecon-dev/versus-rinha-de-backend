use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool};
use std::net::SocketAddr;
use std::time::Duration;
use uuid::Uuid;

const WORKER_COUNT: usize = 12;
const IDLE_POLL: Duration = Duration::from_millis(20);

#[derive(Clone)]
struct AppState {
    pool: PgPool,
}

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(30)
        .connect(&database_url)
        .await
        .expect("failed to connect to postgres");

    for _ in 0..WORKER_COUNT {
        let pool = pool.clone();
        tokio::spawn(async move { settlement_worker(pool).await });
    }

    let state = AppState { pool };

    let app = Router::new()
        .route("/health", get(health))
        .route("/accounts", post(create_account))
        .route("/accounts/{id}/statement", get(statement))
        .route("/transfers", post(create_transfer))
        .route("/transfers/{id}", get(get_transfer))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// modelos

#[derive(FromRow)]
struct TransferRow {
    id: Uuid,
    payer_id: String,
    payee_id: String,
    amount: i64,
    idempotency_key: Option<String>,
    status: String,
    failure_reason: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct TransferResponse {
    id: Uuid,
    #[serde(rename = "payerId")]
    payer_id: String,
    #[serde(rename = "payeeId")]
    payee_id: String,
    amount: i64,
    #[serde(rename = "idempotencyKey")]
    idempotency_key: Option<String>,
    status: String,
    #[serde(rename = "failureReason")]
    failure_reason: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: DateTime<Utc>,
}

impl From<TransferRow> for TransferResponse {
    fn from(r: TransferRow) -> Self {
        TransferResponse {
            id: r.id,
            payer_id: r.payer_id,
            payee_id: r.payee_id,
            amount: r.amount,
            idempotency_key: r.idempotency_key,
            status: r.status,
            failure_reason: r.failure_reason,
            created_at: r.created_at,
        }
    }
}

// erros

enum AppError {
    Unprocessable,
    Conflict,
    NotFound,
    Internal,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AppError::Unprocessable => (StatusCode::UNPROCESSABLE_ENTITY, "invalid payload"),
            AppError::Conflict => (StatusCode::CONFLICT, "account already exists"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            AppError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("db error: {e}");
        AppError::Internal
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}

// ---------- handlers ----------

async fn health() -> Json<Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn create_account(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Unprocessable)?;
    let balance = body
        .get("balance")
        .and_then(Value::as_i64)
        .ok_or(AppError::Unprocessable)?;
    if balance < 0 {
        return Err(AppError::Unprocessable);
    }

    let result = sqlx::query("INSERT INTO accounts (id, balance) VALUES ($1, $2)")
        .bind(id)
        .bind(balance)
        .execute(&state.pool)
        .await;

    match result {
        Ok(_) => Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": id, "balance": balance })))),
        Err(e) if is_unique_violation(&e) => Err(AppError::Conflict),
        Err(e) => Err(e.into()),
    }
}

async fn create_transfer(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<TransferResponse>), AppError> {
    let payer_id = body
        .get("payerId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Unprocessable)?;
    let payee_id = body
        .get("payeeId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Unprocessable)?;
    let amount = body
        .get("amount")
        .and_then(Value::as_i64)
        .ok_or(AppError::Unprocessable)?;
    let idempotency_key = body
        .get("idempotencyKey")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Unprocessable)?;

    if amount <= 0 || payer_id == payee_id {
        return Err(AppError::Unprocessable);
    }

    let known: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM accounts WHERE id IN ($1, $2)")
        .bind(payer_id)
        .bind(payee_id)
        .fetch_one(&state.pool)
        .await?;
    if known < 2 {
        return Err(AppError::Unprocessable);
    }

    let inserted = sqlx::query_as::<_, TransferRow>(
        "INSERT INTO transfers (payer_id, payee_id, amount, idempotency_key) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING *",
    )
    .bind(payer_id)
    .bind(payee_id)
    .bind(amount)
    .bind(idempotency_key)
    .fetch_optional(&state.pool)
    .await?;

    match inserted {
        Some(row) => Ok((StatusCode::CREATED, Json(row.into()))),
        None => {
            let existing = sqlx::query_as::<_, TransferRow>("SELECT * FROM transfers WHERE idempotency_key = $1")
                .bind(idempotency_key)
                .fetch_one(&state.pool)
                .await?;
            Ok((StatusCode::OK, Json(existing.into())))
        }
    }
}

async fn get_transfer(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TransferResponse>, AppError> {
    let row = sqlx::query_as::<_, TransferRow>("SELECT * FROM transfers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}

async fn statement(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, AppError> {
    let balance: Option<i64> = sqlx::query_scalar("SELECT balance FROM accounts WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    let balance = balance.ok_or(AppError::NotFound)?;

    let transfers = sqlx::query_as::<_, TransferRow>(
        "SELECT * FROM transfers WHERE (payer_id = $1 OR payee_id = $1) AND status = 'completed' \
         ORDER BY created_at DESC",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let transfers: Vec<TransferResponse> = transfers.into_iter().map(Into::into).collect();
    Ok(Json(serde_json::json!({
        "accountId": id,
        "balance": balance,
        "transfers": transfers,
    })))
}

// worker

// ordem global fixa, skip locked e em cadeias circulares não ocorre o problema de deadlock
async fn settle_one(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let claimed = sqlx::query_as::<_, (Uuid, String, String, i64)>(
        "SELECT id, payer_id, payee_id, amount FROM transfers \
         WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some((transfer_id, payer_id, payee_id, amount)) = claimed else {
        tx.rollback().await.ok();
        return Ok(false);
    };

    let (first, second) = if payer_id <= payee_id {
        (payer_id.clone(), payee_id.clone())
    } else {
        (payee_id.clone(), payer_id.clone())
    };
    let first_balance: i64 = sqlx::query_scalar("SELECT balance FROM accounts WHERE id = $1 FOR NO KEY UPDATE")
        .bind(&first)
        .fetch_one(&mut *tx)
        .await?;
    let second_balance: i64 = sqlx::query_scalar("SELECT balance FROM accounts WHERE id = $1 FOR NO KEY UPDATE")
        .bind(&second)
        .fetch_one(&mut *tx)
        .await?;
    let payer_balance = if payer_id == first { first_balance } else { second_balance };

    if payer_balance >= amount {
        sqlx::query("UPDATE accounts SET balance = balance - $1, updated_at = now() WHERE id = $2")
            .bind(amount)
            .bind(&payer_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE accounts SET balance = balance + $1, updated_at = now() WHERE id = $2")
            .bind(amount)
            .bind(&payee_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE transfers SET status = 'completed', processed_at = now() WHERE id = $1")
            .bind(transfer_id)
            .execute(&mut *tx)
            .await?;
    } else {
        sqlx::query(
            "UPDATE transfers SET status = 'failed', failure_reason = 'insufficient_funds', processed_at = now() \
             WHERE id = $1",
        )
        .bind(transfer_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(true)
}

async fn settlement_worker(pool: PgPool) {
    loop {
        match settle_one(&pool).await {
            Ok(true) => continue,
            Ok(false) => tokio::time::sleep(IDLE_POLL).await,
            Err(e) => {
                eprintln!("settlement error: {e}");
                tokio::time::sleep(IDLE_POLL).await;
            }
        }
    }
}
