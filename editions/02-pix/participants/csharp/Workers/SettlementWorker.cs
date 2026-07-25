namespace app.Workers;


public sealed class SettlementWorker : BackgroundService
{
    private readonly NpgsqlDataSource _db;
    private readonly int _concurrency;
    private readonly int _idleDelayMs;

    public SettlementWorker(NpgsqlDataSource db)
    {
        _db = db;
        _concurrency = EnvToInt("WORKER_CONCURRENCY", 4);
        _idleDelayMs = EnvToInt("WORKER_IDLE_MS", 25);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = new Task[_concurrency];

        for (var i = 0; i < _concurrency; i++)
            workers[i] = Task.Run(() => LoopAsync(stoppingToken), stoppingToken);

        await Task.WhenAll(workers);
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var settledOne = await ProcessOneAsync(ct);

                if (!settledOne)
                    await Task.Delay(_idleDelayMs, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[worker] {ex.Message}");
                await Task.Delay(100, ct);
            }
        }
    }

    private async Task<bool> ProcessOneAsync(CancellationToken ct)
    {
        await using var conn = await _db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        Guid id;
        string payer, payee;
        long amount;

        await using (var claim = new NpgsqlCommand(
            "SELECT id, payer_id, payee_id, amount FROM transfers " +
            "WHERE status = 'pending' ORDER BY created_at " +
            "FOR UPDATE SKIP LOCKED LIMIT 1", conn, tx)
        )
        await using (var reader = await claim.ExecuteReaderAsync(ct))
        {
            if (!await reader.ReadAsync(ct))
            {
                await tx.RollbackAsync(ct);
                return false;
            }

            id = reader.GetGuid(0);
            payer = reader.GetString(1);
            payee = reader.GetString(2);
            amount = reader.GetInt64(3);
        }

        long payerBalance = 0;

        var query = "SELECT id, balance FROM accounts WHERE id = ANY(@ids) ORDER BY id FOR NO KEY UPDATE";

        await using (var locking = new NpgsqlCommand(query, conn, tx))
        {
            locking.Parameters.AddWithValue("ids", new[] { payer, payee });

            await using var reader = await locking.ExecuteReaderAsync(ct);

            while (await reader.ReadAsync(ct))
            {
                if (reader.GetString(0) == payer)
                    payerBalance = reader.GetInt64(1);
            }
        }

        if (payerBalance >= amount)
        {
            await using var settle = new NpgsqlCommand(
                "UPDATE accounts SET balance = balance - @amount, updated_at = now() WHERE id = @payer;" +
                "UPDATE accounts SET balance = balance + @amount, updated_at = now() WHERE id = @payee;" +
                "UPDATE transfers SET status = 'completed', processed_at = now() WHERE id = @id;",
                conn, 
                tx
            );

            settle.Parameters.AddWithValue("amount", amount);
            settle.Parameters.AddWithValue("payer", payer);
            settle.Parameters.AddWithValue("payee", payee);
            settle.Parameters.AddWithValue("id", id);

            await settle.ExecuteNonQueryAsync(ct);
        }
        else
        {
            await using var fail = new NpgsqlCommand(
                "UPDATE transfers SET status = 'failed', failure_reason = 'insufficient_funds', " +
                "processed_at = now() WHERE id = @id", 
                conn, 
                tx
            );

            fail.Parameters.AddWithValue("id", id);

            await fail.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);

        return true;
    }

    private static int EnvToInt(string name, int fallback)
    {
        return int.TryParse(Environment.GetEnvironmentVariable(name), out var v) ? v : fallback;
    }
}
