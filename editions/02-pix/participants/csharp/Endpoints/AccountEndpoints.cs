namespace app.Endpoints;

public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/accounts", CreateAsync);
        app.MapGet("/accounts/{id}/statement", StatementAsync);
    }

    private static async Task<IResult> CreateAsync(JsonElement body, NpgsqlDataSource db)
    {
        if (!body.TryGetProperty("id", out var idEl) || idEl.ValueKind != JsonValueKind.String)
            return Results.UnprocessableEntity();

        var id = idEl.GetString();

        if (string.IsNullOrEmpty(id))
            return Results.UnprocessableEntity();

        if (!body.TryGetProperty("balance", out var balanceElement) || balanceElement.ValueKind != JsonValueKind.Number)
            return Results.UnprocessableEntity();

        if (!balanceElement.TryGetInt64(out var balance) || balance < 0)
            return Results.UnprocessableEntity();

        await using var command = db.CreateCommand(
            "INSERT INTO accounts (id, balance) VALUES (@id, @balance) " +
            "ON CONFLICT (id) DO NOTHING RETURNING id"
        );

        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("balance", balance);

        var inserted = await command.ExecuteScalarAsync();

        if (inserted is null)
            return Results.Conflict();

        return Results.Json(new AccountResponse(id, balance), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> StatementAsync(string id, NpgsqlDataSource db)
    {
        long balance;
        await using (var balanceCommand = db.CreateCommand("SELECT balance FROM accounts WHERE id = @id"))
        {
            balanceCommand.Parameters.AddWithValue("id", id);
            var result = await balanceCommand.ExecuteScalarAsync();

            if (result is null)
                return Results.NotFound();

            balance = (long)result;
        }

        var transfers = new List<TransferResponse>();

        await using (
            var cmd = db.CreateCommand(
                "SELECT id, payer_id, payee_id, amount, idempotency_key, status, failure_reason, created_at " +
                "FROM transfers WHERE status = 'completed' AND (payer_id = @id OR payee_id = @id) " +
                "ORDER BY created_at DESC"
            )
        )
        {
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync();

            while (await reader.ReadAsync())
                transfers.Add(TransferMapper.Read(reader));
        }

        return Results.Json(new StatementResponse(id, balance, transfers));
    }
}
