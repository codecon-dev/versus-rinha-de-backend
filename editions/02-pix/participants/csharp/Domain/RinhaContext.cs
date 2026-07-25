using app.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace app.Domain;

public class RinhaContext : DbContext
{
    public DbSet<Account> Accounts { get; set; }
    public DbSet<Tranfer> Tranfers { get; set; }

    public RinhaContext()
    {
    }

    public RinhaContext(DbContextOptions<RinhaContext> options) : base(options)
    {
    }

    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        if (!options.IsConfigured)
            options.UseNpgsql(BuildConnectionString());
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
            SslMode = SslMode.Disable
        };

        return builder.ConnectionString;
    }
}
