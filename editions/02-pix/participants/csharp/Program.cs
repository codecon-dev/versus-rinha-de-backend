var builder = WebApplication.CreateSlimBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});

builder.WebHost.ConfigureKestrel(serverOptions =>
{
    // IPAddress.Any: dentro do container é preciso ouvir em 0.0.0.0,
    // senão a porta publicada não alcança o processo.
    serverOptions.Listen(IPAddress.Any, 3000);
});

builder.Services.AddSingleton(_ => Db.CreateDataSource());

builder.Services.AddHostedService<SettlementWorker>();

var app = builder.Build();

await Db.EnsureReadyAsync(app.Services.GetRequiredService<NpgsqlDataSource>());

app.MapHealthEndpoints();
app.MapAccountEndpoints();
app.MapTransferEndpoints();

app.Run();
