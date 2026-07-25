namespace app.Domain.Entities;

public class Tranfer
{
    public Guid id { get; set; }
    public string payer_id { get; set; }
    public string payee_id { get; set; }
    public int amount { get; set; }
    public string idempotency_key { get; set; }
    public string status { get; set; } = "pending";
    public string? failure_reason { get; set; }
    public DateTime created_at { get; set; }
    public DateTime updated_at { get; set; }
}