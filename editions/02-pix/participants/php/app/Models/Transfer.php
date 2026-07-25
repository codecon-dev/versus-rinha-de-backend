<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Transfer extends Model
{
    protected $table = 'transfers';

    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'payer_id',
        'payee_id',
        'amount',
        'idempotency_key',
        'status',
        'failure_reason',
    ];

    protected $casts = [
        'amount' => 'integer',
        'created_at' => 'datetime',
        'processed_at' => 'datetime',
    ];

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'payerId' => $this->payer_id,
            'payeeId' => $this->payee_id,
            'amount' => (int) $this->amount,
            'idempotencyKey' => $this->idempotency_key,
            'status' => $this->status,
            'failureReason' => $this->failure_reason,
            'createdAt' => $this->created_at?->utc()->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }
}
