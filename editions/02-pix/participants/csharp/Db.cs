namespace app;

public static class Db
{
    public static NpgsqlDataSource CreateDataSource()
    {
        var builder = new NpgsqlConnectionStringBuilder(BuildConnectionString())
        {
            MaxPoolSize = EnvInt("DB_MAX_POOL", 40),
            MinPoolSize = EnvInt("DB_MIN_POOL", 8),

            Multiplexing = EnvBool("DB_MULTIPLEXING", true),
            NoResetOnClose = true,
        };

        return NpgsqlDataSource.Create(builder);
    }

    public static string BuildConnectionString()
    {
        var url = Environment.GetEnvironmentVariable("DATABASE_URL") ?? 
                  "postgres://rinha:rinha@localhost:5432/rinha?sslmode=disable";

        var uri = new Uri(url);
        var userInfo = uri.UserInfo.Split(':', 2);

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "",
            Database = uri.AbsolutePath.TrimStart('/'),
            SslMode = SslMode.Disable,
        };

        return builder.ConnectionString;
    }

    public static async Task EnsureReadyAsync(NpgsqlDataSource db)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await using var conn = await db.OpenConnectionAsync();
                await using var cmd = new NpgsqlCommand("SELECT 1 FROM accounts LIMIT 0", conn);
                await cmd.ExecuteScalarAsync();
                Console.WriteLine("[db] pronto");

                return;
            }
            catch (Exception ex) when (attempt < 60)
            {
                Console.WriteLine($"[db] aguardando ({attempt}): {ex.Message}");
                await Task.Delay(500);
            }
        }
    }

    private static int EnvInt(string name, int fallback)
    {
        return int.TryParse(Environment.GetEnvironmentVariable(name), out var v) ? v : fallback;
    }

    private static bool EnvBool(string name, bool fallback)
    {
        return bool.TryParse(Environment.GetEnvironmentVariable(name), out var v) ? v : fallback;
    }
}
