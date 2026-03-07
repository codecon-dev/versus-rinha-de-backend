package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/gorilla/mux"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/skip2/go-qrcode"
)

var (
	dbPool   *pgxpool.Pool
	validate = validator.New(validator.WithRequiredStructEnabled())
)

func initDB(ctx context.Context) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://rinha:rinha@localhost:5432/rinha?sslmode=disable"
	}

	var err error
	dbPool, err = pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
}

type Url struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	URL        string  `json:"url"`
	ShortURL   string  `json:"short_url"`
	ExpiresAt  *string `json:"expires_at"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
	ClickCount int64   `json:"click_count"`
}

type ClickPerDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type ClickPerHour struct {
	Hour  string `json:"hour"`
	Count int    `json:"count"`
}

type UrlStats struct {
	ID            string         `json:"id"`
	Code          string         `json:"code"`
	URL           string         `json:"url"`
	ClickCount    int64          `json:"click_count"`
	ClicksPerDay  []ClickPerDay  `json:"clicks_per_day"`
	ClicksPerHour []ClickPerHour `json:"clicks_per_hour"`
}

type CreateUrlRequest struct {
	URL        string `json:"url"         validate:"required,url"`
	CustomCode string `json:"custom_code" validate:"omitempty,max=16"`
	ExpiresAt  string `json:"expires_at"`
}

type UpdateUrlRequest struct {
	URL       string `json:"url"       validate:"omitempty,url"`
	ExpiresAt string `json:"expires_at"`
}

type ListUrlsResponseMeta struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
	Total   int `json:"total"`
}

type ListUrlsResponse struct {
	Data []Url                `json:"data"`
	Meta ListUrlsResponseMeta `json:"meta"`
}

type QRCodeResponse struct {
	QRCode string `json:"qr_code"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateRandomCode(length int) string {
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		b[i] = charset[n.Int64()]
	}
	return string(b)
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, ErrorResponse{Message: msg})
}

func isDuplicateKeyError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func parseExpiresAt(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse expires_at: %q", s)
}

type Scanner interface {
	Scan(dest ...any) error
}

func scanUrl(s Scanner) (Url, error) {
	var u Url
	var expiresAt *time.Time
	var createdAt, updatedAt time.Time

	err := s.Scan(&u.ID, &u.Code, &u.URL, &expiresAt, &createdAt, &updatedAt, &u.ClickCount)
	if err != nil {
		return Url{}, err
	}
	u.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	u.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	if expiresAt != nil {
		exp := expiresAt.UTC().Format(time.RFC3339Nano)
		u.ExpiresAt = &exp
	}
	u.ShortURL = fmt.Sprintf("http://localhost:3000/%s", u.Code)
	return u, nil
}

const selectUrlFields = `SELECT id, code, url, expires_at, created_at, updated_at, click_count FROM urls`

func getByID(ctx context.Context, id string) (Url, error) {
	return scanUrl(dbPool.QueryRow(ctx, selectUrlFields+` WHERE id = $1`, id))
}

func getByCode(ctx context.Context, code string) (Url, error) {
	return scanUrl(dbPool.QueryRow(ctx, selectUrlFields+` WHERE code = $1`, code))
}

func createUrlHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateUrlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := validate.Struct(req); err != nil {
		jsonError(w, http.StatusBadRequest, "Validation failed: "+err.Error())
		return
	}
	if req.ExpiresAt != "" {
		t, err := parseExpiresAt(req.ExpiresAt)
		if err != nil {
			jsonError(w, http.StatusBadRequest, "Invalid expires_at format")
			return
		}
		if t.Before(time.Now()) {
			jsonError(w, http.StatusBadRequest, "expires_at must be in the future")
			return
		}
	}

	ctx := r.Context()

	if req.CustomCode != "" {
		tx, txErr := dbPool.Begin(ctx)
		if txErr != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to start transaction")
			return
		}
		defer tx.Rollback(ctx)

		if _, lockErr := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('code:'||$1))`, req.CustomCode); lockErr != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to acquire advisory lock")
			return
		}

		var existingCodeID string
		if scanErr := tx.QueryRow(ctx, `SELECT id FROM urls WHERE code = $1`, req.CustomCode).Scan(&existingCodeID); scanErr == nil {
			jsonError(w, http.StatusConflict, "Code already in use")
			return
		}

		var existingID string
		if scanErr := tx.QueryRow(ctx, `SELECT id FROM urls WHERE url = $1`, req.URL).Scan(&existingID); scanErr == nil {
			if u, uErr := scanUrl(tx.QueryRow(ctx, selectUrlFields+` WHERE id = $1`, existingID)); uErr == nil {
				tx.Commit(ctx)
				jsonResponse(w, http.StatusOK, u)
				return
			}
		}

		u, insertErr := insertURLInTx(ctx, tx, req.CustomCode, req.URL, req.ExpiresAt)
		if insertErr != nil {
			if isDuplicateKeyError(insertErr) {
				jsonError(w, http.StatusConflict, "Code already in use")
				return
			}
			log.Printf("Failed to insert URL: %v", insertErr)
			jsonError(w, http.StatusInternalServerError, "Failed to create URL")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to commit transaction")
			return
		}
		jsonResponse(w, http.StatusCreated, u)
		return
	}

	tx, err := dbPool.Begin(ctx)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to start transaction")
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, req.URL); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to acquire advisory lock")
		return
	}

	var existingID string
	if scanErr := tx.QueryRow(ctx, `SELECT id FROM urls WHERE url = $1`, req.URL).Scan(&existingID); scanErr == nil {
		u, uErr := scanUrl(tx.QueryRow(ctx, selectUrlFields+` WHERE id = $1`, existingID))
		if uErr == nil {
			tx.Commit(ctx)
			jsonResponse(w, http.StatusOK, u)
			return
		}
	}

	code := generateRandomCode(8)
	u, err := insertURLInTx(ctx, tx, code, req.URL, req.ExpiresAt)
	if err != nil {
		if isDuplicateKeyError(err) {
			jsonError(w, http.StatusConflict, "Code collision, please retry")
			return
		}
		log.Printf("Failed to insert URL: %v", err)
		jsonError(w, http.StatusInternalServerError, "Failed to create URL")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to commit transaction")
		return
	}
	jsonResponse(w, http.StatusCreated, u)
}

func insertURL(ctx context.Context, code, url, expiresAt string) (Url, error) {
	if expiresAt != "" {
		return scanUrl(dbPool.QueryRow(ctx,
			`INSERT INTO urls (code, url, expires_at)
			 VALUES ($1, $2, $3)
			 RETURNING id, code, url, expires_at, created_at, updated_at, click_count`,
			code, url, expiresAt))
	}
	return scanUrl(dbPool.QueryRow(ctx,
		`INSERT INTO urls (code, url)
		 VALUES ($1, $2)
		 RETURNING id, code, url, expires_at, created_at, updated_at, click_count`,
		code, url))
}

func insertURLInTx(ctx context.Context, tx pgx.Tx, code, url, expiresAt string) (Url, error) {
	if expiresAt != "" {
		return scanUrl(tx.QueryRow(ctx,
			`INSERT INTO urls (code, url, expires_at)
			 VALUES ($1, $2, $3)
			 RETURNING id, code, url, expires_at, created_at, updated_at, click_count`,
			code, url, expiresAt))
	}
	return scanUrl(tx.QueryRow(ctx,
		`INSERT INTO urls (code, url)
		 VALUES ($1, $2)
		 RETURNING id, code, url, expires_at, created_at, updated_at, click_count`,
		code, url))
}

func getUrlByIdHandler(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	u, err := getByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, http.StatusNotFound, "URL not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, "Failed to get URL")
		return
	}
	jsonResponse(w, http.StatusOK, u)
}

func updateUrlHandler(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var req UpdateUrlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := validate.Struct(req); err != nil {
		jsonError(w, http.StatusBadRequest, "Validation failed: "+err.Error())
		return
	}
	if req.ExpiresAt != "" {
		t, err := parseExpiresAt(req.ExpiresAt)
		if err != nil {
			jsonError(w, http.StatusBadRequest, "Invalid expires_at format")
			return
		}
		if t.Before(time.Now()) {
			jsonError(w, http.StatusBadRequest, "expires_at must be in the future")
			return
		}
	}

	setClauses := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argIdx := 1
	if req.URL != "" {
		setClauses = append([]string{fmt.Sprintf("url = $%d", argIdx)}, setClauses...)
		args = append(args, req.URL)
		argIdx++
	}
	if req.ExpiresAt != "" {
		setClauses = append([]string{fmt.Sprintf("expires_at = $%d", argIdx)}, setClauses...)
		args = append(args, req.ExpiresAt)
		argIdx++
	}
	args = append(args, id)

	query := fmt.Sprintf(
		`UPDATE urls SET %s WHERE id = $%d
		 RETURNING id, code, url, expires_at, created_at, updated_at, click_count`,
		strings.Join(setClauses, ", "), argIdx,
	)

	u, err := scanUrl(dbPool.QueryRow(r.Context(), query, args...))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, http.StatusNotFound, "URL not found")
			return
		}
		log.Printf("Failed to update URL: %v", err)
		jsonError(w, http.StatusInternalServerError, "Failed to update URL")
		return
	}
	jsonResponse(w, http.StatusOK, u)
}

func deleteUrlHandler(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	result, err := dbPool.Exec(r.Context(), `DELETE FROM urls WHERE id = $1`, id)
	if err != nil {
		log.Printf("Failed to delete URL: %v", err)
		jsonError(w, http.StatusInternalServerError, "Failed to delete URL")
		return
	}
	if result.RowsAffected() == 0 {
		jsonError(w, http.StatusNotFound, "URL not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func listUrlsHandler(w http.ResponseWriter, r *http.Request) {
	page, perPage := 1, 10
	fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
	fmt.Sscanf(r.URL.Query().Get("per_page"), "%d", &perPage)
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 10
	}

	ctx := r.Context()
	rows, err := dbPool.Query(ctx,
		selectUrlFields+` ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		perPage, (page-1)*perPage)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to list URLs")
		return
	}
	defer rows.Close()

	urls := []Url{} // never nil → serialises as []
	for rows.Next() {
		u, err := scanUrl(rows)
		if err != nil {
			log.Printf("Failed to scan URL row: %v", err)
			continue
		}
		urls = append(urls, u)
	}

	var total int
	dbPool.QueryRow(ctx, `SELECT COUNT(*) FROM urls`).Scan(&total)

	jsonResponse(w, http.StatusOK, ListUrlsResponse{
		Data: urls,
		Meta: ListUrlsResponseMeta{Page: page, PerPage: perPage, Total: total},
	})
}

func redirectHandler(w http.ResponseWriter, r *http.Request) {
	code := mux.Vars(r)["code"]

	u, err := getByCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if u.ExpiresAt != nil {
		if t, err := parseExpiresAt(*u.ExpiresAt); err == nil && t.Before(time.Now()) {
			w.WriteHeader(http.StatusGone)
			return
		}
	}

	dbPool.Exec(r.Context(),
		`UPDATE urls SET click_count = click_count + 1, updated_at = NOW() WHERE code = $1`, u.Code)
	dbPool.Exec(r.Context(),
		`INSERT INTO clicks (url_id, clicked_at) VALUES ($1, NOW())`, u.ID)

	http.Redirect(w, r, u.URL, http.StatusMovedPermanently)
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	ctx := r.Context()

	u, err := getByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, http.StatusNotFound, "URL not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, "Failed to get URL")
		return
	}

	clicksPerDay := []ClickPerDay{}
	rows, err := dbPool.Query(ctx, `
		SELECT DATE_TRUNC('day', clicked_at)::DATE::TEXT AS day, COUNT(*) AS count
		FROM clicks WHERE url_id = $1
		GROUP BY day ORDER BY day DESC LIMIT 30
	`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var c ClickPerDay
			rows.Scan(&c.Date, &c.Count)
			clicksPerDay = append(clicksPerDay, c)
		}
	}

	clicksPerHour := []ClickPerHour{}
	rows2, err := dbPool.Query(ctx, `
		SELECT DATE_TRUNC('hour', clicked_at)::TEXT AS hour, COUNT(*) AS count
		FROM clicks WHERE url_id = $1
		GROUP BY hour ORDER BY hour DESC LIMIT 24
	`, id)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var c ClickPerHour
			rows2.Scan(&c.Hour, &c.Count)
			clicksPerHour = append(clicksPerHour, c)
		}
	}

	jsonResponse(w, http.StatusOK, UrlStats{
		ID:            u.ID,
		Code:          u.Code,
		URL:           u.URL,
		ClickCount:    u.ClickCount,
		ClicksPerDay:  clicksPerDay,
		ClicksPerHour: clicksPerHour,
	})
}

func qrCodeHandler(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	u, err := getByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, http.StatusNotFound, "URL not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, "Failed to get URL")
		return
	}

	png, err := qrcode.Encode(u.ShortURL, qrcode.Medium, 256)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Failed to generate QR code")
		return
	}
	jsonResponse(w, http.StatusOK, QRCodeResponse{QRCode: base64.StdEncoding.EncodeToString(png)})
}

func main() {
	initDB(context.Background())
	defer dbPool.Close()

	r := mux.NewRouter()
	r.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
	}).Methods(http.MethodGet)

	r.HandleFunc("/urls", createUrlHandler).Methods(http.MethodPost)
	r.HandleFunc("/urls", listUrlsHandler).Methods(http.MethodGet)
	r.HandleFunc("/urls/{id}/stats", statsHandler).Methods(http.MethodGet)
	r.HandleFunc("/urls/{id}/qr", qrCodeHandler).Methods(http.MethodGet)
	r.HandleFunc("/urls/{id}", getUrlByIdHandler).Methods(http.MethodGet)
	r.HandleFunc("/urls/{id}", updateUrlHandler).Methods(http.MethodPatch)
	r.HandleFunc("/urls/{id}", deleteUrlHandler).Methods(http.MethodDelete)
	r.HandleFunc("/{code}", redirectHandler).Methods(http.MethodGet)

	log.Println("Starting server on :3000")
	if err := http.ListenAndServe(":3000", r); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
