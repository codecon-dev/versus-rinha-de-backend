namespace app.Endpoints;

public static class TransferEndpoints
{
    private const string Columns = "id, payer_id, payee_id, amount, idempotency_key, status, failure_reason, created_at";

    public static void MapTransferEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/transfers", CreateAsync);
        app.MapGet("/transfers/{id}", GetAsync);
    }

    private static async Task<IResult> CreateAsync(JsonElement body, NpgsqlDataSource db)
    {
        if (!TryGetNonEmptyString(body, "payerId", out var payerId) ||
            !TryGetNonEmptyString(body, "payeeId", out var payeeId) ||
            !TryGetNonEmptyString(body, "idempotencyKey", out var idempotencyKey)
        )
            return Results.UnprocessableEntity();

        if (!body.TryGetProperty("amount", out var amountEl) || amountEl.ValueKind != JsonValueKind.Number)
            return Results.UnprocessableEntity();

        if (!amountEl.TryGetInt64(out var amount) || amount <= 0)
            return Results.UnprocessableEntity();

        if (payerId == payeeId)
            return Results.UnprocessableEntity();

        await using (var insert = db.CreateCommand(
            "INSERT INTO transfers (payer_id, payee_id, amount, idempotency_key) " +
            "SELECT @payer, @payee, @amount, @key " +
            "WHERE EXISTS (SELECT 1 FROM accounts WHERE id = @payer) " +
            "  AND EXISTS (SELECT 1 FROM accounts WHERE id = @payee) " +
            "ON CONFLICT (idempotency_key) DO NOTHING " +
            $"RETURNING {Columns}")
        )
        {
            insert.Parameters.AddWithValue("payer", payerId);
            insert.Parameters.AddWithValue("payee", payeeId);
            insert.Parameters.AddWithValue("amount", amount);
            insert.Parameters.AddWithValue("key", idempotencyKey);

            await using var reader = await insert.ExecuteReaderAsync();

            if (await reader.ReadAsync())
                return Results.Json(TransferMapper.Read(reader), statusCode: StatusCodes.Status201Created);
        }

        await using (var existing = db.CreateCommand($"SELECT {Columns} FROM transfers WHERE idempotency_key = @key"))
        {
            existing.Parameters.AddWithValue("key", idempotencyKey);

            await using var reader = await existing.ExecuteReaderAsync();

            if (await reader.ReadAsync())
                return Results.Json(TransferMapper.Read(reader), statusCode: StatusCodes.Status200OK);
        }

        return Results.UnprocessableEntity();
    }

    private static async Task<IResult> GetAsync(string id, NpgsqlDataSource db)
    {
        if (!Guid.TryParse(id, out var guid))
            return Results.NotFound();

        await using var cmd = db.CreateCommand($"SELECT {Columns} FROM transfers WHERE id = @id");

        cmd.Parameters.AddWithValue("id", guid);

        await using var reader = await cmd.ExecuteReaderAsync();

        if (await reader.ReadAsync())
            return Results.Json(TransferMapper.Read(reader));

        return Results.NotFound();
    }

    private static bool TryGetNonEmptyString(JsonElement body, string name, out string value)
    {
        value = "";

        if (!body.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.String)
            return false;

        var s = el.GetString();
        if (string.IsNullOrEmpty(s))
            return false;

        value = s;

        return true;
    }
}

public static class TransferMapper
{
    public static TransferResponse Read(NpgsqlDataReader r) => new(
        r.GetGuid(0).ToString(),
        r.GetString(1),
        r.GetString(2),
        r.GetInt64(3),
        r.IsDBNull(4) ? null : r.GetString(4),
        r.GetString(5),
        r.IsDBNull(6) ? null : r.GetString(6),
        r.GetDateTime(7)
    );
}
