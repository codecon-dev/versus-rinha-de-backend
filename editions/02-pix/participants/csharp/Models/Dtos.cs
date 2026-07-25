namespace app.Models;

public record AccountResponse(string Id, long Balance);

public record TransferResponse(
    string Id,
    string PayerId,
    string PayeeId,
    long Amount,
    string? IdempotencyKey,
    string Status,
    string? FailureReason,
    DateTime CreatedAt
);

public record StatementResponse(
    string AccountId,
    long Balance,
    IReadOnlyList<TransferResponse> Transfers
);
