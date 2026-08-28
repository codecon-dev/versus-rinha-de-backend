use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use image::ImageEncoder;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool};
use std::net::SocketAddr;
use uuid::Uuid;

const SHORT_BASE: &str = "http://localhost:3000";
const CODE_LEN: usize = 8;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
}

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .expect("failed to connect to postgres");

    let state = AppState { pool };

    let app = Router::new()
        .route("/health", get(health))
        .route("/urls", post(create_url).get(list_urls))
        .route(
            "/urls/{id}",
            get(get_url).patch(patch_url).delete(delete_url),
        )
        .route("/urls/{id}/stats", get(stats))
        .route("/urls/{id}/qr", get(qr))
        .route("/{code}", get(redirect))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// modelos

#[derive(FromRow)]
struct UrlRow {
    id: Uuid,
    code: String,
    url: String,
    expires_at: Option<DateTime<Utc>>,
    click_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct UrlResponse {
    id: Uuid,
    code: String,
    url: String,
    short_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    click_count: i64,
}

impl From<UrlRow> for UrlResponse {
    fn from(r: UrlRow) -> Self {
        UrlResponse {
            short_url: format!("{SHORT_BASE}/{}", r.code),
            id: r.id,
            code: r.code,
            url: r.url,
            expires_at: r.expires_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            click_count: r.click_count,
        }
    }
}

#[derive(Deserialize)]
struct CreateUrlRequest {
    url: String,
    custom_code: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct PatchUrlRequest {
    url: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct ListQuery {
    page: Option<i64>,
    per_page: Option<i64>,
}

// erros

enum AppError {
    BadRequest(&'static str),
    NotFound,
    Conflict,
    Gone,
    Internal,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            AppError::Conflict => (StatusCode::CONFLICT, "custom_code already exists"),
            AppError::Gone => (StatusCode::GONE, "url expired"),
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

// handlers

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

fn validate_url(url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url).map_err(|_| AppError::BadRequest("invalid url"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(AppError::BadRequest("invalid url"));
    }
    Ok(())
}

fn validate_custom_code(code: &str) -> Result<(), AppError> {
    if code.is_empty() || code.len() > 16 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("invalid custom_code"));
    }
    Ok(())
}

fn validate_expires_at(expires_at: DateTime<Utc>) -> Result<(), AppError> {
    if expires_at <= Utc::now() {
        return Err(AppError::BadRequest("expires_at must be in the future"));
    }
    Ok(())
}

fn generate_code() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(CODE_LEN)
        .map(char::from)
        .collect()
}

async fn create_url(
    State(state): State<AppState>,
    Json(body): Json<CreateUrlRequest>,
) -> Result<(StatusCode, Json<UrlResponse>), AppError> {
    validate_url(&body.url)?;
    if let Some(cc) = &body.custom_code {
        validate_custom_code(cc)?;
    }
    if let Some(exp) = body.expires_at {
        validate_expires_at(exp)?;
    }

    let mut tx = state.pool.begin().await?;

    // indepotencia e granularidade
    if let Some(custom_code) = &body.custom_code {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext('code:' || $1))")
            .bind(custom_code)
            .execute(&mut *tx)
            .await?;

        let code_taken: Option<i32> = sqlx::query_scalar("SELECT 1 FROM urls WHERE code = $1")
            .bind(custom_code)
            .fetch_optional(&mut *tx)
            .await?;
        if code_taken.is_some() {
            return Err(AppError::Conflict);
        }
    } else {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
            .bind(&body.url)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(existing) = sqlx::query_as::<_, UrlRow>(
        "SELECT * FROM urls WHERE url = $1 AND (expires_at IS NULL OR expires_at > now()) LIMIT 1",
    )
    .bind(&body.url)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(existing.into())));
    }

    let code = body.custom_code.clone().unwrap_or_else(generate_code);
    let row = match sqlx::query_as::<_, UrlRow>(
        "INSERT INTO urls (code, url, expires_at) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&code)
    .bind(&body.url)
    .bind(body.expires_at)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) if is_unique_violation(&e) => return Err(AppError::Conflict),
        Err(e) => return Err(e.into()),
    };

    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

async fn get_url(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<UrlResponse>, AppError> {
    let row = sqlx::query_as::<_, UrlRow>("SELECT * FROM urls WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row.into()))
}

async fn patch_url(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchUrlRequest>,
) -> Result<Json<UrlResponse>, AppError> {
    if let Some(url) = &body.url {
        validate_url(url)?;
    }
    if let Some(exp) = body.expires_at {
        validate_expires_at(exp)?;
    }

    let row = sqlx::query_as::<_, UrlRow>(
        "UPDATE urls SET url = COALESCE($1, url), expires_at = COALESCE($2, expires_at), updated_at = now() \
         WHERE id = $3 RETURNING *",
    )
    .bind(body.url)
    .bind(body.expires_at)
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row.into()))
}

async fn delete_url(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<StatusCode, AppError> {
    let result = sqlx::query("DELETE FROM urls WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_urls(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let page = q.page.unwrap_or(1).max(1);
    let per_page = q.per_page.unwrap_or(10).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM urls")
        .fetch_one(&state.pool)
        .await?;

    let rows = sqlx::query_as::<_, UrlRow>(
        "SELECT * FROM urls ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(per_page)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let data: Vec<UrlResponse> = rows.into_iter().map(Into::into).collect();
    Ok(Json(serde_json::json!({
        "data": data,
        "meta": { "page": page, "per_page": per_page, "total": total }
    })))
}

async fn redirect(State(state): State<AppState>, Path(code): Path<String>) -> Result<Response, AppError> {
    let mut tx = state.pool.begin().await?;

    let updated: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE urls SET click_count = click_count + 1 \
         WHERE code = $1 AND (expires_at IS NULL OR expires_at > now()) \
         RETURNING id, url",
    )
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((url_id, url)) = updated else {
        tx.rollback().await.ok();
        let exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM urls WHERE code = $1")
            .bind(&code)
            .fetch_optional(&state.pool)
            .await?;
        return Err(if exists.is_some() { AppError::Gone } else { AppError::NotFound });
    };

    sqlx::query("INSERT INTO clicks (url_id) VALUES ($1)")
        .bind(url_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Response::builder()
        .status(StatusCode::MOVED_PERMANENTLY)
        .header("Location", url)
        .body(Body::empty())
        .unwrap())
}

async fn stats(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query_as::<_, UrlRow>("SELECT * FROM urls WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;

    let per_day: Vec<(String, i64)> = sqlx::query_as(
        "SELECT to_char((clicked_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date, COUNT(*) \
         FROM clicks WHERE url_id = $1 GROUP BY date ORDER BY date DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    let per_hour: Vec<(String, i64)> = sqlx::query_as(
        "SELECT to_char(date_trunc('hour', clicked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"') AS hour, COUNT(*) \
         FROM clicks WHERE url_id = $1 GROUP BY hour ORDER BY hour DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "id": row.id,
        "code": row.code,
        "url": row.url,
        "click_count": row.click_count,
        "clicks_per_day": per_day.into_iter().map(|(date, count)| serde_json::json!({"date": date, "count": count})).collect::<Vec<_>>(),
        "clicks_per_hour": per_hour.into_iter().map(|(hour, count)| serde_json::json!({"hour": hour, "count": count})).collect::<Vec<_>>(),
    })))
}

async fn qr(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<serde_json::Value>, AppError> {
    let code: Option<String> = sqlx::query_scalar("SELECT code FROM urls WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let code = code.ok_or(AppError::NotFound)?;

    let short_url = format!("{SHORT_BASE}/{code}");
    let qr_code = qrcode::QrCode::new(short_url.as_bytes()).map_err(|_| AppError::Internal)?;
    let image = qr_code.render::<image::Luma<u8>>().build();

    let mut png_bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png_bytes)
        .write_image(image.as_raw(), image.width(), image.height(), image::ExtendedColorType::L8)
        .map_err(|_| AppError::Internal)?;

    Ok(Json(serde_json::json!({ "qr_code": BASE64.encode(png_bytes) })))
}
