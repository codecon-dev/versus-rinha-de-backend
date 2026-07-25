<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Account extends Model
{
    protected $table = 'accounts';

    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['id', 'balance'];

    protected $casts = [
        'balance' => 'integer',
    ];

    public function transfersAsPayer()
    {
        return $this->hasMany(Transfer::class, 'payer_id', 'id');
    }
    public function transfersAsPayee()
    {
        return $this->hasMany(Transfer::class, 'payee_id', 'id');
    }
}
