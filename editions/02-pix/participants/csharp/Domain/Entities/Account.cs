namespace app.Domain.Entities;

public class Account
{
    public string id { get; set; }
    public decimal balance { get; set; }
    public DateTime created_at { get; set; }
    public DateTime updated_at { get; set; }
}