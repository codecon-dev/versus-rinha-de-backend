var builder = WebApplication.CreateSlimBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});

builder.WebHost.ConfigureKestrel(serverOptions =>
{
    serverOptions.Listen(IPAddress.Parse("localhost"), 3000);
});

builder.Services.AddSingleton(_ => Db.CreateDataSource());

builder.Services.AddHostedService<SettlementWorker>();

var app = builder.Build();

await Db.EnsureReadyAsync(app.Services.GetRequiredService<NpgsqlDataSource>());

app.MapHealthEndpoints();
app.MapAccountEndpoints();
app.MapTransferEndpoints();

app.Run();
